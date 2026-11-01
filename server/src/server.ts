import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  getDb,
  initDatabase,
  listSolutions,
  getSolution,
  createSolution,
  updateSolution,
  linkCapabilitiesToSolution,
  linkControlsToSolution,
  listCapabilities,
  getCapability,
  createCapability,
  updateCapability,
  linkControlsToCapability,
  listControls,
  getControl,
  createControl,
  updateControl,
  listWorkingGroupMembers,
  getWorkingGroupMember,
  listBreaches,
  getBreach,
  createBreach,
  updateBreach,
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
  hasAttestationForEntityVersion,
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
import type { BitBopReceipt, Capability, Control } from './types.js';

const PORT = Number(process.env.PORT ?? 4000);

export class GovernanceAttestationError extends Error {
  public readonly reason: string;

  constructor(reason: string) {
    super('Quantum governance attestation failed; state change rolled back');
    this.name = 'GovernanceAttestationError';
    this.reason = reason;
  }
}

class HttpRouteError extends Error {
  public readonly statusCode: number;
  public readonly payload: Record<string, unknown>;

  constructor(statusCode: number, payload: Record<string, unknown>) {
    super(typeof payload.error === 'string' ? payload.error : `HTTP ${statusCode}`);
    this.name = 'HttpRouteError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

let mutationMutex: Promise<void> = Promise.resolve();
let savepointCounter = 0;

/**
 * Serializes governance state mutations and wraps SQLite writes + BitBop attestation
 * inside an atomic SQLite SAVEPOINT. Any attestation or validation failure rolls back
 * the SQLite state completely (fail-closed).
 */
export async function withGovernanceTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const previous = mutationMutex;
  let releaseMutex!: () => void;
  mutationMutex = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });

  await previous;
  const spName = `gov_sp_${++savepointCounter}`;
  const database = getDb();
  database.exec(`SAVEPOINT ${spName}`);
  try {
    const result = await fn();
    database.exec(`RELEASE SAVEPOINT ${spName}`);
    return result;
  } catch (err) {
    try {
      database.exec(`ROLLBACK TO SAVEPOINT ${spName}`);
      database.exec(`RELEASE SAVEPOINT ${spName}`);
    } catch (rollbackErr) {
      console.error('[aaims-server] Savepoint rollback error:', rollbackErr);
    }
    throw err;
  } finally {
    releaseMutex();
  }
}

async function attestAndSave(
  eventType: string,
  payload: Record<string, unknown>,
  entityType: string,
  entityId: string,
  entityVersion: number,
  timestamp: string
): Promise<BitBopReceipt> {
  try {
    const att = await attestGovernanceEvent(eventType, payload, {
      entityType,
      entityId,
      entityVersion,
      timestamp,
    });
    return saveAttestationRecord(att, entityType, entityId);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new GovernanceAttestationError(reason);
  }
}

/**
 * Emits real v1 post-quantum attestations for any pre-seeded Solutions and Capabilities
 * that do not yet have an initial attestation record in SQLite.
 */
