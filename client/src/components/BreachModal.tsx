import React, { useState } from 'react';
import { Modal } from './Modal';

interface BreachModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType?: 'SOLUTION' | 'CAPABILITY' | 'CONTROL';
  entityId?: string;
  onSubmit: (data: {
    title: string;
    severity: string;
    affected_entity_type: string;
    affected_entity_id: string;
    description: string;
    reported_by: string;
  }) => Promise<void>;
}

export const BreachModal: React.FC<BreachModalProps> = ({
  isOpen,
  onClose,
  entityType = 'SOLUTION',
  entityId = '',
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('HIGH');
  const [description, setDescription] = useState('');
  const [reportedBy, setReportedBy] = useState('AI Safety Incident Team');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        title,
        severity,
        affected_entity_type: entityType,
        affected_entity_id: entityId,
        description,
        reported_by: reportedBy,
      });
      setTitle('');
      setDescription('');
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
      title="Log Safety Incident / Breach Notification"
    >
      <form onSubmit={handleSubmit}>
        {error && <div className="alert alert-danger">{error}</div>}

        <div className="form-group">
          <label htmlFor="incident-title" className="form-label">
            Title / Incident Name
          </label>
          <input
            id="incident-title"
            type="text"
            className="form-control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Model Output Hallucination Breach"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="incident-severity" className="form-label">
            Severity
          </label>
          <select
            id="incident-severity"
            className="form-select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="incident-desc" className="form-label">
            Description
          </label>
          <textarea
            id="incident-desc"
            className="form-control"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the safety, privacy, or model behavior event..."
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="incident-reporter" className="form-label">
            Reported By
          </label>
          <input
            id="incident-reporter"
            type="text"
            className="form-control"
            value={reportedBy}
            onChange={(e) => setReportedBy(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={submitting}>
            {submitting ? 'Logging Breach...' : 'Submit Incident'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
