import React, { useState } from 'react';
import { Modal } from './Modal';
import type { Breach } from '../types';

interface RemediationModalProps {
  isOpen: boolean;
  onClose: () => void;
  breach: Breach | null;
  onSubmit: (data: {
    breach_id: string;
    remediation_summary: string;
    verified_by: string;
  }) => Promise<void>;
}

export const RemediationModal: React.FC<RemediationModalProps> = ({
  isOpen,
  onClose,
  breach,
  onSubmit,
}) => {
  const [summary, setSummary] = useState('');
  const [verifiedBy, setVerifiedBy] = useState('Elena Rostova, Chief Privacy Officer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!breach || !summary.trim()) {
      setError('Remediation summary is required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        breach_id: breach.id,
        remediation_summary: summary,
        verified_by: verifiedBy,
      });
      setSummary('');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !breach) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Submit Incident Remediation"
    >
      <form onSubmit={handleSubmit}>
        {error && <div className="alert alert-danger">{error}</div>}

        <div style={{ marginBottom: '1rem', backgroundColor: 'var(--bg-subtle)', padding: '0.75rem', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Remediating Incident:</div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{breach.title}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Severity: {breach.severity} &bull; Entity: {breach.affected_entity_type} ({breach.affected_entity_id || 'N/A'})
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="remediation-summary" className="form-label">
            Remediation Action Plan / Summary
          </label>
          <textarea
            id="remediation-summary"
            className="form-control"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Describe technical sanitizer, policy update, or mitigation deployed..."
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="remediation-verifier" className="form-label">
            Verified By
          </label>
          <input
            id="remediation-verifier"
            type="text"
            className="form-control"
            value={verifiedBy}
            onChange={(e) => setVerifiedBy(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Confirm'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
