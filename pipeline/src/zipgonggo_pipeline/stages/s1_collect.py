"""S1 — 마이홈 모집공고 API → notice · notice_area 적재.

    python -m zipgonggo_pipeline.stages.s1_collect [--dry-run] [--max-pages N] [--page-size N]

매핑은 db/schema.sql의 notice 컬럼 주석 `(API xxx)`를 따른다.
API는 매입임대·전세임대 공고를 시군구별 행으로 쪼개 주므로 pblancId:houseSn 으로 묶어 공고 1행 + notice_area N행으로 만든다.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ..config import settings
from ..db import connect
from ..housing import HOUSING_TYPES, UnmappedHousingType, derive_sector, slug_code
from ..normalize import fingerprint, money, nz, parse_date, today_kst
from ..repo import queue_unmapped
from ..sources.myhome import MyHomeClient
from .common import Stats, finish_ingest, stage_main, upsert_guarded, utc_now

log = logging.getLogger("s1")

STAGE = "S1"
SOURCE = "myhome_api"


# ── 순수 변환 ─────────────────────────────────────────────────


def source_key(item: dict[str, Any]) -> str:
    return f"{item['pblancId']}:{item.get('houseSn', 0)}"


def derive_status(source_status: str | None, begin: date | None, end: date | None, today: date) -> str:
    """notice_status 도출.

    | 조건                                  | 결과       |
    | end 있고 today > end                  | 접수마감   |
    | 원문 상태에 '정정' 포함               | 정정공고중 |
    | begin 있고 today >= begin             | 접수중     |
    | 그 외 (접수 시작 전)                  | 공고중     |
    """
    if end and today > end:
        return "접수마감"
    if source_status and "정정" in source_status:
        return "정정공고중"
    if begin and today >= begin:
        return "접수중"
    return "공고중"


def make_slug(agency: str, posted: date, pblanc_id: str, house_sn: Any, housing_type: str) -> str:
    """/notice/{기관}-{연도}-{공고ID}-{주택일련번호}-{유형}. 차수는 API에 없어 공고ID로 대신한다 (docs/url-structure.md)."""
    agency_seg = agency.lower() if agency.isascii() else agency
    return f"{agency_seg}-{posted.year}-{pblanc_id}-{house_sn}-{slug_code(housing_type)}"


def group_items(items: list[dict[str, Any]]) -> OrderedDict[str, list[dict[str, Any]]]:
    groups: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
    for it in items:
        groups.setdefault(source_key(it), []).append(it)
    return groups


@dataclass
class Mapped:
    notice: dict[str, Any]
    areas: list[dict[str, Any]] = field(default_factory=list)


def map_notice(group: list[dict[str, Any]], today: date) -> Mapped:
    """같은 pblancId:houseSn 행 묶음 → notice 1행 + notice_area."""
    if not group:
        raise ValueError("empty group")
    # 주소가 있는 행을 대표로. 없으면 첫 행
    head = next((it for it in group if nz(it.get("fullAdres"))), group[0])
    housing_type = nz(head.get("suplyTyNm")) or ""
    if housing_type not in HOUSING_TYPES:
        raise UnmappedHousingType(housing_type)

    agency = nz(head.get("suplyInsttNm")) or "미상"
    title = nz(head.get("pblancNm")) or "(제목 없음)"
    posted = parse_date(head.get("rcritPblancDe"))
    if posted is None:
        raise ValueError(f"공고일 없음: {source_key(head)}")
    begin = parse_date(head.get("beginDe"))
    end = parse_date(head.get("endDe"))
    src_status = nz(head.get("sttusNm"))

    # 시군구별 공급호수 합산
    area_sum: OrderedDict[tuple[str, str | None], int] = OrderedDict()
    for it in group:
        key = (nz(it.get("brtcNm")) or agency, nz(it.get("signguNm")))
        area_sum[key] = area_sum.get(key, 0) + int(it.get("sumSuplyCo") or 0)
    sigungus = {k[1] for k in area_sum}
    sigungu = next(iter(sigungus)) if len(sigungus) == 1 else None
    supply_count = sum(area_sum.values()) or None

    amends = f"{b}:{head.get('houseSn', 0)}" if (b := nz(head.get("beforePblancId"))) else None
    notice = {
        "slug": make_slug(agency, posted, str(head["pblancId"]), head.get("houseSn", 0), housing_type),
        "fingerprint": fingerprint(agency, title, posted, head.get("houseSn", 0), amends),
        "source": SOURCE,
        "source_key": source_key(head),
        "amends_source_key": amends,
        "agency": agency,
        "title": title,
        "housing_type": housing_type,
        "sector": derive_sector(housing_type),
        "house_type": nz(head.get("houseTyNm")),
        "sido": nz(head.get("brtcNm")) or "전국",
        "sigungu": sigungu,
        "complex_name": nz(head.get("hsmpNm")),
        "address": nz(head.get("fullAdres")),
        "pnu": nz(head.get("pnu")),
        "heating": nz(head.get("heatMthdNm")),
        "total_household": money(head.get("totHshldCo"), zero_is_null=True),
        "supply_count": supply_count,
        "min_deposit": money(head.get("rentGtn"), zero_is_null=True),
        "min_rent": money(head.get("mtRntchrg"), zero_is_null=True),
        "min_down_payment": money(head.get("enty"), zero_is_null=False),
        "min_interim": money(head.get("prtpay"), zero_is_null=False),
        "min_balance": money(head.get("surlus"), zero_is_null=False),
        "posted_at": posted,
        "apply_start_at": begin,
        "apply_end_at": end,
        "announce_at": parse_date(head.get("przwnerPresnatnDe")),
        "status": derive_status(src_status, begin, end, today),
        "source_status": src_status,
        "source_url": nz(head.get("url")) or nz(head.get("pcUrl")) or "",
        "portal_url": nz(head.get("pcUrl")),
        "contact": nz(head.get("refrnc")),
        "raw": {"items": group},
    }
    areas = [{"sido": k[0], "sigungu": k[1], "supply_count": v or None} for k, v in area_sum.items()]
    return Mapped(notice=notice, areas=areas)


# ── 실행 ───────────────────────────────────────────────────────


def run(*, dry_run: bool, max_pages: int | None, page_size: int) -> Stats:
    cfg = settings()
    client = MyHomeClient(cfg.data_go_kr_key, delay_sec=cfg.scrape_delay_sec, page_size=page_size)
    today = today_kst()
    started = utc_now()
    stats = Stats()

    items = list(client.iter_notices(max_pages=max_pages))
    stats.fetched_rows = len(items)
    groups = group_items(items)
    stats.groups = len(groups)
    log.info("API 호출 %d회 · 수신 %d행 · 공고 %d건", client.call_count, len(items), len(groups))

    conn = None if dry_run else connect()
    try:
        cur = conn.cursor() if conn else None
        for n, (key, group) in enumerate(groups.items(), 1):
            try:
                mapped = map_notice(group, today)
            except UnmappedHousingType as exc:
                stats.unmapped(str(exc))
                if cur:
                    queue_unmapped(cur, key, str(exc), str(group[0].get("pblancNm", "")))
                continue
            except Exception as exc:  # noqa: BLE001
                stats.error("map_error", key, exc)
                continue
            if cur is None:
                continue
            upsert_guarded(cur, stats, key, mapped.notice, mapped.areas)
            if n % 50 == 0:
                conn.commit()
        if conn and cur:
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
            conn.commit()
    finally:
        if conn:
            conn.close()
    return stats


def _add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--page-size", type=int, default=1000)


def main(argv: list[str] | None = None) -> int:
    return stage_main(
        "S1 마이홈 모집공고 수집",
        lambda a: run(dry_run=a.dry_run, max_pages=a.max_pages, page_size=a.page_size),
        add_args=_add_args,
        argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
