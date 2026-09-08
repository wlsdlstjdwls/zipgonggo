"""SH 첨부 공고문 → notice_complex 행 + 공고 단위 사실(접수 일정·전세금 범위·호수). 양식별 파서를 순서대로 시도한다.

단지 표(순서대로 시도, 먼저 걸리는 양식을 쓴다):
1. 장기전세: 「주택 위치 안내」 표 (parsers/sh_complex) — 단지명·소재지
2. 행복주택·국민임대: 「단지별 주소」 표 (parsers/sh_addr_table) — 공급구분·공급단지·사업주체·주소·난방방식
3. 매입임대: 「[별첨1] 주택목록」 회전 표 (parsers/sh_units) — 호실 단위 → 단지코드로 묶음
전부 0건이면 빈 목록. 새 양식이 나오면 여기 4번으로 붙인다.

공고 단위(양식과 무관하게 항상 시도):
- 접수 시작·마감·당첨자 발표 — 「입주자 모집 절차 및 일정」 흐름도 (parsers/sh_schedule)
- 전세금 최소·최대, 총 호수, 신규공급 단지별 호수·금액·면적 — 「공급현황」 표 (parsers/sh_supply)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from .sh_addr_table import parse_addr_table
from .sh_complex import parse_location_table
from .sh_schedule import Schedule, parse_schedule
from .sh_supply import SupplySummary, parse_supply
from .sh_units import UnitRow, group_units, parse_unit_pages

log = logging.getLogger(__name__)


@dataclass
class AttachmentFacts:
    kind: str
    complexes: list[dict[str, Any]] = field(default_factory=list)
    units: list[UnitRow] = field(default_factory=list)
    schedule: Schedule | None = None
    supply: SupplySummary | None = None


def _norm_name(s: str) -> str:
    return re.sub(r"[\s,·・()\[\]]", "", s.replace("[신규]", ""))


def merge_supply_into_complexes(rows: list[dict[str, Any]], supply: SupplySummary | None) -> int:
    """공급현황 표의 단지별 호수·금액·면적을 단지 행에 이름으로 붙인다. 돌려주는 값은 붙인 행 수.
    이름은 공백·괄호를 뗀 뒤 같거나, 표 쪽 이름이 6자 이상이면서 한쪽이 다른 쪽을 포함하면 같은 단지로 본다.
    (표에서 단지명이 두 줄로 쪼개져 "시그니처"처럼 조각만 잡히는 공고가 있어 짧은 이름은 붙이지 않는다)"""
    if not supply or not supply.complexes:
        return 0
    hit = 0
    for r in rows:
        key = _norm_name(r["name"])
        for c in supply.complexes:
            ck = _norm_name(c.name)
            if not ck or not key:
                continue
            same = key == ck or (len(ck) >= 6 and (ck in key or key in ck))
            if not same:
                continue
            r["unit_count"] = c.unit_count
            r["min_deposit"] = c.min_deposit
            r["area_min"] = c.area_min
            r["area_max"] = c.area_max
            hit += 1
            break
    return hit


def parse_attachment(pages: list[tuple[int, str]], *, ref_year: int | None = None) -> AttachmentFacts:
    rows = parse_location_table(pages)
    facts: AttachmentFacts
    if rows:
        facts = AttachmentFacts("location_table", [
            {"name": r.name, "sido": r.sido, "sigungu": r.sigungu, "road_address": r.road_address,
             "is_new": r.is_new, "source_page": r.page, "complex_code": None,
             "unit_count": None, "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}
            for r in rows
        ])
    else:
        addrs = parse_addr_table(pages)
        if addrs:
            facts = AttachmentFacts("addr_table", [
                {"name": r.name, "sido": r.sido, "sigungu": r.sigungu, "road_address": r.road_address,
                 "is_new": r.is_new, "source_page": r.page, "complex_code": None,
                 "unit_count": None, "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}
                for r in addrs
            ])
            facts.schedule = parse_schedule(pages, ref_year)
            try:
                facts.supply = parse_supply(pages)
            except Exception as exc:  # noqa: BLE001
                log.warning("supply parse failed: %s", exc)
            merge_supply_into_complexes(facts.complexes, facts.supply)
            return facts
        units = parse_unit_pages(pages)
        if units:
            complexes = group_units(units)
            facts = AttachmentFacts("unit_list", [
                {"name": c.name, "sido": c.sido, "sigungu": c.sigungu, "road_address": c.road_address,
                 "is_new": False, "source_page": c.page, "complex_code": c.code,
                 "unit_count": c.unit_count, "min_deposit": c.min_deposit, "min_rent": c.min_rent,
                 "area_min": c.area_min, "area_max": c.area_max}
                for c in complexes
            ], units)
        else:
            facts = AttachmentFacts("none")
    try:
        facts.schedule = parse_schedule(pages, ref_year)
    except Exception as exc:  # noqa: BLE001 — 일정은 부가 정보. 파서가 깨져도 단지 표는 살린다
        log.warning("schedule parse failed: %s", exc)
    try:
        facts.supply = parse_supply(pages)
    except Exception as exc:  # noqa: BLE001
        log.warning("supply parse failed: %s", exc)
    if facts.kind in ("location_table", "addr_table"):
        merged = merge_supply_into_complexes(facts.complexes, facts.supply)
        if merged:
            log.info("공급현황 표 → 단지 %d건에 호수·금액 붙임", merged)
    return facts
