# AAIMS (AIMI) — Proof of Concept Builder Specification (v1.0-POC)

> **Target Builder**: Autonomous Software Engineering Agent  
> **Reference API Documentation**: Read `https://www.bitbop.dev/llms.txt` (and `https://www.bitbop.dev/llms-full.txt`) to discover and integrate BitBop's live cryptographic endpoints (`https://api.bitbop.dev`).

---

## 1. Mission Overview

Build a working, corporate-grade client-server web application (**AAIMS — Australian AI Management & Safety Interface**) aligned with the **Australian NAIC Voluntary AI Safety Standard (10 Guardrails)**.

- **Frontend**: React + Vite (clean, professional, executive/corporate aesthetic — crisp typography, neutral slate/navy palette, clear status badges, zero clutter).
- **Backend**: Node.js HTTP/Express API server with persistent local storage (SQLite or structured JSON file store) pre-seeded with realistic Australian enterprise sample data so the interface is immediately populated on first load, while supporting full live creation, editing, workflow progression, incident logging, and cryptographic attestation.
- **Cryptographic Attestation (100% Real — No Mocks!)**: All governance signatures and attestations (`Qsecure / BitBop`) **must** make real network calls to **`https://api.bitbop.dev`** using a real Free Tier API key (`bb_free_...`) self-provisioned via `POST https://api.bitbop.dev/api/keys/free` (see `https://www.bitbop.dev/llms.txt`).

---

## 2. Strict Domain Data Model (Three Core Business Objects ONLY)

Your core domain model **must** consist of strictly **three top-level business objects**. Do **not** invent separate top-level entities for policies, control packages, models, or risk registers:

| Object | Definition | Required Fields |
| :--- | :--- | :--- |
| **`SOLUTION`** | The business-facing answer to a problem requested by a business unit. | `id`, `title`, `business_problem`, `requesting_unit`, `owner_name`, `owner_remit`, `risk_tier` (`LOW`, `MEDIUM`, `HIGH`), `lifecycle_stage` (1–9), `capability_ids[]`, `control_ids[]`, `created_at`, `updated_at` |
| **`CAPABILITY`** | The functionality used to deliver a solution (can be shared across multiple solutions). | `id`, `name`, `description`, `provider_or_tech`, `owner_name`, `status` (`DRAFT`, `AUTHORISED`, `SUSPENDED`), `control_ids[]`, `created_at` |
| **`CONTROL`** | The policy or technical mechanism governing authorised use (can be grouped into packages and reused). | `id`, `code` (e.g. `NAIC-G1`..`NAIC-G10`), `title`, `description`, `control_type` (`POLICY` \| `TECHNICAL`), `package_name` (e.g. `"NAIC Voluntary AI Safety Standard (May Update — 10 Guardrails)"`, `"NAIC AI6 — Foundations"`, `"NAIC AI6 — Implementation Practices"`), `naic_guardrail_number` (1–10 or null), `supply_chain_role` (`DEPLOYER` \| `DEVELOPER` \| `BOTH`), `owner_name`, `status` (`ACTIVE`, `GAP_IDENTIFIED`, `RETIRED`) |

### Mandatory Business Rules Enforced in Code (Backend & UI)
1. **Every Solution uses $\ge 1$ Capability and $\ge 1$ Control**:
   - A `SOLUTION` cannot advance past Stage 4 (`Identify Capabilities`) without at least one linked `CAPABILITY`.
   - A `SOLUTION` cannot advance past Stage 5 (`Apply Controls`) or be approved (`Stage 7: Approve`) unless it has at least one linked `CONTROL` **and** every linked `CAPABILITY` is governed by at least one `ACTIVE` `CONTROL`.
2. **No Capability May Be Authorised Without Controls**:
   - Attempting to set a `CAPABILITY` to `status = "AUTHORISED"` when `control_ids.length === 0` (or when none of its controls are `ACTIVE`) **must be rejected with HTTP 400** and a clear governance error message.
3. **Controls Govern Capabilities Independently**:
   - The UI must allow attaching `CONTROL`s (and reusable Control Packages like the 10 NAIC Guardrails) directly to a `CAPABILITY` independent of any `SOLUTION`, as well as to a `SOLUTION`.
