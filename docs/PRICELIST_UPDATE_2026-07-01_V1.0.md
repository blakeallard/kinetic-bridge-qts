# Vendor pricelist update — 2026-07-01 (Version 1.0)

Source: `Lithium Balance BMS_July 01_RSP_Distributor.xlsx`, sha256
`a239e3bc22427a750079ae05070f4903ca40933a9b3034db13cb9a3668ca96b9`, pulled from
WorkDrive → `Shared with Me/Lithium Balance/BMS Pricelist/`. The previous repo reference
copy (sha256 `2efa866f…`) is archived alongside it as
`…_RSP_Distributor_pre_v1.0.xlsx`. The vendor workbook itself was not modified.

Unlike `KIT_CONFIG_UPDATE_2026-07-25.md` — which was a kit-configuration change only —
this revision changes **prices and SKUs**, so it touches Item_Master, the kit BOM, the
Deluge pricing path, the widget, and the Postgres mirror.

## What the vendor's `Changes_Log` says, and what it actually did

| Changelog line (batch dated 2026-07-01, "Version 1.0") | Actual effect in `RSP_EUR` |
| --- | --- |
| Removed pricing from 103600 | **`103006`** — all 9 tiers cleared; the band cell now reads `Included in 100985.2`. Was 66.00 / 54.00. |
| Added 100985.2, which includes 103600 wire harness kit for 101814 (CMU18) and an isoSPI cable | New SKU **`100985.2`** *n3-BMS CMU18 101814 wireharness kit (1000mm) Flatcable and ISO SPI* — **108.40** (1-19) / **88.68** (20-99). |
| Updated shunt pricing | **`100684`** *Compact shunt (500A/50mV)*: **81.90 → 136.00** (T1), **59.85 → 99.86** (T2). |
| Updated "n3-BMS w 101814" tab with the correct wire kit numbering | Config tab now lists `100985.2` where it listed `100985.1`. Product names normalised (`n3-BMS MCU` → `n3-BMS Master Control Unit (MCU-PCBA)`; `LiBAL n3-BMS MCU wirekit` → `n3-BMS MCU Wire harness kit MCU (100816)`). |
| Started versioning of pricelist | `RSP_EUR!B2` = `1.0`, `B5` = `Valid from July 2026`. Major revision = first digit, announced by email; minor = Partner Hub only. Major changes highlighted orange, minor dark blue. |

### `103600` is a vendor typo — do not create that SKU

The changelog says `103600` twice. The priced product row has always been **`103006`**,
and `103600` appears nowhere in either repo, in any Zoho record, or in git history. Every
downstream system correctly uses `103006`. Treat `103600` as a transposition in the
vendor's own changelog. This is exactly the failure mode an automated ingest would fall
for — see `PRICELIST_AUTO_INGEST_DESIGN.md` §"Guardrails".

### Undocumented change also present in the workbook

The `n3-BMS w 100809` config tab replaced **`100683`** (Compact shunt 300A/50mV) with
**`100684`** (500A/50mV). Not named in the changelog, but it resolves open question **Q3**:
`100683` was never in the RSP at all, so it had been carried as `pending_business` /
unquotable and blocked on every n3-BMS/CMU12 quote. Adopted — see D-P4.

## Structural gotcha: RSP_EUR rows shift by +4

The revision inserts four header rows above the product table (title, `Version`, blank,
colour legend). Every `RSP_EUR` product row moves down 4. Two consequences:

- `import_preview/duplicate_sku_classification.json` is row-pinned. The hidden legacy
  `300500`/`300300` "SERVICE Tool" rows moved **54 → 58** and **55 → 59**; canonical rows
  moved **58 → 62** and **60 → 64**. The importer fails loud on drift, so this file had to
  be updated in lockstep. Those hidden rows only *look* new — they are the same legacy
  bundle rows, and remain `EXCLUDE_CANDIDATE` pending Bill/Bryan.
- Config-tab row numbers did **not** change, so `kit_bom/kit_components.csv` `Source_Row`
  values stay valid.

The previous repo reference copy happened to have those two hidden rows blank, so the
duplicate path had never actually been exercised. It is now — see D-P3.

## Decisions

- **D-P1 — `103006` becomes `Item_Status=Bundled` (Blake, 2026-08-03).** Not
  `Discontinued` (the part still ships) and not left priced (that would contradict the
  vendor). The row stays `Active=Y` so quote history and manual lookups resolve; it
  carries `Quote_Warning = "Included in 100985.2 — no separate charge; quote 100985.2
  instead"`. New status value; the importer derives it from a literal `Included in <SKU>`
  in any price band, so the next such vendor change is handled automatically.
- **D-P2 — pricelist versioning implemented end to end (Blake, 2026-08-03).** New Creator
  form `Pricelist_Meta` + `public.pricelist_meta` in Postgres, shown in the widget
  masthead and merged into the quote PDF footer. Previously QTS had no way to say which
  pricelist a quote was priced from.
- **D-P3 — the Creator import files exclude `EXCLUDE_CANDIDATE` rows.** With the hidden
  rows back, importing every row would create two `Item_Master` records for `300300` and
  `300500`, and `fn_get_tier_price`'s `break` would pick whichever Creator returned first.
  The audit preview still lists all 47 rows; the four Creator-bound CSVs carry 45. The
  underlying hidden-vs-visible assumption is still **pending Bill/Bryan**.
- **D-P4 — adopt the `100683 → 100684` shunt swap (Blake, 2026-08-03).** Clears the Q3
  hold. Not named in the changelog, so flag it to Bryan if it looks wrong.
