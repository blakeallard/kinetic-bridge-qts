# QC: Local Lithium Balance Reference Files vs Prior n-BMS/c-BMS24 Price Finding — BI1-T71

Zoho Task ID: `2543412000001469015`
Review date: 2026-07-03
Scope: Repo-only + local filesystem read-only analysis. No Zoho records modified, no import performed, no business decisions made.

**Path note**: The directory named in this task, `/Users/blakeallard/bevco/references/lithium_balance`, does not exist. The actual local reference directory (matching the same name and content the task describes) is `/Users/blakeallard/bevco/data/references/lithium_balance`. That is the directory reviewed below.

**Scope note on the April 26 pricelist**: Per explicit instruction during this session, `Lithium Balance BMS Pricelist_April 26 Distributor.xlsx` was excluded from analysis — July 01 is confirmed the most up-to-date price sheet and is the only pricelist workbook opened for this report.

---

## Executive answer

**Local references CONFIRM the prior finding, and upgrade it from "cannot confirm cause" to "cause directly documented."** Opening the actual `Lithium Balance BMS_July 01_RSP_Distributor.xlsx` workbook (now available locally) and reading its raw `RSP_EUR` cell data byte-for-byte confirms:

- **n-BMS and c-BMS24 Creator License FULL pricing (SKU 200500 vs 200200) is identical at every tier** — directly present in the source cells, not an import-preview artifact.
- **n-BMS and c-BMS24 Service Tool pricing (SKU 300500 unit row vs 300200) is identical at every tier** — same confirmation.
- The workbook's own `Changes_Log` sheet contains an explicit, dated entry — **"Added Creator/Service Unified version"** (change batch dated 2024-09-01) — which is direct vendor documentation that this cross-family price identity is an **intentional vendor pricing decision**, not a mapping error, not an import-preview normalization artifact, and not a wrong-file/version issue.

---

## Prior finding summary (from `docs/LIBAL_NBMS_CBMS24_PRICE_QC.md`)

That review could not access a pricelist through the two WorkDrive folder links given at the time ("n-BMS" and "C BMS" folders, both engineering/documentation trees with no pricing file). It concluded identical pricing was "confirmed present" only by inspecting the repo's already-generated `import_preview/item_master_import_preview.csv`, and flagged as unresolved whether that traced back genuinely to the vendor source or to some parsing artifact, since the raw `.xlsx` itself hadn't been opened directly in that session.

This session closes that gap: the actual `.xlsx` is now available locally and was opened directly.

---

## Local files reviewed

Full inventory of `/Users/blakeallard/bevco/data/references/lithium_balance/` (78 files, `.DS_Store` excluded):

