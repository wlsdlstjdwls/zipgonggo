"""notice 계열 DB 쓰기. 소스 공통 (마이홈 API · SH 스크래퍼).

컬럼명은 db/schema.sql 그대로. 스키마가 바뀌면 여기와 마이그레이션을 같이 고친다.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
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
               complex_code, unit_count, min_deposit, min_rent, area_min, area_max, heating)
            VALUES (%(notice_id)s, %(name)s, %(sido)s, %(sigungu)s, %(road_address)s, %(zone)s, %(is_new)s, %(source_page)s,
                    %(complex_code)s, %(unit_count)s, %(min_deposit)s, %(min_rent)s, %(area_min)s, %(area_max)s, %(heating)s)
            ON CONFLICT (notice_id, name, road_address) DO UPDATE SET
              unit_count = COALESCE(notice_complex.unit_count, 0) + COALESCE(EXCLUDED.unit_count, 0),
              min_deposit = LEAST(notice_complex.min_deposit, EXCLUDED.min_deposit),
              min_rent = LEAST(notice_complex.min_rent, EXCLUDED.min_rent),
              area_min = LEAST(notice_complex.area_min, EXCLUDED.area_min),
              area_max = GREATEST(notice_complex.area_max, EXCLUDED.area_max)
            """,
            {"notice_id": notice_id, "zone": None, "complex_code": None, "unit_count": None, "heating": None,
             "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None, **r},
        )
    return len(rows)


