import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  Solution,
  CreateSolutionInput,
  Capability,
  CreateCapabilityInput,
  Control,
  CreateControlInput,
  WorkingGroupMember,
  Breach,
  CreateBreachInput,
  Remediation,
  CreateRemediationInput,
  ComplianceAudit,
  CreateComplianceAuditInput,
  GovernanceRequest,
  MeetingDecision,
  RiskAssessment,
  BitBopReceipt,
} from './types.js';
import { cacheRawReceipt } from './bitbop.js';

let db: DatabaseSync;

function now(): string {
  return new Date().toISOString();
}

function parseJsonArray<T>(val: string | null | undefined): T[] {
  if (!val) return [];
  try {
    const res = JSON.parse(val);
    return Array.isArray(res) ? (res as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(val: string | null | undefined): T | undefined {
  if (!val) return undefined;
  try {
    return JSON.parse(val) as T;
  } catch {
    return undefined;
  }
}

export function getDb(): DatabaseSync {
  if (!db) {
    initDatabase();
  }
  return db;
}

export function initDatabase(dbPath = ':memory:'): DatabaseSync {
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  // 1. Core Object: SOLUTIONS
  db.exec(`
    CREATE TABLE IF NOT EXISTS solutions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      business_problem TEXT NOT NULL DEFAULT '',
      requesting_unit TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL,
      owner_remit TEXT NOT NULL DEFAULT '',
      risk_tier TEXT NOT NULL DEFAULT 'LOW',
      lifecycle_stage INTEGER NOT NULL DEFAULT 1,
      capability_ids TEXT NOT NULL DEFAULT '[]',
      control_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 2. Core Object: CAPABILITIES
  db.exec(`
    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      provider_or_tech TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      control_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 3. Core Object: CONTROLS
  db.exec(`
    CREATE TABLE IF NOT EXISTS controls (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      control_type TEXT NOT NULL DEFAULT 'POLICY',
      package_name TEXT NOT NULL DEFAULT '',
      naic_guardrail_number INTEGER,
      supply_chain_role TEXT NOT NULL DEFAULT 'BOTH',
      owner_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Supporting Governance: Working Group Hierarchy
  db.exec(`
    CREATE TABLE IF NOT EXISTS working_group_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      business_remit TEXT NOT NULL,
      expertise TEXT NOT NULL,
      authority_tier TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Supporting Governance: Breaches
  db.exec(`
    CREATE TABLE IF NOT EXISTS breaches (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'MINOR',
      affected_entity_type TEXT NOT NULL DEFAULT 'CAPABILITY',
      affected_entity_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      reported_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'REPORTED',
      reported_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attestation TEXT
    );
  `);

  // Supporting Governance: Remediations
  db.exec(`
    CREATE TABLE IF NOT EXISTS remediations (
      id TEXT PRIMARY KEY,
      breach_id TEXT NOT NULL,
      remediation_summary TEXT NOT NULL,
      verified_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attestation TEXT
    );
  `);

  // Supporting Governance: Compliance Audits
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_audits (
      id TEXT PRIMARY KEY,
      audit_name TEXT NOT NULL,
      auditor_name TEXT NOT NULL,
      guardrails_evaluated TEXT NOT NULL DEFAULT '[]',
      overall_compliance_status TEXT NOT NULL DEFAULT 'COMPLIANT',
      findings TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attestation TEXT
    );
  `);

  // Supporting Governance: Requests
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_requests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      business_problem TEXT NOT NULL DEFAULT '',
      requesting_unit TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      solution_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attestation TEXT
    );
  `);

  // Supporting Governance: Meeting Decisions
  db.exec(`
    CREATE TABLE IF NOT EXISTS meeting_decisions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      solution_id TEXT,
      attendees TEXT NOT NULL DEFAULT '[]',
      decided_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attestation TEXT
    );
  `);

  // Supporting Governance: Risk Assessments
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_assessments (
      id TEXT PRIMARY KEY,
      solution_id TEXT NOT NULL,
      risk_tier TEXT NOT NULL DEFAULT 'LOW',
      findings TEXT NOT NULL DEFAULT '',
      assessor_name TEXT NOT NULL,
      assessed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attestation TEXT
    );
  `);

  // Attestations Ledger
  db.exec(`
    CREATE TABLE IF NOT EXISTS attestations (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      beacon_sequence INTEGER NOT NULL,
      signature TEXT NOT NULL,
      receipt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  seedInitialData();

  return db;
}

function mapSolutionRow(row: Record<string, unknown>): Solution {
  return {
    id: row.id as string,
    title: row.title as string,
    business_problem: (row.business_problem as string) ?? '',
    requesting_unit: (row.requesting_unit as string) ?? '',
    owner_name: row.owner_name as string,
    owner_remit: (row.owner_remit as string) ?? '',
    risk_tier: row.risk_tier as Solution['risk_tier'],
    lifecycle_stage: Number(row.lifecycle_stage ?? 1),
    capability_ids: parseJsonArray<string>(row.capability_ids as string),
    control_ids: parseJsonArray<string>(row.control_ids as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapCapabilityRow(row: Record<string, unknown>): Capability {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    provider_or_tech: (row.provider_or_tech as string) ?? '',
    owner_name: row.owner_name as string,
    status: row.status as Capability['status'],
    control_ids: parseJsonArray<string>(row.control_ids as string),
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? row.created_at as string,
  };
}

function mapControlRow(row: Record<string, unknown>): Control {
  return {
    id: row.id as string,
    code: row.code as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    control_type: row.control_type as Control['control_type'],
    package_name: (row.package_name as string) ?? '',
    naic_guardrail_number:
      row.naic_guardrail_number === null || row.naic_guardrail_number === undefined
        ? null
        : Number(row.naic_guardrail_number),
    supply_chain_role: row.supply_chain_role as Control['supply_chain_role'],
    owner_name: row.owner_name as string,
    status: row.status as Control['status'],
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? row.created_at as string,
  };
}

function mapWorkingGroupRow(row: Record<string, unknown>): WorkingGroupMember {
  return {
    id: row.id as string,
    name: row.name as string,
    title: row.title as string,
    business_remit: row.business_remit as string,
    expertise: row.expertise as string,
    authority_tier: row.authority_tier as WorkingGroupMember['authority_tier'],
    created_at: row.created_at as string,
  };
}

function mapBreachRow(row: Record<string, unknown>): Breach {
  return {
    id: row.id as string,
    title: row.title as string,
    severity: row.severity as Breach['severity'],
    affected_entity_type: row.affected_entity_type as Breach['affected_entity_type'],
    affected_entity_id: (row.affected_entity_id as string) ?? '',
    description: (row.description as string) ?? '',
    reported_by: row.reported_by as string,
    status: row.status as Breach['status'],
    reported_at: row.reported_at as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    attestation: parseJsonObject<BitBopReceipt>(row.attestation as string),
  };
}

function mapRemediationRow(row: Record<string, unknown>): Remediation {
  return {
    id: row.id as string,
    breach_id: row.breach_id as string,
    remediation_summary: row.remediation_summary as string,
    verified_by: row.verified_by as string,
    status: row.status as Remediation['status'],
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? row.created_at as string,
    attestation: parseJsonObject<BitBopReceipt>(row.attestation as string),
  };
}

function mapComplianceAuditRow(row: Record<string, unknown>): ComplianceAudit {
  return {
    id: row.id as string,
    audit_name: row.audit_name as string,
    auditor_name: row.auditor_name as string,
    guardrails_evaluated: parseJsonArray<number>(row.guardrails_evaluated as string),
    overall_compliance_status: row.overall_compliance_status as string,
    findings: (row.findings as string) ?? '',
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? row.created_at as string,
    attestation: parseJsonObject<BitBopReceipt>(row.attestation as string),
  };
}

// =============================================================================
// Solutions CRUD
// =============================================================================

export function listSolutions(): Solution[] {
  const rows = getDb().prepare('SELECT * FROM solutions ORDER BY created_at DESC').all();
  return rows.map((r) => mapSolutionRow(r as Record<string, unknown>));
}

export function getSolution(id: string): Solution | undefined {
  const row = getDb().prepare('SELECT * FROM solutions WHERE id = ?').get(id);
  return row ? mapSolutionRow(row as Record<string, unknown>) : undefined;
}

export function createSolution(input: CreateSolutionInput): Solution {
  const id = `sol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO solutions (id, title, business_problem, requesting_unit, owner_name, owner_remit, risk_tier, lifecycle_stage, capability_ids, control_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title,
      input.business_problem || '',
      input.requesting_unit || '',
      input.owner_name,
      input.owner_remit || '',
      input.risk_tier || 'LOW',
      1,
      JSON.stringify([]),
      JSON.stringify([]),
      ts,
      ts
    );
  return getSolution(id)!;
}

export function updateSolution(id: string, updates: Partial<Solution>): Solution {
  const existing = getSolution(id);
  if (!existing) throw new Error(`Solution ${id} not found`);
  const ts = now();

  getDb()
    .prepare(
      `UPDATE solutions SET
        title = COALESCE(?, title),
        business_problem = COALESCE(?, business_problem),
        requesting_unit = COALESCE(?, requesting_unit),
        owner_name = COALESCE(?, owner_name),
        owner_remit = COALESCE(?, owner_remit),
        risk_tier = COALESCE(?, risk_tier),
        lifecycle_stage = COALESCE(?, lifecycle_stage),
        capability_ids = COALESCE(?, capability_ids),
        control_ids = COALESCE(?, control_ids),
        updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.title ?? null,
      updates.business_problem ?? null,
      updates.requesting_unit ?? null,
      updates.owner_name ?? null,
      updates.owner_remit ?? null,
      updates.risk_tier ?? null,
      updates.lifecycle_stage ?? null,
      updates.capability_ids ? JSON.stringify(updates.capability_ids) : null,
      updates.control_ids ? JSON.stringify(updates.control_ids) : null,
      ts,
      id
    );
  return getSolution(id)!;
}

export function linkCapabilityToSolution(solutionId: string, capabilityId: string): Solution {
  const sol = getSolution(solutionId);
  if (!sol) throw new Error(`Solution ${solutionId} not found`);
  const current = new Set(sol.capability_ids);
  current.add(capabilityId);
  return updateSolution(solutionId, { capability_ids: Array.from(current) });
}

export function unlinkCapabilityFromSolution(solutionId: string, capabilityId: string): Solution {
  const sol = getSolution(solutionId);
  if (!sol) throw new Error(`Solution ${solutionId} not found`);
  const current = sol.capability_ids.filter((id) => id !== capabilityId);
  return updateSolution(solutionId, { capability_ids: current });
}

export function linkControlToSolution(solutionId: string, controlId: string): Solution {
  const sol = getSolution(solutionId);
  if (!sol) throw new Error(`Solution ${solutionId} not found`);
  const current = new Set(sol.control_ids);
  current.add(controlId);
  return updateSolution(solutionId, { control_ids: Array.from(current) });
}

// =============================================================================
// Capabilities CRUD
// =============================================================================

export function listCapabilities(): Capability[] {
  const rows = getDb().prepare('SELECT * FROM capabilities ORDER BY created_at DESC').all();
  return rows.map((r) => mapCapabilityRow(r as Record<string, unknown>));
}

export function getCapability(id: string): Capability | undefined {
  const row = getDb().prepare('SELECT * FROM capabilities WHERE id = ?').get(id);
  return row ? mapCapabilityRow(row as Record<string, unknown>) : undefined;
}

export function createCapability(input: CreateCapabilityInput): Capability {
  const id = `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO capabilities (id, name, description, provider_or_tech, owner_name, status, control_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.description || '',
      input.provider_or_tech || '',
      input.owner_name,
      input.status || 'DRAFT',
      JSON.stringify(input.control_ids || []),
      ts,
      ts
    );
  return getCapability(id)!;
}

export function updateCapability(id: string, updates: Partial<Capability>): Capability {
  const existing = getCapability(id);
  if (!existing) throw new Error(`Capability ${id} not found`);
  const ts = now();

  getDb()
    .prepare(
      `UPDATE capabilities SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        provider_or_tech = COALESCE(?, provider_or_tech),
        owner_name = COALESCE(?, owner_name),
        status = COALESCE(?, status),
        control_ids = COALESCE(?, control_ids),
        updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.name ?? null,
      updates.description ?? null,
      updates.provider_or_tech ?? null,
      updates.owner_name ?? null,
      updates.status ?? null,
      updates.control_ids ? JSON.stringify(updates.control_ids) : null,
      ts,
      id
    );
  return getCapability(id)!;
}

export function linkControlToCapability(capabilityId: string, controlId: string): Capability {
  const cap = getCapability(capabilityId);
  if (!cap) throw new Error(`Capability ${capabilityId} not found`);
  const current = new Set(cap.control_ids);
  current.add(controlId);
  return updateCapability(capabilityId, { control_ids: Array.from(current) });
}

// =============================================================================
// Controls CRUD
// =============================================================================

export function listControls(): Control[] {
  const rows = getDb().prepare('SELECT * FROM controls ORDER BY code ASC').all();
  return rows.map((r) => mapControlRow(r as Record<string, unknown>));
}

export function getControl(id: string): Control | undefined {
  const row = getDb().prepare('SELECT * FROM controls WHERE id = ?').get(id);
  return row ? mapControlRow(row as Record<string, unknown>) : undefined;
}

export function createControl(input: CreateControlInput): Control {
  const id = `ctrl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO controls (id, code, title, description, control_type, package_name, naic_guardrail_number, supply_chain_role, owner_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.code,
      input.title,
      input.description || '',
      input.control_type || 'POLICY',
      input.package_name || '',
      input.naic_guardrail_number ?? null,
      input.supply_chain_role || 'BOTH',
      input.owner_name,
      input.status || 'ACTIVE',
      ts,
      ts
    );
  return getControl(id)!;
}

export function updateControl(id: string, updates: Partial<Control>): Control {
  const existing = getControl(id);
  if (!existing) throw new Error(`Control ${id} not found`);
  const ts = now();

  getDb()
    .prepare(
      `UPDATE controls SET
        code = COALESCE(?, code),
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        control_type = COALESCE(?, control_type),
        package_name = COALESCE(?, package_name),
        naic_guardrail_number = COALESCE(?, naic_guardrail_number),
        supply_chain_role = COALESCE(?, supply_chain_role),
        owner_name = COALESCE(?, owner_name),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.code ?? null,
      updates.title ?? null,
      updates.description ?? null,
      updates.control_type ?? null,
      updates.package_name ?? null,
      updates.naic_guardrail_number ?? null,
      updates.supply_chain_role ?? null,
      updates.owner_name ?? null,
      updates.status ?? null,
      ts,
      id
    );
  return getControl(id)!;
}

// =============================================================================
// Working Group Members
// =============================================================================

export function listWorkingGroupMembers(): WorkingGroupMember[] {
  const rows = getDb().prepare('SELECT * FROM working_group_members ORDER BY id ASC').all();
  return rows.map((r) => mapWorkingGroupRow(r as Record<string, unknown>));
}

export function getWorkingGroupMember(id: string): WorkingGroupMember | undefined {
  const row = getDb().prepare('SELECT * FROM working_group_members WHERE id = ?').get(id);
  return row ? mapWorkingGroupRow(row as Record<string, unknown>) : undefined;
}

export function getWorkingGroupMemberByName(name: string): WorkingGroupMember | undefined {
  const normalized = name.trim().toLowerCase();
  const members = listWorkingGroupMembers();
  return members.find(
    (m) =>
      m.name.trim().toLowerCase() === normalized ||
      m.title.trim().toLowerCase() === normalized
  );
}

// =============================================================================
// Governance Records: Breaches, Remediations, Audits, etc.
// =============================================================================

export function listBreaches(): Breach[] {
  const rows = getDb().prepare('SELECT * FROM breaches ORDER BY reported_at DESC').all();
  return rows.map((r) => mapBreachRow(r as Record<string, unknown>));
}

export function getBreach(id: string): Breach | undefined {
  const row = getDb().prepare('SELECT * FROM breaches WHERE id = ?').get(id);
  return row ? mapBreachRow(row as Record<string, unknown>) : undefined;
}

export function createBreach(input: CreateBreachInput, attestation?: BitBopReceipt): Breach {
  const id = `brc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO breaches (id, title, severity, affected_entity_type, affected_entity_id, description, reported_by, status, reported_at, created_at, updated_at, attestation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title,
      input.severity,
      input.affected_entity_type,
      input.affected_entity_id,
      input.description,
      input.reported_by,
      'REPORTED',
      ts,
      ts,
      ts,
      attestation ? JSON.stringify(attestation) : null
    );
  return getBreach(id)!;
}

export function updateBreach(id: string, updates: Partial<Breach>): Breach {
  const existing = getBreach(id);
  if (!existing) throw new Error(`Breach ${id} not found`);
  const ts = now();

  getDb()
    .prepare(
      `UPDATE breaches SET
        title = COALESCE(?, title),
        severity = COALESCE(?, severity),
        status = COALESCE(?, status),
        description = COALESCE(?, description),
        attestation = COALESCE(?, attestation),
        updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.title ?? null,
      updates.severity ?? null,
      updates.status ?? null,
      updates.description ?? null,
      updates.attestation ? JSON.stringify(updates.attestation) : null,
      ts,
      id
    );
  return getBreach(id)!;
}

export function listRemediations(): Remediation[] {
  const rows = getDb().prepare('SELECT * FROM remediations ORDER BY created_at DESC').all();
  return rows.map((r) => mapRemediationRow(r as Record<string, unknown>));
}

export function getRemediation(id: string): Remediation | undefined {
  const row = getDb().prepare('SELECT * FROM remediations WHERE id = ?').get(id);
  return row ? mapRemediationRow(row as Record<string, unknown>) : undefined;
}

export function createRemediation(
  input: CreateRemediationInput,
  attestation?: BitBopReceipt
): Remediation {
  const id = `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO remediations (id, breach_id, remediation_summary, verified_by, status, created_at, updated_at, attestation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.breach_id,
      input.remediation_summary,
      input.verified_by,
      'COMPLETED',
      ts,
      ts,
      attestation ? JSON.stringify(attestation) : null
    );

  // Update underlying breach status to RESOLVED
  try {
    updateBreach(input.breach_id, { status: 'RESOLVED' });
  } catch {}

  return getRemediation(id)!;
}

export function listComplianceAudits(): ComplianceAudit[] {
  const rows = getDb().prepare('SELECT * FROM compliance_audits ORDER BY created_at DESC').all();
  return rows.map((r) => mapComplianceAuditRow(r as Record<string, unknown>));
}

export function getComplianceAudit(id: string): ComplianceAudit | undefined {
  const row = getDb().prepare('SELECT * FROM compliance_audits WHERE id = ?').get(id);
  return row ? mapComplianceAuditRow(row as Record<string, unknown>) : undefined;
}

export function createComplianceAudit(
  input: CreateComplianceAuditInput,
  attestation?: BitBopReceipt
): ComplianceAudit {
  const id = `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO compliance_audits (id, audit_name, auditor_name, guardrails_evaluated, overall_compliance_status, findings, created_at, updated_at, attestation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.audit_name,
      input.auditor_name,
      JSON.stringify(input.guardrails_evaluated || []),
      input.overall_compliance_status || 'COMPLIANT',
      input.findings || '',
      ts,
      ts,
      attestation ? JSON.stringify(attestation) : null
    );
  return getComplianceAudit(id)!;
}

export function listGovernanceRequests(): GovernanceRequest[] {
  const rows = getDb().prepare('SELECT * FROM governance_requests ORDER BY created_at DESC').all();
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    business_problem: (r.business_problem as string) ?? '',
    requesting_unit: (r.requesting_unit as string) ?? '',
    owner_name: r.owner_name as string,
    status: r.status as GovernanceRequest['status'],
    solution_id: (r.solution_id as string) || undefined,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    attestation: parseJsonObject<BitBopReceipt>(r.attestation as string),
  }));
}

