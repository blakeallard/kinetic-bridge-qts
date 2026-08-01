# QTS Tax Automation Plan (HISTORICAL — descoped 2026-07-10)

> **2026-07-10 decision (Blake + Bryan):** Kinetic Bridge does not charge or collect tax;
> tax integration is REMOVED from BI1-T71/QTS scope. Do not enable Books Sales Tax
> Automation; do not wire any tax engine into QTS. This document is retained as
> historical research only. The local global tax-rate database was separated into a
> standalone personal project at `/Users/blakeallard/Dev/web/taxatlas` — see
> `docs/TAX_DESCOPE_2026-07-10.md`.

## Research findings 2026-07-09 (official docs; org 892868938 has taxes=[] / authorities=[])

Constraint from Blake: do NOT enable org-wide Sales Tax Automation without approval.

A. Read-only address-specific tax via Books API: **NO.** Taxes API only lists configured
   taxes; no read-only endpoint resolves an address to a rate.
B. Estimate probe WITHOUT automation: **NO.** Books API v3 create-estimate requires an
   explicit `tax_id` per line from configured taxes; no address-based calculation happens
   on API-created estimates unless Sales Tax Automation is enabled. With taxes=[] there is
   nothing to reference — probe would compute nothing.
C. Therefore the estimate-probe path REQUIRES enabling org-wide Sales Tax Automation first
   (org-level toggle, Avalara-powered, billing-address default, auto-calculates on new sales
   transactions). Estimates/quotes coverage is not explicitly documented — only invoices/
   sales orders/recurring invoices are named in the help doc.
D. Preview/calculate-without-transaction endpoint: **NONE documented** in Books API v3 or
   the Sales Tax Automation help.
E. Scope-limiting: automation is org-level. Mitigation documented: a per-transaction
   "Tax Mode" field (automated vs manual) exists AFTER enablement, and existing mapped tax
   authorities apply to NEW transactions only. There is NO documented customer-, module-, or
   app-scoped enablement. Enabling it changes default behavior for company-wide new sales
   transactions -> requires explicit business approval; not a QTS-isolated switch.

Direct Avalara option (QTS-isolated): AvaTax REST v2 `CreateTransaction` with
`type=SalesOrder` calculates authoritative address-specific tax from ship-from/ship-to
addresses + line items WITHOUT recording a permanent transaction (docs: designed for carts/
quotes; commit applies only to invoice types). Fully independent of Zoho Books -> zero impact
on company accounting. Requires an Avalara AvaTax account + license key (paid product; free
sandbox/dev accounts exist for evaluation). **No evidence of any existing Kinetic Bridge
Avalara account** (repo/global config grep: zero hits) — Books' built-in automation is
Avalara-powered via the Zoho toggle, which is not a standalone AvaTax credential.

Decision matrix for Bill/Blake:
1. Enable Books Sales Tax Automation (free with paid Books; org-wide default change;
   per-transaction manual override exists) -> then estimate-probe becomes viable.
2. Standalone AvaTax sandbox->prod account for QTS only (fully isolated; new vendor cost;
   bridge would call AvaTax directly from Deluge via a new connection).
3. Continue manual Tax Rate entry (current explicit behavior) until a decision.


Date: 2026-07-09. Status: **plumbing complete, source BLOCKED** — no authoritative tax
source is connected. Nothing in QTS presents a fake or hardcoded tax rate.

## Authoritative source decision

Zoho Books **Sales Tax Automation** is the designated source, if and only if a valid Books
organization and an authenticated Creator connection are proven.

Evidence audited 2026-07-09 (repo + live MCP):

- No Books organization ID anywhere in the repo; Books MCP tools require one and none is
  returned under current auth (also recorded in global CLAUDE.md).
- Creator connections in use: `zoho_sheet`, `zoho_writter`, `zoho_sign_connection` — **no
  Books connection exists**.
- Project charter (`kinetic_quote_instructions.md`) lists Books access as *Unknown* and gates
  Books integration to "v2 after accounting/process approval".
- No tax fields exist on live CRM Contacts/Accounts, and `Quote_Request` has no tax fields.
- `fn_generate_pdf.deluge` hardcodes `taxAmt = 0.00`.

**UPDATE 2026-07-09 (later):** Creator connection **`zoho_books_connection`** now exists,
authorized READ-ONLY for: Get all Organizations, Get all Taxes, Get all Tax Authorities.
No create/update/delete permissions. The bridge now has:

- `books_diag` action — read-only: GET /books/v3/organizations, then settings/taxes and
  settings/taxauthorities for the first org; returns org metadata (id/name/country/currency/
  sales_tax_type/version) + configured taxes + authorities as Result_jSON evidence.
