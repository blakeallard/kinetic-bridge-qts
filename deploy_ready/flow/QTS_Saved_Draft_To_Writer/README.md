# Flow: **QTS Saved Draft To Writer**

## File / PDF datatype (important)

Zoho Flow custom functions **do not have a File parameter type**. You cannot pick File, and you cannot leave the type blank.

So PDF/`merged_file` must stay a **local variable inside one function**. It cannot be passed between separate Flow custom functions.

That is why merge, WorkDrive upload, Deal attach, Quotes attach, and sendmail are **inlined into** [`publish_quote_package.deluge`](./publish_quote_package.deluge).  
Reference copies of those former helpers live under [`_inline_only_not_separate_flow_cfs/`](./_inline_only_not_separate_flow_cfs/) — **do not paste those as separate Flow CFs**.

## Canvas (unchanged shape)

| Branch | Block 1 (keep) | Block 2 (change to) |
| ------ | -------------- | ------------------- |
| `send_email = true` | `build_quote_merge_payload` | **`publish_quote_package`** |
| `send_email = false` | `build_quote_merge_payload` | **`publish_quote_package`** |

## Paste as separate Flow custom functions (only these)

| # | File | Function name | Param types in Flow UI |
| - | ---- | ------------- | ---------------------- |
| 1 | [`assert_deal_has_products.deluge`](./assert_deal_has_products.deluge) | `assert_deal_has_products` | string, map |
| 2 | [`ensure_deal_contact_link.deluge`](./ensure_deal_contact_link.deluge) | `ensure_deal_contact_link` | string, string, map |
| 3 | [`workdrive_ensure_quote_folders.deluge`](./workdrive_ensure_quote_folders.deluge) | `workdrive_ensure_quote_folders` | string, string |
| 4 | [`workdrive_archive_to_drafts.deluge`](./workdrive_archive_to_drafts.deluge) | `workdrive_archive_to_drafts` | string, string, string, int/long, string, bool |
| 5 | [`snapshot_creator_revision.deluge`](./snapshot_creator_revision.deluge) | `snapshot_creator_revision` | string, string, map, map |
| 6 | [`advance_deal_stage.deluge`](./advance_deal_stage.deluge) | `advance_deal_stage` | string, map |
| 7 | [`publish_quote_package.deluge`](./publish_quote_package.deluge) | **`publish_quote_package` (last)** | string, string, string, map, bool, string, string, string |

## Do not paste as separate Flow CFs

- [`_inline_only_not_separate_flow_cfs/`](./_inline_only_not_separate_flow_cfs/) — merge / store / attach / email (no File type in Flow)
- [`_do_not_paste_for_live_workdrive/`](./_do_not_paste_for_live_workdrive/) — old monolith / COMPAT

## Connections

| Use | Connection link name |
| --- | -------------------- |
| WorkDrive | `flow_to_workdrive_full_access` |
| CRM attach / associate email | `zoho_crm_to_zoho_flow` |
| Writer merge | `writer_to_flow` |

## Keep

- `build_quote_merge_payload` (already on the live Flow; not in this folder)

## Multi-run / double-email

Two different problems:

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Several `<1s` History rows | Creator writes during prep (draft/lines/bridge) still **start** the Flow; Decision stops them | Put **Status filter on the trigger itself** (below), not only a Decision |
| Two `~8s` rows + two emails, identical payload | Creator/Flow **double-delivers** one Status update | `publish_quote_package` Deal-note dedupe (`QTS_DEDUP\|…`) — re-paste orchestrator |

### Trigger criteria (kills the short runs)

1. Open the **Record created or updated** trigger (not the Decision).
2. Look for **Criteria** / **Filter** / **Condition**.
3. Set: `Status` equals `PDF Filed` **OR** `Status` equals `Package Requested`.
4. Save → Live.

If the trigger UI has no criteria, keep the Decision (History noise remains) + dedupe (stops double email).

### Re-email after edits

Dedupe key includes `grand_total`, so a real line change can email again. Same totals + same branch within the lock note lifetime → skipped (`duplicate_publish_skipped`).

## Writer template (LINE ITEMS)

| Role | Document | Open URL / ID |
| ---- | -------- | ------------- |
| **Live (Flow)** | `qts_quote_template_v4` | https://writer.zoho.com/writer/open/h5zhu2051759ecefd4148816cf61ad65a9cbc (`h5zhu2051759ecefd4148816cf61ad65a9cbc`) |
| Ignore | `qts_quote_template_v4_ONE_BOX` / `_lineitems_fixed` | experiments — do not point Flow at these |

`publish_quote_package.deluge` → `template_document_id = "h5zhu2051759ecefd4148816cf61ad65a9cbc"`.

### Known layout bug (fix in Writer UI)

Black **LINE ITEMS** bar (and column headers) sit **inside** the `line_items` subform → header reprints per row. Corrupted label `LINE IT«»EMS` is an empty merge chip inside the word ITEMS.

**Fix (same document only):**
1. Open the URL above.
2. Make black bar plain text **`LINE ITEMS`** (delete the `«»` chip — do not Cmd/Ctrl+A the whole doc).
3. Shrink / re-place the subform so **only** the data row (`«line_items.name»` / `qty` / `unit_price` / `total`) is inside the purple/grey repeat border.
4. Keep black bar + DESCRIPTION/QTY/UNIT PRICE/TOTAL **outside** the repeat.
5. Preview merge with 2+ rows → one black bar, all rows underneath.

### Layout rule

1. **Outside** repeat: plain `LINE ITEMS` + column headers.
2. **Inside** repeat only: one data row.
3. Never put section/column headers inside the `line_items` subform.

### Writer JSON sample (import / reimport)

**Use this one** (copied from qts-quote-builder + `payment_terms`):

`/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/artifacts/qts_writer_fields_sample_v2.json`

- Table columns → `line_items` subform  
- **Do not** place `line_items_block` in the table (that text dump is why live PDFs looked awful)  
- Notes: `artifacts/qts_writer_fields_sample_v2.README.md`
