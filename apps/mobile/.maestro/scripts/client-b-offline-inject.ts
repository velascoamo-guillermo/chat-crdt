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

// See the RED-run finding above — sync-engine's WebSocketProvider expects the
// browser/RN-style global `WebSocket` constructor; Node has no native one.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const WS_URL = process.env.WS_URL ?? "ws://localhost:3001/sync";
const ROOM_ID = "default";
const RUN_ID = process.env.RUN_ID;
// Generous — the point of this script is to prove the sync completes at all, not to
// measure how fast; CI/local machines vary a lot under load.
const SYNC_SETTLE_MS = 3_000;
const CONNECT_TIMEOUT_MS = 15_000;

if (!RUN_ID) {
  console.error("[client-b] RUN_ID env var is required");
  process.exit(1);
}

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
    const timer = setTimeout(() => {
      reject(new Error(`[client-b] did not connect within ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    const poll = setInterval(() => {
      if (provider.getStatus() === "connected") {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, 100);
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
  const msg1 = engine.sendMessage(`${RUN_ID}-B-offline-1`);
  const msg2 = engine.sendMessage(`${RUN_ID}-B-offline-2`);
  console.log(`[client-b] authored offline (local-only): ${msg1.content}, ${msg2.content}`);

  const provider = new WebSocketProvider(engine, {
    url: `${WS_URL}?room=${ROOM_ID}`,
    token: auth.token,
    username: auth.user.username,
    onStatusChange: (status) => console.log(`[client-b] ws status: ${status}`),
  });

  try {
    await waitForConnected(provider);
    console.log("[client-b] connected — state-vector handshake in flight");
    await new Promise((resolve) => setTimeout(resolve, SYNC_SETTLE_MS));
    console.log(`[client-b] final local message count: ${engine.getMessages().length}`);
  } finally {
    provider.destroy();
    engine.destroy();
  }
}

main()
  .then(() => {
    console.log("[client-b] done");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