| Path (relative to `lithium_balance/`) | Type | Product family | Date/version signal | Content |
|---|---|---|---|---|
| `BMS Pricelist/Lithium Balance BMS_July 01_RSP_Distributor.xlsx` | xlsx, 9 sheets | All families (combined) | "Valid from July 2026" (RSP_EUR cell), Changes_Log latest batch dated 2026-06-01 | **Pricing** — see below |
| `Lithium Balance BMS Pricelist_April 26 Distributor.xlsx` | xlsx | All families (combined) | April 26 (filename) | **Excluded from analysis per instruction** — not opened this session |
| `Lithium Balance BMS presentation 202604 CUSTOMER - with NDA.pptx` | pptx | All families | 202604 (filename) | Customer-facing sales presentation, not opened (not a pricing source) |
| `i-BMS/LiBAL-i-BMS15-20230808.pdf` | PDF | i-BMS | 2023-08-08 | Datasheet |
| `n-BMS/LiBAL-n-BMS.pdf` | PDF | n-BMS | — | Datasheet |
| `n-BMS/NDA_only/LiBal-nBMS_Harnesses.zip` | zip | n-BMS | — | Harness archive (not opened — binary archive, not pricing) |
| `n-BMS/NDA_only/n_CMU CAD/*.stp` (2 files) | CAD | n-BMS | — | Mechanical CAD |
| `n-BMS/NDA_only/n_MCU CAD/*.stp` | CAD | n-BMS | — | Mechanical CAD |
| `n-BMS/NDA_only/n_MCU to CMU harnesses/*.pdf` (7 files) | PDF | n-BMS | Various REV letters | Cable/harness drawings |
| `n-BMS/NDA_only/more/nBMS_2_6_0/**` (BMS_Creator, Firmware, User_manual&releasenotes) | PDF/MSI/BIN | n-BMS | firmware v2.6.0, manual v1, release notes dated 20260529 | Firmware/manuals, not pricing |
| `n3-BMS/LiBAL-n3-BMS.pdf` | PDF | n3-BMS | — | Datasheet |
| `n3-BMS/NDA_only/**` (P3.8_MBD_Release tree — CAD, firmware, XML config maps, manuals, safety manual, app notes) | Mixed | n3-BMS | P3.8.0 release | Engineering/firmware, not pricing |
| `REF/C BMS/*` (6 files: user manual, release notes, temp-sensor calc xlsx, Creator/website PDFs, datasheet) | PDF/xlsx | c-BMS24 | 2019–2021 | Manuals/datasheets, no pricing (`BMS_Steinhart_TempSensor_Calc.xlsx` is a thermistor-curve calculator, not a pricelist) |
| `REF/I BMS/i-BMS15_Manual_V.1.1.pdf`, `i-BMS15_UserManual_v2.7.2f.pdf`, `LiBAL i-BMS15 datasheet 20210702.pdf` | PDF | i-BMS | Various | Manuals/datasheet |
| `REF/I BMS/Quotation_5233_LiTHIUM BALANCE A S.PDF` | PDF | i-BMS | Quoted 2021-09-16 | **Historical customer quote** — see below |
| `REF/N BMS/18APR2022_Evolectric_N3 BMS Quote.pdf` | PDF | n3-BMS | Quoted 2022-04-18 | **Historical customer quote** — see below |
| `REF/N BMS/LiBAL-n-BMS_100801-20193012.pdf`, `LiBAL-n-BMS_100808_20200221-1.pdf`, `LiBAL-n-BMS-CREATOR.pdf`, `LiBAL-n-BMS-High-Voltage-website-product-presentation.pdf` | PDF | n-BMS | 2019–2020 | Datasheets/presentation |
| `REF/S BMS/*` (4 files), `REF/S BPU/*` (2 files) | PDF | s-BMS / s-BPU | Various | Datasheets |

---

## Files containing pricing

Only **one** file in the entire local reference tree contains a structured, machine-readable pricelist:

