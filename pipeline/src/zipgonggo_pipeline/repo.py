"""notice 계열 DB 쓰기. 소스 공통 (마이홈 API · SH 스크래퍼).

컬럼명은 db/schema.sql 그대로. 스키마가 바뀌면 여기와 마이그레이션을 같이 고친다.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any

from .programs import classify as classify_programs

NOTICE_COLS = [
    "slug", "fingerprint", "source", "source_key", "amends_source_key", "agency", "title",
    "housing_type", "sector", "house_type", "sido", "sigungu", "complex_name", "address", "pnu", "heating",
    "total_household", "supply_count", "min_deposit", "min_rent", "min_down_payment", "min_interim",
    "min_balance", "posted_at", "apply_start_at", "apply_end_at", "announce_at", "status",
    "source_status", "source_url", "portal_url", "contact", "source_rank", "raw", "programs",
]
# 재수집 시 갱신하지 않는 것: slug(URL 불변), source, source_key, publish, created_at
_UPDATE_COLS = [c for c in NOTICE_COLS if c not in ("slug", "source", "source_key")]

# 목록에 없는 칸을 NULL로 덮지 않는다. S3이 첨부 공고문에서 읽어 넣은 값을
# 매시 도는 목록 수집이 지우고 있었다 — 화면에 접수기간 대신 「원문 확인」이 뜬 원인(2026-09-10).
# 목록이 값을 들고 왔을 때만 갈아 끼운다. 목록 쪽이 최신이라는 판단은 그대로 지킨다.
_KEEP_IF_NULL = {
    "apply_start_at", "apply_end_at", "announce_at",
    "supply_count", "min_deposit", "min_rent", "min_down_payment", "min_interim", "min_balance",
}


def _assign(col: str) -> str:
    if col in _KEEP_IF_NULL:
        return f"{col} = COALESCE(EXCLUDED.{col}, notice.{col})"
    return f"{col} = EXCLUDED.{col}"


# 공고 1건 = **왕복 한 번**. 전에는 upsert + notice_area DELETE + 시군구마다 INSERT로 2+N번을 오갔다.
# 한국에서 Neon(us-east-1)까지 한 왕복이 230ms 남짓이라(실측 2026-09-16) 왕복 수가 곧 적재 시간이다.
#
# 지우고 다시 넣지 않고 **넣을 것은 upsert, 없어진 것만 삭제**한다 — 두 CTE가 건드리는 행이 겹치지 않아야
# 한 문장 안에서 안전하다. 같은 문장 안에서 DELETE한 행을 곧바로 INSERT하면
# UNIQUE(notice_id, sido, sigungu)가 삭제를 못 보고 걸릴 수 있다(CTE끼리 실행 순서가 정해져 있지 않다).
UPSERT_SQL = (
    "WITH up AS ("
    f"  INSERT INTO notice ({', '.join(NOTICE_COLS)}) VALUES ({', '.join('%(' + c + ')s' for c in NOTICE_COLS)})"
    "  ON CONFLICT (source_key) DO UPDATE SET "
    + ", ".join(_assign(c) for c in _UPDATE_COLS)
    + ", updated_at = now() RETURNING id, (xmax = 0) AS inserted"
    "), src AS ("
    "  SELECT (SELECT id FROM up) AS notice_id, a.sido, a.sigungu, a.supply_count"
    "    FROM jsonb_to_recordset(%(areas)s::jsonb) AS a(sido text, sigungu text, supply_count int)"
    "), ins AS ("
    "  INSERT INTO notice_area (notice_id, sido, sigungu, supply_count) SELECT * FROM src"
    "  ON CONFLICT (notice_id, sido, sigungu) DO UPDATE SET supply_count = EXCLUDED.supply_count"
    "), del AS ("
    "  DELETE FROM notice_area x WHERE x.notice_id = (SELECT id FROM up)"
    "    AND NOT EXISTS (SELECT 1 FROM src s"
    "                     WHERE s.sido = x.sido AND s.sigungu IS NOT DISTINCT FROM x.sigungu)"
    ") SELECT id, inserted FROM up"
)


def upsert_notice(cur, notice: dict[str, Any], areas: list[dict[str, Any]]) -> bool:
    """notice 1행 upsert + notice_area 교체를 **한 문장**으로. True면 신규."""
    row = dict(notice)
    row["raw"] = json.dumps(row["raw"], ensure_ascii=False)
    # 사업 이름(0039)은 소스가 아니라 여기서 매긴다 — 소스마다 따로 부르면 한 곳이 빠진다
    row["programs"] = classify_programs(row["title"], row["housing_type"])
    row["areas"] = json.dumps(
        [{"sido": a["sido"], "sigungu": a["sigungu"], "supply_count": a["supply_count"]} for a in areas],
        ensure_ascii=False,
    )
    cur.execute(UPSERT_SQL, row)
    result = cur.fetchone()
    return bool(result["inserted"])


def replace_notice_complexes(cur, notice_id: int, rows: list[dict[str, Any]]) -> int:
    """공고의 공급 단지 목록을 통째로 교체한다(notice_area와 같은 방식). 돌려주는 값은 넣은 행 수.

    좌표(S6이 요약DB로 맞춘 값)는 지우고 다시 넣어도 살아남아야 한다 — 파서를 고쳐 S3을 다시 돌릴 때마다
    좌표가 통째로 날아가면 S6을 매번 다시 돌려야 한다(실측 2026-09-09: 재실행 한 번에 262건 소실).
    유일키가 (공고, 단지명, 도로명주소)라 그 키로 그대로 되돌린다. 주소가 바뀐 행은 못 찾아 비는 게 맞다.
    단지 이미지 연결(`sh_bizns_cd`·`youth_home_code`, collect_{sh,youth}_house_assets load/match)도 같은 이유로 살린다 —
    자격 파서를 고쳐 S3을 다시 돌린 날 세 공고 325단지의 사진이 통째로 사라졌다(실측 2026-09-14).
    **새 연결 컬럼을 만들면 여기에 같이 넣어야 한다** — 안 넣으면 수집 한 번에 조용히 날아간다
    (실측 2026-09-15: `youth_home_code`를 빼먹어 민간임대 445행이 배포 직전에 통째로 NULL이 됐다).
    """
    cur.execute(
        """
        CREATE TEMP TABLE IF NOT EXISTS _nc_geom
          (name text, road_address text, geom geography(Point,4326), geo_precision geo_precision,
           geo_matched_by text, geo_matched_at timestamptz, sh_bizns_cd text, youth_home_code text) ON COMMIT DROP
        """
    )
    cur.execute("TRUNCATE _nc_geom")
    cur.execute(
        """
        INSERT INTO _nc_geom
        SELECT name, road_address, geom, geo_precision, geo_matched_by, geo_matched_at, sh_bizns_cd, youth_home_code
          FROM notice_complex
         WHERE notice_id = %s AND (geom IS NOT NULL OR sh_bizns_cd IS NOT NULL OR youth_home_code IS NOT NULL)
        """,
        (notice_id,),
    )
    cur.execute("DELETE FROM notice_complex WHERE notice_id = %s", (notice_id,))
    cur.executemany(
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
        [{"notice_id": notice_id, "zone": None, "complex_code": None, "unit_count": None, "heating": None,
          "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None, **r} for r in rows],
    )
    cur.execute(
        """
        UPDATE notice_complex c SET geom = COALESCE(g.geom, c.geom), geo_precision = COALESCE(g.geo_precision, c.geo_precision),
               geo_matched_by = COALESCE(g.geo_matched_by, c.geo_matched_by), geo_matched_at = COALESCE(g.geo_matched_at, c.geo_matched_at),
               sh_bizns_cd = COALESCE(g.sh_bizns_cd, c.sh_bizns_cd),
               youth_home_code = COALESCE(g.youth_home_code, c.youth_home_code)
          FROM _nc_geom g
         WHERE c.notice_id = %s AND c.name = g.name AND c.road_address = g.road_address
        """,
        (notice_id,),
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
               area_exclusive, area_common, area_etc, area_total, move_in_from, source_page, deposit_options)
            VALUES (%(notice_id)s,
                    (SELECT id FROM notice_complex WHERE notice_id = %(notice_id)s AND name = %(complex_name)s LIMIT 1),
                    %(complex_name)s, %(supply_type)s, %(accessible)s, %(tenant_class)s, %(income_option)s, %(is_new)s,
                    %(units_total)s, %(units_priority)s, %(units_general)s, %(units_reserve)s,
                    %(deposit)s, %(down_payment)s, %(balance)s, %(rent)s,
                    %(area_exclusive)s, %(area_common)s, %(area_etc)s, %(area_total)s, %(move_in_from)s, %(source_page)s, %(deposit_options)s::jsonb)
            ON CONFLICT (notice_id, complex_name, supply_type, tenant_class, income_option) DO NOTHING
            """,
            {"notice_id": notice_id, "deposit_options": None, **r},
        )
    return len(rows)


