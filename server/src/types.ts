/**
 * AAIMS — Australian AI Management & Safety Interface
 * Strict Domain Model, Governance & Cryptographic Types
 * Aligned with docs/AAIMS_POC_SPEC.md & NAIC Voluntary AI Safety Standard
 */

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CapabilityStatus = 'DRAFT' | 'AUTHORISED' | 'SUSPENDED' | 'RETIRED';

export type ControlType = 'POLICY' | 'TECHNICAL';

export type SupplyChainRole = 'DEVELOPER' | 'DEPLOYER' | 'BOTH';

export type ControlStatus = 'ACTIVE' | 'GAP_IDENTIFIED' | 'RETIRED' | 'PENDING';

export type AuthorityTier =
  | 'TIER_1_LOW'
  | 'TIER_2_MEDIUM'
  | 'TIER_3_HIGH_EXEC'
  | 'BOARD_DELEGATE';

export type LifecycleStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface LifecycleStageInfo {
  stage: LifecycleStageNumber;
  name: string;
  description: string;
}

export const LIFECYCLE_STAGES: LifecycleStageInfo[] = [
  { stage: 1, name: 'Request a Solution', description: 'Initial business unit intake and problem definition' },
  { stage: 2, name: 'Investigate', description: 'Technical feasibility and regulatory scoping' },
  { stage: 3, name: 'Assign Owner', description: 'Formal assignment of accountable business and technical owners' },
  { stage: 4, name: 'Identify Capabilities', description: 'Selection and linkage of underlying AI models, services, and pipelines' },
  { stage: 5, name: 'Apply Controls', description: 'Application of NAIC guardrail policies and technical controls' },
  { stage: 6, name: 'Assess', description: 'Comprehensive risk classification and NAIC compliance evaluation' },
  { stage: 7, name: 'Approve', description: 'Delegated authority Working Group approval gate' },
  { stage: 8, name: 'Implement', description: 'Production deployment, canary testing, and telemetry integration' },
  { stage: 9, name: 'Review', description: 'Periodic operational monitoring, drift audit, and continuous governance' },
];

/**
 * Core Business Entity 1: SOLUTION
 * The business-facing answer to a problem requested by an enterprise unit.
 */
