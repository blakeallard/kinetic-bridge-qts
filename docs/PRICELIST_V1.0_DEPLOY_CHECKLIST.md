# Deploy checklist — pricelist v1.0 (2026-07-01) → Zoho

> **STATUS: COMPLETE — deployed to Production 2026-08-03 and live-verified.**
> Kept as the record of what was done and as the template for the next revision.
> Deviations found during the run are recorded at the bottom under "What actually happened".

Ordered. Do them in this order; steps 1–3 are prerequisites for step 4 and the paste will
fail if you skip them. Everything is in Creator **Development** first; step 9 publishes.

Repo root: `/Users/blakeallard/bevco/repos/kinetic-bridge-qts`

## What is NOT affected (do not touch)

Zoho Flow (all 7 custom functions), all 4 CRM_Bridge form workflows, all 4 Quote_Request
form workflows, the `daily_fx_refresh` schedule, and 10 of the 12 Creator functions —
including `fn_get_tier_price`, which needed no change. `fx_rates_cache_import.csv` is
unchanged.

---

## 1. Verify three Item_Master fields exist  ⚠️ hard prerequisite

Creator → QTS (Edit, Development) → Design → **Item_Master** form. Confirm these exist:
`Active`, `Item_Status`, `Quote_Warning` (all Single Line).

They were added per `PRODUCTION_ROLLOUT_2026-07-31.md` step 4 and the live picker already
filters Discontinued items, so they should be there. **If `Item_Status` is missing, stop** —
add it before going further. Step 4's Deluge reads it, and the whole Bundled behaviour
depends on it.

While you are there, note its **internal link name** (click the field → Field Link Name).
Expected: `Item`. You need this for step 4.

## 2. Import Item_Master — 45 rows

| | |
| --- | --- |
| File | `deploy_ready/creator/imports/item_master_import_FULL.csv` |
| Where | Creator → QTS → **Item_Master report** → Import |
| Fallback | If step 1 showed the three fields are absent and you chose not to add them, use `item_master_import_CORRECTED.csv` (14 cols) — but then skip step 4's `fn_calc_line_price_draft` paste, because Bundled cannot work without `Item_Status`. |

**Import mode matters.** Choose **Update existing records / "Add and update"** with
**`Part_Number` as the matching key**. A plain "Add" import creates 45 duplicate records
and `fn_get_tier_price` will then pick whichever row Creator returns first.

`Tier_Scheme` must map to the dropdown exactly (`Hardware` / `License`, case-sensitive) —
this is what failed 44/44 on 2026-07-31.

**Then verify three rows by eye:**

| Part | Expect |
| --- | --- |
| `100985.2` | new record, T1 `108.40`, T2 `88.68`, Item_Status `Active` |
| `100684` | T1 `136.00`, T2 `99.86` (was 81.90 / 59.85) |
| `103006` | **T1–T9 all blank**, Item_Status `Bundled`, Quote_Warning `Included in 100985.2 — no separate charge; quote 100985.2 instead` |

⚠️ **Watch `103006` specifically.** Its prices must be *cleared*, and many CSV importers
skip empty cells on update rather than blanking the field. If after import `103006` still
shows 66.00 / 54.00, open the record and clear T1 and T2 by hand. Everything downstream
(picker exclusion, the Bundled badge, the PDF line) depends on those being empty.

Record count should go 44 → **45**.

## 3. Build `Pricelist_Meta` and import it  (new — form does not exist yet)

Creator has no field-creation API, so build it by hand:

1. Creator → QTS (Edit, Development) → Design → **New form `Pricelist_Meta`**
2. Add five **Single Line** fields, named exactly:
   `Pricelist_Version`, `Valid_From`, `Source_File`, `Source_SHA256`, `Imported_On`
3. Save. Confirm the report is named `Pricelist_Meta_Report`.
4. Import `deploy_ready/creator/imports/pricelist_meta_import.csv` → **1 record**
   (`1.0` / `July 2026` / the workbook filename / sha256 / `2026-08-03`).

If you skip this the app still runs: the widget chip shows `—` and the PDF falls back to
the old generic wording. Nothing breaks.

## 4. Paste two Deluge functions

Creator → QTS → **Workflow tab → Functions**. Open each, select all, replace entire script,
Save.

| Function | File |
| --- | --- |
| `fn_calc_line_price_draft` | `deploy_ready/creator/workflow/functions/fn_calc_line_price_draft.creator.deluge` |
| `fn_generate_pdf` | `deploy_ready/creator/workflow/functions/fn_generate_pdf.creator.deluge` |

Optional, only if you keep the debug variant in sync:
`fn_generate_pdf.debug.deluge` → the `fn_generate_pdf` debug function.

**If `fn_calc_line_price_draft` refuses to save with "Item is not defined":** the field's
internal link name is not `Item` (see step 1). Change the single line

