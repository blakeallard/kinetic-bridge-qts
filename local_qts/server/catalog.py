from __future__ import annotations

from typing import Any

from . import db
from .criteria import parse_criteria


def _price(v: Any) -> str:
    if v is None:
        return ""
    try:
        return f"{float(v):.2f}"
    except (TypeError, ValueError):
        return str(v)


def list_item_master() -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT zoho_record_id, part_number, description, category, discountable,
               price_t1, price_t2, price_t3, price_t4, price_t5,
               price_t6, price_t7, price_t8, price_t9
        FROM item_master
        WHERE retired_at IS NULL
        ORDER BY part_number
        """
    )
    out = []
    for r in rows:
        out.append(
            {
                "ID": r["zoho_record_id"] or str(r.get("part_number")),
                "Part_Number": r["part_number"] or "",
                "Description": r["description"] or "",
                "Category": r["category"] or "",
                "Discountable": "Y" if r["discountable"] else "N",
                "Price_T1": _price(r["price_t1"]),
                "Price_T2": _price(r["price_t2"]),
                "Price_T3": _price(r["price_t3"]),
                "Price_T4": _price(r["price_t4"]),
                "Price_T5": _price(r["price_t5"]),
                "Price_T6": _price(r["price_t6"]),
                "Price_T7": _price(r["price_t7"]),
                "Price_T8": _price(r["price_t8"]),
                "Price_T9": _price(r["price_t9"]),
            }
        )
    return out


def list_kit_components() -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT zoho_record_id, kit_key, kit_main_sku, component_sku, description,
               requirement, qty_rule, qty_value
        FROM kit_components
        ORDER BY kit_key, id
        """
    )
    return [
        {
            "ID": r["zoho_record_id"],
            "Kit_Key": r["kit_key"] or "",
            "Kit_Main_SKU": r["kit_main_sku"] or "",
            "Component_SKU": r["component_sku"] or "",
            "Description": r["description"] or "",
            "Requirement": r["requirement"] or "",
            "Qty_Rule": r["qty_rule"] or "",
            "Qty_Value": r["qty_value"] or "",
        }
        for r in rows
    ]


def list_fx_rates() -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT zoho_record_id, currency, rate, cached_at
        FROM fx_rates_cache
        ORDER BY currency
        """
    )
    return [
        {
            "ID": r["zoho_record_id"],
            "Currency": r["currency"] or "",
            "Rate": str(r["rate"]) if r["rate"] is not None else "",
            "Cached_At": r["cached_at"].isoformat() if r["cached_at"] else "",
        }
        for r in rows
    ]


def get_all_records(report_name: str, criteria: str | None = None, page: int = 1, page_size: int = 200) -> dict[str, Any]:
    name = (report_name or "").strip()
    filters = parse_criteria(criteria)

    if name in ("Item_Master_Report", "Item_Master"):
        data = list_item_master()
    elif name in ("Kit_Components_Report", "Kit_Components"):
        data = list_kit_components()
    elif name in ("FX_Rates_Cache_Report", "FX_Rates_Cache"):
        data = list_fx_rates()
    elif name in ("Quote_Request_Report", "Quote_Request"):
        from . import quotes

        data = quotes.list_quotes(filters)
    elif name in ("CRM_Bridge_Report", "CRM_Bridge"):
        from . import bridge_store

        data = bridge_store.list_bridges(filters)
    else:
        return {"code": 3000, "data": []}

    # Apply simple equality filters for non-quote reports too
    if filters and name not in ("Quote_Request_Report", "Quote_Request"):
        filtered = []
        for row in data:
            ok = True
            for k, v in filters.items():
                if str(row.get(k, "")) != str(v):
                    ok = False
                    break
            if ok:
                filtered.append(row)
        data = filtered

    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 200), 200))
    start = (page - 1) * page_size
    chunk = data[start : start + page_size]
    return {"code": 3000, "data": chunk}
