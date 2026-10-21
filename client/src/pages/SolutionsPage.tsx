import React, { useState } from 'react';
import type { Solution } from '../types';
import { Modal } from '../components/Modal';

interface SolutionsPageProps {
  solutions: Solution[];
  onSelectSolution: (solution: Solution) => void;
  onCreateSolution: (data: {
    title: string;
    business_problem: string;
    requesting_unit: string;
    owner_name: string;
    owner_remit: string;
    risk_tier: string;
  }) => Promise<Solution>;
}

export const SolutionsPage: React.FC<SolutionsPageProps> = ({
  solutions,
  onSelectSolution,
  onCreateSolution,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [businessProblem, setBusinessProblem] = useState('');
  const [requestingUnit, setRequestingUnit] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerRemit, setOwnerRemit] = useState('');
  const [riskTier, setRiskTier] = useState('LOW');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !ownerName.trim()) {
      setError('Title and Named Owner are required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await onCreateSolution({
        title,
        business_problem: businessProblem,
        requesting_unit: requestingUnit,
        owner_name: ownerName,
        owner_remit: ownerRemit,
        risk_tier: riskTier,
      });
      setIsModalOpen(false);
      // Immediately open the newly created solution in the Working Group Workspace
      onSelectSolution(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="solutions-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Enterprise AI Solutions</h1>
          <p className="page-description">
            Business solutions governed under the Australian National AI Safety Framework.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsModalOpen(true)}
        >
          + Request Solution
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Solution Name</th>
              <th>Requesting Unit</th>
              <th>Named Owner</th>
              <th>Risk Tier</th>
              <th>Lifecycle Stage</th>
              <th>Capabilities</th>
              <th>Controls</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {solutions.map((sol) => (
              <tr key={sol.id} style={{ cursor: 'pointer' }} onClick={() => onSelectSolution(sol)}>
                <td style={{ fontWeight: 600 }}>{sol.title}</td>
                <td>{sol.requesting_unit || 'Customer Operations'}</td>
                <td>
                  <strong>{sol.owner_name}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {sol.owner_remit || 'Owner'}
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${sol.risk_tier.toLowerCase()}`}>
                    {sol.risk_tier}
                  </span>
                </td>
                <td>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                    Stage {sol.lifecycle_stage}
                  </span>
                </td>
                <td>{sol.capability_ids?.length ?? 0} linked</td>
                <td>{sol.control_ids?.length ?? 0} active</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSolution(sol);
                    }}
                  >
                    Open Workspace &rarr;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Solution Intake Modal Form */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Request a Solution (Stage 1 Intake)"
      >
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="form-group">
            <label htmlFor="solution-title" className="form-label">
              Solution Name / Title
            </label>
            <input
              id="solution-title"
              type="text"
              className="form-control"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Claims Triage Assistant"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="solution-problem" className="form-label">
              Business Problem / Problem Statement
            </label>
            <textarea
              id="solution-problem"
              className="form-control"
              rows={3}
              value={businessProblem}
              onChange={(e) => setBusinessProblem(e.target.value)}
              placeholder="Describe the operational challenge, efficiency targets, or business context..."
              required
            />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="solution-unit" className="form-label">
                Requesting Unit / Department
              </label>
              <input
                id="solution-unit"
                type="text"
                className="form-control"
                value={requestingUnit}
                onChange={(e) => setRequestingUnit(e.target.value)}
                placeholder="e.g. Customer Operations"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="solution-risk" className="form-label">
                Risk Tier / Risk Classification
              </label>
              <select
                id="solution-risk"
                className="form-select"
                value={riskTier}
                onChange={(e) => setRiskTier(e.target.value)}
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="solution-owner" className="form-label">
                Named Owner / Solution Owner
              </label>
              <input
                id="solution-owner"
                type="text"
                className="form-control"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g. Sarah Jenkins"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="solution-remit" className="form-label">
                Owner Remit / Remit
              </label>
              <input
                id="solution-remit"
                type="text"
                className="form-control"
                value={ownerRemit}
                onChange={(e) => setOwnerRemit(e.target.value)}
                placeholder="e.g. Claims Management"
                required
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Registering...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
