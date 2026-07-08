#!/usr/bin/env python3
"""Validate kit_bom/kit_components.csv against the Item_Master import preview.

Proves (rather than asserts) the kit BOM seed data:
  - every Component_SKU / Alternate_SKU exists in
    import_preview/item_master_import_preview.csv, EXCEPT rows explicitly
    marked blocked/unquotable (Confidence=pending_business AND Notes contains
    'not_in_rsp_unquotable') — those are reported, never silently accepted
  - an unknown SKU without that marker fails the run (nonzero exit)
  - 300300 and 300500 resolve to canonical visible rows in the preview
    (Duplicate_Classification=CANONICAL_CANDIDATE, Source_Visibility=visible)
  - column enums are valid (Requirement explicitly includes
    required_removable — a line that defaults onto the quote but is
    removable, e.g. the CAN adapter the customer may already own),
    exactly one 'main' row per kit, and the main row's SKU matches
    Kit_Main_SKU
  - Channels_Per_CMU agrees with the CMU<N> token in the item description
  - CMU quantity math: qty = ceil(series_cells / channels) with bounds
    (>=4 cells per CMU; <=30 CMUs — vendor config sheets say "1 - 30",
    the official n-BMS page says 1-32, the tighter vendor bound wins,
    so e.g. 384 cells on CMU12 is REJECTED (needs 32 CMUs) and the
    highest passing CMU12 system is 360 cells; <=384 series cells)

Counts (kits, component rows, SKU references) are computed from the CSVs
at runtime — nothing is hardcoded.

Read-only; exits 0 on PASS, 1 on any failure. Stdlib only.

Usage:
    python3 scripts/kit_bom_check.py
"""
import csv
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BOM_CSV = os.path.join(REPO, 'kit_bom', 'kit_components.csv')
PREVIEW_CSV = os.path.join(REPO, 'import_preview', 'item_master_import_preview.csv')

EXPECTED_HEADER = ['Kit_Key', 'Kit_Main_SKU', 'Component_SKU', 'Description',
                   'Requirement', 'Qty_Rule', 'Qty_Value', 'Channels_Per_CMU',
                   'Alternate_SKU', 'Confidence', 'Source_Row', 'Notes']
VALID_REQUIREMENT = {'main', 'required', 'required_removable', 'optional', 'manual'}
VALID_QTY_RULE = {'fixed', 'cmu_from_series_cells', 'match_cmu_qty', 'match_mcu_qty', 'manual'}
VALID_CONFIDENCE = {'vendor_config', 'datasheet_confirmed', 'pending_datasheet', 'pending_business'}
BLOCKED_MARKER = 'not_in_rsp_unquotable'
CMU_DESC_RE = re.compile(r'CMU(\d+)')

# Engineering bounds — see docs/BMS_KIT_AUTOPOPULATION_SPEC.md for sources.
MIN_CELLS_PER_CMU = 4     # official n-BMS page: "Number of cells per unit: 4-12 Cells"
MAX_CMUS = 30             # vendor config sheets: "1 - 30" (official page says 1-32; tighter wins)
MAX_SERIES_CELLS = 384    # official n-BMS page system maximum

# (series_cells, channels_per_cmu, expected_cmu_qty)
CMU_MATH_CASES = [(96, 12, 8), (96, 18, 6), (13, 12, 2), (24, 12, 2), (25, 12, 3)]

# (series_cells, channels, expected_failure_reason or None if it must pass)
CMU_BOUNDS_CASES = [
    (3, 12, 'below 4-cell minimum'),
    (385, 12, 'above 384-cell maximum'),
    (384, 12, 'needs 32 CMUs, above the 30-CMU vendor-config cap'),
    (360, 12, None),   # 30 CMUs — highest passing CMU12 system under the 30-CMU cap
]


def required_cmus(series_cells, channels):
    if series_cells < MIN_CELLS_PER_CMU:
        raise ValueError(f'series_cells={series_cells} below {MIN_CELLS_PER_CMU}-cell minimum')
    if series_cells > MAX_SERIES_CELLS:
        raise ValueError(f'series_cells={series_cells} above {MAX_SERIES_CELLS}-cell maximum')
    qty = math.ceil(series_cells / channels)
    if qty > MAX_CMUS:
        raise ValueError(f'required CMUs {qty} above {MAX_CMUS}-CMU maximum')
    return qty


def load_preview():
    """Return {Part_Number: [row, ...]} from the import preview CSV."""
    by_sku = {}
    with open(PREVIEW_CSV, newline='') as f:
        for row in csv.DictReader(f):
            by_sku.setdefault(row['Part_Number'], []).append(row)
    return by_sku


