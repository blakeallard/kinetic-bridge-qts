# Automating the pricelist → Item_Master update

Question asked 2026-08-03: *can Bevco get an app/applet where someone uploads the vendor
`.xlsx` and Item_Master updates itself — and is Zia useful here?*

**Short answer: yes, and it is worth building — but not as "upload → auto-apply".** Build it
as **upload → parse → staged diff → one-click approve → apply**. The parsing must stay
deterministic; Zia belongs on the explain-and-triage layer, not on price extraction. The
honest blocker is that **Deluge cannot parse `.xlsx`** — that shapes the whole design.

This doc is written to outlive whoever is at the company. It states what the current
pipeline actually depends on, because most of those dependencies are invisible until they
break.

---

## 1. What the manual process actually does today

`import_preview/generate_preview.py` is not a spreadsheet reader. It encodes about a dozen
business rules that were each learned the hard way:

| Rule | Where the signal comes from |
| --- | --- |
| Which rows are items | column B matches one of 5 section headers; column A matches a SKU regex |
| Which price band a number is | column position **relative to the section**, not absolute |
| `Tier_Scheme` (hardware 9 bands / license 6) | which section the row is in |
| `Discountable` | a bare `X` in the tail column past the bands |
| `Discontinued` | red cell fill (captured once into a hardcoded SKU set) |
| `Not_Released` | description matches `DRAFT` or `(RELEASE Qn/yyyy)` |
| `Obsolescent` | the "Software for obsolesenced BMS" section |
| `Bundled` | a price band containing literal `Included in <SKU>` (new 2026-07-01) |
| Which of two duplicate `300300` rows is real | **row hidden state** in the sheet XML |
| Part numbers keep leading zeros / decimals | read as raw strings, never floats (`000637`, `100985.1`) |

Two of those — **cell fill colour** and **hidden-row state** — are formatting, not data.
That matters enormously for what follows.

## 2. The hard constraint: Deluge cannot read `.xlsx`

An `.xlsx` is a ZIP of XML. Deluge has no unzip and no XML-to-sheet reader. A Creator
workflow can receive the file into a File Upload field, but it cannot open it. Three ways
out:

| Route | Gets values | Gets fill colour / hidden rows | New moving parts |
| --- | --- | --- | --- |
| **Zoho Sheet API** — push the upload into Zoho Sheet, read rows back as JSON | yes | **no** | Sheet API auth, one conversion step |
| **Ask the vendor/user for CSV instead** | yes | **no** | none — but a manual save-as every time, and CSV drops the second sheet set entirely |
| **Keep the existing Python parser, run it outside Zoho** | yes | **yes** | somewhere to run it |

Losing fill colour and hidden-row state is not cosmetic. It means an automated Zoho-native
reader **cannot tell which duplicate `300300` row is the real one**, and **cannot see that
the vendor marked something Discontinued**. Both are live behaviours in QTS today.

Content-based substitutes exist and should be adopted regardless, because they are more
robust than formatting anyway:

- **Duplicate SKU** → prefer the row with a `T1` price. The legacy bundle rows are blank in
  T1–T3 and only priced in bands 4–6. This is a stronger rule than "is it hidden".
- **Discontinued** → cannot be recovered from values. Either the vendor states it in text,
  or a human keeps flagging it. Treat this as a permanent manual field.

## 3. Recommended architecture

**Reuse the parser you already have; make Zoho the approval surface, not the parser.**

The vendor workbook *already* lands on disk automatically — it syncs into
`~/Library/CloudStorage/ZohoWorkDriveTrueSync-KineticBridge/Shared with Me/Lithium Balance/BMS Pricelist/`.
That removes the upload step for the common case and is the single biggest simplification
available.

```
 Vendor drops file in the shared WorkDrive folder
                 │
                 ▼
 [1] Watcher (scheduled, ~daily)  ── new sha256? ──▶ no change, stop
                 │ yes
                 ▼
 [2] generate_preview.py          full-fidelity parse (fills, hidden rows, bundles)
                 │
                 ▼
 [3] Diff vs live Item_Master     ADD / PRICE_CHANGE / DESC_CHANGE / BUNDLED / RETIRED
                 │
                 ▼
 [4] Write Pricelist_Change_Log rows into Creator  (staged, nothing live yet)
                 │
                 ▼
 [5] Human opens the Change Review page, reads the plain-English summary, clicks Approve
                 │
                 ▼
 [6] Deluge applies approved rows to Item_Master + stamps Pricelist_Meta
```

Steps 1–4 are ~a day of work: the parser exists, the diff engine exists
(`kinetic-quote/tools/item_master_ingest/` already does add/update/soft-retire with a
`item_master_ingest_runs` audit log), and Creator record writes are a solved problem in
this repo. Steps 5–6 are the new build: two Creator forms and one Deluge apply function.

### New Creator objects

| Form | Purpose |
| --- | --- |
| `Pricelist_Upload` | File Upload + uploaded_by + status. Manual path when the file is emailed rather than dropped in WorkDrive. |
| `Pricelist_Change_Log` | One row per proposed change: part_number, change_type, field, old_value, new_value, confidence, approved (checkbox), applied_at. |
| `Pricelist_Meta` | Already specified in this update — version, valid_from, source_file, source_sha256. |

### If it must be 100% inside Zoho

Replace step 2 with **Zoho Sheet**: `POST` the uploaded file to the Sheet API to create a
workbook, then read `RSP_EUR` back with the worksheet records API, and reimplement the
section/band rules in Deluge. Everything downstream is unchanged. Accept the two losses in
§2 and adopt the content-based duplicate rule. Budget ~2–3 days, most of it re-deriving
parsing rules that already work in Python, and expect the Sheet conversion to need testing
against this specific workbook (it carries `LAMBDA` defined names and merged cells).

