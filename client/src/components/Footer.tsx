import React from 'react';

export const Footer: React.FC = () => {
  return (
    <div className="app-footer" role="contentinfo">
      <div className="footer-content">
        <p>
          AAIMS (AIMI) — Australian AI Management & Safety Interface &bull;{' '}
          <a href="https://www.bitbop.dev" target="_blank" rel="noreferrer">
            Powered by BitBop
          </a>{' '}
          (NIST FIPS 204 ML-DSA-44 Post-Quantum Hardware Provenance)
        </p>
      </div>
    </div>
  );
};
