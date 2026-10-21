import { test, expect } from '@playwright/test';

/**
 * AAIMS Invariant Enforcement & Programmatic API Test Suite
 *
 * Opaque-box verification of all HTTP 400 regulatory gates, domain invariants,
 * named ownership rules, and delegated authority tiers per:
 * - ORIGINAL_REQUEST.md § Acceptance Criteria
 * - AAIMS_POC_SPEC.md § 2 Mandatory Business Rules & § 3 Approval Hierarchy
 */

test.describe('AAIMS Invariant Enforcement & API Gates (Tier 2 & 3)', () => {
  const API_BASE = process.env.API_URL || 'http://localhost:4000';

  test.describe('Health & Service Baseline', () => {
    test('GET /api/health returns 200 with BitBop key provisioning status', async ({ request }) => {
      const res = await request.get(`${API_BASE}/api/health`);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('bitbop');
      expect(data.bitbop).toHaveProperty('provisioned', true);
    });
  });

  test.describe('Pre-Seeded NAIC Standard & Governance Hierarchy Baseline', () => {
    test('GET /api/controls returns pre-seeded NAIC 10 Guardrails with G8-DEV and G8-DEP', async ({ request }) => {
      const res = await request.get(`${API_BASE}/api/controls`);
      expect(res.status()).toBe(200);
      const controls: any[] = await res.json();
      expect(Array.isArray(controls)).toBe(true);
      expect(controls.length).toBeGreaterThanOrEqual(11);

      // Verify NAIC 10 Guardrails
      const codes = controls.map((c) => c.code);
      expect(codes).toContain('NAIC-G1');
      expect(codes).toContain('NAIC-G2');
      expect(codes).toContain('NAIC-G3');
      expect(codes).toContain('NAIC-G4');
      expect(codes).toContain('NAIC-G5');
      expect(codes).toContain('NAIC-G6');
      expect(codes).toContain('NAIC-G7');
      expect(codes).toContain('NAIC-G8-DEV');
      expect(codes).toContain('NAIC-G8-DEP');
      expect(codes).toContain('NAIC-G9');
      expect(codes).toContain('NAIC-G10');

      // Verify supply chain roles on Guardrail 8
      const g8Dev = controls.find((c) => c.code === 'NAIC-G8-DEV');
      const g8Dep = controls.find((c) => c.code === 'NAIC-G8-DEP');
      expect(g8Dev.supply_chain_role).toBe('DEVELOPER');
      expect(g8Dep.supply_chain_role).toBe('DEPLOYER');

      // Verify named owners on all controls
      for (const ctrl of controls) {
        expect(ctrl.owner_name, `Control ${ctrl.code} must have a named owner`).toBeTruthy();
      }
    });

    test('GET /api/controls returns pre-seeded NAIC AI6 Essential Practices', async ({ request }) => {
      const res = await request.get(`${API_BASE}/api/controls`);
      expect(res.status()).toBe(200);
      const controls: any[] = await res.json();
      const ai6Codes = ['AI6-P1', 'AI6-P2', 'AI6-P3', 'AI6-P4', 'AI6-P5', 'AI6-P6'];
      const presentCodes = controls.map((c) => c.code);

      for (const p of ai6Codes) {
        expect(presentCodes).toContain(p);
      }
    });

    test('GET /api/working-group returns Board -> CEO -> Working Group members with authority tiers', async ({ request }) => {
      const res = await request.get(`${API_BASE}/api/working-group`);
      expect(res.status()).toBe(200);
      const members: any[] = await res.json();
      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBeGreaterThanOrEqual(3);

      const tiers = members.map((m) => m.authority_tier);
      expect(tiers).toContain('TIER_1_LOW');
      expect(tiers).toContain('TIER_3_HIGH_EXEC');

      for (const member of members) {
        expect(member.name).toBeTruthy();
        expect(member.business_remit).toBeTruthy();
      }
    });
  });

  test.describe('Mandatory Named Ownership Enforcement (Invariant 0)', () => {
    test('POST /api/solutions rejects creation when owner_name is missing or empty (HTTP 400)', async ({ request }) => {
      const payload = {
        title: 'Unowned Chatbot',
        business_problem: 'Automate inquiries without owner',
        requesting_unit: 'Marketing',
        owner_name: '', // Empty owner
        owner_remit: 'Brand',
        risk_tier: 'LOW',
      };

      const res = await request.post(`${API_BASE}/api/solutions`, { data: payload });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/owner/i);
    });

    test('POST /api/capabilities rejects creation when owner_name is missing or empty (HTTP 400)', async ({ request }) => {
      const payload = {
        name: 'Unowned RAG Pipeline',
        description: 'Vector search service',
        provider_or_tech: 'ChromaDB',
        owner_name: '', // Empty owner
      };

      const res = await request.post(`${API_BASE}/api/capabilities`, { data: payload });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/owner/i);
    });

    test('POST /api/controls rejects creation when owner_name is missing or empty (HTTP 400)', async ({ request }) => {
      const payload = {
        code: 'CUSTOM-CTRL-01',
        title: 'Custom Safety Gate',
        description: 'Enforce prompt filtering',
        control_type: 'TECHNICAL',
        package_name: 'Custom Package',
        supply_chain_role: 'DEVELOPER',
        owner_name: '', // Empty owner
      };

      const res = await request.post(`${API_BASE}/api/controls`, { data: payload });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/owner/i);
    });
  });

  test.describe('Invariant 2: Capability Authorisation Gate', () => {
    test('PATCH /api/capabilities/:id/status rejects AUTHORISED when capability has 0 controls (HTTP 400)', async ({ request }) => {
      // 1. Create a raw capability with no controls
      const createRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Ungoverned LLM - ${Date.now()}`,
          description: 'A model with zero attached controls',
          provider_or_tech: 'OpenAI GPT-4o',
          owner_name: 'Dev Lead Alex',
        },
      });
      expect(createRes.status()).toBe(201);
      const cap = await createRes.json();
      expect(cap.status).toBe('DRAFT');
      expect(cap.control_ids.length).toBe(0);

      // 2. Attempt to authorise without controls -> MUST REJECT WITH HTTP 400
      const patchRes = await request.patch(`${API_BASE}/api/capabilities/${cap.id}/status`, {
        data: { status: 'AUTHORISED' },
      });
      expect(patchRes.status()).toBe(400);
      const err = await patchRes.json();
      expect(err.error).toMatch(/control/i);

      // 3. Verify status remains DRAFT
      const getRes = await request.get(`${API_BASE}/api/capabilities/${cap.id}`);
      const refreshedCap = await getRes.json();
      expect(refreshedCap.status).toBe('DRAFT');
    });

    test('PATCH /api/capabilities/:id/status permits AUTHORISED once an ACTIVE control is attached', async ({ request }) => {
      // 1. Create capability
      const createRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Governed LLM - ${Date.now()}`,
          description: 'A model with verified active control',
          provider_or_tech: 'Claude 3.5 Sonnet',
          owner_name: 'Lead AI Engineer',
        },
      });
      const cap = await createRes.json();

      // 2. Attach an active control (e.g. NAIC-G3 Data Governance)
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      const activeCtrl = controls.find((c: any) => c.status === 'ACTIVE');
      expect(activeCtrl).toBeDefined();

      const attachRes = await request.post(`${API_BASE}/api/capabilities/${cap.id}/controls`, {
        data: { control_ids: [activeCtrl.id] },
      });
      expect(attachRes.status()).toBe(200);

      // 3. Authorise -> MUST SUCCEED
      const authRes = await request.patch(`${API_BASE}/api/capabilities/${cap.id}/status`, {
        data: { status: 'AUTHORISED' },
      });
      expect(authRes.status()).toBe(200);
      const authCap = await authRes.json();
      expect(authCap.status).toBe('AUTHORISED');
    });
  });

  test.describe('Invariant 1a: Solution Capability Gate (Stage 4)', () => {
    test('PATCH /api/solutions/:id/stage rejects advancement past Stage 4 when capability_ids is empty (HTTP 400)', async ({ request }) => {
      // 1. Create a new Solution Request (Stage 1)
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `Autonomous Agent - ${Date.now()}`,
          business_problem: 'Process high-volume incoming contracts',
          requesting_unit: 'Legal Operations',
          owner_name: 'Head of Legal Tech',
          owner_remit: 'Legal Automation',
          risk_tier: 'MEDIUM',
        },
      });
      expect(solRes.status()).toBe(201);
      const sol = await solRes.json();
      expect(sol.lifecycle_stage).toBe(1);

      // 2. Advance to Stage 2 (Investigate)
      const s2 = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 2 } });
      expect(s2.status()).toBe(200);

      // 3. Advance to Stage 3 (Assign Owner)
      const s3 = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 3 } });
      expect(s3.status()).toBe(200);

      // 4. Advance to Stage 4 (Identify Capabilities)
      const s4 = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 4 } });
      expect(s4.status()).toBe(200);

      // 5. Attempt to advance to Stage 5 without linking any capabilities -> MUST REJECT WITH HTTP 400
      const s5 = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 5 } });
      expect(s5.status()).toBe(400);
      const err = await s5.json();
      expect(err.error).toMatch(/capability/i);
    });
  });

  test.describe('Invariant 1b: Solution Control Gate & Approval Gate (Stage 5 & Stage 7)', () => {
    test('PATCH /api/solutions/:id/stage rejects advancement past Stage 5 when control_ids is empty (HTTP 400)', async ({ request }) => {
      // 1. Create solution and link a capability
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `Uncontrolled Solution - ${Date.now()}`,
          business_problem: 'Automated credit decisions',
          requesting_unit: 'Credit Risk',
          owner_name: 'Credit Risk Lead',
          owner_remit: 'Credit Products',
          risk_tier: 'HIGH',
        },
      });
      const sol = await solRes.json();

      // Create and attach a capability
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Credit Scoring Model - ${Date.now()}`,
          description: 'ML model for scorecards',
          provider_or_tech: 'XGBoost',
          owner_name: 'Data Science Lead',
        },
      });
      const cap = await capRes.json();

      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });

      // Step to Stage 4
      await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 2 } });
      await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 3 } });
      await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 4 } });

      // Step to Stage 5
      const s5 = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 5 } });
      expect(s5.status()).toBe(200);

      // Attempt to advance to Stage 6 (Assess) without any controls -> MUST REJECT WITH HTTP 400
      const s6 = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: 6 } });
      expect(s6.status()).toBe(400);
      const err = await s6.json();
      expect(err.error).toMatch(/control/i);
    });

    test('PATCH /api/solutions/:id/stage rejects Stage 7 Approval if any linked capability has zero active controls (HTTP 400)', async ({ request }) => {
      // Create solution and capability
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `Governance Bypass Test - ${Date.now()}`,
          business_problem: 'Testing capability control inheritance',
          requesting_unit: 'Compliance',
          owner_name: 'Audit Manager',
          owner_remit: 'Governance Testing',
          risk_tier: 'LOW',
        },
      });
      const sol = await solRes.json();

      // Capability has NO controls attached to it
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Bare Model - ${Date.now()}`,
          description: 'Model with zero controls',
          provider_or_tech: 'PyTorch',
          owner_name: 'ML Engineer',
        },
      });
      const cap = await capRes.json();

      // Attach capability to solution
      await request.post(`${API_BASE}/api/solutions/${sol.id}/capabilities`, {
        data: { capability_ids: [cap.id] },
      });

      // Attach control ONLY to the solution, but NOT to the capability
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      await request.post(`${API_BASE}/api/solutions/${sol.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });

      // Advance through stages 2 -> 6
      for (let st = 2; st <= 6; st++) {
        await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, { data: { target_stage: st } });
      }

      // Attempt Stage 7 Approval -> Must reject because linked capability has 0 active controls
      const approveRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: {
          target_stage: 7,
          approver_name: 'Board Delegate Officer',
        },
      });
      expect(approveRes.status()).toBe(400);
      const err = await approveRes.json();
      expect(err.error).toMatch(/capability.*control/i);
    });
  });

  test.describe('Delegated Approval Authority Tier Validation', () => {
    test('PATCH /api/solutions/:id/stage rejects HIGH-risk approval by TIER_1_LOW approver (HTTP 400)', async ({ request }) => {
      // 1. Create a HIGH-risk solution
      const solRes = await request.post(`${API_BASE}/api/solutions`, {
        data: {
          title: `High Risk Diagnostic AI - ${Date.now()}`,
          business_problem: 'Clinical triaging assistance',
          requesting_unit: 'Clinical Ops',
          owner_name: 'Chief Medical Officer',
          owner_remit: 'Clinical Care',
          risk_tier: 'HIGH',
        },
      });
      const sol = await solRes.json();

      // 2. Set up capability and control
      const ctrlRes = await request.get(`${API_BASE}/api/controls`);
      const controls = await ctrlRes.json();
      const capRes = await request.post(`${API_BASE}/api/capabilities`, {
        data: {
          name: `Diagnostic Engine - ${Date.now()}`,
          description: 'Vision triage',
          provider_or_tech: 'Custom CNN',
          owner_name: 'Lead Scientist',
        },
      });
      const cap = await capRes.json();

      // Govern capability and solution
      await request.post(`${API_BASE}/api/capabilities/${cap.id}/controls`, {
        data: { control_ids: [controls[0].id] },
      });
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

      // Find a member with TIER_1_LOW
      const wgRes = await request.get(`${API_BASE}/api/working-group`);
      const members = await wgRes.json();
      const lowMember = members.find((m: any) => m.authority_tier === 'TIER_1_LOW');
      expect(lowMember).toBeDefined();

      // 3. Attempt approval with low-tier approver -> MUST REJECT WITH HTTP 400
      const rejectRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: {
          target_stage: 7,
          approver_name: lowMember.name,
        },
      });
      expect(rejectRes.status()).toBe(400);
      const err = await rejectRes.json();
      expect(err.error).toMatch(/authority|tier|escalat/i);

      // 4. Approve with high-tier or board delegate member -> MUST SUCCEED
      const highMember = members.find(
        (m: any) => m.authority_tier === 'TIER_3_HIGH_EXEC' || m.authority_tier === 'BOARD_DELEGATE'
      );
      expect(highMember).toBeDefined();

      const successRes = await request.patch(`${API_BASE}/api/solutions/${sol.id}/stage`, {
        data: {
          target_stage: 7,
          approver_name: highMember.name,
        },
      });
      expect(successRes.status()).toBe(200);
      const approvedSol = await successRes.json();
      expect(approvedSol.lifecycle_stage).toBe(7);
    });
  });

  test.describe('Governance Records & Cryptographic Attestation API', () => {
    test('POST /api/governance/breaches logs incident and emits BREACH_NOTIFICATION attestation', async ({ request }) => {
      const payload = {
        title: 'Adversarial Prompt Drift In Canary',
        severity: 'HIGH',
        affected_entity_type: 'CAPABILITY',
        affected_entity_id: 'sample-cap-id',
        description: 'Jailbreak attempt triggered boundary alarm',
        reported_by: 'Safety Officer Dave',
      };

      const res = await request.post(`${API_BASE}/api/governance/breaches`, { data: payload });
      expect(res.status()).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('id');
      expect(data.title).toBe(payload.title);

      // Verify attestation receipt
      expect(data).toHaveProperty('attestation');
      expect(data.attestation.event_type).toBe('BREACH_NOTIFICATION');
      expect(data.attestation.beacon_sequence).toBeGreaterThan(0);
      expect(data.attestation.signature).toBeTruthy();
    });

    test('POST /api/governance/remediations submits remediation and emits BREACH_REMEDIATION attestation', async ({ request }) => {
      // First create a breach
      const breachRes = await request.post(`${API_BASE}/api/governance/breaches`, {
        data: {
          title: 'PII Exposure In Log',
          severity: 'MEDIUM',
          affected_entity_type: 'SOLUTION',
          affected_entity_id: 'sample-sol-id',
          description: 'PII token masked improperly',
          reported_by: 'Privacy Analyst',
        },
      });
      const breach = await breachRes.json();

      const remRes = await request.post(`${API_BASE}/api/governance/remediations`, {
        data: {
          breach_id: breach.id,
          remediation_summary: 'Rotated API tokens and enabled Guardrail 3 redact filter',
          verified_by: 'Elena Rostova, Chief Privacy Officer',
        },
      });
      expect(remRes.status()).toBe(201);
      const rem = await remRes.json();
      expect(rem.breach_id).toBe(breach.id);
      expect(rem.attestation.event_type).toBe('BREACH_REMEDIATION');
      expect(rem.attestation.beacon_sequence).toBeGreaterThan(0);
    });

    test('POST /api/governance/audits logs compliance audit and emits COMPLIANCE_AUDIT attestation', async ({ request }) => {
      const auditPayload = {
        audit_name: 'Q3 NAIC 10 Guardrails Verification Audit',
        auditor_name: 'Lead Regulatory Auditor',
        guardrails_evaluated: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        overall_compliance_status: 'COMPLIANT',
        findings: 'All controls active and attested.',
      };

      const res = await request.post(`${API_BASE}/api/governance/audits`, { data: auditPayload });
      expect(res.status()).toBe(201);
      const audit = await res.json();
      expect(audit.attestation.event_type).toBe('COMPLIANCE_AUDIT');
      expect(audit.attestation.beacon_sequence).toBeGreaterThan(0);
    });
  });
});
