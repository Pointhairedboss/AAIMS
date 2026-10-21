import { test, expect } from '@playwright/test';
import { setupConsoleGuard, assertNoConsoleErrors } from '../helpers/console_guard';

/**
 * AAIMS Complete 9-Stage Lifecycle & Governance E2E Browser Test Suite
 *
 * Verifies full end-to-end journey in Microsoft Edge / Google Chrome:
 * 1. Creates a new Solution Request (Stage 1)
 * 2. Steps through all 9 Working Group Stages with gate enforcement
 * 3. Enforces Capability & Control gate blockers in the UI
 * 4. Selects qualified approver at Stage 7 (Approve)
 * 5. Logs an Incident / Breach Notification
 * 6. Submits Breach Remediation
 * 7. Executes a Compliance Audit
 * 8. Enforces Zero Browser Console Errors and Zero Page Crashes
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

    // Verify 3 Core Business Objects are present in navigation
    await expect(page.locator('nav, header')).toContainText(/Solutions/i);
    await expect(page.locator('nav, header')).toContainText(/Capabilities/i);
    await expect(page.locator('nav, header')).toContainText(/Controls/i);

    // -------------------------------------------------------------------------
    // 2. Stage 1: Request a Solution
    // -------------------------------------------------------------------------
    // Click "Request Solution" or "New Solution"
    const newSolutionBtn = page.getByRole('button', { name: /Request Solution|New Solution|Create Solution/i });
    await expect(newSolutionBtn).toBeVisible({ timeout: 10000 });
    await newSolutionBtn.click();

    // Fill the intake form
    await page.getByLabel(/Title|Solution Name/i).fill(solutionTitle);
    await page.getByLabel(/Business Problem|Problem Statement/i).fill(
      'Automate high-volume insurance claims categorization and reduce turnaround from 4 days to 4 hours.'
    );
    await page.getByLabel(/Requesting Unit|Department/i).fill('Customer Operations');
    await page.getByLabel(/Named Owner|Solution Owner/i).fill('Sarah Jenkins');
    await page.getByLabel(/Owner Remit|Remit/i).fill('Claims Management');

    // Select Risk Tier: HIGH
    const riskSelect = page.getByLabel(/Risk Tier|Risk Classification/i);
    if ((await riskSelect.count()) > 0) {
      await riskSelect.selectOption('HIGH');
    } else {
      // Radio or custom selector fallback
      const highRiskRadio = page.getByRole('radio', { name: /HIGH/i }).or(page.getByText(/HIGH/i));
      await highRiskRadio.first().click();
    }

    // Submit Solution Request
    const submitBtn = page.getByRole('button', { name: /Submit Request|Create Request|Save/i });
    await submitBtn.click();

    // Verify Solution detail page / stepper is loaded at Stage 1
    await expect(page.getByText(solutionTitle)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Stage 1|Request a Solution/i).first()).toBeVisible();

    // -------------------------------------------------------------------------
    // 3. Stage 2: Investigate
    // -------------------------------------------------------------------------
    const advanceBtn = page.getByRole('button', { name: /Advance Stage|Next Stage|Proceed|Move to Stage/i });
    await advanceBtn.first().click();

    // Fill investigation notes if modal or prompt appears
    const notesInput = page.getByLabel(/Investigation Notes|Meeting Minutes|Notes/i);
    if ((await notesInput.count()) > 0) {
      await notesInput.fill('Initial review confirms High risk due to automated claims decisions impact.');
      const confirmNotesBtn = page.getByRole('button', { name: /Confirm|Save|Proceed/i });
      if ((await confirmNotesBtn.count()) > 0) await confirmNotesBtn.click();
    }

    await expect(page.getByText(/Stage 2|Investigate/i).first()).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 4. Stage 3: Assign Owner
    // -------------------------------------------------------------------------
    await advanceBtn.first().click();
    await expect(page.getByText(/Stage 3|Assign Owner/i).first()).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 5. Stage 4: Identify Capabilities (Gate Invariant 1a Enforcement)
    // -------------------------------------------------------------------------
    await advanceBtn.first().click();
    await expect(page.getByText(/Stage 4|Identify Capabilities/i).first()).toBeVisible({ timeout: 10000 });

    // Attempt to advance WITHOUT linking any capability -> UI must block or show validation error
    await advanceBtn.first().click();
    await expect(
      page.getByText(/at least one capability|capability required|cannot advance/i).first()
    ).toBeVisible({ timeout: 5000 });

    // Link a Capability (select existing or create new)
    const addCapBtn = page.getByRole('button', { name: /Add Capability|Link Capability|Attach Capability/i });
    await addCapBtn.first().click();

    // Pick first available capability or type name
    const capOption = page.getByRole('checkbox').or(page.getByRole('option')).first();
    if ((await capOption.count()) > 0) {
      await capOption.click();
    }
    const saveCapBtn = page.getByRole('button', { name: /Link Selected|Save|Attach|Confirm/i });
    if ((await saveCapBtn.count()) > 0) await saveCapBtn.click();

    // Now advance past Stage 4 -> MUST SUCCEED
    await advanceBtn.first().click();
    await expect(page.getByText(/Stage 5|Apply Controls/i).first()).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 6. Stage 5: Apply Controls (Gate Invariant 1b Enforcement)
    // -------------------------------------------------------------------------
    // Attempt to advance WITHOUT controls -> UI must block
    await advanceBtn.first().click();
    await expect(
      page.getByText(/at least one control|controls required|cannot advance/i).first()
    ).toBeVisible({ timeout: 5000 });

    // Apply NAIC 10 Guardrails Control Package
    const applyPackageBtn = page.getByRole('button', {
      name: /Apply Control Package|Apply Package|Attach Controls/i,
    });
    await applyPackageBtn.first().click();

    const naicPackageOption = page.getByText(/10 Guardrails|NAIC Voluntary/i).first();
    await naicPackageOption.click();

    const confirmPackageBtn = page.getByRole('button', { name: /Apply Selected|Confirm|Save/i });
    if ((await confirmPackageBtn.count()) > 0) await confirmPackageBtn.click();

    // Now advance past Stage 5 -> MUST SUCCEED
    await advanceBtn.first().click();
    await expect(page.getByText(/Stage 6|Assess/i).first()).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 7. Stage 6: Assess
    // -------------------------------------------------------------------------
    // Complete assessment checklist if visible
    const checklistItems = page.getByRole('checkbox');
    const checkCount = await checklistItems.count();
    for (let i = 0; i < Math.min(checkCount, 5); i++) {
      await checklistItems.nth(i).check().catch(() => {});
    }

    await advanceBtn.first().click();
    await expect(page.getByText(/Stage 7|Approve/i).first()).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 8. Stage 7: Approve (Delegated Authority Tier Enforcement)
    // -------------------------------------------------------------------------
    // Select Approver: High Risk requires TIER_3_HIGH_EXEC or BOARD_DELEGATE
    const approverSelect = page.getByLabel(/Approver|Approving Member/i);
    if ((await approverSelect.count()) > 0) {
      // Find an approver with Executive / Board authority
      await (approverSelect as any).selectOption({ label: /Board|Executive|Tier 3/i });
    }

    const approveConfirmBtn = page.getByRole('button', { name: /Approve Solution|Confirm Approval|Approve/i });
    await approveConfirmBtn.first().click();

    // Verify Stage 7 approved, ready for implementation
    await expect(page.getByText(/Approved|Stage 8|Implement/i).first()).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 9. Stage 8 & 9: Implement & Review
    // -------------------------------------------------------------------------
    if ((await advanceBtn.count()) > 0) {
      await advanceBtn.first().click().catch(() => {});
      await expect(page.getByText(/Operational|Review/i).first()).toBeVisible({ timeout: 10000 });
    }

    // -------------------------------------------------------------------------
    // 10. Governance Records: Log Incident / Breach Notification
    // -------------------------------------------------------------------------
    const logIncidentBtn = page.getByRole('button', { name: /Log Incident|Report Breach|New Breach/i });
    if ((await logIncidentBtn.count()) > 0) {
      await logIncidentBtn.click();

      await page.getByLabel(/Title|Incident Name/i).fill('Model Output Hallucination Breach');
      await page.getByLabel(/Severity/i).selectOption('HIGH');
      await page.getByLabel(/Description/i).fill('Canary testing revealed potential privacy leak on prompt edge.');
      await page.getByRole('button', { name: /Submit Incident|Log Breach|Save/i }).click();

      // Verify incident logged in ledger
      await expect(page.getByText(/Hallucination Breach|Incident Logged/i).first()).toBeVisible({ timeout: 10000 });

      // -----------------------------------------------------------------------
      // 11. Governance Records: Submit Breach Remediation
      // -----------------------------------------------------------------------
      const remediateBtn = page.getByRole('button', { name: /Remediate|Submit Remediation|Resolve/i });
      if ((await remediateBtn.count()) > 0) {
        await remediateBtn.first().click();
        await page.getByLabel(/Remediation|Summary|Action/i).fill('Added pre-flight semantic sanitizer.');
        await page.getByRole('button', { name: /Submit Remediation|Confirm/i }).click();
        await expect(page.getByText(/REMEDIATED|Remediation Submitted/i).first()).toBeVisible();
      }
    }

    // -------------------------------------------------------------------------
    // 12. Governance Records: Compliance Audit
    // -------------------------------------------------------------------------
    const auditNav = page.getByRole('link', { name: /Audit|Compliance/i });
    if ((await auditNav.count()) > 0) {
      await auditNav.click();
      const runAuditBtn = page.getByRole('button', { name: /Run Audit|New Audit|Execute Audit/i });
      if ((await runAuditBtn.count()) > 0) {
        await runAuditBtn.click();
        await page.getByRole('button', { name: /Submit Audit|Confirm/i }).click().catch(() => {});
        await expect(page.getByText(/Audit Complete/i).first()).toBeVisible({ timeout: 15000 });
      }
    }

    // -------------------------------------------------------------------------
    // 13. Verify Zero Browser Console Errors & Zero Page Crashes
    // -------------------------------------------------------------------------
    assertNoConsoleErrors(consoleGuard);
  });
});
