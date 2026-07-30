# Creator revision snapshot (Stage 4)

Lightweight history for republish — mirrors WorkDrive **DRAFTS** inside Creator without blocking the PDF path.

## Behavior

| Condition | Action |
| --------- | ------ |
| `revision <= 1` | No prior snapshot; optionally write current WorkDrive file IDs |
| `revision > 1` | Write `Prior_Revision_Snapshot` JSON (lines/totals + prior WD IDs) before overwrite |
| Field missing / update fails | Log `fields_missing=yes`; **do not** fail merge / WorkDrive / Deal attach |

Implementation: `scripts/qts_publish/snapshot_creator_revision.deluge`

## Fields

### Existing (use when present)

| Field | Form | Notes |
| ----- | ---- | ----- |
| `Quote_Revision` | `Quote_Request` | Number. Widget gated on `REVISION_FIELD_READY` (still false until Tier 3 deploy). Deal also has `Current_Quote_Revision` used by `fn_sync_to_crm`. |

### New fields needed (Creator Tier 3 — ask Bill / Blake)

| Field link name | Type | Purpose |
| --------------- | ---- | ------- |
| `Prior_Revision_Snapshot` | Multi Line | JSON blob of prior lines/totals + prior WorkDrive IDs |
| `WorkDrive_Current_File_ID` | Single Line | Latest CURRENT PDF resource id |
| `WorkDrive_Confirmed_File_ID` | Single Line | Latest CONFIRMED PDF resource id (email path) |
| `WorkDrive_Folder_URL` | URL / Single Line (optional) | Deep link to `QTS Quotes/{quote_number}/` |

Until these exist, `snapshot_creator_revision` returns `fields_missing=yes` and publish continues.

## Snapshot JSON shape (example)

```json
{
  "revision": 2,
  "snapshotted_at": "2026-07-29T17:30:00-07:00",
  "prior_workdrive_current_id": "abc123",
  "prior_workdrive_confirmed_id": "",
  "lines_totals": { "quote_number": "QUOTE0001", "branch": "save" }
}
```

## Out of scope

- Full Creator history module / subform of every revision (phase 2)
- Blocking PDF when snapshot write fails
