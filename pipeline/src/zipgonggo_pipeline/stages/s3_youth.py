"""S3-YOUTH — 서울시 청년안심주택(민간임대) 첨부 공고문 PDF → 공급현황(notice_supply)·호실(unit)·금액 요약.

    python -m zipgonggo_pipeline.stages.s3_youth [--dry-run] [--limit N] [--board ID] [--refresh] [--cached] [--since-year Y]

s1_youth가 적재한 공고(source='youth_scrape')의 `raw.file_url`(PDF 1개)을 받아 pipeline/data/youth/{boardId}.pdf에 두고
parsers/youth_attach가 임대보증금·월임대료 표를 읽는다. 재실행은 받아 둔 파일을 다시 쓴다(--cached면 네트워크를 아예 안 쓴다).

넣는 것:
- notice_supply — 공급대상 × 특별/일반 × 주택형 한 줄. deposit·rent는 보증금이 가장 낮은 옵션, 나머지 비율은 deposit_options(0025)
- unit — 호실 단위 표(「1701호」)가 있는 추가모집만. notice_complex_id는 이 공고의 단지(하나)로 잇는다
- notice.min/max_deposit·rent, notice_complex.min_deposit·min_rent·area_min·area_max — 목록·지도·「내 조건」이 쓰는 요약값

기본 대상은 아직 notice_supply가 없는 공고(최신순). --refresh면 있는 것도 다시 읽는다(파서를 고쳤을 때).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from ..config import settings
from ..db import connect
from ..parsers.youth_attach import YouthAttachFacts, fill_kind_from_label, parse_pdf, supply_rows, unit_rows
from ..repo import replace_notice_supply, replace_units, update_notice_attach_facts, update_notice_complex_facts
from ..sources.http import ThrottledHttp
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s3.youth")

STAGE = "S3"
SOURCE = "youth_attach"
CACHE_ROOT = Path(__file__).resolve().parents[3] / "data" / "youth"

SELECT_SQL = """
SELECT n.id, n.slug, n.title, n.source_status, n.raw->>'file_url' AS file_url,
       n.raw->'youth_list_row'->>'boardId' AS board_id, n.sido, n.sigungu,
       n.raw->'labels'->>'공급호수' AS supply_label,
       nc.name AS complex_name, nc.road_address
  FROM notice n
  LEFT JOIN LATERAL (SELECT name, road_address FROM notice_complex WHERE notice_id = n.id ORDER BY id LIMIT 1) nc ON true
 WHERE n.source = 'youth_scrape'
   AND COALESCE(n.raw->>'file_url', '') <> ''
   AND (%(board)s::text IS NULL OR n.raw->'youth_list_row'->>'boardId' = %(board)s)
   AND (%(since)s::int IS NULL OR EXTRACT(YEAR FROM n.posted_at) >= %(since)s)
   AND (%(refresh)s OR NOT EXISTS (SELECT 1 FROM notice_supply s WHERE s.notice_id = n.id))
 ORDER BY n.posted_at DESC, n.id DESC
 LIMIT %(limit)s
