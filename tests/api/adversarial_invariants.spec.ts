import { test, expect } from '@playwright/test';

/**
 * AAIMS Adversarial Invariant & Boundary Stress Test Suite (Tier 5)
 *
 * Empirical challenger test harness targeting:
 * - Malformed stage numbers & non-integer floats
 * - Stage skip & Stage 7 approval bypass (e.g. Stage 6 -> Stage 8)
 * - Named ownership evasion via PATCH endpoints
 * - Un-governed capability authorisation & post-authorisation control stripping
 * - Solution approval with SUSPENDED capabilities
 * - Phantom entity ID injection and invariant bypass
 * - Delegated authority case-sensitivity & risk-tier tampering
 * - Concurrent control additions and race conditions
 */

const API_BASE = process.env.API_URL || 'http://localhost:4000';

test.describe('Tier 5 Adversarial Invariant Analysis', () => {

  test.describe('Attack Vector 1: Malformed Stage Numbers & Boundary Exploitation', () => {
    test('AV1.1: PATCH /api/solutions/:id/stage rejects boundary violation stage numbers (-1, 0, 10, 99)', async ({ request }) => {
      // Create solution
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV1.1 Solution - ${Date.now()}`,
          business_problem: 'Stage boundary test',
          requesting_unit: 'QA',
          owner_name: 'Adversary Lead',
          risk_tier: 'LOW',
        },
      });
      expect(solRes.status()).toBe(201);
      const sol = await solRes.json();

      const invalidStages = [-1, 0, 10, 99];
      for (const st of invalidStages) {
        const patchRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
          data: { target_stage: st },
        });
        expect(patchRes.status(), `target_stage ${st} should be rejected with 400`).toBe(400);
      }
    });

    test('AV1.2: PATCH /api/solutions/:id/stage should reject non-integer float stages (e.g. 2.5, 3.14)', async ({ request }) => {
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV1.2 Float Stage - ${Date.now()}`,
          business_problem: 'Float stage test',
          requesting_unit: 'QA',
          owner_name: 'Adversary Lead',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      const floatRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: { target_stage: 2.5 },
      });

      // The specification dictates integer stages 1-9. A float should be rejected.
      // If server accepts 2.5, this empirically records the vulnerability.
      expect(floatRes.status(), 'Float stage 2.5 should be rejected with 400').toBe(400);
    });

    test('AV1.3: Generic PATCH /api/solutions/:id should NOT bypass stage invariants (e.g. setting stage directly to 8 or -1)', async ({ request }) => {
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV1.3 Generic Patch - ${Date.now()}`,
          business_problem: 'Generic patch bypass test',
          requesting_unit: 'QA',
          owner_name: 'Adversary Lead',
          risk_tier: 'HIGH',
        },
      });
      const sol = await solRes.json();
      expect(sol.lifecycle_stage).toBe(1);

      // Attempt to bypass lifecycle progression and approval by patching lifecycle_stage directly
      const bypassRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}`, {
        data: { lifecycle_stage: 8 },
      });

      // A hardened server should either reject lifecycle_stage in generic PATCH or enforce invariants
      const updated = await bypassRes.json();
      // If updated.lifecycle_stage is 8, the invariant was bypassed!
      expect(updated.lifecycle_stage, 'Generic PATCH must not bypass stage gates to Stage 8').not.toBe(8);
    });
  });

  test.describe('Attack Vector 2: Stage Skip & Invariant 1b Bypass (Stage 6 -> Stage 8)', () => {
    test('AV2.1: Advancing directly from Stage 6 to Stage 8 without Stage 7 approval must be REJECTED', async ({ request }) => {
      // 1. Create a solution
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV2.1 Stage Skip Test - ${Date.now()}`,
          business_problem: 'Attempt to bypass Stage 7 approval by jumping straight to Stage 8',
          requesting_unit: 'Trading Systems',
          owner_name: 'Trader Bob',
          risk_tier: 'HIGH',
        },
      });
      const sol = await solRes.json();

      // 2. Link a capability that has NO active controls
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Uncontrolled Execution Model - ${Date.now()}`,
          owner_name: 'Quant Lead',
        },
      });
      const cap = await capRes.json();

      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });

      // Link a control to the solution only (capability has 0 controls)
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Step to Stage 6
      for (let st = 2; st <= 6; st++) {
        await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: st } });
      }

      // 3. Attempt to jump straight to Stage 8 (Implement) without approver_name and with an uncontrolled capability!
      const skipRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: { target_stage: 8 },
      });

      // This MUST be rejected because:
      // 1. Stage 7 approval was never granted
      // 2. The linked capability has zero controls
      // 3. No Working Group approver of sufficient tier approved it
      expect(skipRes.status(), 'Jumping to Stage 8 without Stage 7 approval must return HTTP 400').toBe(400);
    });

    test('AV2.2: Advancing from Stage 1 directly to Stage 6 in a single jump must be REJECTED (strict sequence)', async ({ request }) => {
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV2.2 Sequence Jump - ${Date.now()}`,
          business_problem: 'Sequence jump test',
          requesting_unit: 'QA',
          owner_name: 'Adversary Lead',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: { name: 'Cap 1', owner_name: 'Owner' },
      });
      const cap = await capRes.json();

      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Attempt to jump from Stage 1 directly to Stage 6
      const jumpRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: { target_stage: 6 },
      });

      // In a strict 9-stage lifecycle, solutions must advance stage-by-stage or reject large skips
      expect(jumpRes.status(), 'Direct jump from Stage 1 to Stage 6 without sequential gates should be 400').toBe(400);
    });
  });

  test.describe('Attack Vector 3: Mandatory Named Ownership Bypass via PATCH', () => {
    test('AV3.1: POST rejects whitespace-only owner_name on Solution', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: 'Whitespace Owner Solution',
          owner_name: '    ',
        },
      });
      expect(res.status()).toBe(400);
    });

    test('AV3.2: PATCH /api/solutions/:id must NOT permit clearing owner_name to empty or whitespace', async ({ request }) => {
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV3.2 Solution - ${Date.now()}`,
          owner_name: 'Legitimate Owner',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      // Attempt to strip owner_name
      const patchRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}`, {
        data: { owner_name: '' },
      });

      const updated = await patchRes.json();
      expect(updated.owner_name, 'owner_name cannot be emptied').not.toBe('');
      expect(patchRes.status(), 'Clearing owner_name must be rejected with 400').toBe(400);
    });

    test('AV3.3: PATCH /api/capabilities/:id must NOT permit clearing owner_name to empty string', async ({ request }) => {
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `AV3.3 Cap - ${Date.now()}`,
          owner_name: 'Legitimate Cap Owner',
        },
      });
      const cap = await capRes.json();

      const patchRes = await request.patch(`${API_BASE}/api/capabilities/${cap.id}`, {
        data: { owner_name: '' },
      });

      const updated = await patchRes.json();
      expect(updated.owner_name, 'Capability owner_name cannot be emptied').not.toBe('');
      expect(patchRes.status(), 'Clearing capability owner_name must be rejected with 400').toBe(400);
    });

    test('AV3.4: PATCH /api/controls/:id must NOT permit clearing owner_name to empty string', async ({ request }) => {
      const ctrlRes = await request.post(`${API_BASE}/api/controls`, {
        data: {
          code: `CTRL-AV3-${Date.now()}`,
          title: 'Adversarial Control',
          owner_name: 'Legitimate Control Owner',
        },
      });
      const ctrl = await ctrlRes.json();

      const patchRes = await request.patch(`${API_BASE}/api/controls/${ctrl.id}`, {
        data: { owner_name: '' },
      });

      const updated = await patchRes.json();
      expect(updated.owner_name, 'Control owner_name cannot be emptied').not.toBe('');
      expect(patchRes.status(), 'Clearing control owner_name must be rejected with 400').toBe(400);
    });
  });

  test.describe('Attack Vector 4: Capability Governance & Invariant Bypasses', () => {
    test('AV4.1: Stripping controls from an AUTHORISED capability must be REJECTED or reset status to DRAFT', async ({ request }) => {
      // 1. Create and authorise capability with an active control
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `AV4.1 Cap - ${Date.now()}`,
          owner_name: 'Authorised Owner',
        },
      });
      const cap = await capRes.json();

      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();

      await request.post(`${API_BASE}/api/capabilities/${cap.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      const authRes = await request.patch(`${API_BASE}/api/capabilities/${cap.id}/status`, {
        data: { status: 'AUTHORISED' },
      });
      expect(authRes.status()).toBe(200);

      // 2. Strip all controls via PATCH /api/capabilities/:id with control_ids: []
      const stripRes = await request.patch(`${API_BASE}/api/capabilities/${cap.id}`, {
        data: { control_ids: [] },
      });

      const getRes = await request.get(`${API_BASE}/api/capabilities/${cap.id}`);
      const refreshedCap = await getRes.json();

      // Invariant 2 violation check: An AUTHORISED capability MUST NOT have 0 active controls!
      if (refreshedCap.status === 'AUTHORISED') {
        expect(refreshedCap.control_ids.length, 'AUTHORISED capability must not have 0 controls').toBeGreaterThan(0);
      }
    });

    test('AV4.2: Approving a Solution (Stage 7) that links a SUSPENDED capability must be REJECTED', async ({ request }) => {
      // 1. Create Solution
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV4.2 Suspended Cap Test - ${Date.now()}`,
          business_problem: 'Testing if suspended capability can be approved',
          requesting_unit: 'Security',
          owner_name: 'CISO Office',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      // 2. Create Capability and suspend it
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();

      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Suspended LLM Service - ${Date.now()}`,
          owner_name: 'Incident Response',
          status: 'SUSPENDED',
        },
      });
      const cap = await capRes.json();

      // Attach control so control check passes
      await request.post(`${API_BASE}/api/capabilities/${cap.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Explicitly suspend capability
      await request.patch(`${API_BASE}/api/capabilities/${cap.id}`, {
        data: { status: 'SUSPENDED' },
      });

      // Link to solution
      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Advance to Stage 6
      for (let st = 2; st <= 6; st++) {
        await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: st } });
      }

      // 3. Attempt Stage 7 Approval
      const approveRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: {
          target_stage: 7,
          approver_name: 'Board Delegate Officer',
        },
      });

      // An enterprise safety interface must NOT approve a solution relying on a SUSPENDED capability!
      expect(approveRes.status(), 'Solution with SUSPENDED capability cannot be approved').toBe(400);
    });

    test('AV4.3: Advancing past Stage 5 (to Stage 6) when linked capability has ZERO active controls must be REJECTED per spec §2.1', async ({ request }) => {
      // Spec §2.1 rule 1: "A SOLUTION cannot advance past Stage 5 (Apply Controls) or be approved (Stage 7: Approve)
      // unless it has at least one linked CONTROL and every linked CAPABILITY is governed by at least one ACTIVE CONTROL."
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV4.3 Spec 2.1 Gate - ${Date.now()}`,
          business_problem: 'Verify linked capability must have active control before Stage 6',
          requesting_unit: 'Audit',
          owner_name: 'Auditor Dan',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      // Capability with NO controls
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: { name: 'Raw Cap', owner_name: 'Dev' },
      });
      const cap = await capRes.json();

      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });

      // Attach control to solution only
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Advance to Stage 5
      for (let st = 2; st <= 5; st++) {
        await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: st } });
      }

      // Attempt to advance to Stage 6 (past Stage 5)
      const to6Res = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: { target_stage: 6 },
      });

      expect(to6Res.status(), 'Advancing past Stage 5 requires all linked capabilities to have active controls').toBe(400);
    });
  });

  test.describe('Attack Vector 5: Phantom Entity ID Injection & Bypass', () => {
    test('AV5.1: Phantom capability ID on solution must NOT allow Stage 7 approval without genuine controls', async ({ request }) => {
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV5.1 Phantom Cap - ${Date.now()}`,
          business_problem: 'Phantom cap bypass test',
          requesting_unit: 'Red Team',
          owner_name: 'Red Team Lead',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      // Link a non-existent capability ID
      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: ['cap-phantom-nonexistent-12345'] },
      });

      // Link an active control to the solution
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Step to Stage 6
      for (let st = 2; st <= 6; st++) {
        await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: st } });
      }

      // Attempt Stage 7 approval
      const approveRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: {
          target_stage: 7,
          approver_name: 'Board Delegate Officer',
        },
      });

      // Must be rejected because phantom capability does not exist and has no active controls!
      expect(approveRes.status(), 'Phantom capability must not allow Stage 7 approval').toBe(400);
    });
  });

  test.describe('Attack Vector 6: Delegated Authority Case-Sensitivity & Tier Tampering', () => {
    test('AV6.1: Lowercase risk_tier ("high") must NOT evade Stage 7 delegated authority escalation', async ({ request }) => {
      // Create solution with lowercase risk_tier: "high"
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `AV6.1 Lowercase Risk - ${Date.now()}`,
          business_problem: 'Case sensitivity test',
          requesting_unit: 'Red Team',
          owner_name: 'Red Team Lead',
          risk_tier: 'high', // Lowercase
        },
      });
      const sol = await solRes.json();

      // Prepare capability and controls
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: { name: 'Cap', owner_name: 'Owner' },
      });
      const cap = await capRes.json();

      await request.post(`${API_BASE}/api/capabilities/${cap.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });
      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      for (let st = 2; st <= 6; st++) {
        await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: st } });
      }

      // Try to approve with low-tier member Jordan Bell (TIER_1_LOW)
      const approveRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: {
          target_stage: 7,
          approver_name: 'Jordan Bell',
        },
      });

      // Even with lowercase "high", authority validation must enforce HIGH tier (rejecting Jordan Bell)
      expect(approveRes.status(), 'Lowercase risk tier must still enforce high authority tier requirement').toBe(400);
    });
  });

  test.describe('Attack Vector 7: Concurrent Control Mutations & Data Integrity', () => {
    test('AV7.1: Concurrent POST /api/capabilities/:id/controls should preserve all attached controls', async ({ request }) => {
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `AV7.1 Concurrency Cap - ${Date.now()}`,
          owner_name: 'Concurrent Tester',
        },
      });
      const cap = await capRes.json();

      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls: any[] = await ctrlRes.json();
      expect(controls.length).toBeGreaterThanOrEqual(5);

      // Concurrently attach 5 different controls in parallel
      const promises = controls.slice(0, 5).map((c) =>
        request.post(`${API_BASE}/api/capabilities/${cap.id}/controls`, {
          data: { control_ids: [c.id] },
        })
      );
      const responses = await Promise.all(promises);
      for (const r of responses) {
        expect(r.status()).toBe(200);
      }

      // Fetch final capability state
      const finalRes = await request.get(`${API_BASE}/api/capabilities/${cap.id}`);
      const finalCap = await finalRes.json();

      // All 5 controls should be present in control_ids
      for (const c of controls.slice(0, 5)) {
        expect(finalCap.control_ids, `Control ${c.id} must not be lost to race conditions`).toContain(c.id);
      }
    });
  });

});
