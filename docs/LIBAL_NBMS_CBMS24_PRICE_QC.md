# QC: LiBal n-BMS vs c-BMS24 Pricing Equivalence — BI1-T71

Zoho Task ID: `2543412000001469015`
Review date: 2026-07-03
Scope: Repo-only analysis + read-only WorkDrive folder inspection. No Zoho records modified, no import performed, no business decisions made.

---

## Executive answer

**Cannot confirm from the two linked WorkDrive folders** — neither contains a pricelist file; both are engineering/technical documentation trees (datasheets, CAD, firmware, manuals).

**However, identical n-BMS vs c-BMS24 pricing IS confirmed present** in the actual pricing source already used by this repo's import preview (`Lithium Balance BMS_July 01_RSP_Distributor.xlsx`, sheet `RSP_EUR`) — for specific **Software (Creator License, Service Tool)** SKUs only. This was verified by direct inspection of `import_preview/item_master_import_preview.csv`, which is a mechanical, non-normalizing parse of the raw source cells (confirmed by reading `generate_preview.py` — it does 2-decimal rounding only, no cross-row copying or averaging that could fabricate equal values). **Hardware** SKUs for n-BMS and c-BMS24 do not share part numbers and are priced differently, as expected for distinct physical products.

---

## Source files reviewed

**From the two WorkDrive links provided:**

| Folder link given | WorkDrive folder name | Direct contents found | Pricelist present? |
|---|---|---|---|
| `.../4xjwd2024093ea2604937a9811aff31a0c166` | **n-BMS** (created by Bill Beverley, Jun 16) | 1 subfolder (`NDA_only`) + 1 file (`LiBAL-n-BMS.pdf`, product datasheet, modified 2026-05-11) | No |
| `.../4xjwdea3f216de2304390b84aa7c628649fd3` | **C BMS** (created by Bill Beverley, Jun 16) | 6 files, 0 subfolders — all product manuals/datasheets: `c-BMS_User_Manual_2_5_0_v003.pdf`, `c-BMS_2_5_4_Release_Notes.pdf`, `BMS_Steinhart_TempSensor_Calc.xlsx`, `LiBAL-c-BMS-CREATOR.pdf`, `LiBAL-c-BMS-Low-Voltage-website-product-presentation.pdf`, `LiBAL-c-BMS24_20190128.pdf` (dated 2019–2021) | No |

Traced deeper into `n-BMS → NDA_only` (3 levels): `NDA_only` contains subfolders `more`, `n_CMU CAD`, `n_MCU CAD`, `n_MCU to CMU harnesses`, plus `LiBal-nBMS_Harnesses.zip`. `more` contains a single subfolder `nBMS_2_6_0` (firmware-release-style folder, 33 MB, 6 files/3 subfolders). No pricelist or spreadsheet resembling a distributor price sheet found at any level traversed. `C BMS` was fully enumerated (0 subfolders) with no pricing file present. Traversal was stopped at this depth as a reasonable, evidence-based conclusion that these two WorkDrive locations are engineering/CAD/firmware documentation libraries, not the pricing source — not because access was denied.

**From the repo (already-generated pricing artifacts, per `STATUS.md`/`QTS_PROJECT_STATUS.md` required reading):**

| File | Role |
|---|---|
| `import_preview/generate_preview.py` | Parser script. Confirms actual source workbook name: **`Lithium Balance BMS_July 01_RSP_Distributor.xlsx`**, sheet `RSP_EUR` (comment at top of script + `DEFAULT_XLSX` path). This is a single combined workbook covering all product families (BMS boards, Accessories, Creator Tool, Service Tool, obsolete-BMS software) in one sheet — **not** separate per-family files. |
| `import_preview/item_master_import_preview.csv` | Mechanically parsed output — 47 data rows including header. Used for line-by-line comparison below. |
| `import_preview/import_preview_report.md` | Narrative report — already documents the 300300/300500 duplicate-SKU issue and 5 unpriced SKUs (previously reviewed in the BI1-T71 readiness review). |

The raw `.xlsx` itself is git-ignored (`*.xlsx` in `.gitignore`) and not committed to this repo; the CSV/report are the only queryable artifacts of it.

---

