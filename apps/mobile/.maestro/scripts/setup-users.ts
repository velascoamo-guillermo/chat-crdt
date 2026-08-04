#!/usr/bin/env bun
/**
 * Provisions the two fixed test accounts used by the Maestro offline-sync E2E flow
 * (apps/mobile/.maestro/01-…03-…yaml + client-b-offline-inject.ts).
 *
 * Idempotent: registers each user, and falls back to a login check if the email is
 * already taken from a previous run. The "default" room is an open lobby on the
 * server (see apps/server SyncGateway.handleConnection) — any authenticated user may
 * join without an explicit RoomMember row, so no room-membership setup is needed here.
 *
 * Usage: bun apps/mobile/.maestro/scripts/setup-users.ts
 * Env:   API_URL (default http://localhost:3001)
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";

interface AuthResponse {
  token: string;
  user: { id: string; email: string; username: string };
}

async function ensureUser(
  email: string,
  username: string,
  password: string,
): Promise<AuthResponse> {
  const registerRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, password }),
  });

  if (registerRes.ok) {
    const data = (await registerRes.json()) as AuthResponse;
    console.log(`[setup-users] registered ${email}`);
    return data;
  }

  if (registerRes.status === 409) {
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      throw new Error(
        `[setup-users] ${email} already registered but login failed (${loginRes.status}) — ` +
          `password may have drifted from the fixture value`,
      );
    }
    const data = (await loginRes.json()) as AuthResponse;
    console.log(`[setup-users] ${email} already exists — reused via login`);
    return data;
  }

  const body = await registerRes.text();
  throw new Error(
    `[setup-users] failed to register ${email}: ${registerRes.status} ${body}`,
  );
}

async function main(): Promise<void> {
  const [userA, userB] = await Promise.all([
    ensureUser("maestro-a@e2e.test", "MaestroA", "password123"),
    ensureUser("maestro-b@e2e.test", "MaestroB", "password123"),
  ]);
  console.log(`[setup-users] ready: A=${userA.user.id} B=${userB.user.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
