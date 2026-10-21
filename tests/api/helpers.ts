import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_PORT = 4000;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

export interface TestServerHandle {
  baseUrl: string;
  port: number;
  process: ChildProcess;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = new Error(`Health check returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Server did not become ready at ${baseUrl} within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export async function startTestServer(port = DEFAULT_PORT): Promise<TestServerHandle> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(ROOT, 'server', 'data', `test-${Date.now()}.sqlite`);

  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', 'src/index.ts'],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env,
        PORT: String(port),
        AAIMS_DB_PATH: dbPath,
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (chunk: Buffer) => {
    if (process.env.DEBUG_TEST_SERVER === '1') {
      process.stdout.write(chunk);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (process.env.DEBUG_TEST_SERVER === '1') {
      process.stderr.write(chunk);
    }
  });

  try {
    await waitForHealth(baseUrl, STARTUP_TIMEOUT_MS);
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }

  return { baseUrl, port, process: child };
}

export async function stopTestServer(handle: TestServerHandle): Promise<void> {
  if (!handle.process.killed) {
    handle.process.kill('SIGTERM');
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      handle.process.once('exit', () => resolve());
    }),
    delay(5_000),
  ]);
}

export async function apiFetch<T = unknown>(
  handle: TestServerHandle,
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; raw: Response }> {
  const res = await fetch(`${handle.baseUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  let body: T;
  const text = await res.text();
  try {
    body = text ? (JSON.parse(text) as T) : (undefined as T);
  } catch {
    body = text as unknown as T;
  }

  return { status: res.status, body, raw: res };
}

export async function withTestServer<T>(
  fn: (handle: TestServerHandle) => Promise<T>,
  port = DEFAULT_PORT,
): Promise<T> {
  const handle = await startTestServer(port);
  try {
    return await fn(handle);
  } finally {
    await stopTestServer(handle);
  }
}
