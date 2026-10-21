#!/usr/bin/env bun
/**
 * Provisions a shared room for the Maestro multi-user E2E flows.
 *
 * maestro-a creates the room (becoming its admin), or re-joins it if it already
 * exists from a previous run. maestro-b then joins it. Users must already exist:
 * run setup-users.ts first.
 *
 * Usage: bun apps/mobile/.maestro/scripts/e2e-room.ts <room-name>
 *        node --experimental-strip-types apps/mobile/.maestro/scripts/e2e-room.ts <room-name>
 * Env:   API_URL (default http://localhost:3001)
 * Output: on success, the final line is `E2E_ROOM=<room-name>`.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const PASSWORD = "password123";
const USER_A = "maestro-a@e2e.test";
const USER_B = "maestro-b@e2e.test";

/** Mirrors apps/server/src/rooms/dto/create-room.dto.ts. */
const ROOM_NAME_PATTERN = /^[a-z0-9-]+$/;
const ROOM_NAME_MIN = 2;
const ROOM_NAME_MAX = 64;

const USAGE =
  "usage: e2e-room.ts <room-name>  (2-64 chars, lowercase a-z, 0-9 and hyphens)";

interface AuthResponse {
  token: string;
  user: { id: string; email: string; username: string };
}

interface HttpResult {
  status: number;
  ok: boolean;
  body: string;
}

function fail(message: string, code = 1): never {
  console.error(`[e2e-room] ${message}`);
  process.exit(code);
}

function validateRoomName(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0) {
    fail(USAGE, 2);
  }
  const name = raw;
  if (
    name.length < ROOM_NAME_MIN ||
    name.length > ROOM_NAME_MAX ||
    !ROOM_NAME_PATTERN.test(name)
  ) {
    fail(`invalid room name "${name}". ${USAGE}`, 2);
  }
  return name;
}

async function send(
  path: string,
  init: { method: "GET" | "POST"; token?: string; json?: unknown },
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.token !== undefined) headers["Authorization"] = `Bearer ${init.token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: init.method,
    headers,
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

async function login(email: string): Promise<string> {
  const res = await send("/auth/login", {
    method: "POST",
    json: { email, password: PASSWORD },
  });
  if (!res.ok) {
    fail(
      `login failed for ${email} (${res.status}): ${res.body}. ` +
        `Run apps/mobile/.maestro/scripts/setup-users.ts first.`,
    );
  }
  const data = JSON.parse(res.body) as AuthResponse;
  return data.token;
}

async function main(): Promise<void> {
  const roomName = validateRoomName(process.argv[2]);

  const tokenA = await login(USER_A);
  const tokenB = await login(USER_B);

  const created = await send("/rooms", {
    method: "POST",
    token: tokenA,
    json: { name: roomName },
  });

  if (created.ok) {
    console.log(`[e2e-room] created "${roomName}" as ${USER_A}`);
  } else if (created.status === 409) {
    const rejoined = await send(`/rooms/${roomName}/join`, {
      method: "POST",
      token: tokenA,
    });
    if (!rejoined.ok) {
      fail(
        `${USER_A} re-join of existing "${roomName}" failed (${rejoined.status}): ${rejoined.body}`,
      );
    }
    console.log(`[e2e-room] "${roomName}" already exists, ${USER_A} re-joined`);
  } else {
    fail(
      `create "${roomName}" failed (${created.status}): ${created.body}`,
    );
  }

  const joinedB = await send(`/rooms/${roomName}/join`, {
    method: "POST",
    token: tokenB,
  });
  if (!joinedB.ok) {
    fail(`${USER_B} join of "${roomName}" failed (${joinedB.status}): ${joinedB.body}`);
  }
  console.log(`[e2e-room] ${USER_B} joined "${roomName}"`);

  console.log(`E2E_ROOM=${roomName}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(`request failed: ${message}`);
});

// Makes this file a module so its top-level names don't collide with sibling scripts.
export {};