**Recommendation: don't.** Rewriting a tested parser into a language with no test harness,
to lose two signals you currently use, is a downgrade. Keep the Python parser.

## 3b. Does it have to live inside Zoho? No.

Asked 2026-08-03. Nothing about this requires Creator. The Zoho **Creator Data API** does
record CRUD from outside over OAuth, and this codebase already proves both directions work:
`scripts/creator_deploy.py` posts into Creator, and `kinetic-quote/tools/zoho_crm_sync/`
pulls CRM into Postgres on a schedule. A standalone app can read Item_Master, compute the
diff, and write approved changes back.

**`local_qts/` is already most of this app** — a FastAPI server with a frontend that speaks
a Creator-shaped API and talks to Postgres. Pointing it at real Creator instead of the local
mirror, and adding an upload + diff screen, is a much shorter path than it sounds.

| | All-in-Zoho (Creator + Sheet API) | Standalone remote app | Local scheduled job |
| --- | --- | --- | --- |
| xlsx parse fidelity | **reduced** — no fill colour, no hidden rows | **full** | **full** |
| Reuses the tested Python parser | no — rewrite in Deluge | **yes** | **yes** |
| Real tests / CI / version control | no | **yes** | yes |
| Where reviewers approve | in Creator, where they already work | a second app + another login | nowhere — no UI |
| Runs when Blake's laptop is off | yes | yes | **no** |
| Extra cost | none (in Zoho One) | small hosting bill | none |
| Survives handover | **best** — one system, IT already owns it | needs an owner for hosting + OAuth refresh | **worst** — dies with the machine |
| Build effort | 2–3 days | ~2 days | ~half a day |

Read that table with the handover in mind. The strongest argument for Zoho is not technical
— it is that Bevco already pays for it, already administers it, and Bill and Bryan already
log into it. A remote app is better engineering and a worse bequest **unless someone is
named as its owner**. A local scheduled job is the cheapest to build and the fastest to rot;
don't choose it for something the business will depend on.

**Recommended split, and it is the same as §3:** run the parse + diff outside Zoho (full
fidelity, tested code, no Creator quota burned), and keep the approval step and the system
of record inside Creator (no new login, no new UI to maintain, and if the remote piece ever
dies the catalog is still intact and editable by hand). The remote piece is then small and
stateless enough that replacing it is a contained job for whoever comes next.

If you would rather have exactly one system to hand over, all-in-Zoho is a legitimate
choice — accept the two losses in §2 and adopt the content-based duplicate rule.

## 4. Where Zia (or any LLM) actually earns its place

Not on the numbers. A price is a fact with one correct value that flows straight onto a
customer quote; a nondeterministic extractor that is right 99% of the time produces a
wrong quote roughly every other revision, silently. Use exact parsing for anything that
becomes a price, a SKU, or a quantity.

Genuinely good LLM jobs here, all on top of an already-computed diff:

1. **Plain-English change summary** for the approval screen — "3 changes: one new harness
   bundle, one part had its price removed because it's now included in that bundle, and the
   500A shunt went up 66%." Reviewers approve faster when they don't have to read a table.
2. **Reconcile the vendor's `Changes_Log` prose against the computed diff.** This session is
   the case study: the changelog said `103600`, the data said `103006`. An LLM comparing the
   two lists is well suited to saying "the changelog mentions a part number that does not
   exist in the price table — did they mean `103006`?"
3. **New-SKU sanity check** — flag a new part number within edit-distance 1–2 of an existing
   one, or a price that moved more than X%, for extra scrutiny.
4. **Draft the internal notification** to Bill/Bryan summarising what changed and what needs
   a decision.

All four are advisory text next to a deterministic diff. None of them can change a number.

## 5. Guardrails the automation must have

Learned from this revision specifically:

- **Never auto-create a SKU that appears only in prose.** `103600` would have become a
  phantom part.
- **Never auto-apply.** Prices feed customer quotes; a bad parse is a mispriced quote sent
  to a customer. The approval click is the whole safety model, and it matches the existing
  Tier 2 convention (Books/bulk writes need Bill).
- **Nothing row-pinned.** Row numbers moved by 4 in this revision. Anchor on section headers
  and part numbers, never absolute rows.
- **Fail loud, never partially.** The current parser aborts if duplicate-SKU classification
  drifts. Keep that: a refusal to import is recoverable, a half-import is not.
- **Hash every source file** and refuse to re-apply an already-applied sha256.
- **Soft-retire, never delete.** A part on an old quote must still resolve.
- **Log the version.** `Pricelist_Meta` + the sha means any quote can be traced to the exact
  workbook it was priced from — the thing that was missing before this update.

## 6. Realistic assessment

| | |
| --- | --- |
| Feasible with Bevco's current tooling? | Yes. Nothing here needs a product they don't own. |
| Effort, recommended architecture | ~1 day for the pipeline, ~1 day for the Creator approval UI, ~half a day for the Zia summary layer. |
| Effort, all-in-Zoho variant | 2–3 days, and permanently weaker (§2). |
| Biggest ongoing risk | The vendor changes the sheet layout. Section-anchored parsing absorbs most of it; a layout rewrite still needs a human. |
| Second risk | Creator integration-task / External Call quotas — already a recurring problem for QTS. Run the parse and diff outside Creator to keep the Zoho-side cost to a handful of record writes. |
| What it does **not** solve | Fill-colour semantics (Discontinued), and any change the vendor makes without documenting it — this revision had two (the `100683`→`100684` shunt swap and a new distributor row). A human still reads the `Changes_Log`. |

The honest framing for a handover: this removes the tedious, error-prone transcription and
gives a reviewable audit trail. It does not remove the need for someone to look at what the
vendor changed and decide whether it makes sense.
