#!/usr/bin/env bun
/**
 * WS P95 message-delivery latency bench (issue #14).
 *
 * This is a measurement TOOL, not product code — see percentiles.test.ts and
 * latency-payload.test.ts for the TDD'd measurement core (percentile math +
 * latency extraction). This orchestration script is verified by actually
 * running it end-to-end against real infra; its output (this run's numbers)
 * belongs in the PR description, not as a tracked doc — see amendment 7.
 *
 * USAGE (one command, from apps/server, assuming infra is up)
 *   1. Start infra:  bun run infra:up        (repo root; postgres + redis via infra/docker-compose.yml)
 *   2. Migrate:      cd apps/server && bunx prisma migrate deploy   (once, if not already applied)
 *   3. Run:          cd apps/server && bun run bench
 *
 * The harness builds the server once (`bun run build`) then spawns its own
 * `dist/main.js` process(es) on non-default ports (BENCH_PORT_A/B, default
 * 4101/4102) against the SAME Postgres/Redis docker-compose provides, so it
 * never collides with a `bun run dev` you might already have open on 3001.
 * Users + rooms are created for real via POST /auth/register, POST /rooms
 * and POST /rooms/:name/join (see rest-client.ts) — no DB fixtures, no mocks.
 *
 * REGISTRATION BUDGET: `/auth/register` is throttled 5/min/IP in production
 * code (auth.controller.ts) and this harness does not weaken that. So it
 * registers exactly TWO identities ("pub" / "sub") ONCE and reuses their
 * JWTs for every topology, every condition, and (for the fan-out topology)
 * across multiple simultaneous WS sockets — the server has no restriction on
 * multiple concurrent connections authenticating as the same user, so this
 * is a faithful way to open 10 real, separate WebSocket connections without
 * 10 real registrations. Only room creation/joins (throttled 30/min) scale
 * with the number of scenarios (6 rooms total: 3 topologies x 2 conditions).
 *
 * TOPOLOGIES (each run under `baseline` and `burst` conditions):
 *   1. 2 clients, same server instance
 *   2. 2 clients, 2 server instances — forces the Redis pub/sub hop
 *   3. 10 clients (1 publisher + 9 subscribers), single instance, fan-out
 *
 * CONDITIONS
 *   baseline — modest send rate (~10 msg/s)
 *   burst    — publisher sends near the 60 msg/s server rate cap (~55 msg/s)
 *
 * OPTIONAL: artificial network delay. Set BENCH_ARTIFICIAL_DELAY_MS to add an
 * in-process send-side delay to the publisher's outgoing frames (see
 * ws-bench-client.ts `artificialDelayMs`) as a documented stand-in for
 * `tc`/toxiproxy (root-only / Linux-only — not used by default; amendment 5).
 * This does NOT run as part of the three headline topologies above; rerun
 * with it set to see its effect on top of `baseline`.
 *
 * ENV VARS (all optional; defaults match infra/docker-compose.yml)
 *   DATABASE_URL               postgresql://chatcrdt:chatcrdt@localhost:5432/chatcrdt
 *   REDIS_URL                  redis://localhost:6379
 *   JWT_SECRET                 bench-harness-dev-secret-not-for-prod-use
 *                               (>=16 chars; only used by the server instances THIS script spawns)
 *   BENCH_PORT_A / BENCH_PORT_B  4101 / 4102
 *   BENCH_ARTIFICIAL_DELAY_MS    0
 */
import { join } from 'path';
import { ensureServerBuilt, startServerProcess, type ManagedServerProcess } from './server-process';
import { registerUser, createRoom, joinRoom, type AuthedUser } from './rest-client';
import { WsBenchClient } from './ws-bench-client';
import { runLoad, type LoadConfig } from './scenarios';
import { summarizeLatenciesMs } from './percentiles';
import { formatMarkdownReport, type ReportRow } from './report';

