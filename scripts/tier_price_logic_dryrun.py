#!/usr/bin/env python3
"""Local dry-run for the fn_get_tier_price.deluge Tier_Scheme patch.

There is no local Deluge interpreter, so this is a faithful line-for-line
reimplementation of the patched fn_get_tier_price.deluge logic (see
functions/fn_get_tier_price.deluge), run against the real Item_Master rows in
import_preview/item_master_import_preview.csv. It exists to verify the qty-band
selection algorithm and the -1 "no valid price" sentinel BEFORE the Deluge
function is deployed to Creator - it does not call Zoho and changes nothing.

Usage:
    python3 scripts/tier_price_logic_dryrun.py
Exits 0 if all assertions pass, 1 otherwise.
"""
import csv
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..')
CSV_PATH = os.path.join(REPO, 'import_preview', 'item_master_import_preview.csv')
CLASSIFICATION_PATH = os.path.join(REPO, 'import_preview', 'duplicate_sku_classification.json')


def format_price_summary(row):
    prices = []
    for i in range(1, 10):
        raw = row.get(f'Price_T{i}', '').strip()
        if raw:
            prices.append(f'T{i}={raw}')
    return ', '.join(prices) if prices else '(no prices)'


def load_duplicate_classification(path):
    with open(path) as f:
        payload = json.load(f)
    return payload.get('skus', {})


def load_item_master(csv_path):
    duplicate_classification = load_duplicate_classification(CLASSIFICATION_PATH)
    raw_rows = []
    items = {}
    with open(csv_path, newline='') as f:
        for row in csv.DictReader(f):
            raw_rows.append(row)

    by_sku = defaultdict(list)
    for row in raw_rows:
        by_sku[row['Part_Number']].append(row)

    failures = []
    for sku, rows in sorted(by_sku.items()):
        if len(rows) == 1:
            row = rows[0]
            prices = []
            for i in range(1, 10):
                raw = row.get(f'Price_T{i}', '').strip()
                prices.append(float(raw) if raw else None)
            items[sku] = {
                'tier_scheme': row['Tier_Scheme'],
                'prices': prices,
            }
            continue

        payload = duplicate_classification.get(sku)
        canonical_rows = [
            row for row in rows
            if row.get('Duplicate_Classification', '').strip() == 'CANONICAL_CANDIDATE'
        ]
        exclude_rows = [
            row for row in rows
            if row.get('Duplicate_Classification', '').strip() == 'EXCLUDE_CANDIDATE'
        ]
        problems = []
        if payload is None:
            problems.append(f'missing {os.path.relpath(CLASSIFICATION_PATH, REPO)} entry')
        else:
            expected_canonical = str(payload.get('canonical_row', ''))
            expected_rows = sorted(payload.get('rows', {}).keys(), key=int)
            actual_rows = sorted(row.get('Source_Row', '').strip() for row in rows)
            if actual_rows != expected_rows:
                problems.append(f'classification rows {expected_rows} do not match preview rows {actual_rows}')
            if len(canonical_rows) == 1 and canonical_rows[0].get('Source_Row', '').strip() != expected_canonical:
                problems.append(
                    f'canonical row mismatch: JSON says {expected_canonical}, preview marks {canonical_rows[0].get("Source_Row", "").strip()}'
                )
        if len(canonical_rows) != 1:
            problems.append(f'expected exactly one CANONICAL_CANDIDATE row, found {len(canonical_rows)}')
        if len(exclude_rows) != len(rows) - 1:
            problems.append(f'expected {len(rows) - 1} EXCLUDE_CANDIDATE rows, found {len(exclude_rows)}')

        if problems:
            failures.append((sku, problems, rows))
            continue

        canonical = canonical_rows[0]
        prices = []
        for i in range(1, 10):
            raw = canonical.get(f'Price_T{i}', '').strip()
            prices.append(float(raw) if raw else None)
        items[sku] = {
            'tier_scheme': canonical['Tier_Scheme'],
            'prices': prices,
        }

    if failures:
        lines = [
            'Duplicate SKU classification guard failed in tier_price_logic_dryrun.py.',
            'Each duplicated SKU must have exactly one CANONICAL_CANDIDATE row and all other rows marked EXCLUDE_CANDIDATE.',
            'Details:',
        ]
        for sku, problems, rows in failures:
            lines.append(f'- SKU {sku}')
            for problem in problems:
                lines.append(f'  - {problem}')
            for row in rows:
                lines.append(
                    '  - row {row}: desc="{desc}", visibility={visibility}, '
                    'classification={classification}, prices={prices}'.format(
                        row=row.get('Source_Row', '?'),
                        desc=row.get('Description', ''),
                        visibility=row.get('Source_Visibility', ''),
                        classification=row.get('Duplicate_Classification', 'UNCLASSIFIED'),
                        prices=format_price_summary(row),
                    )
                )
        raise SystemExit('\n'.join(lines))
    return items