def replace_units(cur, notice_id: int, rows: list[dict[str, Any]]) -> int:
    """공고의 호실 목록을 통째로 교체한다. notice_complex_id는 같은 공고의 단지코드로 이어 붙인다.

    별첨 주택목록(sh_units)에서만 나오는 값이다 — 동·호·구조(원룸/투룸)·승강기·전환 금액.
    unit_key는 공고 안에서만 유일하면 된다: 「단지코드-호」(0001J-0201).
    LH 주택목록에는 단지코드가 없어 `nc_name`·`nc_road`(단지 이름·주소)로 잇는다 — 둘 다 replace_notice_complexes의 유일키다.
    """
    cur.execute("DELETE FROM unit WHERE notice_id = %s", (notice_id,))
    # executemany는 psycopg 3.1부터 파이프라인으로 한 번에 보낸다. 줄마다 execute하면 Neon 왕복(230ms)이 호실 수만큼 쌓여
    # LH 경기남부 631호 공고 하나에 2분 넘게 걸렸다(2026-10-02)
    cur.executemany(
        """
        INSERT INTO unit
          (notice_id, notice_complex_id, unit_key, road_address, complex_name, building, room, floor,
           sido, sigungu, area_m2, deposit, rent, deposit_jeonse, rent_jeonse, deposit_wolse, rent_wolse,
           room_layout, elevator, has_elevator, seq, source_page)
        VALUES (%(notice_id)s,
                COALESCE(
                  (SELECT id FROM notice_complex
                    WHERE notice_id = %(notice_id)s AND complex_code = %(complex_code)s LIMIT 1),
                  (SELECT id FROM notice_complex
                    WHERE notice_id = %(notice_id)s AND name = %(nc_name)s AND road_address = %(nc_road)s LIMIT 1)),
                %(unit_key)s, %(road_address)s, %(complex_name)s, %(building)s, %(room)s, %(floor)s,
                %(sido)s, %(sigungu)s, %(area_m2)s, %(deposit)s, %(rent)s,
                %(deposit_jeonse)s, %(rent_jeonse)s, %(deposit_wolse)s, %(rent_wolse)s,
                %(room_layout)s, %(elevator)s, %(has_elevator)s, %(seq)s, %(source_page)s)
        ON CONFLICT (notice_id, unit_key) DO NOTHING
        """,
        [{"notice_id": notice_id, "nc_name": None, "nc_road": None, **r} for r in rows],
    )
    return len(rows)


