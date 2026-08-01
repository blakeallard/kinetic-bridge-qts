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
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, ROUND_HALF_UP

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
# Location-independent workbook resolution: argv > LIBAL_RSP_XLSX env >
# optional in-repo fixtures. Never hardcode machine home paths.
NOT_DISCOUNTABLE_OVERRIDES = {'200001'}

_WORKBOOK_NAME = "Lithium Balance BMS_July 01_RSP_Distributor.xlsx"


def resolve_workbook_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    env_path = os.environ.get("LIBAL_RSP_XLSX", "").strip()
    if env_path:
        return env_path
    candidates = [
        os.path.join(HERE, "fixtures", _WORKBOOK_NAME),
        os.path.join(REPO_ROOT, "data", "references", "lithium_balance", "BMS Pricelist", _WORKBOOK_NAME),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    sys.stderr.write(
        "Workbook not found. Pass a path, or set LIBAL_RSP_XLSX to the RSP xlsx.\n"
        "Expected filename: " + _WORKBOOK_NAME + "\n"
    )
    sys.exit(2)


SHEET_NAME = 'RSP_EUR'

CSV_HEADER = ['Part_Number', 'Description', 'Category', 'Tier_Scheme', 'Discountable',
              'Active', 'Item_Status', 'Quote_Warning',
              'Source_Row', 'Source_Visibility', 'Duplicate_Classification',
              'Price_T1', 'Price_T2', 'Price_T3', 'Price_T4', 'Price_T5', 'Price_T6',
              'Price_T7', 'Price_T8', 'Price_T9', 'Review_Flag', 'Review_Reason',
              'Recommended_Action']

# Creator import ONLY — no audit columns (those mis-map and blank out Tier_Scheme).
# Tier_Scheme values must match the live dropdown exactly (Deluge lowercases on read).
CREATOR_CSV_HEADER = [
    'Part_Number', 'Description', 'Category', 'Tier_Scheme', 'Discountable',
    'Active', 'Item_Status', 'Quote_Warning',
    'Price_T1', 'Price_T2', 'Price_T3', 'Price_T4', 'Price_T5',
    'Price_T6', 'Price_T7', 'Price_T8', 'Price_T9',
]

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
CLASSIFICATION_JSON = os.path.join(HERE, 'duplicate_sku_classification.json')
VENDOR_DISCONTINUED_SKUS = {'102100', '103005', '200400', '300400'}

# Item lifecycle status (meeting 2026-07-07: obsolete/discontinued items stay in
# the system with a warn-and-double-check behavior, never a blanket exclusion —
# see docs/MEETING_REQUIREMENTS_2026-07-07.md §R2).
# Evidence per status: Discontinued = workbook red-fill legend rows 26/27/47/59
# (audit/reports/status_marks.csv, matching VENDOR_DISCONTINUED_SKUS);
# Obsolescent = vendor section "Software for obsolesenced BMS"; Not_Released =
# vendor description marked DRAFT or (RELEASE Qn/yyyy). Delivery_Stop is a
# legend value the current RSP_EUR data rows never carry — supported, unused.
OBSOLETE_SECTION = 'Software for obsolesenced BMS'
NOT_RELEASED_RE = re.compile(r'\bDRAFT\b|\(RELEASE Q[1-4]/\d{4}\)')


def derive_item_status(it):
    """Return (Item_Status, Quote_Warning) for one parsed item row."""
    if it['sku'] in VENDOR_DISCONTINUED_SKUS:
        return ('Discontinued',
                'Y — vendor marked Discontinued in July 2026 RSP; warn and double-check before quoting')
    if it['section'] == OBSOLETE_SECTION:
        return ('Obsolescent',
                'Y — vendor section "Software for obsolesenced BMS"; warn and double-check before quoting')
    if NOT_RELEASED_RE.search(it['desc']):
        return ('Not_Released',
                'Y — vendor marks item DRAFT / future release; confirm availability before quoting')
    return ('Active', '')


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


def read_rsp_hidden_map(xlsx_path):
    """Return {sheet_row_number: 'hidden'|'visible'} for RSP_EUR rows."""
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

    visibility = {}
    for row in ET.fromstring(z.read(target)).iter(f'{{{M}}}row'):
        visibility[int(row.get('r'))] = 'hidden' if row.get('hidden') == '1' else 'visible'
    return visibility


def load_duplicate_classification(path):
    with open(path) as f:
        payload = json.load(f)
    return payload.get('skus', {})


def format_price_summary(prices):
    parts = []
    for idx, price in enumerate(prices, start=1):
        if price:
            parts.append(f'T{idx}={price}')
    return ', '.join(parts) if parts else '(no prices)'


def fail_duplicate_validation(issues):
    lines = [
        'Duplicate SKU classification guard failed.',
        'Each duplicated SKU must have exactly one CANONICAL_CANDIDATE row and all other rows marked EXCLUDE_CANDIDATE.',
        'Details:',
    ]
    for sku, problems, rows in issues:
        lines.append(f'- SKU {sku}')
        for problem in problems:
            lines.append(f'  - {problem}')
        for row in rows:
            lines.append(
                '  - row {row}: desc="{desc}", visibility={visibility}, '
                'classification={classification}, prices={prices}'.format(**row)
            )
    raise SystemExit('\n'.join(lines))


def validate_duplicate_classification(items, counts, duplicate_classification):
    issues = []
    row_roles = {}
    duplicates = sorted(sku for sku, count in counts.items() if count > 1)
    for sku in duplicates:
        sku_items = [it for it in items if it['sku'] == sku]
        payload = duplicate_classification.get(sku)
        problems = []
        if payload is None:
            problems.append(f'missing {os.path.relpath(CLASSIFICATION_JSON, HERE)} entry')
        else:
            rows_payload = payload.get('rows', {})
            expected_rows = sorted(int(row) for row in rows_payload)
            actual_rows = sorted(it['row'] for it in sku_items)
            if actual_rows != expected_rows:
                problems.append(f'classification rows {expected_rows} do not match duplicate rows {actual_rows}')

            canonical_rows = []
            exclude_rows = []
            for it in sku_items:
                row_info = rows_payload.get(str(it['row']))
                if row_info is None:
                    problems.append(f'row {it["row"]} is missing from classification JSON')
                    continue
                role = row_info.get('role')
                visibility = row_info.get('visibility')
                if role == 'CANONICAL_CANDIDATE':
                    canonical_rows.append(it['row'])
                elif role == 'EXCLUDE_CANDIDATE':
                    exclude_rows.append(it['row'])
                else:
                    problems.append(f'row {it["row"]} has invalid role {role!r}')
                if visibility != it['visibility']:
                    problems.append(
                        f'row {it["row"]} visibility mismatch: JSON says {visibility}, workbook says {it["visibility"]}'
                    )
                row_roles[it['row']] = {
                    'role': role or '',
                    'visibility': visibility or it['visibility'],
                }

            if len(canonical_rows) != 1:
                problems.append(f'expected exactly one CANONICAL_CANDIDATE, found {len(canonical_rows)}')
            canonical_row = payload.get('canonical_row')
            if canonical_row is not None and canonical_rows and canonical_rows[0] != canonical_row:
                problems.append(
                    f'canonical_row={canonical_row} does not match classified canonical row {canonical_rows[0]}'
                )
            if len(exclude_rows) != max(0, len(sku_items) - 1):
                problems.append(
                    f'expected {len(sku_items) - 1} EXCLUDE_CANDIDATE rows, found {len(exclude_rows)}'
                )

        if problems:
            issues.append((
                sku,
                problems,
                [{
                    'row': it['row'],
                    'desc': it['desc'],
                    'visibility': it['visibility'],
                    'classification': row_roles.get(it['row'], {}).get('role', 'UNCLASSIFIED'),
                    'prices': format_price_summary(it['prices']),
                } for it in sku_items],
            ))

    if issues:
        fail_duplicate_validation(issues)
    return row_roles


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
    xlsx = resolve_workbook_path()
    if not os.path.isfile(xlsx):
        sys.stderr.write("Workbook not found: %s\n" % xlsx)
        sys.exit(2)
    rows = read_rsp_rows(xlsx)
    visibility_map = read_rsp_hidden_map(xlsx)
    duplicate_classification = load_duplicate_classification(CLASSIFICATION_JSON)

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

        # Tail scan beyond the band columns: the DISTRIB DISCOUNT column carries
        # a standalone "X" meaning discountable (vendor legend + Blake 2026-07-31:
        # "Discount to RSP on products marked with X"). Blank / no X = NOT
        # discountable. Anything else out there is junk (e.g. stray "47" on
        # the 200500 row).
        discountable = 'N'
        for i in sorted(cells):
            if i < 2 + nbands:
                continue
            v = cells[i].strip()
            if v == 'X':
                discountable = 'Y'
            elif v:
                junk_notes.append((rownum, col0, f'ignored stray cell at column index {i}: "{v}"'))
        # Explicit override: 200001 stays NOT discountable even if workbook drifts.
        if col0 in NOT_DISCOUNTABLE_OVERRIDES:
            discountable = 'N'

        items.append({
            'row': rownum, 'sku': col0, 'desc': col1, 'section': sec_name,
            'tier_scheme': tier_scheme, 'category': category,
            'prices': prices, 'discountable': discountable,
            'priced': any(p for p in prices),
            'visibility': visibility_map.get(rownum, 'visible'),
        })

    # Duplicate SKU detection
    counts = {}
    for it in items:
        counts[it['sku']] = counts.get(it['sku'], 0) + 1
    duplicate_roles = validate_duplicate_classification(items, counts, duplicate_classification)

    # QC doc citation used below — see docs/LIBAL_REFERENCE_PRICE_QC.md for the full
    # evidence trail (vendor Changes_Log excerpts, raw RSP_EUR cell dump).
    QC_DOC = 'docs/LIBAL_REFERENCE_PRICE_QC.md'

    for it in items:
        flag, reason, active, action = '', '', 'Y', ''
        if counts[it['sku']] > 1:
            flag, active = 'DUPLICATE_SKU', 'REVIEW'
            classification = duplicate_roles[it['row']]['role']
            style = ('hidden legacy row priced only in upper bands'
                     if classification == 'EXCLUDE_CANDIDATE'
                     else 'visible current row priced from band 1')
            reason = (f'SKU {it["sku"]} appears {counts[it["sku"]]}x in {it["section"]}; this is the {style}. '
                      'Bundle-vs-unit pricing ambiguity - confirm which row is the sellable item before import.')
            if it['section'] == 'Service Tool':
                if classification == 'EXCLUDE_CANDIDATE':
                    action = ('EXCLUDE_CANDIDATE (working assumption: hidden legacy row; pending Bill/Bryan '
                              'approval - see duplicate_sku_classification.json and ' + QC_DOC + ')')
                    reason += (' Working assumption: hidden rows are legacy bundle rows excluded from import. '
                               'This is pending Bill/Bryan approval - see duplicate_sku_classification.json and '
                               + QC_DOC + '.')
                else:
                    action = ('CANONICAL_CANDIDATE (working assumption: visible current row; pending Bill/Bryan '
                              'approval - see duplicate_sku_classification.json and ' + QC_DOC + ')')
                    reason += (' Working assumption: visible rows are the current canonical rows. This row matches '
                               'other BMS families\' Service Tool pricing and remains pending Bill/Bryan approval - '
                               'see duplicate_sku_classification.json and ' + QC_DOC + '.')
            else:
                action = 'PENDING_CONFIRMATION (bundle-vs-unit ambiguity)'
        elif not it['priced']:
            flag, active = 'UNPRICED', 'REVIEW'
            if it['sku'] in VENDOR_DISCONTINUED_SKUS:
                reason = (f'No published price in July 2026 RSP (sheet row {it["row"]}); vendor row is marked '
                          'Discontinued. Per meeting 2026-07-07 (docs/MEETING_REQUIREMENTS_2026-07-07.md §R2) '
                          'discontinued items are imported with a quote-time warning, not excluded. UNPRICED '
                          'precedence still applies: no published price means quoting stays blocked until a '
                          'price or manual-price decision exists - see ' + QC_DOC + '.')
                action = ('IMPORT_WITH_WARNING (vendor discontinued - warn and double-check before quoting; '
                          'UNPRICED, so quoting remains blocked pending price/manual decision)')
            else:
                reason = (f'No published price in July 2026 RSP (sheet row {it["row"]}); listed without price points. '
                          'Confirmed genuinely unpriced in the raw source cells (not a parsing gap) - see ' + QC_DOC + '.')
                action = 'BLOCKED_NO_PRICE (pending Bill/Bryan decision - import/exclude/manual price)'
        elif it['section'] == 'Service Tool':
            flag = 'CONFIRM_DISCOUNT_CLASS'
            reason = 'confirm flat software discount applies to service tools'
            action = 'PENDING_CONFIRMATION (discount class)'
        it['dup_classification'] = duplicate_roles.get(it['row'], {}).get('role', '')
        it['flag'], it['reason'], it['active'], it['action'] = flag, reason, active, action
        it['status'], it['warning'] = derive_item_status(it)

    def item_csv_row(it):
        """Audit preview row — full CSV_HEADER."""
        p = it['prices'] + [''] * (9 - len(it['prices']))
        return [it['sku'], it['desc'], it['category'], it['tier_scheme'],
                it['discountable'], it['active'], it['status'], it['warning'],
                it['row'], it['visibility'],
                it['dup_classification']] + p + [it['flag'], it['reason'], it['action']]

    def creator_csv_row(it, *, include_tier=True, tier_style='lower'):
        """Creator-only columns. Tier_Scheme style: lower | title | omit."""
        p = it['prices'] + [''] * (9 - len(it['prices']))
        category = 'BMS' if it['category'] == 'Hardware' else it['category']
        active = it['active'] if it['active'] in ('Y', 'N') else 'Y'
        tier = it['tier_scheme']  # hardware | license
        if tier_style == 'title':
            tier = tier[:1].upper() + tier[1:]  # Hardware | License
        row = [it['sku'], it['desc'], category]
        if include_tier:
            row.append(tier)
        row += [it['discountable'], active, it['status'], it['warning']] + p
        return row

    def creator_header(include_tier=True):
        if include_tier:
            return list(CREATOR_CSV_HEADER)
        return [c for c in CREATOR_CSV_HEADER if c != 'Tier_Scheme']

    # ---- Audit preview (familiar full layout; do NOT import into Creator) ----
    csv_path = os.path.join(HERE, 'item_master_import_preview.csv')
    with open(csv_path, 'w', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(CSV_HEADER)
        for it in items:
            w.writerow(item_csv_row(it))

    # ---- Creator import (NO audit columns — they blank Tier_Scheme on map) ----
    creator_csv_path = os.path.join(HERE, 'item_master_import_for_creator.csv')
    with open(creator_csv_path, 'w', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(creator_header(include_tier=True))
        for it in items:
            w.writerow(creator_csv_row(it, include_tier=True, tier_style='lower'))

    # Fallback if live dropdown is Hardware/License (title case)
    creator_title_path = os.path.join(HERE, 'item_master_import_for_creator_tier_titlecase.csv')
    with open(creator_title_path, 'w', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(creator_header(include_tier=True))
        for it in items:
            w.writerow(creator_csv_row(it, include_tier=True, tier_style='title'))

    # Fallback if Tier_Scheme picklist blocks import: omit column (Deluge defaults blank→hardware).
    # Set license SKUs manually afterward, or fix dropdown then re-import title/lower file.
    creator_no_tier_path = os.path.join(HERE, 'item_master_import_for_creator_no_tier_scheme.csv')
    with open(creator_no_tier_path, 'w', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(creator_header(include_tier=False))
        for it in items:
            w.writerow(creator_csv_row(it, include_tier=False))

    disc_csv_path = os.path.join(HERE, 'item_master_discountable_update.csv')
    with open(disc_csv_path, 'w', newline='') as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(['Part_Number', 'Discountable'])
        for it in items:
            w.writerow([it['sku'], it['discountable']])

    # ---- Report ----
    total = len(items)
    priced = sum(1 for it in items if it['priced'])
    unpriced = total - priced
    dup_skus = sorted(s for s, c in counts.items() if c > 1)
    dup_rows = sum(1 for it in items if it['flag'] == 'DUPLICATE_SKU')
    review_active = sum(1 for it in items if it['active'] == 'REVIEW')
    flagged = [it for it in items if it['flag']]

    warned = [it for it in items if it['warning']]

    def md_row(it):
        p = it['prices'] + [''] * (9 - len(it['prices']))
        return ('| ' + ' | '.join([str(it['row']), it['sku'], it['desc'][:55], it['category'],
                                   it['tier_scheme'], it['discountable'], it['active'],
                                   it['status'], it['warning'],
                                   it['visibility'], it['dup_classification']]
                                  + p + [it['flag'], it['reason'], it['action']]) + ' |')

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
    lines.append('6. A standalone `X` in the row tail (the DISTRIB DISCOUNT column, beyond the band columns) sets `Discountable=Y` (discountable); absent/blank = `N` (NOT discountable) — vendor legend on sheet `Distrib discount` ("Discount to RSP on products marked with X") and Blake 2026-07-31. Explicit exception: `200001` is always `N`. Other stray tail cells are ignored as junk (see notes).')
    lines.append('7. Category proposal: BMS boards -> Hardware; Accessories -> Accessory; Creator Tool / Service Tool / obsolete software -> Software.')
    lines.append('8. Review flag precedence per row: `DUPLICATE_SKU` > `UNPRICED` > `CONFIRM_DISCOUNT_CLASS`. `Active=REVIEW` for duplicate/unpriced rows; `Active=Y` otherwise (no `N` rows in this pass).')
    lines.append('9. `import_preview/duplicate_sku_classification.json` is the single source of truth for duplicate-SKU working assumptions. Preview generation verifies the workbook row visibility against that file and fails loudly if any duplicate SKU lacks exactly one `CANONICAL_CANDIDATE` row with all others marked `EXCLUDE_CANDIDATE`.')
    lines.append('10. `Recommended_Action` is a non-destructive, additive column — it never changes `Active` or removes a row. It surfaces an evidence-backed recommendation (see docs/LIBAL_REFERENCE_PRICE_QC.md) for Bill/Bryan to approve or reject; no row is auto-decided or auto-excluded by this script.')
    lines.append('11. Identical Creator License / Service Tool pricing across n-BMS, c-BMS24, c-BMS24X, and i-BMS (see rows for SKUs 200200/200500 and 300200/300500) is **not** flagged as an error here. It is vendor-documented: the source workbook\'s `Changes_Log` sheet records "Added Creator/Service Unified version" (change batch dated 2024-09-01). See docs/LIBAL_NBMS_CBMS24_PRICE_QC.md and docs/LIBAL_REFERENCE_PRICE_QC.md for the full evidence trail.')
    lines.append('12. `Item_Status` + `Quote_Warning` implement the 2026-07-07 meeting policy (docs/MEETING_REQUIREMENTS_2026-07-07.md §R2): obsolete/discontinued items are imported with a quote-time warn-and-double-check, never blanket-excluded. Statuses: `Discontinued` = workbook red-fill legend (audit/reports/status_marks.csv); `Obsolescent` = section "Software for obsolesenced BMS"; `Not_Released` = description marked DRAFT / (RELEASE Qn/yyyy); `Delivery_Stop` = supported legend value, carried by no current RSP_EUR item row; `Active` otherwise. Precedence unchanged: UNPRICED rows stay `Active=REVIEW` and unquotable until priced, regardless of status.')
    lines.append('')
    lines.append('## Counts')
    lines.append('')
    lines.append('| Metric | Count |')
    lines.append('|---|---|')
    lines.append(f'| Total item rows parsed | {total} |')
    lines.append(f'| Priced | {priced} |')
    lines.append(f'| Unpriced | {unpriced} |')
    lines.append(f'| Duplicate SKUs | {len(dup_skus)} ({", ".join(dup_skus)}) - {dup_rows} rows |')
    lines.append(f'| Rows with Active=REVIEW | {review_active} |')
    lines.append(f'| Rows with any Review_Flag | {len(flagged)} |')
    status_counts = {}
    for it in items:
        status_counts[it['status']] = status_counts.get(it['status'], 0) + 1
    status_summary = ', '.join(f'{s}={c}' for s, c in sorted(status_counts.items()))
    lines.append(f'| Item_Status breakdown | {status_summary} |')
    lines.append(f'| Rows with Quote_Warning | {len(warned)} |')
    lines.append('')
    lines.append('## Known data-quality notes')
    lines.append('')
    lines.append('- **Accessories band-header typo**: header reads `20-199` where every other hardware section reads `20-99`. Accessory rows only populate the first 1-2 price points, so the typo does not change any parsed data; no per-row flag was added.')
    lines.append('- **Stray junk cells ignored**:')
    for rownum, sku, note in junk_notes:
        lines.append(f'  - Sheet row {rownum} (SKU {sku}): {note}')
    if not junk_notes:
        lines.append('  - none')
    lines.append('- **Duplicate SKU detail**: 300500 and 300300 each appear twice in Service Tool. `duplicate_sku_classification.json` classifies rows 54/55 as hidden `EXCLUDE_CANDIDATE` legacy rows and rows 58/60 as visible `CANONICAL_CANDIDATE` current rows. This is a working assumption pending Bill/Bryan approval; preview generation aborts if workbook visibility or duplicate classifications drift from that file.')
    lines.append('- **Vendor-documented unified Creator/Service pricing**: SKUs 200200/200500 (Creator License FULL) and 300200/300500 (Service Tool, unit-price rows) are priced identically across c-BMS24 and n-BMS (and i-BMS/c-BMS24X). This is confirmed intentional via the source workbook\'s `Changes_Log` ("Added Creator/Service Unified version", 2024-09-01 batch) - see docs/LIBAL_NBMS_CBMS24_PRICE_QC.md and docs/LIBAL_REFERENCE_PRICE_QC.md. Not flagged as a data-quality issue.')
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
    lines.append('`Recommended_Action` is advisory only (see Methodology #9) - it does not change `Active` or exclude any row from this preview.')
    lines.append('')
    lines.append('| Sheet row | Part_Number | Description | Category | Tier_Scheme | Disc | Active | Item_Status | Quote_Warning | Visibility | Duplicate_Class | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | Review_Flag | Review_Reason | Recommended_Action |')
    lines.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for it in flagged:
        lines.append(md_row(it))
    lines.append('')
    lines.append('## Quote-warning rows (Item_Status != Active)')
    lines.append('')
    lines.append('Imported with a quote-time warn-and-double-check per meeting 2026-07-07 (docs/MEETING_REQUIREMENTS_2026-07-07.md §R2). Unpriced rows additionally stay blocked from quoting until priced.')
    lines.append('')
    lines.append('| Sheet row | Part_Number | Description | Item_Status | Priced | Quote_Warning |')
    lines.append('|---|---|---|---|---|---|')
    for it in warned:
        lines.append('| ' + ' | '.join([str(it['row']), it['sku'], it['desc'][:55], it['status'],
                                         'Y' if it['priced'] else 'N', it['warning']]) + ' |')
    lines.append('')

    report_path = os.path.join(HERE, 'import_preview_report.md')
    with open(report_path, 'w') as f:
        f.write('\n'.join(lines))

    print(f'Wrote {csv_path} ({total} item rows) [audit — do not import]')
    print(f'Wrote {creator_csv_path} [IMPORT — Tier_Scheme=hardware|license]')
    print(f'Wrote {creator_title_path} [IMPORT alt — Tier_Scheme=Hardware|License]')
    print(f'Wrote {creator_no_tier_path} [IMPORT alt — no Tier_Scheme column]')
    print(f'Wrote {disc_csv_path} (Part_Number + Discountable only)')
    print(f'Wrote {report_path}')
    print(f'total={total} priced={priced} unpriced={unpriced} dup_skus={len(dup_skus)} '
          f'dup_rows={dup_rows} active_review={review_active} flagged={len(flagged)}')


if __name__ == '__main__':
    main()
