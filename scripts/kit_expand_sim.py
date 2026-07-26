#!/usr/bin/env python3
"""Simulate BMS kit auto-population: expand a kit into candidate Quote_Lines rows.

This is the *executable spec* for the optional BMS kit helper described in
docs/BMS_KIT_AUTOPOPULATION_SPEC.md. It proves the expansion algorithm the
future Deluge (fn_get_kit_components) must match, with zero schema/live-Zoho
dependency. It does NOT price anything — in the real app the expander only
inserts rows (Part_Number + Qty); the existing save-time
functions/fn_calc_quote_lines.deluge prices every line on save.

Reuses scripts/kit_bom_check.py (the seed-data validator) for CSV/preview
loading and the CMU quantity math + engineering bounds, so the two scripts
cannot diverge.

Algorithm (see spec for prose):
  * key on (Kit_Key, row) — never SKU alone (same SKU has different Qty_Rule
    in different kits, e.g. 100684 is fixed in nbms_cmu12, match_mcu_qty in
    n3bms_cmu18)
  * TWO-PASS quantity resolution per kit:
      pass 1 — independent: fixed -> Qty_Value;
               cmu_from_series_cells -> required_cmus(series, channels)
               (records mcu_qty = the main row's qty, cmu_qty = the CMU row's qty)
      pass 2 — dependents: match_mcu_qty -> mcu_qty; match_cmu_qty -> cmu_qty
               (raises if a match_* row has no source row in the kit)
  * default-inclusion matrix by Requirement:
      main / required / required_removable / optional -> default ON
      manual -> default OFF (case-by-case; not auto-added)
  * row outcomes (precedence): OMITTED_BLOCKED (not_in_rsp_unquotable) >
      HELD_PENDING (Confidence=pending_business — surfaced, never SKU-picked) >
      OFF_MANUAL (Requirement=manual) > INCLUDED
  * flags on INCLUDED rows (surfaced only; no Creator field written this pass):
      warning     — import-preview Item_Status != Active (e.g. 101814 Not_Released)
      qty_unconfirmed — Confidence=pending_datasheet (e.g. 101814 ceil/18 math)

Read-only; exits 0 on PASS, 1 on any failed assertion. Stdlib only.

Usage:
    python3 scripts/kit_expand_sim.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Reuse the validator's loaders + CMU math/bounds so the two never diverge.
from kit_bom_check import (  # noqa: E402
    BOM_CSV, load_preview, required_cmus, BLOCKED_MARKER,
)
import csv  # noqa: E402

DEFAULT_ON_REQUIREMENTS = {'main', 'required', 'required_removable', 'optional'}

# Representative (kit_key, series_cells) cases. Non-CMU kits pass series=None.
TEST_CASES = [
    ('ibms15', None),
    ('cbms24', None),
    ('cbms24x', None),
    ('nbms_cmu12', 96),
    ('n3bms_cmu12', 96),
    ('n3bms_cmu18', 96),
]


def load_bom():
    """Return {Kit_Key: [row, ...]} preserving CSV order."""
    kits = {}
    with open(BOM_CSV, newline='') as f:
        for row in csv.DictReader(f):
            kits.setdefault(row['Kit_Key'], []).append(row)
    return kits


def _status(preview, sku):
    """First import-preview row's Item_Status/Quote_Warning for a SKU, or (None, '')."""
    rows = preview.get(sku, [])
    if not rows:
        return None, ''
    return rows[0].get('Item_Status', 'Active'), rows[0].get('Quote_Warning', '')


