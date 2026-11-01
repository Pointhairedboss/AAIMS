/**
 * AAIMS programmatic invariant & SQLite persistence API tests.
 * Uses real local BitBopCoordinator (or https://api.bitbop.dev when BITBOP_LIVE_E2E=1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { app, bootstrapSeedAttestations } from '../../server/src/server.js';
import { initDatabase, closeDatabase, getDb, getDefaultDbPath } from '../../server/src/db.js';
import { initBitBopClient, resetBitBopClient } from '../../server/src/bitbop.js';
import { startLocalBitBopNode, type LocalBitBopNodeHandle } from '../helpers/local_bitbop_node.js';

let BASE = 'http://127.0.0.1:0';
let localServer: Server | null = null;
let bitbopNode: LocalBitBopNodeHandle | null = null;

async function api<T = unknown>(
  routePath: string,
  init?: RequestInit
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${routePath}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function createSolution(title = 'Test Solution') {
  const { status, body } = await api<{ id: string }>('/api/solutions', {
    method: 'POST',
    body: JSON.stringify({ title, ownerName: 'Test Owner', riskTier: 'MEDIUM' }),
  });
  expect(status).toBe(201);
  return body.id;
}

async function createCapability(name = 'Test Capability') {
  const { status, body } = await api<{ id: string }>('/api/capabilities', {
    method: 'POST',
    body: JSON.stringify({ name, ownerName: 'Cap Owner', status: 'DRAFT' }),
  });
  expect(status).toBe(201);
  return body.id;
}

async function createControl(name = 'Test Control') {
  const { status, body } = await api<{ id: string }>('/api/controls', {
    method: 'POST',
    body: JSON.stringify({ name, ownerName: 'Control Owner', status: 'ACTIVE', frameworkRef: 'G8-DEV-01' }),
  });
  expect(status).toBe(201);
  return body.id;
}

async function advanceStage(solutionId: string, stage: number) {
  return api(`/api/solutions/${solutionId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage }),
  });
}

async function linkCapability(solutionId: string, capabilityId: string) {
  return api(`/api/solutions/${solutionId}/capabilities`, {
    method: 'POST',
    body: JSON.stringify({ capabilityId }),
  });
}

async function attachControl(capabilityId: string, controlId: string) {
  return api(`/api/capabilities/${capabilityId}/controls`, {
    method: 'POST',
    body: JSON.stringify({ controlId }),
  });
}

async function setCapabilityStatus(capabilityId: string, status: string) {
  return api(`/api/capabilities/${capabilityId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

async function advanceToStage(solutionId: string, target: number) {
  for (let s = 2; s <= target; s++) {
    const { status, body } = await advanceStage(solutionId, s);
    if (status >= 400) return { status, body, failedAt: s };
  }
  return { status: 200, body: {}, failedAt: null };
}

describe('AAIMS API invariants & Persistent Disk SQLite', () => {
  beforeAll(async () => {
    bitbopNode = await startLocalBitBopNode();
    bitbopNode.applyProcessEnv();
    resetBitBopClient();

    initDatabase(':memory:');
    await initBitBopClient();
    await bootstrapSeedAttestations();

    await new Promise<void>((resolve) => {
      localServer = app.listen(0, '127.0.0.1', () => {
        const addr = localServer!.address();
        if (addr && typeof addr === 'object') {
          BASE = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
    const health = await api('/api/health');
    expect(health.status).toBe(200);
  });

  afterAll(async () => {
    if (localServer) {
      await new Promise<void>((resolve) => localServer!.close(() => resolve()));
      localServer = null;
    }
    closeDatabase();
    if (bitbopNode) {
      await bitbopNode.close();
      bitbopNode = null;
    }
  });

  describe('Invariant 1 — Solution stage gates', () => {
    it('rejects advancing past Stage 4 (Identify Capabilities) without linked Capability (HTTP 400)', async () => {
      const solutionId = await createSolution('No-cap stage gate');
      await advanceToStage(solutionId, 4);
      const { status, body } = await advanceStage(solutionId, 5);
      expect(status).toBe(400);
      expect(JSON.stringify(body).toLowerCase()).toMatch(/capabilit/);
    });

    it('rejects advancing past Stage 5 (Apply Controls) without Controls on all linked Capabilities (HTTP 400)', async () => {
      const solutionId = await createSolution('No-control stage gate');
      const capabilityId = await createCapability('Uncontrolled cap');
      await linkCapability(solutionId, capabilityId);
      await advanceToStage(solutionId, 5);
      const { status, body } = await advanceStage(solutionId, 6);
      expect(status).toBe(400);
      expect(JSON.stringify(body).toLowerCase()).toMatch(/control/);
    });

    it('rejects Stage 7 (Approve) without Controls active on all linked Capabilities (HTTP 400)', async () => {
      const solutionId = await createSolution('Approve gate');
      const capabilityId = await createCapability('Approve cap');
      await linkCapability(solutionId, capabilityId);
      await advanceToStage(solutionId, 5);

      const controlId = await createControl('Approve control');
      await api(`/api/solutions/${solutionId}/controls`, {
        method: 'POST',
        body: JSON.stringify({ controlId }),
      });
      await attachControl(capabilityId, controlId);
      const to6 = await advanceStage(solutionId, 6);
      expect(to6.status).toBe(200);

      await api(`/api/controls/${controlId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'GAP_IDENTIFIED' }),
      });

      const { status, body } = await advanceStage(solutionId, 7);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body).toLowerCase()).toMatch(/control|approv|delegat/);
    });

    it('allows progression when Capabilities and active Controls are present', async () => {
      const solutionId = await createSolution('Happy path');
      const capabilityId = await createCapability('Controlled cap');
      const controlId = await createControl('Active guard');
      await linkCapability(solutionId, capabilityId);
      await attachControl(capabilityId, controlId);
      const result = await advanceToStage(solutionId, 5);
      expect(result.status).toBeLessThan(400);
      expect(result.failedAt).toBeNull();
    });
  });

  describe('Invariant 2 — Capability AUTHORISED gate', () => {
    it('rejects AUTHORISED status without >= 1 active Control (HTTP 400)', async () => {
      const capabilityId = await createCapability('Unauthorised cap');
      const { status, body } = await setCapabilityStatus(capabilityId, 'AUTHORISED');
      expect(status).toBe(400);
      expect(JSON.stringify(body).toLowerCase()).toMatch(/control/);
    });

    it('allows AUTHORISED when an active Control is attached', async () => {
      const capabilityId = await createCapability('Authorisable cap');
      const controlId = await createControl('Auth control');
      await attachControl(capabilityId, controlId);
      const { status, body } = await setCapabilityStatus(capabilityId, 'AUTHORISED');
      expect(status).toBe(200);
      expect((body as { status?: string }).status).toBe('AUTHORISED');
    });
  });

  describe('Invariant 3 — Controls attach to Capabilities independently', () => {
    it('attaches Control directly to Capability without requiring a Solution', async () => {
      const capabilityId = await createCapability('Standalone cap');
      const controlId = await createControl('Standalone control');
      const { status } = await attachControl(capabilityId, controlId);
      expect(status).toBe(200);

      const listed = await api<{ controls: { id: string }[] }>(
        `/api/capabilities/${capabilityId}/controls`
      );
      expect(listed.status).toBe(200);
      expect(listed.body.controls?.some((c) => c.id === controlId)).toBe(true);
    });
  });

  describe('Governance seed, uniform Controls contract & file-backed SQLite persistence', () => {
    it('exposes NAIC seed controls as uniform Control[] regardless of User-Agent', async () => {
      const resBrowserUa = await api<unknown[]>('/api/controls', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0' },
      });
      const resPlaywrightUa = await api<unknown[]>('/api/controls', {
        headers: { 'User-Agent': 'Playwright/1.49.0' },
      });
      expect(resBrowserUa.status).toBe(200);
      expect(resPlaywrightUa.status).toBe(200);
      expect(Array.isArray(resBrowserUa.body)).toBe(true);
      expect(Array.isArray(resPlaywrightUa.body)).toBe(true);
      expect(resBrowserUa.body.length).toBeGreaterThanOrEqual(10);
      expect(resBrowserUa.body.length).toBe(resPlaywrightUa.body.length);
    });

    it('defaults getDefaultDbPath() to persistent disk data/aaims.sqlite and persists records + ML-DSA-44 attestations across SQLite close & reopen', async () => {
      const prevEnvPath = process.env.AAIMS_DB_PATH;
      delete process.env.AAIMS_DB_PATH;
      try {
        const defaultPath = getDefaultDbPath();
        expect(defaultPath).toBe(path.resolve(process.cwd(), 'data', 'aaims.sqlite'));
      } finally {
        if (prevEnvPath !== undefined) process.env.AAIMS_DB_PATH = prevEnvPath;
      }

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaims-sqlite-persist-'));
      const tmpDbPath = path.join(tmpDir, 'nested', 'aaims-durable.sqlite');

      try {
        // 1. Open file-backed SQLite database (auto-creates parent directory + WAL mode)
        initDatabase(tmpDbPath);
        expect(fs.existsSync(tmpDbPath)).toBe(true);

        const journalRow = getDb().prepare('PRAGMA journal_mode').get() as { journal_mode: string };
        expect(journalRow.journal_mode.toLowerCase()).toBe('wal');

        // 2. Create a Solution (v1) and advance to Stage 2 (v2) via real HTTP API + BitBop attestation
        const createRes = await api<{ id: string; entity_version: number }>('/api/solutions', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Durable Disk Governance Solution',
            business_problem: 'Prove SQLite WAL persistence across process restarts',
            requesting_unit: 'Enterprise Architecture',
            owner_name: 'Elena Rostova',
            owner_remit: 'AI Governance',
            risk_tier: 'HIGH',
          }),
        });
        expect(createRes.status).toBe(201);
        const solId = createRes.body.id;

        const stageRes = await advanceStage(solId, 2);
        expect(stageRes.status).toBe(200);

        // 3. Close SQLite completely (simulating server shutdown)
        closeDatabase();

        // 4. Re-open SQLite from the exact disk file (simulating server restart)
        initDatabase(tmpDbPath);

        // 5. Verify Solution state and both v1 + v2 cryptographic attestations survived on disk
        const getSolRes = await api<{ id: string; title: string; lifecycle_stage: number; entity_version: number }>(
          `/api/solutions/${solId}`
        );
        expect(getSolRes.status).toBe(200);
        expect(getSolRes.body.title).toBe('Durable Disk Governance Solution');
        expect(getSolRes.body.lifecycle_stage).toBe(2);
        expect(getSolRes.body.entity_version).toBe(2);

        const attRes = await api<Array<Record<string, unknown>>>('/api/attestations');
        expect(attRes.status).toBe(200);
        const solReceipts = attRes.body.filter((r) => r.entity_id === solId);
        expect(solReceipts.length).toBe(2);

        for (const rcpt of solReceipts) {
          const verifyRes = await api<{
            valid: boolean;
            checks: { local_mldsa44_signature_valid: boolean; historical_snapshot_match: boolean };
          }>('/api/attestations/verify', {
            method: 'POST',
            body: JSON.stringify(rcpt),
          });
          expect(verifyRes.status).toBe(200);
          expect(verifyRes.body.valid).toBe(true);
          expect(verifyRes.body.checks.local_mldsa44_signature_valid).toBe(true);
          expect(verifyRes.body.checks.historical_snapshot_match).toBe(true);
        }
      } finally {
        closeDatabase();
        initDatabase(':memory:');
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('exposes provisioned BitBop client status', async () => {
      const { status, body } = await api<{ provisioned: boolean; pinned_key_id: string }>('/api/bitbop/status');
      expect(status).toBe(200);
      expect(body.provisioned).toBe(true);
      expect(body.pinned_key_id).toBe('mldsa44-release-2026-01');
    });
  });
});
