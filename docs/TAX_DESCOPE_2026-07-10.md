# Tax Descope Decision — 2026-07-10

Blake Allard confirmed with Bryan Ovalle that Kinetic Bridge typically does not charge or
collect tax: services are not taxed, and materials/product are treated as reseller
pass-through.

## Decision

- Tax-engine integration is REMOVED from the remaining BI1-T71/QTS scope.
- Zoho Books Sales Tax Automation will NOT be enabled for this project.
- The local global tax-rate database will NOT be wired into QTS.
- Existing manual tax UI/fields in the widget (explicit-manual, Books-based `get_tax`
  bridge action returning "tax unavailable — stays manual") may remain; automatic tax
  calculation is not required for BI1-T71 completion.

## Separation (executed 2026-07-10)

The global tax-rate database built in handoff Rounds 20–28 is now a standalone personal
project owned by Blake, with possible future commercialization:

- New location: `/Users/blakeallard/Dev/web/taxatlas` (git repo, initial commit `72a5faa`;
  no GitHub remote yet — account choice + IP confirmation with Bill/Bryan pending).
- Moved there: `tax_data/` (SQLite DB, schema, registry, seeds, archive), `tax_sources/`
  (all adapters), `scripts/tax_resolver.py` / `tax_source_audit.py` / `tax_db_validate.py`
  / `tax_product_rules_validate.py`, and `docs/GLOBAL_TAX_DATABASE_ARCHITECTURE.md`
  (renamed `docs/ARCHITECTURE.md`).
- Post-copy verification in the new location: all validators PASS (57 jurisdictions,
  107 rates), resolver spot checks PASS (ZA, SG, CH, CA-NS historical), adapter re-run
  idempotent. `diff -r` old vs new: byte-identical before removal.
- Removed from this repo's working tree after verification (the files were never
  committed here, so no git history was affected).
- Retained here: this note, `docs/TAX_AUTOMATION_PLAN.md` (historical Books research),
  and the CURRENT_HANDOFF.md Round 16–28 tax entries.

## QTS consequence

Tax is no longer an integration blocker. Remaining BI1-T71 path: four UI visual
confirmations, commit/widget-repo decisions, final dev regression QA, controlled
production promotion.