- `get_tax` — resolves the organization DYNAMICALLY via GET /organizations (no hardcoded
  org id; errors explicitly if 0 or >1 orgs), reads the configured tax list as evidence, and
  returns an explicit `insufficient_permissions` error: a configured tax LIST is not
  address-based Sales Tax Automation; address-specific rates are computed at transaction
  level.

**REMAINING BLOCKER (narrowed):** the connection cannot be exercised outside Creator Deluge,
so (1) one re-paste of the bridge script deploys `books_diag`/the new `get_tax`; (2) running
`books_diag` (via widget or MCP CRM_Bridge record) returns the real organization ID and tax
config; (3) for an ADDRESS-SPECIFIC authoritative rate, the smallest additional Books
permission is **Estimates → Create** (draft-estimate probe: create draft estimate with the
basis address → read computed tax → the draft can be left as draft or deleted only with a
separately-approved delete permission). Read-only scopes alone cannot produce an
address-specific rate — that is a Books API design fact, not a configuration gap.

## Tax basis

Zoho Books' documented default basis is the **billing address**; Books can be configured to
use shipping instead. Kinetic Bridge's actual preference is UNKNOWN — the widget constant
`TAX_BASIS = 'billing'` (app/widget.js) is a plumbing default matching Books' documented
default, explicitly NOT a business policy. Read Books' configured preference (or get
Bill/Bryan's answer) and set it when the source is connected.

## Bridge contract (implemented in CRM_Bridge `get_tax`)

Request — `Action_field = get_tax`, `Payload_JSON`:

```json
{"basis": "billing", "billing": {"street": "…", "city": "…", "state": "…", "code": "…",
 "country": "…"}, "shipping": {…}, "mailing": {…}}
```

Success response (`Result_jSON`, `Request_Status = done`):

```json
{"rate": 7.75, "amount": null, "tax_name": "…", "jurisdiction": "…",
 "basis_used": "billing", "tax_status": "taxable|non_taxable|exempt",
 "source": "zoho_books"}
```

Failure: `Request_Status = error` + `{"error": "…", "tax_status": "not_connected"}` —
the widget shows "Tax unavailable — authoritative tax source not connected" and keeps the
manual Tax Rate field usable. An API failure is NEVER converted into an authoritative 0%.

Current deployed behavior: the action returns the explicit not-connected error until the two
constants at the top of the `get_tax` block (`books_org_id`, `books_connection_link`) are
filled and the Books call implemented.

## Books call implementation notes (for when the org exists)

Books' address-based Sales Tax Automation applies at transaction level (US editions): tax is
computed when a transaction (estimate) is created for a customer whose address is set. Two
candidate shapes, decide against the real Books config:

1. `invokeurl` GET `settings/taxes` via the Books connection → match the address's
   jurisdiction to a configured tax — only valid if Kinetic Bridge maintains taxes manually.
2. Draft-estimate probe: upsert a Books customer with the basis address, create a draft
   estimate with one line, read the computed tax, delete the draft — authoritative under
   Sales Tax Automation, heavier. Requires accounting approval per charter.

## Quote_Request schema needed for persistence (NOT yet added — approval required)

- `Tax_Rate` (Decimal, 2)
- `Tax_Amount` (Decimal, 2)
- `Tax_Source` (Single Line: zoho_books | manual)
- `Tax_Basis` (Single Line: billing | shipping)
- `Tax_Status` (Single Line: taxable | non_taxable | exempt | not_connected)
- `Tax_Jurisdiction` (Single Line)

## fn_generate_pdf change (exact, staged only — do NOT deploy before schema + approval)

Current (line ~78): `taxAmt = 0.00;`

Replace with (after `Tax_Amount` exists on Quote_Request):

```deluge
taxAmt = 0.00;
persisted_tax = ifnull(quote.Tax_Amount,0.0);
taxAmt = persisted_tax;
```

`totalAmt` (line ~98) and the `mergeFields.put("tax", …)` line (~178) already consume
`taxAmt` and need no change. Until the schema lands, the PDF's 0.00 is a known limitation,
not final production behavior.

## Widget behavior (implemented)

- Selecting a CRM customer triggers `get_tax` with the customer's bridge-returned addresses.
- Success: Tax Rate auto-fills, totals recalc, status line shows rate/name/basis/source.
- Missing basis address: explicit warning, manual entry stays.
- Not connected / any failure: "Tax unavailable — authoritative tax source not connected.
  Tax rate stays manual." Manual Tax Rate input remains editable (usability); manual edits
  are labeled as manual entry. Whether manual override remains allowed once Books is live is
  an open business decision.
