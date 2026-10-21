import type {
  Solution,
  Capability,
  Control,
  WorkingGroupMember,
  Breach,
  Remediation,
  ComplianceAudit,
  BitBopReceipt,
  VerificationResult,
} from '../types';

const API_BASE = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = (data as { error?: string })?.error || `Request failed with status ${response.status}`;
    const err = new Error(errorMsg);
    (err as unknown as { status: number; data: unknown }).status = response.status;
    (err as unknown as { status: number; data: unknown }).data = data;
    throw err;
  }

  return data as T;
}

// Solutions
export async function fetchSolutions(): Promise<Solution[]> {
  return request<Solution[]>('/solutions');
}

export async function fetchSolution(id: string): Promise<Solution> {
  return request<Solution>(`/solutions/${id}`);
}

export async function createSolution(payload: {
  title: string;
  business_problem: string;
  requesting_unit: string;
  owner_name: string;
  owner_remit: string;
  risk_tier: string;
}): Promise<Solution> {
  return request<Solution>('/solutions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function advanceSolutionStage(
  id: string,
  targetStage: number,
  approverName?: string
): Promise<Solution> {
  return request<Solution>(`/solutions/${id}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({
      target_stage: targetStage,
      approver_name: approverName,
    }),
  });
}

export async function linkCapabilitiesToSolution(
  id: string,
  capabilityIds: string[]
): Promise<Solution> {
  return request<Solution>(`/solutions/${id}/capabilities`, {
    method: 'POST',
    body: JSON.stringify({ capability_ids: capabilityIds }),
  });
}

export async function linkControlsToSolution(
  id: string,
  controlIds: string[]
): Promise<Solution> {
  return request<Solution>(`/solutions/${id}/controls`, {
    method: 'POST',
    body: JSON.stringify({ control_ids: controlIds }),
  });
}

// Capabilities
export async function fetchCapabilities(): Promise<Capability[]> {
  return request<Capability[]>('/capabilities');
}

export async function fetchCapability(id: string): Promise<Capability> {
  return request<Capability>(`/capabilities/${id}`);
}

export async function createCapability(payload: {
  name: string;
  description: string;
  provider_or_tech: string;
  owner_name: string;
  status?: string;
}): Promise<Capability> {
  return request<Capability>('/capabilities', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateCapabilityStatus(
  id: string,
  status: string
): Promise<Capability> {
  return request<Capability>(`/capabilities/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function linkControlsToCapability(
  id: string,
  controlIds: string[]
): Promise<Capability> {
  return request<Capability>(`/capabilities/${id}/controls`, {
    method: 'POST',
    body: JSON.stringify({ control_ids: controlIds }),
  });
}

// Controls
export async function fetchControls(): Promise<Control[]> {
  const res = await request<Control[] | { controls: Control[] }>('/controls');
  if (Array.isArray(res)) return res;
  return res.controls || [];
}

// Working Group Members
export async function fetchWorkingGroupMembers(): Promise<WorkingGroupMember[]> {
  return request<WorkingGroupMember[]>('/working-group');
}

// Breaches & Remediations
export async function fetchBreaches(): Promise<Breach[]> {
  return request<Breach[]>('/governance/breaches');
}

export async function createBreach(payload: {
  title: string;
  severity: string;
  affected_entity_type: string;
  affected_entity_id: string;
  description: string;
  reported_by: string;
}): Promise<Breach> {
  return request<Breach>('/governance/breaches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchRemediations(): Promise<Remediation[]> {
  return request<Remediation[]>('/governance/remediations');
}

export async function createRemediation(payload: {
  breach_id: string;
  remediation_summary: string;
  verified_by: string;
}): Promise<Remediation> {
  return request<Remediation>('/governance/remediations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Compliance Audits
export async function fetchAudits(): Promise<ComplianceAudit[]> {
  return request<ComplianceAudit[]>('/governance/audits');
}

export async function createAudit(payload: {
  audit_name: string;
  auditor_name: string;
  guardrails_evaluated: number[];
  overall_compliance_status?: string;
  findings?: string;
}): Promise<ComplianceAudit> {
  return request<ComplianceAudit>('/governance/audits', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Attestations & BitBop Verification
export async function fetchAttestations(): Promise<BitBopReceipt[]> {
  return request<BitBopReceipt[]>('/attestations');
}

export async function verifyAttestation(receipt: Record<string, unknown>): Promise<VerificationResult> {
  return request<VerificationResult>('/attestations/verify', {
    method: 'POST',
    body: JSON.stringify(receipt),
  });
}
