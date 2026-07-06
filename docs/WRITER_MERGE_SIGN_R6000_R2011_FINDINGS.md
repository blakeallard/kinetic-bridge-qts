# Writer merge/sign R6000 → R2011 → fixed — fn_generate_pdf findings

Zoho Task ID: `2543412000001469015`
Date: 2026-07-06
Verified working: Writer merge/sign returned `sign_request_id 504457000000209234`
for test quote QUOTE0005 (30 lines), `Sign_Request_ID` writeback confirmed live.

## Symptom

`fn_generate_pdf` executed without Deluge errors, but the Writer API
(`POST .../documents/<doc_id>/merge/sign`) returned:

1. First: `R6000` — "An error occurred while processing your merge request"
2. After the first fix round: `R2011` — "An error occurred while processing
   JSON parameter or values"

## Root causes (two distinct bugs)

### 1. R6000 — hand-concatenated `merge_data` JSON

The original function built `merge_data` by string concatenation with zero
escaping. Any quote character, backslash, or the literal-`\n` line-stacking
scheme could corrupt the payload. Fix: build the payload as Deluge
`Map`/`List` and serialize once — Deluge escapes quotes/newlines/backslashes
in values correctly. The line-stacking joiner switched from a literal
backslash+n (`"\\n"`) to a real newline (`"\n"`), which the serializer
escapes properly.

### 2. R2011 — Deluge `List.toString()` drops the enclosing `[ ]`

`signer_data` built as `List` of `Map`s and serialized with `.toString()`
produced `{...},{...}` — **no array brackets** (confirmed in the execution
log). Writer rejected it as invalid JSON. Fix: wrap explicitly:

```deluge
signerJSON = "[" + signer1.toString() + "," + signer2.toString() + "]";
```

Note: this bracket-drop only affects a **top-level** `List.toString()`. A
list nested inside a Map (like `merge_data`'s `{"data":[...]}`) serializes
with brackets intact.

### Non-cause, documented to prevent regression

The `signer_data` **shape** was correct all along, per
<https://www.zoho.com/writer/help/api/v1/merge-and-sign.html>: a JSON array
of objects with the recipient email stored under the slot key
(`recipient_1`, `recipient_2`, ...):

```json
[{"recipient_1": "a@x.com", "recipient_name": "A", "action_type": "sign"},
 {"recipient_2": "b@y.com", "recipient_name": "B", "action_type": "sign"}]
```

An intermediate debug attempt restructured it to an object keyed by slot
with a `recipient_email` field — that is **wrong** for this endpoint and was
what triggered the first R2011. Do not "fix" the shape back to that.

## Hardening added alongside

- Both signer emails are validated before the API call; the function aborts
  with an `info` log instead of sending a doomed request.

## Files

- `functions/fn_generate_pdf.deluge` — canonical, synced from the verified
  working deploy (payload-dump debug logs removed; abort + response logs kept).
- `deploy_ready/fn_generate_pdf.debug.deluge` — the exact version pasted into
  Creator during debugging, with three extra `info` payload-dump lines. The
  copy currently saved in Creator is this debug version; on the next Creator
  touch, paste the canonical version to drop the noisy logs.

## Open follow-up (pre-existing, unrelated to Writer)

Test-quote lines for LEM sensors 000833/000876/000637 price at $0.00 at
qty > 19 despite `Price_T1 = 89.65`: their `Price_T2` is stored as `0.00`
rather than blank, so the tier walk-down returns 0 instead of falling back
to T1. Stored-zero vs blank tier cells needs a data/design decision before
those SKUs are quoted for real.
