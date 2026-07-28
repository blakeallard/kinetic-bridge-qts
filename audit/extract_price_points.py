#!/usr/bin/env python3
"""Extract RSP_EUR product rows + quantity-break pricing, cross-checked
against the committed import preview.

Reads audit/workbook_audit.sqlite (built by load_workbook.py) and
import_preview/item_master_import_preview.csv only — never the workbook.

RSP_EUR layout (verified against the DB):
  - Section header rows carry the section name in column 2 ('BMS boards incl.
    wire harness kits', 'Accessories', 'Creator Tool', 'Service Tool',
    'Software for obsolesenced BMS').
  - The band-label header row is the first following row with values in
    column 3+ ('1-19', '20-99', ... or '1', '2', '3-4', ...).
  - Item rows have a non-empty column 1 (part number, kept as raw string),
    description in column 2, prices in columns 3..(2+bands).
  - Rows before the first section header (legend, delivery-week/MOQ metadata)
    and rows with an empty column 1 (band headers, discount-multiplier rows)
    are not items.

Blank-vs-zero proof: every price cell keeps its verbatim text in `raw_value`;
`price_eur` is NULL unless the cell parses as a number (so 'Not priced' stays
NULL with raw text preserved, and a literal 0 stays 0.0); `is_blank`=1 means
no cell exists at that band position at all.

Cross-check: extracted item rows are compared to the preview CSV (expected
46 items / 41 priced / 5 unpriced; duplicates 300300+300500) — missing/extra
SKUs and duplicate rows are reported.

Output:
  - repopulates product_row + price_point (delete + insert; idempotent;
    config_row/status_mark untouched)
  - audit/reports/product_rows.csv
  - audit/reports/price_points.csv
  - audit/reports/price_point_crosscheck.md

Usage:
    python3 audit/extract_price_points.py [--db path] [--preview path]
"""
import argparse
import csv
import os
import sqlite3
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_DB = os.path.join(HERE, 'workbook_audit.sqlite')
DEFAULT_PREVIEW = os.path.join(REPO, 'import_preview',
                               'item_master_import_preview.csv')
REPORTS = os.path.join(HERE, 'reports')

SHEET = 'RSP_EUR'
SECTIONS = ['BMS boards incl. wire harness kits', 'Accessories',
            'Creator Tool', 'Service Tool', 'Software for obsolesenced BMS']
PRICE_START_COL = 3


def grid_for(db, sheet_name):
    row = db.execute('SELECT sheet_id FROM sheet WHERE name=?',
                     (sheet_name,)).fetchone()
    if not row:
        sys.exit('sheet %r not in DB' % sheet_name)
    grid = {}
    for r, col, text, num in db.execute(
            'SELECT row_num, col_num, value_text, value_num FROM cell'
            ' WHERE sheet_id=? ORDER BY row_num, col_num', (row[0],)):
        grid.setdefault(r, {})[col] = (text, num)
    return row[0], grid


def parse_items(grid):
    """Yield dicts: one per item row, with section/bands context attached."""
    section, bands = None, []
    pre_section_context = []
    for r in sorted(grid):
        cells = grid[r]
        col2 = (cells.get(2, ('', None))[0] or '').strip()
        if col2 in SECTIONS:
            section, bands = col2, []
            continue
        if section is None:
            line = ' | '.join((cells[c][0] or '').strip()
                              for c in sorted(cells) if cells[c][0])
            if line:
                pre_section_context.append('row %d: %s' % (r, line))
            continue
        has_price_cols = any(c >= PRICE_START_COL for c in cells)
        col1 = (cells.get(1, ('', None))[0] or '').strip()
        if not col1:
            if not bands and has_price_cols:  # band-label header row
                bands = [(c, (cells[c][0] or '').strip())
                         for c in sorted(cells) if c >= PRICE_START_COL
                         and (cells[c][0] or '').strip()]
            continue  # multiplier rows / stray also land here
        prices = []
        for idx, (col, label) in enumerate(bands, start=1):
            if col in cells:
                text, num = cells[col]
                prices.append((idx, label, num, 0, text))
            else:
                prices.append((idx, label, None, 1, None))
        yield {'row': r, 'part': col1,
               'desc': (cells.get(2, ('', None))[0] or '').strip(),
               'section': section, 'bands': bands, 'prices': prices}
    parse_items.pre_section_context = pre_section_context


