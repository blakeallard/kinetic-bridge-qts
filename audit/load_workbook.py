#!/usr/bin/env python3
"""Load the July 2026 Lithium Balance workbook into a local SQLite audit DB.

Layer-1 loader only: sheets, merged ranges, styles (fills/fonts), and every
cell (value, type, formula, style) from ALL 9 sheets. Derived tables
(product_row, price_point, config_row, status_mark) are created empty and
populated by later classify scripts.

Read-only on the workbook; writes only audit/workbook_audit.sqlite.
Stdlib-only (no openpyxl), same approach as import_preview/generate_preview.py.

Usage:
    python3 audit/load_workbook.py [path/to/workbook.xlsx]
"""
import hashlib
import os
import re
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone

try:  # prefer defusedxml (XXE/billion-laughs hardening) when available
    from defusedxml import ElementTree as ET
except ImportError:
    from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
_WORKBOOK_NAME = "Lithium Balance BMS_July 01_RSP_Distributor.xlsx"
DB_PATH = os.path.join(HERE, 'workbook_audit.sqlite')
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def resolve_workbook_path():
    """argv > LIBAL_RSP_XLSX env > optional in-repo data/fixtures. No machine home paths."""
    if len(sys.argv) > 1:
        return sys.argv[1]
    env_path = os.environ.get("LIBAL_RSP_XLSX", "").strip()
    if env_path:
        return env_path
    candidates = [
        os.path.join(HERE, "fixtures", _WORKBOOK_NAME),
        os.path.join(REPO_ROOT, "import_preview", "fixtures", _WORKBOOK_NAME),
        os.path.join(REPO_ROOT, "data", "references", "lithium_balance", "BMS Pricelist", _WORKBOOK_NAME),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    sys.stderr.write(
        "Workbook not found. Pass a path, or set LIBAL_RSP_XLSX to the RSP xlsx.\n"
    )
    sys.exit(2)


def col_to_num(ref):
    m = re.match(r'([A-Z]+)(\d+)', ref)
    col = 0
    for ch in m.group(1):
        col = col * 26 + (ord(ch) - 64)
    return col, int(m.group(2))


def load_shared_strings(z):
    if 'xl/sharedStrings.xml' not in z.namelist():
        return []
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    return [''.join(t.text or '' for t in si.iter(
        '{%s}t' % NS['m'])) for si in root.findall('m:si', NS)]


def load_styles(z):
    """Return {xf_index: (fill_rgb, font_rgb, bold, strike, num_fmt)}."""
    if 'xl/styles.xml' not in z.namelist():
        return {}
    root = ET.fromstring(z.read('xl/styles.xml'))

    fills = []
    for fill in root.findall('m:fills/m:fill', NS):
        rgb = None
        pf = fill.find('m:patternFill', NS)
        if pf is not None and pf.get('patternType') == 'solid':
            fg = pf.find('m:fgColor', NS)
            if fg is not None:
                rgb = fg.get('rgb') or ('theme:' + fg.get('theme', '')
                                        if fg.get('theme') else None)
        fills.append(rgb)

    fonts = []
    for f in root.findall('m:fonts/m:font', NS):
        color = f.find('m:color', NS)
        fonts.append((
            color.get('rgb') if color is not None else None,
            1 if f.find('m:b', NS) is not None else 0,
            1 if f.find('m:strike', NS) is not None else 0,
        ))

    numfmts = {nf.get('numFmtId'): nf.get('formatCode')
               for nf in root.findall('m:numFmts/m:numFmt', NS)}

    styles = {}
    xfs = root.find('m:cellXfs', NS)
    if xfs is not None:
        for i, xf in enumerate(xfs.findall('m:xf', NS)):
            fill_i = int(xf.get('fillId', 0))
            font_i = int(xf.get('fontId', 0))
            font_rgb, bold, strike = fonts[font_i] if font_i < len(fonts) else (None, 0, 0)
            styles[i] = (
                fills[fill_i] if fill_i < len(fills) else None,
                font_rgb, bold, strike,
                numfmts.get(xf.get('numFmtId')),
            )
    return styles


def sheet_targets(z):
    """Yield (position, name, state, zip_member) in tab order."""
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid_to_target = {
        rel.get('Id'): rel.get('Target')
        for rel in rels.findall(
            '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship')}
    for pos, s in enumerate(wb.find('m:sheets', NS)):
        target = rid_to_target[s.get('{%s}id' % NS['r'])]
        member = 'xl/' + target.lstrip('/') if not target.startswith('xl/') else target
        yield pos, s.get('name'), s.get('state'), member


def main():
    xlsx = resolve_workbook_path()
    if not os.path.exists(xlsx):
        sys.exit('workbook not found: %s' % xlsx)

    with open(xlsx, 'rb') as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    db = sqlite3.connect(DB_PATH)
    with open(os.path.join(HERE, 'schema.sql')) as f:
        db.executescript(f.read())

    existing = db.execute('SELECT workbook_id FROM workbook WHERE sha256=?',
                          (sha,)).fetchone()
    if existing:
        print('already loaded (workbook_id=%d, sha256=%s...) — nothing to do'
              % (existing[0], sha[:12]))
        return

    z = zipfile.ZipFile(xlsx)
    strings = load_shared_strings(z)
    styles = load_styles(z)

    cur = db.execute('INSERT INTO workbook(path, sha256, loaded_at) VALUES (?,?,?)',
                     (xlsx, sha, datetime.now(timezone.utc).isoformat()))
    wb_id = cur.lastrowid

    for xf_index, (fill, font_rgb, bold, strike, fmt) in styles.items():
        db.execute('INSERT INTO style(style_id, workbook_id, fill_rgb, font_rgb,'
                   ' font_bold, font_strike, num_fmt) VALUES (?,?,?,?,?,?,?)',
                   (xf_index, wb_id, fill, font_rgb, bold, strike, fmt))

    total_cells = 0
    for pos, name, state, member in sheet_targets(z):
        root = ET.fromstring(z.read(member))
        dim = root.find('m:dimension', NS)
        cur = db.execute(
            'INSERT INTO sheet(workbook_id, position, name, state, dimension)'
            ' VALUES (?,?,?,?,?)',
            (wb_id, pos, name, state, dim.get('ref') if dim is not None else None))
        sheet_id = cur.lastrowid

        for mc in root.findall('m:mergeCells/m:mergeCell', NS):
            db.execute('INSERT INTO merged_range(sheet_id, range_ref) VALUES (?,?)',
                       (sheet_id, mc.get('ref')))

        n = 0
        for c in root.iter('{%s}c' % NS['m']):
            ref = c.get('r')
            if not ref:
                continue
            col, row = col_to_num(ref)
            ctype = c.get('t', 'n')
            v = c.find('m:v', NS)
            f = c.find('m:f', NS)
            is_node = c.find('m:is', NS)
            raw = v.text if v is not None else None
            text, num = None, None
            if ctype == 's' and raw is not None:
                text = strings[int(raw)]
            elif ctype == 'inlineStr' and is_node is not None:
                text = ''.join(t.text or '' for t in is_node.iter('{%s}t' % NS['m']))
            elif raw is not None:
                text = raw
                try:
                    num = float(raw)
                except ValueError:
                    pass
            if text is None and f is None:
                continue  # empty styled cell — style-only cells add noise
            db.execute(
                'INSERT INTO cell(sheet_id, row_num, col_num, cell_ref, value_text,'
                ' value_num, cell_type, formula, style_id) VALUES (?,?,?,?,?,?,?,?,?)',
                (sheet_id, row, col, ref, text, num, ctype,
                 f.text if f is not None else None,
                 int(c.get('s')) if c.get('s') else None))
            n += 1
        total_cells += n
        print('  sheet %-18r %5d cells' % (name, n))

    db.commit()
    print('loaded workbook_id=%d sha256=%s... -> %s (%d cells, %d styles)'
          % (wb_id, sha[:12], DB_PATH, total_cells, len(styles)))


if __name__ == '__main__':
    main()