export async function bootstrapSeedAttestations(): Promise<void> {
  const capabilities = listCapabilities();
  for (const cap of capabilities) {
    const version = cap.entity_version ?? 1;
    if (!hasAttestationForEntityVersion('CAPABILITY', cap.id, version)) {
      await withGovernanceTransaction(async () => {
        if (hasAttestationForEntityVersion('CAPABILITY', cap.id, version)) return;
        const eventType =
          cap.status === 'AUTHORISED'
            ? GOVERNANCE_EVENT_TYPES.CAPABILITY_AUTHORISED
            : GOVERNANCE_EVENT_TYPES.CAPABILITY_CREATED;
        await attestAndSave(
          eventType,
          {
            capability_id: cap.id,
            name: cap.name,
            description: cap.description,
            provider_or_tech: cap.provider_or_tech,
            owner_name: cap.owner_name,
            status: cap.status,
            control_ids: cap.control_ids,
          },
          'CAPABILITY',
          cap.id,
          version,
          cap.created_at
        );
      });
    }
  }

  const solutions = listSolutions();
  for (const sol of solutions) {
    const version = sol.entity_version ?? 1;
    if (!hasAttestationForEntityVersion('SOLUTION', sol.id, version)) {
      await withGovernanceTransaction(async () => {
        if (hasAttestationForEntityVersion('SOLUTION', sol.id, version)) return;
        await attestAndSave(
          GOVERNANCE_EVENT_TYPES.SOLUTION_REQUESTED,
          {
            solution_id: sol.id,
            title: sol.title,
            business_problem: sol.business_problem,
            requesting_unit: sol.requesting_unit,
            owner_name: sol.owner_name,
            owner_remit: sol.owner_remit,
            risk_tier: sol.risk_tier,
            lifecycle_stage: sol.lifecycle_stage,
            capability_ids: sol.capability_ids,
            control_ids: sol.control_ids,
          },
          'SOLUTION',
          sol.id,
          version,
          sol.created_at
        );
      });
    }
  }
}

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
      pinned_key_id: status.pinned_key_id,
    },
  });
});

app.get('/api/bitbop/status', (_req, res) => {
  res.json(getBitBopClientStatus());
});

// =============================================================================
// Controls (Pre-seeded NAIC May Update 10 Guardrails + AI6)
// =============================================================================

app.get('/api/controls', (_req, res) => {
  return res.json(listControls());
});

app.get('/api/controls/:id', (req, res) => {
  const control = getControl(getParamId(req));
  if (!control) return notFound(res, 'Control');
  return res.json(control);
});

app.post(
  '/api/controls',
  asyncHandler(async (req, res) => {
    const ownerName = req.body.owner_name ?? req.body.ownerName;
    validateNamedOwner(ownerName, 'CONTROL');

    const created = await withGovernanceTransaction(async () => {
      const ctrl = createControl({
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

      await attestAndSave(
        GOVERNANCE_EVENT_TYPES.CONTROL_CREATED,
        {
          control_id: ctrl.id,
          code: ctrl.code,
          title: ctrl.title,
          description: ctrl.description,
          control_type: ctrl.control_type,
          package_name: ctrl.package_name,
          naic_guardrail_number: ctrl.naic_guardrail_number,
          supply_chain_role: ctrl.supply_chain_role,
          owner_name: ctrl.owner_name,
          status: ctrl.status,
        },
        'CONTROL',
        ctrl.id,
        ctrl.entity_version ?? 1,
        ctrl.created_at
      );

      return ctrl;
    });

    return res.status(201).json(created);
  })
);

app.patch(
  '/api/controls/:id',
  asyncHandler(async (req, res) => {
    if (req.body.owner_name !== undefined) {
      validateNamedOwner(req.body.owner_name, 'CONTROL');
    }

    const updated = await withGovernanceTransaction(async () => {
      const existing = getControl(getParamId(req));
      if (!existing) {
        throw new HttpRouteError(404, { error: 'Control not found' });
      }

      const nextCtrl = updateControl(existing.id, req.body);
      await attestAndSave(
        GOVERNANCE_EVENT_TYPES.CONTROL_UPDATED,
        {
          control_id: nextCtrl.id,
          code: nextCtrl.code,
          title: nextCtrl.title,
          description: nextCtrl.description,
          control_type: nextCtrl.control_type,
          package_name: nextCtrl.package_name,
          naic_guardrail_number: nextCtrl.naic_guardrail_number,
          supply_chain_role: nextCtrl.supply_chain_role,
          owner_name: nextCtrl.owner_name,
          status: nextCtrl.status,
        },
        'CONTROL',
        nextCtrl.id,
        nextCtrl.entity_version ?? 1,
        nextCtrl.updated_at
      );

      return nextCtrl;
    });

    return res.json(updated);
  })
);

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
    validateNamedOwner(ownerName, 'SOLUTION');

    const rawRiskTier = req.body.risk_tier ?? req.body.riskTier ?? 'LOW';
    const normalizedRiskTier = String(rawRiskTier).toUpperCase().trim() as
      | 'LOW'
      | 'MEDIUM'
      | 'HIGH'
      | 'CRITICAL';

    const created = await withGovernanceTransaction(async () => {
      const sol = createSolution({
        title: req.body.title,
        business_problem: req.body.business_problem ?? req.body.description ?? '',
        requesting_unit: req.body.requesting_unit ?? '',
        owner_name: ownerName,
        owner_remit: req.body.owner_remit ?? '',
        risk_tier: normalizedRiskTier,
      });

      await attestAndSave(
        GOVERNANCE_EVENT_TYPES.SOLUTION_REQUESTED,
        {
          solution_id: sol.id,
          title: sol.title,
          business_problem: sol.business_problem,
          requesting_unit: sol.requesting_unit,
          owner_name: sol.owner_name,
          owner_remit: sol.owner_remit,
          risk_tier: sol.risk_tier,
          lifecycle_stage: sol.lifecycle_stage,
          capability_ids: sol.capability_ids,
          control_ids: sol.control_ids,
        },
        'SOLUTION',
        sol.id,
        sol.entity_version ?? 1,
        sol.created_at
      );

      return sol;
    });

    return res.status(201).json(created);
  })
);