def expand_kit(kit_key, kit_rows, series_cells, preview):
    """Expand one kit into candidate rows.

    Returns {'included': [...], 'held': [...], 'omitted': [...], 'off': [...]}.
    Each entry carries sku, description, requirement, qty_rule, and (for
    included) qty + flags; (for held) hold_reason + notes.

    Raises ValueError on a CMU kit with no/invalid series_cells (via
    required_cmus bounds) or a match_* row with no source row.
    """
    qty_by_id = {}
    mcu_qty = None
    cmu_qty = None

    # --- pass 1: independent quantities ---
    for row in kit_rows:
        rule = row['Qty_Rule']
        qty = None
        if rule == 'fixed':
            qty = int(row['Qty_Value'])
        elif rule == 'cmu_from_series_cells':
            if series_cells is None:
                raise ValueError(f'{kit_key}: {row["Component_SKU"]} needs Series_Cell_Count '
                                 f'(cmu_from_series_cells) but none supplied')
            qty = required_cmus(series_cells, int(row['Channels_Per_CMU']))
            cmu_qty = qty
        qty_by_id[id(row)] = qty
        if row['Requirement'] == 'main':
            mcu_qty = qty  # main row is the MCU for the n-BMS/n3-BMS kits

    # --- pass 2: dependent quantities ---
    for row in kit_rows:
        rule = row['Qty_Rule']
        if rule == 'match_mcu_qty':
            if mcu_qty is None:
                raise ValueError(f'{kit_key}: {row["Component_SKU"]} is match_mcu_qty but the '
                                 f'kit has no resolvable main/MCU quantity')
            qty_by_id[id(row)] = mcu_qty
        elif rule == 'match_cmu_qty':
            if cmu_qty is None:
                raise ValueError(f'{kit_key}: {row["Component_SKU"]} is match_cmu_qty but the '
                                 f'kit has no cmu_from_series_cells source row')
            qty_by_id[id(row)] = cmu_qty

    out = {'included': [], 'held': [], 'omitted': [], 'off': []}
    for row in kit_rows:
        sku = row['Component_SKU']
        base = {
            'sku': sku,
            'description': row['Description'],
            'requirement': row['Requirement'],
            'qty_rule': row['Qty_Rule'],
        }
        blocked = BLOCKED_MARKER in row['Notes']
        pending = row['Confidence'] == 'pending_business'

        if blocked:
            out['omitted'].append({**base, 'reason': BLOCKED_MARKER, 'notes': row['Notes']})
        elif pending:
            reason = 'Q?'
            for tag in ('Q1', 'Q2', 'Q3'):
                if tag in row['Notes']:
                    reason = tag
                    break
            out['held'].append({**base, 'hold_reason': reason, 'notes': row['Notes']})
        elif row['Requirement'] == 'manual':
            out['off'].append(base)
        else:
            status, warning = _status(preview, sku)
            entry = {
                **base,
                'qty': qty_by_id[id(row)],
                'default_on': row['Requirement'] in DEFAULT_ON_REQUIREMENTS,
                'warning': (status is not None and status != 'Active'),
                'warning_text': warning,
                'qty_unconfirmed': row['Confidence'] == 'pending_datasheet',
            }
            out['included'].append(entry)
    return out


def _print_expansion(kit_key, series_cells, exp):
    label = f'{kit_key}' + (f' @ {series_cells} series cells' if series_cells is not None else '')
    print(f'--- {label} ---')
    for e in exp['included']:
        flags = []
        if e['warning']:
            flags.append('WARNING')
        if e['qty_unconfirmed']:
            flags.append('QTY_UNCONFIRMED')
        flag_s = ('  [' + ', '.join(flags) + ']') if flags else ''
        print(f'  INCLUDE  {e["sku"]:9} qty {e["qty"]:>3}  {e["requirement"]:18} '
              f'{e["qty_rule"]:22}{flag_s}')
    for e in exp['off']:
        print(f'  off      {e["sku"]:9} (manual — case-by-case, not auto-added) '
              f'{e["description"][:40]}')
    for e in exp['held']:
        print(f'  HELD     {e["sku"]:9} ({e["hold_reason"]}: needs vendor/business confirmation — '
              f'no SKU picked)')
    for e in exp['omitted']:
        print(f'  OMIT     {e["sku"]:9} ({e["reason"]}) {e["description"][:40]}')
    print()


def _find(exp, bucket, sku):
    for e in exp[bucket]:
        if e['sku'] == sku:
            return e
    return None


def _row(kit_rows, sku):
    for r in kit_rows:
        if r['Component_SKU'] == sku:
            return r
    return None


def _raises(fn):
    try:
        fn()
        return False
    except ValueError:
        return True


