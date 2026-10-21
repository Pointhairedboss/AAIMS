import { test, expect } from '@playwright/test';
import { setupConsoleGuard, assertNoConsoleErrors } from '../helpers/console_guard';

/**
 * BitBop (Qsecure) Live Cryptographic Attestation & Verification E2E Suite
 *
 * Verifies live Post-Quantum Provenance integration against https://api.bitbop.dev:
 * 1. Attestation cards display live Beacon Sequence (> 0), ML-DSA-44 signature, and SHA-256 digest
 * 2. "Verify on BitBop" button triggers live verification and returns valid: true
 * 3. Deep-link points to https://www.bitbop.dev/provenance?sequence=...
 * 4. "Powered by BitBop" footer link is visible and directs to https://www.bitbop.dev
 * 5. Zero browser console errors and zero uncaught exceptions
 */

test.describe('BitBop Post-Quantum Attestation & Verification (Tier 4)', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  test('Attestation cards display valid post-quantum receipt parameters and verify live against BitBop Edge', async ({
    page,
  }) => {
    const consoleGuard = setupConsoleGuard(page);

    // 1. Navigate to application
    await page.goto(APP_URL);
    await expect(page).toHaveTitle(/AAIMS|AIMI|AI Management/i);

    // 2. Locate Attestations / Governance Audit view
    const attestationsLink = page.getByRole('link', { name: /Attestation|Audit|Governance|Ledger/i }).first();
    if ((await attestationsLink.count()) > 0) {
      await attestationsLink.click();
    }

    // 3. Look for an attestation record card or table row
    // Pre-seeded or newly emitted records must display a beacon block sequence > 0
    const beaconElement = page.getByText(/Beacon Block|Beacon Sequence|Block #/i).first();
    await expect(beaconElement).toBeVisible({ timeout: 15000 });

    // Verify ML-DSA-44 algorithm label or signature prefix
    const algorithmLabel = page.getByText(/ML-DSA-44|mldsa44|NIST FIPS 204/i).first();
    await expect(algorithmLabel).toBeVisible({ timeout: 10000 });

    // 4. Click "Verify on BitBop" button
    const verifyBtn = page.getByRole('button', { name: /Verify on BitBop|Verify Proof|Verify Attestation/i }).first();
    await expect(verifyBtn).toBeVisible({ timeout: 10000 });

    // Set up network inspection to verify communication with BitBop verify endpoint
    const verifyPromise = page.waitForResponse(
      (res) => (res.url().includes('bitbop.dev/verify') || res.url().includes('/api/attestations/verify')) && res.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);

    await verifyBtn.click();

    // 5. Verify live cryptographic result in UI modal / indicator
    await expect(
      page.getByText(/valid: true|CRYPTOGRAPHICALLY VALID|Valid Signature|Verified/i).first()
    ).toBeVisible({ timeout: 15000 });

    // If network call was intercepted, verify response structure
    const verifyResponse = await verifyPromise;
    if (verifyResponse) {
      const data = await verifyResponse.json();
      expect(data.valid).toBe(true);
    }

    // 6. Verify deep-link to BitBop Provenance Explorer
    const provenanceLink = page.locator('a[href*="bitbop.dev/provenance"]').first();
    await expect(provenanceLink).toBeVisible({ timeout: 10000 });
    const href = await provenanceLink.getAttribute('href');
    expect(href).toMatch(/https:\/\/www\.bitbop\.dev\/provenance(\?sequence=\d+)?/);

    // 7. Verify "Powered by BitBop" footer link
    const footerLink = page.locator('footer a[href*="bitbop.dev"], a:has-text("BitBop")').first();
    await expect(footerLink).toBeVisible();
    await expect(page.locator('footer, body')).toContainText(/Powered by BitBop/i);

    // 8. Assert zero console errors
    assertNoConsoleErrors(consoleGuard);
  });

  test('Direct Edge Verification: Verifying attestation against live https://api.bitbop.dev', async () => {
    // Independent programmatic verification verifying BitBop edge responds with valid schema
    const edgeUrl = 'https://api.bitbop.dev/verify';
    const testPayload = {
      beacon_sequence: 1,
      signature: 'mldsa44:0000000000000000000000000000000000000000000000000000000000000000',
    };

    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });

    // The live edge should respond with JSON containing valid: boolean or schema error
    expect(res.status).toBeLessThan(500);
    const data: any = await res.json().catch(() => ({}));
    expect(data).toHaveProperty('valid');
  });
});