```
item_status = ifnull(item.Item,"").toString().trim().toLowerCase();
```

to use the actual link name — most likely `item.Item_Status`. Then tell me so I can correct
the repo copy.

`fn_generate_pdf` reads `Pricelist_Meta`; if you skipped step 3 it still saves and falls
back cleanly.

## 5. Kit_Components — 2 functional record edits

Creator → QTS → **Kit_Components report**. Record count stays 42.

| Kit_Key | Change | Why |
| --- | --- | --- |
| `n3bms_cmu18` | `Component_SKU` **`103006` → `100985.2`**, Description → `n3-BMS CMU18 101814 wireharness kit (1000mm) Flatcable and ISO SPI` | vendor bundled the harness; the bare SKU is no longer priced |
| `n3bms_cmu12` | `Component_SKU` **`100683` → `100684`**, Description → `Compact shunt (500A/50mV)` | vendor swapped the never-priced 300A shunt for the priced 500A; clears the Q3 hold |

Also set `Confidence` on the `n3bms_cmu12` row from `pending_business` → `vendor_config`,
and clear its `Is_Blocked` / `Hold_Reason` if those fields carry values. That row is what
currently raises a "Pending business" warning on every n3-BMS/CMU12 quote.

Reference copy: `kit_bom/kit_components.csv` (seed JSON: `artifacts/kit_components_seed.json`).

### 5b. Six cosmetic description edits (optional, do if you want kit lines to match the catalog)

Vendor renamed three products. These are description-only — no behaviour change:

| SKU | Old description | New description | Appears in |
| --- | --- | --- | --- |
| `100816` | `n3-BMS MCU` | `n3-BMS Master Control Unit (MCU-PCBA)` | n3bms_cmu12, n3bms_cmu18 |
| `100987` | `LiBAL n3-BMS MCU wirekit` | `n3-BMS MCU Wire harness kit MCU (100816)` | n3bms_cmu12, n3bms_cmu18 |
| `100985.1` | `LiBAL n-BMS CMU12/2 100809 wireharness kit (1700mm) shielded com cable` | `n-BMS CMU12/2 100809 Wire harness kit (1700mm) shielded com cable` | nbms_cmu12, n3bms_cmu12 |

## 6. Upload the widget ZIP

`widget/dist/qts-quote-builder.zip` → Creator → QTS → the **QTS Quote Builder widget**
component → replace/re-upload. (Rebuilt 2026-08-03; verified byte-identical to
`widget/app/`.)

Adds: the Pricelist chip in the masthead, the non-blocking `Bundled` badge, and bundled
SKUs excluded from the part picker.

## 7. Smoke test in Development

1. Open the widget. Masthead should read **`Pricelist  v1.0 · July 2026`**.
2. Search the picker for `103006` → **no result** (bundled SKUs are hidden).
3. Search `100985.2` → present at **€108.40**.
4. Search `100684` → **€136.00**.
5. Build an n3-BMS CMU18 kit at 96 series cells → expect `100985.2` at qty 6 and **no**
   `103006` line.
6. Build an n3-BMS CMU12 kit → the shunt line is `100684`, and the quote should now say
   **"All clear"** rather than carrying a Pending-business warning.
7. Save + generate a PDF → footer should read
   *"Pricing based on Lithium Balance pricelist v1.0 (valid from July 2026). Subject to change after expiration."*

All seven of these already pass locally against Postgres in `local_qts`.

## 8. CRM Products — add `100985.2`  (Tier 2 — Bill's approval)

CRM Products is seeded 44/44 from Item_Master (`Product_Code` = `Part_Number`). CRM Quotes
reject products that are missing or inactive, so a quote containing `100985.2` will fail to
sync until this is added. Seed source: `artifacts/crm_products_seed.json` (now 45).

Leave `103006` in CRM Products as-is — old quotes still reference it.

## 9. Publish Development → Stage → Production

Creator dashboard → QTS → Environment → Publish to Stage → Publish to Production.

**Data does not travel between environments — only app design does.** So steps 2, 3, 5 and
8 (the record/data steps) must be **repeated in Production** after publishing. Steps 4 and 6
(Deluge + widget) carry across automatically.

---

## Summary

| # | Thing to replace | Type | Blocking? |
| --- | --- | --- | --- |
| 1 | Verify `Item_Status` field + its link name | check | **yes** |
| 2 | `item_master_import_FULL.csv` — 45 rows | CSV import | **yes** |
| 3 | `Pricelist_Meta` form + `pricelist_meta_import.csv` | new form + import | no |
| 4 | `fn_calc_line_price_draft`, `fn_generate_pdf` (+debug) | Deluge paste | **yes** |
| 5 | 2 Kit_Components record edits (+6 cosmetic) | record edit | **yes** |
| 6 | `qts-quote-builder.zip` | widget upload | **yes** |
| 7 | Smoke test | verify | — |
| 8 | CRM Products `100985.2` | CRM record (Tier 2) | for CRM sync |
| 9 | Publish Dev → Stage → Prod, then redo 2/3/5/8 in Prod | publish | **yes** |

