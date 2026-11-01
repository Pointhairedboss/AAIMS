import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64 } from '../../server/src/bitbop.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export type BitBopFaultMode =
  | 'none'
  | 'consume_503'
  | 'corrupt_consume_signature'
  | 'corrupt_consume_ciphertext'
  | 'corrupt_consume_entropy_hash';

export interface LocalBitBopNodeHandle {
  apiUrl: string;
  port: number;
  servicePublicKeyB64: string;
  authorizedSystemKey: string;
  isLive: boolean;
  setFaultMode: (mode: BitBopFaultMode) => void;
  applyProcessEnv: () => void;
  close: () => Promise<void>;
}

function createSqliteDoStorage(sqliteDb: DatabaseSyncType) {
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const trimmed = query.trim();
        if (bindings.length === 0 && trimmed.includes(';') && !trimmed.includes('?')) {
          sqliteDb.exec(query);
          return {
            toArray: () => [],
            one: () => null,
          };
        }
        const stmt = sqliteDb.prepare(query);
        const upper = trimmed.toUpperCase();
        if (
          upper.startsWith('SELECT') ||
          upper.startsWith('PRAGMA') ||
          upper.startsWith('WITH') ||
          upper.includes('RETURNING')
        ) {
          const rows = stmt.all(...(bindings as never[])) as Record<string, unknown>[];
          return {
            toArray: () => rows,
            one: () => (rows.length > 0 ? rows[0] : null),
          };
        }
        stmt.run(...(bindings as never[]));
        return {
          toArray: () => [],
          one: () => null,
        };
      },
    },
    async getAlarm() {
      return null;
    },
    async setAlarm(_ms: number) {},
  };
}

function flipHexByte(hexStr: string): string {
  const hasPrefix = /^mldsa44:/i.test(hexStr);
  const raw = hexStr.replace(/^mldsa44:/i, '');
  const lastTwo = raw.slice(-2);
  const flipped = ((parseInt(lastTwo, 16) ^ 0xff) & 0xff).toString(16).padStart(2, '0');
  const mutated = raw.slice(0, -2) + flipped;
  return hasPrefix ? `mldsa44:${mutated}` : mutated;
}

/**
 * Starts a real local HTTP instance of bitbop-quantum-node (BitBopCoordinator + node:sqlite
 * + NIST FIPS 203 ML-KEM-768 + NIST FIPS 204 ML-DSA-44 + AES-256-GCM sealed beacon blocks),
 * or points to live https://api.bitbop.dev when BITBOP_LIVE_E2E=1.
 */