const SERVER_CWD = join(import.meta.dir, '..');
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://chatcrdt:chatcrdt@localhost:5432/chatcrdt';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET ?? 'bench-harness-dev-secret-not-for-prod-use';
const PORT_A = Number(process.env.BENCH_PORT_A ?? 4101);
const PORT_B = Number(process.env.BENCH_PORT_B ?? 4102);
const ARTIFICIAL_DELAY_MS = Number(process.env.BENCH_ARTIFICIAL_DELAY_MS ?? 0);

// ~10 msg/s for 10s.
const BASELINE: LoadConfig = { messageCount: 100, intervalMs: 100, drainMs: 5_000 };
// ~55 msg/s (below the 60 msg/s rate cap) for ~4.5s.
const BURST: LoadConfig = { messageCount: 250, intervalMs: 18, drainMs: 8_000 };

interface TopologySetup {
  publisher: WsBenchClient;
  subscribers: WsBenchClient[];
  cleanup: () => void;
}

interface BenchIdentities {
  pub: AuthedUser;
  sub: AuthedUser;
}

function uniqueSlug(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function registerBenchUser(baseUrl: string, tag: string): Promise<AuthedUser> {
  const slug = uniqueSlug(tag);
  return registerUser(
    { baseUrl },
    {
      email: `bench-${slug}@example.com`,
      username: `bench-${slug}`.slice(0, 30),
      password: 'bench-password-1234',
    },
  );
}

/** Registers the two identities the whole run reuses (see REGISTRATION BUDGET above). */
async function registerIdentities(baseUrl: string): Promise<BenchIdentities> {
  const [pub, sub] = await Promise.all([
    registerBenchUser(baseUrl, 'pub'),
    registerBenchUser(baseUrl, 'sub'),
  ]);
  return { pub, sub };
}

async function setupRoom(baseUrl: string, roomName: string, users: readonly AuthedUser[]): Promise<void> {
  await createRoom({ baseUrl }, users[0].token, roomName);
  for (const user of users.slice(1)) {
    await joinRoom({ baseUrl }, user.token, roomName);
  }
}

function wsUrl(baseUrl: string, roomName: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/sync?room=${encodeURIComponent(roomName)}`;
}

async function connectClient(
  baseUrl: string,
  roomName: string,
  token: string,
  artificialDelayMs = 0,
): Promise<WsBenchClient> {
  const client = new WsBenchClient({ url: wsUrl(baseUrl, roomName), token, artificialDelayMs });
  client.connect();
  await client.ready;
  return client;
}

async function setupSameInstance(
  serverA: ManagedServerProcess,
  identities: BenchIdentities,
): Promise<TopologySetup> {
  const roomName = uniqueSlug('bench-same-instance');
  await setupRoom(serverA.baseUrl, roomName, [identities.pub, identities.sub]);
  const publisher = await connectClient(serverA.baseUrl, roomName, identities.pub.token, ARTIFICIAL_DELAY_MS);
  const subscriber = await connectClient(serverA.baseUrl, roomName, identities.sub.token);
  return {
    publisher,
    subscribers: [subscriber],
    cleanup: () => {
      publisher.close();
      subscriber.close();
    },
  };
}

async function setupRedisHop(
  serverA: ManagedServerProcess,
  serverB: ManagedServerProcess,
  identities: BenchIdentities,
): Promise<TopologySetup> {
  const roomName = uniqueSlug('bench-redis-hop');
  await setupRoom(serverA.baseUrl, roomName, [identities.pub, identities.sub]);
  const publisher = await connectClient(serverA.baseUrl, roomName, identities.pub.token, ARTIFICIAL_DELAY_MS);
  const subscriber = await connectClient(serverB.baseUrl, roomName, identities.sub.token);
  return {
    publisher,
    subscribers: [subscriber],
    cleanup: () => {
      publisher.close();
      subscriber.close();
    },
  };
}

/**
 * 10 real, separate WS connections: 1 as `identities.pub`, 9 as
 * `identities.sub` (same JWT/user reused across sockets — see REGISTRATION
 * BUDGET above; nothing in sync.gateway.ts restricts concurrent connections
 * from the same user).
 */
async function setupFanOut(
  serverA: ManagedServerProcess,
  identities: BenchIdentities,
  subscriberCount = 9,
): Promise<TopologySetup> {
  const roomName = uniqueSlug('bench-fanout');
  await setupRoom(serverA.baseUrl, roomName, [identities.pub, identities.sub]);
  const publisher = await connectClient(serverA.baseUrl, roomName, identities.pub.token, ARTIFICIAL_DELAY_MS);
  const subscribers = await Promise.all(
    Array.from({ length: subscriberCount }, () =>
      connectClient(serverA.baseUrl, roomName, identities.sub.token),
    ),
  );
  return {
    publisher,
    subscribers,
    cleanup: () => {
      publisher.close();
      subscribers.forEach(s => s.close());
    },
  };
}

async function runTopology(
  name: string,
  setup: () => Promise<TopologySetup>,
): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  const conditions: Array<[string, LoadConfig]> = [
    ['baseline', BASELINE],
    ['burst', BURST],
  ];

  for (const [condition, load] of conditions) {
    const { publisher, subscribers, cleanup } = await setup();
    try {
      console.log(
        `Running "${name}" / ${condition}: ${load.messageCount} msgs @ ${load.intervalMs}ms interval, ${subscribers.length} subscriber(s)...`,
      );
      const samples = await runLoad(publisher, subscribers, load);
      if (samples.length === 0) {
        throw new Error(`No latency samples collected for "${name}" / ${condition}`);
      }
      const summary = summarizeLatenciesMs(samples.map(s => s.receivedAt - s.sentAt));
      rows.push({ topology: name, condition, summary });
      console.log(
        `  -> ${summary.count} samples | P50=${summary.p50.toFixed(1)}ms P95=${summary.p95.toFixed(1)}ms P99=${summary.p99.toFixed(1)}ms (min ${summary.min.toFixed(1)} / max ${summary.max.toFixed(1)})`,
      );
    } finally {
      cleanup();
    }
  }

  return rows;
}

async function main(): Promise<void> {
  console.log('Building server (bun run build)...');
  await ensureServerBuilt(SERVER_CWD);

  console.log(`Starting server instance A on port ${PORT_A}...`);
  const serverA = await startServerProcess({
    label: 'A',
    port: PORT_A,
    databaseUrl: DATABASE_URL,
    redisUrl: REDIS_URL,
    jwtSecret: JWT_SECRET,
    cwd: SERVER_CWD,
  });

  const rows: ReportRow[] = [];

  try {
    console.log('Registering the two reused bench identities (pub/sub)...');
    const identities = await registerIdentities(serverA.baseUrl);

    rows.push(
      ...(await runTopology('2 clients — same instance', () => setupSameInstance(serverA, identities))),
    );

    console.log(`Starting server instance B on port ${PORT_B} (Redis-hop topology)...`);
    const serverB = await startServerProcess({
      label: 'B',
      port: PORT_B,
      databaseUrl: DATABASE_URL,
      redisUrl: REDIS_URL,
      jwtSecret: JWT_SECRET,
      cwd: SERVER_CWD,
    });
    try {
      rows.push(
        ...(await runTopology('2 clients — 2 instances (Redis hop)', () =>
          setupRedisHop(serverA, serverB, identities),
        )),
      );
    } finally {
      await serverB.stop();
    }

    rows.push(
      ...(await runTopology('10 clients — fan-out (1 instance)', () =>
        setupFanOut(serverA, identities),
      )),
    );
  } finally {
    await serverA.stop();
  }

  console.log('\n' + formatMarkdownReport(rows) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Bench run failed:', err);
    process.exit(1);
  });
