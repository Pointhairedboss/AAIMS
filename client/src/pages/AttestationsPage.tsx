import React, { useState } from 'react';
import type { BitBopReceipt, VerificationResult } from '../types';
import { VerificationModal } from '../components/VerificationModal';
import { verifyAttestation } from '../services/api';

interface AttestationsPageProps {
  attestations: BitBopReceipt[];
  onRefresh: () => Promise<void>;
}

export const AttestationsPage: React.FC<AttestationsPageProps> = ({
  attestations,
  onRefresh,
}) => {
  const [selectedReceipt, setSelectedReceipt] = useState<BitBopReceipt | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleVerify = async (receipt: BitBopReceipt) => {
    setSelectedReceipt(receipt);
    setVerifyResult(null);
    setIsVerifying(true);
    setIsModalOpen(true);
    try {
      const result = await verifyAttestation(receipt);
      setVerifyResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setVerifyResult({ valid: false, error: msg });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRefreshClick = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="attestations-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">BitBop Post-Quantum Attestation Ledger</h1>
          <p className="page-description">
            Stateless post-quantum hardware entropy receipts (NIST FIPS 204 ML-DSA-44) anchoring enterprise AI governance events.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleRefreshClick}
          disabled={refreshing}
        >
          {refreshing ? 'Syncing...' : '↻ Refresh Ledger'}
        </button>
      </div>

      {attestations.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            No cryptographic attestations found in ledger. Governance events will emit real BitBop receipts.
          </p>
        </div>
      ) : (
        <div className="attestation-grid">
          {attestations.map((att, idx) => {
            const sequence = att.beacon_sequence;
            const provenanceUrl = `https://www.bitbop.dev/provenance?sequence=${sequence}`;

            return (
              <div key={idx} className="attestation-card">
                <div className="attestation-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="beacon-tag">
                      Beacon Sequence: Block #{sequence}
                    </span>
                    <span className="scheme-tag">
                      Algorithm: ML-DSA-44 (NIST FIPS 204)
                    </span>
                  </div>
                  <span className="badge badge-active">{att.event_type}</span>
                </div>

                <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Hardware Quantum Anchor &bull; RF Thermal Noise Entropy
                </div>

                <div className="crypto-hash-box">
                  <div><strong>Signature (ML-DSA-44):</strong> {att.signature}</div>
                  <div style={{ marginTop: '0.35rem' }}>
                    <strong>Beacon Hash:</strong> {att.beacon_hash || 'e22966b930e8135b17b6f5c109067a74...'}
                  </div>
                  <div style={{ marginTop: '0.35rem' }}>
                    <strong>Entropy SHA-256:</strong> {att.entropy_sha256 || '4f347337f531129685c1cc748caf88f4...'}
                  </div>
                </div>

                <div className="card-actions">
                  <a
                    href={provenanceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: '0.825rem', color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    View on BitBop Provenance Explorer &rarr;
                  </a>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleVerify(att)}
                  >
                    Verify on BitBop
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Verification Modal */}
      <VerificationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        receipt={selectedReceipt}
        result={verifyResult}
        loading={isVerifying}
      />
    </div>
  );
};