"""


def fetch_pdf(http: ThrottledHttp | None, url: str, dest: Path) -> Path | None:
    """받아 둔 파일이 있으면 그걸 쓴다. 없고 http가 없으면(--cached) None. PDF가 아니면(HTML 오류 쪽 등) 버린다."""
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    if http is None:
        return None
    resp = http.get(url, label=f"youth pdf {dest.stem}")
    body = resp.content
    if not body.startswith(b"%PDF"):
        log.warning("%s: PDF가 아니다(%s, %d바이트)", dest.stem, resp.headers.get("content-type"), len(body))
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    return dest


def load_facts(cur, n: dict[str, Any], facts: YouthAttachFacts) -> tuple[int, int]:
    is_new = n["source_status"] == "최초모집"
    complex_name = n["complex_name"] or n["title"]
    sup = supply_rows(facts, complex_name=complex_name, is_new=is_new)
    replace_notice_supply(cur, n["id"], sup)
    units: list[dict[str, Any]] = []
    if n["road_address"]:
        units = unit_rows(facts, complex_name=complex_name, road_address=n["road_address"],
                          sido=n["sido"], sigungu=n["sigungu"] or "")
    if units:
        replace_units(cur, n["id"], units)
        # 민간임대 단지 행에는 complex_code가 없어 replace_units의 코드 조인이 비어 온다 — 공고의 단지(하나)로 잇는다
        cur.execute(
            """
            UPDATE unit u SET notice_complex_id = c.id
              FROM notice_complex c
             WHERE u.notice_id = %(id)s AND u.notice_complex_id IS NULL AND c.notice_id = %(id)s
            """,
            {"id": n["id"]},
        )
    update_notice_attach_facts(
        cur, n["id"],
        min_deposit=facts.min_deposit, max_deposit=facts.max_deposit,
        min_rent=facts.min_rent, max_rent=facts.max_rent,
    )
    update_notice_complex_facts(
        cur, n["id"], min_deposit=facts.min_deposit, min_rent=facts.min_rent,
        area_min=facts.area_min, area_max=facts.area_max,
    )
    return len(sup), len(units)


def run(args) -> Stats:
    stats = Stats()
    started = utc_now()
    cfg = settings()
    http = None if args.cached else ThrottledHttp(delay_sec=cfg.scrape_delay_sec)
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SELECT_SQL, {"board": args.board, "since": args.since_year, "refresh": args.refresh, "limit": args.limit})
            notices = cur.fetchall()
        stats.fetched_rows = len(notices)
        log.info("대상 공고 %d건", len(notices))
        for n in notices:
            key = n["board_id"] or n["slug"]
            dest = CACHE_ROOT / f"{key}.pdf"
            try:
                path = fetch_pdf(http, n["file_url"], dest)
            except Exception as exc:  # noqa: BLE001
                stats.error("download_error", key, exc)
                continue
            if path is None:
                stats.skip("no_cache" if http is None else "not_pdf")
                continue
            try:
                facts = parse_pdf(path)
            except Exception as exc:  # noqa: BLE001
                stats.error("parse_error", key, exc)
                continue
            filled = fill_kind_from_label(facts, n["supply_label"])
            if filled:
                log.info("%s: 표에 특별/일반 구분이 없어 공급호수 머리글에서 %d줄을 채웠다", key, filled)
            if not facts.lines:
                stats.skip("no_table")
                log.info("%s %s: 임대조건 표 없음", key, n["title"][:40])
                continue
            stats.groups += 1
            log.info("%s %s: 줄 %d · 보증금 %s~%s · 임대료 %s~%s · 쪽 %s", key, n["title"][:40], len(facts.lines),
                     facts.min_deposit, facts.max_deposit, facts.min_rent, facts.max_rent, facts.pages)
            if args.dry_run:
                for ln in facts.lines:
                    opts = " ; ".join(f"{o.label} {o.deposit}/{o.rent}" for o in ln.options)
                    log.info("   %s | %s | %s %s | n=%s%s%s | %s", ln.tenant_class, ln.supply_kind, ln.area, ln.supply_type,
                             ln.count, " 예비" if ln.reserve_only else "", f" {ln.room}호" if ln.room else "", opts)
                stats.skip("dry_run")
                continue
            with conn.cursor() as cur:
                cur.execute("SAVEPOINT yt")
                try:
                    ns, nu = load_facts(cur, n, facts)
                    cur.execute("RELEASE SAVEPOINT yt")
                    stats.updated += 1
                    stats.inserted += ns + nu
                    if nu:
                        stats.skip("with_units")
                except Exception as exc:  # noqa: BLE001
                    cur.execute("ROLLBACK TO SAVEPOINT yt")
                    stats.error("load_error", key, exc)
            conn.commit()
        if not args.dry_run:
            with conn.cursor() as cur:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started,
                              calls=http.call_count if http else 0)
            conn.commit()
    finally:
        conn.close()
    return stats


def add_args(ap) -> None:
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--board", default=None, help="게시글 boardId 하나만")
    ap.add_argument("--refresh", action="store_true", help="notice_supply가 이미 있는 공고도 다시 읽는다")
    ap.add_argument("--cached", action="store_true", help="네트워크 없이 pipeline/data/youth/에 받아 둔 PDF만 읽는다")
    ap.add_argument("--since-year", type=int, default=None, help="이 해 이후 게시 공고만")


def main(argv: list[str] | None = None) -> int:
    return stage_main("S3 청년안심주택(민간임대) 첨부 공고문 표", run, add_args=add_args, stage=STAGE, source=SOURCE, argv=argv)


if __name__ == "__main__":
    sys.exit(main())
