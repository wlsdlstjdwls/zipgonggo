"""notice 계열 DB 쓰기. 소스 공통 (마이홈 API · SH 스크래퍼).

컬럼명은 db/schema.sql 그대로. 스키마가 바뀌면 여기와 마이그레이션을 같이 고친다.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

NOTICE_COLS = [
    "slug", "fingerprint", "source", "source_key", "amends_source_key", "agency", "title",
    "housing_type", "sector", "house_type", "sido", "sigungu", "complex_name", "address", "pnu", "heating",
    "total_household", "supply_count", "min_deposit", "min_rent", "min_down_payment", "min_interim",
    "min_balance", "posted_at", "apply_start_at", "apply_end_at", "announce_at", "status",
    "source_status", "source_url", "portal_url", "contact", "source_rank", "raw",
]
# 재수집 시 갱신하지 않는 것: slug(URL 불변), source, source_key, publish, created_at
_UPDATE_COLS = [c for c in NOTICE_COLS if c not in ("slug", "source", "source_key")]

UPSERT_SQL = (
    f"INSERT INTO notice ({', '.join(NOTICE_COLS)}) VALUES ({', '.join('%(' + c + ')s' for c in NOTICE_COLS)}) "
    "ON CONFLICT (source_key) DO UPDATE SET "
    + ", ".join(f"{c} = EXCLUDED.{c}" for c in _UPDATE_COLS)
    + ", updated_at = now() RETURNING id, (xmax = 0) AS inserted"
)


def upsert_notice(cur, notice: dict[str, Any], areas: list[dict[str, Any]]) -> bool:
    """notice 1행 upsert + notice_area 교체. True면 신규."""
    row = dict(notice)
    row["raw"] = json.dumps(row["raw"], ensure_ascii=False)
    cur.execute(UPSERT_SQL, row)
    result = cur.fetchone()
    notice_id = result["id"]
    cur.execute("DELETE FROM notice_area WHERE notice_id = %s", (notice_id,))
    for a in areas:
        cur.execute(
            "INSERT INTO notice_area (notice_id, sido, sigungu, supply_count) VALUES (%s, %s, %s, %s)",
            (notice_id, a["sido"], a["sigungu"], a["supply_count"]),
        )
    return bool(result["inserted"])


def replace_notice_complexes(cur, notice_id: int, rows: list[dict[str, Any]]) -> int:
    """공고의 공급 단지 목록을 통째로 교체한다(notice_area와 같은 방식). 돌려주는 값은 넣은 행 수."""
    cur.execute("DELETE FROM notice_complex WHERE notice_id = %s", (notice_id,))
    for r in rows:
        cur.execute(
            """
            INSERT INTO notice_complex
              (notice_id, name, sido, sigungu, road_address, zone, is_new, source_page,
               complex_code, unit_count, min_deposit, min_rent, area_min, area_max)
            VALUES (%(notice_id)s, %(name)s, %(sido)s, %(sigungu)s, %(road_address)s, %(zone)s, %(is_new)s, %(source_page)s,
                    %(complex_code)s, %(unit_count)s, %(min_deposit)s, %(min_rent)s, %(area_min)s, %(area_max)s)
            ON CONFLICT (notice_id, name, road_address) DO UPDATE SET
              unit_count = COALESCE(notice_complex.unit_count, 0) + COALESCE(EXCLUDED.unit_count, 0),
              min_deposit = LEAST(notice_complex.min_deposit, EXCLUDED.min_deposit),
              min_rent = LEAST(notice_complex.min_rent, EXCLUDED.min_rent),
              area_min = LEAST(notice_complex.area_min, EXCLUDED.area_min),
              area_max = GREATEST(notice_complex.area_max, EXCLUDED.area_max)
            """,
            {"notice_id": notice_id, "zone": None, "complex_code": None, "unit_count": None,
             "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None, **r},
        )
    return len(rows)


def queue_unmapped(cur, key: str, housing_type: str, title: str) -> None:
    """유형 미매핑 공고를 review_queue에 1회만 넣는다(미해결 동일 키 중복 방지)."""
    cur.execute(
        """
        INSERT INTO review_queue (entity_type, entity_id, reason, payload)
        SELECT 'notice', 0, 'housing_type_unmapped', %(payload)s::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM review_queue
          WHERE reason = 'housing_type_unmapped' AND resolved = false AND payload->>'source_key' = %(key)s
        )
        """,
        {"payload": json.dumps({"source_key": key, "suplyTyNm": housing_type, "title": title}, ensure_ascii=False), "key": key},
    )


def insert_ingest_log(cur, *, stage: str, source: str, ok: bool, item_count: int, message: dict[str, Any], started_at: datetime) -> None:
    cur.execute(
        "INSERT INTO ingest_log (stage, source, ok, item_count, message, started_at) VALUES (%s, %s, %s, %s, %s, %s)",
        (stage, source, ok, item_count, json.dumps(message, ensure_ascii=False), started_at),
    )


# S3가 첨부 공고문에서 읽은 공고 단위 사실. 이미 값이 있으면(마이홈 API 등 1차 출처) 덮지 않는다.
# 일정은 셋 다 왔을 때만 schedule_source를 attachment로 표시한다.
UPDATE_FACTS_SQL = """
UPDATE notice SET
  apply_start_at  = COALESCE(apply_start_at, %(apply_start_at)s),
  apply_end_at    = COALESCE(apply_end_at, %(apply_end_at)s),
  announce_at     = COALESCE(announce_at, %(announce_at)s),
  min_deposit     = COALESCE(min_deposit, %(min_deposit)s),
  max_deposit     = COALESCE(max_deposit, %(max_deposit)s),
  supply_count    = COALESCE(supply_count, %(supply_count)s),
  schedule_source = CASE
    WHEN schedule_source IS NOT NULL THEN schedule_source
    WHEN apply_start_at IS NOT NULL OR apply_end_at IS NOT NULL THEN 'api'
    WHEN %(apply_start_at)s IS NOT NULL OR %(apply_end_at)s IS NOT NULL THEN 'attachment'
    ELSE NULL END,
  updated_at = now()
WHERE id = %(id)s
"""


def update_notice_facts(cur, notice_id: int, **facts: Any) -> None:
    """첨부 공고문에서 읽은 값으로 빈 칸만 채운다. 값이 전부 None이면 아무것도 안 한다."""
    if not any(v is not None for v in facts.values()):
        return
    cur.execute(UPDATE_FACTS_SQL, {"id": notice_id, **facts})
