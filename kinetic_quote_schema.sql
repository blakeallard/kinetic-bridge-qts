-- =============================================================================
-- Kinetic Quote — SQLite Schema Template
-- Purpose: Local prototype schema for validating data model before Creator build
-- Version: 1.1 (post code-review fixes applied)
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =============================================================================
-- TABLE: document_type
-- Defines numbering sequences for QUOTE and SOW
-- =============================================================================
CREATE TABLE document_type (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    type_code           TEXT    NOT NULL UNIQUE,             -- 'QUOTE', 'SOW'
    prefix              TEXT    NOT NULL,                    -- 'QUOTE', 'SOW'
    last_issued_number  INTEGER NOT NULL DEFAULT 0,
    padding_length      INTEGER NOT NULL DEFAULT 4,
    include_year        INTEGER NOT NULL DEFAULT 0           -- 0 = false, 1 = true
        CHECK (include_year IN (0, 1)),
    active              INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- TABLE: document_number_log
-- Permanent audit log — every issued/reserved/cancelled document number
-- =============================================================================
CREATE TABLE document_number_log (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type_id         INTEGER NOT NULL REFERENCES document_type(id),
    document_id              TEXT    NOT NULL UNIQUE,        -- e.g. 'QUOTE0005'
    sequence_number          INTEGER NOT NULL,
    status                   TEXT    NOT NULL DEFAULT 'Reserved'
        CHECK (status IN ('Reserved', 'Issued', 'Cancelled', 'Voided')),
    requested_by             TEXT    NOT NULL,
    requested_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    -- FK enforced; ON DELETE SET NULL so log survives quote deletion
    linked_quote_request_id  INTEGER REFERENCES quote_request(id) ON DELETE SET NULL,
    linked_books_estimate_id TEXT,
    linked_project_task_id   TEXT,
    linked_workdrive_url     TEXT,
    notes                    TEXT,
    UNIQUE (document_type_id, sequence_number)               -- no duplicate sequence per type
);

CREATE INDEX idx_doc_log_type   ON document_number_log(document_type_id);
CREATE INDEX idx_doc_log_status ON document_number_log(status);

-- =============================================================================
-- TABLE: items
-- Item master — Acme BMS SKUs with EUR list prices per volume break
-- =============================================================================
CREATE TABLE items (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    sku                           TEXT    NOT NULL UNIQUE,
    item_name                     TEXT    NOT NULL,
    product_family                TEXT    NOT NULL
        CHECK (product_family IN ('n-BMS','n3-BMS','c-BMS24','c-BMS24X','i-BMS','Other')),
    category                      TEXT    NOT NULL
        CHECK (category IN ('Hardware','Software','Accessory')),
    sub_category                  TEXT,
    -- Volume-break hardware prices in EUR
    eur_price_1_9                 REAL    CHECK (eur_price_1_9 > 0 OR eur_price_1_9 IS NULL),
    eur_price_10_99               REAL    CHECK (eur_price_10_99 > 0 OR eur_price_10_99 IS NULL),
    eur_price_100_249             REAL    CHECK (eur_price_100_249 > 0 OR eur_price_100_249 IS NULL),
    eur_price_250_499             REAL    CHECK (eur_price_250_499 > 0 OR eur_price_250_499 IS NULL),
    eur_price_500_999             REAL    CHECK (eur_price_500_999 > 0 OR eur_price_500_999 IS NULL),
    eur_price_1000_2499           REAL    CHECK (eur_price_1000_2499 > 0 OR eur_price_1000_2499 IS NULL),
    eur_price_2500_plus           REAL    CHECK (eur_price_2500_plus > 0 OR eur_price_2500_plus IS NULL),
    -- Software uses a separate single price column (different discount structure)
    software_eur_price            REAL    CHECK (software_eur_price > 0 OR software_eur_price IS NULL),
    distributor_discount_eligible INTEGER NOT NULL DEFAULT 1
        CHECK (distributor_discount_eligible IN (0, 1)),
    active                        INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    npd                           INTEGER NOT NULL DEFAULT 0   -- Not yet released
        CHECK (npd IN (0, 1)),
    lead_time_notes               TEXT,
    source_record_id              TEXT,
    created_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
    -- Non-NPD active items must have at least one price populated
    CHECK (
        npd = 1 OR active = 0
        OR eur_price_1_9 IS NOT NULL
        OR software_eur_price IS NOT NULL
    )
);

CREATE INDEX idx_items_family   ON items(product_family);
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_active   ON items(active, npd);

-- =============================================================================
-- TABLE: price_rules
-- Distributor tier discount percentages and margin floors by volume bracket
-- =============================================================================
CREATE TABLE price_rules (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name               TEXT    NOT NULL,
    customer_type           TEXT    NOT NULL
        CHECK (customer_type IN ('Direct','Distributor','Partner','Internal')),
    -- NULL allowed for Direct/Internal; must be present for Distributor/Partner
    distributor_tier        TEXT
        CHECK (distributor_tier IS NULL OR distributor_tier IN ('Partner','Distributor')),
    product_category        TEXT    NOT NULL DEFAULT 'All'
        CHECK (product_category IN ('Hardware','Software','All')),
    volume_min              INTEGER NOT NULL DEFAULT 1,
    volume_max              INTEGER NOT NULL DEFAULT 999999,
    discount_percent        REAL    NOT NULL DEFAULT 0
        CHECK (discount_percent >= 0 AND discount_percent < 1),
    minimum_margin_percent  REAL    NOT NULL
        CHECK (minimum_margin_percent >= 0 AND minimum_margin_percent <= 0.95),  -- cap at 95% to prevent extreme minimum_allowed_price
    effective_start         TEXT,
    effective_end           TEXT,
    active                  INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (volume_min <= volume_max)
);

CREATE INDEX idx_price_rules_type ON price_rules(customer_type, product_category, active);

-- =============================================================================
-- TABLE: quote_request
-- Header record for a quote — one per customer inquiry
-- =============================================================================
CREATE TABLE quote_request (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number            TEXT    UNIQUE,
    customer_name           TEXT    NOT NULL,
    customer_email          TEXT,
    company                 TEXT,
    inquiry_type            TEXT    NOT NULL
        CHECK (inquiry_type IN ('BMS','Battery','Distributor','Other')),
    product_family          TEXT    NOT NULL
        CHECK (product_family IN ('n-BMS','n3-BMS','c-BMS24','c-BMS24X','i-BMS','Mixed','Other')),
    customer_currency       TEXT    NOT NULL DEFAULT 'USD'
        CHECK (customer_currency IN ('USD','DKK','EUR')),
    -- EUR → USD: how many USD per 1 EUR. e.g. 1.17 means 1 EUR = $1.17
    eur_usd_rate            REAL    NOT NULL
        CHECK (eur_usd_rate > 0),
    -- USD per DKK → Required if customer_currency = DKK.
    -- Naming: dkk_per_usd_rate means how many DKK per 1 USD. e.g. 6.41 means 1 USD = 6.41 DKK
    -- To convert: USD price * dkk_per_usd_rate = DKK price
    dkk_per_usd_rate        REAL
        CHECK (dkk_per_usd_rate IS NULL OR dkk_per_usd_rate > 0),
    markup_rate             REAL    NOT NULL
        CHECK (markup_rate >= 0 AND markup_rate <= 2.0),     -- capped at 200% markup
    payment_terms           TEXT    NOT NULL DEFAULT 'NET 15',
    shipping_terms          TEXT    NOT NULL DEFAULT 'FCA',
    wire_charge_amount      REAL    NOT NULL DEFAULT 0,
    request_source          TEXT    DEFAULT 'Manual'
        CHECK (request_source IN ('Manual','Email','CRM','Projects')),
    related_crm_record      TEXT,
    related_project_task    TEXT,
    request_description     TEXT    NOT NULL,
    status                  TEXT    NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft','Pricing','Review','Approved','Sent','Closed')),
    created_by              TEXT    NOT NULL,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_quote_request_status  ON quote_request(status);
CREATE INDEX idx_quote_request_company ON quote_request(company);

-- =============================================================================
-- TABLE: quote_lines
-- Individual line items with full pricing breakdown
-- Calculated fields are populated by triggers after INSERT or UPDATE
-- =============================================================================
CREATE TABLE quote_lines (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_request_id            INTEGER NOT NULL REFERENCES quote_request(id) ON DELETE CASCADE,
    item_id                     INTEGER NOT NULL REFERENCES items(id),
    quantity                    REAL    NOT NULL CHECK (quantity > 0),

    -- Input: pulled from items via volume-break lookup
    eur_list_price              REAL    NOT NULL CHECK (eur_list_price > 0),

    -- Input: pulled from quote_request header
    eur_usd_rate                REAL    NOT NULL CHECK (eur_usd_rate > 0),
    dkk_per_usd_rate            REAL    CHECK (dkk_per_usd_rate IS NULL OR dkk_per_usd_rate > 0),
    markup_rate                 REAL    NOT NULL CHECK (markup_rate >= 0 AND markup_rate <= 2.0),

    -- Input: pulled from price_rules
    distributor_discount_pct    REAL    NOT NULL DEFAULT 0
        CHECK (distributor_discount_pct >= 0 AND distributor_discount_pct < 1),
    minimum_margin_pct          REAL    NOT NULL
        CHECK (minimum_margin_pct >= 0 AND minimum_margin_pct <= 0.95),

    -- Input: manual entry v1 — source is distributor invoice (DKK cost / qty / dkk_per_usd_rate)
    unit_cost_usd               REAL    CHECK (unit_cost_usd IS NULL OR unit_cost_usd >= 0),

    -- Calculated fields — populated by trigger, do not set manually
    customer_unit_price_usd     REAL,   -- (eur_list_price * eur_usd_rate * (1-discount)) * (1+markup)
    customer_unit_price_dkk     REAL,   -- customer_unit_price_usd * dkk_per_usd_rate
    minimum_allowed_price_usd   REAL,   -- unit_cost_usd / (1 - minimum_margin_pct)
    final_unit_price_usd        REAL,   -- MAX(customer_unit_price_usd, minimum_allowed_price_usd)
    line_revenue_usd            REAL,   -- final_unit_price_usd * quantity
    line_cost_usd               REAL,   -- unit_cost_usd * quantity
    gross_margin_amount         REAL,   -- line_revenue_usd - line_cost_usd
    gross_margin_pct            REAL,   -- gross_margin_amount / line_revenue_usd

    -- margin_warning: 1 = below floor, 0 = ok, NULL = cost unknown (can't compute)
    margin_warning              INTEGER CHECK (margin_warning IS NULL OR margin_warning IN (0, 1)),

    lead_time_notes             TEXT,
    notes                       TEXT,
    created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_quote_lines_request ON quote_lines(quote_request_id);
CREATE INDEX idx_quote_lines_item    ON quote_lines(item_id);
CREATE INDEX idx_quote_lines_warning ON quote_lines(margin_warning);

-- =============================================================================
-- TABLE: quote_output
-- Final quote summary — totals, fees, profit, and document links
-- =============================================================================
CREATE TABLE quote_output (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_request_id        INTEGER NOT NULL UNIQUE REFERENCES quote_request(id),
    quote_number            TEXT    NOT NULL DEFAULT '',

    -- Rolled up from quote_lines
    total_revenue_usd       REAL    NOT NULL DEFAULT 0,
    total_cost_usd          REAL    NOT NULL DEFAULT 0,
    gross_margin_amount     REAL    NOT NULL DEFAULT 0,
    -- Stored as decimal (e.g. 0.25 = 25%) — multiply by 100 for display
    gross_margin_pct        REAL    NOT NULL DEFAULT 0,

    -- Fees (confirmed from observed profit sheet pattern)
    fx_charge_amount        REAL    NOT NULL DEFAULT 0,      -- total_revenue * 0.015 (1.5%)
    wire_charge_amount      REAL    NOT NULL DEFAULT 0,      -- flat fee from quote_request
    total_fees              REAL    NOT NULL DEFAULT 0,      -- fx + wire
    net_net_profit          REAL    NOT NULL DEFAULT 0,      -- gross_margin - total_fees

    has_margin_warnings     INTEGER NOT NULL DEFAULT 0
        CHECK (has_margin_warnings IN (0, 1)),

    approval_status         TEXT    NOT NULL DEFAULT 'Draft'
        CHECK (approval_status IN ('Draft','Needs Approval','Approved','Rejected')),
    generated_document_link TEXT,
    workdrive_folder_link   TEXT,

    created_by              TEXT    NOT NULL,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- SHARED CALCULATION EXPRESSION (documented here for reference)
--
-- raw_price     = (eur_list_price * eur_usd_rate * (1 - distributor_discount_pct)) * (1 + markup_rate)
-- min_price     = unit_cost_usd / (1 - minimum_margin_pct)   [only when cost known]
-- final_price   = MAX(raw_price, min_price)                   [only when cost known, else raw_price]
-- line_revenue  = final_price * quantity
-- line_cost     = unit_cost_usd * quantity
-- margin_amount = line_revenue - line_cost
-- margin_pct    = margin_amount / line_revenue                [NULL guard: if line_revenue = 0 → NULL]
-- margin_warn   = (margin_pct < minimum_margin_pct) ? 1 : 0  [NULL when cost unknown]
--
-- DKK conversion direction: customer_unit_price_dkk = customer_unit_price_usd * dkk_per_usd_rate
--   e.g. $100 USD × 6.41 DKK/USD = 641 DKK
-- =============================================================================

-- =============================================================================
-- TRIGGER: calculate quote_lines fields on INSERT
-- NOTE: trg_quote_lines_calc_insert MUST remain defined before
-- trg_update_quote_output_after_line_insert. SQLite fires AFTER INSERT triggers
-- in definition order. The output trigger reads line_revenue_usd which is written
-- by the calc trigger's UPDATE. Both fire within the same statement; the UPDATE
-- in the first trigger is visible to the SELECT in the second.
-- =============================================================================
CREATE TRIGGER trg_quote_lines_calc_insert
AFTER INSERT ON quote_lines
BEGIN
    UPDATE quote_lines SET
        -- Step 1: raw (discounted + marked-up) USD price
        customer_unit_price_usd = ROUND(
            (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
            * (1.0 + NEW.markup_rate),
            4
        ),
        -- Step 2: DKK equivalent — multiply USD by DKK-per-USD rate
        customer_unit_price_dkk = CASE
            WHEN NEW.dkk_per_usd_rate IS NOT NULL
            THEN ROUND(
                ((NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate))
                * NEW.dkk_per_usd_rate,
                4
            )
            ELSE NULL
        END,
        -- Step 3: minimum allowed price (margin floor guard)
        minimum_allowed_price_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct), 4)
            ELSE NULL
        END,
        -- Step 4: final price = MAX(raw, minimum) when cost known, else raw
        final_unit_price_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(
                MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ), 4
            )
            ELSE ROUND(
                (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate),
                4
            )
        END,
        -- Step 5: line totals
        line_revenue_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(
                MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ) * NEW.quantity, 2
            )
            ELSE ROUND(
                (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate) * NEW.quantity,
                2
            )
        END,
        line_cost_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(NEW.unit_cost_usd * NEW.quantity, 2)
            ELSE NULL
        END,
        -- Step 6: margin (NULL when cost unknown — do not default to 0)
        gross_margin_amount = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(
                MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ) * NEW.quantity
                - NEW.unit_cost_usd * NEW.quantity,
                2
            )
            ELSE NULL
        END,
        -- Step 7: margin % — guard against zero revenue (should not occur due to eur_list_price > 0)
        gross_margin_pct = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
                 AND (
                     MAX(
                         (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                         * (1.0 + NEW.markup_rate),
                         NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                     ) * NEW.quantity
                 ) > 0
            THEN ROUND(
                (
                    MAX(
                        (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                        * (1.0 + NEW.markup_rate),
                        NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                    ) * NEW.quantity
                    - NEW.unit_cost_usd * NEW.quantity
                )
                / (
                    MAX(
                        (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                        * (1.0 + NEW.markup_rate),
                        NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                    ) * NEW.quantity
                ),
                4
            )
            ELSE NULL
        END,
        -- Step 8: margin warning — NULL when cost unknown, not 0 (avoids false "ok" signal)
        margin_warning = CASE
            WHEN NEW.unit_cost_usd IS NULL THEN NULL
            WHEN (
                (
                    MAX(
                        (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                        * (1.0 + NEW.markup_rate),
                        NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                    ) * NEW.quantity
                    - NEW.unit_cost_usd * NEW.quantity
                )
                / NULLIF(
                    MAX(
                        (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                        * (1.0 + NEW.markup_rate),
                        NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                    ) * NEW.quantity,
                    0
                )
            ) < NEW.minimum_margin_pct THEN 1
            ELSE 0
        END,
        updated_at = datetime('now')
    WHERE id = NEW.id;
END;

-- =============================================================================
-- TRIGGER: recalculate quote_output after INSERT on quote_lines
-- Depends on trg_quote_lines_calc_insert running first (definition order matters)
-- =============================================================================
CREATE TRIGGER trg_update_quote_output_after_line_insert
AFTER INSERT ON quote_lines
BEGIN
    INSERT INTO quote_output (
        quote_request_id, quote_number,
        total_revenue_usd, total_cost_usd, gross_margin_amount, gross_margin_pct,
        fx_charge_amount, wire_charge_amount, total_fees, net_net_profit,
        has_margin_warnings, approval_status, created_by
    )
    SELECT
        qr.id,
        COALESCE(qr.quote_number, ''),
        COALESCE(SUM(ql.line_revenue_usd), 0),
        COALESCE(SUM(ql.line_cost_usd), 0),
        COALESCE(SUM(ql.gross_margin_amount), 0),
        CASE
            WHEN COALESCE(SUM(ql.line_revenue_usd), 0) > 0
            THEN ROUND(COALESCE(SUM(ql.gross_margin_amount), 0) / SUM(ql.line_revenue_usd), 4)
            ELSE 0
        END,
        ROUND(COALESCE(SUM(ql.line_revenue_usd), 0) * 0.015, 2),
        qr.wire_charge_amount,
        ROUND(COALESCE(SUM(ql.line_revenue_usd), 0) * 0.015, 2) + qr.wire_charge_amount,
        COALESCE(SUM(ql.gross_margin_amount), 0)
            - ROUND(COALESCE(SUM(ql.line_revenue_usd), 0) * 0.015, 2)
            - qr.wire_charge_amount,
        COALESCE(MAX(ql.margin_warning), 0),
        'Draft',
        qr.created_by
    FROM quote_request qr
    JOIN quote_lines ql ON ql.quote_request_id = qr.id
    WHERE qr.id = NEW.quote_request_id
    GROUP BY qr.id
    ON CONFLICT(quote_request_id) DO UPDATE SET
        quote_number        = excluded.quote_number,
        total_revenue_usd   = excluded.total_revenue_usd,
        total_cost_usd      = excluded.total_cost_usd,
        gross_margin_amount = excluded.gross_margin_amount,
        gross_margin_pct    = excluded.gross_margin_pct,
        fx_charge_amount    = excluded.fx_charge_amount,
        wire_charge_amount  = excluded.wire_charge_amount,
        total_fees          = excluded.total_fees,
        net_net_profit      = excluded.net_net_profit,
        has_margin_warnings = excluded.has_margin_warnings,
        updated_at          = datetime('now');
END;

-- =============================================================================
-- TRIGGER: recalculate on UPDATE of quote_lines inputs
-- =============================================================================
CREATE TRIGGER trg_quote_lines_calc_update
AFTER UPDATE OF eur_list_price, eur_usd_rate, dkk_per_usd_rate, markup_rate,
               distributor_discount_pct, minimum_margin_pct, unit_cost_usd, quantity
ON quote_lines
BEGIN
    UPDATE quote_lines SET
        customer_unit_price_usd = ROUND(
            (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
            * (1.0 + NEW.markup_rate), 4
        ),
        customer_unit_price_dkk = CASE
            WHEN NEW.dkk_per_usd_rate IS NOT NULL
            THEN ROUND(
                ((NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate)) * NEW.dkk_per_usd_rate, 4
            )
            ELSE NULL
        END,
        minimum_allowed_price_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct), 4)
            ELSE NULL
        END,
        final_unit_price_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(MAX(
                (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate),
                NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
            ), 4)
            ELSE ROUND(
                (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate), 4
            )
        END,
        line_revenue_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(MAX(
                (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate),
                NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
            ) * NEW.quantity, 2)
            ELSE ROUND(
                (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                * (1.0 + NEW.markup_rate) * NEW.quantity, 2
            )
        END,
        line_cost_usd = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(NEW.unit_cost_usd * NEW.quantity, 2)
            ELSE NULL
        END,
        gross_margin_amount = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
            THEN ROUND(
                MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ) * NEW.quantity - NEW.unit_cost_usd * NEW.quantity,
                2
            )
            ELSE NULL
        END,
        gross_margin_pct = CASE
            WHEN NEW.unit_cost_usd IS NOT NULL
                 AND MAX(
                     (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                     * (1.0 + NEW.markup_rate),
                     NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                 ) * NEW.quantity > 0
            THEN ROUND(
                (MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ) * NEW.quantity - NEW.unit_cost_usd * NEW.quantity)
                / (MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ) * NEW.quantity),
                4
            )
            ELSE NULL
        END,
        margin_warning = CASE
            WHEN NEW.unit_cost_usd IS NULL THEN NULL
            WHEN (
                (MAX(
                    (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                    * (1.0 + NEW.markup_rate),
                    NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                ) * NEW.quantity - NEW.unit_cost_usd * NEW.quantity)
                / NULLIF(
                    MAX(
                        (NEW.eur_list_price * NEW.eur_usd_rate * (1.0 - NEW.distributor_discount_pct))
                        * (1.0 + NEW.markup_rate),
                        NEW.unit_cost_usd / (1.0 - NEW.minimum_margin_pct)
                    ) * NEW.quantity, 0
                )
            ) < NEW.minimum_margin_pct THEN 1
            ELSE 0
        END,
        updated_at = datetime('now')
    WHERE id = NEW.id;
END;

-- =============================================================================
-- TRIGGER: recalculate quote_output after UPDATE on quote_lines
-- =============================================================================
CREATE TRIGGER trg_update_quote_output_after_line_update
AFTER UPDATE OF eur_list_price, eur_usd_rate, markup_rate,
               distributor_discount_pct, minimum_margin_pct, unit_cost_usd, quantity
ON quote_lines
BEGIN
    UPDATE quote_output SET
        quote_number        = COALESCE((SELECT quote_number FROM quote_request WHERE id = NEW.quote_request_id), ''),
        total_revenue_usd   = COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0),
        total_cost_usd      = COALESCE((SELECT SUM(ql.line_cost_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0),
        gross_margin_amount = COALESCE((SELECT SUM(ql.gross_margin_amount) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0),
        gross_margin_pct    = CASE
            WHEN COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0) > 0
            THEN ROUND(
                COALESCE((SELECT SUM(ql.gross_margin_amount) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0)
                / (SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id),
                4
            )
            ELSE 0
        END,
        fx_charge_amount    = ROUND(COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0) * 0.015, 2),
        wire_charge_amount  = (SELECT wire_charge_amount FROM quote_request WHERE id = NEW.quote_request_id),
        total_fees          = ROUND(COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0) * 0.015, 2)
                              + (SELECT wire_charge_amount FROM quote_request WHERE id = NEW.quote_request_id),
        net_net_profit      = COALESCE((SELECT SUM(ql.gross_margin_amount) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0)
                              - ROUND(COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0) * 0.015, 2)
                              - (SELECT wire_charge_amount FROM quote_request WHERE id = NEW.quote_request_id),
        has_margin_warnings = COALESCE((SELECT MAX(ql.margin_warning) FROM quote_lines ql WHERE ql.quote_request_id = NEW.quote_request_id), 0),
        updated_at          = datetime('now')
    WHERE quote_request_id = NEW.quote_request_id;
END;

-- =============================================================================
-- TRIGGER: recalculate quote_output after DELETE on quote_lines
-- =============================================================================
CREATE TRIGGER trg_update_quote_output_after_line_delete
AFTER DELETE ON quote_lines
BEGIN
    UPDATE quote_output SET
        total_revenue_usd   = COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0),
        total_cost_usd      = COALESCE((SELECT SUM(ql.line_cost_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0),
        gross_margin_amount = COALESCE((SELECT SUM(ql.gross_margin_amount) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0),
        gross_margin_pct    = CASE
            WHEN COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0) > 0
            THEN ROUND(
                COALESCE((SELECT SUM(ql.gross_margin_amount) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0)
                / (SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id),
                4
            )
            ELSE 0
        END,
        fx_charge_amount    = ROUND(COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0) * 0.015, 2),
        total_fees          = ROUND(COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0) * 0.015, 2)
                              + (SELECT wire_charge_amount FROM quote_request WHERE id = OLD.quote_request_id),
        net_net_profit      = COALESCE((SELECT SUM(ql.gross_margin_amount) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0)
                              - ROUND(COALESCE((SELECT SUM(ql.line_revenue_usd) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0) * 0.015, 2)
                              - (SELECT wire_charge_amount FROM quote_request WHERE id = OLD.quote_request_id),
        has_margin_warnings = COALESCE((SELECT MAX(ql.margin_warning) FROM quote_lines ql WHERE ql.quote_request_id = OLD.quote_request_id), 0),
        updated_at          = datetime('now')
    WHERE quote_request_id = OLD.quote_request_id;
END;

-- =============================================================================
-- VIEW: v_quote_line_detail
-- Full pricing breakdown per line — main working view
-- =============================================================================
CREATE VIEW v_quote_line_detail AS
SELECT
    ql.id                                               AS line_id,
    qr.id                                               AS quote_request_id,
    qr.quote_number,
    qr.company,
    qr.customer_name,
    qr.customer_currency,
    qr.status                                           AS quote_status,
    i.sku,
    i.item_name,
    i.product_family,
    i.category,
    i.sub_category,
    ql.quantity,
    ql.eur_list_price,
    ql.eur_usd_rate,
    ql.dkk_per_usd_rate,
    ql.distributor_discount_pct,
    ql.markup_rate,
    ROUND(ql.customer_unit_price_usd, 4)                AS customer_unit_price_usd,
    ROUND(ql.customer_unit_price_dkk, 4)                AS customer_unit_price_dkk,
    ROUND(ql.minimum_allowed_price_usd, 4)              AS minimum_allowed_price_usd,
    ROUND(ql.final_unit_price_usd, 4)                   AS final_unit_price_usd,
    ROUND(ql.line_revenue_usd, 2)                       AS line_revenue_usd,
    ql.unit_cost_usd,
    ROUND(ql.line_cost_usd, 2)                          AS line_cost_usd,
    ROUND(ql.gross_margin_amount, 2)                    AS gross_margin_amount,
    ROUND(ql.gross_margin_pct * 100, 2)                 AS gross_margin_pct_display,
    ql.minimum_margin_pct * 100                         AS minimum_margin_pct_display,
    ql.margin_warning,                                  -- NULL = cost unknown, 0 = ok, 1 = below floor
    ql.lead_time_notes,
    ql.notes
FROM quote_lines ql
JOIN quote_request qr ON qr.id = ql.quote_request_id
JOIN items i ON i.id = ql.item_id;

-- =============================================================================
-- VIEW: v_profit_summary
-- Internal profit view per quote — mirrors the Profit sheet from the spreadsheet
-- gross_margin_pct stored as decimal; multiply by 100 for display
-- =============================================================================
CREATE VIEW v_profit_summary AS
SELECT
    qr.id                                               AS quote_request_id,
    qr.quote_number,
    qr.company,
    qr.customer_name,
    qr.customer_currency,
    qr.status,
    ROUND(qo.total_revenue_usd, 2)                      AS total_revenue_usd,
    ROUND(qo.total_cost_usd, 2)                         AS total_cost_usd,
    ROUND(qo.gross_margin_amount, 2)                    AS gross_margin_amount,
    ROUND(qo.gross_margin_pct * 100, 2)                 AS gross_margin_pct,
    ROUND(qo.fx_charge_amount, 2)                       AS fx_charge_1_5pct,
    ROUND(qo.wire_charge_amount, 2)                     AS int_wire_charge,
    ROUND(qo.total_fees, 2)                             AS total_fees,
    ROUND(qo.net_net_profit, 2)                         AS net_net_profit,
    qo.has_margin_warnings,
    qo.approval_status
FROM quote_output qo
JOIN quote_request qr ON qr.id = qo.quote_request_id;

-- =============================================================================
-- VIEW: v_document_log
-- Audit view — all issued/reserved document numbers
-- =============================================================================
CREATE VIEW v_document_log AS
SELECT
    dnl.document_id,
    dt.type_code,
    dnl.sequence_number,
    dnl.status,
    dnl.requested_by,
    dnl.requested_at,
    qr.company                                          AS linked_company,
    qr.customer_name                                    AS linked_customer,
    dnl.linked_books_estimate_id,
    dnl.linked_project_task_id,
    dnl.linked_workdrive_url,
    dnl.notes
FROM document_number_log dnl
JOIN document_type dt ON dt.id = dnl.document_type_id
LEFT JOIN quote_request qr ON qr.id = dnl.linked_quote_request_id
ORDER BY dnl.sequence_number DESC;

-- =============================================================================
-- VIEW: v_item_price_lookup
-- Flattens all volume-break pricing (hardware + software) into rows
-- Useful for validating "which EUR price applies at qty X for this SKU?"
-- =============================================================================
CREATE VIEW v_item_price_lookup AS
-- Hardware volume-break rows
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware' AS price_type,
       1 AS vol_min, 9 AS vol_max, eur_price_1_9 AS eur_price
FROM items WHERE eur_price_1_9 IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware', 10, 99, eur_price_10_99
FROM items WHERE eur_price_10_99 IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware', 100, 249, eur_price_100_249
FROM items WHERE eur_price_100_249 IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware', 250, 499, eur_price_250_499
FROM items WHERE eur_price_250_499 IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware', 500, 999, eur_price_500_999
FROM items WHERE eur_price_500_999 IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware', 1000, 2499, eur_price_1000_2499
FROM items WHERE eur_price_1000_2499 IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
SELECT sku, item_name, product_family, category, sub_category,
       'Hardware', 2500, 999999, eur_price_2500_plus
FROM items WHERE eur_price_2500_plus IS NOT NULL AND active = 1 AND npd = 0
UNION ALL
-- Software single-price rows (no volume break)
SELECT sku, item_name, product_family, category, sub_category,
       'Software', 1, 999999, software_eur_price
FROM items WHERE software_eur_price IS NOT NULL AND active = 1 AND npd = 0;

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Document types — seed at last known issued number
-- IMPORTANT: Confirm last_issued_number with Bill/Brian before using in production
INSERT INTO document_type (type_code, prefix, last_issued_number, padding_length, include_year, active)
VALUES
    ('QUOTE', 'QUOTE', 4, 4, 0, 1),   -- Last confirmed issued: QUOTE0004
    ('SOW',   'SOW',   0, 4, 0, 1);   -- Unknown — seed at 0 until confirmed

-- Historical document log (known issued numbers)
INSERT INTO document_number_log (
    document_type_id, document_id, sequence_number, status,
    requested_by, requested_at, notes
)
SELECT id, 'QUOTE0001', 1, 'Issued', 'bill@bevco-tech.com', '2026-01-01T00:00:00',
       'Imported from historical records'
FROM document_type WHERE type_code = 'QUOTE';

INSERT INTO document_number_log (
    document_type_id, document_id, sequence_number, status,
    requested_by, requested_at, notes
)
SELECT id, 'QUOTE0002', 2, 'Issued', 'bill@bevco-tech.com', '2026-01-01T00:00:00',
       'Imported from historical records'
FROM document_type WHERE type_code = 'QUOTE';

INSERT INTO document_number_log (
    document_type_id, document_id, sequence_number, status,
    requested_by, requested_at, notes
)
SELECT id, 'QUOTE0003', 3, 'Issued', 'bill@bevco-tech.com', '2026-01-01T00:00:00',
       'Imported from historical records'
FROM document_type WHERE type_code = 'QUOTE';

INSERT INTO document_number_log (
    document_type_id, document_id, sequence_number, status,
    requested_by, requested_at, notes
)
SELECT id, 'QUOTE0004', 4, 'Issued', 'bill@bevco-tech.com', '2026-05-29T00:00:00',
       'n-BMS system quote — imported from historical records'
FROM document_type WHERE type_code = 'QUOTE';

-- Price rules — structure only; discount_percent and minimum_margin_percent are 0.00 placeholders
-- REPLACE with confirmed values from Bill/Brian before testing pricing
INSERT INTO price_rules (rule_name, customer_type, distributor_tier, product_category,
    volume_min, volume_max, discount_percent, minimum_margin_percent, active)
VALUES
    ('Partner HW 1-9',          'Partner',     'Partner',     'Hardware', 1,    9,      0.00, 0.00, 1),
    ('Partner HW 10-99',        'Partner',     'Partner',     'Hardware', 10,   99,     0.00, 0.00, 1),
    ('Partner HW 100-249',      'Partner',     'Partner',     'Hardware', 100,  249,    0.00, 0.00, 1),
    ('Partner HW 250-499',      'Partner',     'Partner',     'Hardware', 250,  499,    0.00, 0.00, 1),
    ('Partner HW 500-999',      'Partner',     'Partner',     'Hardware', 500,  999,    0.00, 0.00, 1),
    ('Partner HW 1000-2499',    'Partner',     'Partner',     'Hardware', 1000, 2499,   0.00, 0.00, 1),
    ('Partner HW 2500+',        'Partner',     'Partner',     'Hardware', 2500, 999999, 0.00, 0.00, 1),
    ('Partner SW',              'Partner',     'Partner',     'Software', 1,    999999, 0.00, 0.00, 1),
    ('Distributor HW 1-9',      'Distributor', 'Distributor', 'Hardware', 1,    9,      0.00, 0.00, 1),
    ('Distributor HW 10-99',    'Distributor', 'Distributor', 'Hardware', 10,   99,     0.00, 0.00, 1),
    ('Distributor HW 100-249',  'Distributor', 'Distributor', 'Hardware', 100,  249,    0.00, 0.00, 1),
    ('Distributor HW 250-499',  'Distributor', 'Distributor', 'Hardware', 250,  499,    0.00, 0.00, 1),
    ('Distributor HW 500-999',  'Distributor', 'Distributor', 'Hardware', 500,  999,    0.00, 0.00, 1),
    ('Distributor SW',          'Distributor', 'Distributor', 'Software', 1,    999999, 0.00, 0.00, 1),
    ('Direct All',              'Direct',      NULL,          'All',      1,    999999, 0.00, 0.00, 1);

-- Items — placeholder structure; prices are NULL until CSV import from price list
-- Non-NPD items omit all EUR prices so the CHECK constraint (npd=1 OR price NOT NULL)
-- is satisfied via the npd=0 + price NOT NULL path; import real values before quoting
INSERT INTO items (sku, item_name, product_family, category, sub_category,
    eur_price_1_9,  -- placeholder: NULL until price list imported
    distributor_discount_eligible, active, npd, lead_time_notes)
VALUES
    ('[MCU_PART#]',     'n-BMS Master Control Unit (MCU) with CAN termination',
     'n-BMS', 'Hardware', 'MCU',               NULL, 1, 0, 1, '1-2 weeks'),
    ('[CMU_PART#]',     'n-BMS CMU 12/2 top mount isoSPI — 200mA balancing',
     'n-BMS', 'Hardware', 'CMU',               NULL, 1, 0, 1, '1-2 weeks'),
    ('100985.1',        'n-BMS CMU 12/2 wire harness kit (1700mm) shielded',
     'n-BMS', 'Accessory', 'Wire Harness',     NULL, 0, 0, 1, '2-3 weeks'),
    ('[MCU_HARNESS#]',  'n-BMS wire harness kit for MCU',
     'n-BMS', 'Accessory', 'Wire Harness',     NULL, 0, 0, 1, '2-3 weeks'),
    ('[SW_CREATOR#]',   'n-BMS Unified Creator License FULL',
     'n-BMS', 'Software', 'Creator License',   NULL, 1, 0, 1, 'provide email/user ID for activation'),
    ('[SW_SERVICE#]',   'n-BMS Unified Service Tool',
     'n-BMS', 'Software', 'Service Tool',      NULL, 1, 0, 1, 'up to 249 users'),
    ('[CAN_ADAPTER#]',  'Peak CAN adapter for n-BMS',
     'n-BMS', 'Accessory', 'Adapter',          NULL, 0, 0, 1, '1-2 weeks'),
    -- NPD item — price columns allowed NULL, npd=1
    ('[CMU18_4#]',      'n-BMS CMU18/4 top mount isoSPI — NPD',
     'n-BMS', 'Hardware', 'CMU',               NULL, 1, 1, 1, 'NPD — coming soon');

-- NOTE: eur_price_1_9 is NULL for all items above.
-- The CHECK (npd=1 OR active=0 OR eur_price_1_9 IS NOT NULL OR software_eur_price IS NOT NULL)
-- requires that active=1 AND npd=0 items have at least one price.
-- The 7 non-NPD items above are inserted with active=0 (npd column = 1 passed as 4th positional
-- but those are active=0 per the VALUES). Wait — let me re-check:
-- The VALUES above pass: ..., NULL, 1, 0, 1, '...'  where positions are:
--   eur_price_1_9=NULL, distributor_discount_eligible=1, active=0, npd=1, lead_time_notes='...'
-- So active=0 for all placeholder items — CHECK passes (active=0 satisfies OR clause).
-- Set active=1 ONLY after importing real prices via CSV.

-- Sample quote request (sanitized QUOTE0004 equivalent)
INSERT INTO quote_request (
    quote_number, customer_name, customer_email, company,
    inquiry_type, product_family, customer_currency,
    eur_usd_rate, dkk_per_usd_rate, markup_rate,
    payment_terms, shipping_terms, wire_charge_amount,
    request_source, request_description, status, created_by
) VALUES (
    'QUOTE0004',
    '[Customer Name]', '[customer@example.com]', '[Company Name]',
    'BMS', 'n-BMS', 'DKK',
    1.17,   -- EUR per USD rate from observed quote (1 EUR = $1.17 USD)
    6.41,   -- DKK per USD rate from observed quote (1 USD = 6.41 DKK)
    0.00,   -- REPLACE: confirm markup_rate with Bill/Brian
    'NET 15', 'FCA',
    0.00,   -- REPLACE: confirm wire_charge_amount with Bill/Brian
    'Manual',
    'n-BMS system quote — 96 channels / 400V NMC cell configuration',
    'Sent',
    'bill@bevco-tech.com'
);

-- Link QUOTE0004 log entry to the sample quote request
UPDATE document_number_log
SET linked_quote_request_id = (SELECT id FROM quote_request WHERE quote_number = 'QUOTE0004')
WHERE document_id = 'QUOTE0004';

-- =============================================================================
-- USEFUL TEST QUERIES (uncomment and run after populating real prices/rules)
-- =============================================================================

-- 1. Full line detail for a specific quote
-- SELECT * FROM v_quote_line_detail WHERE quote_number = 'QUOTE0005';

-- 2. All quotes with margin warnings
-- SELECT quote_number, company, sku, item_name, gross_margin_pct_display, minimum_margin_pct_display
-- FROM v_quote_line_detail WHERE margin_warning = 1;

-- 3. Lines where cost is unknown (margin_warning IS NULL)
-- SELECT quote_number, sku, item_name FROM v_quote_line_detail WHERE margin_warning IS NULL;

-- 4. Profit summary for all approved quotes
-- SELECT * FROM v_profit_summary WHERE approval_status = 'Approved';

-- 5. Lookup EUR price for a SKU at a given quantity
-- SELECT sku, item_name, price_type, eur_price
-- FROM v_item_price_lookup
-- WHERE sku = '[MCU_PART#]' AND vol_min <= 30 AND vol_max >= 30;

-- 6. Verify next document number before issuing
-- SELECT type_code,
--        prefix || printf('%04d', last_issued_number + 1) AS next_id
-- FROM document_type WHERE type_code = 'QUOTE' AND active = 1;

-- 7. Full document audit log
-- SELECT * FROM v_document_log;

-- 8. DKK conversion sanity check: $100 USD at 6.41 DKK/USD should give 641 DKK
-- SELECT 100.0 * 6.41 AS expected_dkk_641;  -- verify formula direction

-- 9. Pricing formula end-to-end test (replace values with real data)
-- INSERT INTO quote_lines (quote_request_id, item_id, quantity,
--     eur_list_price, eur_usd_rate, dkk_per_usd_rate,
--     distributor_discount_pct, markup_rate, minimum_margin_pct, unit_cost_usd)
-- SELECT
--     (SELECT id FROM quote_request WHERE quote_number = 'QUOTE0004'),
--     (SELECT id FROM items WHERE sku = '[MCU_PART#]'),
--     30,
--     [EUR_PRICE_FROM_PRICELIST],   -- e.g. 850.00
--     1.17, 6.41,
--     [DISCOUNT_FROM_PRICE_RULES],  -- e.g. 0.30
--     [CONFIRMED_MARKUP_RATE],      -- e.g. 0.20
--     [CONFIRMED_MIN_MARGIN],       -- e.g. 0.25
--     [UNIT_COST_USD_FROM_INVOICE]; -- e.g. 545.00
-- SELECT * FROM v_quote_line_detail WHERE quote_number = 'QUOTE0004';