def update_notice_complex_facts(cur, notice_id: int, *, min_deposit: int | None, min_rent: int | None,
                                area_min: Any, area_max: Any) -> None:
    """첨부 표에서 읽은 단지 요약값. 목록·지도가 이 네 칸을 쓴다. 새로 읽은 값이 이긴다(첨부 사실 규약과 같다).
    민간임대(youth)는 공고당 단지가 하나라 공고 열쇠로 고친다 — 단지가 여럿인 SH는 replace_notice_complexes가 행마다 넣는다."""
    cur.execute(
        """
        UPDATE notice_complex SET
          min_deposit = COALESCE(%(min_deposit)s, min_deposit),
          min_rent    = COALESCE(%(min_rent)s, min_rent),
          area_min    = COALESCE(%(area_min)s, area_min),
          area_max    = COALESCE(%(area_max)s, area_max)
        WHERE notice_id = %(notice_id)s
        """,
        {"notice_id": notice_id, "min_deposit": min_deposit, "min_rent": min_rent, "area_min": area_min, "area_max": area_max},
    )


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


# ─────────────────────────────────────────────────────────────
# S6 — 주소-좌표 조인 결과 적재
#
# 넣는 값은 행안부 요약DB 오프라인 조인 결과뿐이다. 지오코딩 API 응답은 받지도 저장하지도 않는다
# (CLAUDE.md 하지 말 것 1). 요약DB 원본은 pipeline/data/juso/ 에 두고 여기엔 맞은 좌표만 온다(하지 말 것 2).
# ─────────────────────────────────────────────────────────────

