import csv
import importlib.util
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BOM = REPO / "kit_bom" / "kit_components.csv"

_spec = importlib.util.spec_from_file_location(
    "kit_components_reconcile", REPO / "scripts" / "kit_components_reconcile.py"
)
recon = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(recon)


def _write(rows, path):
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(rows)


def _bom_rows():
    with open(BOM, newline="") as f:
        return [list(r) for r in csv.reader(f)]


def test_header_normalisation_accepts_creator_display_names():
    """Creator exports 'Channels Per CMU'; the repo CSV says 'Channels_Per_CMU'."""
    assert recon.norm_header("Channels Per CMU") == "channels_per_cmu"
    assert recon.norm_header("Channels_Per_CMU") == "channels_per_cmu"
    assert recon.norm_header("Kit Key") == recon.norm_header("Kit_Key") == "kit_key"


def test_identical_export_reports_no_drift():
    loaded = recon.load(str(BOM))
    assert len(loaded) == 42, f"expected 42 BOM rows, got {len(loaded)}"
    assert ("n3bms_cmu18", "100985.2") in loaded
    assert ("n3bms_cmu12", "100683") not in loaded


def test_detects_the_production_channels_per_cmu_gap():
    """The real 2026-08-03 Production failure: blank Channels_Per_CMU on all 3 CMU kits.

    All three kits errored with "Kit data error: Channels Per CMU missing" and had
    been broken in Production unnoticed. This is the check that would have caught it.
    """
    rows = _bom_rows()
    header = rows[0]
    idx = header.index("Channels_Per_CMU")
    for r in rows[1:]:
        r[idx] = ""
    rows[0] = [c.replace("_", " ") for c in header]  # Creator-style headers

    with tempfile.TemporaryDirectory() as d:
        export = Path(d) / "export.csv"
        _write(rows, export)
        bom = recon.load(str(BOM))
        live = recon.load(str(export))

        gaps = []
        for key in set(bom) & set(live):
            if bom[key].get("channels_per_cmu", "") != live[key].get("channels_per_cmu", ""):
                gaps.append(key)

    assert len(gaps) == 3, f"expected 3 CMU rows to drift, got {len(gaps)}: {sorted(gaps)}"
    assert ("n3bms_cmu18", "101814") in gaps
    assert ("n3bms_cmu12", "100809") in gaps
    assert ("nbms_cmu12", "100809") in gaps


def test_every_cmu_from_series_cells_row_has_channels_per_cmu():
    """A cmu_from_series_cells row without a divisor is unresolvable by design."""
    bom = recon.load(str(BOM))
    for key, rec in bom.items():
        if rec.get("qty_rule") == "cmu_from_series_cells":
            assert rec.get("channels_per_cmu"), f"{key} lacks Channels_Per_CMU"


def test_narrow_export_does_not_report_absent_columns_as_drift():
    """A Creator report exports only its displayed columns.

    First run against the real Production export reported 51 mismatches; every one
    was an absent column being read as a blank value. Noise on that scale buries
    the single real finding, which is worse than not running the check at all.
    """
    rows = _bom_rows()
    header = rows[0]
    keep = ["Kit_Key", "Kit_Main_SKU", "Component_SKU", "Description",
            "Requirement", "Qty_Rule", "Qty_Value"]
    idx = [header.index(c) for c in keep]
    narrow = [[c.replace("_", " ") for c in keep]]
    narrow += [[r[i] for i in idx] for r in rows[1:]]

    with tempfile.TemporaryDirectory() as d:
        export = Path(d) / "narrow.csv"
        _write(narrow, export)
        _, live_cols = recon.load_with_columns(str(export))
        _, bom_cols = recon.load_with_columns(str(BOM))

    comparable = [c for c in recon.COMPARED
                  if recon.norm_header(c) in live_cols and recon.norm_header(c) in bom_cols]
    skipped = [c for c in recon.COMPARED if c not in comparable]

    assert "Channels_Per_CMU" in skipped, "absent column must be reported unchecked, not drifted"
    assert "Confidence" in skipped
    assert "Description" in comparable
    assert "Qty_Rule" in comparable