def main():
    errors = []
    kits = load_bom()
    preview = load_preview()

    print(f'Kits: {len(kits)} ({", ".join(sorted(kits))})')
    print(f'Test cases: {len(TEST_CASES)}')
    print()

    expansions = {}
    for kit_key, series in TEST_CASES:
        exp = expand_kit(kit_key, kits[kit_key], series, preview)
        expansions[kit_key] = exp
        _print_expansion(kit_key, series, exp)

    def check(cond, msg):
        if not cond:
            errors.append(msg)

    # --- nbms_cmu12 @ 96 ---
    n = expansions['nbms_cmu12']
    cmu = _find(n, 'included', '100809')
    check(cmu is not None and cmu['qty'] == 8, 'nbms_cmu12: 100809 (CMU) should be included qty 8')
    harn = _find(n, 'included', '100985.1')
    check(harn is not None and harn['qty'] == 8, 'nbms_cmu12: 100985.1 match_cmu_qty should be 8')
    mcu_h = _find(n, 'included', '100802')
    check(mcu_h is not None and mcu_h['qty'] == 1, 'nbms_cmu12: 100802 match_mcu_qty should be 1')
    check(_row(kits['nbms_cmu12'], '300500') is None,
          'nbms_cmu12: 300500 service tool must be absent from the BOM (2026-07-25 vendor config)')
    check(_row(kits['nbms_cmu12'], '100986') is None,
          'nbms_cmu12: 100986 MCU isoSPI wire must be absent from the BOM (2026-07-25 vendor config)')
    check(_find(n, 'included', '100545') is not None, 'nbms_cmu12: 100545 CAN adapter must be INCLUDED')
    lic = _find(n, 'included', '200500')
    check(lic is not None and lic['qty'] == 1, 'nbms_cmu12: 200500 license qty 1')
    shunt_n = _find(n, 'included', '100684')
    check(shunt_n is not None and shunt_n['qty'] == 0,
          'nbms_cmu12: 100684 shunt must be INCLUDED at qty 0 (preparer raises it)')

    # --- n3bms_cmu12 @ 96 (blocked shunt lives here) ---
    n3 = expansions['n3bms_cmu12']
    check(_find(n3, 'omitted', '100683') is not None,
          'n3bms_cmu12: 100683 must be OMITTED (not_in_rsp_unquotable)')
    check(_find(n3, 'included', '100683') is None,
          'n3bms_cmu12: 100683 must never be included')

    # --- n3bms_cmu18 @ 96 ---
    x = expansions['n3bms_cmu18']
    cmu18 = _find(x, 'included', '101814')
    check(cmu18 is not None and cmu18['qty'] == 6, 'n3bms_cmu18: 101814 CMU18 qty ceil(96/18)=6')
    check(cmu18 is not None and cmu18['warning'], 'n3bms_cmu18: 101814 must carry warning (Not_Released)')
    check(cmu18 is not None and cmu18['qty_unconfirmed'],
          'n3bms_cmu18: 101814 must be flagged qty_unconfirmed (pending_datasheet)')
    check(_row(kits['n3bms_cmu18'], '100985.1') is None,
          'n3bms_cmu18: CMU12 harness 100985.1 must be gone (Q2 resolved by 103006)')
    harn18 = _find(x, 'included', '103006')
    check(harn18 is not None and harn18['qty'] == 6,
          'n3bms_cmu18: 103006 CMU18 harness match_cmu_qty should be 6')
    shunt = _find(x, 'included', '100684')
    check(shunt is not None and shunt['qty'] == 0,
          'n3bms_cmu18: 100684 shunt must be INCLUDED at qty 0 (preparer raises it)')
    lic18 = _find(x, 'included', '200600')
    check(lic18 is not None and lic18['qty'] == 1, 'n3bms_cmu18: 200600 n3 license qty 1')
    check(_row(kits['n3bms_cmu18'], '200500') is None,
          'n3bms_cmu18: 200500 n-BMS license must be replaced by 200600')
    check(_row(kits['n3bms_cmu18'], '300500') is None,
          'n3bms_cmu18: 300500 service tool must be absent from the BOM')

    # --- cbms24 (non-CMU, series ignored) — Q1 resolved 2026-07-25 ---
    c = expansions['cbms24']
    lic24 = _find(c, 'included', '200300')
    check(lic24 is not None and lic24['qty'] == 1,
          'cbms24: 200300 license must be INCLUDED qty 1 (Q1 resolved — vendor marks it NECESSARY)')
    check(_row(kits['cbms24'], '300300') is None,
          'cbms24: 300300 service tool must be absent from the BOM')
    main24 = _find(c, 'included', '100924')
    check(main24 is not None and main24['qty'] == 1, 'cbms24: main 100924 qty 1')
    for sku in ('100930', '100931', '100932', '100684'):
        opt = _find(c, 'included', sku)
        check(opt is not None and opt['qty'] == 0,
              f'cbms24: {sku} optional must be INCLUDED at qty 0 (preparer raises it)')

    # --- cbms24x — family-correct license included, service tool gone ---
    cx = expansions['cbms24x']
    lic_x = _find(cx, 'included', '200300')
    check(lic_x is not None and lic_x['qty'] == 1, 'cbms24x: 200300 license INCLUDED qty 1 (family-correct)')
    check(_row(kits['cbms24x'], '300300') is None,
          'cbms24x: 300300 service tool must be absent from the BOM')

    # --- ibms15 — qty-0 parallel-pack harness, service tool gone ---
    i = expansions['ibms15']
    single = _find(i, 'included', '100980')
    check(single is not None and single['qty'] == 1, 'ibms15: 100980 SINGLE PACK harness qty 1')
    par = _find(i, 'included', '100981')
    check(par is not None and par['qty'] == 0,
          'ibms15: 100981 PARALLEL PACK harness must be INCLUDED at qty 0 (was 2)')
    check(_row(kits['ibms15'], '300100') is None,
          'ibms15: 300100 service tool must be absent from the BOM')

    # --- no kit carries a manual row any more (service tools retired) ---
    for kit_key, rows in kits.items():
        check(all(r['Requirement'] != 'manual' for r in rows),
              f'{kit_key}: no manual rows expected after the 2026-07-25 vendor config')

    # --- same SKU, different rule keyed by (kit, row) ---
    # The live BOM no longer contains such a pair (the 2026-07-25 vendor config
    # made 100684 fixed in every kit), so the invariant is proven synthetically.
    dup_fixed = [
        {'Kit_Key': 'dupA', 'Component_SKU': 'MAIN1', 'Description': 'main', 'Kit_Main_SKU': 'MAIN1',
         'Requirement': 'main', 'Qty_Rule': 'fixed', 'Qty_Value': '2', 'Channels_Per_CMU': '',
         'Confidence': 'vendor_config', 'Notes': ''},
        {'Kit_Key': 'dupA', 'Component_SKU': 'SHARED', 'Description': 'shared', 'Kit_Main_SKU': 'MAIN1',
         'Requirement': 'optional', 'Qty_Rule': 'fixed', 'Qty_Value': '7', 'Channels_Per_CMU': '',
         'Confidence': 'vendor_config', 'Notes': ''},
    ]
    dup_match = [
        dict(dup_fixed[0], Kit_Key='dupB'),
        dict(dup_fixed[1], Kit_Key='dupB', Qty_Rule='match_mcu_qty', Qty_Value=''),
    ]
    a = expand_kit('dupA', dup_fixed, None, preview)
    b = expand_kit('dupB', dup_match, None, preview)
    check(_find(a, 'included', 'SHARED')['qty'] == 7 and _find(b, 'included', 'SHARED')['qty'] == 2,
          'same-SKU: quantity must resolve per (kit, row), not per SKU')

    # --- negative guards (must raise) ---
    check(_raises(lambda: expand_kit('nbms_cmu12', kits['nbms_cmu12'], 385, preview)),
          'negative: series_cells=385 (>384) must raise')
    check(_raises(lambda: expand_kit('nbms_cmu12', kits['nbms_cmu12'], 3, preview)),
          'negative: series_cells=3 (<4/CMU) must raise')
    check(_raises(lambda: expand_kit('nbms_cmu12', kits['nbms_cmu12'], None, preview)),
          'negative: CMU kit with no Series_Cell_Count must raise')

    # synthetic: a match_cmu_qty row with no cmu_from_series_cells source row
    synthetic = [
        {'Kit_Key': 'synthetic', 'Component_SKU': 'MAIN1', 'Description': 'main', 'Kit_Main_SKU': 'MAIN1',
         'Requirement': 'main', 'Qty_Rule': 'fixed', 'Qty_Value': '1', 'Channels_Per_CMU': '',
         'Confidence': 'vendor_config', 'Notes': ''},
        {'Kit_Key': 'synthetic', 'Component_SKU': 'DEP1', 'Description': 'dependent', 'Kit_Main_SKU': 'MAIN1',
         'Requirement': 'optional', 'Qty_Rule': 'match_cmu_qty', 'Qty_Value': '', 'Channels_Per_CMU': '',
         'Confidence': 'vendor_config', 'Notes': ''},
    ]
    check(_raises(lambda: expand_kit('synthetic', synthetic, None, preview)),
          'negative: match_cmu_qty with no CMU source row must raise')

    print('Negative guards: series bounds, missing Series_Cell_Count, and orphan match_* all raise as designed.')
    print()

    if errors:
        print(f'FAIL — {len(errors)} assertion(s):')
        for e in errors:
            print(f'  - {e}')
        return 1
    print('PASS — kit expansion behaves per docs/BMS_KIT_AUTOPOPULATION_SPEC.md.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
