#!/usr/bin/env -S node --experimental-strip-types
/**
 * Provisions the portfolio-video (T8) demo state on a local server: the two
 * device users, one room per clip plus a few extra rooms (iOS user = admin,
 * Android user joined), and the plaintext history for clips that have one.
 *
 * Content lives in portfolio-seed.data.ts; this file is logic only.
 *
 * Idempotent: users fall back to login on 409, rooms to join on 409, and
 * history is only written into a room whose doc is still empty. Nothing is
 * deleted — device-side SQLite keeps old messages anyway, so a "fresh" room
 * for a re-take means a new name: set ROOM_SUFFIX (e.g. `dry`, `take2`) and
 * every clip room becomes `<room>-<suffix>` (extra rooms are left as-is).
 *
 * E2EE is NOT enabled here: identity keys are per device (keyFlows.ts), so
 * the room is enabled from the iOS admin's device after both users have
 * logged in there once.
 *
 * Runs under node, not bun, for the same WebSocket-subprotocol reason as
 * client-b-offline-inject.ts.
 *
 * Usage: [ROOM_SUFFIX=dry] node --experimental-strip-types \
 *          apps/mobile/.maestro/scripts/seed-portfolio.ts
 * Env:   API_URL (default http://localhost:3001), WS_URL (default ws://localhost:3001/sync)
 */

import NodeWebSocket from "ws";
import { SyncEngine, WebSocketProvider } from "@chat-crdt/sync-engine";
import { PORTFOLIO_SEED } from "./portfolio-seed.data.ts";
import type { DeviceRole, PortfolioUser, ScriptLine } from "./portfolio-seed.types.ts";

(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const WS_URL = process.env.WS_URL ?? "ws://localhost:3001/sync";
const ROOM_SUFFIX = process.env.ROOM_SUFFIX;
const CONNECT_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 8_000;
const POLL_MS = 100;

interface AuthResponse {
  token: string;
  user: { id: string; email: string; username: string };
}

type Sessions = Record<DeviceRole, AuthResponse>;

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Login first, register only on 401: /auth is tightly throttled (429), so a
// re-run should cost one auth call per user, not two.
async function ensureUser({ email, username, password }: PortfolioUser): Promise<AuthResponse> {
  const loginRes = await postJson("/auth/login", { email, password });
  if (loginRes.ok) {
    console.log(`[seed] ${username} already exists — reused via login`);
    return (await loginRes.json()) as AuthResponse;
  }
  if (loginRes.status !== 401) {
    throw new Error(`[seed] login ${email} failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const registerRes = await postJson("/auth/register", { email, username, password });
  if (!registerRes.ok) {
    throw new Error(`[seed] register ${email} failed: ${registerRes.status} ${await registerRes.text()}`);
  }
  console.log(`[seed] registered ${username}`);
  return (await registerRes.json()) as AuthResponse;
}

async function ensureRoom(name: string, sessions: Sessions): Promise<void> {
  const createRes = await postJson("/rooms", { name }, sessions.ios.token);
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`[seed] create room ${name} failed: ${createRes.status} ${await createRes.text()}`);
  }
  const joinRes = await postJson(`/rooms/${name}/join`, {}, sessions.android.token);
  if (!joinRes.ok) {
    throw new Error(`[seed] join room ${name} failed: ${joinRes.status} ${await joinRes.text()}`);
  }
  console.log(`[seed] room ${name} ${createRes.ok ? "created" : "exists"}, android joined`);
}

function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }
    const poll = setInterval(() => {
      if (predicate()) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve();
      }
    }, POLL_MS);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`[seed] timed out waiting for ${what}`));
    }, timeoutMs);
  });
}

interface Client {
  engine: SyncEngine;
  provider: WebSocketProvider;
}

async function connect(room: string, auth: AuthResponse): Promise<Client> {
  const engine = new SyncEngine({ roomId: room, userId: auth.user.id, username: auth.user.username });
  const provider = new WebSocketProvider(engine, {
    url: `${WS_URL}?room=${encodeURIComponent(room)}`,
    token: auth.token,
    username: auth.user.username,
  });
  await waitFor(() => provider.getStatus() === "connected", CONNECT_TIMEOUT_MS, `${auth.user.username} to connect`);
  return { engine, provider };
}

/**
 * Writes `history` as the right author for each line, strictly in order:
 * every line waits until BOTH clients see it before the next one is sent, so
 * the Y.Array order matches the script.
 */
async function seedHistory(room: string, history: readonly ScriptLine[], sessions: Sessions): Promise<void> {
  if (history.length === 0) return;
  const clients: Record<DeviceRole, Client> = {
    ios: await connect(room, sessions.ios),
    android: await connect(room, sessions.android),
  };
  try {
    // Let the initial state-vector handshake land before deciding emptiness.
    await new Promise((r) => setTimeout(r, 1_000));
    const existing = clients.ios.engine.getMessages().length;
    if (existing > 0) {
      console.log(`[seed] ${room} already has ${existing} messages — history skipped`);
      return;
    }
    for (const [i, line] of history.entries()) {
      clients[line.from].engine.sendMessage(line.text);
      await waitFor(
        () => clients.ios.engine.getMessages().length > i && clients.android.engine.getMessages().length > i,
        SETTLE_TIMEOUT_MS,
        `line ${i + 1} of ${room} to sync`,
      );
    }
    // Give the server's debounced persist a moment before disconnecting.
    await new Promise((r) => setTimeout(r, 1_500));
    console.log(`[seed] ${room} history: ${history.length} messages`);
  } finally {
    for (const { provider, engine } of Object.values(clients)) {
      provider.destroy();
      engine.destroy();
    }
  }
}

async function main(): Promise<void> {
  const sessions: Sessions = {
    ios: await ensureUser(PORTFOLIO_SEED.users.ios),
    android: await ensureUser(PORTFOLIO_SEED.users.android),
  };

  for (const name of PORTFOLIO_SEED.extraRooms) await ensureRoom(name, sessions);

  for (const clip of PORTFOLIO_SEED.clips) {
    const room = ROOM_SUFFIX ? `${clip.room}-${ROOM_SUFFIX}` : clip.room;
    await ensureRoom(room, sessions);
    await seedHistory(room, clip.history, sessions);
    console.log(`[seed] clip ${clip.id} → room ${room}${clip.e2ee ? " (enable E2EE on device)" : ""}`);
  }
  console.log("[seed] done");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
