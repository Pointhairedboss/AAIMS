import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MlKem768 } from 'mlkem';
import type { BitBopReceipt, CanonicalSnapshot } from './types.js';
import {
  getAttestationRecordById,
  getAttestationRecordBySequence,
  getLiveEntityByTypeAndId,
  hasAttestationForEntityVersion,
} from './db.js';

const BITBOP_API = 'https://api.bitbop.dev';

export { GOVERNANCE_EVENT_TYPES, type GovernanceEventType } from './types.js';

let apiKey: string | null = null;
let initialized = false;
let initError: string | null = null;

// In-memory cache of raw consume receipts keyed by beacon_sequence
const rawReceiptCache = new Map<number, Record<string, unknown>>();

export function sha256Context(payload: unknown): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  return `sha256:${digest}`;
}

async function decryptApiKeyBundle(
  bundle: {
    kyber_ciphertext_hex: string;
    aes_iv_hex: string;
    aes_ciphertext_hex: string;
  },
  secretKey: Uint8Array
): Promise<string> {
  const kem = new MlKem768();
  let sharedSecret: Uint8Array | null = null;
  let aesKey: Buffer | null = null;
  try {
    sharedSecret = await kem.decap(
      Buffer.from(bundle.kyber_ciphertext_hex, 'hex'),
      secretKey
    );
    aesKey = Buffer.from(sharedSecret);
    const iv = Buffer.from(bundle.aes_iv_hex, 'hex');
    const cipherBuf = Buffer.from(bundle.aes_ciphertext_hex, 'hex');
    if (cipherBuf.length < 16) {
      throw new Error(`Invalid ciphertext buffer length: ${cipherBuf.length} bytes (must be at least 16 bytes for auth tag)`);
    }
    const authTag = cipherBuf.subarray(cipherBuf.length - 16);
    const ciphertext = cipherBuf.subarray(0, cipherBuf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8').trim();
  } finally {
    if (sharedSecret) (sharedSecret as Buffer | Uint8Array).fill(0);
    if (aesKey) aesKey.fill(0);
    if (secretKey) secretKey.fill(0);
  }
}

async function provisionFreeKey(): Promise<string> {
  const kem = new MlKem768();
  const [publicKey, secretKey] = await kem.generateKeyPair();
  const kyberPublicKeyHex = Buffer.from(publicKey).toString('hex');

  try {
    const response = await fetch(`${BITBOP_API}/api/keys/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kyber_public_key: kyberPublicKeyHex }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BitBop key provisioning failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (typeof data.api_key === 'string') {
      return data.api_key;
    }

    const cipher = data.cipher as
      | {
          kyber_ciphertext_hex: string;
          aes_iv_hex: string;
          aes_ciphertext_hex: string;
        }
      | undefined;

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
  if (initialized) return;

  const envKey = process.env.BITBOP_API_KEY?.trim();
  if (envKey && envKey !== 'test-key-1') {
    apiKey = envKey;
    initialized = true;
    return;
  }

  // Check persistent key file (.bitbop_key)
  const candidateKeyPaths = [
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
          initError = null;
          console.log(`[bitbop] Loaded persistent key from ${kp} (prefix: ${apiKey.slice(0, 15)}...)`);
          return;
        }
      }
    } catch {
      // ignore read error, proceed to provisioning
    }
  }

  try {
    apiKey = await provisionFreeKey();
    initialized = true;
    initError = null;
    try {
      fs.writeFileSync(path.resolve(process.cwd(), '.bitbop_key'), apiKey, 'utf8');
      fs.writeFileSync(path.resolve(process.cwd(), 'server', '.bitbop_key'), apiKey, 'utf8');
    } catch (saveErr) {
      console.warn('[bitbop] Could not persist API key to disk:', saveErr);
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
  initError: string | null;
} {
  return {
    initialized,
    provisioned: Boolean(apiKey),
    hasApiKey: Boolean(apiKey),
    key_prefix: apiKey ? apiKey.slice(0, 15) : '',
    initError,
  };
}

export function cacheRawReceipt(beaconSequence: number, receipt: Record<string, unknown>): void {
  rawReceiptCache.set(beaconSequence, receipt);
}

export function getCachedRawReceipt(beaconSequence: number): Record<string, unknown> | undefined {
  return rawReceiptCache.get(beaconSequence);
}

function requireApiKey(): string {
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
    case 'CAPABILITY_AUTHORISED':
      return 'CAPABILITY';
    case 'BREACH_NOTIFICATION':
      return 'BREACH';
    case 'BREACH_REMEDIATION':
      return 'REMEDIATION';
    case 'COMPLIANCE_AUDIT':
      return 'COMPLIANCE_AUDIT';
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
  const key = requireApiKey();
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

  // Generate ephemeral ML-KEM-768 keypair for post-quantum E2EE delivery
  const kem = new MlKem768();
  const [ephemeralPk, ephemeralSk] = await kem.generateKeyPair();
  const kyberPublicKeyHex = Buffer.from(ephemeralPk).toString('hex');
  if (ephemeralSk) {
    ephemeralSk.fill(0);
  }

  const response = await fetch(`${BITBOP_API}/consume`, {
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
    cipher: Record<string, unknown>;
    attestation: {
      beacon_sequence: number;
      beacon_hash: string;
      beacon_byte_offset: number;
      byte_count: number;
      entropy_sha256: string;
      context_hash?: string;
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
}

export async function verifyReceipt(
  receipt: Record<string, unknown>
): Promise<Record<string, unknown>> {
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
        if (!hasAttestationForEntityVersion(entityType, entityId, currentVersion)) {
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

  // 4. Always verify the caller-provided signature against BitBop /verify.
  let payloadToVerify: Record<string, unknown> = { ...receipt };

  const storedRawReceipt =
    storedReceipt?.raw_receipt && typeof storedReceipt.raw_receipt === 'object'
      ? (storedReceipt.raw_receipt as Record<string, unknown>)
      : undefined;
  const storedRawAtt =
    storedRawReceipt?.attestation && typeof storedRawReceipt.attestation === 'object'
      ? (storedRawReceipt.attestation as Record<string, unknown>)
      : undefined;

  if (receipt.raw_receipt && typeof receipt.raw_receipt === 'object') {
    const raw = JSON.parse(JSON.stringify(receipt.raw_receipt)) as Record<string, unknown>;
    if (raw.attestation && typeof raw.attestation === 'object') {
      const rawAtt = raw.attestation as Record<string, unknown>;
      const rawHadContextHash = 'context_hash' in rawAtt || Boolean(storedRawAtt && 'context_hash' in storedRawAtt);

      if (
        (rawAtt.context_hash && rawAtt.context_hash !== effectiveContextHash) ||
        (storedRawAtt && 'context_hash' in storedRawAtt && !('context_hash' in rawAtt))
      ) {
        historicalSnapshotMatch = false;
        tamperReason = 'Raw receipt context_hash does not match canonical snapshot digest';
        snapshotMismatchReason = tamperReason;
      }
      if (receipt.signature) {
        rawAtt.signature = receipt.signature;
      }
      if (rawHadContextHash || !storedRow || !historicalSnapshotMatch) {
        rawAtt.context_hash =
          effectiveContextHash ?? (receipt.context_hash as string) ?? 'invalid_context_hash';
      }
    }
    payloadToVerify = raw;
  }

  const response = await fetch(`${BITBOP_API}/verify`, {
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

  const finalValid = bitbopValid && historicalSnapshotMatch && !tamperedInPlace;

  const enrichedResult: Record<string, unknown> = {
    ...bitbopResult,
    valid: finalValid,
    checks: {
      ...existingChecks,
      historical_snapshot_match: historicalSnapshotMatch,
    },
  };

  if (tamperedInPlace) {
    enrichedResult.tampered_in_place = true;
    enrichedResult.reason = tamperReason || 'Entity record tampered in-place without governance attestation';
  } else if (!historicalSnapshotMatch && snapshotMismatchReason) {
    enrichedResult.reason = snapshotMismatchReason;
  }

  if (currentEntityState) {
    enrichedResult.current_entity_state = currentEntityState;
  }

  return enrichedResult;
}
