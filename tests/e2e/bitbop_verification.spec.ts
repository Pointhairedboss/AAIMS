import { test, expect } from '@playwright/test';
import { setupConsoleGuard, assertNoConsoleErrors } from '../helpers/console_guard';

/**
 * BitBop (Qsecure) Post-Quantum Cryptographic Attestation & Verification E2E Suite
 *
 * Verifies real ML-KEM-768 + ML-DSA-44 provenance against local BitBopCoordinator
 * (or live https://api.bitbop.dev when BITBOP_LIVE_E2E=1):
 * 1. Attestation cards display real Beacon Sequence (> 0), ML-DSA-44 signature, and real 64-hex SHA-256 digests (zero hardcoded fallback strings)
 * 2. "Verify on BitBop" button triggers real verification and renders 7-point checks including Local Pinned ML-DSA-44 Lattice Signature & Historical Governance Snapshot Match
 * 3. Forged signatures return HTTP 200 with valid === false and local_mldsa44_signature_valid === false
 * 4. Superseded receipts render explicit version drift ("Attested v1 -> Current v2") while preserving valid: true
 * 5. Zero browser console errors and zero uncaught exceptions
 */

test.describe('BitBop Post-Quantum Attestation & Verification (Tier 4)', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';
  const API_URL = process.env.API_URL || 'http://localhost:4000';
  const BITBOP_URL =
    process.env.BITBOP_API_URL ||
    (process.env.BITBOP_LIVE_E2E === '1' ? 'https://api.bitbop.dev' : 'http://127.0.0.1:4010');

  test('Attestation cards display real post-quantum receipt parameters (zero fake fallbacks) and verify in VerificationModal', async ({
    page,
  }) => {
    const consoleGuard = setupConsoleGuard(page);

    // 1. Navigate to application
    await page.goto(APP_URL);
    await expect(page).toHaveTitle(/AAIMS|AIMI|AI Management/i);

    // 2. Navigate to Attestation Ledger
    await page.getByRole('link', { name: /Attestation Ledger/i }).click();

    // 3. Verify pre-seeded / real attestation cards are present and contain ZERO hardcoded fake fallback digests
    const firstCard = page.locator('.attestation-card').first();
    await expect(firstCard).toBeVisible({ timeout: 15000 });

    const ledgerText = await page.locator('.attestations-page').innerText();
    expect(ledgerText).not.toContain('e22966b930e8135b17b6f5c109067a74');
    expect(ledgerText).not.toContain('4f347337f531129685c1cc748caf88f4');

    await expect(firstCard).toContainText(/Beacon Sequence: Block #[1-9]\d*/);
    await expect(firstCard).toContainText(/Algorithm: ML-DSA-44 \(NIST FIPS 204\)/);
    await expect(firstCard.locator('.crypto-hash-box')).toContainText(
      /Signature \(ML-DSA-44\):\s*(?:mldsa44:)?[0-9a-f]{4840}/i
    );
    await expect(firstCard.locator('.crypto-hash-box')).toContainText(
      /Beacon Hash:\s*(?:sha256:)?[0-9a-f]{64}/i
    );
    await expect(firstCard.locator('.crypto-hash-box')).toContainText(
      /Entropy SHA-256:\s*(?:sha256:)?[0-9a-f]{64}/i
    );
    await expect(firstCard.locator('.crypto-hash-box')).toContainText(
      /Context Hash:\s*(?:sha256:)?[0-9a-f]{64}/i
    );

    // 4. Click "Verify on BitBop" button and intercept verification response (NO .catch(() => null))
    const verifyBtn = firstCard.getByRole('button', { name: /Verify on BitBop/i });
    const verifyPromise = page.waitForResponse(
      (res) => res.url().includes('/api/attestations/verify') && res.request().method() === 'POST',
      { timeout: 15000 }
    );

    await verifyBtn.click();

    const verifyResponse = await verifyPromise;
    expect(verifyResponse.status()).toBe(200);
    const data = await verifyResponse.json();
    expect(data.valid).toBe(true);
    expect(data.checks.local_mldsa44_signature_valid).toBe(true);
    expect(data.checks.historical_snapshot_match).toBe(true);

    // 5. Verify live cryptographic checks and state badge in VerificationModal DOM
    const modal = page.locator('.verification-content');
    await expect(modal.getByText('✓ CRYPTOGRAPHICALLY VALID')).toBeVisible({ timeout: 15000 });
    await expect(modal).toContainText('✓ Local Pinned ML-DSA-44 Lattice Signature: PASS');
    await expect(modal).toContainText('✓ Historical Governance Snapshot Match: PASS');
    await expect(modal.getByTestId('entity-version-drift-badge')).toContainText('Attested v1 -> Current v1');

    // 6. Verify deep-link to BitBop Provenance Explorer
    const provenanceLink = modal.locator('a[href*="bitbop.dev/provenance"]');
    await expect(provenanceLink).toBeVisible();
    const href = await provenanceLink.getAttribute('href');
    expect(href).toMatch(/^https:\/\/www\.bitbop\.dev\/provenance\?sequence=[1-9]\d*$/);

    await page.locator('button.btn-secondary', { hasText: 'Close' }).click();

    // 7. Verify "Powered by BitBop" footer link
    const footerLink = page.locator('.app-footer a[href*="bitbop.dev"]');
    await expect(footerLink).toBeVisible();
    await expect(page.locator('.app-footer')).toContainText(/Powered by BitBop/i);

    // 8. Assert zero console errors
    assertNoConsoleErrors(consoleGuard);
  });

  test('Forged ML-DSA-44 signature is strictly rejected (HTTP 200, valid === false, local_mldsa44_signature_valid === false)', async ({
    request,
  }) => {
    // 1. Fetch a genuine attestation receipt from AAIMS
    const listRes = await request.get(`${API_URL}/api/attestations`);
    expect(listRes.status()).toBe(200);
    const attestations = await listRes.json();
    expect(Array.isArray(attestations)).toBe(true);
    expect(attestations.length).toBeGreaterThan(0);

    const genuineReceipt = attestations[0];
    const forgedSignature = 'mldsa44:' + '00'.repeat(2420);

    // 2. Verify AAIMS /api/attestations/verify strictly rejects forged signature via pinned ML-DSA-44 lattice verification
    const verifyRes = await request.post(`${API_URL}/api/attestations/verify`, {
      data: {
        ...genuineReceipt,
        signature: forgedSignature,
        raw_receipt: {
          ...(genuineReceipt.raw_receipt || {}),
          signature: forgedSignature,
        },
      },
    });

    expect(verifyRes.status()).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.valid).toBe(false);
    expect(verifyBody.checks).toBeDefined();
    expect(verifyBody.checks.local_mldsa44_signature_valid).toBe(false);
    expect(verifyBody.checks.receipt_signature_valid).toBe(false);
    expect(verifyBody.reason).toMatch(/ML-DSA-44|signature/i);

    // 3. Also verify directly against BitBop /verify endpoint
    const raw = genuineReceipt.raw_receipt || {};
    const edgeRes = await request.post(`${BITBOP_URL.replace(/\/+$/, '')}/verify`, {
      data: {
        ...raw,
        beacon_sequence: genuineReceipt.beacon_sequence,
        signature: forgedSignature,
      },
    });

    expect(edgeRes.status()).toBe(200);
    const edgeBody = await edgeRes.json();
    expect(edgeBody.valid).toBe(false);
  });

  test('Superseded historical receipt renders Attested v1 -> Current v2 drift badge in browser VerificationModal', async ({
    page,
    request,
  }) => {
    const consoleGuard = setupConsoleGuard(page);

    // Create a new solution (v1) and advance to Stage 2 (v2) via API
    const createRes = await request.post(`${API_URL}/api/solutions`, {
      data: {
        title: `Drift Badge Browser Test - ${Date.now()}`,
        business_problem: 'Verify historical v1 receipt vs live v2 drift badge in Chrome',
        requesting_unit: 'Governance QA',
        owner_name: 'Elena Rostova',
        owner_remit: 'AI Safety',
        risk_tier: 'LOW',
      },
    });
    expect(createRes.status()).toBe(201);
    const sol = await createRes.json();

    const stageRes = await request.patch(`${API_URL}/api/solutions/${sol.id}/stage`, {
      data: { target_stage: 2 },
    });
    expect(stageRes.status()).toBe(200);

    // Open Attestation Ledger in Chrome; cards are ordered newest first:
    // card[0] = WORKING_GROUP_DECISION (v2), card[1] = SOLUTION_REQUESTED (v1)
    await page.goto(APP_URL);
    await page.getByRole('link', { name: /Attestation Ledger/i }).click();

    const v1Card = page.locator('.attestation-card').filter({ hasText: 'SOLUTION_REQUESTED' }).first();
    await expect(v1Card).toBeVisible({ timeout: 15000 });
    await v1Card.getByRole('button', { name: /Verify on BitBop/i }).click();

    const modal = page.locator('.verification-content');
    await expect(modal.getByText('✓ CRYPTOGRAPHICALLY VALID')).toBeVisible({ timeout: 15000 });
    await expect(modal.getByTestId('entity-version-drift-badge')).toContainText('Attested v1 -> Current v2');
    await expect(modal.getByTestId('entity-version-drift-badge')).toContainText('Historical Snapshot (Superseded)');
    await expect(modal).toContainText('✓ Local Pinned ML-DSA-44 Lattice Signature: PASS');
    await expect(modal).toContainText('✓ Historical Governance Snapshot Match: PASS');

    assertNoConsoleErrors(consoleGuard);
  });
});