def get_tier_price(items, part_number, qty):
    """Mirrors functions/fn_get_tier_price.deluge exactly (post Tier_Scheme patch)."""
    item = items.get(part_number)
    if item is None:
        return -1  # SKU not found -> sentinel, same as the Deluge function

    tiers = item['prices']
    tier_scheme = (item['tier_scheme'] or '').strip().lower()
    if tier_scheme not in ('hardware', 'license'):
        tier_scheme = 'hardware'  # missing/unknown/blank -> backward-compatible default

    if tier_scheme == 'license':
        if qty <= 1:
            tier_index = 0
        elif qty <= 2:
            tier_index = 1
        elif qty <= 4:
            tier_index = 2
        elif qty <= 9:
            tier_index = 3
        elif qty <= 24:
            tier_index = 4
        else:
            tier_index = 5
    else:
        if qty <= 19:
            tier_index = 0
        elif qty <= 99:
            tier_index = 1
        elif qty <= 259:
            tier_index = 2
        elif qty <= 499:
            tier_index = 3
        elif qty <= 999:
            tier_index = 4
        elif qty <= 2499:
            tier_index = 5
        elif qty <= 4999:
            tier_index = 6
        elif qty <= 9999:
            tier_index = 7
        else:
            tier_index = 8

    i = tier_index
    while i >= 0 and tiers[i] is None:
        i -= 1
    return tiers[i] if i >= 0 else -1


def get_tier_price_OLD_BUGGY(items, part_number, qty):
    """The pre-patch behavior (single hardware 9-band mapping for every item),
    kept here only to demonstrate the regression this patch fixes."""
    item = items.get(part_number)
    if item is None:
        return 0
    tiers = item['prices']
    if qty <= 19:
        tier_index = 0
    elif qty <= 99:
        tier_index = 1
    elif qty <= 259:
        tier_index = 2
    elif qty <= 499:
        tier_index = 3
    elif qty <= 999:
        tier_index = 4
    elif qty <= 2499:
        tier_index = 5
    elif qty <= 4999:
        tier_index = 6
    elif qty <= 9999:
        tier_index = 7
    else:
        tier_index = 8
    i = tier_index
    while i >= 0 and tiers[i] is None:
        i -= 1
    return tiers[i] if i >= 0 else 0


def main():
    items = load_item_master(CSV_PATH)
    failures = []

    def check(label, actual, expected):
        ok = (actual == expected)
        print(f"{'PASS' if ok else 'FAIL'}  {label}: got {actual}, expected {expected}")
        if not ok:
            failures.append(label)

    print(f"Loaded {len(items)} Item_Master rows from {os.path.relpath(CSV_PATH)}\n")

    # --- Hardware scheme (9-band) unchanged behavior ---
    print("-- hardware scheme (SKU 100800, n-BMS MCU) --")
    check('qty=1 -> T1', get_tier_price(items, '100800', 1), 506.00)
    check('qty=50 -> T2', get_tier_price(items, '100800', 50), 381.15)
    check('qty=600 -> T5', get_tier_price(items, '100800', 600), 249.48)
    check('qty=20000 -> falls back to T5 (T6-T9 blank)', get_tier_price(items, '100800', 20000), 249.48)

    # --- License scheme (6-band) - the core fix this patch delivers ---
    print("\n-- license scheme (SKU 200500, n-BMS Creator License FULL) --")
    check('qty=1 -> T1', get_tier_price(items, '200500', 1), 1700.00)
    check('qty=10 -> T5 (10-24 band)', get_tier_price(items, '200500', 10), 595.00)
    check('qty=30 -> T6 (25-249 band)', get_tier_price(items, '200500', 30), 425.00)
    check('qty=1000 -> T6 (no band above 25-249 published)', get_tier_price(items, '200500', 1000), 425.00)

    # --- Regression proof: old logic mispriced the same SKU/qty pairs ---
    print("\n-- regression proof: pre-patch logic on the same license SKU --")
    old_10 = get_tier_price_OLD_BUGGY(items, '200500', 10)
    old_30 = get_tier_price_OLD_BUGGY(items, '200500', 30)
    check('OLD qty=10 incorrectly returned T1 (the bug this patch fixes)', old_10, 1700.00)
    check('OLD qty=30 incorrectly returned T2 (the bug this patch fixes)', old_30, 1275.00)
    print(f"  -> overcharge factor at qty=10: {old_10/595.00:.2f}x")
    print(f"  -> overcharge factor at qty=30: {old_30/425.00:.2f}x")

    # --- Unpriced SKU -> -1 sentinel, never silently 0 ---
    print("\n-- unpriced SKU (102100, c-BMS18) --")
    check('unpriced SKU returns -1 sentinel, not 0', get_tier_price(items, '102100', 5), -1)

    # --- Unknown SKU -> -1 sentinel ---
    print("\n-- unknown SKU (not in Item_Master) --")
    check('unknown SKU returns -1 sentinel', get_tier_price(items, '999999-DOES-NOT-EXIST', 5), -1)

    # --- Blank/unknown Tier_Scheme defaults to hardware, not license ---
    print("\n-- blank Tier_Scheme defaults to hardware (synthetic row) --")
    synthetic = dict(items)
    synthetic['SYN-BLANK'] = {'tier_scheme': '', 'prices': [100.0, 90.0, 80.0, None, None, None, None, None, None]}
    check('blank Tier_Scheme, qty=10 -> T1 (hardware mapping), not license T4',
          get_tier_price(synthetic, 'SYN-BLANK', 10), 100.0)

    print(f"\n{len(failures)} failure(s) out of assertions run.")
    if failures:
        print("FAILED:", ', '.join(failures))
        return 1
    print("All checks passed.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
