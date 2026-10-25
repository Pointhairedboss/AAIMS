/**
 * AAIMS programmatic invariant API tests.
 * Requires backend running on http://localhost:4000 (Phase 4).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../../server/src/server.js';
import { initDatabase } from '../../server/src/db.js';
import { initBitBopClient } from '../../server/src/bitbop.js';

let BASE = process.env.AAIMS_API_URL ?? 'http://localhost:4000';
let localServer: Server | null = null;

async function api<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
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

describe('AAIMS API invariants', () => {
  beforeAll(async () => {
    try {
      const check = await fetch(`${BASE}/api/health`);
      if (check.ok) return;
    } catch {
      // start local in-process server
    }
    initDatabase();
    await initBitBopClient();
    await new Promise<void>((resolve) => {
      localServer = app.listen(0, () => {
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

  describe('Governance seed & BitBop wiring', () => {
    it('exposes NAIC seed controls (10 Guardrails)', async () => {
      const { status, body } = await api<{ controls: unknown[] }>('/api/controls');
      expect(status).toBe(200);
      expect(Array.isArray(body.controls)).toBe(true);
      expect(body.controls.length).toBeGreaterThanOrEqual(10);
    });

    it('exposes BitBop verify proxy', async () => {
      const { status } = await api('/api/bitbop/status');
      expect([200, 503]).toContain(status);
    });
  });
});
