# Location-independent scripts & CI (Kinetic Bridge QTS)

Rule: **no script may require a fixed machine path** (`/Users/…`, `~/bevco/…`, sibling-repo absolutes). CI must pass on a clean checkout.

## Scripts

| Script | How it finds inputs |
| ------ | ------------------- |
| `import_preview/generate_preview.py` | CLI arg → `AcmeBMS_RSP_XLSX` → optional in-repo `fixtures/` or `data/references/…` |
| `audit/load_workbook.py` | Same resolution |
| Other `scripts/*.py` | `Path(__file__).resolve().parent(s)` only (repo-relative) |

Workbook outside the repo:

```bash
export AcmeBMS_RSP_XLSX="/path/to/Acme BMS BMS_July 01_RSP_Distributor.xlsx"
python3 import_preview/generate_preview.py
# or
python3 import_preview/generate_preview.py "/path/to/workbook.xlsx"
```

## CI (this repo)

| Workflow | Must remain valid |
| -------- | ----------------- |
| `python-quality.yml` | Compile + ruff exclude `*/.venv/*`, `*/node_modules/*` |
| `ruff.toml` | `exclude` nested `.venv` (incl. `local_qts/.venv`) |
| `repository-validation.yml` | Lifecycle markers |
| `security.yml` | No tracked secrets; optional `pip-audit` if `requirements.txt` |
| `pr-validation.yml` | PR body + STATUS/docs contract |

When merging widget into this product repo, keep paths relative (`widget/`) — never hardcode a second checkout path.

**Status (2026-07-30):** Widget lives at `widget/` in this repo. Legacy `qts-quote-builder` outside the repo is not canonical.

Action pins: `actions/checkout@v6` / `setup-python@v6` are valid (v7 exists; bump later via Dependabot if desired).

## Docs

Operator docs may mention *example* local layouts, but prefer repo-relative or env vars. Product name in public/docs: **Kinetic Bridge** (not Bevco branding for the product).
