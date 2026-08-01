# Writer fields JSON (the one Blake meant)

**Full path:**

`/Users/blakeallard/bevco/repos/kinetic-bridge-qts/artifacts/qts_writer_fields_sample_v2.json`

**Original (qts-quote-builder):**

`/Users/blakeallard/bevco/qts-quote-builder/reference/qts_writer_fields_sample_v2.json`

## Why the TEST-QUOTE0026 PDF looked awful

That PDF used **`line_items_block`** — a single text field that looks like:

```text
1. n3-BMS MCU
      Qty 5  x  $868.97   =   $4,344.83
```

That key is **in this JSON on purpose** (legacy ONE_BOX / text layout).  
It must **not** be placed in the table Description column.

For the **table** template (`qts_quote_template_v4`):

| Use | Field |
| --- | ----- |
| Table rows | `line_items` subform → `name` / `qty` / `unit_price` / `total` |
| Do not put in table | `line_items_block` |
| Payment terms line | `payment_terms` |

## Import into Writer

Automate → Data source → JSON → import this file → map fields → Save.  
Then confirm the data row cells are `«line_items.name»` etc., not Line Items Block.

## If Preview Merge is blank

Your **SUBFORMS** mapping (Line Items → `line_items`, name/qty/unit_price/total → Description/Qty/Unit Price/Total) is correct.

Blank values usually mean the JSON row keys didn’t match the imported field ids. This file now uses short keys inside each row:

```json
"line_items": [{ "name": "...", "qty": "...", "unit_price": "...", "total": "..." }]
```

1. Re-import this updated JSON (replace data source again).
2. **Main Fields** tab → every row green (including `payment_terms`).
3. **SUBFORMS** → same mappings as before → Save.
4. Preview merge → pick the sample record (Dana / TEST-QUOTE0002).

Still blank? Document chips may be orphaned — click into each empty field and re-insert from Automate → Main Fields / Subforms (don’t type the «name» by hand).

## Money formatting (symbol + thousands commas)

Writer merge fields are **plain text** — they will not auto-format numbers.  
`build_quote_merge_payload` (live Flow CF) must emit already-formatted strings:

| Quote currency | Example |
| -------------- | ------- |
| USD | `$6,321.84` |
| EUR | `€6,321.84` |

Format these keys that way:
- `line_items.unit_price`, `line_items.total` (each row)
- `sub_total`, `discount`, `tax`, `adjustment`, `grand_total`

**Template tip:** if the Writer doc has a hard-coded `$` before `«sub_total»` / `«grand_total»`, remove it once values include the symbol — otherwise you get `$$…`. Same for EUR.

That `$$28,735.63` preview means the template still has a static `$` next to those fields — delete the static `$` characters only (leave the merge chips). Line items are already correct (single `$`).
