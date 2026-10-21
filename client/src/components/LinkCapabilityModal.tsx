import React, { useState } from 'react';
import { Modal } from './Modal';
import type { Capability } from '../types';

interface LinkCapabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  capabilities: Capability[];
  linkedIds: string[];
  onLink: (selectedIds: string[]) => Promise<void>;
}

export const LinkCapabilityModal: React.FC<LinkCapabilityModalProps> = ({
  isOpen,
  onClose,
  capabilities,
  linkedIds,
  onLink,
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Initialize or reset selections when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setSelected(linkedIds.length > 0 ? linkedIds : (capabilities[0] ? [capabilities[0].id] : []));
    }
  }, [isOpen, linkedIds, capabilities]);

  const toggleSelection = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleConfirm = async () => {
    if (selected.length === 0) return;
    setSubmitting(true);
    try {
      await onLink(selected);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Link Capabilities to Solution"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={submitting || selected.length === 0}
          >
            {submitting ? 'Linking...' : 'Link Selected'}
          </button>
        </>
      }
    >
      <div className="link-capabilities-content">
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Select the AI models, pipelines, and technical capabilities required by this solution (Gate Invariant 1a).
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
          {capabilities.map((cap) => {
            const isChecked = selected.includes(cap.id);
            return (
              <label
                key={cap.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                  backgroundColor: isChecked ? 'var(--primary-subtle)' : '#ffffff',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  role="checkbox"
                  checked={isChecked}
                  onChange={() => toggleSelection(cap.id)}
                  style={{ marginTop: '0.2rem' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{cap.name}</span>
                    <span className={`badge badge-${cap.status.toLowerCase()}`}>{cap.status}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {cap.description}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>
                    Provider/Tech: <strong>{cap.provider_or_tech || 'Enterprise ML'}</strong> &bull; Owner: <strong>{cap.owner_name}</strong>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
