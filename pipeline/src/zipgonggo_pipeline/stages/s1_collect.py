"""S1 — 마이홈 모집공고 API → notice · notice_area 적재.

    python -m zipgonggo_pipeline.stages.s1_collect [--dry-run] [--max-pages N] [--page-size N]

매핑은 db/schema.sql의 notice 컬럼 주석 `(API xxx)`를 따른다.
API는 매입임대·전세임대 공고를 시군구별 행으로 쪼개 주므로 pblancId:houseSn 으로 묶어 공고 1행 + notice_area N행으로 만든다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from ..config import settings
from ..db import connect
from ..sources.myhome import MyHomeClient

log = logging.getLogger("s1")

SOURCE = "myhome_api"

# db/schema.sql housing_type enum과 1:1. 없는 값은 UnmappedHousingType.
HOUSING_TYPES: dict[str, str] = {
    "행복주택": "haengbok",
    "국민임대": "gungmin",
    "매입임대": "maeip",
    "장기전세": "janggi",
    "통합공공임대": "tonghap",
    "전세임대": "jeonse",
    "든든전세": "deundeun",
    "영구임대": "yeonggu",
    "공공지원민간임대": "mingan",
    "50년임대": "50nyeon",
    "10년임대": "10nyeon",
    "6년임대": "6nyeon",
    "5년임대": "5nyeon",
    "공공기숙사": "gisuksa",
    "재개발임대": "jaegaebal",
    "청년안심주택": "cheongnyeon",
}


class UnmappedHousingType(ValueError):
    pass


PRIVATE_HOUSING_TYPES = {"공공지원민간임대"}


def derive_sector(housing_type: str) -> str:
    """공공임대 / 민간임대. 민간 사업자 공급 유형만 민간. 청년안심주택 스크래퍼는 소스에서 고정."""
    return "민간임대" if housing_type in PRIVATE_HOUSING_TYPES else "공공임대"


# ── 순수 변환 ─────────────────────────────────────────────────


def nz(value: Any) -> str | None:
    """빈 문자열·공백은 NULL."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def parse_date(value: Any) -> date | None:
    s = nz(value)
    if s and len(s) == 8 and s.isdigit():
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return None


def money(value: Any, *, zero_is_null: bool) -> int | None:
    """금액. 보증금·월임대료 0은 미기재로 본다(매입·전세임대 219건이 전부 0). 계약금·중도금·잔금 0은 실제 0일 수 있어 유지."""
    if value in (None, ""):
        return None
    n = int(value)
    if n == 0 and zero_is_null:
        return None
    return n


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
    return f"{agency_seg}-{posted.year}-{pblanc_id}-{house_sn}-{HOUSING_TYPES[housing_type]}"


def fingerprint(agency: str, title: str, posted: date, house_sn: Any, amends: str | None = None) -> str:
    """정정공고는 원공고와 제목·게시일이 같아 amends(원공고 키)를 섞는다. 실측 23쌍 전부 이 경우."""
    sn = "" if house_sn in (None, "", 0, "0") else str(house_sn)
    return hashlib.sha256(f"{agency}|{title}|{posted.isoformat()}|{sn}|{amends or ''}".encode()).hexdigest()


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


# ── DB 적재 ───────────────────────────────────────────────────

NOTICE_COLS = [
    "slug", "fingerprint", "source", "source_key", "amends_source_key", "agency", "title",
    "housing_type", "sector", "house_type", "sido", "sigungu", "complex_name", "address", "pnu", "heating",
    "total_household", "supply_count", "min_deposit", "min_rent", "min_down_payment", "min_interim",
    "min_balance", "posted_at", "apply_start_at", "apply_end_at", "announce_at", "status",
    "source_status", "source_url", "portal_url", "contact", "raw",
]
# 재수집 시 갱신하지 않는 것: slug(URL 불변), source, source_key, publish, created_at
_UPDATE_COLS = [c for c in NOTICE_COLS if c not in ("slug", "source", "source_key")]

UPSERT_SQL = (
    f"INSERT INTO notice ({', '.join(NOTICE_COLS)}) VALUES ({', '.join('%(' + c + ')s' for c in NOTICE_COLS)}) "
    "ON CONFLICT (source_key) DO UPDATE SET "
    + ", ".join(f"{c} = EXCLUDED.{c}" for c in _UPDATE_COLS)
    + ", updated_at = now() RETURNING id, (xmax = 0) AS inserted"
)


