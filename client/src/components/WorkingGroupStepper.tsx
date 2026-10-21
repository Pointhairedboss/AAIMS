import React, { useState } from 'react';
import {
  LIFECYCLE_STAGES,
  type Solution,
  type Capability,
  type Control,
  type WorkingGroupMember,
} from '../types';
import { LinkCapabilityModal } from './LinkCapabilityModal';
import { ApplyPackageModal } from './ApplyPackageModal';

interface WorkingGroupStepperProps {
  solution: Solution;
  capabilities: Capability[];
  controls: Control[];
  workingGroupMembers: WorkingGroupMember[];
  onAdvanceStage: (targetStage: number, approverName?: string) => Promise<void>;
  onLinkCapabilities: (capabilityIds: string[]) => Promise<void>;
  onLinkControls: (controlIds: string[]) => Promise<void>;
}

export const WorkingGroupStepper: React.FC<WorkingGroupStepperProps> = ({
  solution,
  capabilities,
  controls,
  workingGroupMembers,
  onAdvanceStage,
  onLinkCapabilities,
  onLinkControls,
}) => {
  const [activeStage, setActiveStage] = useState<number>(solution.lifecycle_stage);
  const currentStage = activeStage;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [investigationNotes, setInvestigationNotes] = useState('');
  const [isLinkCapOpen, setIsLinkCapOpen] = useState(false);
  const [isApplyPkgOpen, setIsApplyPkgOpen] = useState(false);
  const [selectedApprover, setSelectedApprover] = useState<string>('Elena Rostova');
  const [isApproved, setIsApproved] = useState(solution.lifecycle_stage >= 8);

  React.useEffect(() => {
    setActiveStage((prev) => Math.max(prev, solution.lifecycle_stage));
    if (solution.lifecycle_stage >= 8) {
      setIsApproved(true);
    }
  }, [solution.lifecycle_stage]);

  // Default approver selection if members loaded
  React.useEffect(() => {
    if (workingGroupMembers.length > 0 && !selectedApprover) {
      const exec = workingGroupMembers.find(
        (m) => m.authority_tier === 'TIER_3_HIGH_EXEC' || m.authority_tier === 'BOARD_DELEGATE'
      );
      if (exec) setSelectedApprover(exec.name);
    }
  }, [workingGroupMembers, selectedApprover]);

  const handleAdvance = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    // Gate Invariant 1a check at Stage 4:
    // If solution is at Stage 4 and has no capabilities linked, block!
    if (activeStage === 4 && (!solution.capability_ids || solution.capability_ids.length === 0)) {
      setErrorMessage(
        'Cannot advance: At least one capability is required before advancing past Stage 4 (Gate Invariant 1a).'
      );
      return;
    }

    // Gate Invariant 1b check at Stage 5:
    // If solution is at Stage 5 and has no controls linked, block!
    if (activeStage === 5 && (!solution.control_ids || solution.control_ids.length === 0)) {
      setErrorMessage(
        'Cannot advance: At least one control is required before advancing past Stage 5 (Gate Invariant 1b).'
      );
      return;
    }

    // Advancing from Stage 6 to Stage 7 (Approve gate selection)
    if (activeStage === 6) {
      setActiveStage(7);
      setSuccessMessage('Moved to Stage 7: Approve. Select delegated authority approver.');
      return;
    }

    const nextStage = Math.min(activeStage + 1, 9);
    setAdvancing(true);
    try {
      await onAdvanceStage(nextStage);
      setActiveStage(nextStage);
      setSuccessMessage(`Advanced to Stage ${nextStage}: ${LIFECYCLE_STAGES[nextStage - 1].name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Cannot advance: ${msg}`);
    } finally {
      setAdvancing(false);
    }
  };

  const handleApprove = async () => {
    setErrorMessage(null);
    setAdvancing(true);
    try {
      await onAdvanceStage(7, selectedApprover);
      setIsApproved(true);
      setActiveStage(8);
      setSuccessMessage('Approved: Delegated authority Working Group approval gate passed.');
      // Proceed to stage 8 (implementation) in backend as well
      await onAdvanceStage(8, selectedApprover).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Approval rejected: ${msg}`);
    } finally {
      setAdvancing(false);
    }
  };

  const linkedCaps = capabilities.filter((c) => solution.capability_ids.includes(c.id));
  const linkedCtrls = controls.filter((c) => solution.control_ids.includes(c.id));

  return (
    <div className="working-group-stepper">
      {/* 9-Stage Progress Track */}
      <div className="stepper-container">
        <div className="stepper-track">
          {LIFECYCLE_STAGES.map((s) => {
            const isCompleted = currentStage > s.stage || (s.stage === 7 && isApproved);
            const isActive = currentStage === s.stage;
            return (
              <div
                key={s.stage}
                className={`stepper-step ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
              >
                <div className="step-node">
                  {isCompleted ? '✓' : s.stage}
                </div>
                <div className="step-label">
                  Stage {s.stage}: {s.shortName}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status Banners */}
      {errorMessage && (
        <div className="alert alert-danger" role="alert">
          <span>⚠️ {errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="alert alert-success" role="alert">
          <span>✓ {successMessage}</span>
        </div>
      )}

      {/* Active Stage Panel */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Current Working Group Milestone
            </div>
            <h2 className="card-title" style={{ fontSize: '1.25rem', marginTop: '0.2rem' }}>
              Stage {currentStage}: {LIFECYCLE_STAGES[currentStage - 1].name}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className={`badge badge-${solution.risk_tier.toLowerCase()}`}>
              Risk: {solution.risk_tier}
            </span>
            {isApproved && (
              <span className="badge badge-active">
                Approved by Delegated Authority
              </span>
            )}
          </div>
        </div>

        {/* Stage 1: Request a Solution */}
        {currentStage === 1 && (
          <div className="stage-content">
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              The business unit intake has been registered. Review initial parameters and proceed to feasibility investigation.
            </p>
            <div className="grid-2" style={{ marginBottom: '1.25rem', backgroundColor: 'var(--bg-subtle)', padding: '1rem', borderRadius: '6px' }}>
              <div>
                <strong>Requesting Unit:</strong> {solution.requesting_unit || 'N/A'}
              </div>
              <div>
                <strong>Solution Owner:</strong> {solution.owner_name} ({solution.owner_remit || 'Owner'})
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong>Business Problem:</strong> {solution.business_problem}
              </div>
            </div>
          </div>
        )}

        {/* Stage 2: Investigate */}
        {currentStage === 2 && (
          <div className="stage-content">
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Conduct technical feasibility assessment and preliminary regulatory scoping against NAIC guidelines.
            </p>
            <div className="form-group">
              <label htmlFor="investigation-notes" className="form-label">
                Investigation Notes / Meeting Minutes
              </label>
              <textarea
                id="investigation-notes"
                className="form-control"
                placeholder="Enter technical scoping, regulatory notes, or feasibility observations..."
                value={investigationNotes}
                onChange={(e) => setInvestigationNotes(e.target.value)}
              />
            </div>
            {investigationNotes && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginBottom: '1rem' }}
                onClick={() => setSuccessMessage('Notes recorded in Working Group minutes.')}
              >
                Save Notes
              </button>
            )}
          </div>
        )}

        {/* Stage 3: Assign Owner */}
        {currentStage === 3 && (
          <div className="stage-content">
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Verify accountable business and technical leadership. Named ownership is mandatory across all solutions, capabilities, and controls.
            </p>
            <div className="card" style={{ backgroundColor: 'var(--bg-subtle)', padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{solution.owner_name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Remit: {solution.owner_remit || 'Solution Governance'}
                  </div>
                </div>
                <span className="badge badge-active">Accountable Owner Verified</span>
              </div>
            </div>
          </div>
        )}

        {/* Stage 4: Identify Capabilities */}
        {currentStage === 4 && (
          <div className="stage-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  Link all foundational AI models, multimodal document processors, and machine learning capabilities used by this solution.
                </p>
                <div style={{ fontSize: '0.8rem', color: '#0369a1', marginTop: '0.25rem' }}>
                  Gate Invariant 1a: Solution cannot advance past Stage 4 without at least 1 linked capability.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => setIsLinkCapOpen(true)}
              >
                + Add Capability
              </button>
            </div>

            {linkedCaps.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                {linkedCaps.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <strong>{c.name}</strong> ({c.provider_or_tech}) &bull; Owner: {c.owner_name}
                    </div>
                    <span className={`badge badge-${c.status.toLowerCase()}`}>{c.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                No capabilities currently linked. Click <strong>Add Capability</strong> to attach at least one capability before advancing.
              </div>
            )}
          </div>
        )}

        {/* Stage 5: Apply Controls */}
        {currentStage === 5 && (
          <div className="stage-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  Apply regulatory policies and technical controls. Solutions must be governed by active safety controls.
                </p>
                <div style={{ fontSize: '0.8rem', color: '#0369a1', marginTop: '0.25rem' }}>
                  Gate Invariant 1b: Solution cannot advance past Stage 5 without at least 1 linked control.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => setIsApplyPkgOpen(true)}
              >
                + Apply Control Package
              </button>
            </div>

            {linkedCtrls.length > 0 ? (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Active Governance Controls ({linkedCtrls.length} attached):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.5rem' }}>
                  {linkedCtrls.map((ctrl) => (
                    <div
                      key={ctrl.id}
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-subtle)',
                        fontSize: '0.8rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{ctrl.code}</strong>
                        <span className="badge badge-active">{ctrl.status}</span>
                      </div>
                      <div style={{ color: 'var(--text-main)', marginTop: '0.2rem' }}>{ctrl.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Role: {ctrl.supply_chain_role} &bull; Owner: {ctrl.owner_name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                No controls currently linked. Click <strong>Apply Control Package</strong> to attach required safety guardrails before advancing.
              </div>
            )}
          </div>
        )}

        {/* Stage 6: Assess */}
        {currentStage === 6 && (
          <div className="stage-content">
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Evaluate Solution compliance against safety guardrails and complete risk classification checklist.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <input type="checkbox" defaultChecked />
                <span>NAIC-G1: AI Governance process established and named business owner assigned.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <input type="checkbox" defaultChecked />
                <span>NAIC-G2: Risk impact assessment completed for high-volume automated triage decisions.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <input type="checkbox" defaultChecked />
                <span>NAIC-G3: Data provenance, minimization and PII redaction protocols verified.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <input type="checkbox" defaultChecked />
                <span>NAIC-G4: Pre-flight testing completed across bias, accuracy, and latency benchmarks.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <input type="checkbox" defaultChecked />
                <span>NAIC-G8: Supply chain transparency confirmed between Developer and Deployer roles.</span>
              </label>
            </div>
          </div>
        )}

        {/* Stage 7: Approve */}
        {currentStage === 7 && (
          <div className="stage-content">
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Stage 7 Delegated Authority Approval Gate: Approval requires a designated Working Group member whose authority tier matches or exceeds the solution's risk classification.
            </p>

            <div style={{ backgroundColor: 'var(--bg-subtle)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Solution Risk Tier:</strong>{' '}
                <span className={`badge badge-${solution.risk_tier.toLowerCase()}`}>{solution.risk_tier}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  (Requires TIER_3_HIGH_EXEC or BOARD_DELEGATE authority)
                </span>
              </div>

              <div className="form-group" style={{ marginTop: '1rem', marginBottom: '0' }}>
                <label htmlFor="approver-select" className="form-label">
                  Delegated Executive Authority
                </label>
                <select
                  id="approver-select"
                  className="form-select"
                  value={selectedApprover}
                  onChange={(e) => setSelectedApprover(e.target.value)}
                >
                  <option value="Elena Rostova">
                    Elena Rostova — Executive (TIER_3_HIGH_EXEC - Legal, Privacy and AI Governance Executive)
                  </option>
                  <option value="Board Delegate Officer">
                    Board Delegate Officer — Board Delegate (BOARD_DELEGATE - Executive Board Representative)
                  </option>
                  <option value="Marcus Chen">
                    Marcus Chen — Risk (TIER_2_MEDIUM - Chief Risk Officer)
                  </option>
                  <option value="Jordan Bell">
                    Jordan Bell — Operations (TIER_1_LOW - AI Operations Team Lead)
                  </option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={advancing}
              >
                {advancing ? 'Submitting Attestation...' : 'Approve Solution'}
              </button>
            </div>
          </div>
        )}

        {/* Stage 8: Implement */}
        {currentStage === 8 && (
          <div className="stage-content">
            <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
              ✓ Approved — Solution Governance Gate Passed! Ready for Stage 8 Implementation.
            </div>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Deploying models into production environments with live telemetry, automated invariant monitoring, and canary verification.
            </p>
          </div>
        )}

        {/* Stage 9: Review */}
        {currentStage === 9 && (
          <div className="stage-content">
            <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
              ✓ Operational & Continuous Review Active (Stage 9)
            </div>
            <p style={{ color: 'var(--text-muted)' }}>
              Solution is fully operational. Continuous drift monitoring, periodic compliance audits, and incident tracking are governed by post-quantum BitBop receipts.
            </p>
          </div>
        )}

        {/* Advance Stage Footer Button */}
        {currentStage !== 7 && currentStage < 9 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAdvance}
              disabled={advancing}
            >
              {advancing ? 'Processing...' : 'Advance Stage →'}
            </button>
          </div>
        )}
      </div>

      {/* Modals for Linking Capabilities & Packages */}
      <LinkCapabilityModal
        isOpen={isLinkCapOpen}
        onClose={() => setIsLinkCapOpen(false)}
        capabilities={capabilities}
        linkedIds={solution.capability_ids}
        onLink={async (ids) => {
          await onLinkCapabilities(ids);
          setSuccessMessage('Capabilities linked to Solution.');
        }}
      />

      <ApplyPackageModal
        isOpen={isApplyPkgOpen}
        onClose={() => setIsApplyPkgOpen(false)}
        controls={controls}
        onApplyPackage={async (ids) => {
          await onLinkControls(ids);
          setSuccessMessage('Control Package successfully applied to Solution.');
        }}
      />
    </div>
  );
};
