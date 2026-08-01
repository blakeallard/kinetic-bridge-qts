# Writer JSON sample — `qts_writer_merge_sample.json`

Full path:

`/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/artifacts/qts_writer_merge_sample.json`

## What this JSON is for

Import / reimport as the **Writer Automate JSON data source** so you can map:

- top-level fields once: `payment_terms`, `contact_name`, totals, etc.
- **only** the `line_items` array as the repeat / subform source

## What JSON cannot fix

JSON shape does **not** stop `LINE ITEMS` / DESCRIPTION / QTY / UNIT PRICE / TOTAL from repeating by itself.

Those labels must be **plain text outside** the red/pink `line_items` repeat region in the template.  
Only `«line_items.name»` / `qty` / `unit_price` / `total` go **inside** the repeat.

## After import

1. Map Fields → `payment_terms` → `payment_terms` (or Payment Terms).
2. Subforms → repeat source = **`line_items`** (the array).
3. In the document: cut black **LINE ITEMS** bar + column headers **out** of the pink region; leave one data row inside.
4. Preview merge → one header block, two product rows.

## Live Email Quote Package

Flow still uses `build_quote_merge_payload` → `merge_data` (same keys). This file is for Writer UI import/preview, not a substitute for that CF.
