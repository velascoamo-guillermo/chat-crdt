/**
 * Spawns/stops real NestJS server instances (compiled `dist/main.js`, same
 * artifact `bun run start` ships) so the "2 instances / Redis hop" topology
 * can run two processes on different ports against the same Postgres+Redis.
 * Uses `node:child_process` (not Bun-specific APIs) to avoid a new type-only
 * dependency in apps/server/package.json.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface ServerProcessConfig {
  label: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  corsOrigin?: string;
  /** Absolute path to apps/server. */
  cwd: string;
}

export interface ManagedServerProcess {
  readonly label: string;
  readonly port: number;
  readonly baseUrl: string;
  stop(): Promise<void>;
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForExit(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    proc.once('exit', () => resolve());
  });
}

/** `bun run build` (nest build via tsc) — needed once so dist/main.js has valid decorator metadata. */
export async function ensureServerBuilt(cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('bun', ['run', 'build'], { cwd, stdio: 'inherit' });
    proc.once('error', reject);
    proc.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`"bun run build" failed in ${cwd} (exit ${code})`));
    });
  });
}

async function waitUntilReady(baseUrl: string, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response — even a 400/404 — proves the Nest app is listening and routing.
      await fetch(`${baseUrl}/auth/login`, { method: 'POST' });
      return;
    } catch (err) {
      lastError = err;
      await sleep(READY_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `Server "${label}" at ${baseUrl} did not become ready within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export async function startServerProcess(
  config: ServerProcessConfig,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
): Promise<ManagedServerProcess> {
  const baseUrl = `http://localhost:${config.port}`;
  const proc = spawn('bun', ['run', 'start'], {
    cwd: config.cwd,
    env: {
      ...process.env,
      PORT: String(config.port),
      DATABASE_URL: config.databaseUrl,
      REDIS_URL: config.redisUrl,
      JWT_SECRET: config.jwtSecret,
      CORS_ORIGIN: config.corsOrigin ?? 'http://localhost:8081',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitUntilReady(baseUrl, config.label, readyTimeoutMs);
  } catch (err) {
    proc.kill();
    throw err;
  }

  return {
    label: config.label,
    port: config.port,
    baseUrl,
    async stop() {
      proc.kill();
      await waitForExit(proc);
    },
  };
}