@dataclass
class Stats:
    fetched_rows: int = 0
    groups: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: dict[str, int] = field(default_factory=dict)
    unmapped_types: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


def upsert_notice(cur, notice: dict[str, Any], areas: list[dict[str, Any]]) -> bool:
    """notice 1행 upsert + notice_area 교체. 소스 공통 (마이홈 API · SH 스크래퍼). True면 신규."""
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


def upsert_group(cur, mapped: Mapped) -> bool:
    return upsert_notice(cur, mapped.notice, mapped.areas)


def queue_unmapped(cur, key: str, housing_type: str, title: str) -> None:
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


def run(*, dry_run: bool, max_pages: int | None, page_size: int) -> Stats:
    cfg = settings()
    client = MyHomeClient(cfg.data_go_kr_key, delay_sec=cfg.scrape_delay_sec, page_size=page_size)
    today = datetime.now(UTC).astimezone().date()
    started = datetime.now(UTC)
    stats = Stats()

    items = list(client.iter_notices(max_pages=max_pages))
    stats.fetched_rows = len(items)
    groups = group_items(items)
    stats.groups = len(groups)
    log.info("API 호출 %d회 · 수신 %d행 · 공고 %d건", client.call_count, len(items), len(groups))

    if dry_run:
        for key, group in groups.items():
            try:
                map_notice(group, today)
            except UnmappedHousingType as exc:
                stats.skip("housing_type_unmapped")
                stats.unmapped_types[str(exc)] = stats.unmapped_types.get(str(exc), 0) + 1
            except Exception as exc:  # noqa: BLE001
                stats.skip("map_error")
                stats.errors.append(f"{key}: {exc}")
        return stats

    conn = connect()
    try:
        with conn.cursor() as cur:
            for n, (key, group) in enumerate(groups.items(), 1):
                try:
                    mapped = map_notice(group, today)
                except UnmappedHousingType as exc:
                    stats.skip("housing_type_unmapped")
                    stats.unmapped_types[str(exc)] = stats.unmapped_types.get(str(exc), 0) + 1
                    queue_unmapped(cur, key, str(exc), str(group[0].get("pblancNm", "")))
                    continue
                except Exception as exc:  # noqa: BLE001
                    stats.skip("map_error")
                    stats.errors.append(f"{key}: {exc}")
                    continue
                cur.execute("SAVEPOINT grp")
                try:
                    if upsert_group(cur, mapped):
                        stats.inserted += 1
                    else:
                        stats.updated += 1
                    cur.execute("RELEASE SAVEPOINT grp")
                except Exception as exc:  # noqa: BLE001
                    cur.execute("ROLLBACK TO SAVEPOINT grp")
                    stats.skip("db_error")
                    stats.errors.append(f"{key}: {exc}")
                if n % 50 == 0:
                    conn.commit()
            conn.commit()
            ok = not stats.errors
            message = json.dumps(
                {
                    "calls": client.call_count, "rows": stats.fetched_rows, "groups": stats.groups,
                    "inserted": stats.inserted, "updated": stats.updated, "skipped": stats.skipped,
                    "unmapped_types": stats.unmapped_types, "errors": stats.errors[:20],
                },
                ensure_ascii=False,
            )
            cur.execute(
                "INSERT INTO ingest_log (stage, source, ok, item_count, message, started_at) VALUES ('S1', %s, %s, %s, %s, %s)",
                (SOURCE, ok, stats.inserted + stats.updated, message, started),
            )
            conn.commit()
    finally:
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="S1 마이홈 모집공고 수집")
    ap.add_argument("--dry-run", action="store_true", help="API 호출·매핑만, DB 쓰기 없음")
    ap.add_argument("--max-pages", type=int, default=None)
    ap.add_argument("--page-size", type=int, default=1000)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    stats = run(dry_run=args.dry_run, max_pages=args.max_pages, page_size=args.page_size)
    print(json.dumps(stats.__dict__, ensure_ascii=False, indent=1))
    return 1 if stats.errors else 0


if __name__ == "__main__":
    sys.exit(main())
