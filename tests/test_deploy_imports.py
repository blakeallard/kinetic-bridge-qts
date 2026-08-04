import csv
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
IMPORTS = REPO / "deploy_ready" / "creator" / "imports"


def _rows(name):
    with open(IMPORTS / name, newline="") as f:
        return list(csv.DictReader(f))


def test_item_master_full_tier_scheme_values():
    rows = _rows("item_master_import_FULL.csv")
    assert rows, "item_master_import_FULL.csv is empty"
    for row in rows:
        assert row["Tier_Scheme"] in ("Hardware", "License"), (
            f"{row['Part_Number']}: Tier_Scheme {row['Tier_Scheme']!r} would be "
            "rejected by the Creator dropdown (case-sensitive Hardware/License)"
        )


def test_item_master_full_part_numbers_unique():
    rows = _rows("item_master_import_FULL.csv")
    parts = [r["Part_Number"] for r in rows]
    assert len(parts) == len(set(parts))


def test_item_master_corrected_has_no_unmapped_columns():
    with open(IMPORTS / "item_master_import_CORRECTED.csv", newline="") as f:
        header = next(csv.reader(f))
    for col in ("Active", "Item_Status", "Quote_Warning"):
        assert col not in header


def _by_part(name):
    return {r["Part_Number"]: r for r in _rows(name)}


def test_pricelist_v1_0_july_2026_changes_are_applied():
    """Lock in the 2026-07-01 v1.0 vendor changes so a stale re-import can't undo them."""
    items = _by_part("item_master_import_FULL.csv")

    # New bundle SKU replacing the bare CMU18 harness.
    assert "100985.2" in items, "100985.2 (CMU18 harness bundle) missing from the import"
    assert items["100985.2"]["Price_T1"] == "108.40"
    assert items["100985.2"]["Price_T2"] == "88.68"

    # 103006 keeps its row but loses standalone pricing.
    bare = items["103006"]
    assert bare["Item_Status"] == "Bundled"
    assert "100985.2" in bare["Quote_Warning"]
    assert all(bare[f"Price_T{i}"] == "" for i in range(1, 10)), (
        "103006 must carry no price — the vendor folded it into 100985.2"
    )

    # Shunt reprice.
    assert items["100684"]["Price_T1"] == "136.00"
    assert items["100684"]["Price_T2"] == "99.86"

    # The unpriced 300A shunt never became quotable.
    assert "100683" not in items


def test_pricelist_meta_seed_matches_workbook_banner():
    rows = _rows("pricelist_meta_import.csv")
    assert len(rows) == 1, "Pricelist_Meta is a single-record form"
    meta = rows[0]
    assert meta["Pricelist_Version"] == "1.0"
    assert meta["Valid_From"] == "July 2026"
    assert len(meta["Source_SHA256"]) == 64


def test_fx_rates_seed_has_usd_base():
    rows = _rows("fx_rates_cache_import.csv")
    by_currency = {r["Currency"]: r["Rate"] for r in rows}
    assert by_currency.get("USD") == "1.00"
    assert "EUR" in by_currency