export async function startLocalBitBopNode(options?: {
  port?: number;
  forceLocal?: boolean;
}): Promise<LocalBitBopNodeHandle> {
  if (!options?.forceLocal && process.env.BITBOP_LIVE_E2E === '1') {
    return {
      apiUrl: 'https://api.bitbop.dev',
      port: 443,
      servicePublicKeyB64: DEFAULT_SERVICE_PUBLIC_KEY_MLDSA44_B64,
      authorizedSystemKey: process.env.BITBOP_API_KEY || '',
      isLive: true,
      setFaultMode: () => {},
      applyProcessEnv: () => {
        process.env.BITBOP_API_URL = 'https://api.bitbop.dev';
        delete process.env.BITBOP_SERVICE_PUBLIC_KEY_MLDSA44_B64;
      },
      close: async () => {},
    };
  }

  // Dynamically import real bitbop-quantum-node Worker + Durable Object Coordinator
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workerEntryUrl = pathToFileURL(
    path.resolve(currentDir, '../../../bitbop-quantum-node/source_payload/index.js')
  ).href;
  const bitbopMod = (await import(workerEntryUrl)) as {
    default: {
      fetch: (
        req: Request,
        env: Record<string, unknown>,
        ctx: { waitUntil: (p: Promise<unknown>) => void }
      ) => Promise<Response>;
    };
    BitBopCoordinator: new (
      state: Record<string, unknown>,
      env: Record<string, unknown>
    ) => { fetch: (req: Request) => Promise<Response> };
    sealBeaconEntropyBlock: (
      plaintext: Uint8Array,
      sealKeyHex: string,
      ivBytes?: Uint8Array
    ) => Promise<Record<string, unknown>>;
    bytesToHex: (bytes: Uint8Array) => string;
  };

  const bitbopWorker = bitbopMod.default;
  const { BitBopCoordinator, sealBeaconEntropyBlock, bytesToHex } = bitbopMod;

  const kvStore = new Map<string, string>();
  const mockKv = {
    async get(key: string, opts?: { type?: string } | string) {
      const val = kvStore.get(key);
      if (val === undefined) return null;
      const type = typeof opts === 'string' ? opts : opts?.type || 'text';
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: unknown) {
      kvStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key: string) {
      kvStore.delete(key);
    },
  };

  // Real cryptographic keys for local BitBop node
  const beaconSealKeyHex = crypto.randomBytes(32).toString('hex');
  const apiKeyHmacSecret = crypto.randomBytes(32).toString('hex');
  const authorizedSystemKey = `bb_sys_local_${crypto.randomBytes(16).toString('hex')}`;

  const serviceMldsa = ml_dsa44.keygen();
  const beaconMldsa = ml_dsa44.keygen();

  const servicePubB64 = Buffer.from(serviceMldsa.publicKey).toString('base64');
  const servicePrivB64 = Buffer.from(serviceMldsa.secretKey).toString('base64');
  const beaconPubMldsaB64 = Buffer.from(beaconMldsa.publicKey).toString('base64');

  const edKeyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const edPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', edKeyPair.publicKey)
  );
  const beaconPubEdHex = bytesToHex(edPubRaw);

  // Seal two real 256 KiB hardware-format entropy blocks (#20001 and #20002)
  async function createSealedBlock(sequence: number, prevHash: string) {
    const entropyBytes = crypto.randomBytes(262144);
    const sealedEntropy = await sealBeaconEntropyBlock(entropyBytes, beaconSealKeyHex);
    const entryHash = `sha256:${crypto
      .createHash('sha256')
      .update(`local-aaims-beacon:${sequence}:${sealedEntropy.hash}:${prevHash}`)
      .digest('hex')}`;

    const entryMsgBytes = new TextEncoder().encode(entryHash);
    const mldsaSigBytes = ml_dsa44.sign(entryMsgBytes, beaconMldsa.secretKey);
    const edSigBuf = await crypto.subtle.sign(
      { name: 'Ed25519' },
      edKeyPair.privateKey as CryptoKey,
      entryMsgBytes
    );

    const block = {
      version: '2.0',
      sequence,
      timestamp: new Date().toISOString(),
      entropy: sealedEntropy,
      chain: {
        previous_hash: prevHash,
        entry_hash: entryHash,
      },
      signature: `ed25519:${bytesToHex(new Uint8Array(edSigBuf))}`,
      signature_mldsa44: `mldsa44:${bytesToHex(mldsaSigBytes)}`,
    };
    kvStore.set(`beacon:${sequence}`, JSON.stringify(block));
    return entryHash;
  }

  const hash1 = await createSealedBlock(20001, `sha256:${'0'.repeat(64)}`);
  await createSealedBlock(20002, hash1);
  kvStore.set('pool:cursor', '20001');

  const coordinatorSqlite = new DatabaseSync(':memory:');
  const coordinatorState = {
    storage: createSqliteDoStorage(coordinatorSqlite),
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
  };

  const bitbopEnv: Record<string, unknown> = {
    BITBOP_KV: mockKv,
    BEACON_SEAL_KEY: beaconSealKeyHex,
    API_KEY_HMAC_SECRET: apiKeyHmacSecret,
    BEACON_PUBLIC_KEY: beaconPubEdHex,
    BEACON_PUBLIC_KEY_MLDSA44_B64: beaconPubMldsaB64,
    SERVICE_PRIVATE_KEY_MLDSA44_B64: servicePrivB64,
    SERVICE_PUBLIC_KEY_MLDSA44_B64: servicePubB64,
    AUTHORIZED_API_KEYS: authorizedSystemKey,
  };

  const coordinatorInstance = new BitBopCoordinator(coordinatorState, bitbopEnv);
  bitbopEnv.BITBOP_COORDINATOR = {
    idFromName: () => 'global-primary',
    get: () => ({
      fetch: (req: Request | string, init?: RequestInit) => {
        const requestObj = typeof req === 'string' ? new Request(req, init) : req;
        return coordinatorInstance.fetch(requestObj);
      },
    }),
  };

  let faultMode: BitBopFaultMode = 'none';
  let freeKeyMintIpCounter = 1;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = req.url || '/';
      const method = req.method || 'GET';

      if (faultMode === 'consume_503' && reqUrl.startsWith('/consume') && method === 'POST') {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Service Unavailable: Quantum entropy coordinator unreachable',
          })
        );
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else if (typeof v === 'string') {
          headers.set(k, v);
        }
      }

      // Avoid 2/day IP limit across repeated test key resets unless test explicitly sets CF-Connecting-IP
      if (
        (reqUrl.startsWith('/api/keys/free') || reqUrl.startsWith('/keys/free')) &&
        !headers.has('cf-connecting-ip')
      ) {
        const octet3 = Math.floor(freeKeyMintIpCounter / 250) % 250;
        const octet4 = (freeKeyMintIpCounter % 250) + 1;
        freeKeyMintIpCounter++;
        headers.set('CF-Connecting-IP', `10.240.${octet3}.${octet4}`);
      }

      const webReq = new Request(`https://api.bitbop.dev${reqUrl}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : rawBody,
      });

      const pendingTasks: Promise<unknown>[] = [];
      const webRes = await bitbopWorker.fetch(webReq, bitbopEnv, {
        waitUntil: (p: Promise<unknown>) => {
          pendingTasks.push(Promise.resolve(p).catch(() => {}));
        },
      });
      if (pendingTasks.length > 0) {
        await Promise.all(pendingTasks);
      }

      let resBytes = Buffer.from(await webRes.arrayBuffer());

      // Optional adversarial fault modes on /consume responses
      if (
        faultMode !== 'none' &&
        reqUrl.startsWith('/consume') &&
        method === 'POST' &&
        webRes.status === 200
      ) {
        const parsed = JSON.parse(resBytes.toString('utf8')) as Record<string, unknown>;
        if (
          faultMode === 'corrupt_consume_signature' &&
          parsed.attestation &&
          typeof parsed.attestation === 'object'
        ) {
          const att = parsed.attestation as Record<string, unknown>;
          if (typeof att.signature === 'string') {
            att.signature = flipHexByte(att.signature);
          }
        } else if (
          faultMode === 'corrupt_consume_ciphertext' &&
          parsed.cipher &&
          typeof parsed.cipher === 'object'
        ) {
          const cipher = parsed.cipher as Record<string, unknown>;
          if (typeof cipher.aes_ciphertext_hex === 'string') {
            cipher.aes_ciphertext_hex = flipHexByte(cipher.aes_ciphertext_hex);
          }
        } else if (
          faultMode === 'corrupt_consume_entropy_hash' &&
          parsed.attestation &&
          typeof parsed.attestation === 'object'
        ) {
          const att = parsed.attestation as Record<string, unknown>;
          att.entropy_sha256 = `sha256:${'f'.repeat(64)}`;
        }
        resBytes = Buffer.from(JSON.stringify(parsed), 'utf8');
      }

      res.statusCode = webRes.status;
      webRes.headers.forEach((val, key) => {
        if (key.toLowerCase() === 'content-length') return;
        res.setHeader(key, val);
      });
      res.end(resBytes);
    } catch (err: unknown) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });

  const listenPort = options?.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });

  const actualPort = (server.address() as AddressInfo).port;
  const apiUrl = `http://127.0.0.1:${actualPort}`;

  return {
    apiUrl,
    port: actualPort,
    servicePublicKeyB64: servicePubB64,
    authorizedSystemKey,
    isLive: false,
    setFaultMode(mode: BitBopFaultMode) {
      faultMode = mode;
    },
    applyProcessEnv() {
      process.env.BITBOP_API_URL = apiUrl;
      process.env.BITBOP_SERVICE_PUBLIC_KEY_MLDSA44_B64 = servicePubB64;
      delete process.env.BITBOP_API_KEY;
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      try {
        coordinatorSqlite.close();
      } catch {}
    },
  };
}
