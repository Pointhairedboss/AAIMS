import type {
  Solution,
  Capability,
  Control,
  WorkingGroupMember,
  RiskTier,
} from './types.js';

export class InvariantError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code = 'INVARIANT_VIOLATION') {
    super(message);
    this.name = 'InvariantError';
    this.statusCode = 400;
    this.code = code;
  }
}

/**
 * Invariant 0: Mandatory Named Ownership
 * Every instance of SOLUTION, CAPABILITY, and CONTROL requires a valid named owner.
 */
export function validateNamedOwner(
  owner_name: unknown,
  entityType: 'SOLUTION' | 'CAPABILITY' | 'CONTROL' | string
): void {
  if (
    !owner_name ||
    typeof owner_name !== 'string' ||
    owner_name.trim().length === 0
  ) {
    throw new InvariantError(
      `Named owner is mandatory for ${entityType}: owner_name cannot be empty or missing.`,
      'MISSING_NAMED_OWNER'
    );
  }
}

/**
 * Invariant 2: Capability Authorisation Gate
 * No capability may be authorised (status = "AUTHORISED") without at least one ACTIVE control governing it.
 */
export function validateCapabilityAuthorisation(
  capability: Capability,
  allControls: Control[]
): void {
  const activeControls = allControls.filter(
    (c) => capability.control_ids.includes(c.id) && c.status === 'ACTIVE'
  );

  if (activeControls.length === 0) {
    throw new InvariantError(
      `Capability "${capability.name}" cannot be set to AUTHORISED without at least one active control governing it.`,
      'CAPABILITY_UNGOVERNED'
    );
  }
}

const TIER_RANKS: Record<string, number> = {
  TIER_1_LOW: 1,
  TIER_2_MEDIUM: 2,
  TIER_3_HIGH_EXEC: 3,
  BOARD_DELEGATE: 4,
};

const RISK_REQUIREMENTS: Record<RiskTier, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/**
 * Stage 7 Delegated Authority Tier Validation
 * Solution approval requires an approver whose authority tier matches or exceeds the solution's risk tier.
 */
export function validateApprovalAuthority(
  riskTier: RiskTier,
  approverName?: string,
  approvers: WorkingGroupMember[] = []
): WorkingGroupMember {
  if (!approverName || typeof approverName !== 'string' || approverName.trim().length === 0) {
    throw new InvariantError(
      'Approver name is required for Stage 7 approval authority validation.',
      'APPROVER_REQUIRED'
    );
  }

  const normalized = approverName.trim().toLowerCase();
  const approver = approvers.find(
    (m) =>
      m.name.trim().toLowerCase() === normalized ||
      m.title.trim().toLowerCase() === normalized
  );

  if (!approver) {
    throw new InvariantError(
      `Approver "${approverName}" lacks authority: not a recognized Working Group member.`,
      'UNKNOWN_APPROVER'
    );
  }

  const normalizedTier = (String(riskTier).toUpperCase().trim()) as RiskTier;
  const approverRank = TIER_RANKS[approver.authority_tier] ?? 0;
  const requiredRank = RISK_REQUIREMENTS[normalizedTier] ?? 1;

  if (approverRank < requiredRank) {
    throw new InvariantError(
      `Approver "${approver.name}" with authority tier ${approver.authority_tier} lacks delegated authority for ${riskTier} risk solution. Requires escalation to a higher authority tier.`,
      'INSUFFICIENT_AUTHORITY_TIER'
    );
  }

  return approver;
}

/**
 * Invariant 1a & 1b: Solution Lifecycle Stage Gates
 * - Past Stage 4: requires >= 1 linked capability.
 * - Past Stage 5 or Stage 7 Approval: requires >= 1 control and all linked capabilities governed by >= 1 ACTIVE control.
 * - Stage 7: requires delegated authority tier validation and no SUSPENDED capabilities.
 * - Progression must be sequential (targetStage === currentStage + 1).
 */