_POINT = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography"

ADDRESS_MATCH_SQL = f"""
INSERT INTO address_match (normalized_addr, geom, precision, matched_by)
VALUES (%(normalized_addr)s, {_POINT}, %(precision)s, %(matched_by)s)
ON CONFLICT (normalized_addr) DO UPDATE SET
  geom = EXCLUDED.geom, precision = EXCLUDED.precision, matched_by = EXCLUDED.matched_by
"""


def _set_geom_sql(table: str) -> str:
    return f"""
        UPDATE {table} SET
          geom = {_POINT}, geo_precision = %(precision)s, geo_matched_by = %(matched_by)s,
          geo_matched_at = now(), updated_at = now()
        WHERE id = %(id)s
        """


def apply_geo_matches(cur, matched: list[tuple[str, int, Any]]) -> int:
    """S6 결과를 한 번에 쓴다 — address_match upsert + 대상 표(notice_complex·complex)의 좌표.

    줄마다 execute하면 쿼리 둘 × Neon 왕복 230ms가 행 수만큼 쌓인다. LH 단지 2,456곳에 19분이 걸렸다(2026-10-02).
    executemany는 파이프라인으로 한 번에 보낸다. address_match의 키는 공고 표기가 아니라 요약DB가 돌려준 정규 주소다.
    """
    cur.executemany(ADDRESS_MATCH_SQL, [_geo_params(m) for _, _, m in matched])
    for table in ("notice_complex", "complex"):
        rows = [{"id": row_id, **_geo_params(m)} for t, row_id, m in matched if t == table]
        if rows:
            cur.executemany(_set_geom_sql(table), rows)
    return len(matched)


def _geo_params(match) -> dict[str, Any]:
    return {
        "normalized_addr": match.normalized_addr, "lon": match.lon, "lat": match.lat,
        "precision": match.precision, "matched_by": match.matched_by,
    }


# ─────────────────────────────────────────────────────────────
# S0 — 공급유형 자격·배점 사양 (db/seeds/eligibility.json)
#
# 공고와 무관한 제도 규칙이라 수집 스테이지가 아니라 시드다. 통째로 갈아 끼운다.
# ─────────────────────────────────────────────────────────────

SUPPLY_TYPE_COLS = [
    "code", "category", "name", "housing_type", "sort_order",
    "age_min", "age_max", "age_exempt", "marital", "marital_max_yr", "newborn_exempt",
    "required_class", "homeless_scope", "income_scope", "income_pct",
    "asset_scope", "asset_limit_man", "car_limit_man", "region_limit", "birth_bonus", "note",
    "ranking_method", "ranks", "general_ranks", "score",
    # 0038 — 공고문 대조로 생긴 칸
    "income_pct_dual", "income_small_bonus", "basis",
]

