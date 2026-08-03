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
const TAIL_MAX_LINES = 200;

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

/**
 * Bounded ring buffer of the last `TAIL_MAX_LINES` lines written to it.
 * `startServerProcess` uses one per spawned process so its piped
 * stdout/stderr is always drained (an unread pipe backpressures the child
 * once its OS buffer fills — ~64KB — which can stall the server mid-burst
 * and corrupt the very latencies this harness is measuring) while still
 * keeping enough context to print on a readiness failure or crash.
 */
class TailBuffer {
  private lines: string[] = [];
  private carry = '';

  write(chunk: Buffer): void {
    const text = this.carry + chunk.toString('utf8');
    const parts = text.split('\n');
    this.carry = parts.pop() ?? '';
    for (const line of parts) {
      this.lines.push(line);
      if (this.lines.length > TAIL_MAX_LINES) this.lines.shift();
    }
  }

  toString(): string {
    const rest = this.carry ? [this.carry] : [];
    return [...this.lines, ...rest].join('\n') || '(no output captured)';
  }
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

  const tail = new TailBuffer();
  proc.stdout?.on('data', (chunk: Buffer) => tail.write(chunk));
  proc.stderr?.on('data', (chunk: Buffer) => tail.write(chunk));

  let stoppedByUs = false;
  proc.once('exit', (code, signal) => {
    if (stoppedByUs) return;
    console.error(
      `[server-process] "${config.label}" on port ${config.port} exited unexpectedly ` +
        `(code=${code ?? 'null'}, signal=${signal ?? 'null'}). Last output:\n${tail.toString()}`,
    );
  });

  try {
    await waitUntilReady(baseUrl, config.label, readyTimeoutMs);
  } catch (err) {
    console.error(
      `[server-process] "${config.label}" failed to become ready. Last output:\n${tail.toString()}`,
    );
    stoppedByUs = true;
    proc.kill();
    throw err;
  }

  return {
    label: config.label,
    port: config.port,
    baseUrl,
    async stop() {
      stoppedByUs = true;
      proc.kill();
      await waitForExit(proc);
    },
  };
}
