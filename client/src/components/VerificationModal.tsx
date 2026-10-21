import React from 'react';
import { Modal } from './Modal';
import type { BitBopReceipt, VerificationResult } from '../types';

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: BitBopReceipt | null;
  result: VerificationResult | null;
  loading: boolean;
}

export const VerificationModal: React.FC<VerificationModalProps> = ({
  isOpen,
  onClose,
  receipt,
  result,
  loading,
}) => {
  if (!isOpen || !receipt) return null;

  const sequence = receipt.beacon_sequence;
  const provenanceUrl = typeof sequence === 'number' || Boolean(sequence)
    ? `https://www.bitbop.dev/provenance?sequence=${sequence}`
    : 'https://www.bitbop.dev/provenance';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="BitBop Post-Quantum Cryptographic Verification"
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="verification-content">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Querying live BitBop Edge Verification API (POST /verify)...
            </p>
          </div>
        ) : result ? (
          <div>
            <div
              className={`alert ${result.valid ? 'alert-success' : 'alert-danger'}`}
              style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
            >
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                {result.valid ? '✓ CRYPTOGRAPHICALLY VALID' : '✗ VERIFICATION FAILED'}
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                {result.valid
                  ? 'valid: true (Verified via NIST FIPS 204 ML-DSA-44)'
                  : 'valid: false (Cryptographic check failed)'}
              </div>
            </div>

            {result.error && (
              <div className="alert alert-danger" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                <strong>Verification Error:</strong> {result.error}
              </div>
            )}

            <div style={{ margin: '1rem 0' }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Attestation Details
              </h3>
              <table style={{ width: '100%', fontSize: '0.825rem', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '0.35rem 0', color: 'var(--text-muted)' }}>Beacon Sequence:</td>
                    <td style={{ padding: '0.35rem 0', fontWeight: 600 }}>
                      {typeof sequence === 'number' || Boolean(sequence) ? `Block #${sequence}` : 'Unknown'}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.35rem 0', color: 'var(--text-muted)' }}>Signature Scheme:</td>
                    <td style={{ padding: '0.35rem 0', fontWeight: 600 }}>
                      {receipt.signature_scheme || 'ml-dsa-44'} (NIST FIPS 204)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.35rem 0', color: 'var(--text-muted)' }}>Event Type:</td>
                    <td style={{ padding: '0.35rem 0', fontWeight: 600 }}>{receipt.event_type}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {result.checks && (
              <div style={{ margin: '1rem 0', backgroundColor: 'var(--bg-subtle)', padding: '0.75rem', borderRadius: '4px' }}>
                <h4 style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  5-Point Cryptographic Integrity Checks
                </h4>
                <ul style={{ listStyle: 'none', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <li>{result.checks.beacon_exists ? '✓' : '✗'} Beacon Exists on Hardware Bus: {result.checks.beacon_exists ? 'PASS' : 'FAIL'}</li>
                  <li>{result.checks.beacon_hash_match ? '✓' : '✗'} Beacon Hash Match: {result.checks.beacon_hash_match ? 'PASS' : 'FAIL'}</li>
                  <li>{result.checks.beacon_signature_valid ? '✓' : '✗'} Quantum Beacon Signature: {result.checks.beacon_signature_valid ? 'PASS' : 'FAIL'}</li>
                  <li>{result.checks.entropy_bound_to_beacon ? '✓' : '✗'} Thermal Entropy Bound: {result.checks.entropy_bound_to_beacon ? 'PASS' : 'FAIL'}</li>
                  <li>{result.checks.receipt_signature_valid ? '✓' : '✗'} ML-DSA-44 Receipt Signature: {result.checks.receipt_signature_valid ? 'PASS' : 'FAIL'}</li>
                </ul>
              </div>
            )}

            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <a
                href={provenanceUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline-primary btn-sm"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Inspect on BitBop Provenance Explorer &rarr;
              </a>
            </div>
          </div>
        ) : (
          <div className="alert alert-warning">No verification result returned.</div>
        )}
      </div>
    </Modal>
  );
};
