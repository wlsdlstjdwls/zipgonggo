"""S1-ISH — i-sh.co.kr 모집공고 게시판 → notice 적재(과거 공고 백필).

    python -m zipgonggo_pipeline.stages.s1_ish_board [--dry-run] [--max-pages N] [--since-year 2015]

서울주거포털(S1-SH)은 2024-09 이후 81건뿐이다. 그 이전 공고는 SH 자체 게시판에만 남아 있고
연도별 아카이브가 검색 자산이라(CLAUDE.md 「하지 말 것 6」) 여기서 메운다.

포털 행이 더 낫다(청약유형·모집상태·발표일이 구조화돼 있다). **이미 있는 `ish:{seq}`는 건드리지 않는다** —
같은 source_key로 upsert하면 포털이 채운 값을 게시판의 빈 값으로 덮어쓴다.

게시판에는 청약유형 열이 없어 유형을 제목에서 뽑는다(parsers.ish_title). 못 가리면 review_queue로 보낸다.
접수기간·발표일은 목록에 없다 — 첨부 파싱(S3)이 채운다.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from ..config import settings
from ..db import connect
from ..housing import derive_sector, slug_code
from ..normalize import fingerprint, parse_ymd
from ..parsers.ish_title import amendment_base, derive_housing_type, is_notice
from ..repo import link_related_post, queue_unmapped
from ..sources.ish_board import BoardNotice, IshBoardClient
from .common import Stats, finish_ingest, stage_main, upsert_guarded, utc_now

log = logging.getLogger("s1.ish_board")

STAGE = "S1"
SOURCE = "ish_board"
AGENCY = "SH"
SIDO = "서울특별시"


def map_board(row: BoardNotice, housing_type: str) -> dict[str, Any]:
    posted = parse_ymd(row.posted)
    if posted is None:
        raise ValueError(f"등록일 없음: {row.title}")
    return {
        # 포털(S1-SH)과 같은 slug 규칙 — 같은 공고가 양쪽에서 오면 URL이 갈리면 안 된다
        "slug": f"sh-{posted.year}-{row.seq}-{slug_code(housing_type)}",
        "fingerprint": fingerprint(AGENCY, row.title, posted),
        "source": SOURCE,
        "source_key": f"ish:{row.seq}",
        "amends_source_key": None,
        "agency": AGENCY,
        "title": row.title,
        "housing_type": housing_type,
        "sector": derive_sector(housing_type),
        "house_type": None,
        "sido": SIDO,
        "sigungu": None,
        "complex_name": None,
        "address": None,
        "pnu": None,
        "heating": None,
        "total_household": None,
        "supply_count": None,
        "min_deposit": None,
        "min_rent": None,
        "min_down_payment": None,
        "min_interim": None,
        "min_balance": None,
        "posted_at": posted,
        "apply_start_at": None,
        "apply_end_at": None,
        "announce_at": None,
        # 게시판에는 모집상태 열이 없다. 과거 공고라 전부 마감으로 두고, 접수기간은 S3가 첨부에서 채운다
        "status": "접수마감",
        "source_status": None,
        "source_url": row.url,
        "portal_url": None,
        "contact": f"SH {row.dept}" if row.dept else None,
        "source_rank": None,
        "raw": {"ish_board_row": row.as_dict()},
    }


def existing_ish_keys(cur) -> set[str]:
    cur.execute("SELECT source_key FROM notice WHERE source_key LIKE 'ish:%%'")
    return {r["source_key"] for r in cur.fetchall()}


def run(*, dry_run: bool, max_pages: int | None, since_year: int | None) -> Stats:
    cfg = settings()
    client = IshBoardClient(delay_sec=cfg.scrape_delay_sec)
    started = utc_now()
    stats = Stats()

    rows = list(client.iter_notices(max_pages=max_pages or 60))
    stats.fetched_rows = len(rows)
    log.info("i-sh 게시판 %d행 · 요청 %d회", len(rows), client.call_count)

    conn = None if dry_run else connect()
    try:
        cur = conn.cursor() if conn else None
        known = existing_ish_keys(cur) if cur else set()
        log.info("이미 있는 ish 공고 %d건 — 건너뛴다", len(known))
        for row in rows:
            if since_year and (row.year or 0) < since_year:
                stats.skip("too_old")
                continue
            base = amendment_base(row.title)
            if base:
                # 자료만 덧붙인 글 — 별도 공고로 만들지 않고 원 공고에 이어 붙인다
                if cur and link_related_post(cur, agency=AGENCY, base_title=base, seq=row.seq, title=row.title):
                    stats.skip("amendment_linked")
                else:
                    stats.skip("amendment_orphan")
                continue
            if not is_notice(row.title):
                stats.skip("not_a_notice")
                continue
            housing_type = derive_housing_type(row.title)
            if housing_type is None:
                stats.unmapped(f"제목미상: {row.title[:40]}")
                if cur:
                    queue_unmapped(cur, f"ish:{row.seq}", "제목에서 유형 미상", row.title)
                continue
            if f"ish:{row.seq}" in known:
                stats.skip("already_from_portal")
                continue
            stats.groups += 1
            try:
                mapped = map_board(row, housing_type)
            except Exception as exc:  # noqa: BLE001
                stats.error("map_error", row.seq, exc)
                continue
            if cur is None:
                continue
            upsert_guarded(cur, stats, row.seq, mapped, [{"sido": SIDO, "sigungu": None, "supply_count": None}])
        if conn and cur:
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
            conn.commit()
    finally:
        if conn:
            conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    def add_args(ap):
        ap.add_argument("--since-year", type=int, default=None, help="이 해부터만 적재(예: 2015)")

    return stage_main(
        "S1 i-sh 게시판 과거 공고 백필",
        lambda a: run(dry_run=a.dry_run, max_pages=a.max_pages, since_year=a.since_year),
        add_args=add_args, argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
