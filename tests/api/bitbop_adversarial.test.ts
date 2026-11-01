/**
 * AAIMS Adversarial Cryptographic, Fail-Closed Rollback & VerificationModal DOM Suite (Tier 5)
 *
 * Exercises real ML-KEM-768 decapsulation, local pinned 1,312-byte ML-DSA-44 verification,
 * transactional SQLite rollback on BitBop failure, in-place SQLite tampering detection,
 * and real React DOM rendering of VerificationModal.tsx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { MlKem768 } from 'mlkem';
import { app, bootstrapSeedAttestations } from '../../server/src/server.js';
import { initDatabase, closeDatabase, getDb } from '../../server/src/db.js';
import {
  initBitBopClient,
  resetBitBopClient,
  DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64,
  verifyLocalMlDsa44ReceiptSignature,
} from '../../server/src/bitbop.js';
import { VerificationModal } from '../../client/src/components/VerificationModal.js';
import type { BitBopReceipt, VerificationResult } from '../../client/src/types.js';
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

/**
 * Mounts the real VerificationModal React component into an isolated JSDOM document
 * and returns rendered DOM query helpers + cleanup.
 */
function renderVerificationModalDom(props: {
  isOpen: boolean;
  onClose?: () => void;
  receipt: BitBopReceipt | null;
  result: VerificationResult | null;
  loading: boolean;
}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:5173',
  });
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevNavigator = (globalThis as Record<string, unknown>).navigator;
  const prevActEnv = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

  (globalThis as Record<string, unknown>).window = dom.window;
  (globalThis as Record<string, unknown>).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(VerificationModal, {
        isOpen: props.isOpen,
        onClose: props.onClose ?? (() => {}),
        receipt: props.receipt,
        result: props.result,
        loading: props.loading,
      })
    );
  });

  return {
    container,
    document: dom.window.document,
    unmount() {
      act(() => {
        root.unmount();
      });
      dom.window.close();
      if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else (globalThis as Record<string, unknown>).document = prevDocument;
      if (prevNavigator !== undefined) {
        Object.defineProperty(globalThis, 'navigator', {
          value: prevNavigator,
          configurable: true,
          writable: true,
        });
      }
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

describe('BitBop Adversarial Verification, Fail-Closed Rollback & UI DOM Hardening (Tier 5)', () => {
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

    const seedRes = await api('/api/solutions', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Baseline Attested Solution',
        business_problem: 'Seed initial attestation for adversarial suite',
        requesting_unit: 'Security',
        owner_name: 'Marcus Chen',
        owner_remit: 'Risk',
        risk_tier: 'LOW',
      }),
    });
    expect(seedRes.status).toBe(201);
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

  describe('1. Pinned 1,312-Byte ML-DSA-44 Key & Signature Forgery Rejection', () => {
    it('pins the exact 1,312-byte production BitBop ML-DSA-44 public key and rejects unknown key_id', () => {
      const pubKeyBytes = Buffer.from(DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64, 'base64');
      expect(pubKeyBytes.length).toBe(1312);

      const untrustedCheck = verifyLocalMlDsa44ReceiptSignature({
        key_id: 'mldsa44-rogue-2099',
        signature_scheme: 'ml-dsa-44',
        signature: `mldsa44:${'aa'.repeat(2420)}`,
      });
      expect(untrustedCheck.valid).toBe(false);
      expect(untrustedCheck.reason).toMatch(/Untrusted or unknown release key_id/i);
    });

    it('rejects a FORGED signature both locally (local_mldsa44_signature_valid: false) and remotely even if beacon_sequence is cached', async () => {
      const { status: listStatus, body: attestations } = await api<BitBopReceipt[]>('/api/attestations');
      expect(listStatus).toBe(200);
      expect(Array.isArray(attestations)).toBe(true);
      expect(attestations.length).toBeGreaterThan(0);

      const genuineAttestation = attestations[0];
      const targetSequence = genuineAttestation.beacon_sequence;
      expect(typeof targetSequence).toBe('number');

      const forgedReceipt = {
        event_type: 'TAMPERED_GOVERNANCE_DECISION',
        beacon_sequence: targetSequence,
        signature: 'mldsa44:0000000000000000000000000000000000000000000000000000000000000000',
        signature_scheme: 'ml-dsa-44',
      };

      const { status: verifyStatus, body: verifyResult } = await api<VerificationResult>(
        '/api/attestations/verify',
        {
          method: 'POST',
          body: JSON.stringify(forgedReceipt),
        }
      );

      expect(verifyStatus).toBe(200);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.checks?.local_mldsa44_signature_valid).toBe(false);
      expect(verifyResult.checks?.receipt_signature_valid).toBe(false);
    });

    it('rejects a 1-byte bit-flipped 2,420-byte ML-DSA-44 signature on an otherwise intact receipt', async () => {
      const { body: attestations } = await api<BitBopReceipt[]>('/api/attestations');
      const genuine = JSON.parse(JSON.stringify(attestations[0])) as BitBopReceipt;
      const cleanHex = genuine.signature.replace(/^mldsa44:/i, '');
      expect(Buffer.from(cleanHex, 'hex').length).toBe(2420);

      const lastByte = parseInt(cleanHex.slice(-2), 16);
      const flippedHex = cleanHex.slice(0, -2) + ((lastByte ^ 0xff) & 0xff).toString(16).padStart(2, '0');
      genuine.signature = `mldsa44:${flippedHex}`;

      const { status, body } = await api<VerificationResult>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(genuine),
      });

      expect(status).toBe(200);
      expect(body.valid).toBe(false);
      expect(body.checks?.local_mldsa44_signature_valid).toBe(false);
      expect(body.checks?.receipt_signature_valid).toBe(false);
    });

    it('rejects verification when beacon_sequence is unknown/corrupted', async () => {
      const corruptReceipt = {
        event_type: 'INVALID_EVENT',
        beacon_sequence: 999999999,
        signature: 'mldsa44:deadbeef00000000000000000000000000000000000000000000',
        signature_scheme: 'ml-dsa-44',
      };

      const { status, body } = await api<VerificationResult>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(corruptReceipt),
      });

      expect(status).toBe(200);
      expect(body.valid).toBe(false);
      expect(body.checks?.beacon_exists).toBe(false);
      expect(body.checks?.local_mldsa44_signature_valid).toBe(false);
    });
  });

  describe('2. Real ML-KEM-768 + AES-256-GCM Decapsulation & Ciphertext Integrity', () => {
    it('rejects AES-GCM ciphertext shorter than 16-byte authentication tag and invalid ML-KEM-768 ciphertext', async () => {
      const shortCipherBuf = Buffer.from('deadbeef', 'hex');
      const authTag = shortCipherBuf.subarray(shortCipherBuf.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12));
      decipher.setAuthTag(authTag);
      expect(() => decipher.final()).toThrow();

      const kem = new MlKem768();
      const [, secretKey] = await kem.generateKeyPair();
      try {
        await expect(kem.decap(Buffer.from('aabbccdd', 'hex'), secretKey)).rejects.toThrow();
      } finally {
        secretKey.fill(0);
      }
      expect(secretKey.every((b) => b === 0)).toBe(true);
    });

    it('fails closed with HTTP 503 and rolls back SQLite when /consume AES-256-GCM ciphertext or entropy_sha256 is corrupted in transit', async () => {
      if (bitbopNode?.isLive) return;

      const beforeSolutions = (await api<unknown[]>('/api/solutions')).body.length;
      const beforeAttestations = (await api<unknown[]>('/api/attestations')).body.length;

      bitbopNode!.setFaultMode('corrupt_consume_ciphertext');
      try {
        const resCipherTamper = await api<{ error: string; reason: string }>('/api/solutions', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Ciphertext Tamper Rollback Test',
            business_problem: 'Must reject corrupted AES-256-GCM tag during ML-KEM-768 decapsulation',
            requesting_unit: 'Cryptography',
            owner_name: 'Alex Zhao',
            owner_remit: 'Security',
            risk_tier: 'HIGH',
          }),
        });
        expect(resCipherTamper.status).toBe(503);
        expect(resCipherTamper.body.error).toBe(
          'Quantum governance attestation failed; state change rolled back'
        );

        bitbopNode!.setFaultMode('corrupt_consume_entropy_hash');
        const resHashTamper = await api<{ error: string; reason: string }>('/api/solutions', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Entropy SHA256 Mismatch Rollback Test',
            business_problem: 'Must reject mismatched entropy_sha256 after ML-KEM-768 decapsulation',
            requesting_unit: 'Cryptography',
            owner_name: 'Alex Zhao',
            owner_remit: 'Security',
            risk_tier: 'HIGH',
          }),
        });
        expect(resHashTamper.status).toBe(503);
        expect(resHashTamper.body.reason).toMatch(/SHA-256 mismatch/i);
      } finally {
        bitbopNode!.setFaultMode('none');
      }

      const afterSolutions = (await api<unknown[]>('/api/solutions')).body.length;
      const afterAttestations = (await api<unknown[]>('/api/attestations')).body.length;
      expect(afterSolutions).toBe(beforeSolutions);
      expect(afterAttestations).toBe(beforeAttestations);
    });
  });

  describe('3. Transactional Fail-Closed Governance Attestation & SQLite Rollback', () => {
    it('GET /api/bitbop/status reports provisioned post-quantum client state', async () => {
      const { status, body } = await api<Record<string, unknown>>('/api/bitbop/status');
      expect(status).toBe(200);
      expect(body.initialized).toBe(true);
      expect(body.provisioned).toBe(true);
      expect(typeof body.key_prefix).toBe('string');
      expect((body.key_prefix as string).startsWith('bb_')).toBe(true);
    });

    it('fails closed with HTTP 503 and rolls back SQLite on both POST /api/solutions and PATCH /api/solutions/:id/stage when BitBop /consume returns 503 or invalid ML-DSA-44 signature', async () => {
      if (bitbopNode?.isLive) return;

      // Create a valid Stage 1 solution while BitBop is healthy
      const healthyCreate = await api<{ id: string; lifecycle_stage: number; entity_version: number }>(
        '/api/solutions',
        {
          method: 'POST',
          body: JSON.stringify({
            title: 'Rollback Anchor Solution',
            business_problem: 'Verify stage advance rolls back when BitBop fails',
            requesting_unit: 'Cyber Security',
            owner_name: 'Marcus Chen',
            owner_remit: 'Risk',
            risk_tier: 'LOW',
          }),
        }
      );
      expect(healthyCreate.status).toBe(201);
      const anchorId = healthyCreate.body.id;

      const baselineSolutionsCount = (await api<unknown[]>('/api/solutions')).body.length;
      const baselineAttestationsCount = (await api<unknown[]>('/api/attestations')).body.length;

      // Case A: BitBop /consume returns HTTP 503 Service Unavailable
      bitbopNode!.setFaultMode('consume_503');
      try {
        const failedCreate = await api<{ error: string; reason: string }>('/api/solutions', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Must Never Persist Unattested Solution',
            business_problem: 'Should roll back on BitBop 503',
            requesting_unit: 'Cyber Security',
            owner_name: 'Security Challenger',
            owner_remit: 'Adversarial Assurance',
            risk_tier: 'LOW',
          }),
        });
        expect(failedCreate.status).toBe(503);
        expect(failedCreate.body.error).toBe(
          'Quantum governance attestation failed; state change rolled back'
        );

        const failedStageAdvance = await api<{ error: string; reason: string }>(
          `/api/solutions/${anchorId}/stage`,
          {
            method: 'PATCH',
            body: JSON.stringify({ target_stage: 2 }),
          }
        );
        expect(failedStageAdvance.status).toBe(503);

        // Verify SQLite rolled back completely: no phantom solution, anchor still at stage 1 & v1
        const solutionsAfter503 = await api<Array<{ id: string; title: string }>>('/api/solutions');
        expect(solutionsAfter503.body.length).toBe(baselineSolutionsCount);
        expect(
          solutionsAfter503.body.some((s) => s.title === 'Must Never Persist Unattested Solution')
        ).toBe(false);

        const anchorAfter503 = await api<{ lifecycle_stage: number; entity_version: number }>(
          `/api/solutions/${anchorId}`
        );
        expect(anchorAfter503.body.lifecycle_stage).toBe(1);
        expect(anchorAfter503.body.entity_version).toBe(1);

        // Case B: BitBop /consume returns HTTP 200 with a forged/corrupted ML-DSA-44 signature
        bitbopNode!.setFaultMode('corrupt_consume_signature');
        const failedForgedSig = await api<{ error: string; reason: string }>('/api/solutions', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Forged Signature Must Roll Back',
            business_problem: 'Local pinned ML-DSA-44 verifier must reject before commit',
            requesting_unit: 'Cyber Security',
            owner_name: 'Security Challenger',
            owner_remit: 'Adversarial Assurance',
            risk_tier: 'HIGH',
          }),
        });
        expect(failedForgedSig.status).toBe(503);
        expect(failedForgedSig.body.reason).toMatch(/ML-DSA-44/i);

        expect((await api<unknown[]>('/api/solutions')).body.length).toBe(baselineSolutionsCount);
        expect((await api<unknown[]>('/api/attestations')).body.length).toBe(
          baselineAttestationsCount
        );
      } finally {
        bitbopNode!.setFaultMode('none');
      }

      // Confirm recovery once BitBop is healthy again
      const recoveredAdvance = await api<{ lifecycle_stage: number; entity_version: number }>(
        `/api/solutions/${anchorId}/stage`,
        {
          method: 'PATCH',
          body: JSON.stringify({ target_stage: 2 }),
        }
      );
      expect(recoveredAdvance.status).toBe(200);
      expect(recoveredAdvance.body.lifecycle_stage).toBe(2);
      expect(recoveredAdvance.body.entity_version).toBe(2);
    });
  });

  describe('4. Real VerificationModal.tsx Component DOM Rendering Contract', () => {
    it('renders VERIFICATION FAILED, exact SQLite tamper reason, Historical Governance Snapshot Match: FAIL, and version badge in real DOM', async () => {
      // 1. Create a genuine attested Solution and tamper its SQLite row in-place
      const { status: createStatus, body: created } = await api<{ id: string }>('/api/solutions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Modal DOM Tamper Target',
          business_problem: 'End-to-end SQLite tamper -> verifyReceipt -> VerificationModal DOM test',
          requesting_unit: 'Audit',
          owner_name: 'Elena Rostova',
          owner_remit: 'Governance',
          risk_tier: 'HIGH',
        }),
      });
      expect(createStatus).toBe(201);

      const { body: attestations } = await api<BitBopReceipt[]>('/api/attestations');
      const v1Receipt = attestations.find(
        (a) => a.entity_id === created.id && a.event_type === 'SOLUTION_REQUESTED'
      )!;
      expect(v1Receipt).toBeDefined();

      getDb()
        .prepare('UPDATE solutions SET title = ? WHERE id = ?')
        .run('SILENT_DB_TAMPER_FOR_MODAL_TEST', created.id);

      const { status: verifyStatus, body: verifyResult } = await api<VerificationResult>(
        '/api/attestations/verify',
        {
          method: 'POST',
          body: JSON.stringify(v1Receipt),
        }
      );
      expect(verifyStatus).toBe(200);
      expect(verifyResult.valid).toBe(false);

      // 2. Render the actual VerificationModal React component with the real verifyReceipt output
      let closeClicked = false;
      const view = renderVerificationModalDom({
        isOpen: true,
        onClose: () => {
          closeClicked = true;
        },
        receipt: v1Receipt,
        result: verifyResult,
        loading: false,
      });

      try {
        const text = view.container.textContent || '';
        expect(text).toContain('✗ VERIFICATION FAILED');
        expect(text).toContain('valid: false');
        expect(text).toContain('Entity record tampered in-place without governance attestation');
        expect(text).toContain('Historical Governance Snapshot Match: FAIL');
        expect(text).toContain('Local Pinned ML-DSA-44 Lattice Signature: PASS');
        expect(text).toContain('Attested v1 -> Current v1');
        expect(text).toContain('Tampered In-Place');

        const reasonEl = view.container.querySelector('[data-testid="verification-failure-reason"]');
        expect(reasonEl).not.toBeNull();
        expect(reasonEl!.textContent).toContain(
          'Entity record tampered in-place without governance attestation'
        );

        const closeBtn = Array.from(view.container.querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === 'Close'
        );
        expect(closeBtn).toBeDefined();
        act(() => {
          closeBtn!.click();
        });
        expect(closeClicked).toBe(true);
      } finally {
        view.unmount();
      }
    });

    it('renders Local Pinned ML-DSA-44 Lattice Signature: FAIL and safe Provenance fallback URL when beacon_sequence is missing', () => {
      const malformedReceipt = {
        event_type: 'SOLUTION_REQUESTED',
        beacon_sequence: undefined as unknown as number,
        signature: 'mldsa44:0000',
      } as BitBopReceipt;

      const failedSigResult: VerificationResult = {
        valid: false,
        reason: 'Local pinned ML-DSA-44 lattice signature verification failed',
        checks: {
          beacon_exists: false,
          beacon_hash_match: false,
          beacon_signature_valid: false,
          entropy_bound_to_beacon: false,
          receipt_signature_valid: false,
          local_mldsa44_signature_valid: false,
          historical_snapshot_match: false,
        },
      };

      const view = renderVerificationModalDom({
        isOpen: true,
        receipt: malformedReceipt,
        result: failedSigResult,
        loading: false,
      });

      try {
        const text = view.container.textContent || '';
        expect(text).toContain('✗ VERIFICATION FAILED');
        expect(text).toContain('Local pinned ML-DSA-44 lattice signature verification failed');
        expect(text).toContain('Local Pinned ML-DSA-44 Lattice Signature: FAIL');
        expect(text).toContain('Historical Governance Snapshot Match: FAIL');

        const explorerLink = view.container.querySelector('a[href*="bitbop.dev/provenance"]');
        expect(explorerLink).not.toBeNull();
        expect(explorerLink!.getAttribute('href')).toBe('https://www.bitbop.dev/provenance');
      } finally {
        view.unmount();
      }
    });
  });

  describe('5. Scenario A01 — Historical Snapshot Verification vs. In-Place SQLite Tampering ([S4])', () => {
    it('A01.1: Advancing a Solution from Stage 1 (v1) to Stage 2 (v2) via normal API preserves valid: true on the v1 receipt with current_entity_state.matches_snapshot: false', async () => {
      const { status: createStatus, body: created } = await api<any>('/api/solutions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'A01 Lifecycle Drift Solution',
          business_problem: 'Validate historical v1 snapshot verification across normal lifecycle updates',
          requesting_unit: 'Risk & Compliance',
          owner_name: 'Marcus Chen',
          owner_remit: 'Enterprise Risk',
          risk_tier: 'MEDIUM',
        }),
      });
      expect(createStatus).toBe(201);
      expect(created.id).toBeTruthy();
      expect(created.lifecycle_stage).toBe(1);
      expect(created.entity_version).toBe(1);

      const { status: attStatus, body: attestations } = await api<any[]>('/api/attestations');
      expect(attStatus).toBe(200);
      const v1Receipt = attestations.find(
        (a) => a.entity_id === created.id && a.event_type === 'SOLUTION_REQUESTED' && a.entity_version === 1
      );
      expect(v1Receipt).toBeDefined();

      const { status: v1InitialStatus, body: v1InitialVerify } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(v1Receipt),
      });
      expect(v1InitialStatus).toBe(200);
      expect(v1InitialVerify.valid).toBe(true);
      expect(v1InitialVerify.checks?.local_mldsa44_signature_valid).toBe(true);
      expect(v1InitialVerify.checks?.historical_snapshot_match).toBe(true);
      expect(v1InitialVerify.current_entity_state).toEqual({
        exists: true,
        matches_snapshot: true,
        attested_entity_version: 1,
        current_entity_version: 1,
      });

      const { status: stageStatus, body: updated } = await api<any>(`/api/solutions/${created.id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ target_stage: 2 }),
      });
      expect(stageStatus).toBe(200);
      expect(updated.lifecycle_stage).toBe(2);
      expect(updated.entity_version).toBe(2);

      const { status: v1AfterAdvanceStatus, body: v1AfterAdvanceVerify } = await api<any>(
        '/api/attestations/verify',
        {
          method: 'POST',
          body: JSON.stringify(v1Receipt),
        }
      );
      expect(v1AfterAdvanceStatus).toBe(200);
      expect(v1AfterAdvanceVerify.valid).toBe(true);
      expect(v1AfterAdvanceVerify.checks?.local_mldsa44_signature_valid).toBe(true);
      expect(v1AfterAdvanceVerify.checks?.historical_snapshot_match).toBe(true);
      expect(v1AfterAdvanceVerify.current_entity_state).toEqual({
        exists: true,
        matches_snapshot: false,
        attested_entity_version: 1,
        current_entity_version: 2,
      });
    });

    it('A01.2: Direct in-place SQLite tampering of solutions.title at v1 without governance attestation fails verification (valid: false)', async () => {
      const { status: createStatus, body: created } = await api<any>('/api/solutions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Untampered Solution Title v1',
          business_problem: 'Detect silent SQLite column mutation at same entity_version',
          requesting_unit: 'Internal Audit',
          owner_name: 'Elena Rostova',
          owner_remit: 'Governance Assurance',
          risk_tier: 'HIGH',
        }),
      });
      expect(createStatus).toBe(201);
      expect(created.entity_version).toBe(1);

      const { body: attestations } = await api<any[]>('/api/attestations');
      const v1Receipt = attestations.find(
        (a) => a.entity_id === created.id && a.event_type === 'SOLUTION_REQUESTED' && a.entity_version === 1
      );
      expect(v1Receipt).toBeDefined();

      getDb()
        .prepare('UPDATE solutions SET title = ? WHERE id = ?')
        .run('SILENTLY_TAMPERED_SQLITE_TITLE', created.id);

      const { status: verifyStatus, body: verifyResult } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(v1Receipt),
      });
      expect(verifyStatus).toBe(200);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.checks?.historical_snapshot_match).toBe(false);
      expect(verifyResult.tampered_in_place).toBe(true);
      expect(verifyResult.reason).toBe('Entity record tampered in-place without governance attestation');
      expect(verifyResult.current_entity_state).toEqual({
        exists: true,
        matches_snapshot: false,
        attested_entity_version: 1,
        current_entity_version: 1,
      });
    });

    it('A01.3: Rejects unattested entity_version bump in SQLite, forged receipt ID with valid beacon_sequence, and mismatched raw_receipt.attestation.context_hash', async () => {
      const { status: createStatus, body: created } = await api<any>('/api/solutions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'A01.3 Hardened Verification Target',
          business_problem: 'Detect unattested version bumps and receipt ID / raw context_hash spoofing',
          requesting_unit: 'Security Engineering',
          owner_name: 'Alex Zhao',
          owner_remit: 'Cyber Security',
          risk_tier: 'HIGH',
        }),
      });
      expect(createStatus).toBe(201);

      const { body: attestations } = await api<any[]>('/api/attestations');
      const v1Receipt = attestations.find(
        (a) => a.entity_id === created.id && a.event_type === 'SOLUTION_REQUESTED' && a.entity_version === 1
      );
      expect(v1Receipt).toBeDefined();

      // (a) Forged receipt.id with valid beacon_sequence falls back to sequence lookup and detects ID mismatch
      const spoofedIdReceipt = {
        ...v1Receipt,
        id: '00000000-0000-0000-0000-000000000000',
      };
      const { body: idMismatchResult } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(spoofedIdReceipt),
      });
      expect(idMismatchResult.valid).toBe(false);
      expect(idMismatchResult.checks?.historical_snapshot_match).toBe(false);
      expect(idMismatchResult.reason).toBe('Receipt ID does not match stored attestation record');

      // (b) Mismatched raw_receipt.attestation.context_hash is rejected
      const tamperedRawReceipt = JSON.parse(JSON.stringify(v1Receipt));
      if (tamperedRawReceipt.raw_receipt?.attestation) {
        tamperedRawReceipt.raw_receipt.attestation.context_hash = `sha256:${'f'.repeat(64)}`;
      }
      const { body: rawHashMismatchResult } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(tamperedRawReceipt),
      });
      expect(rawHashMismatchResult.valid).toBe(false);
      expect(rawHashMismatchResult.checks?.historical_snapshot_match).toBe(false);
      expect(rawHashMismatchResult.reason).toBe('Raw receipt context_hash does not match canonical snapshot digest');

      // (c) Direct SQLite tamper that increments entity_version = entity_version + 1 without an attestation record
      getDb()
        .prepare('UPDATE solutions SET title = ?, entity_version = entity_version + 1 WHERE id = ?')
        .run('TAMPERED_WITH_VERSION_BUMP', created.id);

      const { body: unattestedVersionResult } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(v1Receipt),
      });
      expect(unattestedVersionResult.valid).toBe(false);
      expect(unattestedVersionResult.checks?.historical_snapshot_match).toBe(false);
      expect(unattestedVersionResult.tampered_in_place).toBe(true);
      expect(unattestedVersionResult.reason).toBe('Entity version advanced without governance attestation');
    });

    it('A01.4: Submitting a Breach Remediation atomically attests both REMEDIATION v1 and resolved BREACH v2 so historical BREACH v1 receipt remains valid', async () => {
      const breachRes = await api<any>('/api/governance/breaches', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Canary Drift Incident',
          severity: 'HIGH',
          affected_entity_type: 'SOLUTION',
          affected_entity_id: 'sol-claims-triage-01',
          description: 'Latency spike and hallucination edge case detected',
          reported_by: 'Jordan Bell',
        }),
      });
      expect(breachRes.status).toBe(201);
      const breach = breachRes.body;
      expect(breach.attestation).toBeDefined();

      const remRes = await api<any>('/api/governance/remediations', {
        method: 'POST',
        body: JSON.stringify({
          breach_id: breach.id,
          remediation_summary: 'Deployed strict schema output guard and fallback circuit breaker',
          verified_by: 'Elena Rostova',
        }),
      });
      expect(remRes.status).toBe(201);
      expect(remRes.body.attestation).toBeDefined();

      // Historical v1 breach receipt must still verify as valid: true (because v2 transition was attested!)
      const verifyBreachV1 = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(breach.attestation),
      });
      expect(verifyBreachV1.status).toBe(200);
      expect(verifyBreachV1.body.valid).toBe(true);
      expect(verifyBreachV1.body.checks?.historical_snapshot_match).toBe(true);
      expect(verifyBreachV1.body.checks?.local_mldsa44_signature_valid).toBe(true);
      expect(verifyBreachV1.body.current_entity_state).toEqual({
        exists: true,
        matches_snapshot: false,
        attested_entity_version: 1,
        current_entity_version: 2,
      });
    });
  });
});
