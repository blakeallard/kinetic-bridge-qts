from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from .config import DATABASE_URL


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_all(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> list[dict]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return list(cur.fetchall())


def fetch_one(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> dict | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchone()


def execute(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