def main():
    errors = []
    preview = load_preview()

    with open(BOM_CSV, newline='') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != EXPECTED_HEADER:
            errors.append(f'header mismatch: expected {EXPECTED_HEADER}, found {reader.fieldnames}')
        rows = list(reader)

    kits = {}
    for row in rows:
        kits.setdefault(row['Kit_Key'], []).append(row)

    print(f'Kits: {len(kits)} ({", ".join(sorted(kits))})')
    print(f'Component rows: {len(rows)}')
    print()

    # --- per-row structural checks ---
    for i, row in enumerate(rows, start=2):  # start=2: header is line 1
        where = f'line {i} ({row["Kit_Key"]}/{row["Component_SKU"]})'
        if row['Requirement'] not in VALID_REQUIREMENT:
            errors.append(f'{where}: invalid Requirement {row["Requirement"]!r}')
        if row['Qty_Rule'] not in VALID_QTY_RULE:
            errors.append(f'{where}: invalid Qty_Rule {row["Qty_Rule"]!r}')
        if row['Confidence'] not in VALID_CONFIDENCE:
            errors.append(f'{where}: invalid Confidence {row["Confidence"]!r}')
        if row['Qty_Rule'] == 'fixed' and not row['Qty_Value'].isdigit():
            errors.append(f'{where}: Qty_Rule=fixed requires integer Qty_Value, got {row["Qty_Value"]!r}')
        if row['Qty_Rule'] == 'cmu_from_series_cells':
            m = CMU_DESC_RE.search(row['Description'])
            if not row['Channels_Per_CMU'].isdigit():
                errors.append(f'{where}: cmu_from_series_cells requires integer Channels_Per_CMU')
            elif not m:
                errors.append(f'{where}: description has no CMU<N> token to cross-check channels')
            elif m.group(1) != row['Channels_Per_CMU']:
                errors.append(f'{where}: Channels_Per_CMU={row["Channels_Per_CMU"]} does not match '
                              f'CMU{m.group(1)} in description')

    # --- one main per kit, matching Kit_Main_SKU ---
    for kit, kit_rows in sorted(kits.items()):
        mains = [r for r in kit_rows if r['Requirement'] == 'main']
        if len(mains) != 1:
            errors.append(f'kit {kit}: expected exactly one main row, found {len(mains)}')
        elif mains[0]['Component_SKU'] != mains[0]['Kit_Main_SKU']:
            errors.append(f'kit {kit}: main row SKU {mains[0]["Component_SKU"]} != '
                          f'Kit_Main_SKU {mains[0]["Kit_Main_SKU"]}')
        main_skus = {r['Kit_Main_SKU'] for r in kit_rows}
        if len(main_skus) != 1:
            errors.append(f'kit {kit}: inconsistent Kit_Main_SKU values {sorted(main_skus)}')

    # --- SKU existence vs import preview ---
    blocked = []
    known = unknown_marked = 0
    checked_skus = set()
    for i, row in enumerate(rows, start=2):
        where = f'line {i} ({row["Kit_Key"]}/{row["Component_SKU"]})'
        for field in ('Component_SKU', 'Alternate_SKU'):
            sku = row[field].strip()
            if not sku:
                continue
            checked_skus.add(sku)
            if sku in preview:
                known += 1
            elif (field == 'Component_SKU'
                  and row['Confidence'] == 'pending_business'
                  and BLOCKED_MARKER in row['Notes']):
                unknown_marked += 1
                blocked.append(row)
            else:
                errors.append(f'{where}: {field}={sku} not found in import preview and not '
                              f'explicitly marked {BLOCKED_MARKER} with Confidence=pending_business')

    print('SKU validation summary:')
    print(f'  SKU references checked: {known + unknown_marked} ({len(checked_skus)} distinct SKUs)')
    print(f'  found in import preview: {known}')
    print(f'  blocked/unquotable (explicitly marked): {unknown_marked}')
    print()
    print('Blocked/unquotable rows:')
    if blocked:
        for row in blocked:
            print(f'  {row["Kit_Key"]}/{row["Component_SKU"]} "{row["Description"]}" — '
                  f'Confidence={row["Confidence"]}, marker={BLOCKED_MARKER} present; '
                  f'excluded from autofill until priced')
    else:
        print('  none')
    print()

    # --- 300300 / 300500 canonical visible resolution ---
    print('Duplicate-SKU resolution:')
    for sku in ('300300', '300500'):
        canon = [r for r in preview.get(sku, [])
                 if r['Duplicate_Classification'] == 'CANONICAL_CANDIDATE']
        if len(canon) == 1 and canon[0]['Source_Visibility'] == 'visible':
            print(f'  {sku}: resolves to canonical visible row (sheet row {canon[0]["Source_Row"]}, '
                  f'"{canon[0]["Description"]}") OK')
        else:
            errors.append(f'{sku}: no single canonical visible row in import preview '
                          f'(found {len(canon)} CANONICAL_CANDIDATE rows)')

    # --- warning propagation (informational, from preview Item_Status) ---
    print()
    print('Components with Item_Status != Active (Quote_Warning carries onto kit lines):')
    warned_any = False
    for sku in sorted(checked_skus):
        for prow in preview.get(sku, []):
            if prow.get('Item_Status', 'Active') != 'Active':
                print(f'  {sku} [{prow["Item_Status"]}] {prow["Quote_Warning"]}')
                warned_any = True
                break
    if not warned_any:
        print('  none')
    print()

    # --- CMU math checks ---
    print('CMU math checks:')
    for cells, channels, expected in CMU_MATH_CASES:
        got = required_cmus(cells, channels)
        status = 'OK' if got == expected else f'FAIL (expected {expected})'
        print(f'  {cells}/{channels}={got} {status}')
        if got != expected:
            errors.append(f'CMU math: {cells}/{channels} gave {got}, expected {expected}')
    for cells, channels, fail_reason in CMU_BOUNDS_CASES:
        try:
            qty = required_cmus(cells, channels)
            if fail_reason is None:
                print(f'  bounds: {cells}/{channels}={qty} within limits OK')
            else:
                errors.append(f'CMU bounds: {cells}/{channels} should have failed ({fail_reason})')
        except ValueError as e:
            if fail_reason is None:
                errors.append(f'CMU bounds: {cells}/{channels} unexpectedly failed: {e}')
            else:
                print(f'  bounds: {cells}/{channels} rejected ({fail_reason}) OK')

    print()
    if errors:
        print(f'FAIL — {len(errors)} error(s):')
        for e in errors:
            print(f'  - {e}')
        return 1
    print('PASS — kit BOM seed data is consistent with the Item_Master import preview.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
