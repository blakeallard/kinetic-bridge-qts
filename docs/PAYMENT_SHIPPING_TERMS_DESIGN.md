# Payment & Shipping Terms Design — QTS (R1/R2, BI1-T71)

Status: **DRAFT for Blake/Bryan/Bill approval — nothing implemented.**
Created: 2026-07-13 (Round 94). Requirements: `docs/MEETING_REQUIREMENTS_2026-07-13.md`
R1 (Payment Terms) and R2 (Shipping Terms). Evidence basis: repo at `e7f7ea4`.

Labels: **PROVEN CURRENT** / **STALE-HISTORICAL** / **PROPOSED** /
**NEEDS LIVE VERIFICATION** / **BUSINESS DECISION (T#)** (numbered in §12).

---

## 1. Current-state findings (exhaustive repo sweep)

Sweep: `payment term / net 15|30 / shipping / shipment / freight / incoterm / FOB / FCA / carrier / delivery term` across `*.deluge, *.js, *.md, *.py, *.sql, *.html` in this repo + `~/bevco/qts-quote-builder/app`.

1. **`functions/fn_generate_pdf.deluge` lines 187–206 — PROVEN CURRENT.** The Writer merge payload ALREADY contains terms merge fields, but every value is **hardcoded**:
   `payment_terms = "Net 30"`, `shipping_terms = "FOB Origin"`, `lead_time = "4-6 weeks"`, `quote_validity = "30 days"`, `company_phone = "+1 800-555-0100"`, `fx_notes`, `additional_notes`. Also lines 99–121: `shippingAmt = 25.00` and `wireAmt = 25.00` hardcoded and **added into `totalAmt`**, rendered as `shipping_handling` merge field. Mirrored in `deploy_ready/creator/workflow/functions/fn_generate_pdf.debug.deluge` (deployed source). Consequence: **every PDF ever sent claims Net 30 / FOB Origin / $25 shipping regardless of the quote.** The Writer template therefore already has placeholders for `payment_terms` and `shipping_terms` — placement inside the template is NEEDS LIVE VERIFICATION (template `lg6haa9fe623ad500461ea6708547e49c8a4a` isn't in the repo).
2. **`kinetic_quote_schema.sql` lines 153–154, 878, 887 — STALE-HISTORICAL.** The legacy pre-Creator SQL design had `payment_terms TEXT NOT NULL DEFAULT 'NET 15'` and `shipping_terms TEXT NOT NULL DEFAULT 'FCA'`. Never built; useful only as prior-art evidence that NET 15/FCA were the observed manual-template defaults.
3. **`output/creator_quote_app_schema.md` + `output/zoho_quote_applet_research.md` — STALE-HISTORICAL.** Early research observed the ORIGINAL manual quote template using **Payment terms NET 15** and **Shipping terms FCA ("Free Carrier, Bevco ships from origin, customer pays freight")**. Direct prior-art support for R2's incoterm framing.
4. **Quote_Request live schema — NEEDS LIVE VERIFICATION (absence).** No repo source reads/writes `Payment_Terms` or `Shipping_Terms` on Quote_Request; the field list in `QTS_PROJECT_STATUS.md` has neither. Conclusion: fields almost certainly do NOT exist in Creator — confirm via getFormMetadata before schema work.
5. **CRM `Shipping_*` fields in `crm_bridge_on_create.deluge` — PROVEN CURRENT but unrelated**: those are Account shipping-address fields, not terms.
6. **Widget (`~/bevco/qts-quote-builder/app/widget.js`) — PROVEN CURRENT:** no terms fields anywhere; quote metadata UI covers customer search/CRM box, currency, FX mode, customer type, markup, notes, status. A custom line "Custom freight & crating" exists only in `mock-data.js` (demo data).
7. **`docs/BI1-T71_IMPLEMENTATION_PLAN.md` freight formulas — STALE-HISTORICAL** (marked historical in R92).

**Usable current implementation? NO** for data capture (nothing stores terms); **YES** for rendering plumbing (merge fields + template placeholders already exist — the build is mostly "replace hardcodes with real fields").

---

## 2. Field-model evaluation

| | `Payment_Terms` | `Shipping_Terms` | `Shipment_Method` | `Incoterm` |
|---|---|---|---|---|
| Exists today | NO (hardcoded merge value only) | NO (same) | NO | NO |
| Purpose | when payment is due | freight-cost responsibility (who pays) | physical mode of transport | legal risk/title transfer basis |
| Required | PROPOSED optional w/ default (T2) | **REQUIRED** (R2) | PROPOSED optional (T4) | PROPOSED required as part of Shipping Terms display (T5) |
| Type | Dropdown (Creator picklist) | Dropdown | Dropdown | Dropdown |
| Values (proposed, T1/T3/T4/T5) | Due on receipt, Net 15, Net 30, Net 45, Net 60, Prepaid, Custom… | Prepaid, Collect, Prepaid & Add, Third Party | Ground, Air, LTL, Freight, Customer Pickup, Courier, Other | FCA, FOB, (EXW/DAP/DDP only if Bryan wants — T5) |
| Source of truth | Quote_Request | Quote_Request | Quote_Request | Quote_Request |
| Widget placement | header metadata block (§6) | header block, top row | header block | header block, beside Shipping_Terms |
| Storage | new Quote_Request field | new field | new field | new field |
| Writer/PDF | existing `payment_terms` merge field (near totals/footer §7) | existing `shipping_terms` merge field, header (§7) | NEW merge field `shipment_method`, header | rendered inside the composed shipping-terms line (§7) |
| CRM sync | quote-only for now (§8) | quote-only | quote-only | quote-only |
| Affects calculations | NO | NO (see §4 note on the hardcoded $25) | NO | NO |
| Validation | non-empty if required per T2; Custom requires free-text detail | non-empty required (§5) | none beyond picklist | non-empty per T5 |

All four rows are PROPOSED; none exist. A companion free-text `Terms_Notes` (optional, Multi Line) is PROPOSED for edge cases so picklists stay clean.

**Why separate fields (R2's explicit question):** "FCA" (legal basis), "Air" (method), and "Collect" (who pays freight) answer three different questions; the observed business rule "Kinetic Bridge pays inbound, customer pays outbound" is a payer rule that maps onto Shipping_Terms/Incoterm, not onto method. One free-text field would make the required-field guarantee unverifiable (any string passes) and make PDF prominence inconsistent. Documented recommendation: **three structured dropdowns + optional notes**; collapse is rejected.

## 3. Payment Terms design — PROPOSED

- Dropdown, options per T1 (candidate list above; NET 15 is the historically observed default, "Net 30" is what the hardcode has been printing — Bryan must pick, T1/T2).
- **Default:** recommend defaulting to the approved standard term (likely Net 15 or Net 30 — T2) so existing flow doesn't gain a hard blocker; user may change per quote.
- **Custom:** selecting "Custom…" requires `Terms_Notes` non-empty (validation), rendered verbatim on the PDF.
- CRM/customer default terms (per-Account terms reuse): deferred — flagged as future enhancement once CRM lifecycle work lands (§8); NOT in this slice.
- **Revisions:** a new revision (CRM_LIFECYCLE_DESIGN §5) copies the prior quote's terms and remains editable — terms are quote-state, so latest-selected wins on the current revision; historical revisions keep what they were sent with. (Consistent with supersession model; T-agnostic.)

## 4. Shipping Terms design — PROPOSED (three separate concepts, per §2)

- **A. Shipping_Terms (payer):** Prepaid / Collect / Prepaid & Add / Third Party — candidate list, NOT authoritative (T3). REQUIRED. This is where "customer pays outbound" lives (likely standard value: Collect or FCA-implied customer-pays).
- **B. Shipment_Method:** Ground / Air / LTL / Freight / Customer Pickup / Courier / Other — candidate list (T4). Optional recommended (method is often unknown at draft time); "Other" requires Terms_Notes.
- **C. Incoterm:** FCA / FOB minimum (both explicitly discussed); FCA was the original manual-template standard (§1 finding 3). Required (T5) since it's the legal core of R2's "prominent shipping terms".
- Inbound-vs-outbound rule ("KB pays inbound, customer pays outbound"): this is **company policy context**, not a per-quote field — PROPOSED: encode as the default picklist selections + a standard sentence in the PDF shipping block (exact sentence: T6). Do not build inbound fields; QTS quotes only outbound.
- The hardcoded `shippingAmt = 25.00` added to the PDF total (§1 finding 1) is adjacent scope: it silently charges $25 shipping on every quote. **BUSINESS DECISION T7**: keep flat $25, make it a quote field, or drop it. Must be decided in the same slice since the shipping block is being rebuilt.
- Approval needed on all option lists before schema (they become Creator picklist choices — cheap to add later, awkward to rename).

## 5. Required-field behavior (Shipping Terms) — PROPOSED

Recommended rule: **staged validation** — Draft saves permitted with terms defaulted (never blank if defaults are approved per T2/T5); **Send for Signature hard-blocks** when Shipping_Terms or Incoterm is blank (widget validation + a `fn_generate_pdf` loud-fail guard exactly like the existing blocked-marker/signer-email guards at lines 80–97/164–170 — same proven pattern).

| Case | Behavior |
|---|---|
| New unsaved quote | fields visible, defaults preselected (per T2/T5) |
| Save Draft / Update Draft | allowed; if defaults are rejected (no-default decision), widget requires selection before save (stricter variant — T8 decides) |
| Send for Signature | HARD BLOCK if blank: widget refuses + Deluge guard aborts with info log (no doomed merge) |
| Legacy quote loaded (pre-schema, blank fields) | loads normally; widget shows "Shipping terms required" pill; cannot Send until set |
| Older/imported test data | same as legacy — blank tolerated at rest, blocked at Send |
| API/bridge-created records | Creator field default applies if configured; Deluge guard is the backstop (guard is authoritative, since client validation can be bypassed) |

Recommendation: block at Send, not at Draft — matches how the system already treats unquotable states (loud-fail markers block PDF, not save). **T8** records the alternative (block Save Draft) for Bryan to veto.

## 6. UI design (widget) — PROPOSED (no code this round)

Placement: a "Terms" row inside the existing quote-metadata header block, directly below customer info and beside currency/customer-type — i.e., above the lines table, mirroring the PDF's top placement.

```
┌─ Quote header ─────────────────────────────────────────────┐
│ Customer [search/CRM box]        Quote # TEST-QUOTE00xx     │
│ Customer Type [▼]  Currency [▼]  FX Mode [▼]  Markup [ ]   │
│ Shipping: Incoterm [FCA ▼]  Terms [Collect ▼]  Method [▼]  │
│ Payment Terms [Net 15 ▼]         Terms notes [………………]      │
└────────────────────────────────────────────────────────────┘
│ …quote lines table…                                         │
```

Shipping row sits first (visual prominence per R2); required fields get the widget's existing required-pill/validation styling. Save/load persistence follows the existing metadata field pattern (same path as Currency/FX mode).

## 7. Writer/PDF design — PROPOSED

- **Merge fields:** reuse existing `payment_terms` and `shipping_terms` keys (already in template — zero template-key churn for those); ADD `shipment_method`; render Incoterm composed INTO `shipping_terms` value (e.g. `"FCA — Collect (customer pays outbound freight)"`) so the template needs no new placeholder for it — OR add a separate `incoterm` field if Bryan wants it visually distinct (T9). Composition avoids one manual template edit.
- **Placement:** shipping terms line **near the quote header** (top block with quote number/date/validity) per R2 prominence; `payment_terms` near the totals/footer block (standard quoting convention) — current in-template positions are NEEDS LIVE VERIFICATION; the manual template edit (Tier: manual Writer editor work) will set final positions (T9 confirms placement).
- **Values:** replace the line-188/190 hardcodes with `ifnull(quote.Payment_Terms,…)` / composed shipping string. `lead_time`, `quote_validity`, `company_phone`, `fx_notes`, `additional_notes` hardcodes are adjacent debt — flagged, out of scope unless Bryan pulls them in (T10).
- **Blanks/legacy:** Send is blocked when shipping fields are blank (§5), so the PDF can never render a blank shipping block. Payment_Terms blank (if optional/no default) renders the approved default string rather than empty — never placeholder junk in a customer document. Legacy already-sent PDFs are immutable history; no action.

## 8. CRM interaction — PROPOSED

**Recommendation: quote-only storage now; no CRM sync in this slice.** Rationale: terms are per-quote commercial conditions; the Deal-level "current quote" surface (CRM_LIFECYCLE_DESIGN §4) will link to the quote where terms are visible; adding Deal term fields duplicates state and multiplies the supersession problem. Future enhancement (explicitly deferred): per-Account default terms in CRM copied into new quotes — revisit after CRM lifecycle workstream lands (**T11** to confirm deferral).

## 9. Migration / backward compatibility — PROPOSED

- Existing Quote_Request records: new fields blank at rest — tolerated; Send-blocked until set (§5). No backfill required; optional one-time backfill of Draft test quotes is unnecessary (they're Round 91 cleanup candidates anyway).
- Dev QA records / Stage: same rule. (No Stage environment records exist for QTS today — dev + prod only per prior rounds; "Stage/UAT" in this doc means the pre-promotion dev QA pass.)
- Production migration: fields ship in the promote plan BEFORE first prod quote, so prod never has legacy blanks.
- Old PDFs: immutable, untouched.
- Saved drafts loaded after schema change: widget must treat missing keys as blank without error (same tolerant-read pattern the loader already uses for absent report columns — proven pattern from T8/T9 tier work).

## 10. Implementation order (build sequence, all gated on this doc's approval)

1. Field design approval (T1–T11) — **Blake/Bryan**
2. Schema approval — **Tier 3 (Bill)**: 4 new Quote_Request fields (+ Terms_Notes)
3. Quote_Request schema changes (Creator dev; manual or MCP per Tier ruling)
4. Report exposure (add new columns to Quote_Request_Report — manual, same as R90 T8/T9 lesson: widget reads the report)
5. Widget field additions (header block §6) + 6. client validation (§5) + 7. save/load persistence — one widget slice, headless tests extended
8. Deluge compatibility: `fn_generate_pdf` reads real fields + Send guard; confirm `fn_calc_quote_lines`/sheet sync untouched (terms are non-calculational)
9. Writer merge mapping update (replace hardcodes; add `shipment_method`)
10. Writer template manual edit (placement per §7) — manual, Writer editor
11. PDF regression (visual render check incl. phone-render item from prior rounds)
12. Dev UAT validation (Blake live QA)
13. Extended regression: 14-case matrix + §11 cases + 104-test headless suite additions

Dependencies: 3→4→5–7→8–9→10→11–13; independent of the CRM lifecycle workstream except both touch `fn_generate_pdf` (coordinate edits).

## 11. Acceptance test matrix

| # | Case | Expected |
|---|---|---|
| 1 | New quote, valid Payment Terms picked | saved, rendered in PDF footer block |
| 2 | New quote, Payment Terms untouched | default applies (per T2); never blank in PDF |
| 3 | Shipping Terms/Incoterm blank at Send | widget blocks + Deluge guard aborts with info log; no Sign request |
| 4 | Custom shipment method ("Other") | requires Terms_Notes; note renders |
| 5 | FCA selected | header shipping line renders "FCA — …" |
| 6 | FOB selected | renders "FOB — …" |
| 7 | Legacy draft (pre-schema) loaded | loads clean, required-pill shown, Send blocked until set |
| 8 | Save → reload round-trip | all four fields persist exactly |
| 9 | Generated PDF | shipping block near header, payment terms near totals, no hardcoded "Net 30"/"FOB Origin" remnants |
| 10 | Revised quote | terms copied from prior revision, editable |
| 11 | Pre-promotion UAT pass | full flow on dev with real term values |
| 12 | Regression | pricing/kits/CRM sync/save-load/discard/PDF: no behavior change (14/14 + suite PASS) |

## 12. Business decisions (Blake/Bryan; Bill where noted)

- **T1** Exact Payment Terms option list (candidates: Due on receipt, Net 15, Net 30, Net 45, Net 60, Prepaid, Custom). Note conflict: history observed NET 15; hardcode has been printing Net 30.
- **T2** Payment Terms required-with-default vs hard-required-choice; and WHICH default.
- **T3** Exact Shipping Terms (payer) options (candidates: Prepaid, Collect, Prepaid & Add, Third Party) + standard default.
- **T4** Exact Shipment Method options + optional-vs-required.
- **T5** Exact Incoterm options (FCA, FOB minimum; others?) + default (history says FCA).
- **T6** Standard PDF sentence encoding "KB pays inbound / customer pays outbound".
- **T7** Fate of the hardcoded $25.00 shipping charge in every PDF total (keep flat / new field / remove).
- **T8** Block Save Draft on blank Shipping Terms, or only Send for Signature (recommended: Send only).
- **T9** Writer/PDF placement confirmation + separate `incoterm` placeholder vs composed string (recommended: composed).
- **T10** Whether to also de-hardcode lead_time / quote_validity / company_phone / notes in the same slice.
- **T11** Confirm terms stay quote-only (no CRM sync) for now.
- **(Bill)** Tier 3 schema approval for the new Quote_Request fields.

## NEEDS LIVE VERIFICATION (before build)

Quote_Request getFormMetadata confirming Payment_Terms/Shipping_Terms absence and link-name availability · Writer template current placeholder positions for `payment_terms`/`shipping_terms` · whether the template has room/section for a header shipping line without layout rework · Quote_Request_Report column-exposure mechanics for the new fields.