Two open items to raise with Bryan before or alongside this: **D-P3** (the hidden
`300300`/`300500` rows stay excluded — never import them) and **D-P4** (the shunt swap is in
the vendor's config tab but not in their changelog). Both are in
`docs/PRICELIST_UPDATE_2026-07-01_V1.0.md`.


---

## What actually happened (2026-08-03)

Run notes, so the next revision goes faster.

| Step | Outcome |
| --- | --- |
| 1 | `Item_Status` exists, link name **`Item`** — matched the code, no edit needed. `Active` and `Quote_Warning` also present. |
| 2 | Clean 44 -> 45. **The import cleared `103006`'s prices on its own** — the feared blank-cell-skip did not happen. |
| 3 | Form built by hand. Two snags: the field was first created as `Valid_Form` (typo, renamed — Creator updated the link name too), and `Pricelist_Version` imported as `1` rather than `1.0`, needing a manual edit **in both environments**. |
| 4 | Both Deluge functions saved without error. |
| 5 | Two record edits; 5b (descriptions) deliberately skipped — Item_Master's description wins on the quote line, so kit descriptions are internal only. |
| 6 | Uploaded twice: r78, then r79 after the D-P5 status-flag fix. |
| 7 | Passed in Dev. Surfaced D-P5 (see the update doc). Autosave created a throwaway **QUOTE0035** in Dev. |
| 8 | `100985.2` created in CRM Products via the CRM API (id `6719186000004047001`). Two stale prices found there — see follow-ups. |
| 9 | Publish carried design only, as expected: `Pricelist_Meta` form arrived empty, Item_Master stayed at 44, Kit_Components unchanged. All three data steps repeated in Production. |

### Blocker hit in Production (pre-existing, unrelated to this revision)

The CMU18 kit failed with **"Kit data error: Channels Per CMU missing for SKU 101814"**.
Production's `Kit_Components` was missing `Channels_Per_CMU` on all three
`cmu_from_series_cells` rows — `n3bms_cmu18`/`101814`=**18**, `n3bms_cmu12`/`100809`=**12**,
`nbms_cmu12`/`100809`=**12**. Development had them. So all three CMU kits had been
non-functional in Production for some time and nobody had noticed. Set by hand.

**Take-away for next time:** publishing does not move records, so any hand-seeded table can
silently drift between environments. Reconcile Production `Kit_Components` against
`kit_bom/kit_components.csv` field-by-field — `Channels_Per_CMU` may not be the only gap.

### Follow-ups

- **DONE (second attempt)** — widget env pill no longer hardcoded.
  `detectCreatorEnvironment()` reads `envUrlFragment` from
  `ZOHO.CREATOR.UTIL.getInitParams()`; unknown/absent params stay neutral so the
  `local_qts` sandbox keeps its own label. **Needs one more ZIP upload to Dev and Production.**

  **First attempt was wrong and shipped briefly:** it used `document.referrer`, which inside
  the widget iframe reflects navigation *history* rather than the parent frame. Opening
  Production from a Development tab reported "development" and vice versa — the labels read
  exactly backwards. Do not use `document.referrer` to identify the Creator environment.
- **DONE** — CRM Products: `100684` -> 136.00; `103006` price cleared, renamed to the
  `n3-BMS` spelling, Description records the bundling. Left Active because existing quotes
  reference it.
- **DONE** — `scripts/kit_components_reconcile.py` added, so this class of drift is
  detectable instead of waiting for a kit to fail. Run it against a Production export.
- `QUOTE0035` (Development) — throwaway from the smoke test. Deleting records is Tier 3
  (Bill), so left in place.
- D-P3 (hidden-row exclusion) and D-P4 (shunt swap) still unconfirmed by Bill/Bryan.


---

## Environment drift check (run this quarterly, and after every publish)

```bash
# Creator -> Kit_Components report -> Export -> CSV, in EACH environment
python3 scripts/kit_components_reconcile.py ~/Downloads/Kit_Components_Report.csv
```

Exit 0 = Creator matches `kit_bom/kit_components.csv`. Exit 1 lists rows missing from
Creator, rows Creator has that the repo does not, and per-field mismatches. It reads both
Creator display headers ("Channels Per CMU") and repo link names ("Channels_Per_CMU").

This exists because publishing moves app design but not records, so Development and
Production diverge silently. It would have caught the missing `Channels_Per_CMU` values
years before a quote failed.
