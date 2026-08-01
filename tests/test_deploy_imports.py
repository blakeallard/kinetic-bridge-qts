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


def test_fx_rates_seed_has_usd_base():
    rows = _rows("fx_rates_cache_import.csv")
    by_currency = {r["Currency"]: r["Rate"] for r in rows}
    assert by_currency.get("USD") == "1.00"
    assert "EUR" in by_currency
