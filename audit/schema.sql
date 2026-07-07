-- SQLite schema for the July 2026 Lithium Balance workbook audit (BI1-T71).
-- Layer 1 (raw): lossless capture of the .xlsx — sheets, cells, styles, merges.
-- Layer 2 (derived): classified rows populated by later scripts; empty after load.
-- The source workbook is never modified; this DB is a read-only derivative.

PRAGMA foreign_keys = ON;

-- One row per load of a workbook file.
CREATE TABLE IF NOT EXISTS workbook (
    workbook_id  INTEGER PRIMARY KEY,
    path         TEXT NOT NULL,
    sha256       TEXT NOT NULL,
    loaded_at    TEXT NOT NULL,          -- ISO 8601
    UNIQUE (sha256)
);

CREATE TABLE IF NOT EXISTS sheet (
    sheet_id     INTEGER PRIMARY KEY,
    workbook_id  INTEGER NOT NULL REFERENCES workbook(workbook_id),
    position     INTEGER NOT NULL,       -- tab order, 0-based
    name         TEXT NOT NULL,          -- exact, including trailing spaces ('i-BMS config ')
    state        TEXT,                   -- visible/hidden/veryHidden (NULL = visible)
    dimension    TEXT                    -- declared used range, e.g. 'A1:Q67'
);

CREATE TABLE IF NOT EXISTS merged_range (
    sheet_id     INTEGER NOT NULL REFERENCES sheet(sheet_id),
    range_ref    TEXT NOT NULL           -- e.g. 'B4:D4' (merged headers)
);

-- Distinct cell formats actually referenced, resolved from styles.xml.
CREATE TABLE IF NOT EXISTS style (
    style_id     INTEGER PRIMARY KEY,    -- xf index in styles.xml
    workbook_id  INTEGER NOT NULL REFERENCES workbook(workbook_id),
    fill_rgb     TEXT,                   -- ARGB of solid fill, NULL if none (status colors)
    font_rgb     TEXT,
    font_bold    INTEGER,                -- 0/1
    font_strike  INTEGER,                -- 0/1 (often = discontinued)
    num_fmt      TEXT
);

CREATE TABLE IF NOT EXISTS cell (
    sheet_id     INTEGER NOT NULL REFERENCES sheet(sheet_id),
    row_num      INTEGER NOT NULL,       -- 1-based
    col_num      INTEGER NOT NULL,       -- 1-based (A=1)
    cell_ref     TEXT NOT NULL,          -- 'B12'
    value_text   TEXT,                   -- display value (shared strings resolved)
    value_num    REAL,                   -- numeric value when cell is numeric
    cell_type    TEXT,                   -- s/n/b/str/e/inlineStr
    formula      TEXT,                   -- raw formula if present
    style_id     INTEGER,                -- FK into style (soft; styles load first)
    PRIMARY KEY (sheet_id, row_num, col_num)
);

-- ---------- Layer 2: derived/classified (populated by later scripts) ----------

-- One row per product/item row on any sheet (RSP_EUR items, config-sheet lines).
CREATE TABLE IF NOT EXISTS product_row (
    product_row_id INTEGER PRIMARY KEY,
    sheet_id     INTEGER NOT NULL REFERENCES sheet(sheet_id),
    row_num      INTEGER NOT NULL,
    part_number  TEXT,                   -- raw string ('000637', '100640.99')
    description  TEXT,
    section      TEXT,                   -- e.g. 'BMS boards', 'Accessories', 'Creator Tool'
    family       TEXT                    -- i-BMS / c-BMS24 / c-BMS24X / n-BMS / n3-BMS
);

-- One row per (product, qty band) price point from RSP_EUR.
CREATE TABLE IF NOT EXISTS price_point (
    product_row_id INTEGER NOT NULL REFERENCES product_row(product_row_id),
    band_index   INTEGER NOT NULL,       -- 1..9 hardware, 1..6 license
    band_label   TEXT,                   -- '1-19', '10-24', ...
    price_eur    REAL,                   -- NULL = blank/non-numeric; 0.0 = literal zero (LEM issue)
    is_blank     INTEGER NOT NULL,       -- 1 = no cell at all; 0 = cell present (even 'Not priced')
    raw_value    TEXT,                   -- verbatim cell text ('506.00000000000006', 'Not priced')
    PRIMARY KEY (product_row_id, band_index)
);

-- Rows from config sheets (i-BMS config, c-BMS24 config, ..., n3-BMS w 101814):
-- component/part lines, quantities, optional/required markers.
CREATE TABLE IF NOT EXISTS config_row (
    config_row_id INTEGER PRIMARY KEY,
    sheet_id     INTEGER NOT NULL REFERENCES sheet(sheet_id),
    row_num      INTEGER NOT NULL,
    part_number  TEXT,
    description  TEXT,
    quantity     REAL,                   -- only when qty cell is a plain number
    qty_raw      TEXT,                   -- verbatim qty cell ('1', '1 - 30', 'x')
    requirement  TEXT,                   -- 'optional' / 'main' when explicitly proven; else NULL
    notes        TEXT
);

-- Visual status marks decoded from styles (legend on RSP_EUR row 1:
-- CHANGE / Discontinued / NOT RELEASED / Delivery STOP / New Item added).
CREATE TABLE IF NOT EXISTS status_mark (
    sheet_id     INTEGER NOT NULL REFERENCES sheet(sheet_id),
    row_num      INTEGER NOT NULL,
    col_num      INTEGER NOT NULL,
    fill_rgb     TEXT,
    legend_label TEXT                    -- mapped meaning, NULL until legend map confirmed
);

CREATE INDEX IF NOT EXISTS idx_cell_sheet_row ON cell(sheet_id, row_num);
CREATE INDEX IF NOT EXISTS idx_product_part   ON product_row(part_number);
CREATE INDEX IF NOT EXISTS idx_config_part    ON config_row(part_number);