app.patch(
  '/api/solutions/:id/stage',
  asyncHandler(async (req, res) => {
    const targetStage = req.body.target_stage ?? req.body.stage;
    if (
      typeof targetStage !== 'number' ||
      !Number.isInteger(targetStage) ||
      targetStage < 1 ||
      targetStage > 9
    ) {
      return res.status(400).json({ error: 'Target stage must be an integer between 1 and 9' });
    }

    const updated = await withGovernanceTransaction(async () => {
      const solution = getSolution(getParamId(req));
      if (!solution) {
        throw new HttpRouteError(404, { error: 'Solution not found' });
      }

      const linkedCaps = solution.capability_ids
        .map((id) => getCapability(id))
        .filter(Boolean) as Capability[];
      const allControls = listControls();
      const wgMembers = listWorkingGroupMembers();

      validateSolutionStageAdvance(
        solution,
        targetStage,
        linkedCaps,
        allControls,
        req.body.approver_name,
        wgMembers
      );

      const nextSol = updateSolution(solution.id, { lifecycle_stage: targetStage });
      const eventType =
        targetStage === 7
          ? GOVERNANCE_EVENT_TYPES.SOLUTION_APPROVED
          : GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION;

      await attestAndSave(
        eventType,
        {
          solution_id: nextSol.id,
          title: nextSol.title,
          business_problem: nextSol.business_problem,
          requesting_unit: nextSol.requesting_unit,
          owner_name: nextSol.owner_name,
          owner_remit: nextSol.owner_remit,
          risk_tier: nextSol.risk_tier,
          lifecycle_stage: nextSol.lifecycle_stage,
          target_stage: targetStage,
          approver_name: req.body.approver_name ?? null,
          capability_ids: nextSol.capability_ids,
          control_ids: nextSol.control_ids,
        },
        'SOLUTION',
        nextSol.id,
        nextSol.entity_version ?? 1,
        nextSol.updated_at
      );

      return nextSol;
    });

    return res.status(200).json(updated);
  })
);

