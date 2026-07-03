#!/usr/bin/env python3
"""Generate Item_Master import preview from the July 2026 RSP pricelist workbook.

Source workbook: "Lithium Balance BMS_July 01_RSP_Distributor.xlsx", sheet 'RSP_EUR'.
Stdlib-only (openpyxl not installed). Reads cells straight from the xlsx XML so
part numbers are preserved as raw strings (e.g. 000637, 100985.1, 100640.99).

Usage:
    python3 generate_preview.py [path/to/july_rsp.xlsx]

Outputs (written next to this script):
    item_master_import_preview.csv
    import_preview_report.md
"""
import csv
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_XLSX = '/Users/blakeallard/.claude/jobs/d8eec8fc/tmp/july_rsp.xlsx'
SHEET_NAME = 'RSP_EUR'

CSV_HEADER = ['Part_Number', 'Description', 'Category', 'Tier_Scheme', 'Discountable',
              'Active', 'Price_T1', 'Price_T2', 'Price_T3', 'Price_T4', 'Price_T5',
              'Price_T6', 'Price_T7', 'Price_T8', 'Price_T9', 'Review_Flag', 'Review_Reason']

# Section header text (column B) -> (tier_scheme, category, number of price bands, band labels)
SECTIONS = {
    'BMS boards incl. wire harness kits': ('hardware', 'Hardware', 9,
        ['1-19', '20-99', '100-259', '260-499', '500-999', '1000-2499', '2500-4999', '5000-9999', '10000-24999']),
    'Accessories': ('hardware', 'Accessory', 4,
        ['1-19', '20-199 (header typo; likely 20-99)', '100-259', '260-499']),
    'Creator Tool': ('license', 'Software', 6, ['1', '2', '3-4', '5-9', '10-24', '25-249']),
    'Service Tool': ('license', 'Software', 6, ['1', '2', '3-4', '5-9', '10-24', '25-249']),
    'Software for obsolesenced BMS': ('license', 'Software', 3, ['1', '2', '3-4']),
}

SKU_RE = re.compile(r'^\d+(\.\d+)?$')


def col_to_idx(ref):
    col = 0
    for ch in re.match(r'([A-Z]+)', ref).group(1):
        col = col * 26 + (ord(ch) - 64)
    return col - 1


def read_rsp_rows(xlsx_path):
    """Return list of (sheet_row_number, {col_idx: raw_text}) for non-empty rows of RSP_EUR."""
    z = zipfile.ZipFile(xlsx_path)
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rel_map = {rel.get('Id'): rel.get('Target') for rel in rels}
    target = None
    for sh in wb.find(f'{{{M}}}sheets'):
        if sh.get('name') == SHEET_NAME:
            t = rel_map[sh.get(f'{{{R}}}id')]
            target = t if t.startswith('xl/') else 'xl/' + t
    if target is None:
        raise SystemExit(f'Sheet {SHEET_NAME!r} not found')

    shared = []
    try:
        ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in ss.findall(f'{{{M}}}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{{{M}}}t')))
    except KeyError:
        pass

    rows = []
    for row in ET.fromstring(z.read(target)).iter(f'{{{M}}}row'):
        cells = {}
        for c in row.findall(f'{{{M}}}c'):
            ctype = c.get('t')
            v = c.find(f'{{{M}}}v')
            if ctype == 's' and v is not None:
                val = shared[int(v.text)]
            elif ctype == 'inlineStr':
                is_el = c.find(f'{{{M}}}is')
                val = ''.join(t.text or '' for t in is_el.iter(f'{{{M}}}t')) if is_el is not None else ''
            elif v is not None:
                val = v.text
            else:
                val = ''
            if val not in ('', None):
                cells[col_to_idx(c.get('r'))] = str(val)
        if cells:
            rows.append((int(row.get('r')), cells))
    return rows


