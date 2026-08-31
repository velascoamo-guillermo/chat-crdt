/**
 * Minimal REST client for the bench harness: registers users and creates /
 * joins a room via the real HTTP API (apps/server/src/auth, apps/server/src/rooms).
 * No mocking — this hits a running server instance over `fetch`.
 */

export interface RestClientConfig {
  baseUrl: string;
}

export interface AuthedUser {
  token: string;
  userId: string;
  email: string;
  username: string;
}

interface RegisterResponseBody {
  token: string;
  user: { id: string; email: string; username: string };
}

interface RoomResponseBody {
  id: string;
  name: string;
  role: string;
}

async function assertOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${action} failed (${res.status}): ${body}`);
  }
}

/** POST /auth/register — returns a fresh JWT + user record. */
export async function registerUser(
  config: RestClientConfig,
  params: { email: string; username: string; password: string },
): Promise<AuthedUser> {
  const res = await fetch(`${config.baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  await assertOk(res, `registerUser(${params.email})`);
  const body = (await res.json()) as RegisterResponseBody;
  return { token: body.token, userId: body.user.id, email: body.user.email, username: body.user.username };
}

/** POST /rooms — creates the room, caller becomes admin member. */
export async function createRoom(
  config: RestClientConfig,
  token: string,
  name: string,
): Promise<RoomResponseBody> {
  const res = await fetch(`${config.baseUrl}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  await assertOk(res, `createRoom(${name})`);
  return (await res.json()) as RoomResponseBody;
}

/** POST /rooms/:name/join — idempotent membership grant. */
export async function joinRoom(
  config: RestClientConfig,
  token: string,
  name: string,
): Promise<RoomResponseBody> {
  const res = await fetch(`${config.baseUrl}/rooms/${encodeURIComponent(name)}/join`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  await assertOk(res, `joinRoom(${name})`);
  return (await res.json()) as RoomResponseBody;
}