## Comparison table (Software SKUs shared in pricing structure across n-BMS / c-BMS24 / c-BMS24X / i-BMS)

All prices EUR, from `item_master_import_preview.csv`, `Tier_Scheme = license` (bands: 1 / 2 / 3-4 / 5-9 / 10-24 / 25-249):

| Product family | SKU | Description | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|---|---|
| i-BMS | 200100 | i-BMS Unified Creator License FULL | 1700.00 | 1275.00 | 1105.00 | 850.00 | 595.00 | 425.00 |
| **c-BMS24** | **200200** | **c-BMS24 Unified Creator License FULL** | **1700.00** | **1275.00** | **1105.00** | **850.00** | **595.00** | **425.00** |
| c-BMS24X | 200300 | c-BMS24X Unified Creator License FULL | 1700.00 | 1275.00 | 1105.00 | 850.00 | 595.00 | 425.00 |
| **n-BMS** | **200500** | **n-BMS Unified Creator License FULL** | **1700.00** | **1275.00** | **1105.00** | **850.00** | **595.00** | **425.00** |
| n3-BMS | 200600 | n3-BMS Unified Creator License FULL | 2415.00 | 1811.25 | 1569.75 | 1207.50 | 845.25 | 603.75 |
| i-BMS | 300100 | i-BMS Unified Service | 450.00 | 337.50 | 292.50 | 292.50 | 225.00 | 157.50 |
| **c-BMS24** | **300200** | **c-BMS24 Unified Service Tool** | **450.00** | **337.50** | **292.50** | **292.50** | **225.00** | **157.50** |
| c-BMS24X (unit row) | 300300 | c-BMS24X Unified Service Tool | 450.00 | 337.50 | 292.50 | 292.50 | 225.00 | 157.50 |
| **n-BMS (unit row)** | **300500** | **n-BMS Unified Service Tool** | **450.00** | **337.50** | **292.50** | **292.50** | **225.00** | **157.50** |
| n3-BMS | 300600 | n3-BMS Unified Service Tool | 625.00 | 468.75 | 406.25 | 403.13 | 303.13 | 215.62 |

**Bolded rows (200200/200500 and 300200/300500) are the direct c-BMS24-vs-n-BMS comparison the task asked for: prices are identical, cell-for-cell, at every published tier.**

For contrast — Hardware SKUs where n-BMS and c-BMS24 do **not** share part numbers and are priced differently (as expected for different physical boards), `Tier_Scheme = hardware` (bands: 1-19 / 20-99 / 100-259 / 260-499 / 500-999 ... 10000-24999):

| Family | SKU | Description | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|---|---|
| n-BMS | 100800 | MCU-PCBA with CAN termination | 506.00 | 381.15 | 266.20 | 254.10 | 249.48 |
| n-BMS | 100809 | CMU12/2 top mount isoSPI | 200.00 | 165.00 | 145.00 | 93.50 | 85.00 |
| c-BMS24 | 100924 | c-BMS24 | 305.76 | 184.80 | 172.48 | 154.00 | 147.00 |
| c-BMS24X | 100925 | c-BMS24X | 365.00 | 210.00 | 196.00 | 183.75 | 175.00 |

No hardware SKU number is shared between n-BMS and c-BMS24 sections of the source sheet, and no hardware price coincidentally matches across the two families.

---

## Discrepancies table

| # | Item | Discrepancy | Evidence |
|---|---|---|---|
| 1 | SKU 300300 | Appears **twice** in the source sheet under two different descriptions/pricing structures: a "bundle-style" row (`3500.00 / 5900.00 / 9800.00` in bands T4-T6 only) and a "unit-price" row (`450.00 ... 157.50` in T1-T6, identical to c-BMS24/n-BMS/i-BMS Service Tool pricing). | `item_master_import_preview.csv` rows for SKU 300300 (2 rows), flagged `DUPLICATE_SKU` in `import_preview_report.md`. |
| 2 | SKU 300500 | Same duplicate pattern as 300300 — bundle row (`3500/5900/9800`) + unit row (`450...157.50`, identical to c-BMS24 Service Tool). | Same CSV/report, SKU 300500 (2 rows). |
| 3 | n-BMS vs c-BMS24 Creator License FULL (200500 vs 200200) | **No discrepancy — confirmed identical** at every tier. | CSV rows 200200 and 200500. |
| 4 | n-BMS vs c-BMS24 Service Tool unit-price row (300500 vs 300200) | **No discrepancy — confirmed identical** at every tier. | CSV rows 300200 and 300500 (unit row only, not the bundle row). |
| 5 | WorkDrive links provided | Neither folder contains the RSP pricelist at all. | Direct folder listing, see Source files table above. |