SUPPLY_TYPE_SQL = (
    f"INSERT INTO supply_type ({', '.join(SUPPLY_TYPE_COLS)}) "
    f"VALUES ({', '.join('%(' + c + ')s' for c in SUPPLY_TYPE_COLS)}) "
    "ON CONFLICT (code) DO UPDATE SET "
    + ", ".join(f"{c} = EXCLUDED.{c}" for c in SUPPLY_TYPE_COLS if c != "code")
    + ", updated_at = now()"
)


def replace_supply_types(cur, rows: list[dict[str, Any]]) -> int:
    """공급유형 사양을 시드 파일 내용으로 맞춘다. 시드에서 빠진 코드는 지운다."""
    for r in rows:
        cur.execute(SUPPLY_TYPE_SQL, {**r, "score": json.dumps(r.get("score") or {}, ensure_ascii=False)})
    codes = [r["code"] for r in rows]
    cur.execute("DELETE FROM supply_type WHERE NOT (code = ANY(%s))", (codes,))
    return len(rows)


def replace_income_standard(cur, rows: list[dict[str, Any]], *, year: int) -> int:
    cur.execute("DELETE FROM income_standard WHERE year = %s", (year,))
    for r in rows:
        cur.execute(
            "INSERT INTO income_standard (year, household, pct, monthly_won) VALUES (%(year)s, %(household)s, %(pct)s, %(monthly_won)s)",
            r,
        )
    return len(rows)


def replace_region_tiers(cur, rows: list[dict[str, Any]]) -> int:
    cur.execute("DELETE FROM region_tier")
    for r in rows:
        cur.execute("INSERT INTO region_tier (name, kind, tier) VALUES (%(name)s, %(kind)s, %(tier)s)", r)
    return len(rows)


# ─────────────────────────────────────────────────────────────
# S3 — 공고문 신청자격 묶음 (notice_eligibility, 0024)
# ─────────────────────────────────────────────────────────────


def income_base100(cur, year: int | None = None) -> dict[int, int]:
    """가구원수 → 그 통계연도의 100% 기준액(원). 공고문 소득표 검산에 쓴다. year가 없으면 최신 연도."""
    if year is None:
        cur.execute("SELECT household, monthly_won FROM income_standard WHERE pct = 100 AND year = (SELECT max(year) FROM income_standard)")
    else:
        cur.execute("SELECT household, monthly_won FROM income_standard WHERE pct = 100 AND year = %s", (year,))
    return {r["household"]: r["monthly_won"] for r in cur.fetchall()}


def income_years(cur) -> list[int]:
    cur.execute("SELECT DISTINCT year FROM income_standard ORDER BY year DESC")
    return [r["year"] for r in cur.fetchall()]


def upsert_notice_eligibility(cur, notice_id: int, *, source: str, source_pages: list[int], data: dict[str, Any], verified: bool) -> None:
    cur.execute(
        """
        INSERT INTO notice_eligibility (notice_id, source, source_pages, data, verified, parsed_at)
        VALUES (%(notice_id)s, %(source)s, %(source_pages)s, %(data)s::jsonb, %(verified)s, now())
        ON CONFLICT (notice_id) DO UPDATE SET
          source = EXCLUDED.source, source_pages = EXCLUDED.source_pages, data = EXCLUDED.data,
          verified = EXCLUDED.verified, parsed_at = now()
        """,
        {"notice_id": notice_id, "source": source, "source_pages": source_pages,
         "data": json.dumps(data, ensure_ascii=False), "verified": verified},
    )


# ─────────────────────────────────────────────────────────────
# S5 — 마이홈 단지정보·대기현황 (complex · complex_type · waitlist, 0031·0032)
# ─────────────────────────────────────────────────────────────

