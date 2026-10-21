/**
 * Core Domain Types & Governance Models for AAIMS
 */

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type CapabilityStatus = 'DRAFT' | 'AUTHORISED' | 'SUSPENDED';
export type ControlType = 'POLICY' | 'TECHNICAL';
export type SupplyChainRole = 'DEPLOYER' | 'DEVELOPER' | 'BOTH';
export type ControlStatus = 'ACTIVE' | 'GAP_IDENTIFIED' | 'RETIRED';
export type AuthorityTier = 'TIER_1_LOW' | 'TIER_2_MEDIUM' | 'TIER_3_HIGH_EXEC' | 'BOARD_DELEGATE';

export interface Solution {
  id: string;
  title: string;
  business_problem: string;
  requesting_unit: string;
  owner_name: string;
  owner_remit: string;
  risk_tier: RiskTier;
  lifecycle_stage: number; // 1 to 9
  capability_ids: string[];
  control_ids: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  provider_or_tech: string;
  owner_name: string;
  status: CapabilityStatus;
  control_ids: string[];
  created_at?: string;
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
}

export interface WorkingGroupMember {
  id: string;
  name: string;
  title: string;
  business_remit: string;
  expertise: string;
  authority_tier: AuthorityTier;
}

export interface BitBopAttestation {
  id?: string;
  event_type: string;
  entity_id: string;
  entity_type: string;
  beacon_sequence: number;
  signature: string;
  canonical_digest: string;
  timestamp: string;
  created_at?: string;
}
