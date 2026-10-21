export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type CapabilityStatus = 'DRAFT' | 'AUTHORISED' | 'SUSPENDED' | 'RETIRED';
export type ControlType = 'POLICY' | 'TECHNICAL';
export type SupplyChainRole = 'DEVELOPER' | 'DEPLOYER' | 'BOTH';
export type ControlStatus = 'ACTIVE' | 'GAP_IDENTIFIED' | 'RETIRED' | 'PENDING';
export type AuthorityTier = 'TIER_1_LOW' | 'TIER_2_MEDIUM' | 'TIER_3_HIGH_EXEC' | 'BOARD_DELEGATE';

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
  created_at: string;
  updated_at: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  provider_or_tech: string;
  owner_name: string;
  status: CapabilityStatus;
  control_ids: string[];
  created_at: string;
  updated_at: string;
}

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

export interface WorkingGroupMember {
  id: string;
  name: string;
  title: string;
  business_remit: string;
  expertise: string;
  authority_tier: AuthorityTier;
  created_at: string;
}

export interface Breach {
  id: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affected_entity_type: 'SOLUTION' | 'CAPABILITY' | 'CONTROL';
  affected_entity_id: string;
  description: string;
  reported_by: string;
  status: 'REPORTED' | 'INVESTIGATING' | 'REMEDIATING' | 'RESOLVED' | 'CLOSED';
  reported_at: string;
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

export interface Remediation {
  id: string;
  breach_id: string;
  remediation_summary: string;
  verified_by: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED';
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

export interface ComplianceAudit {
  id: string;
  audit_name: string;
  auditor_name: string;
  guardrails_evaluated: number[];
  overall_compliance_status: string;
  findings: string;
  created_at: string;
  updated_at: string;
  attestation?: BitBopReceipt;
}

export interface BitBopReceipt {
  event_type: string;
  beacon_sequence: number;
  signature: string;
  signature_scheme?: string;
  beacon_hash?: string;
  entropy_sha256?: string;
  context_hash?: string;
  raw_receipt?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VerificationResult {
  valid: boolean;
  beacon_sequence?: number;
  scheme?: string;
  error?: string;
  checks?: {
    beacon_exists?: boolean;
    beacon_hash_match?: boolean;
    beacon_signature_valid?: boolean;
    entropy_bound_to_beacon?: boolean;
    receipt_signature_valid?: boolean;
    ordering_reproducible?: boolean;
  };
  [key: string]: unknown;
}

export interface LifecycleStageDefinition {
  stage: number;
  name: string;
  shortName: string;
  description: string;
}

export const LIFECYCLE_STAGES: LifecycleStageDefinition[] = [
  { stage: 1, name: 'Request a Solution', shortName: 'Request', description: 'Initial business unit intake and problem definition' },
  { stage: 2, name: 'Investigate', shortName: 'Investigate', description: 'Technical feasibility and regulatory scoping' },
  { stage: 3, name: 'Assign Owner', shortName: 'Assign Owner', description: 'Formal assignment of accountable business and technical owners' },
  { stage: 4, name: 'Identify Capabilities', shortName: 'Capabilities', description: 'Selection and linkage of underlying AI models, services, and pipelines' },
  { stage: 5, name: 'Apply Controls', shortName: 'Controls', description: 'Application of NAIC guardrail policies and technical controls' },
  { stage: 6, name: 'Assess', shortName: 'Assess', description: 'Comprehensive risk classification and NAIC compliance evaluation' },
  { stage: 7, name: 'Approve', shortName: 'Approve', description: 'Delegated authority Working Group approval gate' },
  { stage: 8, name: 'Implement', shortName: 'Implement', description: 'Production deployment, canary testing, and telemetry integration' },
  { stage: 9, name: 'Review', shortName: 'Review', description: 'Periodic operational monitoring, drift audit, and continuous governance' },
];
