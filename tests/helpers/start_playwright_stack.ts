import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

// Prevent server/src/server.ts from auto-starting before BitBop & temp SQLite are configured
process.env.NODE_ENV = 'test';

async function sweepStaleTempDirs(): Promise<void> {
  try {
    const tmpBase = os.tmpdir();
    const entries = fs.readdirSync(tmpBase, { withFileTypes: true });
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('aaims-playwright-')) {
        const fullPath = path.join(tmpBase, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {
          // Directory may still be in use
        }
      }
    }
  } catch {
    // Ignore sweep errors
  }
}

async function main(): Promise<void> {
  await sweepStaleTempDirs();

  const { startLocalBitBopNode } = await import('./local_bitbop_node.js');
  const { initDatabase, closeDatabase } = await import('../../server/src/db.js');
  const { initBitBopClient } = await import('../../server/src/bitbop.js');
  const { app, bootstrapSeedAttestations } = await import('../../server/src/server.js');

  const bitbopPort = Number(process.env.BITBOP_LOCAL_PORT || 4010);
  const apiPort = Number(process.env.PORT || 4000);
  const clientPort = Number(process.env.CLIENT_PORT || 5173);

  const bitbopNode = await startLocalBitBopNode({ port: bitbopPort });
  bitbopNode.applyProcessEnv();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaims-playwright-'));
  const dbPath = path.join(tmpDir, 'aaims.sqlite');
  process.env.AAIMS_DB_PATH = dbPath;

  initDatabase(dbPath);
  await initBitBopClient();
  await bootstrapSeedAttestations();

  const apiServer: http.Server = await new Promise((resolve, reject) => {
    const srv = app.listen(apiPort, () => resolve(srv));
    srv.once('error', reject);
  });

  const clientRoot = path.resolve(process.cwd(), 'client');
  const viteServer: ViteDevServer = await createViteServer({
    root: clientRoot,
    configFile: path.join(clientRoot, 'vite.config.ts'),
    server: {
      port: clientPort,
      strictPort: true,
      host: 'localhost',
    },
    logLevel: 'warn',
  });
  await viteServer.listen();

  console.log(
    `[playwright-stack] Ready: BitBop=${bitbopNode.apiUrl} | API=http://localhost:${apiPort} | Client=http://localhost:${clientPort}`
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await viteServer.close();
    } catch {}
    await new Promise<void>((resolve) => {
      apiServer.close(() => resolve());
    });
    try {
      await bitbopNode.close();
    } catch {}
    try {
      closeDatabase();
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((err) => {
  console.error('[playwright-stack] Fatal startup failure:', err);
  process.exit(1);
});