export function createGovernanceRequest(
  input: Partial<GovernanceRequest>,
  attestation?: BitBopReceipt
): GovernanceRequest {
  const id = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO governance_requests (id, title, business_problem, requesting_unit, owner_name, status, solution_id, created_at, updated_at, attestation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title || '',
      input.business_problem || '',
      input.requesting_unit || '',
      input.owner_name || '',
      input.status || 'OPEN',
      input.solution_id || null,
      ts,
      ts,
      attestation ? JSON.stringify(attestation) : null
    );
  return listGovernanceRequests().find((r) => r.id === id)!;
}

export function listMeetingDecisions(): MeetingDecision[] {
  const rows = getDb().prepare('SELECT * FROM meeting_decisions ORDER BY decided_at DESC').all();
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    decision: r.decision as string,
    solution_id: (r.solution_id as string) || undefined,
    attendees: parseJsonArray<string>(r.attendees as string),
    decided_at: r.decided_at as string,
    created_at: r.created_at as string,
    attestation: parseJsonObject<BitBopReceipt>(r.attestation as string),
  }));
}

export function createMeetingDecision(
  input: Partial<MeetingDecision>,
  attestation?: BitBopReceipt
): MeetingDecision {
  const id = `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO meeting_decisions (id, title, decision, solution_id, attendees, decided_at, created_at, attestation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title || '',
      input.decision || '',
      input.solution_id || null,
      JSON.stringify(input.attendees || []),
      input.decided_at || ts,
      ts,
      attestation ? JSON.stringify(attestation) : null
    );
  return listMeetingDecisions().find((d) => d.id === id)!;
}

export function listRiskAssessments(): RiskAssessment[] {
  const rows = getDb().prepare('SELECT * FROM risk_assessments ORDER BY assessed_at DESC').all();
  return rows.map((r) => ({
    id: r.id as string,
    solution_id: r.solution_id as string,
    risk_tier: r.risk_tier as RiskAssessment['risk_tier'],
    findings: (r.findings as string) ?? '',
    assessor_name: r.assessor_name as string,
    assessed_at: r.assessed_at as string,
    created_at: r.created_at as string,
    attestation: parseJsonObject<BitBopReceipt>(r.attestation as string),
  }));
}

export function createRiskAssessment(
  input: Partial<RiskAssessment>,
  attestation?: BitBopReceipt
): RiskAssessment {
  const id = `risk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO risk_assessments (id, solution_id, risk_tier, findings, assessor_name, assessed_at, created_at, attestation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.solution_id || '',
      input.risk_tier || 'LOW',
      input.findings || '',
      input.assessor_name || '',
      input.assessed_at || ts,
      ts,
      attestation ? JSON.stringify(attestation) : null
    );
  return listRiskAssessments().find((a) => a.id === id)!;
}

