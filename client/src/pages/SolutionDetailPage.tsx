import React, { useState } from 'react';
import type {
  Solution,
  Capability,
  Control,
  WorkingGroupMember,
  Breach,
} from '../types';
import { WorkingGroupStepper } from '../components/WorkingGroupStepper';
import { BreachModal } from '../components/BreachModal';
import { RemediationModal } from '../components/RemediationModal';

interface SolutionDetailPageProps {
  solution: Solution;
  capabilities: Capability[];
  controls: Control[];
  workingGroupMembers: WorkingGroupMember[];
  breaches: Breach[];
  onBack: () => void;
  onAdvanceStage: (targetStage: number, approverName?: string) => Promise<void>;
  onLinkCapabilities: (capabilityIds: string[]) => Promise<void>;
  onLinkControls: (controlIds: string[]) => Promise<void>;
  onLogBreach: (data: {
    title: string;
    severity: string;
    affected_entity_type: string;
    affected_entity_id: string;
    description: string;
    reported_by: string;
  }) => Promise<void>;
  onSubmitRemediation: (data: {
    breach_id: string;
    remediation_summary: string;
    verified_by: string;
  }) => Promise<void>;
}

export const SolutionDetailPage: React.FC<SolutionDetailPageProps> = ({
  solution,
  capabilities,
  controls,
  workingGroupMembers,
  breaches,
  onBack,
  onAdvanceStage,
  onLinkCapabilities,
  onLinkControls,
  onLogBreach,
  onSubmitRemediation,
}) => {
  const [isBreachModalOpen, setIsBreachModalOpen] = useState(false);
  const [selectedBreachForRemediation, setSelectedBreachForRemediation] = useState<Breach | null>(null);

  const solutionBreaches = breaches.filter(
    (b) => b.affected_entity_id === solution.id || b.affected_entity_type === 'SOLUTION'
  );

  return (
    <div className="solution-detail-page">
      {/* Top Breadcrumb & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
          &larr; Back to Solutions
        </button>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setIsBreachModalOpen(true)}
          >
            Log Incident / Report Breach
          </button>
        </div>
      </div>

      {/* Solution Header Card */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              AI Solution Workspace &bull; ID: {solution.id}
            </div>
            <h1 className="page-title" style={{ marginTop: '0.2rem', marginBottom: '0.5rem' }}>
              {solution.title}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '800px' }}>
              {solution.business_problem}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
            <span className={`badge badge-${solution.risk_tier.toLowerCase()}`}>
              Risk: {solution.risk_tier}
            </span>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Unit: <strong>{solution.requesting_unit || 'Customer Operations'}</strong>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Owner: <strong>{solution.owner_name}</strong> ({solution.owner_remit || 'Owner'})
            </div>
          </div>
        </div>
      </div>

      {/* 9-Stage Working Group Stepper */}
      <WorkingGroupStepper
        solution={solution}
        capabilities={capabilities}
        controls={controls}
        workingGroupMembers={workingGroupMembers}
        onAdvanceStage={onAdvanceStage}
        onLinkCapabilities={onLinkCapabilities}
        onLinkControls={onLinkControls}
      />

      {/* Governance Incidents & Safety Breaches Ledger */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <div>
            <h3 className="card-title" style={{ fontSize: '1.1rem' }}>
              Governance Safety Incidents & Breach Notifications
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Logged incident reports, safety telemetry anomalies, and attested remediation records.
            </p>
          </div>
        </div>

        {solutionBreaches.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {solutionBreaches.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: '1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  backgroundColor: b.status === 'RESOLVED' ? '#f0fdf4' : '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '0.95rem' }}>{b.title}</strong>
                      <span className={`badge badge-${b.severity.toLowerCase()}`}>{b.severity}</span>
                      <span className={`badge ${b.status === 'RESOLVED' ? 'badge-authorised' : 'badge-suspended'}`}>
                        {b.status === 'RESOLVED' ? 'REMEDIATED' : b.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      {b.description}
                    </p>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>
                      Reported by: <strong>{b.reported_by}</strong> &bull; Incident Logged &bull; ID: {b.id}
                    </div>
                  </div>

                  <div>
                    {b.status !== 'RESOLVED' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedBreachForRemediation(b)}
                      >
                        Resolve
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#047857', fontWeight: 600 }}>
                        ✓ Remediation Submitted & Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No safety incidents or breach notifications currently logged for this solution.
          </p>
        )}
      </div>

      {/* Modals */}
      <BreachModal
        isOpen={isBreachModalOpen}
        onClose={() => setIsBreachModalOpen(false)}
        entityType="SOLUTION"
        entityId={solution.id}
        onSubmit={onLogBreach}
      />

      <RemediationModal
        isOpen={Boolean(selectedBreachForRemediation)}
        onClose={() => setSelectedBreachForRemediation(null)}
        breach={selectedBreachForRemediation}
        onSubmit={onSubmitRemediation}
      />
    </div>
  );
};