app.post(
  '/api/solutions/:id/capabilities',
  asyncHandler(async (req, res) => {
    const ids: string[] =
      req.body.capability_ids ?? (req.body.capabilityId ? [req.body.capabilityId] : []);

    const updated = await withGovernanceTransaction(async () => {
      const solution = getSolution(getParamId(req));
      if (!solution) {
        throw new HttpRouteError(404, { error: 'Solution not found' });
      }
      for (const cid of ids) {
        const cap = getCapability(cid);
        if (!cap) {
          throw new HttpRouteError(400, {
            error: `Capability "${cid}" not found`,
            code: 'CAPABILITY_NOT_FOUND',
          });
        }
      }

      const nextSol = linkCapabilitiesToSolution(solution.id, ids);
      if ((nextSol.entity_version ?? 1) !== (solution.entity_version ?? 1)) {
        await attestAndSave(
          GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
          {
            solution_id: nextSol.id,
            title: nextSol.title,
            business_problem: nextSol.business_problem,
            requesting_unit: nextSol.requesting_unit,
            owner_name: nextSol.owner_name,
            owner_remit: nextSol.owner_remit,
            risk_tier: nextSol.risk_tier,
            lifecycle_stage: nextSol.lifecycle_stage,
            capability_ids: nextSol.capability_ids,
            control_ids: nextSol.control_ids,
          },
          'SOLUTION',
          nextSol.id,
          nextSol.entity_version ?? 1,
          nextSol.updated_at
        );
      }

      return nextSol;
    });

    return res.status(200).json(updated);
  })
);

app.post(
  '/api/solutions/:id/controls',
  asyncHandler(async (req, res) => {
    const ids: string[] =
      req.body.control_ids ?? (req.body.controlId ? [req.body.controlId] : []);

    const updated = await withGovernanceTransaction(async () => {
      const solution = getSolution(getParamId(req));
      if (!solution) {
        throw new HttpRouteError(404, { error: 'Solution not found' });
      }
      for (const cid of ids) {
        const ctrl = getControl(cid);
        if (!ctrl) {
          throw new HttpRouteError(400, {
            error: `Control "${cid}" not found`,
            code: 'CONTROL_NOT_FOUND',
          });
        }
      }

      const nextSol = linkControlsToSolution(solution.id, ids);
      if ((nextSol.entity_version ?? 1) !== (solution.entity_version ?? 1)) {
        await attestAndSave(
          GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
          {
            solution_id: nextSol.id,
            title: nextSol.title,
            business_problem: nextSol.business_problem,
            requesting_unit: nextSol.requesting_unit,
            owner_name: nextSol.owner_name,
            owner_remit: nextSol.owner_remit,
            risk_tier: nextSol.risk_tier,
            lifecycle_stage: nextSol.lifecycle_stage,
            capability_ids: nextSol.capability_ids,
            control_ids: nextSol.control_ids,
          },
          'SOLUTION',
          nextSol.id,
          nextSol.entity_version ?? 1,
          nextSol.updated_at
        );
      }

      return nextSol;
    });

    return res.status(200).json(updated);
  })
);

