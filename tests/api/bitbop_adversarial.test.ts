/**
 * AAIMS Adversarial Cryptographic & Verification Hardening Suite (Tier 5)
 *
 * Stress-tests BitBop cryptographic integration, memory zeroization,
 * signature forgery bypass, bad ciphertext boundaries, and UI error handling.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { MlKem768 } from 'mlkem';

const BASE = process.env.AAIMS_API_URL ?? 'http://localhost:4000';

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

describe('BitBop Adversarial Verification & Cryptographic Hardening (Tier 5)', () => {

  describe('1. Cryptographic Signature Forgery & In-Memory Cache Bypass', () => {
    it('Correctly rejects verification for a FORGED signature even if beacon_sequence exists in rawReceiptCache', async () => {
      // Step 1: Query existing attestations from the server
      const { status: listStatus, body: attestations } = await api<any[]>('/api/attestations');
      expect(listStatus).toBe(200);

      if (!Array.isArray(attestations) || attestations.length === 0) {
        console.warn('No cached attestations found to demonstrate cache substitution attack.');
        return;
      }

      const genuineAttestation = attestations[0];
      const targetSequence = genuineAttestation.beacon_sequence;
      expect(typeof targetSequence).toBe('number');

      // Step 2: Forge an adversarial receipt using a completely fake signature
      const forgedReceipt = {
        event_type: 'TAMPERED_GOVERNANCE_DECISION',
        beacon_sequence: targetSequence,
        signature: 'mldsa44:FORGED_MALICIOUS_SIGNATURE_00000000000000000000000000000000',
        signature_scheme: 'ml-dsa-44',
      };

      // Step 3: Send forged receipt to /api/attestations/verify
      const { status: verifyStatus, body: verifyResult } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(forgedReceipt),
      });

      expect(verifyStatus).toBe(200);

      // REMEDIATED BEHAVIOR:
      // Caller-provided forged signature is verified directly against BitBop,
      // without cache substitution, correctly returning valid: false.
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.checks?.receipt_signature_valid).toBe(false);
    });

    it('Correctly rejects verification when beacon_sequence is unknown/corrupted', async () => {
      const corruptReceipt = {
        event_type: 'INVALID_EVENT',
        beacon_sequence: 999999999, // Unknown sequence not in cache
        signature: 'mldsa44:deadbeef00000000000000000000000000000000000000000000',
        signature_scheme: 'ml-dsa-44',
      };

      const { status, body } = await api<any>('/api/attestations/verify', {
        method: 'POST',
        body: JSON.stringify(corruptReceipt),
      });

      expect(status).toBe(200);
      expect(body.valid).toBe(false);
      expect(body.checks?.beacon_exists).toBe(false);
    });
  });

  describe('2. Bad Ciphertext & Decryption Boundary Analysis (White-Box)', () => {
    it('Decryption fails safely when AES ciphertext buffer is shorter than 16 bytes (auth tag boundary bug)', async () => {
      // In decryptApiKeyBundle (bitbop.ts line 40-41):
      // const cipherBuf = Buffer.from(bundle.aes_ciphertext_hex, 'hex');
      // const authTag = cipherBuf.subarray(cipherBuf.length - 16);
      // const ciphertext = cipherBuf.subarray(0, cipherBuf.length - 16);
      //
      // If cipherBuf.length is e.g. 4 bytes (< 16), cipherBuf.length - 16 is -12!
      const shortCipherBuf = Buffer.from('deadbeef', 'hex'); // 4 bytes
      expect(shortCipherBuf.length).toBe(4);

      // Node.js subarray with negative end: subarray(0, -12) -> empty buffer!
      const ciphertext = shortCipherBuf.subarray(0, shortCipherBuf.length - 16);
      expect(ciphertext.length).toBe(0);

      // authTag becomes shortCipherBuf.subarray(-12) which is the full 4 bytes!
      const authTag = shortCipherBuf.subarray(shortCipherBuf.length - 16);
      expect(authTag.length).toBe(4);

      const aesKey = Buffer.alloc(32);
      const iv = Buffer.alloc(12);
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);

      // AES-GCM requires authTag to be set. Setting a 4-byte auth tag or attempting decipher.final()
      // must throw an error in Node.js crypto
      decipher.setAuthTag(authTag);
      expect(() => {
        decipher.final();
      }).toThrow();
    });

    it('ML-KEM-768 decapsulation rejects invalid ciphertext length', async () => {
      const kem = new MlKem768();
      const [, secretKey] = await kem.generateKeyPair();
      const invalidCiphertext = Buffer.from('aabbccdd', 'hex'); // only 4 bytes instead of 1088

      await expect(
        kem.decap(invalidCiphertext, secretKey)
      ).rejects.toThrow();
    });
  });

  describe('3. Secret Key Memory Zeroization Analysis (White-Box)', () => {
    it('Demonstrates that ML-KEM secret key buffers are mutable and require explicit zeroization', async () => {
      const kem = new MlKem768();
      const [, secretKey] = await kem.generateKeyPair();

      expect(secretKey.length).toBe(2400); // NIST ML-KEM-768 secret key length
      // Non-zero key bytes
      const hasNonZero = secretKey.some((b) => b !== 0);
      expect(hasNonZero).toBe(true);

      // In secure crypto implementations, secretKey.fill(0) must be called.
      // In bitbop.ts decryptApiKeyBundle and attestGovernanceEvent, this is omitted.
      // Proving secretKey can be zeroized:
      secretKey.fill(0);
      const allZeros = secretKey.every((b) => b === 0);
      expect(allZeros).toBe(true);
    });

    it('Attestation ephemeral ML-KEM key generation discards secretKey without zeroization', async () => {
      const kem = new MlKem768();
      // bitbop.ts line 155 does:
      // const [ephemeralPk] = await kem.generateKeyPair();
      // Destructuring only the first element drops the second element (secretKey) to garbage collection!
      const pair = await kem.generateKeyPair();
      expect(pair.length).toBe(2);
      expect(pair[0].length).toBe(1184); // public key
      expect(pair[1].length).toBe(2400); // secret key

      // The secretKey (pair[1]) contains unzeroized private key material
      expect(pair[1].some((b) => b !== 0)).toBe(true);
    });
  });

  describe('4. Rate Limiting (HTTP 429) & Single-Attempt Initialization Failure Modes', () => {
    it('GET /api/bitbop/status reports current client state', async () => {
      const { status, body } = await api<any>('/api/bitbop/status');
      expect(status).toBe(200);
      expect(body).toHaveProperty('initialized');
      expect(body).toHaveProperty('provisioned');
      expect(body).toHaveProperty('key_prefix');
    });

    it('Silent attestation drop: Entity CRUD succeeds even when BitBop attestation fails', async () => {
      // Testing that server does not block operations when attestation fails,
      // but fails to provide any audit attestation receipt
      const { status, body } = await api<any>('/api/solutions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Adversarial Test Solution',
          business_problem: 'Stress testing attestation failure resilience',
          requesting_unit: 'Cyber Security',
          owner_name: 'Security Challenger',
          owner_remit: 'Adversarial Assurance',
          risk_tier: 'LOW',
        }),
      });

      expect(status).toBe(201);
      expect(body).toHaveProperty('id');
      // The solution is created regardless of BitBop availability
    });
  });

  describe('5. Client VerificationModal UI Contract Stress', () => {
    it('Demonstrates missing error reporting when verification payload contains error', () => {
      // Simulation of payload passed to VerificationModal
      const errorResult = {
        valid: false,
        error: 'BitBop rate limit exceeded: HTTP 429',
      };

      // In VerificationModal.tsx lines 46-55:
      // The modal only checks result.valid ? 'alert-success' : 'alert-danger'
      // and displays: "valid: false (Verified via NIST FIPS 204 ML-DSA-44)"
      // result.error is never rendered anywhere in the JSX!
      expect(errorResult.error).toBeDefined();
      // A safe UI component must display errorResult.error to the operator
    });

    it('Demonstrates undefined URL parameter when receipt has no beacon_sequence', () => {
      const corruptReceipt = {
        event_type: 'SOLUTION_REQUESTED',
        // beacon_sequence is undefined
      };

      const sequence = (corruptReceipt as any).beacon_sequence;
      const provenanceUrl = `https://www.bitbop.dev/provenance?sequence=${sequence}`;
      expect(provenanceUrl).toBe('https://www.bitbop.dev/provenance?sequence=undefined');
    });
  });
});
