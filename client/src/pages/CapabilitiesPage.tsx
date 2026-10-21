import React, { useState } from 'react';
import type { Capability, Control } from '../types';
import { Modal } from '../components/Modal';

interface CapabilitiesPageProps {
  capabilities: Capability[];
  controls: Control[];
  onCreateCapability: (data: {
    name: string;
    description: string;
    provider_or_tech: string;
    owner_name: string;
    status: string;
  }) => Promise<void>;
  onUpdateStatus: (id: string, status: string) => Promise<void>;
  onLinkControls: (id: string, controlIds: string[]) => Promise<void>;
}

export const CapabilitiesPage: React.FC<CapabilitiesPageProps> = ({
  capabilities,
  controls,
  onCreateCapability,
  onUpdateStatus,
  onLinkControls,
}) => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [providerOrTech, setProviderOrTech] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Link controls modal state
  const [selectedCap, setSelectedCap] = useState<Capability | null>(null);
  const [selectedControlIds, setSelectedControlIds] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);

  const handleOpenLinkModal = (cap: Capability) => {
    setSelectedCap(cap);
    setSelectedControlIds(cap.control_ids || []);
  };

  const handleToggleControl = (ctrlId: string) => {
    setSelectedControlIds((prev) =>
      prev.includes(ctrlId) ? prev.filter((id) => id !== ctrlId) : [...prev, ctrlId]
    );
  };

  const handleSaveControls = async () => {
    if (!selectedCap) return;
    setLinking(true);
    try {
      await onLinkControls(selectedCap.id, selectedControlIds);
      setSelectedCap(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLinking(false);
    }
  };

  const handleStatusChange = async (cap: Capability, newStatus: string) => {
    setError(null);
    try {
      await onUpdateStatus(cap.id, newStatus);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Cannot update status: ${msg}`);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ownerName.trim()) {
      setError('Capability name and Named Owner are required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onCreateCapability({
        name,
        description,
        provider_or_tech: providerOrTech,
        owner_name: ownerName,
        status,
      });
      setIsCreateModalOpen(false);
      setName('');
      setDescription('');
      setProviderOrTech('');
      setOwnerName('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="capabilities-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Capabilities Registry</h1>
          <p className="page-description">
            Reusable AI models, foundation providers, and multimodal processing pipelines (Core Object 2).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsCreateModalOpen(true)}
        >
          + New Capability
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>
          ⚠️ {error}
        </div>
      )}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Capability Name</th>
              <th>Provider / Technology</th>
              <th>Accountable Owner</th>
              <th>Governance Status</th>
              <th>Active Controls</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((cap) => {
              const activeControlsCount = controls.filter(
                (c) => cap.control_ids?.includes(c.id) && c.status === 'ACTIVE'
              ).length;

              return (
                <tr key={cap.id}>
                  <td>
                    <strong>{cap.name}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {cap.description}
                    </div>
                  </td>
                  <td>{cap.provider_or_tech || 'Enterprise ML Platform'}</td>
                  <td>
                    <strong>{cap.owner_name}</strong>
                  </td>
                  <td>
                    <span className={`badge badge-${cap.status.toLowerCase()}`}>
                      {cap.status}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{activeControlsCount} active</span>
                    {activeControlsCount === 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#b91c1c' }}>
                        Ungoverned (Cannot authorise)
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenLinkModal(cap)}
                      >
                        Attach Controls
                      </button>

                      {cap.status === 'DRAFT' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleStatusChange(cap, 'AUTHORISED')}
                        >
                          Authorise
                        </button>
                      )}

                      {cap.status === 'AUTHORISED' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleStatusChange(cap, 'SUSPENDED')}
                        >
                          Suspend
                        </button>
                      )}

                      {cap.status === 'SUSPENDED' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleStatusChange(cap, 'AUTHORISED')}
                        >
                          Re-Authorise
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Capability Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Register New AI Capability"
      >
        <form onSubmit={handleCreateSubmit}>
          <div className="form-group">
            <label htmlFor="cap-name" className="form-label">
              Capability Name
            </label>
            <input
              id="cap-name"
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Multimodal Claims Classifier"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cap-desc" className="form-label">
              Description
            </label>
            <textarea
              id="cap-desc"
              className="form-control"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Technical summary of the model or service..."
            />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="cap-provider" className="form-label">
                Provider / Underlying Tech
              </label>
              <input
                id="cap-provider"
                type="text"
                className="form-control"
                value={providerOrTech}
                onChange={(e) => setProviderOrTech(e.target.value)}
                placeholder="e.g. AWS Bedrock / Claude 3.5"
              />
            </div>

            <div className="form-group">
              <label htmlFor="cap-status" className="form-label">
                Initial Status
              </label>
              <select
                id="cap-status"
                className="form-select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="DRAFT">DRAFT</option>
                <option value="AUTHORISED">AUTHORISED</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="cap-owner" className="form-label">
              Accountable Named Owner
            </label>
            <input
              id="cap-owner"
              type="text"
              className="form-control"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g. Dr. Liam Patel"
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Register Capability'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Attach Controls Modal */}
      <Modal
        isOpen={Boolean(selectedCap)}
        onClose={() => setSelectedCap(null)}
        title={`Attach Controls to "${selectedCap?.name}"`}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setSelectedCap(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSaveControls}
              disabled={linking}
            >
              {linking ? 'Saving...' : 'Save Controls'}
            </button>
          </>
        }
      >
        <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {controls.map((ctrl) => {
            const isChecked = selectedControlIds.includes(ctrl.id);
            return (
              <label
                key={ctrl.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                  backgroundColor: isChecked ? 'var(--primary-subtle)' : '#fff',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleControl(ctrl.id)}
                  style={{ marginTop: '0.2rem' }}
                />
                <div style={{ flex: 1 }}>
                  <div>
                    <strong>{ctrl.code}</strong> — {ctrl.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {ctrl.package_name} &bull; {ctrl.supply_chain_role}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};
