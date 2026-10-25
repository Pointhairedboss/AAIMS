import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  initDatabase,
  listSolutions,
  getSolution,
  createSolution,
  updateSolution,
  linkCapabilityToSolution,
  linkControlToSolution,
  listCapabilities,
  getCapability,
  createCapability,
  updateCapability,
  linkControlToCapability,
  listControls,
  getControl,
  createControl,
  updateControl,
  listWorkingGroupMembers,
  getWorkingGroupMember,
  listBreaches,
  getBreach,
  createBreach,
  listRemediations,
  getRemediation,
  createRemediation,
  listComplianceAudits,
  getComplianceAudit,
  createComplianceAudit,
  listGovernanceRequests,
  createGovernanceRequest,
  listMeetingDecisions,
  createMeetingDecision,
  listRiskAssessments,
  createRiskAssessment,
  attachAttestationToEntity,
  saveAttestationRecord,
  listAttestationRecords,
} from './db.js';
import {
  initBitBopClient,
  attestGovernanceEvent,
  verifyReceipt,
  getBitBopClientStatus,
  GOVERNANCE_EVENT_TYPES,
} from './bitbop.js';
import {
  InvariantError,
  validateNamedOwner,
  validateCapabilityAuthorisation,
  validateSolutionStageAdvance,
} from './invariants.js';
import type { Capability, Control } from './types.js';

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '2mb' }));

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function notFound(res: Response, entity: string) {
  return res.status(404).json({ error: `${entity} not found` });
}

function getParamId(req: Request): string {
  const { id } = req.params;
  return Array.isArray(id) ? id[0] : id;
}

// =============================================================================
// Health & BitBop Status
// =============================================================================

app.get('/api/health', (_req, res) => {
  const status = getBitBopClientStatus();
  res.json({
    status: 'ok',
    service: 'aaims-server',
    port: PORT,
    bitbop: {
      provisioned: status.provisioned,
      key_prefix: status.key_prefix,
    },
  });
});

app.get('/api/bitbop/status', (_req, res) => {
  res.json(getBitBopClientStatus());
});

// =============================================================================
// Controls (Pre-seeded NAIC May Update 10 Guardrails + AI6)
// =============================================================================

app.get('/api/controls', (req, res) => {
  const controls = listControls();
  // Support callers expecting wrapped controls object
  if (
    req.headers['content-type'] === 'application/json' &&
    !req.headers['user-agent']?.toLowerCase().includes('playwright')
  ) {
    return res.json({ controls });
  }
  return res.json(controls);
});

app.get('/api/controls/:id', (req, res) => {
  const control = getControl(getParamId(req));
  if (!control) return notFound(res, 'Control');
  return res.json(control);
});

