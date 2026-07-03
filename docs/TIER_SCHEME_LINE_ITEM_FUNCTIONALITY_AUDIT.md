# Tier_Scheme Line-Item Pricing Functionality Audit — BI1-T71

Zoho Task ID: `2543412000001469015`
Review date: 2026-07-03
Scope: Repo-only static audit of Deluge source. No Zoho records read/modified, no Creator deployment, no Item_Master import, no business decisions made. No `.deluge` files were edited in this session.

---

## Executive answer

**No** — Creator's quote line-item pricing logic is not ready for `Tier_Scheme`. `fn_get_tier_price.deluge` hardcodes a single, universal 9-band hardware qty→tier mapping and applies it to every `Item_Master` row regardless of item type. Today this is invisible because only hardware-tier SKUs are in the deployed `Item_Master` (per `QTS_PROJECT_STATUS.md`, Item_Master import is not yet approved). The moment any license/software SKU (Creator License, Service Tool, obsolete-software) is imported using the `Tier_Scheme=license` rows already computed in `import_preview/item_master_import_preview.csv`, every quote line for those SKUs will silently price against the wrong qty bands — not fail, not warn, just compute a confidently wrong number. Concrete worked example below.

The good news: the fix is small and contained. The qty-band selection logic lives in exactly one function (`fn_get_tier_price.deluge`), and the two calling functions (`fn_calc_quote_lines.deluge`, `fn_sync_to_sheet.deluge`) need no changes at all, because they already delegate tier lookup entirely to `fn_get_tier_price`.

---

## Current pricing flow

1. **Item selected**: sales rep picks a line item in the `Quote_Lines` subform. `Part_Number` is either typed directly or resolved from a `Part_Select` lookup field pointing at `Item_Master` (`fn_calc_quote_lines.deluge:40-46`).
2. **Quantity entered**: `line.Qty`, read as `qty = line.Qty.toLong()` (`fn_calc_quote_lines.deluge:33`) or `ifnull(line.Qty,0)` (`fn_sync_to_sheet.deluge:126`).
3. **Item_Master lookup for price**: `eur_price = thisapp.fn_get_tier_price(part, qty)` (`fn_calc_quote_lines.deluge:49`; mirrored in `fn_sync_to_sheet.deluge:128`).
4. **Tier price selected** (inside `fn_get_tier_price.deluge`): re-fetches the `Item_Master` record by `Part_Number`, builds a list of `Price_T1..Price_T9`, maps `p_qty` to a `tier_index` (0-8) via one fixed 9-band table, then walks the index **downward** to the nearest non-null populated tier if the mapped tier is blank.
5. **Line total calculated** (`fn_calc_quote_lines.deluge:50-77`): `usd_cost = eur_price * eur_usd` → discount applied via `fn_get_discount` (gated on `Item_Master.Discountable=="Y"`) → markup applied → `Unit_Price`, `FX_Unit_Price`, `Line_Total_USD`, `Line_Total_FX` written back to the line.
6. **Quote total updated**: `fn_sync_to_sheet.deluge` re-derives `total_revenue`/`total_cost` by summing `Line_Total_USD` and a second independently-computed cost across all lines, then upserts the 3 Sheet tabs; `fn_sync_to_crm.deluge` separately sums `Line_Total_USD` into the CRM Deal `Amount`.

---

## Functions/files inspected

