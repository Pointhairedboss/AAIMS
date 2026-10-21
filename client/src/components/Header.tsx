import React from 'react';

interface HeaderProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentTab, onNavigate }) => {
  return (
    <header className="app-header">
      <div className="header-container">
        <div
          className="brand-wrapper"
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('solutions')}
        >
          <div className="brand-icon">A</div>
          <div className="brand-text">
            <h1>AAIMS | Australian AI Management & Safety Interface (AIMI)</h1>
            <span>Enterprise AI Safety & Post-Quantum Verification</span>
          </div>
        </div>

        <div className="header-nav">
          <ul className="nav-links">
            <li className={`nav-item ${currentTab === 'solutions' || currentTab === 'solution-detail' ? 'active' : ''}`}>
              <a
                href="#solutions"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('solutions');
                }}
              >
                Solutions
              </a>
            </li>
            <li className={`nav-item ${currentTab === 'capabilities' ? 'active' : ''}`}>
              <a
                href="#capabilities"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('capabilities');
                }}
              >
                Capabilities
              </a>
            </li>
            <li className={`nav-item ${currentTab === 'controls' ? 'active' : ''}`}>
              <a
                href="#controls"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('controls');
                }}
              >
                Controls
              </a>
            </li>
            <li className={`nav-item ${currentTab === 'attestations' ? 'active' : ''}`}>
              <a
                href="#attestations"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('attestations');
                }}
              >
                Attestation Ledger
              </a>
            </li>
            <li className={`nav-item ${currentTab === 'audits' ? 'active' : ''}`}>
              <a
                href="#audits"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('audits');
                }}
              >
                Compliance Audits
              </a>
            </li>
          </ul>
        </div>

        <div className="header-actions">
          <div className="quantum-status-pill" title="Hardware Entropy Beacon Active (ML-DSA-44)">
            <span className="pulse-dot"></span>
            <span>Qsecure: FIPS 204</span>
          </div>
        </div>
      </div>
    </header>
  );
};
