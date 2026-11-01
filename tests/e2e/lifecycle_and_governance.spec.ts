import { test, expect } from '@playwright/test';
import { setupConsoleGuard, assertNoConsoleErrors } from '../helpers/console_guard';

/**
 * AAIMS Complete 9-Stage Lifecycle & Governance E2E Browser Test Suite
 *
 * Verifies full end-to-end journey in Google Chrome with zero swallowed errors:
 * 1. Creates a new Solution Request (Stage 1)
 * 2. Steps sequentially through all 9 Working Group Stages with strict gate enforcement
 * 3. Enforces Capability (Stage 4) & Control (Stage 5) gate blockers in the UI
 * 4. Selects qualified Executive/Board approver at Stage 7 (Approve) and completes Stage 8 -> Stage 9
 * 5. Logs an Incident / Breach Notification and submits Breach Remediation
 * 6. Executes a Compliance Audit and verifies BitBop attestation in the Ledger
 * 7. Enforces Zero Browser Console Errors and Zero Page Crashes
 */

test.describe('9-Stage Working Group Lifecycle & Governance E2E (Tier 4)', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  test('Complete 9-Stage Lifecycle Flow with Incident, Remediation, Audit and Zero Console Errors', async ({
    page,
  }) => {
    const consoleGuard = setupConsoleGuard(page);
    const uniqueId = Date.now();
    const solutionTitle = `E2E Claims Triage Assistant - ${uniqueId}`;

    // -------------------------------------------------------------------------
    // 1. Navigate to Application & Verify Core 3-Object Navigation
    // -------------------------------------------------------------------------
    await page.goto(APP_URL);
    await expect(page).toHaveTitle(/AAIMS|AIMI|AI Management/i);

    await expect(page.locator('header')).toContainText(/Solutions/i);
    await expect(page.locator('header')).toContainText(/Capabilities/i);
    await expect(page.locator('header')).toContainText(/Controls/i);

    // -------------------------------------------------------------------------
    // 2. Stage 1: Request a Solution
    // -------------------------------------------------------------------------
    const newSolutionBtn = page.getByRole('button', { name: /Request Solution|New Solution|Create Solution/i });
    await expect(newSolutionBtn).toBeVisible({ timeout: 10000 });
    await newSolutionBtn.click();

    await page.getByLabel(/Title|Solution Name/i).fill(solutionTitle);
    await page.getByLabel(/Business Problem|Problem Statement/i).fill(
      'Automate high-volume insurance claims categorization and reduce turnaround from 4 days to 4 hours.'
    );
    await page.getByLabel(/Requesting Unit|Department/i).fill('Customer Operations');
    await page.getByLabel(/Named Owner|Solution Owner/i).fill('Sarah Jenkins');
    await page.getByLabel(/Owner Remit|Remit/i).fill('Claims Management');
    await page.getByLabel(/Risk Tier|Risk Classification/i).selectOption('HIGH');

    await page.getByRole('button', { name: /Submit Request|Create Request|Save/i }).click();

    // Verify Solution detail page & active stepper milestone is Stage 1
    await expect(page.getByRole('heading', { name: solutionTitle })).toBeVisible({ timeout: 10000 });
    const stageHeading = page.locator('.working-group-stepper h2.card-title');
    await expect(stageHeading).toContainText('Stage 1: Request a Solution');

    const advanceBtn = page.getByRole('button', { name: /Advance Stage/i });

    // -------------------------------------------------------------------------
    // 3. Stage 2: Investigate
    // -------------------------------------------------------------------------
    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 2: Investigate', { timeout: 10000 });

    await page
      .getByLabel(/Investigation Notes|Meeting Minutes/i)
      .fill('Initial review confirms High risk due to automated claims decisions impact.');
    await page.getByRole('button', { name: /Save Notes/i }).click();
    await expect(page.getByText(/Notes recorded in Working Group minutes/i)).toBeVisible();

    // -------------------------------------------------------------------------
    // 4. Stage 3: Assign Owner
    // -------------------------------------------------------------------------
    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 3: Assign Owner', { timeout: 10000 });

    // -------------------------------------------------------------------------
    // 5. Stage 4: Identify Capabilities (Gate Invariant 1a Enforcement)
    // -------------------------------------------------------------------------
    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 4: Identify Capabilities', { timeout: 10000 });

    // Attempt to advance WITHOUT linking any capability -> UI MUST block
    await advanceBtn.click();
    await expect(
      page.getByRole('alert').filter({ hasText: /at least one capability is required/i })
    ).toBeVisible({ timeout: 5000 });
    await expect(stageHeading).toContainText('Stage 4: Identify Capabilities');

    // Link pre-seeded AUTHORISED capabilities
    await page.getByRole('button', { name: /\+ Add Capability/i }).click();
    const firstCapCheckbox = page.locator('.link-capabilities-content input[type="checkbox"]').first();
    const secondCapCheckbox = page.locator('.link-capabilities-content input[type="checkbox"]').nth(1);
    await expect(firstCapCheckbox).toBeChecked();
    await secondCapCheckbox.check();
    await expect(secondCapCheckbox).toBeChecked();
    await page.getByRole('button', { name: 'Link Selected' }).click();
    await expect(page.locator('.link-capabilities-content')).toBeHidden({ timeout: 10000 });

    // Advance past Stage 4 -> Stage 5 MUST SUCCEED
    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 5: Apply Controls', { timeout: 10000 });

    // -------------------------------------------------------------------------
    // 6. Stage 5: Apply Controls (Gate Invariant 1b Enforcement)
    // -------------------------------------------------------------------------
    // Attempt to advance WITHOUT controls -> UI MUST block
    await advanceBtn.click();
    await expect(
      page.getByRole('alert').filter({ hasText: /at least one control is required/i })
    ).toBeVisible({ timeout: 5000 });
    await expect(stageHeading).toContainText('Stage 5: Apply Controls');

    // Apply NAIC 10 Guardrails Control Package
    await page.getByRole('button', { name: /\+ Apply Control Package/i }).click();
    await page.locator('.apply-package-content').getByText(/10 Guardrails/i).first().click();
    await page.getByRole('button', { name: 'Apply Selected' }).click();
    await expect(page.locator('.apply-package-content')).toBeHidden({ timeout: 10000 });
    await expect(page.getByText(/Active Governance Controls \(11 attached\)/i)).toBeVisible();

    // Advance past Stage 5 -> Stage 6 MUST SUCCEED
    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 6: Assess', { timeout: 10000 });

    // -------------------------------------------------------------------------
    // 7. Stage 6: Assess (Zero swallowed errors on checklist verification)
    // -------------------------------------------------------------------------
    const checklistItems = page.locator('.stage-content input[type="checkbox"]');
    const checkCount = await checklistItems.count();
    expect(checkCount).toBe(5);
    for (let i = 0; i < checkCount; i++) {
      await checklistItems.nth(i).check();
      await expect(checklistItems.nth(i)).toBeChecked();
    }

    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 7: Approve', { timeout: 10000 });

    // -------------------------------------------------------------------------
    // 8. Stage 7: Approve (Delegated Authority Tier Enforcement)
    // -------------------------------------------------------------------------
    const approverSelect = page.locator('#approver-select');
    await expect(approverSelect).toBeVisible();

    // Approve with qualified Executive/Board authority (Board Delegate Officer)
    await approverSelect.selectOption('Board Delegate Officer');
    await page.getByRole('button', { name: 'Approve Solution' }).click();

    await expect(stageHeading).toContainText('Stage 8: Implement', { timeout: 15000 });
    await expect(page.getByText(/Approved by Delegated Authority/i)).toBeVisible();

    // -------------------------------------------------------------------------
    // 9. Stage 8 -> Stage 9: Implement & Operational Review
    // -------------------------------------------------------------------------
    await advanceBtn.click();
    await expect(stageHeading).toContainText('Stage 9: Review', { timeout: 10000 });
    await expect(page.getByText(/Operational & Continuous Review Active \(Stage 9\)/i)).toBeVisible();

    // -------------------------------------------------------------------------
    // 10. Governance Records: Log Incident / Breach Notification
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: /Log Incident \/ Report Breach/i }).click();
    await page.getByLabel(/Title \/ Incident Name/i).fill('Model Output Hallucination Breach');
    await page.getByLabel(/Severity/i).selectOption('HIGH');
    await page.getByLabel(/Description/i).fill('Canary testing revealed potential privacy leak on prompt edge.');
    await page.getByRole('button', { name: 'Submit Incident' }).click();

    await expect(page.getByText('Model Output Hallucination Breach')).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 11. Governance Records: Submit Breach Remediation
    // -------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Resolve' }).first().click();
    await page.getByLabel(/Remediation Action Plan \/ Summary/i).fill('Added pre-flight semantic sanitizer.');
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('REMEDIATED')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Remediation Submitted & Verified/i)).toBeVisible();

    // -------------------------------------------------------------------------
    // 12. Governance Records: Execute Compliance Audit
    // -------------------------------------------------------------------------
    await page.getByRole('link', { name: 'Compliance Audits' }).click();
    await expect(page.getByRole('heading', { name: /Compliance & Governance Audits/i })).toBeVisible();

    await page.getByRole('button', { name: '+ Run Audit' }).click();
    await page.getByRole('button', { name: 'Submit Audit' }).click();
    await expect(
      page.getByText(/Audit Complete — System is Compliant with NAIC 10 Guardrails/i)
    ).toBeVisible({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 13. Verify Latest Audit Receipt on Attestation Ledger
    // -------------------------------------------------------------------------
    await page.getByRole('link', { name: 'Attestation Ledger' }).click();
    const auditCard = page.locator('.attestation-card').filter({ hasText: 'COMPLIANCE_AUDIT' }).first();
    await expect(auditCard).toBeVisible({ timeout: 10000 });
    await auditCard.getByRole('button', { name: /Verify on BitBop/i }).click();
    await expect(page.locator('.verification-content').getByText('✓ CRYPTOGRAPHICALLY VALID')).toBeVisible({
      timeout: 15000,
    });
    await page.locator('button.btn-secondary', { hasText: 'Close' }).click();

    // -------------------------------------------------------------------------
    // 14. Assert Zero Browser Console Errors & Zero Page Crashes
    // -------------------------------------------------------------------------
    assertNoConsoleErrors(consoleGuard);
  });

  test('Stage 7 UI enforces Delegated Authority rejection banner when TIER_1_LOW approver attempts HIGH-risk approval', async ({
    page,
    request,
  }) => {
    const API_URL = process.env.API_URL || 'http://localhost:4000';
    const title = `Stage 7 Rejection UI Test - ${Date.now()}`;

    // Prepare a HIGH-risk solution at Stage 6 via API with governed capability & control
    const [capsRes, ctrlsRes] = await Promise.all([
      request.get(`${API_URL}/api/capabilities`),
      request.get(`${API_URL}/api/controls`),
    ]);
    const caps = await capsRes.json();
    const ctrls = await ctrlsRes.json();

    const solRes = await request.post(`${API_URL}/api/solutions`, {
      data: {
        title,
        business_problem: 'Verify Stage 7 UI rejection alert for insufficient authority tier',
        requesting_unit: 'Risk QA',
        owner_name: 'Elena Rostova',
        owner_remit: 'AI Governance',
        risk_tier: 'HIGH',
      },
    });
    expect(solRes.status()).toBe(201);
    const sol = await solRes.json();

    await request.post(`${API_URL}/api/solutions/${sol.id}/capabilities`, {
      data: { capability_ids: [caps[0].id] },
    });
    await request.post(`${API_URL}/api/solutions/${sol.id}/controls`, {
      data: { control_ids: [ctrls[0].id] },
    });
    for (let st = 2; st <= 6; st++) {
      const r = await request.patch(`${API_URL}/api/solutions/${sol.id}/stage`, {
        data: { target_stage: st },
      });
      expect(r.status()).toBe(200);
    }

    // Open solution in Chrome, step to Stage 7, and attempt approval as Jordan Bell (TIER_1_LOW)
    await page.goto(APP_URL);
    await page.getByText(title).first().click();

    const stageHeading = page.locator('.working-group-stepper h2.card-title');
    await expect(stageHeading).toContainText('Stage 6: Assess');
    await page.getByRole('button', { name: /Advance Stage/i }).click();
    await expect(stageHeading).toContainText('Stage 7: Approve');

    await page.locator('#approver-select').selectOption('Jordan Bell');
    const rejectPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/solutions/${sol.id}/stage`) && res.request().method() === 'PATCH'
    );
    await page.getByRole('button', { name: 'Approve Solution' }).click();

    const rejectRes = await rejectPromise;
    expect(rejectRes.status()).toBe(400);
    await expect(page.getByRole('alert').filter({ hasText: /Approval rejected/i })).toBeVisible();
    await expect(stageHeading).toContainText('Stage 7: Approve');
  });
});
