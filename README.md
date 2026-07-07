# BI1-T71: Implement Zoho-based form/template for quotes (item master, price book, automated calculations) and prototype applet for distributor pricing/margins

Zoho Task ID: 2543412000001469015

## Purpose

1. REQUEST + DESIRED WORKFLOW Requested task: Build a Zoho-based quote form using Zoho Forms or Creator that integrates with item master and price books to auto-calculate quotes; create a prototype applet for distributor pricing with margin controls Business problem: Quote generation is currently manual using draft templates without automation, inventory integration, or dynamic pricing; need form-driven workflow to route inquiries by type (BMS vs battery products) and auto-calculate pricing with margin controls How should this work: Sales team submits Zoho form with inquiry details → form auto-pulls items from item master and applies price books → applet performs calculations for BMS and battery product flows → generates quote with margin controls → stores in WorkDrive ready for delivery S

## Task metadata

- Task key: `BI1-T71`
- Title: Implement Zoho-based form/template for quotes (item master, price book, automated calculations) and prototype applet for distributor pricing/margins
- Zoho task ID: `2543412000001469015`
- Status: In Progress
- Source system: Zoho Projects
- Repository: https://github.com/blake-bevco-tech/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations

## Current status (as of 2026-07-06, commit `bef7bb7`)

**Deployed and verified in Creator dev (`qts` app, development environment):**

- Tier_Scheme-aware pricing (`fn_get_tier_price`, `fn_calc_quote_lines`, `fn_sync_to_sheet`) + data fix on 5 license SKUs (200100/200200/200300/200500/200600)
- Auto Line_Number on quote lines
- Currency field swap (Single Line → Dropdown; new field owns link name `Currency`)
- Writer merge/sign (`fn_generate_pdf`) — R6000/R2011 fixed, sign requests verified (`docs/WRITER_MERGE_SIGN_R6000_R2011_FINDINGS.md`)
- Draft-time autofill, all 4 workflows + `fn_calc_line_price_draft` (`docs/QUOTE_LINES_AUTOFILL_WORKFLOW_PLAN.md`)

Reference validation: SKU 200300 qty 22 → Unit_Price 676.14, Line_Total_USD 14875.00 (EUR rate 0.88).

**Open items:**

- Item_Master production import — blocked on business decisions for 300300/300500 duplicate confirmation, SKU 101815 unpriced/DRAFT handling, Partner exposure, Inquiry_Type, and DKK — see `docs/TIER_SCHEME_CREATOR_DEPLOYMENT_RUNBOOK.md` §11
  Working assumption for duplicate Service Tool rows: hidden RSP_EUR rows 54/55 are `EXCLUDE_CANDIDATE` legacy rows and visible rows 58/60 are `CANONICAL_CANDIDATE` current rows, pending Bill/Bryan confirmation and not approved.
  Vendor-marked discontinued SKUs `102100`, `103005`, `200400`, and `300400` are documented as excluded from live import/quoting by vendor discontinued status; Bill/Bryan visibility/override only, not approval-required blockers.
- 200999 reactivation SKU identity/pricing/scheme — pending Bill/Bryan
- LEM sensors 000833/000876/000637 price $0.00 at qty>19 — workbook evidence (`audit/reports/price_points.csv`, 2026-07-06): the higher tier cells are truly blank (no cell exists), not stored `0.00`, so any 0.00 originates downstream in import/defaulting logic; remaining decision is how blank tiers should behave
- Writer template repeating-table rebuild (manual, in Writer editor)
- `Quote_Lines` Discount/Discountable schema blocker (verified via Creator metadata 2026-07-06): no field with link name `Discountable` exists; the field displayed as "Discountable" has link name `Discount`, is a choice field with placeholder options "Choice 1/2/3", and is admin-only — so the commented-out writes in `deploy_ready/on_user_input_quote_lines_part_select.creator.deluge` and `deploy_ready/on_user_input_quote_lines_qty.creator.deluge` must stay commented. Unblocking requires schema changes (Tier 3 — Bill): remove/rebuild the stub `Discount` field (Decimal) and add a real `Discountable` field; note the stub currently owns the `Discount` link name
- Tier 3 cleanup (Bill): delete `Currency_old` field; recall duplicate sign request `504457000000209234`

Zoho Projects status comment posted 2026-07-06 on task `2543412000001469015` (comment `2543412000001533001`).

Detailed status: `QTS_PROJECT_STATUS.md`. Creator paste sources: `deploy_ready/` (never the `workflows/` originals — see parser notes Incident 5).

## Repository structure

- `TASK.md`: source task metadata and description
- `docs/`: documentation and deliverables
- `scripts/`: task-specific implementation
- `artifacts/`: approved supporting artifacts

Do not commit credentials, `.env` files, private tokens, or credential-bearing URLs.
