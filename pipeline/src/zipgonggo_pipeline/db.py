"""Neon Postgres 연결. pipeline은 direct(unpooled) 문자열을 쓴다."""

from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from .config import settings


def connect() -> psycopg.Connection:
    return psycopg.connect(settings().database_url, row_factory=dict_row)