def main():
    ap = argparse.ArgumentParser(
        description='Extract RSP_EUR items + price points; cross-check vs '
                    'import_preview CSV.')
    ap.add_argument('--db', default=DEFAULT_DB,
                    help='path to workbook_audit.sqlite (default: %(default)s)')
    ap.add_argument('--preview', default=DEFAULT_PREVIEW,
                    help='path to item_master_import_preview.csv '
                         '(default: %(default)s)')
    args = ap.parse_args()

    for p in (args.db, args.preview):
        if not os.path.exists(p):
            sys.exit('not found: %s' % p)
    db = sqlite3.connect(args.db)
    cols = [r[1] for r in db.execute('PRAGMA table_info(price_point)')]
    if 'raw_value' not in cols:
        db.execute('ALTER TABLE price_point ADD COLUMN raw_value TEXT')

    sheet_id, grid = grid_for(db, SHEET)
    items = list(parse_items(grid))

    db.execute('DELETE FROM price_point')
    db.execute('DELETE FROM product_row')
    for it in items:
        cur = db.execute(
            'INSERT INTO product_row(sheet_id, row_num, part_number,'
            ' description, section, family) VALUES (?,?,?,?,?,NULL)',
            (sheet_id, it['row'], it['part'], it['desc'], it['section']))
        it['id'] = cur.lastrowid
        db.executemany(
            'INSERT INTO price_point(product_row_id, band_index, band_label,'
            ' price_eur, is_blank, raw_value) VALUES (?,?,?,?,?,?)',
            [(it['id'], idx, label, num, blank, raw)
             for idx, label, num, blank, raw in it['prices']])
    db.commit()

    def priced(it):
        return any(num is not None for _i, _l, num, _b, _r in it['prices'])

    priced_items = [it for it in items if priced(it)]
    unpriced_items = [it for it in items if not priced(it)]
    dupes = {p: n for p, n in Counter(it['part'] for it in items).items()
             if n > 1}

    with open(args.preview, newline='') as f:
        preview = list(csv.DictReader(f))
    pv_parts = Counter(r['Part_Number'] for r in preview)
    xt_parts = Counter(it['part'] for it in items)
    missing = sorted(set(pv_parts) - set(xt_parts))   # in preview, not extracted
    extra = sorted(set(xt_parts) - set(pv_parts))     # extracted, not in preview
    count_diffs = sorted(p for p in set(pv_parts) & set(xt_parts)
                         if pv_parts[p] != xt_parts[p])
    pv_priced = sum(1 for r in preview
                    if any(r['Price_T%d' % i] for i in range(1, 10)))

    os.makedirs(REPORTS, exist_ok=True)
    with open(os.path.join(REPORTS, 'product_rows.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['sheet', 'row', 'part_number', 'description', 'section',
                    'band_labels', 'priced'])
        for it in items:
            w.writerow([SHEET, it['row'], it['part'], it['desc'],
                        it['section'], ' / '.join(lbl for _c, lbl in it['bands']),
                        'Y' if priced(it) else 'N'])
    with open(os.path.join(REPORTS, 'price_points.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['sheet', 'row', 'part_number', 'section', 'band_index',
                    'band_label', 'raw_value', 'price_eur', 'is_blank'])
        for it in items:
            for idx, label, num, blank, raw in it['prices']:
                w.writerow([SHEET, it['row'], it['part'], it['section'], idx,
                            label, raw or '', '' if num is None else num, blank])

    md = os.path.join(REPORTS, 'price_point_crosscheck.md')
    with open(md, 'w') as f:
        f.write('# RSP_EUR extraction vs import_preview cross-check\n\n')
        f.write('| Metric | SQLite extraction | import_preview | Match |\n')
        f.write('|---|---|---|---|\n')
        for label, a, b in [
                ('Item rows', len(items), len(preview)),
                ('Priced rows', len(priced_items), pv_priced),
                ('Unpriced rows', len(unpriced_items), len(preview) - pv_priced)]:
            f.write('| %s | %d | %d | %s |\n'
                    % (label, a, b, 'YES' if a == b else '**NO**'))
        f.write('\n## Duplicate SKUs (extraction)\n\n')
        for p, n in sorted(dupes.items()):
            rows = [str(it['row']) for it in items if it['part'] == p]
            f.write('- `%s` x%d (sheet rows %s)\n' % (p, n, ', '.join(rows)))
        f.write('\n## SKU set comparison\n\n')
        f.write('- Missing from extraction (in preview only): %s\n'
                % (', '.join('`%s`' % p for p in missing) or 'none'))
        f.write('- Extra in extraction (not in preview): %s\n'
                % (', '.join('`%s`' % p for p in extra) or 'none'))
        f.write('- Per-SKU row-count mismatches: %s\n'
                % (', '.join('`%s`' % p for p in count_diffs) or 'none'))
        f.write('\n## Pre-section context rows (delivery weeks / MOQ / legend)\n\n')
        for line in parse_items.pre_section_context:
            f.write('- %s\n' % line)

    n_pp = db.execute('SELECT count(*) FROM price_point').fetchone()[0]
    print('product rows: %d (priced %d / unpriced %d) -> product_row'
          % (len(items), len(priced_items), len(unpriced_items)))
    print('price points: %d -> price_point' % n_pp)
    print('duplicates: %s' % (', '.join('%s x%d' % kv
                                        for kv in sorted(dupes.items())) or 'none'))
    print('cross-check: missing=%s extra=%s count-mismatch=%s'
          % (missing or 'none', extra or 'none', count_diffs or 'none'))
    print('reports: product_rows.csv, price_points.csv, price_point_crosscheck.md')
    ok = (len(items) == len(preview) and not missing and not extra
          and not count_diffs)
    print('CROSS-CHECK %s' % ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