- **`BMS Pricelist/Lithium Balance BMS_July 01_RSP_Distributor.xlsx`**, sheet `RSP_EUR` — this is confirmed (by direct sheet-name match against `import_preview/generate_preview.py`'s `DEFAULT_XLSX`/`SHEET_NAME` constants) to be the exact source already used to generate this repo's `import_preview/` outputs.

The two historical customer quote PDFs (`Quotation_5233`, `18APR2022_Evolectric_N3 BMS Quote.pdf`) contain **actual transacted unit prices**, but neither is directly comparable to the current question:
- Quotation 5233 (2021, USD, i-BMS15): line items are SKU 100916 (i-BMS15 board, $357.31), 100980 (wire harness, $148.88), and **100910.99** (i-BMS Creator/Manual/5h support SOFTKEY FULL, $1,840.14) — this SKU (`100910.99`) does not exist in the current July 2026 RSP or `Item_Master` import preview at all, and the price is in 2021 USD with no currency/date basis for comparison to 2026 EUR list prices.
- Evolectric quote (2022, USD, n3-BMS): line items are all n3-BMS **hardware** (MCU, CMU, harnesses) — no Creator License or Service Tool line item present, so it provides no evidence either way on the software/license pricing question.

Neither quote changes or contradicts the RSP_EUR finding; they are too old, in a different currency, and (for the i-BMS quote) reference a SKU no longer in the current pricelist.

## Files not containing pricing

Everything else in the tree: all datasheets, user manuals, release notes, CAD (`.stp`), firmware (`.bin`, `.msi`), config XML maps, safety manuals, application notes, the sales presentation, and the `BMS_Steinhart_TempSensor_Calc.xlsx` (a thermistor Steinhart-Hart coefficient calculator, unrelated to pricing — confirmed by sheet purpose, not opened in detail since the filename and known prior instance of this exact file are unambiguous).

---

## n-BMS vs c-BMS24 pricing conclusion

**Confirmed identical, confirmed intentional.** Raw `RSP_EUR` cells (read directly from the xlsx XML, not via the repo's parser) for the relevant rows:

| Row | SKU | Description | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|---|---|
| 45 | 200200 | c-BMS24 Unified Creator License FULL | 1700 | 1275 | 1105 | 850 | 595 | 425 |
| 48 | 200500 | n-BMS Unified Creator License FULL | 1700 | 1275 | 1105 | 850 | 595 | 425 |
| 57 | 300200 | c-BMS24 Unified Service Tool | 450 | 337.5 | 292.5 | 292.5 | 225 | 157.5 |
| 60 | 300500 | n-BMS Unified Service Tool (unit row) | 450 | 337.5 | 292.5 | 292.5 | 225 | 157.5 |

Every value matches exactly, cell for cell, between the two families for both SKU pairs.

**Cause, directly evidenced**: the workbook's `Changes_Log` sheet records dated change batches (Excel serial dates decoded: 2023-03-01, 2024-03-01, 2024-09-01, 2025-09-01, 2026-06-01). The 2024-09-01 batch includes the line **"Added Creator/Service Unified version"**. Read together with the fact that Creator License and Service Tool prices are identical across i-BMS, c-BMS24, c-BMS24X, and n-BMS (only n3-BMS differs, priced higher — rows 49/61: 2415/... and 625/...), this is direct vendor documentation that Lithium Balance deliberately unified Creator/Service software pricing across these product-family variants at that revision. This is **not** a duplicate-SKU mapping error, **not** an import-preview normalization artifact (the repo's parser does no cross-row copying — confirmed previously by reading `generate_preview.py` in full), and **not** a wrong-file/version issue (this is the current, confirmed-latest RSP file).

Hardware SKUs remain genuinely different between families, as before (e.g., row 24 SKU 100924 c-BMS24 = 305.76 EUR T1 vs row 11 SKU 100800 n-BMS MCU = 506.00 EUR T1) — no hardware SKU number is shared between the two families' sections of the sheet.

---

## Duplicate SKU findings (300300 / 300500)

Both duplicates are confirmed present directly in the raw `RSP_EUR` source (not an import-preview artifact):

| Row | SKU | Row type | T4 | T5 | T6 |
|---|---|---|---|---|---|
| 54 | 300500 | **bundle-style** row (n-BMS Unified SERVICE Tool) | 3500 | 5900 | 9800 |
| 55 | 300300 | **bundle-style** row (c-BMS24X Unified SERVICE Tool) | 3500 | 5900 | 9800 |
| 58 | 300300 | **unit-price** row (c-BMS24X Unified Service Tool) | 292.5 | 225 | 157.5 |
| 60 | 300500 | **unit-price** row (n-BMS Unified Service Tool) | 292.5 | 225 | 157.5 |

**New evidence found this session, not previously available**: the `Changes_Log` sheet's most recent change batch (dated 2026-06-01, i.e. the revision immediately preceding this July 2026 RSP) explicitly states: **"Removed bundle prices for service."** The bundle-style rows (54, 55) are still present in the delivered `RSP_EUR` sheet despite the vendor's own changelog stating they were removed. This is a direct, evidence-backed indication that **rows 54 and 55 (the bundle-style prices) are stale leftover data that should have been deleted per Lithium Balance's own stated intent**, and that the unit-price rows (58, 60 — which also match c-BMS24/i-BMS Service Tool pricing exactly) are the intended current price.

This is evidence supporting a conclusion, not a decision made on Bill/Bryan's behalf — final confirmation should still come from them, but the ambiguity is no longer "unknown which row is correct," it is "vendor's own changelog says the bundle row should already be gone."

---

## Unpriced SKU findings

All 5 previously flagged unpriced SKUs are confirmed genuinely unpriced in the raw `RSP_EUR` source cells — this is not a parsing gap:

| SKU | Row | Raw cell content |
|---|---|---|
| 101815 | 17 | Literal text `"Not priced"` in every tier cell (T1–T9) — explicit vendor labeling |
| 102100 | 26 | No price cells present at all (row ends after description) |
| 103005 | 27 | No price cells present at all |
| 200400 | 47 | No price cells present at all |
| 300400 | 59 | No price cells present at all |

No local reference file (datasheet, manual, historical quote, or any other document reviewed) contains pricing for any of these 5 SKUs. They remain unresolved by anything available locally.

---

## Import preview mismatch findings

None found. Every value pulled directly from the raw `RSP_EUR` XML in this session (Creator License/Service Tool identical-pricing rows, the 300300/300500 duplicate rows in both forms, and all 5 unpriced SKU rows) matches exactly what `import_preview/item_master_import_preview.csv` and `import_preview_report.md` already report. The repo's import preview is an accurate, non-lossy representation of the source workbook for every row checked.

One additional stray-cell detail reconfirmed directly in the raw XML: row 48 (SKU 200500) has a trailing value `47` beyond the last price column — this matches the "ignored stray cell" note already logged in `import_preview_report.md` for that row.

---

## Contradictions found

One, internal to the vendor's own workbook (not a contradiction introduced by this repo or its import preview): the `Changes_Log` sheet states bundle prices for Service Tool were removed in the most recent (2026-06-01) revision, but the `RSP_EUR` sheet delivered in this same July 2026 file still contains two bundle-style Service Tool rows (SKU 300300 and 300500). See "Duplicate SKU findings" above.

---

## Business questions still needed for Bill/Bryan

1. **Confirm bundle-row cleanup**: Given the vendor's own changelog says bundle Service Tool pricing was removed, can Bill/Bryan confirm with Lithium Balance that rows 54/55 (bundle-style 300300/300500) are stale and only the unit-price rows (58/60) should be imported? This now has direct supporting evidence, not just ambiguity.
2. **Confirm intentional cross-family software pricing**: Can Bill/Bryan confirm that unified Creator License/Service Tool pricing across i-BMS/c-BMS24/c-BMS24X/n-BMS (all identical, only n3-BMS priced higher) is the current, intended commercial policy — matching the vendor's own "Added Creator/Service Unified version" changelog entry?
3. **Unpriced SKUs unresolved**: 101815, 102100, 103005, 200400, 300400 remain unpriced in every source reviewed (including now the direct raw workbook). Should these be excluded from import, imported as non-quotable placeholders, or does Bill/Bryan need to request updated pricing from Lithium Balance directly?
4. **SKU 100910.99** appeared in the 2021 historical i-BMS quote (Creator/Manual/5h support SOFTKEY FULL) but does not exist anywhere in the current July 2026 RSP or Item_Master import preview — confirm whether this SKU was retired/renamed, and if so to what current SKU, in case any legacy customer references it.

---

## Safe next step before Item_Master import

Send Bill/Bryan the two now-evidenced, narrowly-scoped confirmations from questions 1 and 2 above (bundle-row cleanup and intentional unified software pricing) — both are now backed by direct quotes from the vendor's own `Changes_Log` sheet, so this is a fast yes/no confirmation rather than an open investigation, and resolves the single largest remaining ambiguity (the 300300/300500 duplicate) before Item_Master import proceeds.
