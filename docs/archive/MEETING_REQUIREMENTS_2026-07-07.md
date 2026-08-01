# Meeting Requirements — 2026-07-07 (BI1-T71 / QTS)

Zoho Task ID: `2543412000001469015`
Input: meeting summary provided by Blake, 2026-07-07. Reconciled against `README.md`, `QTS_PROJECT_STATUS.md`, `import_preview/`, `audit/reports/`, and public Acme BMS sources (researched 2026-07-07).

**Source priority** (per meeting instruction):

1. Transcript = business intent
2. Acme BMS datasheets/product pages = engineering rules
3. Item Master / RSP price list = quoteable SKUs and prices
4. Repo docs = current implementation status

Quantity math is **not** finalized from the transcript alone; every engineering rule below is either datasheet-cited or explicitly marked pending.

---

## R1 — Duplicate hidden service-tool rows (300300 / 300500)

**Meeting:** Disregard the hidden/minimized duplicate rows in the 300300/300500 service-tool area for now; the items are represented in visible rows. Do not build quote logic around the hidden rows unless later confirmed.

**Repo state:** Matches the existing working assumption. `import_preview/duplicate_sku_classification.json` already classifies hidden rows 54/55 as `EXCLUDE_CANDIDATE` and visible rows 58/60 as `CANONICAL_CANDIDATE`.

**Resolution:** Meeting **endorses** the working assumption. Formal Bill/Bryan sign-off is still recorded as pending, but implementation proceeds on the visible rows only. No change to duplicate handling in `generate_preview.py`.

## R2 — Obsolete / discontinued items: warn, don't remove, don't block

**Meeting:** Some obsolete/discontinued items may still need to be quoted. Do not remove all obsolete items. If an item is obsolete, discontinued, red-marked, delivery-stop, or obsolescent, the app should show a clear warning — warn and double-check before quoting. No hard block unless explicitly confirmed later.

**Repo state — MISMATCH:** The import preview previously recommended `EXCLUDE_VENDOR_DISCONTINUED` (excluded from live import/quoting) for SKUs `102100`, `103005`, `200400`, `300400`, and `README.md` documented them as excluded.

**Resolution (implemented this pass):** `generate_preview.py` now emits:

- `Item_Status` — `Active` / `Discontinued` / `Obsolescent` / `Not_Released` (`Delivery_Stop` is a supported value; no current RSP_EUR item row carries that mark — see `audit/reports/status_marks.csv`)
- `Quote_Warning` — `Y — <reason>` for every non-Active item; empty for Active items
- Vendor-discontinued recommendation changed from `EXCLUDE_VENDOR_DISCONTINUED` to `IMPORT_WITH_WARNING`

**Precedence preserved:** the four vendor-discontinued SKUs are also **unpriced** in the July 2026 RSP, so they keep `Review_Flag=UNPRICED` and remain unquotable until a price or manual-price decision exists. Import-with-warning changes their lifecycle policy, not their price availability.

Status derivation evidence:

| Item_Status | Rule | Evidence | SKUs |
|---|---|---|---|
| `Discontinued` | Workbook red fill (`FFFFC7CE`) legend "Discontinued" | `audit/reports/status_marks.csv` rows 26/27/47/59 | 102100, 103005, 200400, 300400 |
| `Obsolescent` | Vendor section "Software for obsolesenced BMS" | RSP_EUR section header, sheet row 64 | 100640.99, 100641.99, 100699.99 |
| `Not_Released` | Description marked `DRAFT` or `(RELEASE Qn/yyyy)` | RSP_EUR rows 16/17; 101815 also carries the "New Item added" fill | 101814 (Q3/2026), 101815 (DRAFT) |
| `Active` | Everything else | — | remaining 39 rows |

Quote-time behavior (future Creator work, not this pass): warning statuses surface as a confirm/double-check prompt on quote lines — never a hard block (R6).

## R3 — BMS kit auto-population (NEW workstream — spec deferred)

