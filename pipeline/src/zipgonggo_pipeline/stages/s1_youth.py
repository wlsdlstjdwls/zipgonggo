"""S1-YOUTH — 서울시 청년안심주택 게시판(민간임대) → notice 적재.

    python -m zipgonggo_pipeline.stages.s1_youth [--dry-run] [--max-pages N]

민간임대(sector='민간임대') 축의 첫 소스다. 목록 JSON에 본문이 실려 오므로 상세 요청 없이 한 쪽에 10건씩 읽는다.
「[공공임대]」 글은 SH 공고의 안내문이라 건너뛴다 — 원본은 `s1_ish_board`가 적재한다.
단지가 공고당 하나라 notice_complex에도 한 줄 넣어 두면 S6이 요약DB로 좌표를 맞추고 지도에 뜬다.
"""

from __future__ import annotations

import logging
import sys
from datetime import date, timedelta
from typing import Any

from ..config import settings
from ..db import connect
from ..housing import derive_sector, slug_code
from ..normalize import fingerprint, parse_ymd, today_kst
from ..repo import replace_notice_complexes, update_notice_attach_facts
from ..sources.youth import YouthClient, YouthFacts, YouthPost, parse_facts
from .common import Stats, finish_ingest, stage_main, upsert_guarded, utc_now

log = logging.getLogger("s1.youth")

STAGE = "S1"
SOURCE = "youth_scrape"     # db/schema.sql notice.source 주석에 예약돼 있던 이름
AGENCY = "서울시"           # 게시판 운영 주체. 임대사업자는 contact에
SIDO = "서울특별시"
HOUSING_TYPE = "공공지원민간임대"
ROUND_LABEL = {"1": "최초모집", "2": "추가모집"}
# 마감일을 못 읽었을 때 시작일 뒤 이만큼 지나면 마감으로 본다(청년안심 민간은 보통 2~5일 접수)
ASSUMED_OPEN_DAYS = 7
# 접수 기간이 이보다 길면 본문 날짜를 잘못 읽은 것으로 보고 마감일을 비운다(실측 최대 15일)
MAX_PERIOD_DAYS = 60


def derive_status(start: date | None, end: date | None, today: date) -> str:
    if start is None:
        return "공고중"
    if today < start:
        return "공고중"
    if end is None:
        return "접수중" if today <= start + timedelta(days=ASSUMED_OPEN_DAYS) else "접수마감"
    return "접수중" if today <= end else "접수마감"


def _contact(post: YouthPost, f: YouthFacts) -> str | None:
    parts = [p for p in (f.developer or post.operator, f.phone) if p]
    return " | ".join(parts) or None


def map_post(post: YouthPost, today: date, source_rank: int | None = None) -> tuple[dict[str, Any], YouthFacts]:
    posted = parse_ymd(post.posted)
    if posted is None:
        raise ValueError(f"공고게시일 없음: {post.title}")
    f = parse_facts(post.content_html, base_year=posted.year)
    # 목록의 청약신청일(optn4)이 본문보다 믿을 만하다 — 운영자가 표에 따로 적는 값. 본문은 마감일과 시각을 보탠다
    start = parse_ymd(post.apply_date) or f.apply_start
    end = None
    if start and f.apply_start and f.apply_end:
        # 본문과 목록의 시작일이 다르면 본문 기간 길이를 목록 시작일에 얹는다
        span = (f.apply_end - f.apply_start).days
        if 0 <= span <= MAX_PERIOD_DAYS:  # 음수·수백 일은 오독(연도·월 누락)
            end = start + timedelta(days=span)
    round_label = ROUND_LABEL.get(post.round_code)
    notice = {
        # slug 형식은 불변(URL). 기관 세그먼트는 영어 — CLAUDE.md URL 규칙
        "slug": f"youth-{posted.year}-{post.board_id}-{slug_code(HOUSING_TYPE)}",
        "fingerprint": fingerprint(AGENCY, post.title, posted),
        "source": SOURCE,
        "source_key": f"youth:{post.board_id}",
        "amends_source_key": None,
        "agency": AGENCY,
        "title": post.title,
        "housing_type": HOUSING_TYPE,
        "sector": derive_sector(HOUSING_TYPE),
        "house_type": None,
        "sido": SIDO,
        "sigungu": f.sigungu,
        "complex_name": f.complex_name,
        "address": f.address,
        "pnu": None,
        "heating": None,
        "total_household": f.total_household,
        "supply_count": f.supply_count,
        "min_deposit": None,
        "min_rent": None,
        "min_down_payment": None,
        "min_interim": None,
        "min_balance": None,
        "posted_at": posted,
        "apply_start_at": start,
        "apply_end_at": end,
        "announce_at": f.announce,
        "status": derive_status(start, end, today),
        "source_status": round_label,
        "source_url": post.source_url,
        "portal_url": f.apply_url,     # 사업자 청약 페이지. 화면 라벨은 lib/agency.ts의 서울시 항목
        "contact": _contact(post, f),
        "source_rank": source_rank,
        "raw": {
            "youth_list_row": post.as_dict(), "round": round_label, "file_url": post.file_url,
            "developer": f.developer, "phone": f.phone, "labels": f.labels,
        },
    }
    return notice, f