---

## Possible cause (per the 6 required categories)

1. **Truly present in the source files** — YES, for the Creator License FULL and Service Tool identical pricing (items 3–4 above). The parser (`generate_preview.py`) does no cross-row normalization; it reads raw cell text and rounds to 2 decimals. Identical output values across different SKU rows can only come from identical input cells in the source workbook. This looks like **intentional vendor licensing pricing** — LiBal appears to price the Creator License and Service Tool the same across n-BMS, c-BMS24, c-BMS24X, and i-BMS (only n3-BMS is priced higher), which is plausible for software/license products vs. physical hardware boards.
2. **Caused by duplicate SKU mapping** — YES, but only for 300300/300500 specifically (item 1–2 above), and that's a **within-family** duplication (two rows for the same nominal SKU), not a cross-family (n-BMS vs c-BMS24) mapping error.
3. **Caused by import-preview normalization** — NO. Confirmed by reading the full parser script: no logic exists that would copy or average values across rows.
4. **Caused by wrong source file/version** — Cannot rule out entirely, since the two WorkDrive folders linked in this task do not contain the pricelist and could not be cross-checked against the RSP workbook actually used. The RSP workbook's provenance (whether it's the latest agreed version, whether it was itself derived correctly from LiBal's official distributor pricelist) is outside what's checkable from files available in this session.
5. **Caused by missing product-family distinction** — Possibly, but only as a modeling question, not a data-corruption question: the source pricelist itself does not distinguish Creator License / Service Tool pricing by product family (same price for n-BMS/c-BMS24/c-BMS24X/i-BMS). If Bill/Bryan intended these to be priced differently by family, that's a **vendor pricelist / business decision gap**, not a bug in this repo's parsing or import-preview generation.
6. **Unable to be determined from available files** — the ultimate provenance/correctness of the underlying vendor pricelist (i.e., whether LiBal's actual official distributor terms really do set identical Creator License/Service Tool pricing across families, or whether this is itself a vendor typo) cannot be confirmed from anything accessible in this review — the two WorkDrive links given don't hold a pricelist, and no independent LiBal price list matching the "n-BMS" or "c-BMS24" WorkDrive folder names was found to cross-check against.

---

## Business questions for Bill/Bryan

1. Are the two WorkDrive folders linked in this task (`n-BMS`, `C BMS`) actually where LiBal pricing documents are expected to live, or is the July 2026 RSP workbook (`Lithium Balance BMS_July 01_RSP_Distributor.xlsx`) sourced from somewhere else entirely? If pricing should live in one of these two folders, none was found there as of this review.
2. Is it confirmed/expected that **Creator License FULL** and **Service Tool** pricing is genuinely identical across n-BMS, c-BMS24, c-BMS24X, and i-BMS (with only n3-BMS priced higher)? If so, this is just how LiBal licenses software — not a data error. If not, which family's price is authoritative and which needs correcting?
3. For SKU 300300 and 300500 specifically (each appearing as both a bundle-price row and a unit-price row) — which row is the sellable line item? (This duplicate issue was already flagged in the prior BI1-T71 readiness review and remains unresolved.)
4. Is there a newer or different LiBal distributor pricelist (possibly living in one of the two WorkDrive folders under a subfolder not yet reviewed, e.g. `n_CMU CAD`, `n_MCU CAD`, `n_MCU to CMU harnesses`, `nBMS_2_6_0`) that should supersede the July 2026 RSP workbook already in use?

---

## Safe next step

Ask Bill/Bryan directly where the authoritative LiBal distributor pricelist is stored (WorkDrive path, filename) and whether Creator License/Service Tool pricing is intentionally uniform across BMS product families — this is a pure information-gathering question with no code, Zoho, or import risk, and it resolves both the "wrong source file" uncertainty (cause #4) and the missing-family-distinction question (cause #5) in one pass.