export interface Solution {
  id: string;
  title: string;
  business_problem: string;
  requesting_unit: string;
  owner_name: string;
  owner_remit: string;
  risk_tier: RiskTier;
  lifecycle_stage: number;
  capability_ids: string[];
  control_ids: string[];
  entity_version?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSolutionInput {
  title: string;
  business_problem: string;
  requesting_unit: string;
  owner_name: string;
  owner_remit: string;
  risk_tier?: RiskTier;
}

/**
 * Core Business Entity 2: CAPABILITY
 * The technical functionality used to deliver solutions (reusable across solutions).
 */
export interface Capability {
  id: string;
  name: string;
  description: string;
  provider_or_tech: string;
  owner_name: string;
  status: CapabilityStatus;
  control_ids: string[];
  entity_version?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCapabilityInput {
  name: string;
  description?: string;
  provider_or_tech?: string;
  owner_name: string;
  status?: CapabilityStatus;
  control_ids?: string[];
}

/**
 * Core Business Entity 3: CONTROL
 * The policy or technical mechanism governing authorised use (reusable across capabilities & solutions).
 */
export interface Control {
  id: string;
  code: string;
  title: string;
  description: string;
  control_type: ControlType;
  package_name: string;
  naic_guardrail_number: number | null;
  supply_chain_role: SupplyChainRole;
  owner_name: string;
  status: ControlStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateControlInput {
  code: string;
  title: string;
  description?: string;
  control_type?: ControlType;
  package_name?: string;
  naic_guardrail_number?: number | null;
  supply_chain_role?: SupplyChainRole;
  owner_name: string;
  status?: ControlStatus;
}

/**
 * Supporting Governance Registry: Working Group Member
 */
export interface WorkingGroupMember {
  id: string;
  name: string;
  title: string;
  business_remit: string;
  expertise: string;
  authority_tier: AuthorityTier;
  created_at: string;
}

/**
 * Supporting Governance Record: Incident / Breach Notification
 */
export interface Breach {
  id: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affected_entity_type: 'SOLUTION' | 'CAPABILITY' | 'CONTROL';
  affected_entity_id: string;
  description: string;
  reported_by: string;
  status: 'REPORTED' | 'INVESTIGATING' | 'REMEDIATING' | 'RESOLVED' | 'CLOSED';
  entity_version?: number;
  reported_at: string;
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

export interface CreateBreachInput {
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affected_entity_type: 'SOLUTION' | 'CAPABILITY' | 'CONTROL';
  affected_entity_id: string;
  description: string;
  reported_by: string;
}

/**
 * Supporting Governance Record: Breach Remediation
 */
export interface Remediation {
  id: string;
  breach_id: string;
  remediation_summary: string;
  verified_by: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED';
  entity_version?: number;
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

export interface CreateRemediationInput {
  breach_id: string;
  remediation_summary: string;
  verified_by: string;
}

/**
 * Supporting Governance Record: Compliance Audit
 */
export interface ComplianceAudit {
  id: string;
  audit_name: string;
  auditor_name: string;
  guardrails_evaluated: number[];
  overall_compliance_status: string;
  findings: string;
  entity_version?: number;
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

export interface CreateComplianceAuditInput {
  audit_name: string;
  auditor_name: string;
  guardrails_evaluated: number[];
  overall_compliance_status?: string;
  findings?: string;
}

/**
 * Supporting Governance Record: Solution Request
 */
export interface GovernanceRequest {
  id: string;
  title: string;
  business_problem: string;
  requesting_unit: string;
  owner_name: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
  solution_id?: string;
  entity_version?: number;
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

/**
 * Supporting Governance Record: Meeting Decision
 */
export interface MeetingDecision {
  id: string;
  title: string;
  decision: string;
  solution_id?: string;
  attendees: string[];
  entity_version?: number;
  decided_at: string;
  created_at: string;
  attestation?: BitBopReceipt;
}

/**
 * Supporting Governance Record: Risk Assessment
 */
export interface RiskAssessment {
  id: string;
  solution_id: string;
  risk_tier: RiskTier;
  findings: string;
  assessor_name: string;
  entity_version?: number;
  assessed_at: string;
  created_at: string;
  attestation?: BitBopReceipt;
}

/**
 * Canonical Snapshot bound to BitBop context_hash
 */
export interface CanonicalSnapshot {
  schema_version: number;
  source: 'aaims';
  event_type: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

/**
 * BitBop Cryptographic Attestation Receipt
 */
export interface BitBopReceipt {
  id?: string;
  event_type: string;
  beacon_sequence: number;
  signature: string;
  signature_scheme?: string;
  beacon_hash?: string;
  entropy_sha256?: string;
  context_hash?: string;
  schema_version?: number;
  entity_type?: string;
  entity_id?: string;
  entity_version?: number;
  canonical_snapshot?: Record<string, unknown>;
  raw_receipt?: Record<string, unknown>;
  [key: string]: unknown;
}

export const GOVERNANCE_EVENT_TYPES = {
  SOLUTION_REQUESTED: 'SOLUTION_REQUESTED',
  WORKING_GROUP_DECISION: 'WORKING_GROUP_DECISION',
  CAPABILITY_AUTHORISED: 'CAPABILITY_AUTHORISED',
  SOLUTION_APPROVED: 'SOLUTION_APPROVED',
  BREACH_NOTIFICATION: 'BREACH_NOTIFICATION',
  BREACH_REMEDIATION: 'BREACH_REMEDIATION',
  COMPLIANCE_AUDIT: 'COMPLIANCE_AUDIT',
} as const;

export type GovernanceEventType =
  (typeof GOVERNANCE_EVENT_TYPES)[keyof typeof GOVERNANCE_EVENT_TYPES];