4. **Policies & Control Packages Are Controls**:
   - A Policy is a `CONTROL` with `control_type: "POLICY"`. A Control Package is a named grouping (`package_name`) of `CONTROL`s that can be applied in one click.

---

## 3. Approval Hierarchy & Working Group Cycle

### 3.1 Board $\rightarrow$ CEO $\rightarrow$ AI Working Group Hierarchy
Maintain a registry of **AI Working Group Members** appointed by the CEO under Board authority:
- Each member has: `id`, `name`, `title`, `business_remit`, `expertise`, and `authority_tier` (`TIER_1_LOW`, `TIER_2_MEDIUM`, `TIER_3_HIGH_EXEC`, `BOARD_DELEGATE`).
- During **Stage 7 (`Approve`)**, the backend must verify that the selected approving Working Group member holds an `authority_tier` sufficient for the Solution's `risk_tier` (or require escalation to a higher-tier member).

### 3.2 The 9-Stage Working Group Cycle (`AIMI Meeting Mode`)
Every `SOLUTION` progresses through these exact 9 stages:
`1. Request a Solution → 2. Investigate → 3. Assign Owner → 4. Identify Capabilities → 5. Apply Controls → 6. Assess → 7. Approve → 8. Implement → 9. Review`

Provide a dedicated **Working Group Meeting & Lifecycle Workspace** where users can:
1. Submit a new **Request for a Solution** (starts at Stage 1).
2. Step a Solution forward through each of the 9 stages, enforcing the ownership, capability, control, assessment, and approval-authority gates at each step.
3. Log **Supporting Governance Records** attached to the core objects:
   - **Meeting Decisions & Approvals**
   - **Risk & NAIC 10-Guardrail Assessments**
   - **Breach / Incident Notifications & Remediations** (e.g., logging a safety/privacy incident against a Solution or Capability, triggering a remediation action and an attested audit trail)
   - **Compliance Audits**

---

## 4. Real BitBop (`Qsecure`) Cryptographic Signing & Verification

Every significant governance action **must** be cryptographically signed and attested using the live BitBop API (`https://api.bitbop.dev`):
1. **Self-Provision a Real BitBop API Key**:
   - Read `https://www.bitbop.dev/llms.txt` (and `https://www.bitbop.dev/llms-full.txt`).
   - Use `POST https://api.bitbop.dev/api/keys/free` (with `MlKem768` from the `mlkem` npm package) so your backend automatically provisions its own `bb_free_...` API key on startup if `BITBOP_API_KEY` is not set.
2. **Real Cryptographic Attestation on Governance Events**:
   - Whenever any of these events occur:
     - **Solution Request Submitted** (`SOLUTION_REQUESTED`)
     - **Working Group Stage Decision / Advancement** (`WORKING_GROUP_DECISION`)
     - **Capability Authorisation** (`CAPABILITY_AUTHORISED`)
     - **Solution Approval** (`SOLUTION_APPROVED`)
     - **Breach / Incident Notification** (`BREACH_NOTIFICATION`)
     - **Remediation Completed** (`BREACH_REMEDIATION`)
     - **Compliance Audit Executed** (`COMPLIANCE_AUDIT`)
   - Compute the canonical `SHA-256` hex digest of the governance record, call **`POST https://api.bitbop.dev/consume`** (with `Authorization: Bearer <API_KEY>` and `signature_scheme: "ml-dsa-44"`) and/or **`POST https://api.bitbop.dev/attestation`** to generate a genuine **NIST FIPS 204 `ML-DSA-44`** signed receipt anchored to a live hardware quantum beacon block (`beacon_sequence`, `beacon_hash`).
   - Store the full signed BitBop receipt alongside the governance event record.
3. **Live Receipt Verification in the UI (`POST https://api.bitbop.dev/verify`)**:
   - Every attested event in the UI must display its **Beacon Block `#`**, **`ML-DSA-44` Signature Prefix**, **Event SHA-256 Digest**, a **"Verify on BitBop"** button (which calls `POST https://api.bitbop.dev/verify` live and displays the cryptographic check results: `beacon_exists`, `beacon_hash_match`, `beacon_signature_valid`, `entropy_bound_to_beacon`, `receipt_signature_valid`), and a link to `https://www.bitbop.dev/provenance?sequence=<beacon_sequence>`.
   - Include a **`powered by BitBop`** footer link to `https://www.bitbop.dev`.
