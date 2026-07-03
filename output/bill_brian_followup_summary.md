# Bill/Brian Follow-Up Summary
## Kinetic Quote — Prototype Readiness Review

Prepared by: Blake Allard
Date: 2026-06-25
Related tasks: BI1-T71 (Quote Form/Pricing Applet), BI1-T93 (SOW/Quote Numbering Applet)

---

## Decisions Needed

These decisions are blockers for the prototype build. Nothing can be built to production quality without answers to items 1–6.

### 1. Quote Number Format

**Current observed format:** `QUOTE0004`
(Sequential, no year, no dashes, 4-digit zero-padded integer)

**Alternative proposed in build spec:** `QUOTE-2026-0001`
(Year-based, dashes, resets each year)

**Decision needed:**
- Keep the current format (`QUOTE0004`, `QUOTE0005`, etc.)?
- Switch to year-based (`QUOTE-2026-0005`, resets to `QUOTE-2027-0001` each January)?
- Use a different format entirely?

**Impact:** This determines how the numbering counter is seeded, structured, and reset. Cannot build the log without this answer.

---

### 2. Last Issued Quote Number

**Decision needed:** What is the most recent Quote number that has been officially issued?

Based on observed example: `QUOTE0004` exists. Are there more beyond that?

**Impact:** The counter in the app must be seeded at the correct starting point. Seeding too low will cause collisions with existing documents. Seeding too high skips numbers permanently.

---

### 3. Last Issued SOW Number

**Decision needed:** What is the most recent SOW number that has been officially issued? What is the SOW numbering format?

No SOW examples were available in the reference files provided.

**Impact:** Same as above — the SOW counter must be seeded correctly.

---

### 4. Bevco's Distributor Tier with Acme BMS

**Decision needed:** Is Bevco currently at the **Partner** tier (>750k EUR) or the **Distributor** tier (250k–750k EUR) with Acme BMS?

This directly controls which discount row applies to all quotes. The two tiers have meaningfully different discount percentages across volume brackets.

**Impact:** Every quoted price depends on this. The pricing formula is: `(EUR list price × EUR/USD rate × (1 − distributor discount)) × (1 + markup)`. Wrong tier = wrong prices across the entire app.

---

### 5. Markup Rate

**Decision needed:** What is Bevco's standard markup rate applied to all lines on a customer quote?

In the observed example, a single markup multiplier is applied uniformly to all line items (`$L$20` in the spreadsheet). The value was present in the file but is internal and was not captured in this sanitized output.

**Impact:** This is the primary profitability lever. Must be confirmed before pricing can be validated against existing quotes.

---

### 6. Minimum Acceptable Gross Margin

**Decision needed:** What is the minimum acceptable gross margin percentage for a quote line before a warning is triggered?

**Impact:** Without this, the margin warning system cannot be configured. Lines below floor should be flagged for approval before the quote is sent.

---

## Data Needed

These items don't block design but are required before the app can produce accurate numbers.

### 7. International Wire Transfer Charge

**Data needed:** What is the flat international wire transfer charge deducted from profit per quote?

Observed in the Profit sheet as "Int Wire Charge" — a fixed amount deducted from total profit. Amount was present in the file but not captured in sanitized output.

**Use:** Populates the default value for `Wire_Charge_Amount` on Quote_Output.

---

### 8. Item Cost Data (Unit Cost per SKU)

**Data needed:** Where does Bevco track the unit cost (DKK or USD) for each Acme BMS item?

The Profit sheet derives cost from DKK totals divided by quantity and converted at the DKK/USD rate. The source of those DKK costs appears to be distributor invoices, not the price list.

**Options:**
- Do distributor invoices serve as the cost source (manual entry per quote)?
- Is there a separate cost schedule maintained internally?
- Should the Creator app maintain a cost table per SKU?

**Impact:** Unit costs are required to calculate gross margin per line. Without them, the profit view cannot be built.

---

### 9. Item Master Location

**Data needed:** Where does the item master currently live — Zoho Books, Zoho CRM, a spreadsheet, or nowhere?

**Impact:** Determines whether the Creator app maintains its own item master (v1) or syncs from an existing source.

---

### 10. Prior Quote History

**Data needed:** Are there any prior quotes beyond QUOTE0004 that need to be imported into the Document_Number_Log for continuity?

**Impact:** Determines whether a historical import step is needed before going live.

---

## Access Needed

| Access | Who to Grant | Why |
|---|---|---|
| Zoho Creator (app creation) | Blake | Build the prototype app |
| Zoho Creator admin access | Blake (temp) | Create forms, workflows, and Deluge scripts |
| Zoho WorkDrive (folder structure) | Blake | Set up v2 document storage (can wait) |
| Zoho Books (view-only) | Blake | Verify item master and estimate behavior (v2 research) |

---

## Recommended Prototype

**Phase 1 (can start now, no business inputs needed):**
- Build `Document_Type` form with QUOTE and SOW seed records
- Build `Document_Number_Log` form with unique ID enforcement
- Build the numbering Deluge function
- Test: issue QUOTE0005, QUOTE0006, cancel QUOTE0005, verify it cannot be reissued

**Phase 2 (needs decisions 1–6 above):**
- Build `Items` form and import Acme BMS price list
- Build `Price_Rules` form with confirmed discount percentages
- Build `Quote_Request` form with FX rates and markup
- Build `Quote_Lines` form with full pricing Deluge
- Build `Quote_Output` with profit/fee rollup
- Validate against QUOTE0004 — confirm output matches existing spreadsheet

**Phase 3 (after prototype approval):**
- WorkDrive document storage integration
- Zoho Books estimate push
- Zoho CRM/Bigin contact linkage

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Quote number format conflict | High | High | Confirm format before seeding counter |
| Wrong distributor tier | High | High | Confirm tier before importing Price_Rules |
| Missing unit cost data | High | Medium | Clarify cost source before building Profit view |
| CMU quantity complexity | Medium | Medium | n-BMS kits have variable CMU count — may need a config step |
| Software license pricing gap | Medium | Low | Software flagged `???` in example — confirm pricing model |
| Concurrent submission race condition | Low | Low | Acceptable for v1 volume; document limitation |

---

## Next Action

**Immediate:** Schedule 30-minute working session with Bill and/or Brian to answer decisions 1–6 before any pricing logic is built.

**Items to bring to that session:**
- This summary document
- A sanitized printout of the QUOTE0004 pricing formula breakdown
- The Acme BMS distributor tier table (from the price list)
- Confirm whether Zoho Creator is accessible and which Zoho One org it lives under

**Who should attend:** Bill Beverley (pricing/margin decisions), Bryan Ovalle (if involved in quoting), Blake Allard (build)