// =============================================================================
// Attestation Ledger
// =============================================================================

export function saveAttestationRecord(
  att: BitBopReceipt,
  entityType = 'GOVERNANCE_EVENT',
  entityId = ''
): void {
  const id = randomUUID();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO attestations (id, event_type, entity_type, entity_id, beacon_sequence, signature, receipt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      att.event_type,
      entityType,
      entityId,
      att.beacon_sequence,
      att.signature,
      JSON.stringify(att),
      ts
    );

  if (att.raw_receipt) {
    cacheRawReceipt(att.beacon_sequence, att.raw_receipt as Record<string, unknown>);
  }
}

export function listAttestationRecords(): BitBopReceipt[] {
  const rows = getDb().prepare('SELECT * FROM attestations ORDER BY created_at DESC').all();
  return rows.map((r) => {
    const raw = (r as Record<string, unknown>).receipt as string;
    return JSON.parse(raw) as BitBopReceipt;
  });
}

export function getAttestationBySequence(seq: number): BitBopReceipt | undefined {
  const row = getDb()
    .prepare('SELECT receipt FROM attestations WHERE beacon_sequence = ? ORDER BY created_at DESC')
    .get(seq);
  if (!row) return undefined;
  return JSON.parse((row as Record<string, unknown>).receipt as string) as BitBopReceipt;
}

