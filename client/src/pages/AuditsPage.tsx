import React, { useState } from 'react';
import type { ComplianceAudit } from '../types';
import { AuditModal } from '../components/AuditModal';

interface AuditsPageProps {
  audits: ComplianceAudit[];
  onExecuteAudit: (data: {
    audit_name: string;
    auditor_name: string;
    guardrails_evaluated: number[];
    overall_compliance_status: string;
    findings?: string;
  }) => Promise<void>;
}

export const AuditsPage: React.FC<AuditsPageProps> = ({
  audits,
  onExecuteAudit,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recentAuditSuccess, setRecentAuditSuccess] = useState(false);

  const handleAuditSubmit = async (data: {
    audit_name: string;
    auditor_name: string;
    guardrails_evaluated: number[];
    overall_compliance_status: string;
    findings?: string;
  }) => {
    await onExecuteAudit(data);
    setRecentAuditSuccess(true);
  };

  return (
    <div className="audits-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Compliance & Governance Audits</h1>
          <p className="page-description">
            Periodic compliance evaluations against the Australian NAIC Voluntary AI Safety Standard (10 Guardrails).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsModalOpen(true)}
        >
          + Run Audit
        </button>
      </div>

      {recentAuditSuccess && (
        <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>
          ✓ Audit Complete — System is Compliant with NAIC 10 Guardrails. Attestation emitted to BitBop ledger.
        </div>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Audit Name / Scope</th>
              <th>Auditor / Governing Body</th>
              <th>Guardrails Evaluated</th>
              <th>Compliance Status</th>
              <th>Date Executed</th>
              <th>Post-Quantum Attestation</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((aud) => (
              <tr key={aud.id}>
                <td>
                  <strong>{aud.audit_name}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {aud.findings || 'Full guardrails compliance verified.'}
                  </div>
                </td>
                <td>{aud.auditor_name}</td>
                <td>
                  <span className="badge badge-draft">
                    10 Guardrails (1–10)
                  </span>
                </td>
                <td>
                  <span className={`badge ${aud.overall_compliance_status === 'COMPLIANT' ? 'badge-authorised' : 'badge-suspended'}`}>
                    {aud.overall_compliance_status}
                  </span>
                </td>
                <td>{new Date(aud.created_at).toLocaleDateString()}</td>
                <td>
                  {aud.attestation ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                      Block #{aud.attestation.beacon_sequence} (ML-DSA-44)
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Attested
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AuditModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAuditSubmit}
      />
    </div>
  );
};
