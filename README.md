# AAIMS — Australian AI Management & Safety Interface

**AAIMS (AIMI)** is an organisational AI governance, safety, and innovation management platform built to meet the **Australian Government National AI Centre (NAIC) Voluntary AI Safety Standard (10 Guardrails)** and attested via **[BitBop](https://www.bitbop.dev)** post-quantum hardware provenance (`NIST FIPS 204 ML-DSA-44`).

## Core Ontology

AAIMS enforces a strict three-object core domain model:
1. **`SOLUTION`** — The business-facing answer to a problem requested by a business unit (*Named Solution Owner*).
2. **`CAPABILITY`** — The functionality used to deliver one or more solutions (*Named Capability Owner*).
3. **`CONTROL`** — The policy or technical mechanism governing authorised use, grouped into reusable Control Packages such as the 10 NAIC Guardrails (*Named Control Owner*).

- Every `SOLUTION` uses at least one `CAPABILITY` and at least one `CONTROL`.
- No `CAPABILITY` may be authorised for operation without appropriate `CONTROL`s.
- `CONTROL`s also govern `CAPABILITY`s independently of their use in a particular `SOLUTION`.
- Requests, Working Group meetings, approvals, risks, policies, evidence, tests, decisions, BitBop (`Qsecure`) signatures, and breach/incident histories are supporting records and processes associated with those three core objects and the Board $\rightarrow$ CEO $\rightarrow$ Working Group approval hierarchy.

## Specifications

- **[Full Enterprise Specification (`docs/AAIMS_FULL_SPEC.md`)](docs/AAIMS_FULL_SPEC.md)**: Complete domain ontology, NAIC 10-Guardrails mapping, Board $\rightarrow$ CEO $\rightarrow$ Working Group approval hierarchy, 9-stage Working Group lifecycle, BitBop cryptographic attestation architecture, and Phase 2 multi-tenant Supabase/SSO roadmap.
- **[Proof-of-Concept Builder Specification (`docs/AAIMS_POC_SPEC.md`)](docs/AAIMS_POC_SPEC.md)**: Self-contained React + Vite + Node.js POC specification with live BitBop `ML-DSA-44` attestation and verification requirements.
