"""S1-SH — 서울주거포털 SH 공고 목록 → notice 적재.

    python -m zipgonggo_pipeline.stages.s1_sh [--dry-run] [--max-pages N]

마이홈 API에 SH가 없어(data-sources.md) 이 경로가 서울 공공임대의 유일한 소스다.
목록에는 접수기간이 없다. status는 모집상태(모집중·모집마감)와 제목의 [수정]/[정정]으로 도출한다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import UTC, date, datetime
from typing import Any

from ..config import settings
from ..db import connect
from ..sources.sh import SHClient, SHRow
from .s1_collect import HOUSING_TYPES, Stats, derive_sector, parse_date, queue_unmapped, upsert_notice

log = logging.getLogger("s1.sh")

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
NOT_HOUSING = {"상가임대", "용지분양", "장기안심주택"}


def parse_ymd(s: str) -> date | None:
    s = (s or "").strip()
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
    return parse_date(s.replace("-", "").replace(".", ""))


def derive_status_sh(state: str, title: str, announce: date | None, today: date) -> str:
    if state == "모집마감" or (announce and today > announce and state != "모집중"):
        return "접수마감"
    if "[수정]" in title or "[정정]" in title or "정정" in title[:12]:
        return "정정공고중"
    return "접수중" if state == "모집중" else "공고중"


def clean_title(t: str) -> str:
    return t.replace("-->", "").strip()


def map_sh(row: SHRow, today: date) -> dict[str, Any] | None:
    """SHRow → notice dict. 주택 공급이 아니면 None, 유형 미매핑이면 KeyError."""
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
        "slug": f"sh-{posted.year}-{ident}-{HOUSING_TYPES[housing_type]}",
        "fingerprint": hashlib.sha256(f"{AGENCY}|{title}|{posted.isoformat()}||".encode()).hexdigest(),
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
        "raw": {"sh_list_row": row.as_dict(), "sh_type": row.type_name},
    }


def run(*, dry_run: bool, max_pages: int | None) -> Stats:
    cfg = settings()
    client = SHClient(delay_sec=cfg.scrape_delay_sec)
    today = datetime.now(UTC).astimezone().date()
    started = datetime.now(UTC)
    stats = Stats()

    rows = list(client.iter_rows(max_pages=max_pages))
    stats.fetched_rows = len(rows)
    stats.groups = len(rows)
    log.info("SH 목록 %d행 · 요청 %d회", len(rows), client.call_count)

    conn = None if dry_run else connect()
    try:
        cur = conn.cursor() if conn else None
        for row in rows:
            try:
                mapped = map_sh(row, today)
            except KeyError:
                stats.skip("housing_type_unmapped")
                stats.unmapped_types[row.type_name] = stats.unmapped_types.get(row.type_name, 0) + 1
                if cur:
                    queue_unmapped(cur, f"sh:{row.ish_seq or row.portal_seq}", row.type_name, row.title)
                continue
            except Exception as exc:  # noqa: BLE001
                stats.skip("map_error")
                stats.errors.append(f"{row.no}: {exc}")
                continue
            if mapped is None:
                stats.skip("not_housing")
                continue
            if cur is None:
                continue
            cur.execute("SAVEPOINT row")
            try:
                if upsert_notice(cur, mapped, [{"sido": SIDO, "sigungu": None, "supply_count": None}]):
                    stats.inserted += 1
                else:
                    stats.updated += 1
                cur.execute("RELEASE SAVEPOINT row")
            except Exception as exc:  # noqa: BLE001
                cur.execute("ROLLBACK TO SAVEPOINT row")
                stats.skip("db_error")
                stats.errors.append(f"{row.no}: {exc}")
        if conn and cur:
            message = json.dumps(
                {"calls": client.call_count, "rows": stats.fetched_rows, "inserted": stats.inserted, "updated": stats.updated,
                 "skipped": stats.skipped, "unmapped_types": stats.unmapped_types, "errors": stats.errors[:20]},
                ensure_ascii=False,
            )
            cur.execute(
                "INSERT INTO ingest_log (stage, source, ok, item_count, message, started_at) VALUES ('S1', %s, %s, %s, %s, %s)",
                (SOURCE, not stats.errors, stats.inserted + stats.updated, message, started),
            )
            conn.commit()
    finally:
        if conn:
            conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="S1 SH 서울주거포털 수집")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-pages", type=int, default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    stats = run(dry_run=args.dry_run, max_pages=args.max_pages)
    print(json.dumps(stats.__dict__, ensure_ascii=False, indent=1))
    return 1 if stats.errors else 0


if __name__ == "__main__":
    sys.exit(main())
