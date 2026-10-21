import React, { useState } from 'react';
import type { Control } from '../types';

interface ControlsPageProps {
  controls: Control[];
}

export const ControlsPage: React.FC<ControlsPageProps> = ({ controls }) => {
  const [filterPackage, setFilterPackage] = useState<string>('ALL');

  const packages = Array.from(
    new Set(controls.map((c) => c.package_name).filter(Boolean))
  );

  const filtered = filterPackage === 'ALL'
    ? controls
    : controls.filter((c) => c.package_name === filterPackage);

  return (
    <div className="controls-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Regulatory Controls Catalog</h1>
          <p className="page-description">
            Australian NAIC Voluntary AI Safety Standard (10 Guardrails with G8-DEV/DEP split) & AI6 Essential Practices (Core Object 3).
          </p>
        </div>

        <div>
          <select
            className="form-select"
            value={filterPackage}
            onChange={(e) => setFilterPackage(e.target.value)}
            style={{ width: 'auto', minWidth: '260px' }}
          >
            <option value="ALL">All Control Packages ({controls.length})</option>
            {packages.map((pkg) => (
              <option key={pkg} value={pkg}>
                {pkg}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Control Title</th>
              <th>Package / Framework</th>
              <th>Type</th>
              <th>Supply Chain Role</th>
              <th>Named Owner</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ctrl) => (
              <tr key={ctrl.id}>
                <td>
                  <strong style={{ color: 'var(--primary)', fontFamily: 'ui-monospace, monospace' }}>
                    {ctrl.code}
                  </strong>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{ctrl.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {ctrl.description}
                  </div>
                </td>
                <td>
                  <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                    {ctrl.package_name || 'Enterprise'}
                  </span>
                </td>
                <td>
                  <span className="badge badge-draft">{ctrl.control_type}</span>
                </td>
                <td>
                  <span className="badge badge-active">{ctrl.supply_chain_role}</span>
                </td>
                <td>
                  <strong>{ctrl.owner_name}</strong>
                </td>
                <td>
                  <span className={`badge badge-${ctrl.status.toLowerCase()}`}>
                    {ctrl.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
