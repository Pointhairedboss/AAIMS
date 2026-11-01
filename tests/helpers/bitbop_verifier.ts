/**
 * BitBop Independent Cryptographic Verification Helper
 * Interacts directly with BitBop /verify (local BitBopCoordinator or live https://api.bitbop.dev/verify)
 * to validate post-quantum receipts.
 */

export interface BitBopVerifyPayload {
  beacon_sequence?: number;
  signature?: string;
  canonical_digest?: string;
  public_key_id?: string;
  [key: string]: unknown;
}

export interface BitBopVerifyResponse {
  valid: boolean;
  reason?: string;
  beacon_sequence?: number;
  scheme?: string;
  beacon_signature_valid?: boolean;
  receipt_signature_valid?: boolean;
  entropy_bound_to_beacon?: boolean;
  checks?: Record<string, boolean>;
  error?: string;
}

/**
 * Validates local syntactic integrity of a BitBop attestation receipt
 */
export function validateReceiptFormat(receipt: {
  beacon_sequence: number;
  signature: string;
  canonical_digest?: string;
}) {
  if (typeof receipt.beacon_sequence !== 'number' || receipt.beacon_sequence <= 0) {
    throw new Error(`Invalid beacon_sequence: ${receipt.beacon_sequence}. Must be > 0.`);
  }

  if (typeof receipt.signature !== 'string' || receipt.signature.length < 32) {
    throw new Error(`Invalid signature: ${receipt.signature}. Must be non-empty string.`);
  }

  const isPrefixed = receipt.signature.startsWith('mldsa44:');
  const isHexOnly = /^[0-9a-fA-F]+$/.test(receipt.signature);
  if (!isPrefixed && !isHexOnly) {
    throw new Error(`Signature does not match ML-DSA-44 format: ${receipt.signature.slice(0, 30)}...`);
  }

  if (receipt.canonical_digest) {
    const isSha256 = /^[0-9a-fA-F]{64}$/.test(receipt.canonical_digest);
    if (!isSha256) {
      throw new Error(`Invalid canonical_digest: ${receipt.canonical_digest}. Must be 64-character SHA-256 hex.`);
    }
  }

  return true;
}

/**
 * Performs a cryptographic check against the configured BitBop /verify endpoint
 */
export async function verifyWithBitBopEdge(
  payload: BitBopVerifyPayload,
  edgeUrl = process.env.BITBOP_API_URL || 'https://api.bitbop.dev'
): Promise<{ status: number; data: BitBopVerifyResponse }> {
  const url = `${edgeUrl.replace(/\/+$/, '')}/verify`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'AAIMS-Test-Harness/1.0',
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as BitBopVerifyResponse;
  return { status: res.status, data };
}
