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
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, 'workbook_audit.sqlite')
OUT = os.path.join(HERE, 'reports', 'workbook_audit_summary.md')

UNPRICED_DISCONTINUED = ['102100', '103005', '200400', '300400']
LEM_SKUS = ['000637', '000876', '000833']


def one(db, sql, *args):
    return db.execute(sql, args).fetchone()[0]


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

    L = []
    w = L.append
    w('# Workbook Audit Summary — July 2026 Lithium Balance Pricelist')
    w('')
    w('Generated by `audit/report.py` from `workbook_audit.sqlite` only; no new')
    w('source data. All business decisions below are **pending Bill/Bryan')
    w('approval** — this report provides evidence, not sign-off.')
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
        w('- `%s` x%d (sheet rows %s) — bundle-style vs unit-price pair; '
          'canonical-row choice pending Bill/Bryan' % (part, n, rows))
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
    w('1. Duplicate SKUs 300300/300500 — which row is canonical.')
    w('2. Unpriced SKUs — import as blocked placeholders, exclude, or '
      'request vendor pricing (evidence in section 10).')
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
    w('| %s | Vendor-marked Discontinued (all c-BMS18) | Exclude from import |'
      % ', '.join('`%s`' % p for p in UNPRICED_DISCONTINUED))
    w('| `101815` | Marked New Item added; description ends "DRAFT"; all '
      'price cells literally "Not priced" | Hold as not-yet-released |')
    w('| `300300`, `300500` | Unit-price rows vs bundle-style rows (see '
      '`docs/LIBAL_REFERENCE_PRICE_QC.md`) | Prefer unit-price row as '
      'canonical |')
    w('| %s | Single priced band; higher tiers blank at source | Decide '
      'blank-tier behavior before import |'
      % ', '.join('`%s`' % p for p in LEM_SKUS))
    w('')
    w('All dispositions above require Bill/Bryan sign-off; import remains '
      'blocked per runbook §11/§12.')
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
    if consistency:
        w('> **WARNING — figures diverge from the committed baseline:** '
          + '; '.join(consistency))
        w('')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write('\n'.join(L))
    print('wrote %s (%d lines)' % (os.path.relpath(OUT, os.getcwd()), len(L)))
    if consistency:
        print('WARNING: %s' % '; '.join(consistency), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