- `functions/fn_calc_quote_lines.deluge` — line pricing orchestrator
- `functions/fn_get_tier_price.deluge` — qty→tier lookup (the function in question)
- `functions/fn_get_discount.deluge` — discount-by-tier lookup (Customer_Type × Product_Type × qty)
- `functions/fn_sync_to_sheet.deluge` — independently re-derives per-line cost/margin for the Sheet tabs
- `functions/fn_sync_to_crm.deluge` — sums line totals into CRM Deal Amount (no tier logic itself)
- `functions/fn_generate_pdf.deluge` — consumes already-computed `Unit_Price`/`Line_Total_USD`, no tier logic
- `functions/fn_refresh_fx_rates.deluge`, `functions/fn_send_to_sign.deluge`, `functions/fn_get_next_number.deluge` — inspected, not tier/pricing-relevant (FX cache refresh, Sign template call, quote-number sequencing)
- `import_preview/item_master_import_preview.csv`, `import_preview/import_preview_report.md`, `import_preview/generate_preview.py` — source of the `Tier_Scheme` classification already computed per-row
- `docs/LIBAL_NBMS_CBMS24_PRICE_QC.md`, `docs/LIBAL_REFERENCE_PRICE_QC.md` — prior QC findings on cross-family pricing and the 300300/300500 duplicate
- `STATUS.md`, `QTS_PROJECT_STATUS.md` — confirm Item_Master import is still unapproved and `Tier_Scheme` is an open decision point

---

## Current assumptions in pricing logic

`fn_get_tier_price.deluge` (lines 22-31, current deployed logic) hardcodes:

```
if(p_qty <= 19) { tier_index = 0; }
else if(p_qty <= 99) { tier_index = 1; }
else if(p_qty <= 259) { tier_index = 2; }
else if(p_qty <= 499) { tier_index = 3; }
else if(p_qty <= 999) { tier_index = 4; }
else if(p_qty <= 2499) { tier_index = 5; }
else if(p_qty <= 4999) { tier_index = 6; }
else if(p_qty <= 9999) { tier_index = 7; }
else { tier_index = 8; }
```

This is the **9-band hardware** breakpoint table (`1-19 / 20-99 / 100-259 / 260-499 / 500-999 / 1000-2499 / 2500-4999 / 5000-9999 / 10000-24999`), applied unconditionally to every `Item_Master` row regardless of `Category` or the item's actual published band structure. The function never reads a `Tier_Scheme` field — none exists on `Item_Master` today, and no Deluge function in this repo references it (confirmed by direct grep in the prior BI1-T71 readiness review).

**Concrete quantified impact if license SKUs are imported unmodified**, using confirmed values from `import_preview/item_master_import_preview.csv` for SKU `200200`/`200500` (Creator License FULL, EUR list prices `1700 / 1275 / 1105 / 850 / 595 / 425` at license bands `1 / 2 / 3-4 / 5-9 / 10-24 / 25-249`):

| Order qty | Correct license-band price (EUR) | Price actually returned by current hardware-mapped logic | Overcharge factor |
|---|---|---|---|
| 10 units | 595 (band `10-24`, T5) | 1700 (band `1-19`, T1 — because current logic treats qty≤19 as tier_index 0) | **2.86x** |
| 30 units | 425 (band `25-249`, T6) | 1275 (band `20-99`, T2 — current logic treats qty≤99 as tier_index 1) | **3.0x** |

This is not a graceful degradation — it is a confidently wrong number with no error, no flag, and (per the earlier BI1-T71 readiness review) no visible distinction from a correctly-priced line on the generated PDF or CRM record.

**One reassuring structural finding**: the vendor's actual published band structures collapse to only **two** distinct qty→tier_index mappings, not four, because the shorter band tables are exact-breakpoint prefixes of the longer ones:
- `Tier_Scheme=hardware` covers both "BMS boards" (9 bands: `1-19...10000-24999`) and "Accessories" (4 bands: `1-19/20-99/100-259/260-499`) — the Accessories bands are identical to the first 4 hardware bands, so the existing 9-band mapping already prices Accessories correctly today (T5-T9 simply stay null and the existing "walk down to nearest populated tier" fallback, lines 34-38, already handles it).
- `Tier_Scheme=license` covers both "Creator Tool"/"Service Tool" (6 bands: `1/2/3-4/5-9/10-24/25-249`) and "obsolete software" (3 bands: `1/2/3-4` — an exact prefix of the 6-band table). One 6-band license mapping correctly serves both, again relying on the existing fallback for the truncated case.

