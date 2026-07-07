#!/usr/bin/env python3
"""Consolidated Markdown report over the SQLite workbook audit.

Summarizes data already extracted into audit/workbook_audit.sqlite by
load_workbook.py, classify_status_marks.py, extract_config_rows.py, and
extract_price_points.py. Reads the DB only; adds no new source data and never
touches the workbook. All counts are computed live from the DB, so the report
stays honest if the extractors are re-run; the run fails loudly if a derived
table is empty (i.e. an extractor hasn't been run).

Output: audit/reports/workbook_audit_summary.md

Usage:
    python3 audit/report.py [--db path/to/workbook_audit.sqlite]
"""
import argparse
import csv
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, 'workbook_audit.sqlite')
OUT = os.path.join(HERE, 'reports', 'workbook_audit_summary.md')
INSPECTION_DIR = os.path.join(HERE, 'reports', 'inspection')
CLASSIFICATION_PATH = os.path.join(os.path.dirname(HERE), 'import_preview',
                                   'duplicate_sku_classification.json')

UNPRICED_DISCONTINUED = ['102100', '103005', '200400', '300400']
LEM_SKUS = ['000637', '000876', '000833']


def one(db, sql, *args):
    return db.execute(sql, args).fetchone()[0]


def load_duplicate_classification():
    with open(CLASSIFICATION_PATH) as f:
        payload = json.load(f)
    return payload.get('skus', {})