// =============================================================================
// NAIC May Update 10 Guardrails + AI6 Seed Data
// =============================================================================

function seedInitialData(): void {
  const countRow = getDb().prepare('SELECT COUNT(*) as count FROM controls').get() as {
    count: number;
  };
  if (countRow && countRow.count > 0) {
    return; // Already seeded
  }

  const ts = now();

  // 1. Working Group Hierarchy
  const wgStmt = getDb().prepare(`
    INSERT INTO working_group_members (id, name, title, business_remit, expertise, authority_tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const wgMembers: Omit<WorkingGroupMember, 'created_at'>[] = [
    {
      id: 'wg-01',
      name: 'Jordan Bell',
      title: 'AI Operations Team Lead',
      business_remit: 'Operational Triage & First-Line Oversight',
      expertise: 'Operational Triage & Incident Monitoring',
      authority_tier: 'TIER_1_LOW',
    },
    {
      id: 'wg-02',
      name: 'Marcus Chen',
      title: 'Chief Risk Officer',
      business_remit: 'Enterprise Risk Management & Safety Gates',
      expertise: 'Model Risk & Quantitative Validation',
      authority_tier: 'TIER_2_MEDIUM',
    },
    {
      id: 'wg-03',
      name: 'Elena Rostova',
      title: 'Chief Privacy Officer & WG Executive',
      business_remit: 'Legal, Privacy and AI Governance Executive',
      expertise: 'Privacy Law & Regulatory Governance',
      authority_tier: 'TIER_3_HIGH_EXEC',
    },
    {
      id: 'wg-04',
      name: 'Board Delegate Officer',
      title: 'Executive Board Representative',
      business_remit: 'Board Audit & Risk Committee Oversight',
      expertise: 'Corporate Governance & Fiduciary Oversight',
      authority_tier: 'BOARD_DELEGATE',
    },
    {
      id: 'wg-05',
      name: 'Dr. Alistair Vance',
      title: 'Head of AI Ethics & Research',
      business_remit: 'Ethics Standards & Societal Impact',
      expertise: 'AI Alignment & Algorithmic Fairness',
      authority_tier: 'TIER_2_MEDIUM',
    },
  ];

  for (const m of wgMembers) {
    wgStmt.run(m.id, m.name, m.title, m.business_remit, m.expertise, m.authority_tier, ts);
  }

  // 2. Controls: NAIC 10 Guardrails + AI6 Essential Practices
  const ctrlStmt = getDb().prepare(`
    INSERT INTO controls (id, code, title, description, control_type, package_name, naic_guardrail_number, supply_chain_role, owner_name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const PKG_10_GUARDRAILS = 'NAIC Voluntary AI Safety Standard (May Update — 10 Guardrails)';
  const PKG_AI6_FOUNDATIONS = 'NAIC AI6 — Foundations';
  const PKG_AI6_IMPLEMENTATION = 'NAIC AI6 — Implementation Practices';

  const initialControls: Omit<Control, 'created_at' | 'updated_at'>[] = [
    {
      id: 'ctrl-naic-g1',
      code: 'NAIC-G1',
      title: 'AI Governance Framework & Accountability',
      description: 'Establish organizational governance structure, roles, policies, and responsibilities for AI management.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 1,
      supply_chain_role: 'BOTH',
      owner_name: 'Dr. Alistair Vance, Head of AI Ethics',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g2',
      code: 'NAIC-G2',
      title: 'AI Risk Management & Impact Assessment',
      description: 'Continuous risk identification, evaluation, mitigation, and residual risk monitoring for AI systems.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 2,
      supply_chain_role: 'BOTH',
      owner_name: 'Marcus Chen, Chief Risk Officer',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g3',
      code: 'NAIC-G3',
      title: 'Data Quality, Provenance & Privacy Safeguards',
      description: 'Verify training/inference data accuracy, lineage, consent, and protection against unauthorized PII leakage.',
      control_type: 'TECHNICAL',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 3,
      supply_chain_role: 'BOTH',
      owner_name: 'Elena Rostova, Chief Privacy Officer',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g4',
      code: 'NAIC-G4',
      title: 'Adversarial Robustness & Pre-Deployment Testing',
      description: 'Red-teaming, boundary evaluation, benchmark evaluations, and security posture testing prior to deployment.',
      control_type: 'TECHNICAL',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 4,
      supply_chain_role: 'BOTH',
      owner_name: 'David Kim, AI QA Lead',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g5',
      code: 'NAIC-G5',
      title: 'Human-in-the-Loop Oversight & Kill Switch',
      description: 'Operational controls ensuring qualified human review, override capability, and graceful fail-safes.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 5,
      supply_chain_role: 'BOTH',
      owner_name: 'Sarah Jenkins, VP Operations',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g6',
      code: 'NAIC-G6',
      title: 'User Transparency & AI Notification Banner',
      description: 'Clear notice informing users when interacting with an AI system or receiving AI-generated decisions.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 6,
      supply_chain_role: 'DEPLOYER',
      owner_name: 'Rachel Moore, Head of Customer Trust',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g7',
      code: 'NAIC-G7',
      title: 'Contestability, Appeals & Redress Mechanism',
      description: 'Provide accessible channels for affected individuals to challenge AI decisions and receive human redress.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 7,
      supply_chain_role: 'DEPLOYER',
      owner_name: 'Priya Sharma, General Counsel',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g8-dev',
      code: 'NAIC-G8-DEV',
      title: 'Supply Chain Model Cards & Technical Transparency (Developer)',
      description: 'Publish comprehensive model cards, data provenance, system cards, and evaluation metrics for downstream deployers.',
      control_type: 'TECHNICAL',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 8,
      supply_chain_role: 'DEVELOPER',
      owner_name: 'Dr. Liam Patel, Principal ML Architect',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g8-dep',
      code: 'NAIC-G8-DEP',
      title: 'Supply Chain Due Diligence & Vendor Attestation (Deployer)',
      description: 'Vendor risk assessment, contractual safety commitments, verification of upstream model cards and audit rights.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 8,
      supply_chain_role: 'DEPLOYER',
      owner_name: 'Timothy Wright, Head of Procurement',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g9',
      code: 'NAIC-G9',
      title: 'System Telemetry, Audit Logs & Immutable Event Ledger',
      description: 'Immutable audit logging of model inputs, outputs, decisions, version transitions, and attestation receipts.',
      control_type: 'TECHNICAL',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 9,
      supply_chain_role: 'BOTH',
      owner_name: 'Alex Zhao, Head of Cyber Security',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-naic-g10',
      code: 'NAIC-G10',
      title: 'Stakeholder Engagement & Social Impact Consultation',
      description: 'Structured consultation with impacted stakeholders, customer groups, and vulnerability testing.',
      control_type: 'POLICY',
      package_name: PKG_10_GUARDRAILS,
      naic_guardrail_number: 10,
      supply_chain_role: 'BOTH',
      owner_name: 'Elena Rostova, Chief Privacy Officer',
      status: 'ACTIVE',
    },
    // AI6 Essential Practices
    {
      id: 'ctrl-ai6-p1',
      code: 'AI6-P1',
      title: 'AI6-P1 Executive Accountability Charter',
      description: 'Executive oversight, AI Working Group mandate, and Board-level reporting structure.',
      control_type: 'POLICY',
      package_name: PKG_AI6_FOUNDATIONS,
      naic_guardrail_number: 1,
      supply_chain_role: 'BOTH',
      owner_name: 'CEO Executive Office',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-ai6-p2',
      code: 'AI6-P2',
      title: 'AI6-P2 Enterprise Risk Tiering',
      description: 'Standardized four-tier risk classification methodology with mandatory escalation paths.',
      control_type: 'POLICY',
      package_name: PKG_AI6_FOUNDATIONS,
      naic_guardrail_number: 2,
      supply_chain_role: 'BOTH',
      owner_name: 'Marcus Chen, Chief Risk Officer',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-ai6-p3',
      code: 'AI6-P3',
      title: 'AI6-P3 Data Provenance & Minimization Protocol',
      description: 'Data classification, minimization, synthetic masking, and lineage verification for all AI pipelines.',
      control_type: 'TECHNICAL',
      package_name: PKG_AI6_FOUNDATIONS,
      naic_guardrail_number: 3,
      supply_chain_role: 'BOTH',
      owner_name: 'Elena Rostova, Chief Privacy Officer',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-ai6-p4',
      code: 'AI6-P4',
      title: 'AI6-P4 Automated Pre-Flight Test Harness',
      description: 'Automated regression testing, drift benchmarks, fairness tests, and canary deployment verification.',
      control_type: 'TECHNICAL',
      package_name: PKG_AI6_IMPLEMENTATION,
      naic_guardrail_number: 4,
      supply_chain_role: 'DEVELOPER',
      owner_name: 'David Kim, AI QA Lead',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-ai6-p5',
      code: 'AI6-P5',
      title: 'AI6-P5 Live Invariant Telemetry & Monitoring',
      description: 'Real-time monitoring of model drift, latency, input toxicity, and guardrail trigger rates.',
      control_type: 'TECHNICAL',
      package_name: PKG_AI6_IMPLEMENTATION,
      naic_guardrail_number: 9,
      supply_chain_role: 'DEPLOYER',
      owner_name: 'Alex Zhao, Head of Cyber Security',
      status: 'ACTIVE',
    },
    {
      id: 'ctrl-ai6-p6',
      code: 'AI6-P6',
      title: 'AI6-P6 Safety Incident Escalation & Redress Protocol',
      description: 'Rapid incident triage, remediation logging, root cause analysis, and customer notification channels.',
      control_type: 'POLICY',
      package_name: PKG_AI6_IMPLEMENTATION,
      naic_guardrail_number: 7,
      supply_chain_role: 'BOTH',
      owner_name: 'Priya Sharma, General Counsel',
      status: 'ACTIVE',
    },
  ];

  for (const c of initialControls) {
    ctrlStmt.run(
      c.id,
      c.code,
      c.title,
      c.description,
      c.control_type,
      c.package_name,
      c.naic_guardrail_number,
      c.supply_chain_role,
      c.owner_name,
      c.status,
      ts,
      ts
    );
  }

  // 3. Pre-seeded Capabilities
  const capStmt = getDb().prepare(`
    INSERT INTO capabilities (id, name, description, provider_or_tech, owner_name, status, control_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialCapabilities = [
    {
      id: 'cap-llm-triage-01',
      name: 'LLM Triage Engine',
      description: 'Retrieval-augmented LLM pipeline for customer claim triage and risk scoring',
      provider_or_tech: 'Claude 3.5 Sonnet / AWS Bedrock',
      owner_name: 'Dr. Liam Patel',
      status: 'AUTHORISED',
      control_ids: ['ctrl-naic-g3', 'ctrl-naic-g4', 'ctrl-naic-g8-dev', 'ctrl-naic-g9'],
    },
    {
      id: 'cap-doc-extract-01',
      name: 'Multimodal Document Extractor',
      description: 'OCR and visual document understanding for policy schedules and medical certificates',
      provider_or_tech: 'AWS Textract & Custom Vision Transformer',
      owner_name: 'David Kim',
      status: 'AUTHORISED',
      control_ids: ['ctrl-naic-g3', 'ctrl-naic-g9'],
    },
    {
      id: 'cap-fraud-score-01',
      name: 'Claims Anomaly Detector',
      description: 'Ensemble gradient boosted tree detecting anomalous claim velocity and billing patterns',
      provider_or_tech: 'XGBoost on SageMaker',
      owner_name: 'Marcus Chen',
      status: 'DRAFT',
      control_ids: [],
    },
  ];

  for (const cap of initialCapabilities) {
    capStmt.run(
      cap.id,
      cap.name,
      cap.description,
      cap.provider_or_tech,
      cap.owner_name,
      cap.status,
      JSON.stringify(cap.control_ids),
      ts,
      ts
    );
  }

  // 4. Pre-seeded Solutions
  const solStmt = getDb().prepare(`
    INSERT INTO solutions (id, title, business_problem, requesting_unit, owner_name, owner_remit, risk_tier, lifecycle_stage, capability_ids, control_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialSolutions = [
    {
      id: 'sol-claims-triage-01',
      title: 'Claims Triage Assistant',
      business_problem: 'Automate high-volume incoming claims categorization and reduce turnaround from 4 days to 4 hours.',
      requesting_unit: 'Customer Operations',
      owner_name: 'Sarah Jenkins',
      owner_remit: 'Claims Management',
      risk_tier: 'HIGH',
      lifecycle_stage: 1,
      capability_ids: ['cap-llm-triage-01', 'cap-doc-extract-01'],
      control_ids: [
        'ctrl-naic-g1',
        'ctrl-naic-g2',
        'ctrl-naic-g3',
        'ctrl-naic-g4',
        'ctrl-naic-g5',
        'ctrl-naic-g8-dep',
      ],
    },
  ];

  for (const sol of initialSolutions) {
    solStmt.run(
      sol.id,
      sol.title,
      sol.business_problem,
      sol.requesting_unit,
      sol.owner_name,
      sol.owner_remit,
      sol.risk_tier,
      sol.lifecycle_stage,
      JSON.stringify(sol.capability_ids),
      JSON.stringify(sol.control_ids),
      ts,
      ts
    );
  }
}