So the fix needed is exactly what `Tier_Scheme` already models in the import preview: **one additional 6-band mapping table, selected by `Tier_Scheme`, reusing the existing fallback logic unchanged.**

---

## Required changes

1. **`fn_get_tier_price.deluge`** — read `item.Tier_Scheme` inside the existing `for each item in Item_Master[Part_Number == p_part_number]` loop (the record is already fetched there; no new lookup needed). Branch to one of two qty→tier_index tables:
   - `hardware` (existing 9-band table, unchanged)
   - `license`: `qty<=1→0, qty<=2→1, qty<=4→2, qty<=9→3, qty<=24→4, else→5` (25-249-and-above collapses to the last published band, matching the hardware table's own top-band behavior)
   Default to `hardware` if `Tier_Scheme` is blank/null, for backward compatibility with any records created before the field exists.
   The existing "walk index downward to nearest non-null tier" fallback (lines 34-38) needs no change — it already works correctly for both schemes.
2. **No changes needed to `fn_calc_quote_lines.deluge` or `fn_sync_to_sheet.deluge`** — both call `thisapp.fn_get_tier_price(part, qty)` and never see the tier-index logic directly; fixing it in one place fixes both call sites.
3. **Unpriced-SKU zero-price guard** (see Risks below) — `fn_get_tier_price.deluge` currently returns `0` (its initial value) whenever no tier at or below the requested index has a price, which is indistinguishable from a legitimately-free item (none exist today). A caller-visible sentinel or error path is needed before any of the 5 currently-`BLOCKED_NO_PRICE` SKUs could safely enter a live quote.
4. **Duplicate-row filtering** (see Risks below) — `fn_get_tier_price.deluge`, and the separate `Item_Master` lookups inside `fn_calc_quote_lines.deluge` (Discountable/Category) and `fn_sync_to_sheet.deluge` (same), all query `Item_Master[Part_Number == part]` with no `Active`/status filter and take only the first match (`break`). If both the `EXCLUDE_CANDIDATE` and `CANONICAL_CANDIDATE` rows for 300300/300500 were ever imported under the same `Part_Number`, pricing would depend on unspecified record-return order.

None of the above have been implemented — this document is the plan, not the change.

---

## Field/schema requirements

- **`Item_Master.Tier_Scheme`** (new field, Creator manual UI change) — Single Line or Dropdown, values `hardware` / `license`, matching the CSV column already generated by `import_preview/generate_preview.py`. This is additive and does not require the existing 30 already-priced hardware rows (per the current import preview) to be touched, since the function defaults missing values to `hardware`.
- **Recommended, not strictly required for Tier_Scheme itself**: an `Active`/`Status` field on `Item_Master` (or equivalent), to give the 3 Item_Master lookup call sites something to filter on if duplicate SKUs are ever imported despite the recommendation to resolve them pre-import. The cleaner alternative — enforcing `Part_Number` as a unique key in Creator once the 300300/300500 duplicate is resolved per Bill/Bryan's decision — avoids needing this field at all. Which approach to take is a business/schema decision, not made here.
- No change needed to `Quote_Lines` subform fields (`Part_Number`, `Qty`, `Unit_Price`, etc.) — the fix is fully contained inside `fn_get_tier_price.deluge`'s internal `Item_Master` lookup.

---

## Risks

1. **Silent wrong pricing today, if license SKUs are imported before this fix** — quantified above (2.86x–3.0x overcharge at realistic qtys). This is the single highest-severity risk audited in this document.
2. **Silent zero-price on unpriced SKUs** — `fn_get_tier_price.deluge` returns `0` (never a distinguishable error) when no populated tier exists at or below the requested qty index. `fn_calc_quote_lines.deluge` then computes `usd_cost = 0`, and the resulting `Unit_Price`/`Line_Total_USD` are `0` with no flag anywhere downstream (Sheet, CRM, or PDF) that would reveal this to a sales rep before a quote is sent. Currently only relevant if one of the 5 `BLOCKED_NO_PRICE` SKUs (101815, 102100, 103005, 200400, 300400) is ever added to a quote line while still unpriced — but the code has no guard preventing that today, regardless of the `BLOCKED_NO_PRICE` classification living only in the import-preview layer, not in Creator.
3. **Duplicate/stale-row nondeterminism** — none of the 3 `Item_Master` lookup call sites (`fn_get_tier_price`, `fn_calc_quote_lines`, `fn_sync_to_sheet`) filter by any active/status field or guard against more than one row per `Part_Number`. If both rows for 300300/300500 are imported as-is, pricing outcome is undefined (depends on Creator's internal record ordering, not on the `CANONICAL_CANDIDATE`/`EXCLUDE_CANDIDATE` recommendation already documented in `docs/LIBAL_REFERENCE_PRICE_QC.md`).
4. **`Category` vs `Tier_Scheme` consistency** — discount logic (`fn_calc_quote_lines.deluge:55`, `fn_sync_to_sheet.deluge:134`) already branches on `Category=="Software"` independently of `Tier_Scheme`. These two fields must stay consistent at import time (`Category=Software` ⇔ `Tier_Scheme=license`; `Category=Hardware/Accessory` ⇔ `Tier_Scheme=hardware`) or discount and tier-pricing logic could disagree on what kind of item a row is. The current import preview CSV already keeps these consistent per the `generate_preview.py` `SECTIONS` mapping; this is a note for whoever maintains `Item_Master` going forward, not a currently-observed bug.
5. **Duplicated Item_Master lookup code across 3 functions** (pre-existing, noted in the earlier BI1-T71 readiness review) — a fix to filtering/Tier_Scheme logic in one place does not automatically propagate to the others' separate `Discountable`/`Category` lookups. Not a blocker for the Tier_Scheme fix itself (which is fully contained in `fn_get_tier_price.deluge`), but relevant to risk #3 if an `Active` filter is chosen as the duplicate-row mitigation, since it would need to be added in 3 places, not 1.

---

## Recommended implementation order

1. Bill/Bryan resolve the two pending business decisions that gate everything else: (a) confirm `Tier_Scheme` (hardware=9-band / license=6-band) as described here and in the original readiness review, and (b) confirm the 300300/300500 duplicate resolution (`CANONICAL_CANDIDATE` unit rows vs `EXCLUDE_CANDIDATE` bundle rows) — both already pending per `STATUS.md`.
2. Add the `Tier_Scheme` field to the Creator `Item_Master` form (additive schema change, no data risk to existing rows).
3. Update `fn_get_tier_price.deluge` per "Required changes" #1 above — the single, contained code change that makes both hardware and license pricing correct.
4. Decide and implement the unpriced-SKU guard (risk #2) — e.g., a non-zero sentinel returned by `fn_get_tier_price` plus a caller-side check in `fn_calc_quote_lines.deluge` that blocks save or visibly flags the line, rather than silently writing `0`.
5. Decide and implement duplicate-row prevention (risk #3) — most simply by ensuring only one row per `Part_Number` is ever imported (resolving 300300/300500 before import), with an `Active` filter as defense-in-depth if duplicates can't be fully ruled out.
6. Only then perform the actual `Item_Master` import.
7. Re-run (and extend) the controlled test plan from the earlier BI1-T71 deployment-readiness review, adding an explicit license-tier line item at qty=10 or qty=30 to prove the fix against the quantified overcharge example above.

---

## Safe next step

Get Bill/Bryan's sign-off on the two decisions blocking step 1 above (`Tier_Scheme` approval and the 300300/300500 duplicate resolution) — both are pure business confirmations with evidence already assembled in `docs/LIBAL_REFERENCE_PRICE_QC.md` and this document, and both must be settled before either the Creator schema change or the `fn_get_tier_price.deluge` edit should be made. No code should be edited and no import should proceed until then.
