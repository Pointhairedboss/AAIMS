import React, { useState } from 'react';
import { Modal } from './Modal';

interface AuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    audit_name: string;
    auditor_name: string;
    guardrails_evaluated: number[];
    overall_compliance_status: string;
    findings?: string;
  }) => Promise<void>;
}

export const AuditModal: React.FC<AuditModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [auditName, setAuditName] = useState('NAIC Annual AI Safety & Guardrails Audit');
  const [auditorName, setAuditorName] = useState('Board Audit & Risk Committee');
  const [overallStatus, setOverallStatus] = useState('COMPLIANT');
  const [findings, setFindings] = useState('All 10 NAIC Guardrails evaluated. Technical controls active.');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        audit_name: auditName,
        auditor_name: auditorName,
        guardrails_evaluated: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        overall_compliance_status: overallStatus,
        findings,
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Execute Compliance Audit"
    >
      <form onSubmit={handleSubmit}>
        {error && <div className="alert alert-danger">{error}</div>}

        <div className="form-group">
          <label htmlFor="audit-name" className="form-label">
            Audit Name / Scope
          </label>
          <input
            id="audit-name"
            type="text"
            className="form-control"
            value={auditName}
            onChange={(e) => setAuditName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="auditor-name" className="form-label">
            Auditor / Governing Body
          </label>
          <input
            id="auditor-name"
            type="text"
            className="form-control"
            value={auditorName}
            onChange={(e) => setAuditorName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="audit-status" className="form-label">
            Compliance Status
          </label>
          <select
            id="audit-status"
            className="form-select"
            value={overallStatus}
            onChange={(e) => setOverallStatus(e.target.value)}
          >
            <option value="COMPLIANT">COMPLIANT</option>
            <option value="ACTION_REQUIRED">ACTION_REQUIRED</option>
            <option value="NON_COMPLIANT">NON_COMPLIANT</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="audit-findings" className="form-label">
            Audit Findings & Evaluated Guardrails
          </label>
          <textarea
            id="audit-findings"
            className="form-control"
            rows={3}
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
            Scope: Evaluates all 10 NAIC Guardrails & cryptographic proof issuance via BitBop.
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Executing Audit...' : 'Submit Audit'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
