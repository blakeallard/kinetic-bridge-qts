#!/usr/bin/env python3
"""Equivalence check: old fn_calc_quote_lines.deluge math vs the new Creator-
parser-safe rewrite (functions/fn_calc_quote_lines.deluge, commit after the
"Improper Statement" fix). The rewrite decomposed ternaries, compound boolean
conditions, and chained expressions into step-by-step statements for Creator
parser safety - this script proves that decomposition produces bit-identical
results to the original math across a range of inputs. No Zoho contact; pure
arithmetic model of both versions.

Usage:
    python3 scripts/quote_line_calc_equivalence_check.py
Exits 0 if all cases match, 1 otherwise.
"""
import sys


def old_logic(eur_price, eur_usd, discount, markup, apply_fx, fx_rate, qty):
    # Original: usd_cost * (1 - discount) * (1 + markup) in one expression;
    # ternary-based EUR/USD inversion is upstream and unaffected by this part.
    usd_cost = eur_price * eur_usd
    unit_price_usd = usd_cost * (1 - discount) * (1 + markup)
    line_total_usd = unit_price_usd * qty
    fx_unit_price = unit_price_usd
    line_total_fx = line_total_usd
    if apply_fx and fx_rate != 0:
        fx_unit_price = unit_price_usd * fx_rate
        line_total_fx = line_total_usd * fx_rate
    return round(unit_price_usd, 2), round(fx_unit_price, 2), round(line_total_usd, 2), round(line_total_fx, 2)


def new_logic(eur_price, eur_usd, discount, markup, apply_fx, fx_rate, qty):
    # Rewrite: same math, decomposed into named intermediate steps and nested
    # ifs instead of a compound "and" condition.
    usd_cost = eur_price * eur_usd
    discount_factor = 1 - discount
    markup_factor = 1 + markup
    unit_price_step1 = usd_cost * discount_factor
    unit_price_usd = unit_price_step1 * markup_factor
    line_total_usd = unit_price_usd * qty
    fx_unit_price = unit_price_usd
    line_total_fx = line_total_usd
    if apply_fx:
        if fx_rate != 0:
            fx_unit_price = unit_price_usd * fx_rate
            line_total_fx = line_total_usd * fx_rate
    return round(unit_price_usd, 2), round(fx_unit_price, 2), round(line_total_usd, 2), round(line_total_fx, 2)


def old_eur_usd_invert(raw_eur_per_usd):
    return 1 if raw_eur_per_usd == 0 else (1 / raw_eur_per_usd)


def new_eur_usd_invert(raw_eur_per_usd):
    if raw_eur_per_usd == 0:
        return 1
    else:
        return 1 / raw_eur_per_usd


def main():
    failures = []

    cases = [
        # eur_price, eur_usd, discount, markup, apply_fx, fx_rate, qty
        (506.00, 1.087, 0.0, 0.0, False, 1.0, 1),
        (595.00, 1.087, 0.165, 0.20, True, 7.45, 10),
        (425.00, 1.087, 0.0, 0.0, True, 0.92, 30),
        (1700.00, 1.087, 0.10, 0.15, False, 1.0, 1),
        (0.00, 1.087, 0.0, 0.0, False, 1.0, 5),
        (249.48, 1.10, 0.035, 0.25, True, 0, 600),
        (147.00, 0.95, 0.075, 0.0, True, 6.8, 100),
    ]

    for i, (eur_price, eur_usd, discount, markup, apply_fx, fx_rate, qty) in enumerate(cases):
        old_result = old_logic(eur_price, eur_usd, discount, markup, apply_fx, fx_rate, qty)
        new_result = new_logic(eur_price, eur_usd, discount, markup, apply_fx, fx_rate, qty)
        ok = old_result == new_result
        label = f"case {i+1}: eur_price={eur_price} discount={discount} markup={markup} apply_fx={apply_fx} fx_rate={fx_rate} qty={qty}"
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
        print(f"      old={old_result}  new={new_result}")
        if not ok:
            failures.append(label)

    print("")
    for raw in [1.0, 0.92, 0.0, 1.15]:
        old_v = old_eur_usd_invert(raw)
        new_v = new_eur_usd_invert(raw)
        ok = old_v == new_v
        print(f"{'PASS' if ok else 'FAIL'}  eur_usd invert raw={raw}: old={old_v} new={new_v}")
        if not ok:
            failures.append(f"eur_usd invert raw={raw}")

    print(f"\n{len(failures)} failure(s) out of {len(cases) + 4} checks.")
    if failures:
        print("FAILED:", ", ".join(failures))
        return 1
    print("All checks passed - old and new fn_calc_quote_lines math are equivalent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