# 한 표를 **한 문장**으로 쓴다. 한국에서 Neon(us-east-1)까지 한 왕복이 230ms 남짓이라(실측 2026-09-16)
# 단지 240곳을 행마다 오가면 1분이 그냥 간다. jsonb_to_recordset으로 통째로 밀어 넣는다.

_COMPLEX_COLS = [
    ("slug", "text"), ("complex_code", "text"), ("name", "text"), ("agency", "text"),
    ("housing_type", "housing_type"), ("road_address", "text"), ("pnu", "char(19)"),
    ("sido", "text"), ("sido_code", "text"), ("sigungu", "text"), ("sigungu_code", "text"),
    ("household_cnt", "integer"), ("completed_on", "date"),
    ("heating", "text"), ("building_style", "text"), ("elevator", "text"), ("parking_cnt", "integer"),
]


def _recordset(cols: list[tuple[str, str]]) -> str:
    return ", ".join(f"{c} {t}" for c, t in cols)


def upsert_complexes(cur, rows: list[dict[str, Any]]) -> int:
    """단지 원장 upsert. 좌표(geom)는 목록에 없어 손대지 않는다 — S6이 채운 값이 살아남아야 한다."""
    if not rows:
        return 0
    names = [c for c, _ in _COMPLEX_COLS]
    cur.execute(
        f"""
        INSERT INTO complex ({', '.join(names)}, raw)
        SELECT {', '.join('s.' + c for c in names)}, s.raw
          FROM jsonb_to_recordset(%(rows)s::jsonb) AS s({_recordset(_COMPLEX_COLS)}, raw jsonb)
        ON CONFLICT (complex_code) DO UPDATE SET
          {', '.join(f'{c} = EXCLUDED.{c}' for c in names if c != 'complex_code')},
          raw = EXCLUDED.raw, updated_at = now()
        """,
        {"rows": json.dumps(rows, ensure_ascii=False, default=str)},
    )
    return len(rows)


_TYPE_COLS = [
    ("style_name", "text"), ("housing_type", "housing_type"), ("house_type", "text"),
    ("exclusive_area", "numeric"), ("exclusive_area_max", "numeric"),
    ("common_area", "numeric"), ("common_area_max", "numeric"),
    ("base_deposit", "bigint"), ("base_rent", "bigint"), ("conversion_deposit_limit", "bigint"),
    ("row_count", "integer"),
]


def upsert_complex_types(cur, rows: list[dict[str, Any]]) -> int:
    """형 줄 교체. complex_code로 단지를 찾아 붙이고, 이번에 안 온 줄은 그 단지에서만 지운다.

    지우는 범위를 **이번에 받은 단지**로 좁히는 이유: S5는 공고가 가리키는 단지만 받는다.
    표 전체를 기준으로 지우면 지난 회차에 받아 둔 다른 단지의 형이 통째로 날아간다.
    """
    if not rows:
        return 0
    names = [c for c, _ in _TYPE_COLS]
    payload = json.dumps(rows, ensure_ascii=False, default=str)
    cur.execute(
        f"""
        INSERT INTO complex_type (complex_id, {', '.join(names)}, raw)
        SELECT c.id, {', '.join('s.' + n for n in names)}, s.raw
          FROM jsonb_to_recordset(%(rows)s::jsonb) AS s(complex_code text, {_recordset(_TYPE_COLS)}, raw jsonb)
          JOIN complex c ON c.complex_code = s.complex_code
        ON CONFLICT ON CONSTRAINT complex_type_identity DO UPDATE SET
          {', '.join(f'{n} = EXCLUDED.{n}' for n in names if n not in ('style_name', 'housing_type', 'base_deposit', 'base_rent'))},
          raw = EXCLUDED.raw, updated_at = now()
        """,
        {"rows": payload},
    )
    cur.execute(
        f"""
        DELETE FROM complex_type t
         USING complex c
         WHERE t.complex_id = c.id
           AND c.complex_code IN (SELECT DISTINCT complex_code FROM jsonb_to_recordset(%(rows)s::jsonb)
                                    AS s(complex_code text))
           AND NOT EXISTS (
                 SELECT 1 FROM jsonb_to_recordset(%(rows)s::jsonb)
                   AS s(complex_code text, style_name text, housing_type housing_type,
                        base_deposit bigint, base_rent bigint)
                  WHERE s.complex_code = c.complex_code
                    AND s.style_name = t.style_name
                    AND s.housing_type IS NOT DISTINCT FROM t.housing_type
                    AND s.base_deposit IS NOT DISTINCT FROM t.base_deposit
                    AND s.base_rent IS NOT DISTINCT FROM t.base_rent)
        """,
        {"rows": payload},
    )
    return len(rows)