**Meeting:** Selecting a BMS kit should auto-populate the normal required and optional related items. Users must be able to delete optional items or set quantity to zero. Ease of use over restriction. Individual components must always remain quotable separately (replacements, reorders, damaged cables, already-owned parts).

**Repo state:** No kit/BOM concept exists anywhere in the app or repo plans.

**Corroborating vendor data already in repo:** the RSP workbook itself contains per-family configuration sheets, extracted at `audit/reports/config_rows.csv` — main product + optional components with vendor quantity notes (e.g. n-BMS: CMU qty "1 – 30", "Number of CMUs depend on battery voltage"; harness "Same amount as number of CMUs"; CAN adapter "Necessary for software setup but can be sourced externally"). This is the natural seed for the kit component mapping.

**Status:** Deferred by Blake (2026-07-07 approval): no `kit_bom/` files, no `scripts/kit_bom_check.py`, no Deluge autofill yet. Next pass after this one is reviewed.

## R4 — Quantity logic for BMS components

**Meeting:** Some quantities are fixed/manual, not multiplied by kit quantity. nBMS CMU count depends on series cell count: `CMU_qty = ceil(series_cell_count / channels)`, with CMU12 → 12 and future CMU18 → 18; infer channel count from item names where possible. Datasheets must confirm before finalizing math.

**Datasheet reconciliation:**

