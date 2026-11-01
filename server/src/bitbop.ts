import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MlKem768 } from 'mlkem';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import type { BitBopReceipt, CanonicalSnapshot } from './types.js';
import {
  getAttestationRecordById,
  getAttestationRecordBySequence,
  getLiveEntityByTypeAndId,
  hasAttestationForEntityVersion,
} from './db.js';

const DEFAULT_BITBOP_API = 'https://api.bitbop.dev';
export const DEFAULT_RELEASE_KEY_ID = 'mldsa44-release-2026-01';

/**
 * Pinned 1,312-byte NIST FIPS 204 ML-DSA-44 public key for BitBop release key mldsa44-release-2026-01.
 */
export const DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64 =
  'b/PZgJYkdUHwJR0atxQ3Y5T7+rDwduRkNvjWG+rforWt7ZXCneaBl8PMboHL4RXhuRseHUPyK2ojx1ICxsv9e/qTAmDmrgh3r14dEiNURvOwOmnMJ15xfrF1757kCB1yTSFzqFMnWVoIQaiiZ+LgtObgiih2RffwsWgLGGI1RRakvmwPv3WzBjl6pP59JWOlI4HxSxPLhCtrEbhYgjrafPPNHr+BlpjlHa6V0/FXO8O+vsMcQ4bfg8WD4JqLYg6dn8XZnXWCOZwk0MQqd7lZvMJVx6yUdJHbNbekNr2MOahGi5Zi1ooI1HWXX5BBA9LNSC8MLGuPpHlXkJFkm/TLwOtDgUGNBBaPEH6n1xUQ/jhjSqQM39Rh8EuLdRq8Z1SxpRuizgpkvG3DACGZDU3N19Id0O2wS6S506jaHZmGT7IINx2eNm2SGmCp+25XqZ9CX4yk9oHUO/N11J99qYMSlPfjsGZGOmlDXYfwxG2n9FQtQ7FOdtd1pXNUnQkU2NrgRZZYBjRdkwBIWzmY+Tv+oavixSrncN5e6QZOfK+Bth2eAHoKeS8kzQY3ewmW+j4Nsv6Yc97qCCabSqQicGBE9DJl9Chcg0iIoAp4j2KRMqCiTPLUnufcsW28lG3evjDp8ytAKDyOCK5hEg0vPOAEvdCRclPJqmygMLZZYyHJvuNiE5NO16rkbQSICD1Y3ttYro489o2eHTUvX1ecIIxy5Cc0oAnFKl1X/BGZpzp6rifA0zigdV/ZJdpY/xg/N3EykSnrGf6NuLGP/4fvTLregoiKPmcgiS/whBmn3YjxcLsJPUs9xwups31paQdwpl+mOtP4czSuvce9nu4vOqhjZxu9ik9ILTX9Ef2qqW/PDkMjT3jFqRvmm+XHhzYOneaWzeDqSmCsoG17qFyCxAjddjHWc+juy9R/5R7YQ8z0i6Z5BbTiP3BgYZzaEDTD3K6rN9xBMAwSotciQ6a/dvFbUIPcqX6jub8prUoe17wVdAfJ/h8xkdOhwwKvqcyMJ8cOMH4NUOBjZXeb5hHAx0i5We1T/qyrPzipz4qr//mTWaHjcUPTUfHqecm/PNUchIAG6LmOVgYU8HvkH/RvbPZVIEOXWtwHyAV1kAt2XJ6ne6acfXaVrmaeLr+wTxwkKml6Lj5ouTli9ExryZ9PwECw6cH/QOQEHudJtm+SuKUasLk4acLn3pTyX7vqpjyM0vO4hgnTtv8fxpNZ05G13L/iPYw1Dh/GxOhyOWBQRcMGkSYSEEYtD9rfq9myiXaCucNY9CCwIpPO++FE2auu5IkFZUPmzhebfVf5R8F+EY9AvwApb3+i3HItIcMRJ84wcOsNI8Ge1bKSoNl7VWWQmo8gO5jwd04OFIQvbH2zO1RaGJpLAIOLVAYCfdGTGg/ZrFXpX3k6xk//T+vBJlW4DBvXFpMOpXlOt+ain9fYeyYqnxtC1IzLmkj0E1T3g+xNVo++cOSrsidZagfa5DD1QmrZ+c0I90sFc9z0OCznaI/43ijg9hAdj3TzOpS6SnpsgLU2+BMadsuKO1szaPjDd6edHgdcIuheWBHZ++wfBJGfojoGL+Qbsm3KBTPKxW5VqB/MDKctiS4fQRpjPkUjMorVVVuxAfGHk4F2bV723ou2ek3HDFjQrisjzYjYuoO81sUaWQfpBqC6JkDqYcLg1RATvuA2NoYdukbw88mJQbD9Lq7i732xtyBRk2bgXtz3APnSEYWacZneqxT7/Qr8d9dWyQ==';

export const TRUSTED_RELEASE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  [DEFAULT_RELEASE_KEY_ID]: DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64,
});

const PINNED_PUBLIC_KEY_BYTES = Buffer.from(DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64, 'base64');
if (PINNED_PUBLIC_KEY_BYTES.length !== 1312) {
  throw new Error(
    `Invalid pinned ML-DSA-44 public key length for ${DEFAULT_RELEASE_KEY_ID}: expected 1312 bytes, got ${PINNED_PUBLIC_KEY_BYTES.length}`
  );
}

export { GOVERNANCE_EVENT_TYPES, type GovernanceEventType } from './types.js';

let apiKey: string | null = null;
let initialized = false;
let initializedApiBase: string | null = null;
let initError: string | null = null;

// In-memory cache of raw consume receipts keyed by beacon_sequence
const rawReceiptCache = new Map<number, Record<string, unknown>>();

