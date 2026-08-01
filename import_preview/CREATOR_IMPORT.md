# Item_Master Creator import — Tier_Scheme fix

## Why you saw 44× `Invalid column value for Tier_Scheme` (Invalid value blank)

Creator received an **empty** Tier_Scheme (or a value not in the dropdown). Common causes:

1. Importing the **audit** preview (extra `Source_*` / `Review_*` columns) → Tier_Scheme maps blank  
2. Live dropdown choices are **not** exactly `hardware` / `license`  
3. Tier_Scheme is **required** and rejects blank / unknown choices  

Deluge accepts any case (`hardware` / `Hardware` / `LICENSE`) after `.toLowerCase()`, but **import only accepts exact dropdown labels**.

## Import these (in order)

### 1) Restore prices first (skip Tier_Scheme column)

**File:** `item_master_import_for_creator_no_tier_scheme.csv`

- No `Tier_Scheme` column at all  
- Has Part_Number, Description, Category (`BMS`/`Accessory`/`Software`), Discountable (X→Y), prices  
- On map screen: **do not map anything to Tier_Scheme**  
- Update by Part_Number  

This should clear the UNPRICED / empty catalog problem.

### 2) Fix Tier_Scheme dropdown in Creator (2 minutes)

Item_Master form → field **Tier_Scheme** → Choices must be **exactly** one of these pairs:

| Option A (preferred) | Option B |
| -------------------- | -------- |
| `hardware` | `Hardware` |
| `license` | `License` |

Field should be **optional** (not required).

### 3) Re-import Tier_Scheme + full row

Use the matching file:

| Dropdown choices | File |
| ---------------- | ---- |
| `hardware` / `license` | **`item_master_import_for_creator.csv`** |
| `Hardware` / `License` | **`item_master_import_for_creator_tier_titlecase.csv`** |

Map **Tier_Scheme → Tier_Scheme** by name. Confirm the preview column shows `hardware`/`license` (or title case), not blank.

## Do not import

`item_master_import_preview.csv` — audit only (extra columns cause this exact Tier_Scheme failure).

## Quick check after import

Open Item_Master `100916` → Price_T1 = 330, Discountable = Y, Category = BMS.  
Open `200100` → Tier_Scheme = license (or License), Price_T1 = 1700.