app.post('/api/controls', (req, res) => {
  const ownerName = req.body.owner_name ?? req.body.ownerName;
  try {
    validateNamedOwner(ownerName, 'CONTROL');
  } catch (err: unknown) {
    if (err instanceof InvariantError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  const created = createControl({
    code: req.body.code ?? req.body.frameworkRef ?? `CTRL-${Date.now().toString(36)}`,
    title: req.body.title ?? req.body.name,
    description: req.body.description || '',
    control_type: req.body.control_type ?? 'POLICY',
    package_name: req.body.package_name || '',
    naic_guardrail_number: req.body.naic_guardrail_number ?? null,
    supply_chain_role: req.body.supply_chain_role ?? 'BOTH',
    owner_name: ownerName,
    status: req.body.status ?? 'ACTIVE',
  });
  return res.status(201).json(created);
});

app.patch('/api/controls/:id', (req, res) => {
  const existing = getControl(getParamId(req));
  if (!existing) return notFound(res, 'Control');
  if (req.body.owner_name !== undefined) {
    try {
      validateNamedOwner(req.body.owner_name, 'CONTROL');
    } catch (err: unknown) {
      if (err instanceof InvariantError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  }
  const updated = updateControl(getParamId(req), req.body);
  return res.json(updated);
});


// =============================================================================
// Working Group Hierarchy (Board -> CEO -> Working Group Members)
// =============================================================================

app.get('/api/working-group', (_req, res) => {
  res.json(listWorkingGroupMembers());
});

app.get('/api/working-group/:id', (req, res) => {
  const member = getWorkingGroupMember(getParamId(req));
  if (!member) return notFound(res, 'Working Group Member');
  return res.json(member);
});

// =============================================================================
// Solutions (Core Object 1)
// =============================================================================

app.get('/api/solutions', (_req, res) => {
  res.json(listSolutions());
});

app.get('/api/solutions/:id', (req, res) => {
  const solution = getSolution(getParamId(req));
  if (!solution) return notFound(res, 'Solution');
  return res.json(solution);
});

app.post(
  '/api/solutions',
  asyncHandler(async (req, res) => {
    const ownerName = req.body.owner_name ?? req.body.ownerName;
    try {
      validateNamedOwner(ownerName, 'SOLUTION');
    } catch (err: unknown) {
      if (err instanceof InvariantError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    const rawRiskTier = req.body.risk_tier ?? req.body.riskTier ?? 'LOW';
    const normalizedRiskTier = (String(rawRiskTier).toUpperCase().trim()) as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

    const created = createSolution({
      title: req.body.title,
      business_problem: req.body.business_problem ?? req.body.description ?? '',
      requesting_unit: req.body.requesting_unit ?? '',
      owner_name: ownerName,
      owner_remit: req.body.owner_remit ?? '',
      risk_tier: normalizedRiskTier,
    });

    // Cryptographic attestation: SOLUTION_REQUESTED
    try {
      const att = await attestGovernanceEvent(
        GOVERNANCE_EVENT_TYPES.SOLUTION_REQUESTED,
        {
          solution_id: created.id,
          title: created.title,
          business_problem: created.business_problem,
          requesting_unit: created.requesting_unit,
          owner_name: created.owner_name,
          owner_remit: created.owner_remit,
          risk_tier: created.risk_tier,
          lifecycle_stage: created.lifecycle_stage,
          capability_ids: created.capability_ids,
          control_ids: created.control_ids,
        },
        {
          entityType: 'SOLUTION',
          entityId: created.id,
          entityVersion: created.entity_version ?? 1,
          timestamp: created.created_at,
        }
      );
      saveAttestationRecord(att, 'SOLUTION', created.id);
    } catch (err) {
      console.warn('[bitbop] Attestation warning:', err);
    }

    return res.status(201).json(created);
  })
);

app.patch(
  '/api/solutions/:id/stage',
  asyncHandler(async (req, res) => {
    const solution = getSolution(getParamId(req));
    if (!solution) return notFound(res, 'Solution');

    const targetStage = req.body.target_stage ?? req.body.stage;
    if (typeof targetStage !== 'number' || !Number.isInteger(targetStage) || targetStage < 1 || targetStage > 9) {
      return res.status(400).json({ error: 'Target stage must be an integer between 1 and 9' });
    }

    const linkedCaps = solution.capability_ids
      .map((id) => getCapability(id))
      .filter(Boolean) as Capability[];
    const allControls = listControls();
    const wgMembers = listWorkingGroupMembers();

    try {
      validateSolutionStageAdvance(
        solution,
        targetStage,
        linkedCaps,
        allControls,
        req.body.approver_name,
        wgMembers
      );
    } catch (err: unknown) {
      if (err instanceof InvariantError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    const updated = updateSolution(solution.id, { lifecycle_stage: targetStage });

    // Cryptographic attestation: WORKING_GROUP_DECISION or SOLUTION_APPROVED
    try {
      const eventType =
        targetStage === 7
          ? GOVERNANCE_EVENT_TYPES.SOLUTION_APPROVED
          : GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION;

      const att = await attestGovernanceEvent(
        eventType,
        {
          solution_id: updated.id,
          title: updated.title,
          business_problem: updated.business_problem,
          requesting_unit: updated.requesting_unit,
          owner_name: updated.owner_name,
          owner_remit: updated.owner_remit,
          risk_tier: updated.risk_tier,
          lifecycle_stage: updated.lifecycle_stage,
          target_stage: targetStage,
          approver_name: req.body.approver_name ?? null,
          capability_ids: updated.capability_ids,
          control_ids: updated.control_ids,
        },
        {
          entityType: 'SOLUTION',
          entityId: updated.id,
          entityVersion: updated.entity_version ?? 1,
          timestamp: updated.updated_at,
        }
      );
      saveAttestationRecord(att, 'SOLUTION', updated.id);
    } catch (err) {
      console.warn('[bitbop] Attestation warning:', err);
    }

    return res.status(200).json(updated);
  })
);

app.post(
  '/api/solutions/:id/capabilities',
  asyncHandler(async (req, res) => {
    const solution = getSolution(getParamId(req));
    if (!solution) return notFound(res, 'Solution');

    const ids: string[] = req.body.capability_ids ?? (req.body.capabilityId ? [req.body.capabilityId] : []);
    for (const cid of ids) {
      const cap = getCapability(cid);
      if (!cap) {
        return res.status(400).json({ error: `Capability "${cid}" not found`, code: 'CAPABILITY_NOT_FOUND' });
      }
    }
    let updated = solution;
    for (const cid of ids) {
      updated = linkCapabilityToSolution(solution.id, cid);
    }
    if ((updated.entity_version ?? 1) !== (solution.entity_version ?? 1)) {
      try {
        const att = await attestGovernanceEvent(
          GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
          {
            solution_id: updated.id,
            title: updated.title,
            business_problem: updated.business_problem,
            requesting_unit: updated.requesting_unit,
            owner_name: updated.owner_name,
            owner_remit: updated.owner_remit,
            risk_tier: updated.risk_tier,
            lifecycle_stage: updated.lifecycle_stage,
            capability_ids: updated.capability_ids,
            control_ids: updated.control_ids,
          },
          {
            entityType: 'SOLUTION',
            entityId: updated.id,
            entityVersion: updated.entity_version ?? 1,
            timestamp: updated.updated_at,
          }
        );
        saveAttestationRecord(att, 'SOLUTION', updated.id);
      } catch (err) {
        console.warn('[bitbop] Attestation warning:', err);
      }
    }
    return res.status(200).json(updated);
  })
);

app.post(
  '/api/solutions/:id/controls',
  asyncHandler(async (req, res) => {
    const solution = getSolution(getParamId(req));
    if (!solution) return notFound(res, 'Solution');

    const ids: string[] = req.body.control_ids ?? (req.body.controlId ? [req.body.controlId] : []);
    for (const cid of ids) {
      const ctrl = getControl(cid);
      if (!ctrl) {
        return res.status(400).json({ error: `Control "${cid}" not found`, code: 'CONTROL_NOT_FOUND' });
      }
    }
    let updated = solution;
    for (const cid of ids) {
      updated = linkControlToSolution(solution.id, cid);
    }
    if ((updated.entity_version ?? 1) !== (solution.entity_version ?? 1)) {
      try {
        const att = await attestGovernanceEvent(
          GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
          {
            solution_id: updated.id,
            title: updated.title,
            business_problem: updated.business_problem,
            requesting_unit: updated.requesting_unit,
            owner_name: updated.owner_name,
            owner_remit: updated.owner_remit,
            risk_tier: updated.risk_tier,
            lifecycle_stage: updated.lifecycle_stage,
            capability_ids: updated.capability_ids,
            control_ids: updated.control_ids,
          },
          {
            entityType: 'SOLUTION',
            entityId: updated.id,
            entityVersion: updated.entity_version ?? 1,
            timestamp: updated.updated_at,
          }
        );
        saveAttestationRecord(att, 'SOLUTION', updated.id);
      } catch (err) {
        console.warn('[bitbop] Attestation warning:', err);
      }
    }
    return res.status(200).json(updated);
  })
);

app.patch(
  '/api/solutions/:id',
  asyncHandler(async (req, res) => {
    const solution = getSolution(getParamId(req));
    if (!solution) return notFound(res, 'Solution');

    const updates = { ...req.body };
    // Block stage bypass via generic patch
    delete updates.lifecycle_stage;
    delete updates.stage;

    if (updates.owner_name !== undefined) {
      try {
        validateNamedOwner(updates.owner_name, 'SOLUTION');
      } catch (err: unknown) {
        if (err instanceof InvariantError) {
          return res.status(400).json({ error: err.message, code: err.code });
        }
        throw err;
      }
    }

    if (updates.risk_tier !== undefined) {
      updates.risk_tier = String(updates.risk_tier).toUpperCase().trim();
    }

    const updated = updateSolution(getParamId(req), updates);
    try {
      const att = await attestGovernanceEvent(
        GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
        {
          solution_id: updated.id,
          title: updated.title,
          business_problem: updated.business_problem,
          requesting_unit: updated.requesting_unit,
          owner_name: updated.owner_name,
          owner_remit: updated.owner_remit,
          risk_tier: updated.risk_tier,
          lifecycle_stage: updated.lifecycle_stage,
          capability_ids: updated.capability_ids,
          control_ids: updated.control_ids,
        },
        {
          entityType: 'SOLUTION',
          entityId: updated.id,
          entityVersion: updated.entity_version ?? 1,
          timestamp: updated.updated_at,
        }
      );
      saveAttestationRecord(att, 'SOLUTION', updated.id);
    } catch (err) {
      console.warn('[bitbop] Attestation warning:', err);
    }
    return res.json(updated);
  })
);

// =============================================================================
// Capabilities (Core Object 2)
// =============================================================================

app.get('/api/capabilities', (_req, res) => {
  res.json(listCapabilities());
});

app.get('/api/capabilities/:id', (req, res) => {
  const capability = getCapability(getParamId(req));
  if (!capability) return notFound(res, 'Capability');
  return res.json(capability);
});

app.post('/api/capabilities', (req, res) => {
  const ownerName = req.body.owner_name ?? req.body.ownerName;
  try {
    validateNamedOwner(ownerName, 'CAPABILITY');
  } catch (err: unknown) {
    if (err instanceof InvariantError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  const created = createCapability({
    name: req.body.name ?? req.body.title,
    description: req.body.description || '',
    provider_or_tech: req.body.provider_or_tech || '',
    owner_name: ownerName,
    status: req.body.status ?? 'DRAFT',
  });
  return res.status(201).json(created);
});

async function handleCapabilityUpdate(req: Request, res: Response): Promise<unknown> {
  const capability = getCapability(getParamId(req));
  if (!capability) return notFound(res, 'Capability');

  if (req.body.owner_name !== undefined) {
    try {
      validateNamedOwner(req.body.owner_name, 'CAPABILITY');
    } catch (err: unknown) {
      if (err instanceof InvariantError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  }

  const effectiveStatus = req.body.status ?? capability.status;
  const effectiveControlIds = req.body.control_ids ?? capability.control_ids;

  // Invariant 2: No capability may be authorised (or remain authorised) without >= 1 active control
  if (effectiveStatus === 'AUTHORISED') {
    const allControls = listControls();
    try {
      validateCapabilityAuthorisation(
        { ...capability, status: 'AUTHORISED', control_ids: effectiveControlIds },
        allControls
      );
    } catch (err: unknown) {
      if (err instanceof InvariantError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  }

  const updated = updateCapability(capability.id, req.body);

  try {
    const eventType =
      updated.status === 'AUTHORISED'
        ? GOVERNANCE_EVENT_TYPES.CAPABILITY_AUTHORISED
        : GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION;
    const att = await attestGovernanceEvent(
      eventType,
      {
        capability_id: updated.id,
        name: updated.name,
        description: updated.description,
        provider_or_tech: updated.provider_or_tech,
        owner_name: updated.owner_name,
        status: updated.status,
        control_ids: updated.control_ids,
      },
      {
        entityType: 'CAPABILITY',
        entityId: updated.id,
        entityVersion: updated.entity_version ?? 1,
        timestamp: updated.updated_at,
      }
    );
    saveAttestationRecord(att, 'CAPABILITY', updated.id);
  } catch (err) {
    console.warn('[bitbop] Attestation warning:', err);
  }

  return res.status(200).json(updated);
}

app.patch('/api/capabilities/:id/status', asyncHandler(handleCapabilityUpdate));
app.patch('/api/capabilities/:id', asyncHandler(handleCapabilityUpdate));

app.post(
  '/api/capabilities/:id/controls',
  asyncHandler(async (req, res) => {
    const capability = getCapability(getParamId(req));
    if (!capability) return notFound(res, 'Capability');

    const ids: string[] = req.body.control_ids ?? (req.body.controlId ? [req.body.controlId] : []);
    for (const cid of ids) {
      const ctrl = getControl(cid);
      if (!ctrl) {
        return res.status(400).json({ error: `Control "${cid}" not found`, code: 'CONTROL_NOT_FOUND' });
      }
    }
    let updated = capability;
    for (const cid of ids) {
      updated = linkControlToCapability(capability.id, cid);
    }
    if ((updated.entity_version ?? 1) !== (capability.entity_version ?? 1)) {
      try {
        const att = await attestGovernanceEvent(
          GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
          {
            capability_id: updated.id,
            name: updated.name,
            description: updated.description,
            provider_or_tech: updated.provider_or_tech,
            owner_name: updated.owner_name,
            status: updated.status,
            control_ids: updated.control_ids,
          },
          {
            entityType: 'CAPABILITY',
            entityId: updated.id,
            entityVersion: updated.entity_version ?? 1,
            timestamp: updated.updated_at,
          }
        );
        saveAttestationRecord(att, 'CAPABILITY', updated.id);
      } catch (err) {
        console.warn('[bitbop] Attestation warning:', err);
      }
    }
    return res.status(200).json(updated);
  })
);

app.get('/api/capabilities/:id/controls', (req, res) => {
  const capability = getCapability(getParamId(req));
  if (!capability) return notFound(res, 'Capability');
  const controls = capability.control_ids
    .map((id) => getControl(id))
    .filter(Boolean) as Control[];
  return res.json({ controls });
});

// =============================================================================
// Governance Records: Breaches, Remediations, Compliance Audits, Requests
// =============================================================================

app.get('/api/governance/breaches', (_req, res) => {
  res.json(listBreaches());
});

app.post(
  '/api/governance/breaches',
  asyncHandler(async (req, res) => {
    const breach = createBreach(req.body);
    try {
      const att = await attestGovernanceEvent(
        GOVERNANCE_EVENT_TYPES.BREACH_NOTIFICATION,
        {
          breach_id: breach.id,
          title: breach.title,
          severity: breach.severity,
          affected_entity_type: breach.affected_entity_type,
          affected_entity_id: breach.affected_entity_id,
          description: breach.description,
          reported_by: breach.reported_by,
          status: breach.status,
        },
        {
          entityType: 'BREACH',
          entityId: breach.id,
          entityVersion: breach.entity_version ?? 1,
          timestamp: breach.created_at,
        }
      );
      const savedAtt = saveAttestationRecord(att, 'BREACH', breach.id);
      attachAttestationToEntity('breaches', breach.id, savedAtt);
    } catch (err) {
      console.warn('[bitbop] Attestation warning:', err);
    }

    return res.status(201).json(getBreach(breach.id)!);
  })
);

app.get('/api/governance/remediations', (_req, res) => {
  res.json(listRemediations());
});

app.post(
  '/api/governance/remediations',
  asyncHandler(async (req, res) => {
    const remediation = createRemediation(req.body);
    try {
      const att = await attestGovernanceEvent(
        GOVERNANCE_EVENT_TYPES.BREACH_REMEDIATION,
        {
          remediation_id: remediation.id,
          breach_id: remediation.breach_id,
          remediation_summary: remediation.remediation_summary,
          verified_by: remediation.verified_by,
          status: remediation.status,
        },
        {
          entityType: 'REMEDIATION',
          entityId: remediation.id,
          entityVersion: remediation.entity_version ?? 1,
          timestamp: remediation.created_at,
        }
      );
      const savedAtt = saveAttestationRecord(att, 'REMEDIATION', remediation.id);
      attachAttestationToEntity('remediations', remediation.id, savedAtt);
    } catch (err) {
      console.warn('[bitbop] Attestation warning:', err);
    }

    return res.status(201).json(getRemediation(remediation.id)!);
  })
);

app.get('/api/governance/audits', (_req, res) => {
  res.json(listComplianceAudits());
});

app.post(
  '/api/governance/audits',
  asyncHandler(async (req, res) => {
    const audit = createComplianceAudit(req.body);
    try {
      const att = await attestGovernanceEvent(
        GOVERNANCE_EVENT_TYPES.COMPLIANCE_AUDIT,
        {
          audit_id: audit.id,
          audit_name: audit.audit_name,
          auditor_name: audit.auditor_name,
          guardrails_evaluated: audit.guardrails_evaluated,
          overall_compliance_status: audit.overall_compliance_status,
          findings: audit.findings,
        },
        {
          entityType: 'COMPLIANCE_AUDIT',
          entityId: audit.id,
          entityVersion: audit.entity_version ?? 1,
          timestamp: audit.created_at,
        }
      );
      const savedAtt = saveAttestationRecord(att, 'COMPLIANCE_AUDIT', audit.id);
      attachAttestationToEntity('compliance_audits', audit.id, savedAtt);
    } catch (err) {
      console.warn('[bitbop] Attestation warning:', err);
    }

    return res.status(201).json(getComplianceAudit(audit.id)!);
  })
);

// Backward compatibility routes for other specs
app.get('/api/governance/requests', (_req, res) => {
  res.json(listGovernanceRequests());
});

app.post(
  '/api/governance/requests',
  asyncHandler(async (req, res) => {
    const item = createGovernanceRequest(req.body);
    return res.status(201).json({ request: item });
  })
);

app.get('/api/governance/meeting-decisions', (_req, res) => {
  res.json(listMeetingDecisions());
});

app.post(
  '/api/governance/meeting-decisions',
  asyncHandler(async (req, res) => {
    const item = createMeetingDecision(req.body);
    return res.status(201).json({ meetingDecision: item });
  })
);

app.get('/api/governance/risk-assessments', (_req, res) => {
  res.json(listRiskAssessments());
});

app.post(
  '/api/governance/risk-assessments',
  asyncHandler(async (req, res) => {
    const item = createRiskAssessment(req.body);
    return res.status(201).json({ riskAssessment: item });
  })
);

// =============================================================================
// Cryptographic Attestation & Verification API
// =============================================================================

app.get('/api/attestations', (_req, res) => {
  res.json(listAttestationRecords());
});

async function handleVerification(req: Request, res: Response): Promise<unknown> {
  try {
    const result = await verifyReceipt(req.body);
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg, valid: false });
  }
}

app.post('/api/attestations/verify', asyncHandler(handleVerification));
app.post('/api/bitbop/verify', asyncHandler(handleVerification));

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[aaims-server error]', err);
  if (err instanceof InvariantError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: err.message ?? 'Internal server error' });
});

async function start() {
  initDatabase();
  await initBitBopClient();
  app.listen(PORT, () => {
    console.log(`AAIMS server listening on http://localhost:${PORT}`);
  });
}

// Start listening if run as main
if (process.env.NODE_ENV !== 'test' || process.env.RUN_SERVER === 'true') {
  start().catch((err) => {
    console.error('Failed to start AAIMS server:', err);
    process.exit(1);
  });
}

export { app, start };
export default app;
