import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MlKem768 } from 'mlkem';
import type { BitBopReceipt } from './types.js';

const BITBOP_API = 'https://api.bitbop.dev';

export { GOVERNANCE_EVENT_TYPES, type GovernanceEventType } from './types.js';

let apiKey: string | null = null;
let initialized = false;
let initError: string | null = null;

// In-memory cache of raw consume receipts keyed by beacon_sequence
const rawReceiptCache = new Map<number, Record<string, unknown>>();

function sha256Context(payload: unknown): string {
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
  if (envKey) {
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

export async function attestGovernanceEvent(
  eventType: string,
  payload: Record<string, unknown>
): Promise<BitBopReceipt> {
  const key = requireApiKey();
  const context = {
    source: 'aaims',
    eventType,
    payload,
    timestamp: new Date().toISOString(),
  };

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
      context_hash: sha256Context(context),
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
    context_hash: sha256Context(context),
    raw_receipt: consumeData as unknown as Record<string, unknown>,
  };

  return receipt;
}

export async function verifyReceipt(
  receipt: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Always verify the caller-provided signature. Never substitute cached signatures from rawReceiptCache.
  let payloadToVerify: Record<string, unknown> = { ...receipt };

  if (receipt.raw_receipt && typeof receipt.raw_receipt === 'object') {
    const raw = JSON.parse(JSON.stringify(receipt.raw_receipt)) as Record<string, unknown>;
    if (raw.attestation && typeof raw.attestation === 'object' && receipt.signature) {
      (raw.attestation as Record<string, unknown>).signature = receipt.signature;
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

  return (await response.json()) as Record<string, unknown>;
}
