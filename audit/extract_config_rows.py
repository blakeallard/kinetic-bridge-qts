#!/usr/bin/env python3
"""Extract the six BMS configuration sheets into the config_row table.

Reads audit/workbook_audit.sqlite only (never the workbook). The config sheets
share one layout: a header row whose column 1 is 'Part number', followed by
data rows: col 1 = part number, col 2 = product name, col 3 = qty per system
(numeric, a range like '1 - 30', or 'x'), col 4 = comment.

Conservative classification: `requirement` is set to 'optional' only when the
comment explicitly begins with "Optional", to 'main' only when the comment is
exactly "Main product". Everything else stays NULL — the sheets don't prove a
required/optional status beyond that, so none is invented. The full comment is
always preserved in `notes`, and the verbatim qty cell in `qty_raw` (the
numeric `quantity` column is filled only when the cell is a plain number).

Rows above the header (kit titles like 'i-BMS kit', '96 Channels /400 V with
NMC cells') are captured per sheet as context and echoed in the report header.

Output:
  - repopulates config_row (delete + insert; idempotent)
  - writes audit/reports/config_rows.csv
  - prints per-sheet counts, rows missing a part number, optional-marked rows

Usage:
    python3 audit/extract_config_rows.py [--db path/to/workbook_audit.sqlite]
"""
import argparse
import csv
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, 'workbook_audit.sqlite')
REPORT = os.path.join(HERE, 'reports', 'config_rows.csv')

CONFIG_SHEETS = ['i-BMS config ', 'c-BMS24 config', 'c-BMS24X config',
                 'n-BMS w 100809', 'n3-BMS w 100809', 'n3-BMS w 101814']
HEADER_MARKER = 'part number'


def ensure_qty_raw_column(db):
    cols = [r[1] for r in db.execute('PRAGMA table_info(config_row)')]
    if 'qty_raw' not in cols:
        db.execute('ALTER TABLE config_row ADD COLUMN qty_raw TEXT')


def classify_requirement(comment):
    """Only what the sheet explicitly proves; otherwise NULL."""
    if not comment:
        return None
    c = comment.strip().lower()
    if c.startswith('optional'):
        return 'optional'
    if c == 'main product':
        return 'main'
    return None


def sheet_grid(db, sheet_id):
    """{row_num: {col_num: value}} for one sheet."""
    grid = {}
    for r, col, v in db.execute(
            'SELECT row_num, col_num, value_text FROM cell WHERE sheet_id=?'
            ' ORDER BY row_num, col_num', (sheet_id,)):
        grid.setdefault(r, {})[col] = v
    return grid


def main():
    ap = argparse.ArgumentParser(
        description='Extract BMS config sheets into config_row + CSV report.')
    ap.add_argument('--db', default=DEFAULT_DB,
                    help='path to workbook_audit.sqlite (default: %(default)s)')
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit('DB not found: %s (run load_workbook.py first)' % args.db)
    db = sqlite3.connect(args.db)
    ensure_qty_raw_column(db)

    sheets = dict(db.execute(
        'SELECT name, sheet_id FROM sheet ORDER BY position'))
    missing_sheets = [n for n in CONFIG_SHEETS if n not in sheets]
    if missing_sheets:
        sys.exit('config sheets not in DB: %r' % missing_sheets)

    all_rows = []      # (sheet_name, row, part, desc, qty_num, qty_raw, req, notes)
    contexts = {}      # sheet_name -> list of pre-header context strings
    for name in CONFIG_SHEETS:
        grid = sheet_grid(db, sheets[name])
        header_row = None
        for r in sorted(grid):
            if (grid[r].get(1) or '').strip().lower() == HEADER_MARKER:
                header_row = r
                break
        if header_row is None:
            print('warning: no %r header row on %r — sheet skipped'
                  % (HEADER_MARKER, name), file=sys.stderr)
            continue
        contexts[name] = [
            ' | '.join(v.strip() for v in grid[r].values() if v and v.strip())
            for r in sorted(grid) if r < header_row]

        for r in sorted(grid):
            if r <= header_row:
                continue
            part = (grid[r].get(1) or '').strip() or None
            desc = (grid[r].get(2) or '').strip() or None
            qty_raw = (grid[r].get(3) or '').strip() or None
            notes = (grid[r].get(4) or '').strip() or None
            if not (part or desc or qty_raw or notes):
                continue
            qty_num = None
            if qty_raw is not None:
                try:
                    qty_num = float(qty_raw)
                except ValueError:
                    pass
            all_rows.append((name, sheets[name], r, part, desc,
                             qty_num, qty_raw, classify_requirement(notes), notes))

    db.execute('DELETE FROM config_row')
    db.executemany(
        'INSERT INTO config_row(sheet_id, row_num, part_number, description,'
        ' quantity, qty_raw, requirement, notes) VALUES (?,?,?,?,?,?,?,?)',
        [(sid, r, part, desc, qn, qr, req, notes)
         for _n, sid, r, part, desc, qn, qr, req, notes in all_rows])
    db.commit()

    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['sheet', 'row', 'part_number', 'description',
                    'quantity', 'qty_raw', 'requirement', 'notes'])
        for name, _sid, r, part, desc, qn, qr, req, notes in all_rows:
            w.writerow([name, r, part or '', desc or '',
                        '' if qn is None else qn, qr or '', req or '', notes or ''])

    print('sheet contexts (rows above header):')
    for name in CONFIG_SHEETS:
        for line in contexts.get(name, []):
            print('  %-16s %s' % (name, line))
    print('\n%d config rows -> config_row table + %s'
          % (len(all_rows), os.path.relpath(REPORT, os.getcwd())))
    print('\nrows per sheet:')
    for name in CONFIG_SHEETS:
        print('  %-16s %3d' % (name, sum(1 for x in all_rows if x[0] == name)))
    no_part = [x for x in all_rows if not x[3]]
    print('\nrows missing part number: %d' % len(no_part))
    for name, _sid, r, _p, desc, _qn, qr, _req, notes in no_part:
        print('  %s row %d: desc=%r qty=%r notes=%r' % (name, r, desc, qr, notes))
    print('\nrequirement classification:')
    for label in ('optional', 'main', None):
        n = sum(1 for x in all_rows if x[7] == label)
        print('  %-10s %3d' % (label or '(unclassified)', n))


if __name__ == '__main__':
    main()
