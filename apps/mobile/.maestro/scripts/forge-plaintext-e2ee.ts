#!/usr/bin/env -S node --experimental-strip-types
/**
 * T10 acceptance: the server rejects a forged plaintext message in an E2EE room.
 *
 * Plays a "stale" client: a plain SyncEngine with NO content cipher (exactly
 * what a member whose cached rooms list predates enablement used to build)
 * sends a plaintext message into ROOM, which must already be E2EE-enabled
 * (currentKeyId > 0). A second, fresh engine then syncs the room from the
 * server and ASSERTS the forged message is absent (exit 1 otherwise). The
 * server log should show "Rejected sync update with a non-E2E1 message in
 * E2EE room ..." and e2ee_rejected_updates_total should tick.
 *
 * Runs under node, not bun — see client-b-offline-inject.ts for why.
 *
 * Usage: ROOM=<e2ee room> EMAIL=<member email> PASSWORD=<pw> \
 *          node --experimental-strip-types apps/mobile/.maestro/scripts/forge-plaintext-e2ee.ts
 * Env:   API_URL (default http://localhost:3001), WS_URL (default ws://localhost:3001/sync)
 */

import NodeWebSocket from "ws";
import { SyncEngine, WebSocketProvider } from "@chat-crdt/sync-engine";

(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const WS_URL = process.env.WS_URL ?? "ws://localhost:3001/sync";
const ROOM = process.env.ROOM;
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const CONNECT_TIMEOUT_MS = 15_000;
// Long enough for the forged update to reach the server and (if it were
// accepted) be applied before the observer syncs.
const SETTLE_MS = 1_500;

if (!ROOM || !EMAIL || !PASSWORD) {
  console.error("[forge] ROOM, EMAIL and PASSWORD env vars are required");
  process.exit(1);
}

interface AuthResponse {
  token: string;
  user: { id: string; username: string };
}

interface RoomSummary {
  name: string;
  currentKeyId: number;
}

async function login(): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`[forge] login failed (${res.status})`);
  return (await res.json()) as AuthResponse;
}

async function roomEpoch(token: string): Promise<number> {
  const res = await fetch(`${API_URL}/rooms`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`[forge] GET /rooms failed (${res.status})`);
  const room = ((await res.json()) as RoomSummary[]).find((r) => r.name === ROOM);
  if (!room) throw new Error(`[forge] not a member of "${ROOM}"`);
  return room.currentKeyId;
}

function connect(engine: SyncEngine, auth: AuthResponse): Promise<WebSocketProvider> {
  const provider = new WebSocketProvider(engine, {
    url: `${WS_URL}?room=${ROOM}`,
    token: auth.token,
    username: auth.user.username,
  });
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (provider.getStatus() === "connected") {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(provider);
      }
    }, 100);
    const timer = setTimeout(() => {
      clearInterval(poll);
      provider.destroy();
      reject(new Error(`[forge] did not connect within ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const auth = await login();
  const epoch = await roomEpoch(auth.token);
  if (epoch <= 0) {
    console.error(`[forge] room "${ROOM}" is not E2EE-enabled (currentKeyId ${epoch}) — enable it first`);
    process.exitCode = 1;
    return;
  }

  const marker = `T10-FORGE-${Date.now()}`;
  const forger = new SyncEngine({ roomId: ROOM!, userId: auth.user.id, username: auth.user.username });
  const forgerProvider = await connect(forger, auth);
  forger.sendMessage(marker); // no contentCipher -> plaintext on the wire
  console.log(`[forge] sent plaintext marker into E2EE room "${ROOM}" (epoch ${epoch})`);
  await sleep(SETTLE_MS);
  forgerProvider.destroy();
  forger.destroy();

  const observer = new SyncEngine({ roomId: ROOM!, userId: auth.user.id, username: auth.user.username });
  const observerProvider = await connect(observer, auth);
  await sleep(SETTLE_MS);
  const leaked = observer.getMessages().some((m) => m.content === marker);
  observerProvider.destroy();
  observer.destroy();

  if (leaked) {
    console.error("[forge] FAIL — server accepted the plaintext message");
    process.exitCode = 1;
    return;
  }
  console.log("[forge] PASS — server rejected the plaintext message (check server log for the rejection)");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