export function validateSolutionStageAdvance(
  solution: Solution,
  targetStage: number,
  linkedCapabilities: Capability[],
  allControls: Control[],
  approverName?: string,
  approvers: WorkingGroupMember[] = []
): void {
  if (
    typeof targetStage !== 'number' ||
    !Number.isInteger(targetStage) ||
    targetStage < 1 ||
    targetStage > 9
  ) {
    throw new InvariantError(
      `Invalid lifecycle target stage: ${targetStage}. Must be an integer between 1 and 9.`,
      'INVALID_STAGE'
    );
  }

  // Validate that all linked capability IDs exist in the database (reject phantom IDs)
  if (solution.capability_ids && solution.capability_ids.length > 0) {
    if (linkedCapabilities.length !== solution.capability_ids.length) {
      throw new InvariantError(
        `Solution "${solution.title}" references non-existent capability IDs.`,
        'INVALID_CAPABILITY_REFERENCE'
      );
    }
  }

  // Invariant 1a: Solution Capability Gate (Past Stage 4)
  if (targetStage > 4) {
    if (!solution.capability_ids || solution.capability_ids.length === 0) {
      throw new InvariantError(
        `Solution "${solution.title}" cannot advance past Stage 4 without at least one linked capability.`,
        'INVARIANT_1A_CAPABILITY_GATE'
      );
    }
  }

  // Invariant 1b: Solution Control Gate (Past Stage 5)
  // Per spec §2.1 rule 1: requires >= 1 control and every linked capability governed by >= 1 ACTIVE control
  if (targetStage > 5) {
    if (!solution.control_ids || solution.control_ids.length === 0) {
      throw new InvariantError(
        `Solution "${solution.title}" cannot advance past Stage 5 without at least one linked control.`,
        'INVARIANT_1B_CONTROL_GATE'
      );
    }

    for (const cap of linkedCapabilities) {
      const activeControls = allControls.filter(
        (c) => cap.control_ids && cap.control_ids.includes(c.id) && c.status === 'ACTIVE'
      );
      if (activeControls.length === 0) {
        throw new InvariantError(
          `Every linked capability must have at least one active control governing it before advancing past Stage 5. Capability "${cap.name}" has zero active controls.`,
          'INVARIANT_1B_CAPABILITY_CONTROL_GATE'
        );
      }
    }
  }

  // Invariant 1b: Stage 7 Approval Gate
  if (targetStage === 7) {
    if (!solution.control_ids || solution.control_ids.length === 0) {
      throw new InvariantError(
        `Solution "${solution.title}" cannot be approved without at least one linked control.`,
        'INVARIANT_1B_APPROVAL_CONTROL_GATE'
      );
    }

    if (!solution.capability_ids || solution.capability_ids.length === 0) {
      throw new InvariantError(
        `Solution "${solution.title}" cannot be approved without at least one linked capability.`,
        'INVARIANT_1A_APPROVAL_CAPABILITY_GATE'
      );
    }

    for (const cap of linkedCapabilities) {
      if (cap.status === 'SUSPENDED') {
        throw new InvariantError(
          `Cannot approve solution "${solution.title}": Linked capability "${cap.name}" is SUSPENDED.`,
          'CAPABILITY_SUSPENDED'
        );
      }

      const activeControls = allControls.filter(
        (c) => cap.control_ids && cap.control_ids.includes(c.id) && c.status === 'ACTIVE'
      );
      if (activeControls.length === 0) {
        throw new InvariantError(
          `Every linked capability must have at least one active control governing it before solution approval. Capability "${cap.name}" has zero active controls.`,
          'INVARIANT_1B_CAPABILITY_CONTROL_GATE'
        );
      }
    }

    // Delegated Authority Validation
    validateApprovalAuthority(solution.risk_tier, approverName, approvers);
  }

  // Ensure solutions cannot advance to Stage 8 or 9 without Stage 7 approval
  if (targetStage >= 8 && solution.lifecycle_stage < 7) {
    throw new InvariantError(
      `Solution cannot advance to Stage ${targetStage} without prior Stage 7 approval.`,
      'APPROVAL_REQUIRED_BEFORE_IMPLEMENTATION'
    );
  }

  // Sequential progression: Solutions advance stage-by-stage
  if (targetStage !== solution.lifecycle_stage + 1) {
    throw new InvariantError(
      `Invalid stage progression: Solution cannot jump from Stage ${solution.lifecycle_stage} to Stage ${targetStage}. Solutions must advance sequentially stage-by-stage.`,
      'INVALID_STAGE_SEQUENCE'
    );
  }
}


