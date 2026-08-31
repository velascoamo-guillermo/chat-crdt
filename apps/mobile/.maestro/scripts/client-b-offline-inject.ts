#!/usr/bin/env -S node --experimental-strip-types
/**
 * Headless "client B" for the Maestro offline-sync E2E flow.
 *
 * Driving two iOS simulators from one Maestro run is fragile (see ticket #13
 * amendment 3), so this script plays the second offline client instead: it imports
 * @chat-crdt/sync-engine directly (no edits to the package — same public API the
 * mobile app's useSync hook uses) to connect as user B and prove the CRDT merge
 * scenario end to end.
 *
 * Offline authorship is simulated by calling `engine.sendMessage()` BEFORE ever
 * constructing a WebSocketProvider — those ops only exist in B's local Y.Doc, exactly
 * like a client that composed messages while its socket was down. Connecting the
 * provider afterwards is "reconnect": WebSocketProvider opens a real WebSocket and
 * performs the same y-protocols state-vector handshake (sendSyncStep1 with B's local
 * state vector -> server replies with its own step1 -> readSyncMessage on each side
 * computes + exchanges the diff) that apps/server's SyncGateway uses for every client,
 * mobile or not. That handshake is what uploads B's offline-authored messages to the
 * room and downloads A's history — no special-casing for this script.
 *
 * After sync settles this script ASSERTS (not just logs) that its own final view
 * contains all of A's RUN_ID messages plus its own, exits 1 with a diff otherwise —
 * run.sh's `set -e` (via a failing command-substitution assignment) turns that into a
 * hard run.sh failure. It also prints an `ORDER_DIGEST=<hex>` line: a hash of its
 * final message list in order (computeOrderDigest, shared with the app — see
 * src/utils/orderDigest.ts), which run.sh captures and passes into flow 3 as
 * `-e EXPECTED_ORDER=...`. Presence-only assertions can't distinguish convergent
 * order from any other permutation of the same texts; comparing two independently
 * computed digests (this script's local view vs. the app's Zustand-rendered view) can.
 *
 * Must be run while apps/server is UP (see apps/mobile/.maestro/run.sh for the full
 * kill-server / send-offline / restart-server / run-this-script / verify sequence).
 *
 * RED-run finding — why this runs under `node`, not `bun`: apps/server authenticates
 * the WS upgrade by reading the client's offered `Sec-WebSocket-Protocol` header
 * (`bearer, <jwt>`) but never echoes a protocol back in the handshake response (see
 * apps/server SyncGateway — it's using the protocol field purely as an auth channel,
 * not real subprotocol negotiation). React Native's WebSocket tolerates that; Bun's
 * native WebSocket does not — it closes with code 1002 "Mismatch client protocol"
 * before `onopen` ever fires, even when importing the real `ws` package (Bun silently
 * substitutes its own client for `ws` imports). Reproduced directly against apps/server
 * with both `new WebSocket(...)` and `new (require('ws'))(...)` under `bun` (both fail
 * the same way) vs. plain `node` with the real `ws` package (connects immediately) —
 * this is an environment quirk of the headless script's runtime, not an apps/server or
 * sync-engine bug (the real mobile app connects and reconnects fine, proven in parts
 * 1-3 of this flow). Polyfilling `globalThis.WebSocket` with the `ws` package below
 * lets @chat-crdt/sync-engine's WebSocketProvider (which does `new WebSocket(url,
 * protocols)`) work unmodified under Node.
 *
 * Usage: RUN_ID=<id> node --experimental-strip-types \
 *          apps/mobile/.maestro/scripts/client-b-offline-inject.ts
 * Env:   API_URL (default http://localhost:3001), WS_URL (default ws://localhost:3001/sync)
 */

import NodeWebSocket from "ws";
import { SyncEngine, WebSocketProvider } from "@chat-crdt/sync-engine";
import { computeOrderDigest } from "../../src/utils/orderDigest.ts";

// See the RED-run finding above — sync-engine's WebSocketProvider expects the
// browser/RN-style global `WebSocket` constructor; Node has no native one.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const WS_URL = process.env.WS_URL ?? "ws://localhost:3001/sync";
const ROOM_ID = "default";
const RUN_ID = process.env.RUN_ID;
const CONNECT_TIMEOUT_MS = 15_000;
// Upper bound while polling for A's messages to arrive post-handshake — normally
// settles in well under a second locally; generous for a loaded CI/dev machine.
const SETTLE_TIMEOUT_MS = 8_000;
const SETTLE_POLL_MS = 150;

