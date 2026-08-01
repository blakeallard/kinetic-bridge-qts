# Meeting Requirements — 2026-07-13 (Blake ↔ Bryan)

Authoritative new business requirements for BI1-T71 / QTS, recorded verbatim-in-substance
from Blake's 2026-07-13 discussion with Bryan. These ADD scope on top of the
Round 90/91 "dev implementation effectively complete" state. Status per item: NOT
implemented unless noted. This document is permanent (per `docs/PROCESS.md`, durable
requirements must not live only in `docs/CURRENT_HANDOFF.md`).

## R1 — Payment Terms

- Add Payment Terms to the QTS quote workflow and to the generated quote document.
- Open design questions: picklist vs free text; default value; where it renders in the
  Writer template.

## R2 — Shipping Terms (REQUIRED field)

- Shipping Terms is a REQUIRED field on the quote.
- Must display prominently near the TOP of the generated quote.
- Must support shipment method AND legal/incoterm concepts (FCA, FOB, ...).
- Business rule discussed: Kinetic Bridge pays inbound shipping; customer pays outbound.
- DO NOT collapse method + incoterm + payer into one ambiguous free-text field without
  first evaluating whether separate structured fields are needed (likely: Incoterm
  picklist + Ship Method picklist + optional free-text detail). Design evaluation required
  before schema changes.

## R3 — Existing CRM sales-lifecycle continuity (Deal search/select)

Current test behavior (fn_sync_to_crm) creates a NEW CRM Deal directly in
Proposal/Price Quote. That is NOT the preferred normal workflow. Most real quotes
originate from an already-existing CRM Deal, often in an earlier stage
(Qualification, Needs Analysis, Value Proposition, Identify Decision Makers).

QTS must support:
- search/select of customer, contact, and/or account;
- discovery of relevant existing OPEN CRM Deals for that customer/contact/account;
- display of the existing Deal and its current stage;
- selection of the existing Deal as the source sales opportunity;
- persistence of the exact CRM Deal record ID (record IDs, not name matching, are the
  authoritative identity — the current Deal_Name-search behavior in fn_sync_to_crm does
  not satisfy this);
- updating/advancing that SAME Deal when a quote is generated;
- NO duplicate Deal when the opportunity already exists;
- NO stranding of the original Deal in an earlier stage while a copied Deal jumps ahead.

## R4 — Update-in-place CRM behavior

For an existing sales cycle: modify/update the same CRM Deal; advance its stage
appropriately when a real quote reaches quote stage; avoid duplicate opportunities;
preserve lifecycle history through the same Deal record.
CONSTRAINT: do NOT assume stage-advancement rules — the exact proposed transition
behavior must be documented and approved before implementation. (Current mapping
Draft→Proposal/Price Quote, Send for Signature→Negotiation/Review, Signed→Closed Won
must be re-evaluated for the existing-Deal path, including never moving a Deal
backwards.)

## R5 — Current quote link on the CRM record

The existing CRM Deal should expose a direct link to the current QTS quote.

## R6 — Current/latest quote + attachment semantics

- A client may receive multiple quote drafts/revisions within one sales cycle.
- The Deal must surface only the most-recent/current quote as the ACTIVE quote, and only
  the latest quote PDF as the ACTIVE attachment.
- Prior revisions must be PRESERVED for history/audit but must not be presented as
  current. Design supersession explicitly; do not blindly delete revision history.

## R7 — CRM Quotes module / related list (evaluation)

Evaluate whether the native Zoho CRM Quotes module / Quotes related list should carry
quote history, current-quote association, and structured CRM quote records. Round 91
audit found ZERO QTS records in the CRM Quotes module — not currently implemented.
This is a design DECISION to make, not a committed build.

## R8 — CRM Attachments

Preferred UX: the relevant Deal carries the current quote PDF in Attachments.
Evaluate exact replacement/supersession semantics for the latest attachment while
preserving historical auditability (e.g., superseded PDFs renamed/archived vs deleted).

## R9 — Deal Products synchronization (evaluation)

Keep the Deal's Products related list synchronized with the latest/current quoted line
items. Evaluate: latest quote lines → CRM Deal Products; update/replace semantics on
quote change; avoidance of duplicate/stale product rows. (Requires CRM Products records
per SKU — mapping from Creator Item_Master to CRM Products is part of the design.)

## Interaction with existing state

- Core dev implementation (pricing, kits, FX, widget, PDF, Sign) was effectively complete
  before these requirements; regression 14/14 PASS, headless suite 104/104 PASS (Round 90).
- Round 91 test-data cleanup is audited but NOT executed; R3–R9 will modify fn_sync_to_crm
  and CRM behavior, so cleanup ordering vs new CRM work must be planned (see Round 92
  planning entry in `docs/CURRENT_HANDOFF.md`).
- Production remains untouched. No Creator/CRM/Sign/Writer/Sheet changes were made when
  recording these requirements.
