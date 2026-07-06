#!/usr/bin/env python3
"""Dry-run for the Line_Number autofill patch in fn_calc_quote_lines.deluge.

There is no local Deluge interpreter, so this is a faithful line-for-line
reimplementation of the patched loop (see functions/fn_calc_quote_lines.deluge,
the "line_seq" counter added directly above the per-line pricing block). It
models the counter/write behavior only - it does not call Zoho and changes
nothing. Pricing math itself is unchanged by this patch and is already
covered by quote_line_calc_equivalence_check.py.

Usage:
    python3 scripts/line_number_autofill_check.py
Exits 0 if all assertions pass, 1 otherwise.
"""
import sys


def assign_line_numbers(lines):
    """Mirrors the patched functions/fn_calc_quote_lines.deluge loop:
    line_seq starts at 0, increments by 1 per row, in iteration order,
    unconditionally overwriting whatever Line_Number was already present."""
    line_seq = 0
    for line in lines:
        line_seq = line_seq + 1
        line['Line_Number'] = line_seq
    return lines


def main():
    failures = []

    def check(label, actual, expected):
        ok = (actual == expected)
        print(f"{'PASS' if ok else 'FAIL'}  {label}: got {actual}, expected {expected}")
        if not ok:
            failures.append(label)

    print("-- sequential numbering, no pre-existing Line_Number --")
    lines = [{'Part_Number': '100800'}, {'Part_Number': '200500'}, {'Part_Number': '300100'}]
    assign_line_numbers(lines)
    check('3 lines numbered 1,2,3', [l['Line_Number'] for l in lines], [1, 2, 3])

    print("\n-- stale/out-of-order pre-existing Line_Number values are overwritten --")
    lines = [
        {'Part_Number': '100800', 'Line_Number': 99},
        {'Part_Number': '200500', 'Line_Number': 1},
        {'Part_Number': '300100', 'Line_Number': None},
    ]
    assign_line_numbers(lines)
    check('stale values replaced by fresh sequential numbering', [l['Line_Number'] for l in lines], [1, 2, 3])

    print("\n-- single line --")
    lines = [{'Part_Number': '100800'}]
    assign_line_numbers(lines)
    check('single line numbered 1', lines[0]['Line_Number'], 1)

    print("\n-- zero lines (empty Quote_Lines subform) --")
    lines = []
    assign_line_numbers(lines)
    check('no lines, no error, empty result', lines, [])

    print("\n-- blank/incomplete draft rows still get numbered --")
    lines = [{'Part_Number': ''}, {'Part_Number': '200500'}]
    assign_line_numbers(lines)
    check('blank Part_Number row still numbered like any other row', [l['Line_Number'] for l in lines], [1, 2])

    print("\n-- reorder proof: numbering follows current row order, not old values --")
    # Simulates a line deleted from the middle of a 4-line quote (row that
    # used to be Line_Number=3 is gone); the remaining 3 rows must renumber
    # to 1,2,3 with no gap, since numbering is recomputed fresh every save.
    lines = [
        {'Part_Number': 'A', 'Line_Number': 1},
        {'Part_Number': 'B', 'Line_Number': 2},
        {'Part_Number': 'D', 'Line_Number': 4},
    ]
    assign_line_numbers(lines)
    check('deleted middle row causes gap-free renumbering', [l['Line_Number'] for l in lines], [1, 2, 3])

    print(f"\n{len(failures)} failure(s) out of assertions run.")
    if failures:
        print("FAILED:", ', '.join(failures))
        return 1
    print("All checks passed - Line_Number autofill logic behaves as specified.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
