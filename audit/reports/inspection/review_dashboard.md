# Workbook Audit — Human Review Dashboard

Source: `workbook_audit.sqlite`.
Duplicate-row dispositions below are proposals only — **decision owner is Bill/Bryan**.
Vendor-discontinued SKUs below are documented as excluded from live import/quoting unless overridden.

## A. Audit totals

| Metric | Value |
|---|---|
| Workbook SHA-256 | `75e02db5d1a3e2c8a7ef0e5ab8e6d26aead6921e04de5182f572dc1402d439f9` |
| Sheets | 9 |
| Cells | 734 |
| Styles | 128 |
| Product rows | 46 |
| Priced / unpriced | 41 / 5 |
| Price points | 323 |
| Config rows | 49 |
| Status marks | 131 |

## B. Duplicate SKU review

| SKU | Sheet row | Visibility | Classification | Description | Band-1 price (EUR) |
|---|---|---|---|---|---|
| `300300` | 55 | hidden | EXCLUDE_CANDIDATE | c-BMS24X Unified SERVICE Tool |  |
| `300300` | 58 | visible | CANONICAL_CANDIDATE | c-BMS24X Unified Service Tool | 450.0 |
| `300500` | 54 | hidden | EXCLUDE_CANDIDATE | n-BMS Unified SERVICE Tool |  |
| `300500` | 60 | visible | CANONICAL_CANDIDATE | n-BMS Unified Service Tool | 450.0 |

Working assumption: hidden rows 54/55 are legacy rows to exclude; visible rows 58/60 are current canonical rows. This is pending Bill/Bryan confirmation and is not approved.

## C. Unpriced SKU review

| SKU | Description | Status evidence | Recommended handling |
|---|---|---|---|
| `101815` | n-BMS CMU18/4 Wire top mount isoSPI - 200mA balancing current DRAFT | New Item added | Hold as not-yet-released/non-quotable (DRAFT); Bill/Bryan decision required |
| `102100` | c-BMS18 | Discontinued | Excluded from live import/quoting by vendor discontinued status |
| `103005` | Harness kit for c-BMS18, for development purpose only | Discontinued | Excluded from live import/quoting by vendor discontinued status |
| `200400` | c-BMS18 Unified Creator License FULL | Discontinued | Excluded from live import/quoting by vendor discontinued status |
| `300400` | c-BMS18 Unified Service Tool | Discontinued | Excluded from live import/quoting by vendor discontinued status |

## D. Open decisions (Bill/Bryan)

1. Confirm or reject the duplicate-SKU working assumption encoded in `import_preview/duplicate_sku_classification.json`.
2. Decide final handling for unpriced/new/DRAFT SKU 101815.
3. Decide blank-tier behavior for LEM SKUs 000637, 000833, and 000876.
4. Resolve config-only part 100683 before kit-based quoting relies on it.
5. Decide Partner exposure and DKK support per the deployment runbook.