if (!RUN_ID) {
  console.error("[client-b] RUN_ID env var is required");
  process.exit(1);
}

const OWN_MESSAGES = [`${RUN_ID}-B-offline-1`, `${RUN_ID}-B-offline-2`];
const EXPECTED_A_MESSAGES = [
  `${RUN_ID}-A-online-1`,
  `${RUN_ID}-A-offline-1`,
  `${RUN_ID}-A-offline-2`,
];
const EXPECTED_TOTAL = OWN_MESSAGES.length + EXPECTED_A_MESSAGES.length;

interface AuthResponse {
  token: string;
  user: { id: string; email: string; username: string };
}

async function loginUserB(): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "maestro-b@e2e.test", password: "password123" }),
  });
  if (!res.ok) {
    throw new Error(
      `[client-b] login failed (${res.status}) — did you run setup-users.ts first?`,
    );
  }
  return (await res.json()) as AuthResponse;
}

function waitForConnected(provider: WebSocketProvider): Promise<void> {
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (provider.getStatus() === "connected") {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`[client-b] did not connect within ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
  });
}

/**
 * Condition-wait instead of a fixed sleep: polls until every expected content
 * string has arrived (state-vector sync is normally sub-second locally) or gives
 * up at SETTLE_TIMEOUT_MS, whichever comes first. Either way returns whatever the
 * engine has at that point — the caller (main) does the actual pass/fail assertion.
 */
function waitForSettle(engine: SyncEngine, expected: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const remaining = new Set(expected);
    const check = () => {
      for (const msg of engine.getMessages()) remaining.delete(msg.content);
      return remaining.size === 0;
    };
    if (check()) {
      resolve();
      return;
    }
    const poll = setInterval(() => {
      if (check()) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, SETTLE_POLL_MS);
    const timer = setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, SETTLE_TIMEOUT_MS);
  });
}

async function main(): Promise<void> {
  const auth = await loginUserB();

  const engine = new SyncEngine({
    roomId: ROOM_ID,
    userId: auth.user.id,
    username: auth.user.username,
  });

  // Author both messages BEFORE connecting — this is the "offline" half of the story.
  const authored = OWN_MESSAGES.map((content) => engine.sendMessage(content));
  console.log(
    `[client-b] authored offline (local-only): ${authored.map((m) => m.content).join(", ")}`,
  );

  const provider = new WebSocketProvider(engine, {
    url: `${WS_URL}?room=${ROOM_ID}`,
    token: auth.token,
    username: auth.user.username,
    onStatusChange: (status) => console.log(`[client-b] ws status: ${status}`),
  });

  try {
    await waitForConnected(provider);
    console.log("[client-b] connected — state-vector handshake in flight");

    await waitForSettle(engine, EXPECTED_A_MESSAGES);

    const finalMessages = engine.getMessages();
    const finalContents = finalMessages.map((m) => m.content);
    const missingFromA = EXPECTED_A_MESSAGES.filter((c) => !finalContents.includes(c));

    // ASSERT, don't just log: this is the "B-side convergence" proof the flow relies
    // on before it ever gets to device A's assertions in part 3.
    if (missingFromA.length > 0 || finalMessages.length !== EXPECTED_TOTAL) {
      console.error("[client-b] CONVERGENCE FAILED");
      console.error(`  expected total: ${EXPECTED_TOTAL}, got: ${finalMessages.length}`);
      console.error(`  missing from A: ${JSON.stringify(missingFromA)}`);
      console.error(`  final contents: ${JSON.stringify(finalContents)}`);
      process.exitCode = 1;
      return;
    }

    console.log(`[client-b] final local message count: ${finalMessages.length} (expected)`);
    console.log(`[client-b] final order: ${JSON.stringify(finalContents)}`);
    console.log(`ORDER_DIGEST=${computeOrderDigest(finalContents)}`);
  } finally {
    provider.destroy();
    engine.destroy();
  }
}

main()
  .then(() => {
    if (process.exitCode) {
      console.error("[client-b] failed");
    } else {
      console.log("[client-b] done");
    }
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
