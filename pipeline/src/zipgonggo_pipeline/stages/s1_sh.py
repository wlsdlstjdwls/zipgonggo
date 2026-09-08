"""S1-SH — 서울주거포털 SH 공고 목록 → notice 적재.

    python -m zipgonggo_pipeline.stages.s1_sh [--dry-run] [--max-pages N]

마이홈 API에 SH가 없어(data-sources.md) 이 경로가 서울 공공임대의 유일한 소스다.
목록에는 접수기간이 없다. status는 모집상태(모집중·모집마감)와 제목의 [수정]/[정정]으로 도출한다.
"""

from __future__ import annotations

import logging
import sys
from datetime import date
from typing import Any

from ..config import settings
from ..db import connect
from ..housing import derive_sector, slug_code
from ..normalize import fingerprint, parse_ymd, today_kst
from ..repo import queue_unmapped
from ..sources.sh import SHClient, SHRow
from .common import Stats, finish_ingest, stage_main, upsert_guarded, utc_now

log = logging.getLogger("s1.sh")

STAGE = "S1"
SOURCE = "sh_scrape"
AGENCY = "SH"
SIDO = "서울특별시"

# SH 청약유형 → housing_type enum. 도시형생활주택·두레주택·수요자맞춤형은 SH 매입임대의 상품명.
SH_TYPE_MAP: dict[str, str] = {
    "국민공공임대주택": "국민임대",
    "장기전세주택": "장기전세",
    "행복주택": "행복주택",
    "매입임대주택": "매입임대",
    "도시형생활주택": "매입임대",
    "두레주택": "매입임대",
    "수요자맞춤형": "매입임대",
    "재개발임대주택": "재개발임대",
    "전세임대": "전세임대",
    "청년안심주택": "청년안심주택",
    "희망하우징": "공공기숙사",
}
# 주택 공급이 아닌 것. 조용히 건너뛴다.
NOT_HOUSING = frozenset({"상가임대", "용지분양", "장기안심주택"})


def derive_status_sh(state: str, title: str, announce: date | None, today: date) -> str:
    if state == "모집마감" or (announce and today > announce and state != "모집중"):
        return "접수마감"
    if "[수정]" in title or "[정정]" in title or "정정" in title[:12]:
        return "정정공고중"
    return "접수중" if state == "모집중" else "공고중"


def clean_title(t: str) -> str:
    return t.replace("-->", "").strip()


def map_sh(row: SHRow, today: date, source_rank: int | None = None) -> dict[str, Any] | None:
    """SHRow → notice dict. 주택 공급이 아니면 None, 유형 미매핑이면 KeyError.
    source_rank는 원본 목록에서의 순번(1이 맨 위) — 같은 공고일 안 정렬에 쓴다."""
    if row.type_name in NOT_HOUSING:
        return None
    housing_type = SH_TYPE_MAP[row.type_name]  # KeyError → 호출부가 review_queue
    posted = parse_ymd(row.posted)
    if posted is None:
        raise ValueError(f"공고게시일 없음: {row.title}")
    announce = parse_ymd(row.announce)
    title = clean_title(row.title)
    key = f"ish:{row.ish_seq}" if row.ish_seq else f"portal:{row.portal_seq}"
    ident = row.ish_seq or row.portal_seq
    return {
        # slug 형식은 불변(URL). 마이홈 make_slug와 세그먼트 수가 다르다 — SH 목록엔 주택일련번호가 없다
        "slug": f"sh-{posted.year}-{ident}-{slug_code(housing_type)}",
        "fingerprint": fingerprint(AGENCY, title, posted),
        "source": SOURCE,
        "source_key": key,
        "amends_source_key": None,
        "agency": AGENCY,
        "title": title,
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
        "announce_at": announce,
        "status": derive_status_sh(row.state, title, announce, today),
        "source_status": row.state,
        "source_url": row.source_url,
        "portal_url": row.portal_url,
        "contact": f"SH {row.dept}" if row.dept else None,
        "source_rank": source_rank,
        "raw": {"sh_list_row": row.as_dict(), "sh_type": row.type_name},
    }


def run(*, dry_run: bool, max_pages: int | None) -> Stats:
    cfg = settings()
    client = SHClient(delay_sec=cfg.scrape_delay_sec)
    today = today_kst()
    started = utc_now()
    stats = Stats()

    rows = list(client.iter_rows(max_pages=max_pages))
    stats.fetched_rows = len(rows)
    stats.groups = len(rows)
    log.info("SH 목록 %d행 · 요청 %d회", len(rows), client.call_count)

    conn = None if dry_run else connect()
    try:
        cur = conn.cursor() if conn else None
        for rank, row in enumerate(rows, 1):
            try:
                mapped = map_sh(row, today, rank)
            except KeyError:
                stats.unmapped(row.type_name)
                if cur:
                    queue_unmapped(cur, f"sh:{row.ish_seq or row.portal_seq}", row.type_name, row.title)
                continue
            except Exception as exc:  # noqa: BLE001
                stats.error("map_error", row.no, exc)
                continue
            if mapped is None:
                stats.skip("not_housing")
                continue
            if cur is None:
                continue
            upsert_guarded(cur, stats, row.no, mapped, [{"sido": SIDO, "sigungu": None, "supply_count": None}])
        if conn and cur:
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
            conn.commit()
    finally:
        if conn:
            conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    return stage_main("S1 SH 서울주거포털 수집", lambda a: run(dry_run=a.dry_run, max_pages=a.max_pages), argv=argv)


if __name__ == "__main__":
    sys.exit(main())