def replace_notice_supply(cur, notice_id: int, rows: list[dict[str, Any]]) -> int:
    """공고의 공급현황 줄을 통째로 교체한다. complex_id는 같은 공고의 notice_complex와 이름으로 이어 붙인다.
    (표기가 조금씩 달라 못 붙는 줄이 있어도 complex_name은 남긴다 — 화면은 이름으로도 묶을 수 있다)"""
    cur.execute("DELETE FROM notice_supply WHERE notice_id = %s", (notice_id,))
    for r in rows:
        cur.execute(
            """
            INSERT INTO notice_supply
              (notice_id, complex_id, complex_name, supply_type, accessible, tenant_class, income_option, is_new,
               units_total, units_priority, units_general, units_reserve,
               deposit, down_payment, balance, rent,
               area_exclusive, area_common, area_etc, area_total, move_in_from, source_page)
            VALUES (%(notice_id)s,
                    (SELECT id FROM notice_complex WHERE notice_id = %(notice_id)s AND name = %(complex_name)s LIMIT 1),
                    %(complex_name)s, %(supply_type)s, %(accessible)s, %(tenant_class)s, %(income_option)s, %(is_new)s,
                    %(units_total)s, %(units_priority)s, %(units_general)s, %(units_reserve)s,
                    %(deposit)s, %(down_payment)s, %(balance)s, %(rent)s,
                    %(area_exclusive)s, %(area_common)s, %(area_etc)s, %(area_total)s, %(move_in_from)s, %(source_page)s)
            ON CONFLICT (notice_id, complex_name, supply_type, tenant_class, income_option) DO NOTHING
            """,
            {"notice_id": notice_id, **r},
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


# S3가 첨부 공고문에서 읽은 공고 단위 사실.
# 첨부에서 읽은 금액·호수는 목록에 없던 값이거나, 있어도 더 촘촘하다(공급현황 표 전체를 본다).
# 그래서 이 다섯 칸은 새 값이 있으면 덮어쓴다 — 예전 파서가 넣어 둔 틀린 값이 COALESCE에 걸려 남는 걸 막는다.
# 일정은 그대로 COALESCE — API가 준 접수일이 첨부 흐름도보다 믿을 만하다.
UPDATE_ATTACH_FACTS_SQL = """
UPDATE notice SET
  -- API가 준 일정은 건드리지 않는다. 다만 이미 첨부에서 읽어 둔 값(schedule_source='attachment')은
  -- 파서가 좋아지면 새 값으로 갈아 끼운다 — COALESCE만 쓰면 예전 파서의 틀린 날짜가 영영 남는다(2026-09-09).
  apply_start_at  = CASE WHEN schedule_source = 'attachment' AND %(apply_start_at)s::date IS NOT NULL
                         THEN %(apply_start_at)s::date ELSE COALESCE(apply_start_at, %(apply_start_at)s::date) END,
  apply_end_at    = CASE WHEN schedule_source = 'attachment' AND %(apply_end_at)s::date IS NOT NULL
                         THEN %(apply_end_at)s::date ELSE COALESCE(apply_end_at, %(apply_end_at)s::date) END,
  announce_at     = CASE WHEN schedule_source = 'attachment' AND %(announce_at)s::date IS NOT NULL
                         THEN %(announce_at)s::date ELSE COALESCE(announce_at, %(announce_at)s::date) END,
  -- 접수 시각은 첨부 흐름도에만 있다(API는 날짜까지만) — 읽었으면 그대로 넣는다
  apply_start_tm  = COALESCE(%(apply_start_tm)s::time, apply_start_tm),
  apply_end_tm    = COALESCE(%(apply_end_tm)s::time, apply_end_tm),
  min_deposit     = COALESCE(%(min_deposit)s, min_deposit),
  max_deposit     = COALESCE(%(max_deposit)s, max_deposit),
  min_rent        = COALESCE(%(min_rent)s, min_rent),
  max_rent        = COALESCE(%(max_rent)s, max_rent),
  supply_count    = COALESCE(%(supply_count)s, supply_count),
  -- 흐름도 단계는 첨부에서만 나온다 — 새로 읽었으면 통째로 갈아 끼운다(파서가 좋아지면 바로 반영)
  schedule_steps  = COALESCE(%(schedule_steps)s::jsonb, schedule_steps),
  schedule_source = CASE
    WHEN schedule_source IS NOT NULL THEN schedule_source
    WHEN apply_start_at IS NOT NULL OR apply_end_at IS NOT NULL THEN 'api'
    WHEN %(apply_start_at)s::date IS NOT NULL OR %(apply_end_at)s::date IS NOT NULL THEN 'attachment'
    ELSE NULL END,
  updated_at = now()
WHERE id = %(id)s
"""

FACT_KEYS = ("apply_start_at", "apply_end_at", "apply_start_tm", "apply_end_tm", "announce_at", "schedule_steps",
             "min_deposit", "max_deposit", "min_rent", "max_rent", "supply_count")


def update_notice_attach_facts(cur, notice_id: int, **facts: Any) -> None:
    """첨부 공고문 전용 — 금액·호수는 새로 읽은 값이 이긴다. 안 넘긴 칸은 None으로 채워 SQL 자리를 맞춘다."""
    if not any(v is not None for v in facts.values()):
        return
    params: dict[str, Any] = {k: facts.get(k) for k in FACT_KEYS}
    cur.execute(UPDATE_ATTACH_FACTS_SQL, {"id": notice_id, **params})


def link_related_post(cur, *, agency: str, base_title: str, seq: str, title: str) -> int | None:
    """자료만 덧붙인 게시글을 원 공고의 raw.related_posts에 붙인다. 원 공고를 못 찾으면 None.

    별도 notice를 만들면 같은 공고가 목록에 두 번 나온다(사용자 지적 2026-09-09).
    첨부는 자식 글에 붙어 있으므로 seq를 남겨 S3가 나중에 그 글의 첨부까지 읽게 한다.
    """
    cur.execute(
        "SELECT id, raw FROM notice WHERE agency = %s AND title = %s ORDER BY posted_at DESC LIMIT 1",
        (agency, base_title),
    )
    row = cur.fetchone()
    if row is None:
        return None
    raw = row["raw"] or {}
    if isinstance(raw, str):
        raw = json.loads(raw)
    related = [r for r in raw.get("related_posts", []) if r.get("seq") != seq]
    related.append({"seq": seq, "title": title})
    raw["related_posts"] = related
    cur.execute("UPDATE notice SET raw = %s, updated_at = now() WHERE id = %s",
                (json.dumps(raw, ensure_ascii=False), row["id"]))
    return row["id"]


def upsert_result_post(cur, post: dict[str, Any]) -> None:
    """결과 글 원장. 원 공고를 못 찾아도 넣는다 — 나중에 공고가 들어오면 relink_result_posts가 잇는다."""
    cur.execute(
        """
        INSERT INTO result_post (seq, agency, title, posted_at, result_kind, notice_date, reserve_round, notice_id, note)
        VALUES (%(seq)s, %(agency)s, %(title)s, %(posted_at)s, %(result_kind)s, %(notice_date)s,
                %(reserve_round)s, %(notice_id)s, %(note)s)
        ON CONFLICT (seq) DO UPDATE SET
          title = EXCLUDED.title,
          notice_id = COALESCE(EXCLUDED.notice_id, result_post.notice_id),
          note = EXCLUDED.note
        """,
        {"agency": "SH", "notice_id": None, "note": None, **post},
    )


def _norm_title(t: str) -> str:
    """공백·마침표·가운뎃점을 털어 제목을 맞대 본다. 「(2026. 6. 26.)」과 「(2026.6.26.)」이 같아진다."""
    return re.sub(r"[\s.·]", "", t)


def find_notice_for_result(
    cur, *, agency: str, notice_date: date, housing_type: str | None, title: str | None = None
) -> int | None:
    """결과 글이 인용한 공고일로 원 공고를 찾는다. 제목 문자열끼리 맞추는 것보다 튼튼하다.

    같은 날 같은 유형 공고가 여럿이면(2026-06-26 매입임대 3건) 날짜만으로는 못 가른다.
    그때는 제목으로 가른다 — 결과 글 제목은 원 공고 제목을 통째로 인용하고 뒤에 「… 최종 청약경쟁률 게시」를
    붙인 꼴이라, 원 공고 제목이 결과 글 제목의 앞부분이 된다. 그래도 하나로 안 좁혀지면 잇지 않는다.
    잘못 이으면 남의 공고에 남의 경쟁률이 붙는다.
    """
    cur.execute(
        """
        SELECT id, title FROM notice
        WHERE agency = %(agency)s AND posted_at = %(day)s
          AND (%(ht)s::text IS NULL OR housing_type::text = %(ht)s)
        """,
        {"agency": agency, "day": notice_date, "ht": housing_type},
    )
    rows = cur.fetchall()
    if len(rows) == 1:
        return rows[0]["id"]
    if len(rows) > 1 and title:
        want = _norm_title(title)
        hit = [r for r in rows if _norm_title(r["title"]) and want.startswith(_norm_title(r["title"]))]
        if len(hit) == 1:
            return hit[0]["id"]
    return None


def replace_notice_results(cur, *, notice_id: int, post_seq: str, result_kind: str, rows: list[dict[str, Any]]) -> int:
    """한 결과 글이 준 표를 통째로 교체한다. 다시 돌려도 같은 결과가 되게."""
    cur.execute("DELETE FROM notice_result WHERE post_seq = %s", (post_seq,))
    for r in rows:
        cur.execute(
            """
            INSERT INTO notice_result
              (notice_id, post_seq, row_no, result_kind, complex_name, sigungu, address, supply_kind, supply_type,
               tenant_class, bracket, units, applicants, ratio, reconciled, repaired, source_page)
            VALUES (%(notice_id)s, %(post_seq)s, %(row_no)s, %(result_kind)s, %(complex_name)s, %(sigungu)s,
                    %(address)s, %(supply_kind)s, %(supply_type)s, %(tenant_class)s, %(bracket)s,
                    %(units)s, %(applicants)s, %(ratio)s, %(reconciled)s, %(repaired)s, %(source_page)s)
            ON CONFLICT (post_seq, row_no) DO NOTHING
            """,
            {"notice_id": notice_id, "post_seq": post_seq, "result_kind": result_kind, **r},
        )
    cur.execute(
        "UPDATE result_post SET row_count = %s, parsed_at = now(), note = %s WHERE seq = %s",
        (len(rows), None if rows else "표 없음(양식 미지원)", post_seq),
    )
    return len(rows)


def relink_result_posts(cur, *, agency: str = "SH") -> int:
    """아직 원 공고를 못 찾은 결과 글을 다시 이어 본다. 공고 백필이 뒤늦게 들어오는 순서를 감당한다.

    적재 때와 **같은 규칙**(find_notice_for_result)을 쓴다 — 여기만 느슨하면 그때 안 이은 걸 지금 잘못 잇는다.
    """
    cur.execute(
        "SELECT seq, title, notice_date FROM result_post WHERE notice_id IS NULL AND notice_date IS NOT NULL AND agency = %s",
        (agency,),
    )
    pending = cur.fetchall()
    linked = 0
    for p in pending:
        notice_id = find_notice_for_result(cur, agency=agency, notice_date=p["notice_date"],
                                           housing_type=None, title=p["title"])
        if notice_id is None:
            continue
        cur.execute("UPDATE result_post SET notice_id = %s, note = NULL WHERE seq = %s", (notice_id, p["seq"]))
        linked += 1
    return linked