- **CMU12 — CONFIRMED.** Each CMU12 monitors **4–12 series cells** (minimum 12 V to power the CMU), up to **32 CMUs per MCU**, **384 series cells max** per system ([n-BMS product page](https://acmebms.com/products/n-bms/)). So `ceil(series_cells / 12)` is the correct minimum CMU count, with validation bounds: ≥4 cells per CMU (12 V floor), ≤32 CMUs, ≤384 cells. Note the vendor config sheet says "1 – 30" CMUs (`audit/reports/config_rows.csv`) vs 32 on the product page — use the tighter bound until clarified.
- **CMU18 — PENDING_DATASHEET.** No public datasheet found (the [n3-BMS page](https://acmebms.com/products/n3-bms-battery-management-system-bms/) still documents CMU #100809 with 6–12 channels; no CMU18 mention). Consistent with the price list: 101814 is "(RELEASE Q3/2026)", 101815 is "DRAFT"/unpriced. `ceil(series_cells / 18)` stays a transcript-only rule — do not implement as confirmed math.
- **Name inference:** `CMU12`/`CMU18` in descriptions supports a `CMU(\d+)` channel-count inference as the meeting suggested; keep channels-per-CMU as data, never hardcoded.
- **i-BMS15/6 — TRANSCRIPT CORRECTED.** The meeting note said "15 series channels, up to 6 boards daisy-chained." The vendor page says the i-BMS15 has **8–15 voltage channels** (17–60 V) and the "/6" means **up to 6 battery packs in parallel with Hot Swap** — parallel packs, not series daisy-chaining ([i-BMS15 product page](https://acmebms.com/products/i-bms15/)). Quantity driver is parallel pack count, not series cell count.
- **c-BMS24 / c-BMS24X:** up to 24 cells each, 0–120 VDC measurement; c-BMS24X supports up to 10 parallel packs ([c-BMS24](https://acmebms.com/products/c-bms24/), [c-BMS24X](https://acmebms.com/products/c-bms24x/)). Single-board products — no series-cell CMU math.
- **s-BMS:** only legacy softkeys remain in the price list (100640.99, 100641.99, 100699.99 under "Software for obsolesenced BMS") — no hardware SKUs, no kit logic needed; these carry `Item_Status=Obsolescent` warnings (R2).

**Research limitations:** helpdesk.acmebms.com and sensata.com return HTTP 403 to automated fetches; distributor-hosted PDF datasheets were not machine-readable with available tooling. Engineering numbers above come from acmebms.com product-page HTML. Re-verify against the official PDFs before the kit BOM pass ([datasheet index](https://helpdesk.acmebms.com/hc/en-us/articles/8616017930258-List-of-all-off-the-shelf-Sensata-Technologies-BMS-and-their-datasheets), browse manually).

## R5 — Optional accessories / software / tools

**Meeting:** Optional items populate as candidate quote lines, removable or zero-qty. Some setup items may be customer-sourced (CAN adapter, SKU 100545). Service tools usually not sold but may appear as options. "IsoSpyWire" standalone sale is rare but possible.

**Repo state:** Consistent with vendor config sheets (`audit/reports/config_rows.csv` marks harnesses/shunt "Optional - can be sourced externally", CAN adapter "Necessary for software setup but can be sourced externally", service tools "Optional. Needed mostly for service after series production").

**Open question:** no SKU named "IsoSpyWire" exists. Closest matches are the isoSPI wire harness kits — 100986, 100985.1, 103006. Confirm with Blake/Bill which item the meeting meant.

## R6 — Guardrails philosophy

**Meeting:** Do not over-restrict. Quotes are prepared by BEVCO/Kinetic Bridge staff, not customers. Defaults and warnings, not hard blocks, unless explicitly confirmed.

**Resolution:** Adopted as the design rule for R2 (warnings) and R3 (removable auto-populated lines). No existing behavior conflicts.

## R7 — Quarterly price-list import & Zoho-native functionality research

**Meeting:** Import/update logic should eventually handle new quarterly Acme BMS sheets: changed prices, changed quantity tiers, distributor restrictions, currencies, new items, discontinued items, delivery-stop/changed flags. Before building a custom full upload utility, research whether Zoho has native Price Books / price-list / matrix-pricing upload functionality, and document why any custom build doesn't duplicate it.

**Research (2026-07-07):**

- **Zoho CRM Price Books** support per-product list prices with CSV/XLS import ("Import List Price" in the Products related list) and "differential pricing" — but differential pricing is a **discount-% over quantity ranges applied to a single unit price**, not absolute per-band prices ([Creating Price Books](https://www.zoho.com/crm/help/price-books/create-price-books.html), [Working with Price Books](https://help.zoho.com/portal/en/kb/crm/manage-inventory/price-books/articles/price-books)).
- **Zoho Books Price Lists** are importable/exportable per-item price lists ([Price lists](https://www.zoho.com/us/books/help/items/price-list.html)) — but Books is not part of the QTS pipeline and Books writes are Tier 2 (Bill approval).
- **Zoho Creator** (where QTS runs) has no native price-book construct; Item_Master is a Creator form.

**Why native features don't replace the custom import path:** QTS pricing needs absolute EUR band prices (`Price_T1..T9`) with two tier schemes (9-band hardware / 6- and 3-band license), `Discountable` flags, vendor lifecycle status, hidden-row/duplicate-row handling, and change-flag awareness — none of which CRM Price Books' single-price-plus-discount-% model or Books price lists express, and neither can drive `fn_get_tier_price` inside Creator. **Conclusion:** keep the Creator `Item_Master` + `import_preview/generate_preview.py` pipeline as the import path; optionally sync CRM Price Books later for CRM-side deal display only. This section documents the non-duplication rationale the meeting asked for.

---

## Decisions still pending (people, not code)

- Bill/Bryan: formal sign-off on R1 duplicate-row classification; 101815 pricing (import/exclude/manual price); Partner exposure as `Customer_Type`; `Inquiry_Type`/`Quote_Type` for Battery/BMS/Other; DKK handling; 200999 reactivation SKU identity.
- Vendor/datasheet: CMU18 channel count + release; CMU-per-MCU bound (30 vs 32); blank upper-tier price behavior (LEM sensors 000833/000876/000637).
- Blake/Bill: which SKU "IsoSpyWire" refers to; service-tool sale policy per case.

## Deferred implementation (explicitly out of this pass)

- `kit_bom/kit_components.csv`, `scripts/kit_bom_check.py`, any Deluge kit-autofill code.
- Creator-side quote-time warning UX for `Quote_Warning` items.
- Live Zoho / deployed Deluge changes of any kind.
