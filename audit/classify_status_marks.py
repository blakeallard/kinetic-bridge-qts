#!/usr/bin/env python3
"""Decode the RSP_EUR row-1 fill-color legend and classify status-marked cells.

Reads audit/workbook_audit.sqlite (built by load_workbook.py) only — never the
workbook itself. Finds the legend labels on RSP_EUR row 1 (CHANGE /
Discontinued / NOT RELEASED / Delivery STOP / New Item added), maps each to its
cell's fill token, then scans every cell in the DB for matching fills.

Output:
  - repopulates the `status_mark` table (delete + insert; idempotent)
  - writes audit/reports/status_marks.csv (sheet, row, col, cell, value,
    label, fill)
  - prints summary counts by label

Known limitation: fills stored as `theme:N` are matched by token, not resolved
RGB — theme tints are not captured by the loader, so a theme fill that differs
only by tint would collide. In this workbook that affects `New Item added`
(theme:4) and `NOT RELEASED` (theme:1, which marks no data cells).

Usage:
    python3 audit/classify_status_marks.py [--db path/to/workbook_audit.sqlite]
"""
import argparse
import csv
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, 'workbook_audit.sqlite')
REPORT = os.path.join(HERE, 'reports', 'status_marks.csv')

LEGEND_LABELS = ['CHANGE', 'Discontinued', 'NOT RELEASED',
                 'Delivery STOP', 'New Item added']
LEGEND_SHEET = 'RSP_EUR'
LEGEND_ROW = 1


def read_legend(db):
    """Return {fill_token: label} from the RSP_EUR row-1 legend cells."""
    rows = db.execute(
        """SELECT c.value_text, s.fill_rgb, c.cell_ref
           FROM cell c
           JOIN sheet sh ON sh.sheet_id = c.sheet_id
           LEFT JOIN style s ON s.style_id = c.style_id
           WHERE sh.name = ? AND c.row_num = ?""",
        (LEGEND_SHEET, LEGEND_ROW)).fetchall()
    legend = {}
    for value, fill, ref in rows:
        label = (value or '').strip()
        if label in LEGEND_LABELS:
            if fill is None:
                print('warning: legend cell %s (%r) has no solid fill — '
                      'label cannot be matched' % (ref, label), file=sys.stderr)
                continue
            if fill in legend and legend[fill] != label:
                sys.exit('legend fill collision: %r used by both %r and %r'
                         % (fill, legend[fill], label))
            legend[fill] = label
    missing = set(LEGEND_LABELS) - set(legend.values())
    if missing:
        print('warning: legend labels not found/mapped: %s'
              % ', '.join(sorted(missing)), file=sys.stderr)
    return legend


def main():
    ap = argparse.ArgumentParser(
        description='Classify workbook cells by the RSP_EUR fill-color legend.')
    ap.add_argument('--db', default=DEFAULT_DB,
                    help='path to workbook_audit.sqlite (default: %(default)s)')
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit('DB not found: %s (run load_workbook.py first)' % args.db)
    db = sqlite3.connect(args.db)

    legend = read_legend(db)
    if not legend:
        sys.exit('no legend fills mapped — nothing to classify')
    print('legend:')
    for fill, label in sorted(legend.items(), key=lambda kv: kv[1]):
        print('  %-15s %s' % (label, fill))

    placeholders = ','.join('?' * len(legend))
    marks = db.execute(
        """SELECT sh.sheet_id, sh.name, c.row_num, c.col_num, c.cell_ref,
                  c.value_text, s.fill_rgb
           FROM cell c
           JOIN sheet sh ON sh.sheet_id = c.sheet_id
           JOIN style s ON s.style_id = c.style_id
           WHERE s.fill_rgb IN (%s)
             AND NOT (sh.name = ? AND c.row_num = ?)   -- exclude the legend itself
           ORDER BY sh.position, c.row_num, c.col_num""" % placeholders,
        list(legend) + [LEGEND_SHEET, LEGEND_ROW]).fetchall()

    db.execute('DELETE FROM status_mark')
    db.executemany(
        'INSERT INTO status_mark(sheet_id, row_num, col_num, fill_rgb,'
        ' legend_label) VALUES (?,?,?,?,?)',
        [(sid, r, col, fill, legend[fill])
         for sid, _n, r, col, _ref, _v, fill in marks])
    db.commit()

    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['sheet', 'row', 'col', 'cell_ref', 'value',
                    'status_label', 'fill'])
        for _sid, name, r, col, ref, value, fill in marks:
            w.writerow([name, r, col, ref, value or '', legend[fill], fill])

    counts = {}
    for *_ignored, fill in marks:
        counts[legend[fill]] = counts.get(legend[fill], 0) + 1
    print('\n%d status-marked cells -> status_mark table + %s'
          % (len(marks), os.path.relpath(REPORT, os.getcwd())))
    for label in LEGEND_LABELS:
        print('  %-15s %4d' % (label, counts.get(label, 0)))


if __name__ == '__main__':
    main()
