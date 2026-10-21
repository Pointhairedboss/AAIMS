import React, { useState } from 'react';
import { Modal } from './Modal';
import type { Control } from '../types';

interface ApplyPackageModalProps {
  isOpen: boolean;
  onClose: () => void;
  controls: Control[];
  onApplyPackage: (controlIds: string[]) => Promise<void>;
}

export const ApplyPackageModal: React.FC<ApplyPackageModalProps> = ({
  isOpen,
  onClose,
  controls,
  onApplyPackage,
}) => {
  const PKG_10_GUARDRAILS = 'NAIC Voluntary AI Safety Standard (May Update — 10 Guardrails)';
  const PKG_AI6_FOUNDATIONS = 'NAIC AI6 — Foundations';
  const PKG_AI6_IMPLEMENTATION = 'NAIC AI6 — Implementation Practices';

  const packages = [
    {
      id: 'pkg-10-guardrails',
      name: PKG_10_GUARDRAILS,
      displayName: 'NAIC Voluntary AI Safety Standard (May Update — 10 Guardrails)',
      description: 'Complete Australian baseline with 10 Guardrails (including Guardrail 8 Developer vs Deployer supply chain controls).',
      count: controls.filter((c) => c.package_name === PKG_10_GUARDRAILS).length,
    },
    {
      id: 'pkg-ai6-foundations',
      name: PKG_AI6_FOUNDATIONS,
      displayName: 'NAIC AI6 — Foundations',
      description: 'Foundational governance practices AI6-P1 through AI6-P3 (Risk, Privacy & Data Provenance).',
      count: controls.filter((c) => c.package_name === PKG_AI6_FOUNDATIONS).length,
    },
    {
      id: 'pkg-ai6-implementation',
      name: PKG_AI6_IMPLEMENTATION,
      displayName: 'NAIC AI6 — Implementation Practices',
      description: 'Operational safety practices AI6-P4 through AI6-P6 (Pre-flight testing, Telemetry & Incident Escalation).',
      count: controls.filter((c) => c.package_name === PKG_AI6_IMPLEMENTATION).length,
    },
  ];

  const [selectedPkg, setSelectedPkg] = useState<string>(PKG_10_GUARDRAILS);
  const [submitting, setSubmitting] = useState(false);

  const handleApply = async () => {
    setSubmitting(true);
    try {
      const targetControls = controls.filter((c) => c.package_name === selectedPkg);
      const controlIds = targetControls.map((c) => c.id);
      await onApplyPackage(controlIds);
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
      title="Apply Control Package to Solution"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApply}
            disabled={submitting || !selectedPkg}
          >
            {submitting ? 'Applying...' : 'Apply Selected'}
          </button>
        </>
      }
    >
      <div className="apply-package-content">
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Attach a recognized Australian NAIC regulatory framework or safety package in bulk (Gate Invariant 1b).
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {packages.map((pkg) => {
            const isSelected = selectedPkg === pkg.name;
            return (
              <div
                key={pkg.id}
                onClick={() => setSelectedPkg(pkg.name)}
                style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                  backgroundColor: isSelected ? 'var(--primary-subtle)' : '#ffffff',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: isSelected ? 'var(--primary)' : 'var(--text-main)' }}>
                    {pkg.displayName}
                  </span>
                  <span className="badge badge-active">{pkg.count || 11} Controls</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {pkg.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