app.patch(
  '/api/solutions/:id',
  asyncHandler(async (req, res) => {
    const updates = { ...req.body };
    // Block stage bypass via generic patch
    delete updates.lifecycle_stage;
    delete updates.stage;

    if (updates.owner_name !== undefined) {
      validateNamedOwner(updates.owner_name, 'SOLUTION');
    }

    if (updates.risk_tier !== undefined) {
      updates.risk_tier = String(updates.risk_tier).toUpperCase().trim();
    }

    const updated = await withGovernanceTransaction(async () => {
      const solution = getSolution(getParamId(req));
      if (!solution) {
        throw new HttpRouteError(404, { error: 'Solution not found' });
      }

      const nextSol = updateSolution(solution.id, updates);
      await attestAndSave(
        GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
        {
          solution_id: nextSol.id,
          title: nextSol.title,
          business_problem: nextSol.business_problem,
          requesting_unit: nextSol.requesting_unit,
          owner_name: nextSol.owner_name,
          owner_remit: nextSol.owner_remit,
          risk_tier: nextSol.risk_tier,
          lifecycle_stage: nextSol.lifecycle_stage,
          capability_ids: nextSol.capability_ids,
          control_ids: nextSol.control_ids,
        },
        'SOLUTION',
        nextSol.id,
        nextSol.entity_version ?? 1,
        nextSol.updated_at
      );

      return nextSol;
    });

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

app.post(
  '/api/capabilities',
  asyncHandler(async (req, res) => {
    const ownerName = req.body.owner_name ?? req.body.ownerName;
    validateNamedOwner(ownerName, 'CAPABILITY');

    const requestedStatus = req.body.status ?? 'DRAFT';
    const requestedControlIds: string[] = Array.isArray(req.body.control_ids)
      ? req.body.control_ids
      : [];

    const created = await withGovernanceTransaction(async () => {
      if (requestedStatus === 'AUTHORISED') {
        const allControls = listControls();
        validateCapabilityAuthorisation(
          {
            id: 'pending',
            name: req.body.name ?? req.body.title ?? '',
            description: req.body.description || '',
            provider_or_tech: req.body.provider_or_tech || '',
            owner_name: ownerName,
            status: 'AUTHORISED',
            control_ids: requestedControlIds,
            created_at: '',
            updated_at: '',
          },
          allControls
        );
      }

      const cap = createCapability({
        name: req.body.name ?? req.body.title,
        description: req.body.description || '',
        provider_or_tech: req.body.provider_or_tech || '',
        owner_name: ownerName,
        status: requestedStatus,
        control_ids: requestedControlIds,
      });

      const eventType =
        cap.status === 'AUTHORISED'
          ? GOVERNANCE_EVENT_TYPES.CAPABILITY_AUTHORISED
          : GOVERNANCE_EVENT_TYPES.CAPABILITY_CREATED;

      await attestAndSave(
        eventType,
        {
          capability_id: cap.id,
          name: cap.name,
          description: cap.description,
          provider_or_tech: cap.provider_or_tech,
          owner_name: cap.owner_name,
          status: cap.status,
          control_ids: cap.control_ids,
        },
        'CAPABILITY',
        cap.id,
        cap.entity_version ?? 1,
        cap.created_at
      );

      return cap;
    });

    return res.status(201).json(created);
  })
);

async function handleCapabilityUpdate(req: Request, res: Response): Promise<unknown> {
  if (req.body.owner_name !== undefined) {
    validateNamedOwner(req.body.owner_name, 'CAPABILITY');
  }

  const updated = await withGovernanceTransaction(async () => {
    const capability = getCapability(getParamId(req));
    if (!capability) {
      throw new HttpRouteError(404, { error: 'Capability not found' });
    }

    const effectiveStatus = req.body.status ?? capability.status;
    const effectiveControlIds = req.body.control_ids ?? capability.control_ids;

    // Invariant 2: No capability may be authorised (or remain authorised) without >= 1 active control
    if (effectiveStatus === 'AUTHORISED') {
      const allControls = listControls();
      validateCapabilityAuthorisation(
        { ...capability, status: 'AUTHORISED', control_ids: effectiveControlIds },
        allControls
      );
    }

    const nextCap = updateCapability(capability.id, req.body);
    const eventType =
      nextCap.status === 'AUTHORISED'
        ? GOVERNANCE_EVENT_TYPES.CAPABILITY_AUTHORISED
        : GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION;

    await attestAndSave(
      eventType,
      {
        capability_id: nextCap.id,
        name: nextCap.name,
        description: nextCap.description,
        provider_or_tech: nextCap.provider_or_tech,
        owner_name: nextCap.owner_name,
        status: nextCap.status,
        control_ids: nextCap.control_ids,
      },
      'CAPABILITY',
      nextCap.id,
      nextCap.entity_version ?? 1,
      nextCap.updated_at
    );

    return nextCap;
  });

  return res.status(200).json(updated);
}

app.patch('/api/capabilities/:id/status', asyncHandler(handleCapabilityUpdate));
app.patch('/api/capabilities/:id', asyncHandler(handleCapabilityUpdate));

app.post(
  '/api/capabilities/:id/controls',
  asyncHandler(async (req, res) => {
    const ids: string[] =
      req.body.control_ids ?? (req.body.controlId ? [req.body.controlId] : []);

    const updated = await withGovernanceTransaction(async () => {
      const capability = getCapability(getParamId(req));
      if (!capability) {
        throw new HttpRouteError(404, { error: 'Capability not found' });
      }
      for (const cid of ids) {
        const ctrl = getControl(cid);
        if (!ctrl) {
          throw new HttpRouteError(400, {
            error: `Control "${cid}" not found`,
            code: 'CONTROL_NOT_FOUND',
          });
        }
      }

      const nextCap = linkControlsToCapability(capability.id, ids);
      if ((nextCap.entity_version ?? 1) !== (capability.entity_version ?? 1)) {
        await attestAndSave(
          GOVERNANCE_EVENT_TYPES.WORKING_GROUP_DECISION,
          {
            capability_id: nextCap.id,
            name: nextCap.name,
            description: nextCap.description,
            provider_or_tech: nextCap.provider_or_tech,
            owner_name: nextCap.owner_name,
            status: nextCap.status,
            control_ids: nextCap.control_ids,
          },
          'CAPABILITY',
          nextCap.id,
          nextCap.entity_version ?? 1,
          nextCap.updated_at
        );
      }

      return nextCap;
    });

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
    const created = await withGovernanceTransaction(async () => {
      const breach = createBreach(req.body);
      const savedAtt = await attestAndSave(
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
        'BREACH',
        breach.id,
        breach.entity_version ?? 1,
        breach.created_at
      );
      attachAttestationToEntity('breaches', breach.id, savedAtt);
      return getBreach(breach.id)!;
    });

    return res.status(201).json(created);
  })
);

app.get('/api/governance/remediations', (_req, res) => {
  res.json(listRemediations());
});

app.post(
  '/api/governance/remediations',
  asyncHandler(async (req, res) => {
    const created = await withGovernanceTransaction(async () => {
      const remediation = createRemediation(req.body);
      const savedRemAtt = await attestAndSave(
        GOVERNANCE_EVENT_TYPES.BREACH_REMEDIATION,
        {
          remediation_id: remediation.id,
          breach_id: remediation.breach_id,
          remediation_summary: remediation.remediation_summary,
          verified_by: remediation.verified_by,
          status: remediation.status,
        },
        'REMEDIATION',
        remediation.id,
        remediation.entity_version ?? 1,
        remediation.created_at
      );
      attachAttestationToEntity('remediations', remediation.id, savedRemAtt);

      // Atomically transition referenced breach to RESOLVED with its own v2 attestation
      const existingBreach = remediation.breach_id ? getBreach(remediation.breach_id) : undefined;
      if (existingBreach && existingBreach.status !== 'RESOLVED') {
        const resolvedBreach = updateBreach(existingBreach.id, { status: 'RESOLVED' });
        await attestAndSave(
          GOVERNANCE_EVENT_TYPES.BREACH_REMEDIATION,
          {
            breach_id: resolvedBreach.id,
            title: resolvedBreach.title,
            severity: resolvedBreach.severity,
            affected_entity_type: resolvedBreach.affected_entity_type,
            affected_entity_id: resolvedBreach.affected_entity_id,
            description: resolvedBreach.description,
            reported_by: resolvedBreach.reported_by,
            status: resolvedBreach.status,
            remediation_id: remediation.id,
          },
          'BREACH',
          resolvedBreach.id,
          resolvedBreach.entity_version ?? 2,
          resolvedBreach.updated_at
        );
      }

      return getRemediation(remediation.id)!;
    });

    return res.status(201).json(created);
  })
);

app.get('/api/governance/audits', (_req, res) => {
  res.json(listComplianceAudits());
});

app.post(
  '/api/governance/audits',
  asyncHandler(async (req, res) => {
    const created = await withGovernanceTransaction(async () => {
      const audit = createComplianceAudit(req.body);
      const savedAtt = await attestAndSave(
        GOVERNANCE_EVENT_TYPES.COMPLIANCE_AUDIT,
        {
          audit_id: audit.id,
          audit_name: audit.audit_name,
          auditor_name: audit.auditor_name,
          guardrails_evaluated: audit.guardrails_evaluated,
          overall_compliance_status: audit.overall_compliance_status,
          findings: audit.findings,
        },
        'COMPLIANCE_AUDIT',
        audit.id,
        audit.entity_version ?? 1,
        audit.created_at
      );
      attachAttestationToEntity('compliance_audits', audit.id, savedAtt);
      return getComplianceAudit(audit.id)!;
    });

    return res.status(201).json(created);
  })
);

// Supporting governance routes (Requests, Meeting Decisions, Risk Assessments)
app.get('/api/governance/requests', (_req, res) => {
  res.json(listGovernanceRequests());
});

app.post(
  '/api/governance/requests',
  asyncHandler(async (req, res) => {
    const created = await withGovernanceTransaction(async () => {
      const item = createGovernanceRequest(req.body);
      const savedAtt = await attestAndSave(
        GOVERNANCE_EVENT_TYPES.GOVERNANCE_REQUEST_CREATED,
        {
          request_id: item.id,
          title: item.title,
          business_problem: item.business_problem,
          requesting_unit: item.requesting_unit,
          owner_name: item.owner_name,
          status: item.status,
          solution_id: item.solution_id ?? null,
        },
        'GOVERNANCE_REQUEST',
        item.id,
        item.entity_version ?? 1,
        item.created_at
      );
      attachAttestationToEntity('governance_requests', item.id, savedAtt);
      return listGovernanceRequests().find((r) => r.id === item.id)!;
    });
    return res.status(201).json({ request: created });
  })
);

app.get('/api/governance/meeting-decisions', (_req, res) => {
  res.json(listMeetingDecisions());
});

app.post(
  '/api/governance/meeting-decisions',
  asyncHandler(async (req, res) => {
    const created = await withGovernanceTransaction(async () => {
      const item = createMeetingDecision(req.body);
      const savedAtt = await attestAndSave(
        GOVERNANCE_EVENT_TYPES.MEETING_DECISION_RECORDED,
        {
          decision_id: item.id,
          title: item.title,
          decision: item.decision,
          solution_id: item.solution_id ?? null,
          attendees: item.attendees,
          decided_at: item.decided_at,
        },
        'MEETING_DECISION',
        item.id,
        item.entity_version ?? 1,
        item.created_at
      );
      attachAttestationToEntity('meeting_decisions', item.id, savedAtt);
      return listMeetingDecisions().find((d) => d.id === item.id)!;
    });
    return res.status(201).json({ meetingDecision: created });
  })
);

app.get('/api/governance/risk-assessments', (_req, res) => {
  res.json(listRiskAssessments());
});

app.post(
  '/api/governance/risk-assessments',
  asyncHandler(async (req, res) => {
    const created = await withGovernanceTransaction(async () => {
      const item = createRiskAssessment(req.body);
      const savedAtt = await attestAndSave(
        GOVERNANCE_EVENT_TYPES.RISK_ASSESSMENT_RECORDED,
        {
          assessment_id: item.id,
          solution_id: item.solution_id,
          risk_tier: item.risk_tier,
          findings: item.findings,
          assessor_name: item.assessor_name,
          assessed_at: item.assessed_at,
        },
        'RISK_ASSESSMENT',
        item.id,
        item.entity_version ?? 1,
        item.created_at
      );
      attachAttestationToEntity('risk_assessments', item.id, savedAtt);
      return listRiskAssessments().find((a) => a.id === item.id)!;
    });
    return res.status(201).json({ riskAssessment: created });
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
  if (err instanceof HttpRouteError) {
    return res.status(err.statusCode).json(err.payload);
  }
  if (err instanceof InvariantError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err instanceof GovernanceAttestationError) {
    return res.status(503).json({
      error: 'Quantum governance attestation failed; state change rolled back',
      code: 'ATTESTATION_FAILED_ROLLED_BACK',
      reason: err.reason,
    });
  }
  console.error('[aaims-server error]', err);
  return res.status(500).json({ error: err.message ?? 'Internal server error' });
});

async function start() {
  initDatabase();
  await initBitBopClient();
  await bootstrapSeedAttestations();
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