def complex_rows(notice: dict[str, Any], post: YouthPost) -> list[dict[str, Any]]:
    """단지 한 줄. S6 규약: road_address는 시군구부터(시도는 sido 칸)."""
    name, addr = notice["complex_name"], notice["address"]
    if not name or not addr:
        return []
    road = addr.removeprefix(SIDO).strip()
    return [{
        "name": name, "sido": SIDO, "sigungu": notice["sigungu"], "road_address": road,
        "is_new": post.round_code == "1", "source_page": None, "unit_count": notice["supply_count"],
    }]


def run(*, dry_run: bool, max_pages: int | None) -> Stats:
    cfg = settings()
    client = YouthClient(delay_sec=cfg.scrape_delay_sec)
    today = today_kst()
    started = utc_now()
    stats = Stats()

    posts = list(client.iter_posts(max_pages=max_pages))
    stats.fetched_rows = len(posts)
    stats.groups = len(posts)
    log.info("청년안심주택 게시판 %d행 · 요청 %d회", len(posts), client.call_count)

    conn = None if dry_run else connect()
    try:
        cur = conn.cursor() if conn else None
        for rank, post in enumerate(posts, 1):
            if not post.is_private:
                stats.skip("public_sh_notice")   # SH 공공임대분 — s1_ish_board가 원본을 적재
                continue
            try:
                notice, facts = map_post(post, today, rank)
            except Exception as exc:  # noqa: BLE001
                stats.error("map_error", post.board_id, exc)
                continue
            if not notice["complex_name"]:
                stats.skip("no_complex_name")
            if not notice["apply_start_at"]:
                stats.skip("no_apply_start")
            if cur is None:
                continue
            areas = [{"sido": SIDO, "sigungu": notice["sigungu"], "supply_count": notice["supply_count"]}]
            upsert_guarded(cur, stats, post.board_id, notice, areas)
            cur.execute("SELECT id FROM notice WHERE source_key = %s", (notice["source_key"],))
            row = cur.fetchone()
            if not row:
                continue
            replace_notice_complexes(cur, row["id"], complex_rows(notice, post))
            if facts.apply_start_tm or facts.apply_end_tm:
                update_notice_attach_facts(cur, row["id"], apply_start_tm=facts.apply_start_tm, apply_end_tm=facts.apply_end_tm)
        if conn and cur:
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
            conn.commit()
    finally:
        if conn:
            conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    return stage_main("S1 서울시 청년안심주택(민간임대) 수집", lambda a: run(dry_run=a.dry_run, max_pages=a.max_pages), stage=STAGE, source=SOURCE, argv=argv)


if __name__ == "__main__":
    sys.exit(main())