- **D-P5 — fix the never-assigned status flags (Blake, 2026-08-03).** Found during the
  Step 7 smoke test, **pre-existing and unrelated to this pricelist revision**:
  `not_released` and `discontinued` were defined as widget flag labels, given severity
  colours and counted in `warningTally()`, but **nothing ever assigned them**. Effect: a
  `Not_Released` part such as `101814` could go out on a quote reading "All clear",
  defeating the 2026-07-07 warn-and-double-check policy (R2). `mapItems` now records
  `Item_Status` per SKU and assigns the flags; `missingPriceFlag` also distinguishes a
  discontinued SKU from a genuinely unpriced one. Verified live: `101814` shows a
  NOT RELEASED badge in the picker and raises "1 warning to review".

## Implemented 2026-08-03 (repo + local Postgres; nothing deployed to Zoho)

`kinetic-bridge-qts`:

- `import_preview/generate_preview.py` — `Included in <SKU>` → `Item_Status=Bundled`
  detection; parses the version banner and emits `pricelist_meta_import.csv`; Creator
  CSVs now honour `EXCLUDE_CANDIDATE` and hard-fail if a duplicate `Part_Number` would
  still reach Creator; workbook resolver also looks in `<bevco>/data/references/…`
  (the 2026-07-31 restructure moved the reference library out of the repo).
- `import_preview/duplicate_sku_classification.json` — rows re-pinned +4, sha256 updated.
- Regenerated: all six `import_preview/` outputs (**47** audit rows, **45** Creator rows,
  41 priced, `Item_Status`: Active 37 / Bundled 1 / Discontinued 4 / Not_Released 2 /
  Obsolescent 3).
- `deploy_ready/creator/imports/` — `item_master_import_FULL.csv` and
  `…_CORRECTED.csv` refreshed (45 rows); new `pricelist_meta_import.csv`.
- `kit_bom/kit_components.csv` — 42 rows unchanged in count; `n3bms_cmu18` harness
  `103006 → 100985.2`; `n3bms_cmu12` shunt `100683 → 100684` with the hold cleared;
  vendor descriptions refreshed. `artifacts/kit_components_seed.json` and
  `artifacts/crm_products_seed.json` (45 products) regenerated.
- `scripts/kit_seed_prepare.py` — `EXPECTED["blocked"]` now empty.
- `scripts/kit_expand_sim.py` — assertions retargeted to `100985.2` / `100684`.
- `deploy_ready/creator/workflow/functions/fn_calc_line_price_draft.creator.deluge` —
  bundled branch: a `Bundled` item renders its vendor note instead of
  `[NO PRICE ON FILE - DO NOT QUOTE]`, and returns `bundled=true`.
- `deploy_ready/creator/workflow/functions/fn_generate_pdf.creator.deluge` (+ `.debug`) —
  `additional_notes` now cites the live pricelist version.
- `widget/app/widget.js` / `widget.html` / `widget.css` (+ packbay mirrors) — `bundled`
  flag (non-blocking), bundled SKUs kept out of the picker, `Pricelist_Meta_Report`
  loaded, masthead "Pricelist" chip. ZIP rebuilt.
- Tests: `tests/test_deploy_imports.py` +2 tests pinning every v1.0 value;
  `widget/tests/widget_state_test.js` +7 checks (258 pass).

`kinetic-quote`:

- `supabase/migrations/20260803120000_add_pricelist_meta_and_v1_0_catalog.sql` — new
  `pricelist_meta` table seeded with v1.0, plus the four catalog/BOM changes.
- `supabase/seed.sql`, `data/item_master_report.csv`, `data/qts_live/Item_Master_Report.json`,
  `data/qts_live/Kit_Components_Report.json` — the 2026-07-18 snapshots still carried
  `100985.1` on `n3bms_cmu18` and the old shunt price, so a `db reset` would have silently
  regressed both this change **and** the 2026-07-25 Q2 fix. Corrected. Historical
  `crm_bridge` response payloads were deliberately left untouched — they are records of
  past quotes, not catalog state.

### Pricing behaviour for a Bundled line

`fn_get_tier_price` returns its `-1` sentinel (unchanged — a fully blank row already
behaved correctly). `fn_calc_line_price_draft` now checks `Item_Status`; when it reads
`bundled` the line renders `[INCLUDED IN 100985.2 — NO SEPARATE CHARGE] <description>` at
unit 0 / line total 0 instead of the `DO NOT QUOTE` marker. In the widget the line carries
a `bundled` badge that is **not** counted by `warningTally()`, so it does not block Save or
Send the way an `unpriced` line does. Bundled SKUs are excluded from the part picker, so
the only way to see one is an older quote that already references it.

## Still to do

- Creator: build the `Pricelist_Meta` form (5 Single Line fields) — Creator has no
  field-creation API. Then import the three CSVs and paste the three Deluge files.
  See `docs/DEPLOYMENT_MAP.md`.
- **Deluge field-name trap:** `fn_calc_line_price_draft` reads `item.Item` — the
  `Item_Status` field's Creator internal link name is `Item` (the widget already handles
  both). If the paste errors with "Item is not defined", swap that one line to
  `item.Item_Status`.
- CRM Products module needs `100985.2` seeded (currently 44/44 from Item_Master) — Tier 2,
  Bill's approval.
- Flag to Bryan: D-P4 (shunt swap) and the still-unconfirmed D-P3 hidden-row assumption.
- `Distrib discount` gained a distributor row (*Inventechs, UAE*). No app change — QTS
  models discount **bands** (`Price_Rules` / `fn_get_discount`), not the distributor list.