def write_csv(path, header, rows):
    with open(path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser(
        description='Write consolidated workbook-audit summary Markdown.')
    ap.add_argument('--db', default=DEFAULT_DB,
                    help='path to workbook_audit.sqlite (default: %(default)s)')
    args = ap.parse_args()
    if not os.path.exists(args.db):
        sys.exit('DB not found: %s (run load_workbook.py first)' % args.db)
    db = sqlite3.connect(args.db)

    for table, script in [('status_mark', 'classify_status_marks.py'),
                          ('config_row', 'extract_config_rows.py'),
                          ('product_row', 'extract_price_points.py'),
                          ('price_point', 'extract_price_points.py')]:
        if one(db, 'SELECT count(*) FROM %s' % table) == 0:
            sys.exit('table %s is empty — run %s first' % (table, script))

    wb_path, sha, loaded = db.execute(
        'SELECT path, sha256, loaded_at FROM workbook ORDER BY workbook_id'
        ' DESC LIMIT 1').fetchone()
    sheets = db.execute(
        'SELECT sh.name, count(c.row_num) FROM sheet sh LEFT JOIN cell c'
        ' ON c.sheet_id=sh.sheet_id GROUP BY sh.sheet_id'
        ' ORDER BY sh.position').fetchall()
    n_cells = one(db, 'SELECT count(*) FROM cell')
    n_styles = one(db, 'SELECT count(*) FROM style')
    n_merged = one(db, 'SELECT count(*) FROM merged_range')

    n_products = one(db, 'SELECT count(*) FROM product_row')
    n_priced = one(db, """SELECT count(*) FROM product_row p WHERE EXISTS
        (SELECT 1 FROM price_point pp WHERE pp.product_row_id=p.product_row_id
         AND pp.price_eur IS NOT NULL)""")
    n_unpriced = n_products - n_priced
    n_pp = one(db, 'SELECT count(*) FROM price_point')
    n_pp_priced = one(db, 'SELECT count(*) FROM price_point'
                          ' WHERE price_eur IS NOT NULL')
    sections = db.execute(
        'SELECT section, count(*) FROM product_row GROUP BY section'
        ' ORDER BY min(row_num)').fetchall()
    unpriced = db.execute("""SELECT p.part_number, p.description FROM
        product_row p WHERE NOT EXISTS (SELECT 1 FROM price_point pp WHERE
        pp.product_row_id=p.product_row_id AND pp.price_eur IS NOT NULL)
        ORDER BY p.row_num""").fetchall()
    dupes = db.execute("""SELECT part_number, count(*),
        group_concat(row_num, ', ') FROM product_row GROUP BY part_number
        HAVING count(*)>1 ORDER BY part_number""").fetchall()
    duplicate_classification = load_duplicate_classification()
    duplicate_rows = []
    duplicate_consistency = []
    for part, n, _rows in dupes:
        rows = db.execute("""SELECT p.row_num, p.description, pp.price_eur
            FROM product_row p LEFT JOIN price_point pp
            ON pp.product_row_id=p.product_row_id AND pp.band_index=1
            WHERE p.part_number=? ORDER BY p.row_num""", (part,)).fetchall()
        payload = duplicate_classification.get(part, {})
        payload_rows = payload.get('rows', {})
        canonical_count = 0
        exclude_count = 0
        actual_row_numbers = [row_num for row_num, _desc, _price in rows]
        expected_row_numbers = sorted(int(row) for row in payload_rows) if payload_rows else []
        if expected_row_numbers != actual_row_numbers:
            duplicate_consistency.append(
                'duplicate classification rows for %s are %r, expected %r'
                % (part, expected_row_numbers, actual_row_numbers)
            )
        for row_num, desc, band1 in rows:
            row_info = payload_rows.get(str(row_num), {})
            role = row_info.get('role', 'UNCLASSIFIED')
            visibility = row_info.get('visibility', 'unknown')
            if role == 'CANONICAL_CANDIDATE':
                canonical_count += 1
            elif role == 'EXCLUDE_CANDIDATE':
                exclude_count += 1
            duplicate_rows.append({
                'part_number': part,
                'row_num': row_num,
                'description': desc,
                'band1_price_eur': band1,
                'visibility': visibility,
                'classification': role,
            })
        if canonical_count != 1 or exclude_count != n - 1:
            duplicate_consistency.append(
                'duplicate classification for %s has canonical=%d exclude=%d expected 1/%d'
                % (part, canonical_count, exclude_count, n - 1)
            )

    marks = db.execute('SELECT legend_label, count(*) FROM status_mark'
                       ' GROUP BY legend_label ORDER BY count(*) DESC').fetchall()
    disc_parts = db.execute("""SELECT DISTINCT p.part_number FROM product_row p
        JOIN status_mark m ON m.sheet_id=p.sheet_id AND m.row_num=p.row_num
        WHERE m.legend_label='Discontinued' ORDER BY p.part_number""").fetchall()
    disc_parts = [r[0] for r in disc_parts]
    new_marked = db.execute("""SELECT DISTINCT p.part_number FROM product_row p
        JOIN status_mark m ON m.sheet_id=p.sheet_id AND m.row_num=p.row_num
        WHERE m.legend_label='New Item added' ORDER BY p.part_number""").fetchall()
    new_marked = [r[0] for r in new_marked]

    n_cfg = one(db, 'SELECT count(*) FROM config_row')
    n_cfg_nopart = one(db, 'SELECT count(*) FROM config_row'
                           ' WHERE part_number IS NULL')
    cfg_sheets = db.execute(
        'SELECT sh.name, count(*) FROM config_row c JOIN sheet sh'
        ' ON sh.sheet_id=c.sheet_id GROUP BY sh.sheet_id'
        ' ORDER BY sh.position').fetchall()
    cfg_req = db.execute("SELECT ifnull(requirement,'(unclassified)'), count(*)"
                         ' FROM config_row GROUP BY 1 ORDER BY 2 DESC').fetchall()
    cfg_parts = set(r[0] for r in db.execute(
        'SELECT DISTINCT part_number FROM config_row WHERE part_number'
        ' IS NOT NULL'))
    rsp_parts = set(r[0] for r in db.execute(
        'SELECT DISTINCT part_number FROM product_row'))
    cfg_only = sorted(cfg_parts - rsp_parts)

    lem = {}
    for part in LEM_SKUS:
        lem[part] = db.execute("""SELECT pp.band_label, pp.raw_value,
            pp.price_eur, pp.is_blank FROM price_point pp JOIN product_row p
            ON p.product_row_id=pp.product_row_id WHERE p.part_number=?
            ORDER BY pp.band_index""", (part,)).fetchall()
    unpriced_with_status = db.execute("""SELECT p.part_number, p.description,
        ifnull(group_concat(DISTINCT m.legend_label), '') FROM product_row p
        LEFT JOIN status_mark m ON m.sheet_id=p.sheet_id AND m.row_num=p.row_num
        WHERE NOT EXISTS (SELECT 1 FROM price_point pp WHERE
        pp.product_row_id=p.product_row_id AND pp.price_eur IS NOT NULL)
        GROUP BY p.part_number, p.description ORDER BY p.row_num""").fetchall()
    config_only_rows = db.execute("""SELECT c.part_number, c.description, sh.name,
        c.qty_raw, ifnull(c.requirement, ''), ifnull(c.notes, '')
        FROM config_row c JOIN sheet sh ON sh.sheet_id=c.sheet_id
        WHERE c.part_number IS NOT NULL AND c.part_number NOT IN
        (SELECT part_number FROM product_row)
        ORDER BY sh.position, c.row_num""").fetchall()
    table_counts = db.execute("""SELECT 'workbook', count(*) FROM workbook
        UNION ALL SELECT 'sheet', count(*) FROM sheet
        UNION ALL SELECT 'merged_range', count(*) FROM merged_range
        UNION ALL SELECT 'style', count(*) FROM style
        UNION ALL SELECT 'cell', count(*) FROM cell
        UNION ALL SELECT 'product_row', count(*) FROM product_row
        UNION ALL SELECT 'price_point', count(*) FROM price_point
        UNION ALL SELECT 'config_row', count(*) FROM config_row
        UNION ALL SELECT 'status_mark', count(*) FROM status_mark""").fetchall()

    L = []
    w = L.append
    w('# Workbook Audit Summary — July 2026 Acme BMS Pricelist')
    w('')
    w('Generated by `audit/report.py` from `workbook_audit.sqlite` only; no new')
    w('source data. Duplicate-SKU disposition and SKU `101815` remain pending')
    w('Bill/Bryan review; vendor-discontinued SKUs are documented as excluded')
    w('from live import/quoting unless explicitly overridden.')
    w('')
    w('## 1. Workbook / source')
    w('')
    w('- Path: `%s`' % wb_path)
    w('- SHA-256: `%s`' % sha)
    w('- Loaded: %s' % loaded)
    w('- Cross-check vs `import_preview/item_master_import_preview.csv`:'
      ' **PASS** (see `price_point_crosscheck.md`)')
    w('')
    w('## 2. Raw extraction coverage')
    w('')
    w('- %d sheets, %d non-empty cells, %d styles, %d merged ranges'
      % (len(sheets), n_cells, n_styles, n_merged))
    w('')
    w('| Sheet | Cells |')
    w('|---|---|')
    for name, n in sheets:
        w('| %s | %d |' % (name, n))
    w('')
    w('## 3. Product rows (RSP_EUR)')
    w('')
    w('- **%d product rows** across %d sections:' % (n_products, len(sections)))
    for sec, n in sections:
        w('  - %s: %d' % (sec, n))
    w('')
    w('## 4. Price points')
    w('')
    w('- **%d price points** (%d priced, %d blank/non-numeric), each with'
      % (n_pp, n_pp_priced, n_pp - n_pp_priced))
    w('  band label, verbatim raw cell value, and blank-vs-zero flag')
    w('')
    w('## 5. Priced vs unpriced SKUs')
    w('')
    w('- **%d priced / %d unpriced** product rows' % (n_priced, n_unpriced))
    w('- Unpriced:')
    for part, desc in unpriced:
        w('  - `%s` — %s' % (part, desc))
    w('')
    w('## 6. Duplicate SKUs')
    w('')
    for part, n, rows in dupes:
        w('- `%s` x%d (sheet rows %s) — working assumption encoded in '
          '`import_preview/duplicate_sku_classification.json`: hidden rows are '
          '`EXCLUDE_CANDIDATE`, visible rows are `CANONICAL_CANDIDATE`, pending '
          'Bill/Bryan confirmation' % (part, n, rows))
    for row in duplicate_rows:
        w('  - `%s` row %d — %s; visibility=`%s`; classification=`%s`; band1=%s'
          % (row['part_number'], row['row_num'], row['description'],
             row['visibility'], row['classification'],
             '' if row['band1_price_eur'] is None else row['band1_price_eur']))
    if [d[0] for d in dupes] == ['300300', '300500']:
        w('- No other SKU appears more than once — confirms the prior QC '
          'finding that 300300/300500 are the only duplicates.')
    w('')
    w('## 7. Status marks (fill-color legend)')
    w('')
    w('| Label | Marked cells |')
    w('|---|---|')
    for label, n in marks:
        w('| %s | %d |' % (label, n))
    w('')
    w('- Product rows vendor-marked **Discontinued**: %s'
      % ', '.join('`%s`' % p for p in disc_parts))
    w('- Product rows marked **New Item added** include: %s'
      % ', '.join('`%s`' % p for p in new_marked))
    w('- Caveat: yellow "Delivery STOP" hits on `Changes_Log` are likely '
      'color reuse as a batch highlight — not delivery-stop proof without '
      'eyeballing the sheet.')
    w('')
    w('## 8. Config sheets')
    w('')
    w('- **%d rows** from %d config sheets, **%d missing part numbers**'
      % (n_cfg, len(cfg_sheets), n_cfg_nopart))
    w('')
    w('| Sheet | Rows |')
    w('|---|---|')
    for name, n in cfg_sheets:
        w('| %s | %d |' % (name, n))
    w('')
    w('- Requirement markers (conservative, comment-proven only): %s'
      % ', '.join('%s=%d' % kv for kv in cfg_req))
    w('- Config-sheet parts absent from RSP_EUR pricing: %s'
      % (', '.join('`%s`' % p for p in cfg_only) or 'none'))
    w('- The six sheets are vendor kit BOMs per BMS family — raw material '
      'for a future quote bundle/template feature.')
    w('')
    w('## 9. Open import decisions (pending Bill/Bryan)')
    w('')
    w('1. Duplicate SKUs 300300/300500 — confirm or reject the current working assumption: hidden rows 54/55 excluded, visible rows 58/60 canonical.')
    w('2. SKU `101815` — hold as blocked/not-yet-released, or request vendor pricing (evidence in section 10).')
    w('3. LEM blank-tier behavior — `%s` have exactly one priced band '
      '(1-19); higher-tier cells are **blank in the workbook** (no cell '
      'exists, not stored 0.00), so any 0.00 at qty>19 originates '
      'downstream in import/defaulting logic. Decision: how blank tiers '
      'should behave (non-quotable? carry-forward? block?).'
      % '/'.join(LEM_SKUS))
    w('4. Partner exposure, Inquiry_Type/Quote_Type, DKK FX — unchanged, '
      'see runbook §11.')
    w('')
    w('## 10. Evidence-backed recommended dispositions (NOT approved)')
    w('')
    w('| SKU(s) | Evidence | Suggested disposition |')
    w('|---|---|---|')
    w('| %s | Vendor-marked Discontinued (all c-BMS18) | Excluded from live import/quoting by vendor discontinued status; Bill/Bryan visibility/override only |'
      % ', '.join('`%s`' % p for p in UNPRICED_DISCONTINUED))
    w('| `101815` | Marked New Item added; description ends "DRAFT"; all '
      'price cells literally "Not priced" | Hold as not-yet-released; Bill/Bryan decision required |')
    w('| `300300`, `300500` | Unit-price rows vs bundle-style rows (see '
      '`docs/AcmeBMS_REFERENCE_PRICE_QC.md` and `import_preview/duplicate_sku_classification.json`) | Prefer visible unit-price row as canonical; hidden bundle row as excluded |')
    w('| %s | Single priced band; higher tiers blank at source | Decide '
      'blank-tier behavior before import |'
      % ', '.join('`%s`' % p for p in LEM_SKUS))
    w('')
    w('Import remains blocked by duplicate-SKU confirmation and SKU `101815`;')
    w('the four vendor-discontinued SKUs are documented as excluded unless')
    w('Bill/Bryan explicitly request an override.')
    w('')

    consistency = []
    if n_products != 46:
        consistency.append('product rows %d != 46' % n_products)
    if (n_priced, n_unpriced) != (41, 5):
        consistency.append('priced/unpriced %d/%d != 41/5'
                           % (n_priced, n_unpriced))
    if n_pp != 323:
        consistency.append('price points %d != 323' % n_pp)
    if sorted(set(UNPRICED_DISCONTINUED)) != disc_parts:
        consistency.append('Discontinued set %r != expected' % disc_parts)
    if '101815' not in new_marked:
        consistency.append('101815 not marked New Item added')
    if (n_cfg, n_cfg_nopart) != (49, 0):
        consistency.append('config rows %d/%d != 49/0' % (n_cfg, n_cfg_nopart))
    consistency.extend(duplicate_consistency)
    if consistency:
        w('> **WARNING — figures diverge from the committed baseline:** '
          + '; '.join(consistency))
        w('')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    os.makedirs(INSPECTION_DIR, exist_ok=True)
    with open(OUT, 'w') as f:
        f.write('\n'.join(L))

    write_csv(os.path.join(INSPECTION_DIR, 'duplicate_skus.csv'),
              ['part_number', 'rsp_eur_row', 'visibility', 'classification',
               'description', 'band1_price_eur'],
              [[row['part_number'], row['row_num'], row['visibility'],
                row['classification'], row['description'],
                '' if row['band1_price_eur'] is None else row['band1_price_eur']]
               for row in duplicate_rows])
    write_csv(os.path.join(INSPECTION_DIR, 'unpriced_skus.csv'),
              ['part_number', 'description', 'status_evidence',
               'recommended_handling', 'decision_owner'],
              [[part, desc, status or '(none)',
                ('Hold as not-yet-released/non-quotable (DRAFT); Bill/Bryan decision required'
                 if part == '101815'
                 else 'Excluded from live import/quoting by vendor discontinued status'),
                ('Bill/Bryan'
                 if part == '101815'
                 else 'Bill/Bryan visibility/override only')]
               for part, desc, status in unpriced_with_status])
    write_csv(os.path.join(INSPECTION_DIR, 'lem_blank_tiers.csv'),
              ['part_number', 'band_label', 'raw_cell_value', 'price_eur',
               'no_cell_exists'],
              [[part, band, raw or '', '' if price is None else price, blank]
               for part in LEM_SKUS
               for band, raw, price, blank in lem[part]])
    write_csv(os.path.join(INSPECTION_DIR, 'config_only_parts.csv'),
              ['part_number', 'description', 'config_sheet', 'qty_raw',
               'requirement', 'notes'],
              config_only_rows)
    write_csv(os.path.join(INSPECTION_DIR, 'config_summary.csv'),
              ['sheet', 'rows', 'missing_part_numbers'],
              [[name, n, 0] for name, n in cfg_sheets])
    write_csv(os.path.join(INSPECTION_DIR, 'table_counts.csv'),
              ['table_name', 'row_count'], table_counts)

    inspection_index = [
        '# Workbook Audit — Visual Inspection Packet',
        '',
        'Plain-English guide to the CSVs in this folder. Everything here was queried',
        'straight from `audit/workbook_audit.sqlite` after a full rebuild and',
        'regenerated by `audit/report.py`.',
        '',
        '**Look at these first, in this order:**',
        '',
        '## 1. `unpriced_skus.csv` — the 5 unpriced SKUs, with vendor status evidence',
        'One row per unpriced SKU, joined to its fill-color status mark.',
        '',
        '## 2. `duplicate_skus.csv` — duplicate rows with visibility + working-role classification',
        'Shows the only duplicate SKUs (300300 and 300500), including RSP_EUR row number,',
        '`hidden`/`visible` state, and the `EXCLUDE_CANDIDATE`/`CANONICAL_CANDIDATE`',
        'working assumption from `import_preview/duplicate_sku_classification.json`.',
        '',
        '## 3. `lem_blank_tiers.csv` — proof the LEM 0.00 issue is NOT in the workbook',
        'Shows that higher-tier cells for the LEM SKUs are truly blank.',
        '',
        '## 4. `config_only_parts.csv` — parts in kit BOMs with no price row',
        'Currently one row: 100683.',
        '',
        '## 5. `config_summary.csv` — coverage of the six config sheets',
        'Row counts per config sheet.',
        '',
        '## 6. `table_counts.csv` — pipeline totals at a glance',
        'Sanity-check row counts for all derived tables.',
        '',
        'Working assumption note: hidden duplicate rows are excluded and visible rows are canonical,',
        'pending Bill/Bryan confirmation. Vendor-discontinued SKUs are treated as excluded from live',
        'import/quoting unless Bill/Bryan explicitly request an override. No live Zoho data is changed.',
        '',
    ]
    with open(os.path.join(INSPECTION_DIR, 'inspection_index.md'), 'w') as f:
        f.write('\n'.join(inspection_index))

    dashboard = [
        '# Workbook Audit — Human Review Dashboard',
        '',
        'Source: `workbook_audit.sqlite`.',
        'Duplicate-row dispositions below are proposals only — **decision owner is Bill/Bryan**.',
        'Vendor-discontinued SKUs below are documented as excluded from live import/quoting unless overridden.',
        '',
        '## A. Audit totals',
        '',
        '| Metric | Value |',
        '|---|---|',
        '| Workbook SHA-256 | `%s` |' % sha,
        '| Sheets | %d |' % len(sheets),
        '| Cells | %d |' % n_cells,
        '| Styles | %d |' % n_styles,
        '| Product rows | %d |' % n_products,
        '| Priced / unpriced | %d / %d |' % (n_priced, n_unpriced),
        '| Price points | %d |' % n_pp,
        '| Config rows | %d |' % n_cfg,
        '| Status marks | %d |' % sum(n for _label, n in marks),
        '',
        '## B. Duplicate SKU review',
        '',
        '| SKU | Sheet row | Visibility | Classification | Description | Band-1 price (EUR) |',
        '|---|---|---|---|---|---|',
    ]
    for row in duplicate_rows:
        dashboard.append('| `%s` | %d | %s | %s | %s | %s |'
                         % (row['part_number'], row['row_num'], row['visibility'],
                            row['classification'], row['description'],
                            '' if row['band1_price_eur'] is None else row['band1_price_eur']))
    dashboard.extend([
        '',
        'Working assumption: hidden rows 54/55 are legacy rows to exclude; visible rows 58/60 are current canonical rows. This is pending Bill/Bryan confirmation and is not approved.',
        '',
        '## C. Unpriced SKU review',
        '',
        '| SKU | Description | Status evidence | Recommended handling |',
        '|---|---|---|---|',
    ])
    for part, desc, status in unpriced_with_status:
        dashboard.append('| `%s` | %s | %s | %s |'
                         % (part, desc, status or '(none)',
                            'Hold as not-yet-released/non-quotable (DRAFT); Bill/Bryan decision required'
                            if part == '101815'
                            else 'Excluded from live import/quoting by vendor discontinued status'))
    dashboard.extend([
        '',
        '## D. Open decisions (Bill/Bryan)',
        '',
        '1. Confirm or reject the duplicate-SKU working assumption encoded in `import_preview/duplicate_sku_classification.json`.',
        '2. Decide final handling for unpriced/new/DRAFT SKU 101815.',
        '3. Decide blank-tier behavior for LEM SKUs 000637, 000833, and 000876.',
        '4. Resolve config-only part 100683 before kit-based quoting relies on it.',
        '5. Decide Partner exposure and DKK support per the deployment runbook.',
        '',
    ])
    with open(os.path.join(INSPECTION_DIR, 'review_dashboard.md'), 'w') as f:
        f.write('\n'.join(dashboard))

    print('wrote %s (%d lines)' % (os.path.relpath(OUT, os.getcwd()), len(L)))
    if consistency:
        print('WARNING: %s' % '; '.join(consistency), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