def link_notice_complex_codes(cur, links: list[tuple[str, str]], evaluated: list[str]) -> int:
    """S5가 좁힌 (공고 slug → 단지 코드)를 notice.complex_code에 박는다.

    S1의 UPSERT 컬럼 목록(NOTICE_COLS)에 complex_code가 없어 매시 도는 목록 수집이 덮어쓰지 않는다.
    새 컬럼을 NOTICE_COLS에 넣는 날은 이 값이 날아가니 그때 다시 본다(0032 주석).

    **이번에 살펴봤는데 못 좁힌 공고는 연결을 지운다.** 좁히는 규칙을 고치면(이름 유사도 문턱 같은 것)
    어제 붙인 연결이 오늘은 틀린 연결이 된다. 지우지 않으면 지면이 남의 단지를 계속 싣는다.
    `evaluated`는 이번 회차가 실제로 후보를 따져 본 공고 전부 — 안 본 공고는 건드리지 않는다.
    """
    if not evaluated:
        return 0
    cur.execute(
        """
        WITH link AS (
          SELECT * FROM jsonb_to_recordset(%(rows)s::jsonb) AS s(slug text, complex_code text)
        )
        UPDATE notice n SET complex_code = l.complex_code
          FROM unnest(%(evaluated)s::text[]) AS e(slug)
          LEFT JOIN link l ON l.slug = e.slug
         WHERE n.slug = e.slug AND n.complex_code IS DISTINCT FROM l.complex_code
        """,
        {"rows": json.dumps([{"slug": s, "complex_code": c} for s, c in links], ensure_ascii=False),
         "evaluated": evaluated},
    )
    return cur.rowcount


_WAIT_COLS = [
    ("complex_code", "text"), ("agency", "text"), ("complex_name", "text"), ("road_address", "text"),
    ("sido", "text"), ("sigungu", "text"), ("housing_type", "housing_type"), ("house_type", "text"),
    ("style_name", "text"), ("draw_unit", "text"),
    ("waiting_cnt", "integer"), ("vacated_cnt", "integer"), ("surveyed_on", "date"),
]


def upsert_waitlist(cur, rows: list[dict[str, Any]]) -> int:
    """대기현황 스냅샷. 기준일 필드가 API에 없어 수집일(surveyed_on)이 키의 일부다 — 날마다 한 벌씩 쌓인다."""
    if not rows:
        return 0
    names = [c for c, _ in _WAIT_COLS]
    cur.execute(
        f"""
        INSERT INTO waitlist ({', '.join(names)}, complex_id, raw)
        SELECT {', '.join('s.' + n for n in names)}, c.id, s.raw
          FROM jsonb_to_recordset(%(rows)s::jsonb) AS s({_recordset(_WAIT_COLS)}, raw jsonb)
          LEFT JOIN complex c ON c.complex_code = s.complex_code
        ON CONFLICT (complex_code, housing_type, style_name, draw_unit, surveyed_on) DO UPDATE SET
          waiting_cnt = EXCLUDED.waiting_cnt, vacated_cnt = EXCLUDED.vacated_cnt,
          complex_id = EXCLUDED.complex_id, raw = EXCLUDED.raw
        """,
        {"rows": json.dumps(rows, ensure_ascii=False, default=str)},
    )
    return len(rows)