def fmt_price(raw):
    """Raw cell text -> ('', None) for unpriced text, or 2-decimal string."""
    txt = raw.strip()
    if not txt:
        return ''
    if 'not priced' in txt.lower():
        return ''
    try:
        return str(Decimal(txt).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    except Exception:
        return ''


def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    rows = read_rsp_rows(xlsx)

    items = []        # dicts with parse metadata
    skipped = []      # (sheet_row, reason, preview_text)
    junk_notes = []   # stray cells ignored
    section = None    # (name, tier_scheme, category, nbands)

    for rownum, cells in rows:
        col0 = cells.get(0, '').strip()
        col1 = cells.get(1, '').strip()
        preview = ' | '.join(cells.get(i, '') for i in range(0, max(cells) + 1))[:110]

        if col1 in SECTIONS:
            section = (col1,) + SECTIONS[col1][:3]
            skipped.append((rownum, f'Section header: "{col1}"', preview))
            continue

        if not col0:
            # band header, multiplier row, or title/legend row
            vals = [cells[i].strip() for i in sorted(cells) if i >= 2 and cells[i].strip()]
            if vals and all(re.fullmatch(r'0?\.\d+', v) for v in vals):
                skipped.append((rownum, 'Multiplier metadata row (discount multipliers, not an item)', preview))
            elif section is None:
                skipped.append((rownum, 'Pre-section title/legend row', preview))
            else:
                skipped.append((rownum, 'Quantity-band header row', preview))
            continue

        if section is None:
            skipped.append((rownum, 'Pre-section metadata (delivery time / MOQ / column header)', preview))
            continue

        if not SKU_RE.fullmatch(col0):
            skipped.append((rownum, f'Column A "{col0}" is not a plain SKU inside a section', preview))
            continue

        sec_name, tier_scheme, category, nbands = section
        band_cols = range(2, 2 + nbands)
        prices = [fmt_price(cells.get(i, '')) for i in band_cols]

        # Tail scan beyond the band columns: a standalone "X" marks discountable;
        # anything else out there is junk (e.g. stray "47" on the 200500 row).
        discountable = 'N'
        for i in sorted(cells):
            if i < 2 + nbands:
                continue
            v = cells[i].strip()
            if v == 'X':
                discountable = 'Y'
            elif v:
                junk_notes.append((rownum, col0, f'ignored stray cell at column index {i}: "{v}"'))

        items.append({
            'row': rownum, 'sku': col0, 'desc': col1, 'section': sec_name,
            'tier_scheme': tier_scheme, 'category': category,
            'prices': prices, 'discountable': discountable,
            'priced': any(p for p in prices),
        })

    # Duplicate SKU detection
    counts = {}
    for it in items:
        counts[it['sku']] = counts.get(it['sku'], 0) + 1

    for it in items:
        flag, reason, active = '', '', 'Y'
        if counts[it['sku']] > 1:
            flag, active = 'DUPLICATE_SKU', 'REVIEW'
            style = ('bundle-style price row (prices only in upper bands)'
                     if not it['prices'][0] else 'unit-price row')
            reason = (f'SKU {it["sku"]} appears {counts[it["sku"]]}x in {it["section"]}; this is the {style}. '
                      'Bundle-vs-unit pricing ambiguity - confirm which row is the sellable item before import.')
        elif not it['priced']:
            flag, active = 'UNPRICED', 'REVIEW'
            reason = f'No published price in July 2026 RSP (sheet row {it["row"]}); listed without price points.'
        elif it['section'] == 'Service Tool':
            flag = 'CONFIRM_DISCOUNT_CLASS'
            reason = 'confirm flat software discount applies to service tools'
        it['flag'], it['reason'], it['active'] = flag, reason, active

    # ---- CSV ----
    csv_path = os.path.join(HERE, 'item_master_import_preview.csv')
    with open(csv_path, 'w', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(CSV_HEADER)
        for it in items:
            p = it['prices'] + [''] * (9 - len(it['prices']))
            w.writerow([it['sku'], it['desc'], it['category'], it['tier_scheme'],
                        it['discountable'], it['active']] + p + [it['flag'], it['reason']])

    # ---- Report ----
    total = len(items)
    priced = sum(1 for it in items if it['priced'])
    unpriced = total - priced
    dup_skus = sorted(s for s, c in counts.items() if c > 1)
    dup_rows = sum(1 for it in items if it['flag'] == 'DUPLICATE_SKU')
    review_active = sum(1 for it in items if it['active'] == 'REVIEW')
    flagged = [it for it in items if it['flag']]

    def md_row(it):
        p = it['prices'] + [''] * (9 - len(it['prices']))
        return ('| ' + ' | '.join([str(it['row']), it['sku'], it['desc'][:55], it['category'],
                                   it['tier_scheme'], it['discountable'], it['active']]
                                  + p + [it['flag'], it['reason']]) + ' |')

    lines = []
    lines.append('# July 2026 RSP -> Item_Master Import Preview Report')
    lines.append('')
    lines.append(f'- **Source**: `{os.path.basename(xlsx)}` (sheet `RSP_EUR`, {len(rows)} non-empty rows)')
    lines.append('- **Generated by**: `generate_preview.py` (stdlib xlsx parser; reproducible)')
    lines.append('- **Currency**: EUR - "ALL PRICES IN EURO", valid from July 2026')
    lines.append('')
    lines.append('## Methodology')
    lines.append('')
    lines.append('1. Read `RSP_EUR` cells directly from the xlsx XML (shared strings resolved); part numbers kept as raw strings so SKUs like `000637`, `100985.1`, `100640.99` are preserved.')
    lines.append('2. Rows are assigned to a section when column B matches a section header ("BMS boards incl. wire harness kits", "Accessories", "Creator Tool", "Service Tool", "Software for obsolesenced BMS").')
    lines.append('3. Rows with an empty column A (titles, quantity-band headers, discount-multiplier rows like `0.75 / 0.65 / ...`) and pre-section metadata rows (delivery-time / MOQ rows with slash-joined part numbers) are skipped, not items.')
    lines.append('4. Price bands map to `Price_T1..Tn` per section: BMS boards = 9 hardware bands (1-19 ... 10000-24999); Accessories = 4 hardware bands; Creator/Service Tool = 6 license bands (1 / 2 / 3-4 / 5-9 / 10-24 / 25-249); obsolete software = 3 license bands. `Tier_Scheme` = `hardware` or `license` accordingly.')
    lines.append('5. Prices are rounded to exactly 2 decimals (source has float noise, e.g. `506.00000000000006` -> `506.00`). "Not priced" text = blank.')
    lines.append('6. A standalone `X` in the row tail (beyond the band columns) sets `Discountable=Y`; absent = `N`. Other stray tail cells are ignored as junk (see notes).')
    lines.append('7. Category proposal: BMS boards -> Hardware; Accessories -> Accessory; Creator Tool / Service Tool / obsolete software -> Software.')
    lines.append('8. Review flag precedence per row: `DUPLICATE_SKU` > `UNPRICED` > `CONFIRM_DISCOUNT_CLASS`. `Active=REVIEW` for duplicate/unpriced rows; `Active=Y` otherwise (no `N` rows in this pass).')
    lines.append('')
    lines.append('## Counts')
    lines.append('')
    lines.append(f'| Metric | Count |')
    lines.append(f'|---|---|')
    lines.append(f'| Total item rows parsed | {total} |')
    lines.append(f'| Priced | {priced} |')
    lines.append(f'| Unpriced | {unpriced} |')
    lines.append(f'| Duplicate SKUs | {len(dup_skus)} ({", ".join(dup_skus)}) - {dup_rows} rows |')
    lines.append(f'| Rows with Active=REVIEW | {review_active} |')
    lines.append(f'| Rows with any Review_Flag | {len(flagged)} |')
    lines.append('')
    lines.append('## Known data-quality notes')
    lines.append('')
    lines.append('- **Accessories band-header typo**: header reads `20-199` where every other hardware section reads `20-99`. Accessory rows only populate the first 1-2 price points, so the typo does not change any parsed data; no per-row flag was added.')
    lines.append('- **Stray junk cells ignored**:')
    for rownum, sku, note in junk_notes:
        lines.append(f'  - Sheet row {rownum} (SKU {sku}): {note}')
    if not junk_notes:
        lines.append('  - none')
    lines.append('- **Duplicate SKU detail**: 300500 and 300300 each appear twice in Service Tool - once as a bundle-style row (prices 3500/5900/9800 only in the 5-9 / 10-24 / 25-249 bands) and once as a unit-price row (450/337.50/292.50/...). Both variants are included with `Active=REVIEW`.')
    lines.append('')
    lines.append('## Skipped rows (not items)')
    lines.append('')
    lines.append('| Sheet row | Reason | Content preview |')
    lines.append('|---|---|---|')
    for rownum, reason, preview in skipped:
        lines.append(f'| {rownum} | {reason} | `{preview}` |')
    lines.append('')
    lines.append('## REVIEW / flagged rows')
    lines.append('')
    lines.append('| Sheet row | Part_Number | Description | Category | Tier_Scheme | Disc | Active | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | Review_Flag | Review_Reason |')
    lines.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for it in flagged:
        lines.append(md_row(it))
    lines.append('')

    report_path = os.path.join(HERE, 'import_preview_report.md')
    with open(report_path, 'w') as f:
        f.write('\n'.join(lines))

    print(f'Wrote {csv_path} ({total} item rows) and {report_path}')
    print(f'total={total} priced={priced} unpriced={unpriced} dup_skus={len(dup_skus)} '
          f'dup_rows={dup_rows} active_review={review_active} flagged={len(flagged)}')


if __name__ == '__main__':
    main()