export function getBitBopApiBase(): string {
  const raw = process.env.BITBOP_API_URL?.trim() || DEFAULT_BITBOP_API;
  return raw.replace(/\/+$/, '');
}

export function resetBitBopClient(): void {
  apiKey = null;
  initialized = false;
  initializedApiBase = null;
  initError = null;
}

export function sha256Context(payload: unknown): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

function sha256PrefixedUtf8(text: string): string {
  const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export function resolveTrustedMlDsa44PublicKey(
  declaredKeyId?: string | null
): { ok: true; keyId: string; publicKeyBytes: Uint8Array } | { ok: false; reason: string } {
  const effectiveKeyId =
    typeof declaredKeyId === 'string' && declaredKeyId.trim().length > 0
      ? declaredKeyId.trim()
      : DEFAULT_RELEASE_KEY_ID;

  if (!(effectiveKeyId in TRUSTED_RELEASE_KEYS)) {
    return {
      ok: false,
      reason: `Untrusted or unknown release key_id: ${effectiveKeyId}`,
    };
  }

  const envOverrideB64 = process.env.BITBOP_SERVICE_PUBLIC_KEY_MLDSA44_B64?.trim();
  if (envOverrideB64 && effectiveKeyId === DEFAULT_RELEASE_KEY_ID) {
    const overrideBytes = Buffer.from(envOverrideB64, 'base64');
    if (overrideBytes.length !== 1312) {
      throw new Error(
        `Invalid BITBOP_SERVICE_PUBLIC_KEY_MLDSA44_B64 length: expected 1312 bytes, got ${overrideBytes.length}`
      );
    }
    return {
      ok: true,
      keyId: effectiveKeyId,
      publicKeyBytes: new Uint8Array(overrideBytes),
    };
  }

  const b64 = TRUSTED_RELEASE_KEYS[effectiveKeyId];
  const decoded = Buffer.from(b64, 'base64');
  if (decoded.length !== 1312) {
    return {
      ok: false,
      reason: `Trusted release key ${effectiveKeyId} has invalid byte length (${decoded.length})`,
    };
  }

  return {
    ok: true,
    keyId: effectiveKeyId,
    publicKeyBytes: new Uint8Array(decoded),
  };
}

function verifyMlDsa44Detached(
  payloadText: string,
  signatureStr: string,
  publicKeyBytes: Uint8Array
): boolean {
  if (typeof signatureStr !== 'string' || signatureStr.trim().length === 0) {
    return false;
  }
  const cleanHex = signatureStr.trim().replace(/^mldsa44:/i, '');
  if (cleanHex.length === 0 || cleanHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleanHex)) {
    return false;
  }
  const sigBytes = Buffer.from(cleanHex, 'hex');
  // NIST FIPS 204 ML-DSA-44 detached signature is strictly 2,420 bytes
  if (sigBytes.length !== 2420) {
    return false;
  }
  try {
    const msgBytes = new TextEncoder().encode(payloadText);
    return ml_dsa44.verify(new Uint8Array(sigBytes), msgBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Verifies a BitBop receipt or /consume response locally against AAIMS's pinned
 * 1,312-byte ML-DSA-44 service public key without trusting a remote verifier alone.
 */
export function verifyLocalMlDsa44ReceiptSignature(
  receipt: Record<string, unknown>
): { valid: boolean; reason?: string } {
  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, reason: 'Malformed receipt payload' };
  }

  const att =
    receipt.attestation && typeof receipt.attestation === 'object'
      ? (receipt.attestation as Record<string, unknown>)
      : undefined;
  const output =
    receipt.output && typeof receipt.output === 'object'
      ? (receipt.output as Record<string, unknown>)
      : undefined;
  const evidence =
    receipt.evidence_receipt && typeof receipt.evidence_receipt === 'object'
      ? (receipt.evidence_receipt as Record<string, unknown>)
      : undefined;

  const declaredKeyId =
    (typeof receipt.key_id === 'string' ? receipt.key_id : undefined) ||
    (typeof att?.key_id === 'string' ? att.key_id : undefined) ||
    (typeof evidence?.key_id === 'string' ? evidence.key_id : undefined) ||
    DEFAULT_RELEASE_KEY_ID;

  const keyLookup = resolveTrustedMlDsa44PublicKey(declaredKeyId);
  if (!keyLookup.ok) {
    return { valid: false, reason: keyLookup.reason };
  }

  const scheme =
    (typeof output?.signature_scheme === 'string' ? output.signature_scheme : undefined) ||
    (typeof att?.signature_scheme === 'string' ? att.signature_scheme : undefined) ||
    (typeof receipt.signature_scheme === 'string' ? receipt.signature_scheme : undefined) ||
    (typeof receipt.delivery_signature_scheme === 'string' ? receipt.delivery_signature_scheme : undefined) ||
    'ml-dsa-44';

  if (scheme !== 'ml-dsa-44') {
    return {
      valid: false,
      reason: 'Classical Ed25519 receipt signatures are disabled; NIST FIPS 204 ML-DSA-44 required',
    };
  }

  const receiptSig =
    (typeof receipt.signature === 'string' ? receipt.signature : undefined) ||
    (typeof att?.signature === 'string' ? att.signature : undefined) ||
    (typeof receipt.delivery_signature === 'string' ? receipt.delivery_signature : undefined);

  if (!receiptSig) {
    return { valid: false, reason: 'Missing ML-DSA-44 receipt signature' };
  }

  let sigValid = false;

  // Case A: Receipt signed over receipt_hash (/order format)
  if (typeof receipt.receipt_hash === 'string' && receipt.receipt_hash.length > 0) {
    const rcptForHash: Record<string, unknown> = { ...receipt };
    delete rcptForHash.receipt_hash;
    delete rcptForHash.signature;
    delete rcptForHash.disclosed_entropy_hex;
    const computedHash = sha256PrefixedUtf8(JSON.stringify(rcptForHash)).replace(/^sha256:/i, '');
    const cleanDeclared = receipt.receipt_hash.replace(/^sha256:/i, '');
    if (computedHash !== cleanDeclared) {
      return { valid: false, reason: 'Receipt content hash mismatch (tampered canonical payload)' };
    }
    sigValid = verifyMlDsa44Detached(receipt.receipt_hash, receiptSig, keyLookup.publicKeyBytes);
  }

  // Case B: Delivery attestation payload (/consume format: JSON.stringify(cipher) + JSON.stringify(attWithoutSig))
  if (!sigValid && att && typeof att.signature === 'string') {
    const attCopy: Record<string, unknown> = { ...att };
    delete attCopy.signature;
    const cipherPrefix =
      receipt.cipher && typeof receipt.cipher === 'object' ? JSON.stringify(receipt.cipher) : '';
    const sigToCheck = typeof receipt.signature === 'string' ? receipt.signature : att.signature;
    sigValid = verifyMlDsa44Detached(
      cipherPrefix + JSON.stringify(attCopy),
      sigToCheck,
      keyLookup.publicKeyBytes
    );
  }

  // Case C: Delivery-only v2 response
  if (
    !sigValid &&
    !receipt.signature &&
    typeof receipt.delivery_signature === 'string' &&
    typeof evidence?.signature === 'string'
  ) {
    const deliveryPayload = {
      delivery_version: receipt.delivery_version ?? 2,
      escrow_id: receipt.escrow_id,
      escrow_profile: receipt.escrow_profile || 'bitbop-platform-v1',
      claim_id: receipt.claim_id,
      cipher: receipt.cipher,
      sealed_envelope: receipt.sealed_envelope || null,
      evidence_receipt_signature: evidence.signature,
    };
    sigValid = verifyMlDsa44Detached(
      JSON.stringify(deliveryPayload),
      receipt.delivery_signature,
      keyLookup.publicKeyBytes
    );
  }

  // Case D: Canonical JSON receipt minus signature
  if (!sigValid && typeof receipt.signature === 'string' && !att) {
    const rcptCopy: Record<string, unknown> = { ...receipt };
    delete rcptCopy.signature;
    delete rcptCopy.disclosed_entropy_hex;
    delete rcptCopy.entropy_hex;
    delete rcptCopy.unsealed_bytes;
    delete rcptCopy.unsealed_text;
    sigValid = verifyMlDsa44Detached(
      JSON.stringify(rcptCopy),
      receipt.signature,
      keyLookup.publicKeyBytes
    );
  }

  if (!sigValid) {
    return {
      valid: false,
      reason: 'Local pinned ML-DSA-44 lattice signature verification failed',
    };
  }

  return { valid: true };
}

interface MlKemAesGcmCipherBundle {
  kyber_ciphertext_hex: string;
  aes_iv_hex: string;
  aes_ciphertext_hex: string;
}

async function decryptCipherBundleBytes(
  bundle: MlKemAesGcmCipherBundle,
  secretKey: Uint8Array
): Promise<Buffer> {
  if (
    !bundle ||
    typeof bundle.kyber_ciphertext_hex !== 'string' ||
    typeof bundle.aes_iv_hex !== 'string' ||
    typeof bundle.aes_ciphertext_hex !== 'string' ||
    !bundle.kyber_ciphertext_hex ||
    !bundle.aes_iv_hex ||
    !bundle.aes_ciphertext_hex
  ) {
    throw new Error('Missing or malformed ML-KEM-768 + AES-256-GCM cipher bundle');
  }

  const kem = new MlKem768();
  let sharedSecret: Uint8Array | null = null;
  let aesKey: Buffer | null = null;
  try {
    sharedSecret = await kem.decap(
      Buffer.from(bundle.kyber_ciphertext_hex, 'hex'),
      secretKey
    );
    aesKey = Buffer.from(sharedSecret);
    if (aesKey.length !== 32) {
      throw new Error(`Invalid ML-KEM-768 decapsulated key length: ${aesKey.length} bytes`);
    }
    const iv = Buffer.from(bundle.aes_iv_hex, 'hex');
    if (iv.length !== 12) {
      throw new Error(`Invalid AES-256-GCM IV length: ${iv.length} bytes (expected 12)`);
    }
    const cipherBuf = Buffer.from(bundle.aes_ciphertext_hex, 'hex');
    if (cipherBuf.length < 16) {
      throw new Error(
        `Invalid ciphertext buffer length: ${cipherBuf.length} bytes (must be at least 16 bytes for GCM auth tag)`
      );
    }
    const authTag = cipherBuf.subarray(cipherBuf.length - 16);
    const ciphertext = cipherBuf.subarray(0, cipherBuf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    if (sharedSecret) (sharedSecret as Buffer | Uint8Array).fill(0);
    if (aesKey) aesKey.fill(0);
  }
}

async function decryptApiKeyBundle(
  bundle: MlKemAesGcmCipherBundle,
  secretKey: Uint8Array
): Promise<string> {
  const plain = await decryptCipherBundleBytes(bundle, secretKey);
  try {
    return plain.toString('utf8').trim();
  } finally {
    plain.fill(0);
  }
}

async function provisionFreeKey(apiBase: string): Promise<string> {
  const kem = new MlKem768();
  const [publicKey, secretKey] = await kem.generateKeyPair();
  const kyberPublicKeyHex = Buffer.from(publicKey).toString('hex');

  try {
    const response = await fetch(`${apiBase}/api/keys/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kyber_public_key: kyberPublicKeyHex }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BitBop key provisioning failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (typeof data.api_key === 'string' && data.api_key.trim().length > 0) {
      return data.api_key.trim();
    }

    const cipher = data.cipher as MlKemAesGcmCipherBundle | undefined;
    if (!cipher) {
      throw new Error('BitBop key provisioning response missing api_key or cipher bundle');
    }

    return await decryptApiKeyBundle(cipher, secretKey);
  } finally {
    if (secretKey) {
      secretKey.fill(0);
    }
  }
}

export async function initBitBopClient(): Promise<void> {
  const currentApiBase = getBitBopApiBase();
  if (initialized && initializedApiBase === currentApiBase && apiKey) {
    return;
  }
  if (initializedApiBase !== null && initializedApiBase !== currentApiBase) {
    resetBitBopClient();
  }

  const envKey = process.env.BITBOP_API_KEY?.trim();
  if (envKey && envKey !== 'test-key-1') {
    apiKey = envKey;
    initialized = true;
    initializedApiBase = currentApiBase;
    initError = null;
    return;
  }

  const isDefaultProductionApi = currentApiBase === DEFAULT_BITBOP_API;
  const customKeyFile = process.env.BITBOP_KEY_FILE?.trim();

  // Only read/persist disk .bitbop_key against default production BitBop (or explicit BITBOP_KEY_FILE)
  if (isDefaultProductionApi || customKeyFile) {
    const candidateKeyPaths = customKeyFile
      ? [path.resolve(customKeyFile)]
      : [
          path.resolve(process.cwd(), '.bitbop_key'),
          path.resolve(process.cwd(), 'server', '.bitbop_key'),
          path.resolve(process.cwd(), '..', '.bitbop_key'),
        ];
    for (const kp of candidateKeyPaths) {
      try {
        if (fs.existsSync(kp)) {
          const fileKey = fs.readFileSync(kp, 'utf8').trim();
          if (fileKey.startsWith('bb_')) {
            apiKey = fileKey;
            initialized = true;
            initializedApiBase = currentApiBase;
            initError = null;
            console.log(`[bitbop] Loaded persistent key from ${kp} (prefix: ${apiKey.slice(0, 15)}...)`);
            return;
          }
        }
      } catch {
        // ignore read error, proceed to provisioning
      }
    }
  }

  try {
    apiKey = await provisionFreeKey(currentApiBase);
    initialized = true;
    initializedApiBase = currentApiBase;
    initError = null;
    if (customKeyFile) {
      try {
        fs.mkdirSync(path.dirname(path.resolve(customKeyFile)), { recursive: true });
        fs.writeFileSync(path.resolve(customKeyFile), apiKey, 'utf8');
      } catch (saveErr) {
        console.warn('[bitbop] Could not persist API key to BITBOP_KEY_FILE:', saveErr);
      }
    } else if (isDefaultProductionApi) {
      try {
        fs.writeFileSync(path.resolve(process.cwd(), '.bitbop_key'), apiKey, 'utf8');
        if (fs.existsSync(path.resolve(process.cwd(), 'server'))) {
          fs.writeFileSync(path.resolve(process.cwd(), 'server', '.bitbop_key'), apiKey, 'utf8');
        }
      } catch (saveErr) {
        console.warn('[bitbop] Could not persist API key to disk:', saveErr);
      }
    }
    console.log(`[bitbop] Initialized with key prefix: ${apiKey.slice(0, 15)}...`);
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.warn('[bitbop] init failed:', initError);
  }
}

export function getBitBopClientStatus(): {
  initialized: boolean;
  provisioned: boolean;
  hasApiKey: boolean;
  key_prefix: string;
  api_base: string;
  pinned_key_id: string;
  initError: string | null;
} {
  return {
    initialized,
    provisioned: Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    key_prefix: apiKey ? apiKey.slice(0, 15) : '',
    api_base: getBitBopApiBase(),
    pinned_key_id: DEFAULT_RELEASE_KEY_ID,
    initError,
  };
}

export function cacheRawReceipt(beaconSequence: number, receipt: Record<string, unknown>): void {
  rawReceiptCache.set(beaconSequence, receipt);
}

export function getCachedRawReceipt(beaconSequence: number): Record<string, unknown> | undefined {
  return rawReceiptCache.get(beaconSequence);
}

async function ensureApiKey(): Promise<string> {
  const currentApiBase = getBitBopApiBase();
  if (!apiKey || initializedApiBase !== currentApiBase) {
    await initBitBopClient();
  }
  if (!apiKey) {
    throw new Error(
      initError
        ? `BitBop client unavailable: ${initError}`
        : 'BitBop client not initialized; missing API key'
    );
  }
  return apiKey;
}

export interface AttestEntityMetadata {
  entityType?: string;
  entityId?: string;
  entityVersion?: number;
  timestamp?: string;
}

function inferEntityTypeFromEvent(eventType: string): string {
  switch (eventType) {
    case 'SOLUTION_REQUESTED':
    case 'WORKING_GROUP_DECISION':
    case 'SOLUTION_APPROVED':
      return 'SOLUTION';
    case 'CAPABILITY_CREATED':
    case 'CAPABILITY_AUTHORISED':
      return 'CAPABILITY';
    case 'BREACH_NOTIFICATION':
      return 'BREACH';
    case 'BREACH_REMEDIATION':
      return 'REMEDIATION';
    case 'COMPLIANCE_AUDIT':
      return 'COMPLIANCE_AUDIT';
    case 'GOVERNANCE_REQUEST_CREATED':
      return 'GOVERNANCE_REQUEST';
    case 'MEETING_DECISION_RECORDED':
      return 'MEETING_DECISION';
    case 'RISK_ASSESSMENT_RECORDED':
      return 'RISK_ASSESSMENT';
    default:
      return 'GOVERNANCE_EVENT';
  }
}

function inferEntityIdFromPayload(payload: Record<string, unknown>): string {
  const candidates = [
    payload.solution_id,
    payload.capability_id,
    payload.breach_id,
    payload.remediation_id,
    payload.audit_id,
    payload.request_id,
    payload.decision_id,
    payload.assessment_id,
    payload.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }
  return '';
}

export function reconstructExpectedPayloadFromLiveEntity(
  entityType: string,
  liveEntity: Record<string, unknown>,
  snapshotPayload: Record<string, unknown>
): Record<string, unknown> {
  const normalized = entityType.toUpperCase().trim();
  let columnMap: Record<string, unknown> = {};

  switch (normalized) {
    case 'SOLUTION':
      columnMap = {
        id: liveEntity.id,
        solution_id: liveEntity.id,
        title: liveEntity.title,
        business_problem: liveEntity.business_problem,
        requesting_unit: liveEntity.requesting_unit,
        owner_name: liveEntity.owner_name,
        owner_remit: liveEntity.owner_remit,
        risk_tier: liveEntity.risk_tier,
        lifecycle_stage: liveEntity.lifecycle_stage,
        target_stage: liveEntity.lifecycle_stage,
        capability_ids: liveEntity.capability_ids,
        control_ids: liveEntity.control_ids,
      };
      break;
    case 'CAPABILITY':
      columnMap = {
        id: liveEntity.id,
        capability_id: liveEntity.id,
        name: liveEntity.name,
        description: liveEntity.description,
        provider_or_tech: liveEntity.provider_or_tech,
        owner_name: liveEntity.owner_name,
        status: liveEntity.status,
        control_ids: liveEntity.control_ids,
      };
      break;
    case 'BREACH':
      columnMap = {
        id: liveEntity.id,
        breach_id: liveEntity.id,
        title: liveEntity.title,
        severity: liveEntity.severity,
        affected_entity_type: liveEntity.affected_entity_type,
        affected_entity_id: liveEntity.affected_entity_id,
        description: liveEntity.description,
        reported_by: liveEntity.reported_by,
        status: liveEntity.status,
      };
      break;
    case 'REMEDIATION':
      columnMap = {
        id: liveEntity.id,
        remediation_id: liveEntity.id,
        breach_id: liveEntity.breach_id,
        remediation_summary: liveEntity.remediation_summary,
        verified_by: liveEntity.verified_by,
        status: liveEntity.status,
      };
      break;
    case 'COMPLIANCE_AUDIT':
      columnMap = {
        id: liveEntity.id,
        audit_id: liveEntity.id,
        audit_name: liveEntity.audit_name,
        auditor_name: liveEntity.auditor_name,
        guardrails_evaluated: liveEntity.guardrails_evaluated,
        overall_compliance_status: liveEntity.overall_compliance_status,
        findings: liveEntity.findings,
      };
      break;
    case 'GOVERNANCE_REQUEST':
      columnMap = {
        id: liveEntity.id,
        request_id: liveEntity.id,
        title: liveEntity.title,
        business_problem: liveEntity.business_problem,
        requesting_unit: liveEntity.requesting_unit,
        owner_name: liveEntity.owner_name,
        status: liveEntity.status,
        solution_id: liveEntity.solution_id ?? null,
      };
      break;
    case 'MEETING_DECISION':
      columnMap = {
        id: liveEntity.id,
        decision_id: liveEntity.id,
        title: liveEntity.title,
        decision: liveEntity.decision,
        solution_id: liveEntity.solution_id ?? null,
        attendees: liveEntity.attendees,
        decided_at: liveEntity.decided_at,
      };
      break;
    case 'RISK_ASSESSMENT':
      columnMap = {
        id: liveEntity.id,
        assessment_id: liveEntity.id,
        solution_id: liveEntity.solution_id,
        risk_tier: liveEntity.risk_tier,
        findings: liveEntity.findings,
        assessor_name: liveEntity.assessor_name,
        assessed_at: liveEntity.assessed_at,
      };
      break;
    default:
      columnMap = { ...liveEntity };
      break;
  }

  const reconstructed: Record<string, unknown> = {};
  for (const key of Object.keys(snapshotPayload)) {
    if (key in columnMap) {
      reconstructed[key] = columnMap[key];
    } else {
      reconstructed[key] = snapshotPayload[key];
    }
  }
  return reconstructed;
}

export async function attestGovernanceEvent(
  eventType: string,
  payload: Record<string, unknown>,
  metadata?: AttestEntityMetadata
): Promise<BitBopReceipt> {
  const key = await ensureApiKey();
  const apiBase = getBitBopApiBase();
  const entityType = metadata?.entityType || inferEntityTypeFromEvent(eventType);
  const entityId = metadata?.entityId ?? inferEntityIdFromPayload(payload);
  const entityVersion = Number(metadata?.entityVersion ?? payload.entity_version ?? 1);
  const recordTimestamp = metadata?.timestamp || new Date().toISOString();

  const canonicalSnapshot: CanonicalSnapshot = {
    schema_version: 1,
    source: 'aaims',
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    entity_version: entityVersion,
    timestamp: recordTimestamp,
    payload,
  };

  const contextHash = sha256Context(canonicalSnapshot);

  // Generate ephemeral ML-KEM-768 keypair for post-quantum E2EE delivery;
  // retain ephemeralSk until ciphertext decapsulation and hash verification complete.
  const kem = new MlKem768();
  const [ephemeralPk, ephemeralSk] = await kem.generateKeyPair();
  const kyberPublicKeyHex = Buffer.from(ephemeralPk).toString('hex');

  try {
    const response = await fetch(`${apiBase}/consume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bytes_requested: 32,
        kyber_public_key: kyberPublicKeyHex,
        signature_scheme: 'ml-dsa-44',
        context_hash: contextHash,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BitBop consume failed (${response.status}): ${text}`);
    }

    const consumeData = (await response.json()) as {
      version: string;
      timestamp: string;
      delivery_mechanism: string;
      cipher: MlKemAesGcmCipherBundle & Record<string, unknown>;
      attestation: {
        beacon_sequence: number;
        beacon_hash: string;
        beacon_byte_offset: number;
        byte_count: number;
        entropy_sha256: string;
        context_hash?: string;
        commitment_hash?: string;
        key_id?: string;
        signature_scheme: string;
        signature: string;
      };
    };

    const att = consumeData.attestation;
    if (!att || !att.beacon_sequence || att.beacon_sequence <= 0) {
      throw new Error('BitBop receipt missing valid beacon_sequence');
    }

    if (att.signature_scheme && att.signature_scheme !== 'ml-dsa-44') {
      throw new Error(`Unexpected BitBop signature scheme: ${att.signature_scheme}`);
    }

    if (att.context_hash !== contextHash) {
      throw new Error(
        `BitBop attestation context_hash mismatch: expected ${contextHash}, got ${att.context_hash ?? 'missing'}`
      );
    }

    // 1. Real ML-KEM-768 decapsulation + AES-256-GCM decryption of delivered quantum entropy
    const entropyBytes = await decryptCipherBundleBytes(consumeData.cipher, ephemeralSk);
    let entropyHex = '';
    try {
      const expectedBytes = Number(att.byte_count || 32);
      if (entropyBytes.length !== expectedBytes || entropyBytes.length !== 32) {
        throw new Error(
          `Decapsulated quantum entropy byte length mismatch: expected 32 bytes, got ${entropyBytes.length}`
        );
      }
      entropyHex = entropyBytes.toString('hex');
    } finally {
      entropyBytes.fill(0);
    }

    const computedEntropySha256 = sha256PrefixedUtf8(entropyHex);
    if (computedEntropySha256 !== att.entropy_sha256) {
      throw new Error(
        `Decapsulated quantum entropy SHA-256 mismatch against signed attestation: computed ${computedEntropySha256}, declared ${att.entropy_sha256}`
      );
    }

    if (typeof att.commitment_hash === 'string' && att.commitment_hash.length > 0) {
      const computedCommitment = sha256PrefixedUtf8(entropyHex + contextHash);
      if (computedCommitment !== att.commitment_hash) {
        throw new Error(
          `Decapsulated quantum commitment_hash mismatch: computed ${computedCommitment}, declared ${att.commitment_hash}`
        );
      }
    }

    // 2. Local pinned ML-DSA-44 lattice signature verification BEFORE accepting receipt
    const localSigCheck = verifyLocalMlDsa44ReceiptSignature(
      consumeData as unknown as Record<string, unknown>
    );
    if (!localSigCheck.valid) {
      throw new Error(
        `BitBop receipt failed local pinned ML-DSA-44 verification: ${localSigCheck.reason || 'invalid signature'}`
      );
    }

    // Cache raw response for lookup
    cacheRawReceipt(att.beacon_sequence, consumeData as unknown as Record<string, unknown>);

    const receipt: BitBopReceipt = {
      event_type: eventType,
      beacon_sequence: att.beacon_sequence,
      signature: att.signature,
      signature_scheme: att.signature_scheme || 'ml-dsa-44',
      beacon_hash: att.beacon_hash,
      entropy_sha256: att.entropy_sha256,
      context_hash: contextHash,
      schema_version: 1,
      entity_type: entityType,
      entity_id: entityId,
      entity_version: entityVersion,
      canonical_snapshot: canonicalSnapshot as unknown as Record<string, unknown>,
      raw_receipt: consumeData as unknown as Record<string, unknown>,
    };

    return receipt;
  } finally {
    if (ephemeralSk) {
      ephemeralSk.fill(0);
    }
  }
}

export async function verifyReceipt(
  receipt: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const apiBase = getBitBopApiBase();

  // 1. Look up stored attestation row in SQLite (by id, with fallback to beacon_sequence)
  const receiptId = typeof receipt.id === 'string' && receipt.id.trim() ? receipt.id.trim() : undefined;
  const beaconSeq = typeof receipt.beacon_sequence === 'number' ? receipt.beacon_sequence : undefined;
  const receiptEntityId = typeof receipt.entity_id === 'string' ? receipt.entity_id : undefined;
  const receiptEventType = typeof receipt.event_type === 'string' ? receipt.event_type : undefined;

  const byId = receiptId ? getAttestationRecordById(receiptId) : undefined;
  const bySeq =
    !byId && beaconSeq !== undefined
      ? getAttestationRecordBySequence(beaconSeq, receiptEntityId, receiptEventType)
      : undefined;
  const storedRow = byId ?? bySeq;

  let storedReceipt: BitBopReceipt | undefined;
  let storedSnapshot: Record<string, unknown> | undefined;
  if (storedRow) {
    try {
      storedReceipt = JSON.parse(storedRow.receipt) as BitBopReceipt;
    } catch {}
    if (storedRow.snapshot_json && storedRow.snapshot_json !== '{}') {
      try {
        storedSnapshot = JSON.parse(storedRow.snapshot_json) as Record<string, unknown>;
      } catch {}
    } else if (storedReceipt?.canonical_snapshot && typeof storedReceipt.canonical_snapshot === 'object') {
      storedSnapshot = storedReceipt.canonical_snapshot as Record<string, unknown>;
    }
  }

  const callerSnapshot =
    receipt.canonical_snapshot && typeof receipt.canonical_snapshot === 'object'
      ? (receipt.canonical_snapshot as Record<string, unknown>)
      : undefined;

  const snapshot = callerSnapshot ?? storedSnapshot;
  const callerContextHash = typeof receipt.context_hash === 'string' ? receipt.context_hash : undefined;
  const storedContextHash =
    typeof storedReceipt?.context_hash === 'string' ? storedReceipt.context_hash : undefined;
  const effectiveContextHash = callerContextHash ?? storedContextHash;

  // 2. Check 1 — Historical Snapshot Integrity (checks.historical_snapshot_match, gates valid)
  let historicalSnapshotMatch = false;
  let tamperedInPlace = false;
  let tamperReason: string | undefined;
  let snapshotMismatchReason: string | undefined;

  if (snapshot && Object.keys(snapshot).length > 0 && effectiveContextHash) {
    const recomputedHash = sha256Context(snapshot);
    historicalSnapshotMatch = recomputedHash === effectiveContextHash;
    if (!historicalSnapshotMatch) {
      snapshotMismatchReason = 'Canonical snapshot hash mismatch against context_hash';
    }

    if (callerContextHash && storedContextHash && callerContextHash !== storedContextHash) {
      historicalSnapshotMatch = false;
      snapshotMismatchReason = 'Receipt context_hash does not match stored attestation context_hash';
    }

    if (storedSnapshot && Object.keys(storedSnapshot).length > 0) {
      const storedRecomputedHash = sha256Context(storedSnapshot);
      if (storedRecomputedHash !== effectiveContextHash || recomputedHash !== storedRecomputedHash) {
        historicalSnapshotMatch = false;
        snapshotMismatchReason = 'Stored snapshot_json tampered relative to signed context_hash';
      }
    }

    if (
      receiptEventType &&
      typeof snapshot.event_type === 'string' &&
      receiptEventType !== snapshot.event_type
    ) {
      historicalSnapshotMatch = false;
      snapshotMismatchReason = 'Receipt event_type does not match canonical snapshot event_type';
    }
  }

  if (!storedRow) {
    historicalSnapshotMatch = false;
    tamperReason = 'Attestation record not found in governance ledger';
    snapshotMismatchReason = tamperReason;
  } else if (!byId && bySeq && receiptId && receiptId !== storedRow.id) {
    historicalSnapshotMatch = false;
    tamperReason = 'Receipt ID does not match stored attestation record';
    snapshotMismatchReason = tamperReason;
  }

  // 3. In-place SQLite tampering check & Check 2 — Current Entity State / Drift
  const entityType =
    (typeof snapshot?.entity_type === 'string' ? snapshot.entity_type : undefined) ||
    (typeof receipt.entity_type === 'string' ? receipt.entity_type : undefined) ||
    storedRow?.entity_type ||
    '';
  const entityId =
    (typeof snapshot?.entity_id === 'string' ? snapshot.entity_id : undefined) ||
    (typeof receipt.entity_id === 'string' ? receipt.entity_id : undefined) ||
    storedRow?.entity_id ||
    '';
  const attestedVersion = Number(
    snapshot?.entity_version ?? receipt.entity_version ?? storedRow?.entity_version ?? 1
  );
  const snapshotPayload =
    snapshot?.payload && typeof snapshot.payload === 'object'
      ? (snapshot.payload as Record<string, unknown>)
      : undefined;

  let currentEntityState:
    | {
        exists: boolean;
        matches_snapshot: boolean;
        attested_entity_version: number;
        current_entity_version: number | null;
      }
    | undefined;

  if (entityType && entityId && entityType !== 'GOVERNANCE_EVENT') {
    const liveEntity = getLiveEntityByTypeAndId(entityType, entityId);
    if (!liveEntity) {
      currentEntityState = {
        exists: false,
        matches_snapshot: false,
        attested_entity_version: attestedVersion,
        current_entity_version: null,
      };
    } else {
      const currentVersion = Number(liveEntity.entity_version ?? 1);
      const expectedPayload = snapshotPayload
        ? reconstructExpectedPayloadFromLiveEntity(entityType, liveEntity, snapshotPayload)
        : {};
      const payloadMatchesLive = snapshotPayload
        ? JSON.stringify(expectedPayload) === JSON.stringify(snapshotPayload)
        : true;

      if (currentVersion === attestedVersion) {
        if (!payloadMatchesLive) {
          tamperedInPlace = true;
          historicalSnapshotMatch = false;
          tamperReason = 'Entity record tampered in-place without governance attestation';
          currentEntityState = {
            exists: true,
            matches_snapshot: false,
            attested_entity_version: attestedVersion,
            current_entity_version: currentVersion,
          };
        } else {
          currentEntityState = {
            exists: true,
            matches_snapshot: true,
            attested_entity_version: attestedVersion,
            current_entity_version: currentVersion,
          };
        }
      } else if (currentVersion > attestedVersion) {
        let missingVersionAttestation = false;
        for (let v = attestedVersion + 1; v <= currentVersion; v++) {
          if (!hasAttestationForEntityVersion(entityType, entityId, v)) {
            missingVersionAttestation = true;
            break;
          }
        }
        if (missingVersionAttestation) {
          tamperedInPlace = true;
          historicalSnapshotMatch = false;
          tamperReason = 'Entity version advanced without governance attestation';
        }
        currentEntityState = {
          exists: true,
          matches_snapshot: false,
          attested_entity_version: attestedVersion,
          current_entity_version: currentVersion,
        };
      } else {
        tamperedInPlace = true;
        historicalSnapshotMatch = false;
        tamperReason = 'Entity record tampered in-place without governance attestation';
        currentEntityState = {
          exists: true,
          matches_snapshot: false,
          attested_entity_version: attestedVersion,
          current_entity_version: currentVersion,
        };
      }
    }
  }

  // 4. Construct canonical payload for local ML-DSA-44 verification AND remote BitBop /verify
  let payloadToVerify: Record<string, unknown> = { ...receipt };
  let signatureConflict = false;

  const storedRawReceipt =
    storedReceipt?.raw_receipt && typeof storedReceipt.raw_receipt === 'object'
      ? (storedReceipt.raw_receipt as Record<string, unknown>)
      : undefined;
  const storedRawAtt =
    storedRawReceipt?.attestation && typeof storedRawReceipt.attestation === 'object'
      ? (storedRawReceipt.attestation as Record<string, unknown>)
      : undefined;

  const rawSource =
    receipt.raw_receipt && typeof receipt.raw_receipt === 'object'
      ? (receipt.raw_receipt as Record<string, unknown>)
      : storedRawReceipt;

  if (rawSource) {
    const raw = JSON.parse(JSON.stringify(rawSource)) as Record<string, unknown>;
    if (raw.attestation && typeof raw.attestation === 'object') {
      const rawAtt = raw.attestation as Record<string, unknown>;
      const rawHadContextHash =
        'context_hash' in rawAtt || Boolean(storedRawAtt && 'context_hash' in storedRawAtt);

      if (
        (rawAtt.context_hash && rawAtt.context_hash !== effectiveContextHash) ||
        (storedRawAtt && 'context_hash' in storedRawAtt && !('context_hash' in rawAtt))
      ) {
        historicalSnapshotMatch = false;
        tamperReason = 'Raw receipt context_hash does not match canonical snapshot digest';
        snapshotMismatchReason = tamperReason;
      }

      if (typeof receipt.signature === 'string' && receipt.signature.length > 0) {
        if (
          receipt.raw_receipt &&
          typeof rawAtt.signature === 'string' &&
          rawAtt.signature !== receipt.signature
        ) {
          // Caller supplied conflicting outer and inner signatures; test whichever differs from stored
          if (storedReceipt?.signature && receipt.signature === storedReceipt.signature) {
            // rawAtt.signature was tampered; preserve rawAtt.signature so verification rejects it
            signatureConflict = true;
          } else {
            rawAtt.signature = receipt.signature;
            signatureConflict = true;
          }
        } else {
          rawAtt.signature = receipt.signature;
        }
      }

      // Propagate caller top-level beacon_sequence or entropy_sha256 overrides if tampered at top level
      if (
        typeof receipt.beacon_sequence === 'number' &&
        typeof rawAtt.beacon_sequence === 'number' &&
        receipt.beacon_sequence !== rawAtt.beacon_sequence
      ) {
        rawAtt.beacon_sequence = receipt.beacon_sequence;
      }
      if (
        typeof receipt.entropy_sha256 === 'string' &&
        typeof rawAtt.entropy_sha256 === 'string' &&
        receipt.entropy_sha256 !== rawAtt.entropy_sha256
      ) {
        rawAtt.entropy_sha256 = receipt.entropy_sha256;
      }
      if (
        typeof receipt.beacon_hash === 'string' &&
        typeof rawAtt.beacon_hash === 'string' &&
        receipt.beacon_hash !== rawAtt.beacon_hash
      ) {
        rawAtt.beacon_hash = receipt.beacon_hash;
      }

      if (rawHadContextHash || !storedRow || !historicalSnapshotMatch) {
        rawAtt.context_hash =
          effectiveContextHash ?? (receipt.context_hash as string) ?? 'invalid_context_hash';
      }
    }
    payloadToVerify = raw;
  }

  // 5. Local pinned ML-DSA-44 verification (mandatory — never trust remote /verify alone)
  const localSigResult = verifyLocalMlDsa44ReceiptSignature(payloadToVerify);
  const localMlDsa44Valid = localSigResult.valid && !signatureConflict;

  // 6. Remote BitBop /verify edge check (beacon chain existence, beacon signature, thermal entropy binding)
  const response = await fetch(`${apiBase}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadToVerify),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BitBop verify failed (${response.status}): ${text}`);
  }

  const bitbopResult = (await response.json()) as Record<string, unknown>;
  const bitbopValid = Boolean(bitbopResult.valid);
  const existingChecks =
    bitbopResult.checks && typeof bitbopResult.checks === 'object'
      ? (bitbopResult.checks as Record<string, unknown>)
      : {};

  const finalValid = localMlDsa44Valid && bitbopValid && historicalSnapshotMatch && !tamperedInPlace;

  const enrichedResult: Record<string, unknown> = {
    ...bitbopResult,
    valid: finalValid,
    checks: {
      ...existingChecks,
      local_mldsa44_signature_valid: localMlDsa44Valid,
      historical_snapshot_match: historicalSnapshotMatch,
    },
  };

  if (tamperedInPlace) {
    enrichedResult.tampered_in_place = true;
    enrichedResult.reason = tamperReason || 'Entity record tampered in-place without governance attestation';
  } else if (!localMlDsa44Valid) {
    enrichedResult.reason =
      (typeof bitbopResult.reason === 'string' && bitbopResult.reason) ||
      localSigResult.reason ||
      'Local pinned ML-DSA-44 lattice signature verification failed';
  } else if (!bitbopValid) {
    enrichedResult.reason =
      (typeof bitbopResult.reason === 'string' && bitbopResult.reason) ||
      'BitBop edge cryptographic verification failed';
  } else if (!historicalSnapshotMatch && snapshotMismatchReason) {
    enrichedResult.reason = snapshotMismatchReason;
  }

  if (currentEntityState) {
    enrichedResult.current_entity_state = currentEntityState;
  }

  return enrichedResult;
}
