# RSP_EUR extraction vs import_preview cross-check

| Metric | SQLite extraction | import_preview | Match |
|---|---|---|---|
| Item rows | 46 | 46 | YES |
| Priced rows | 41 | 41 | YES |
| Unpriced rows | 5 | 5 | YES |

## Duplicate SKUs (extraction)

- `300300` x2 (sheet rows 55, 58)
- `300500` x2 (sheet rows 54, 60)

## SKU set comparison

- Missing from extraction (in preview only): none
- Extra in extraction (not in preview): none
- Per-SKU row-count mismatches: none

## Pre-section context rows (delivery weeks / MOQ / legend)

- row 1: CHANGE | Discontinued | NOT RELEASED | Delivery STOP | New Item added
- row 2: ALL PRICES IN EURO | Valid from July 2026 | DISTRIB DISCOUNT
- row 3: Delivery time in weeks per volume break
- row 4: Part number | Product name | 1-19 | 20-99 | 100-259 | 260-499 | 500-999 | 1.000-2.499 | 2.500-4.999 | 5.000-9.999 | 10.000-24.999
- row 5: 100816/100807/100800 | MCU's | 1-2 | 3-5 | 6-10 | 8-15 | 12-18 | 15-26 | 27-55 | 56-71 | +72
- row 6: 100809/101814 | CMU's | 1-2 | 1-2 | 2-3 | 4-6 | 6-8 | 8-10 | 12-15 | 15-26 | 27-55
- row 7: 100924/100925 | c-BMS´s | 1-2 | 3-4 | 5-8 | 9-12 | 12-18 | 15-26 | 27-55 | 56-71 | +72
- row 8: Packaging format | MOQ per volume split | Samples only | 20 pcs | 20 pcs | 20 pcs | 100 pcs | 100 pcs | 200 pcs | 200 pcs | 1000 pcs
