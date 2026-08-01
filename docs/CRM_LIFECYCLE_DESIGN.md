# CRM Lifecycle Design — QTS ↔ Zoho CRM Deal Continuity (BI1-T71)

Status: **APPROVED 2026-07-13 (Blake, supported by Bryan's transcript) — D1–D8 decided; Round 95 implemented the repo/widget slices.**
Round 95 implementation state: `search_deals`/`create_deal` bridge actions + `fn_sync_to_crm`
rewrite (ID-authoritative, forward-only stage engine, no silent creation, no name-match) are
in repo + `deploy_ready/` awaiting Blake's manual Creator paste; widget Deal search/select +
save gate + revision counter shipped (128/128 headless tests). Live stage picklist verified —
actual API value is `Id. Decision Makers`. Approved deltas vs the original draft: D1 yes
(Draft advances early-stage Deal); D2/D3 cancellation clears current-quote association only,
never deletes/moves the Deal, NO automatic Closed Lost; D4 revision = base number + R1/R2/R3
incremented on EVERY Draft save; D5 current PDF singular, no deletions; D6/D7 Products sync
approved in principle (custom lines stay quote-only); D8 confirmed: no CRM Quotes module.
Remaining Tier gates: Quote_Revision field (Creator, Tier 3), Current_Quote_* Deal fields
(CRM, Tier 3 — live getFields confirmed zero custom Deal fields), Products seeding (Tier 2),
attachment scope verification. Created: 2026-07-13 (Round 93). Source requirements:
`docs/MEETING_REQUIREMENTS_2026-07-13.md` (R1–R9; this doc covers R3–R9).
Evidence basis: repo source at commit `e7f7ea4` + Round 60–91 handoff records.

Labels used throughout:
- **PROVEN CURRENT** — read directly from repo source or a recorded live QA round.
- **PROPOSED** — future behavior designed here; needs approval before build.
- **NEEDS LIVE VERIFICATION** — must be checked against live Zoho before build.
- **BUSINESS DECISION** — Blake/Bryan (or Bill for schema/Tier) must decide.

---

## 1. Current-state findings (evidence-cited)

### 1.1 How fn_sync_to_crm finds/creates Deals — PROVEN CURRENT

`functions/fn_sync_to_crm.deluge` (mirrored in `deploy_ready/creator/workflow/functions/fn_sync_to_crm.creator.deluge`):

1. Reads `quote.CRM_Deal_ID` first (line 152). If non-empty → `zoho.crm.updateRecord("Deals", id, deal_data)` (line 174) — **update-in-place by record ID already exists once an ID is persisted.**
2. If empty → **name-match fallback**: `zoho.crm.searchRecords("Deals","Deal_Name:equals:" + deal_name)` where `deal_name = Customer_Company + " — " + Quote_Number` (lines 5, 155). First hit wins.
3. If still empty → `zoho.crm.createRecord("Deals", deal_data)` and the new ID is written back to `quote.CRM_Deal_ID` (lines 164–179).

So: **YES, name matching is used today**, but only as the first-save bootstrap; because `deal_name` embeds the Quote_Number, every new quote effectively creates a NEW Deal — there is **no mechanism to attach a quote to a pre-existing sales-cycle Deal**. That is the R3 gap.

### 1.2 Current Deal stage behavior — PROVEN CURRENT

`fn_sync_to_crm` lines 6–9: `crm_stage = "Proposal/Price Quote"` unconditionally, overridden to `"Negotiation/Review"` when Status == "Send for Signature" and `"Closed Won"` when Status == "Signed". The stage is written on **every** sync (line 138), so:
- Draft / In Review / Awaiting Signatures / Cancelled all map to **Proposal/Price Quote** (Awaiting Signatures and Cancelled have NO explicit mapping — they fall through to the default). Note: `QTS_PROJECT_STATUS.md` claims Awaiting Signatures → Negotiation/Review; **the source disproves that** — only the exact string "Send for Signature" maps there.
- **Backward movement is possible today**: re-saving a quote as Draft after Send for Signature writes Proposal/Price Quote over Negotiation/Review. This violates R4 and must change.
- Cancelled has no Closed-Lost mapping (long-known gap, `QTS_PROJECT_STATUS.md` §7).

### 1.3 Quote_Request CRM identity fields — PROVEN CURRENT

Fields read/written by `fn_sync_to_crm`: `CRM_Deal_ID`, `CRM_Contact_ID`, `CRM_Account_ID`, `CRM_Lead_ID`, `Lifecycle_Stamped` (all as text/boolean on Quote_Request). `fn_generate_pdf` also reads `CRM_Deal_ID`/`CRM_Contact_ID` (persisted-ID-first, search fallback). Contact lifecycle fields `First_Quote_Number`, `First_Quote_Created_At`, `Lifecycle_Stage` on CRM Contacts are written once per contact (Round 60 work, lines 116–134).

### 1.4 CRM_Bridge actions — PROVEN CURRENT

`workflows/crm_bridge_on_create.deluge` known actions: `search_customers` (Contacts by email/first/last starts_with, dedup by id, returns contact+account refs), `get_customer` (Contact by ID + Account billing/shipping), `create_customer` (duplicate-guarded by email; find-or-create Account by exact Account_Name), `get_quote_lines`, `expand_kit`, `get_tax`, `books_diag`. **There is NO deal-search action.** Round 91 counted 169 bridge request records — the request/response pattern is proven at volume.

### 1.5 Current quote-link behavior — PROVEN CURRENT

The only quote link CRM ever receives is inside the **Note** created by `fn_generate_pdf` at Send for Signature (Sign `download_link` or `https://sign.zoho.com/signforms/<id>`). There is **no field on the Deal pointing at the Creator quote record**, and nothing at Draft stage. R5 gap.

### 1.6 CRM attachment behavior — PROVEN CURRENT

**None.** Exhaustive grep: no code writes to the CRM Attachments related list; the only Deal/Contact artifacts are Notes (Round 91 audit found exactly 4 Notes, 0 Attachments from QTS). R8 is greenfield.

### 1.7 CRM Products behavior — PROVEN CURRENT

**None.** No code references the CRM Products module or Deal Products related list. R9 is greenfield. Whether CRM Products records exist per Kinetic Bridge SKU — **NEEDS LIVE VERIFICATION** (likely empty; Item_Master lives only in Creator).

### 1.8 CRM Quotes module behavior — PROVEN CURRENT

**Unused.** Round 91 audit: 0 QTS records in the CRM Quotes module. No code references it.

### 1.9 CRM stage picklist — PROVEN CURRENT (org metadata)

Deals pipeline stages (org metadata, IDs on file): Qualification, Needs Analysis, Value Proposition, Identify Decision Makers, Proposal/Price Quote, Negotiation/Review, Closed Won, Closed Lost, Closed Lost to Competition. **There is no CRM stage named "Cancelled"** — Cancelled is a Creator quote Status only. Stage-picklist values should be re-confirmed live before build — NEEDS LIVE VERIFICATION (metadata could have changed).

---

## 2. Existing-vs-new Deal decision tree — PROPOSED

Authoritative identity everywhere below = **CRM Deal record ID persisted in `Quote_Request.CRM_Deal_ID`**. Name matching is retired as an identity mechanism (kept nowhere; the §1.1 fallback search is removed).

**A. Existing Deal explicitly selected (widget)**
→ Persist its record ID to `CRM_Deal_ID` at save. All subsequent syncs `updateRecord` that ID. Never create. Never rename the Deal to the quote-derived name (Deal_Name belongs to the sales cycle; the quote is referenced via the fields in §4) — BUSINESS DECISION: confirm Deal_Name is left untouched for pre-existing Deals.

**B. No Deal selected, but relevant open Deals exist for the chosen contact/account**
→ Widget shows the candidate list (see E). The user MUST explicitly either pick one or click a separate, explicit **"Create New Opportunity"** action. No default selection; Save Draft is blocked until the choice is made once a contact/account is chosen. (PROPOSED strictness — BUSINESS DECISION: alternatively allow saving with the choice deferred, with sync suppressed until chosen. Recommended: block, to guarantee R3.)

**C. No relevant open Deal exists**
→ "Create New Opportunity" is offered (and may be preselected since there is nothing to pick). On save, `fn_sync_to_crm` creates the Deal and writes the returned ID back to `CRM_Deal_ID` (mechanism already exists, §1.1 step 3).

**D. Only Closed Won / Closed Lost / Closed Lost to Competition Deals found**
→ Shown greyed-out for context, **not selectable**. A new quote against a closed cycle = new sales cycle = new Deal. Closed Deals are never silently reopened. (If Bryan ever wants "re-quote a lost deal reopens it," that's an explicit manual CRM action, out of QTS scope — BUSINESS DECISION to confirm.)

**E. Multiple open Deals found**
→ Display all, ranked by (1) Deal already linked to a prior QTS quote for this contact (has our quote fields populated), (2) most recently modified first. Show: Deal_Name, Stage, Amount, Modified_Time, Owner. **No automatic selection ever** — no proven rule exists to disambiguate.

Search mechanics (PROPOSED): new CRM_Bridge action `search_deals` — input `{contact_id?, account_id?}`; queries open Deals via Contact/Account relation (COQL or Related Records API; exact endpoint choice at build — NEEDS LIVE VERIFICATION that Contact_Name-based deal search returns related deals reliably); returns `[{deal_id, deal_name, stage, amount, modified_time, closed}]`. Follows the existing bridge request/response pattern exactly.

---

## 3. Stage-transition matrix — PROPOSED (requires Blake/Bryan approval per R4)

Global mandatory rules (all PROPOSED, per R4):
1. **Never move backwards**: compute target stage; if the Deal's current stage is at or past the target in pipeline order (Qualification < Needs Analysis < Value Proposition < Identify Decision Makers < Proposal/Price Quote < Negotiation/Review < Closed Won), write NOTHING to Stage. Non-stage fields (quote link, timestamps) still update.
2. **Never touch closed Deals' stage**: if current stage ∈ {Closed Won, Closed Lost, Closed Lost to Competition}, QTS never writes Stage (selection is blocked anyway per §2D; this is defense-in-depth for races).
3. **Idempotent**: re-running any sync with unchanged quote state produces zero stage change (guaranteed by rule 1 plus equal-target no-op).
4. **Read-before-write**: sync must `getRecordById` the Deal and compare stages before updating — the current code writes blind. (New requirement on `fn_sync_to_crm`.)

Quote-event → target-stage table (existing-Deal path and new-Deal path identical once the Deal exists):

| Quote event (Creator Status) | Target CRM stage | Behavior if Deal is earlier | Behavior if Deal is at/past target | Approval needed |
|---|---|---|---|---|
| New unsaved quote (widget only) | — none | no CRM write at all | no CRM write | — |
| Save Draft / Update Draft / In Review | Proposal/Price Quote | advance to Proposal/Price Quote | no-op (keep later stage) | **BUSINESS DECISION D1**: should a mere Draft already advance a Qualification-stage Deal, or only a Sent quote? Recommended: yes, Draft = "quote exists" = Proposal/Price Quote. |
| Send for Signature | Negotiation/Review | advance | no-op | matrix approval |
| Awaiting Signatures | Negotiation/Review (explicit mapping added — today it falls through to the default, §1.2) | advance | no-op | matrix approval |
| Signed | Closed Won | advance | no-op (already won) | matrix approval |
| Cancelled quote, Deal was created BY this quote (new-cycle path C) | Closed Lost | advance/close | never un-close | **BUSINESS DECISION D2**: Closed Lost vs leave-as-is; CRM has no "Cancelled" stage (§1.9). |
| Cancelled quote, Deal pre-existed (path A) | — none | stage untouched; quote-reference fields cleared or marked cancelled (§5) | same | **BUSINESS DECISION D3**: a cancelled quote must NOT kill a live sales cycle. Recommended: no stage write; Deal's "current quote" pointer marked Cancelled. |
| Revised quote after prior Send/Sign (new revision, §5) | stage of the revision's own status via rows above | rule 1 applies — a fresh Draft revision NEVER pulls Negotiation/Review or Closed Won back to Proposal/Price Quote | no-op | matrix approval |

Blocked behaviors (hard): stage writes to closed Deals; any stage write that would move backwards; creating a Deal when `CRM_Deal_ID` is populated; automatic selection among multiple candidates.

---

## 4. CRM identity model

| Field | Where | Status | Source of truth | Write direction | Timing | Idempotency |
|---|---|---|---|---|---|---|
| `CRM_Deal_ID` | Quote_Request | **existing** (§1.3) | CRM (record ID) | widget selection OR CRM create → Creator | at selection / first sync | write-once; never overwritten while non-empty (new guard — today nothing overwrites it either, but no guard exists) |
| `CRM_Contact_ID` | Quote_Request | **existing** | CRM | widget/get_customer or sync → Creator | selection / first sync | write-once while non-empty |
| `CRM_Account_ID` | Quote_Request | **existing** (read by sync; population path is widget/customer flow) | CRM | widget → Creator | selection | write-once while non-empty |
| `CRM_Lead_ID` | Quote_Request | **existing** | CRM | sync lookup → Creator | first sync w/ email | write-once (§1.1 code already guards) |
| QTS quote record ID on the Deal (e.g. `QTS_Quote_Record_ID`) | CRM Deals | **proposed new** (custom field; Tier 3/admin approval — NEEDS LIVE VERIFICATION of field-creation permissions) | Creator | Creator → CRM | every sync while this quote is current | overwrite-with-same is a no-op |
| Current quote number on Deal (e.g. `Current_Quote_Number`) | CRM Deals | **proposed new** | Creator | Creator → CRM | every sync of the current quote | same |
| Current quote URL on Deal (e.g. `Current_Quote_Link`, URL field to the Creator record/report detail) | CRM Deals | **proposed new** (satisfies R5) | Creator | Creator → CRM | every sync of the current quote | same |
| Current quote revision label (e.g. `Current_Quote_Revision`) | CRM Deals | **proposed new** | Creator | Creator → CRM | on supersession (§5) | same |
| Current quote updated-at (e.g. `Current_Quote_Updated_At`) | CRM Deals | **proposed new** | Creator | Creator → CRM | every sync | monotonic timestamp |
| Quote revision/version + supersession fields | Quote_Request | **proposed new** (§5: `Revision_Of`, `Superseded_By`, `Is_Current`) | Creator | Creator-internal | at revision creation | see §5 |

Quote_Request URL format for `Current_Quote_Link` — NEEDS LIVE VERIFICATION (stable Creator record-detail permalink pattern for the dev vs prod environment).

---

## 5. Current-quote supersession model — PROPOSED

Scenario: one sales cycle (one Deal) accumulates Draft v1 → v2 → v3 → Send-for-Signature → later revision.

Two distinct cases, deliberately separated:

**(a) Same Quote_Request edited repeatedly (v1→v2→v3 as saves of one record).** Creator already updates in place; the Deal's current-quote fields simply refresh each sync. Nothing to supersede — one record, one identity. PROVEN CURRENT mechanics + new Deal fields.

**(b) A NEW Quote_Request issued for the same Deal (true revision — e.g. re-quote after a Send).** PROPOSED model:
- New Creator fields on Quote_Request: `Revision_Of` (ID of prior quote), `Superseded_By` (ID of newer quote, back-filled), `Is_Current` (bool). Revision identity = the chain of record IDs; display label derived (e.g. `TEST-QUOTE0031-R2`) — **BUSINESS DECISION D4**: whether a revision keeps the original Quote_Number with a rev suffix or draws a new number from Document_Number_Log. Recommended: keep base number + `-R<n>` suffix so the customer-facing lineage is obvious; needs numbering-log design check.
- "**Current**" = the quote with `Is_Current = true` on that Deal; exactly one per Deal, enforced at revision creation (creator flips old `Is_Current` false and sets `Superseded_By`) — i.e. current means **latest created revision**, not latest modified, so an accidental edit of an old draft can't steal currency. Sending/signing does not change which record is current; it changes that record's Status.
- Deal surface: only the current quote's link/number/revision/updated-at (§4 fields). Prior revisions remain full Quote_Request records in Creator (history/audit) and remain visible in CRM only through historical Notes/attachment history (§6). **Nothing is deleted.**
- Stale-reference prevention: the sync writes Deal current-quote fields **only when the syncing quote's `Is_Current` is true**; syncs of superseded quotes update nothing on the Deal (and per §3 rule 1 can't move stage).
- Cancelled current quote on a pre-existing Deal: `Is_Current` stays true but the Deal's `Current_Quote_Revision` field shows "Cancelled" (D3) until a new revision is issued.

---

## 6. CRM attachment supersession design — PROPOSED (R8; greenfield per §1.6)

Capability check first: Deluge `zoho.crm.attachFile` / Attachments API upload to a Deal is standard Zoho functionality, but our connection scopes have never exercised it — **NEEDS LIVE VERIFICATION** (scope `ZohoCRM.modules.attachments.CREATE`, plus getting the PDF bytes: Writer merge currently goes straight to Sign; obtaining the merged PDF requires either Writer merge-and-store output or the Sign `download_link` — the exact retrieval path must be proven in dev before this design is final).

Proposed semantics:
- **Naming (deterministic, identity-bearing):** `<QuoteNumber>_<RevLabel>_<yyyy-MM-dd>.pdf` (e.g. `QUOTE0042_R2_2026-07-13.pdf`). The name alone ties the file to Quote_Request + revision; additionally the upload event is recorded in a Note carrying the Quote_Request record ID.
- **Append, never replace-in-place; supersede by marker.** New PDF for the same revision (regeneration): upload new, then delete is NOT performed automatically — instead the previous file for that same revision is renamed/marked `SUPERSEDED_` prefix if the API supports attachment rename, otherwise the newest timestamped name is authoritative by convention. **NEEDS LIVE VERIFICATION**: whether CRM attachments can be renamed via API; if not, fallback = keep both, newest-name-wins convention + Note pointing at the current one. **BUSINESS DECISION D5**: whether truly superseded PDFs may be deleted from the Deal (Tier 3 delete) or must all remain. Recommended default: keep all, no deletes — auditability over tidiness, with the "current" one always identifiable via the Deal's `Current_Quote_Link`/latest Note.
- **Duplicate prevention:** before upload, list Deal attachments and skip if an identical name already exists (idempotent regeneration).
- Old files: **remain attached** (no move/hide mechanism exists in CRM attachments without proof — none invented).

---

## 7. CRM Products sync design — PROPOSED (R9; greenfield per §1.7)

- **Source:** current quote's `Quote_Lines` (part_number, description, qty, unit_price, line_total — same rows `get_quote_lines` already serializes).
- **Target:** Deal → Products related list. CRM Products relate to Deals natively; per-line quantity/price on the relation — **NEEDS LIVE VERIFICATION**: whether the Deals-Products related list in this org supports per-association Quantity/Price fields or is a bare association (this determines whether quantities live on the relation or must ride in a Note/line-summary field).
- **Mapping:** requires CRM Products records keyed by Part_Number (`Product_Code`). Item_Master (34 rows) exists only in Creator — **BUSINESS DECISION D6**: seed CRM Products from Item_Master (one-time import + quarterly sync alignment) vs skip R9 until Products exist. Sync design assumes Products exist with `Product_Code == Part_Number`.
- **Strategy: replace-all against the current quote** (delete-associations-then-re-associate for this Deal), which is the only strategy that cleanly satisfies "no duplicate stale rows" given lines can be added, removed, and re-quantified between saves. Upsert-by-product-ID is the fallback if the API can't remove associations — then removed lines are the hard case and must be explicitly disassociated. Exact API shape NEEDS LIVE VERIFICATION.
- **Quantity changes:** covered by replace-all (fresh rows each sync).
- **Removed quote lines:** disappear because the list is rebuilt from current lines.
- **Custom/manual lines** (no Item_Master SKU, priceSource 'manual'): have no CRM Product — excluded from Products sync, surfaced instead in the Deal Description/Note line summary. **BUSINESS DECISION D7**: acceptable, or should a generic "Custom Line Item" Product exist?
- Timing: sync Products only for the current quote (`Is_Current`), same gate as §5.

## 8. CRM Quotes module recommendation

**Recommendation: DO NOT adopt the native CRM Quotes module now; optionally revisit post-production.** Rationale against, grounded in this system:
- Quote_Request in Creator is the proven source of truth (pricing engine, FX, kits, Sign pipeline all hang off it; 14/14 regression). A CRM Quotes record would be a second writable representation → the exact stale-artifact problem Bryan flagged (R6), doubled.
- Native CRM Quotes carry their own line items and totals; mirroring ours means a second Products mapping and a second supersession model, with no consumer: Bill/Bryan's UX need (see current quote + history on the Deal) is fully met by §4 Deal fields + §6 attachments + Notes.
- Round 91 proved the module is empty — nothing depends on it; adopting it adds Tier-3 module configuration, sync code, and permanent maintenance for zero unique capability.
- The one thing native Quotes would add — a structured "quote history" related list — is delivered more cheaply by the Notes trail + attachment history + the Creator report (linked from the Deal).
If Bryan explicitly wants CRM-native quote records for reporting later, revisit as a read-only projection (create-only snapshots at Send for Signature, never edited) — **BUSINESS DECISION D8** to confirm the do-not-use recommendation.

---

## 9. Implementation order (workstreams 4–9 of Round 92 plan)

| # | Step | Depends on | Gate |
|---|---|---|---|
| 0 | Approve this design (matrix §3, decisions D1–D8) | — | **Blake/Bryan** |
| 1 | CRM_Bridge `search_deals` action + widget Deal search/select UI + candidate ranking (§2) | 0 | none beyond 0 (dev only) |
| 2 | Persist selected `CRM_Deal_ID` (+ write-once guards on all four CRM_*_ID fields) | 1 | none |
| 3 | `fn_sync_to_crm` rewrite: retire name-match, read-before-write stage engine (§3), no-backward/no-closed rules, explicit Awaiting/Cancelled mappings | 0, 2 | matrix approval (D1–D3) |
| 4 | Deal custom fields (`QTS_Quote_Record_ID`, `Current_Quote_*`) + current-quote link sync (§4/R5) | 3 | **Tier 3 (Bill)** for CRM field creation |
| 5 | Supersession fields on Quote_Request + revision flow (§5) | 3 | D4 (numbering) |
| 6 | PDF attachment sync (§6) | 4; live verification of attach scope + PDF retrieval | D5; possible connection-scope change (Bill) |
| 7 | Products seeding + Deal Products sync (§7) | 4; D6 decided; live verification of relation API | D6, D7; Tier 2 bulk import for Products seed |
| 8 | (Only if D8 reverses) CRM Quotes projection | 5 | D8 |
| 9 | Extend regression matrix + headless suite with §10 cases | 3–7 | — |

Round 91 cleanup ordering: unchanged from Round 92 recommendation — defer the sweep until after these workstreams' dev QA (they will mint new test Deals/records).

## 10. Acceptance criteria (test matrix)

| # | Case | Expected |
|---|---|---|
| 1 | Existing open Deal selected, quote saved | Deal ID persisted; same Deal updated; zero new Deals in CRM |
| 2 | No open Deal exists | candidate list empty; Create New offered; new Deal created; ID written back |
| 3 | Multiple open Deals | all listed ranked per §2E; save blocked until explicit choice; no auto-pick |
| 4 | Same quote saved 5× unchanged | exactly 0 stage writes after the first; Deal fields unchanged (idempotency) |
| 5 | Draft v1→v2→v3 on one record | one Deal, current-quote fields track latest save; no duplicates |
| 6 | Revision chain (new record, `Revision_Of` set) | exactly one `Is_Current` per Deal; Deal points at newest; old quote intact |
| 7 | Existing Deal at Negotiation/Review, new Draft synced | stage stays Negotiation/Review (no backward move) |
| 8 | Deal Closed Won / Closed Lost / Closed Lost to Competition | not selectable; sync (race) writes no stage |
| 9 | Quote Cancelled on quote-created Deal | per D2 outcome (default: Closed Lost) — exactly once, idempotent |
| 10 | Quote Cancelled on pre-existing Deal | stage untouched; current-quote marker shows Cancelled |
| 11 | PDF regenerated for same revision | no duplicate attachment name; current PDF identifiable; history preserved |
| 12 | Products changed between revisions | Deal Products == current quote lines exactly; no stale rows; manual lines excluded per D7 |
| 13 | Send for Signature on existing Deal | stage → Negotiation/Review only if earlier; Note + attachment + link updated |
| 14 | Full run of cases 1–13 | zero duplicate Deals total; every stage change forward-only; current quote/attachment singular and obvious on the Deal |

---

## Unresolved business decisions (summary)

D1 Draft advances early-stage Deal to Proposal/Price Quote? · D2 Cancelled quote on quote-created Deal → Closed Lost? · D3 Cancelled quote on pre-existing Deal → no stage write (confirm) · D4 revision numbering (suffix vs new number) · D5 keep all superseded PDFs (no deletes)? · D6 seed CRM Products from Item_Master? · D7 custom-line handling in Products sync · D8 confirm do-not-use CRM Quotes module. Plus §2A Deal_Name untouched confirmation, and §2B block-save-until-choice strictness.

## Needs-live-verification (before build, dev only)

Deal search via Contact/Account relation endpoint shape · CRM stage picklist re-confirmation · CRM custom-field creation on Deals (permission) · Creator record permalink format · attachment upload scope + PDF byte retrieval path · attachment rename capability · Deals-Products relation quantity support · CRM Products emptiness.
