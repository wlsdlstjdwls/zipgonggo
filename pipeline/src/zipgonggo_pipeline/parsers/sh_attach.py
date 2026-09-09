"""SH 첨부 공고문 → notice_complex 행 + 공고 단위 사실(접수 일정·전세금 범위·호수). 양식별 파서를 순서대로 시도한다.

단지 표(순서대로 시도, 먼저 걸리는 양식을 쓴다):
1. 장기전세: 「주택 위치 안내」 표 (parsers/sh_complex) — 단지명·소재지. 신규공급 단지는 「공급현황」 표(parsers/sh_jeonse_supply)에서 호수·전세금·면적·난방까지
2. 행복주택·국민임대: 「단지별 주소」 표 (parsers/sh_addr_table) — 공급구분·공급단지·사업주체·주소·난방방식
3. 매입임대: 「[별첨1] 주택목록」 회전 표 (parsers/sh_units) — 호실 단위 → 단지코드로 묶음
전부 0건이면 빈 목록. 새 양식이 나오면 여기 4번으로 붙인다.

공고 단위(양식과 무관하게 항상 시도):
- 접수 시작·마감·당첨자 발표 — 「입주자 모집 절차 및 일정」 흐름도 (parsers/sh_schedule)
- 전세금 최소·최대, 총 호수, 신규공급 단지별 호수·금액·면적 — 「공급현황」 표 (parsers/sh_supply)
- 단지 × 공급유형 × 공급대상 한 줄씩(공가·예비자·계약면적·계층별 금액) — 「공급현황」 표 (parsers/sh_supply_lines).
  행복주택·국민임대 양식 전용. 단지 목록보다 알갱이가 잘아 단지 행에 호수·금액·면적을 되먹인다.
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
from .sh_jeonse_supply import JeonseLine, parse_jeonse_supply
from .sh_supply_lines import SupplyLine, parse_supply_lines
from .sh_units import UnitRow, group_units, parse_unit_pages

log = logging.getLogger(__name__)


@dataclass
class AttachmentFacts:
    kind: str
    complexes: list[dict[str, Any]] = field(default_factory=list)
    units: list[UnitRow] = field(default_factory=list)
    schedule: Schedule | None = None
    supply: SupplySummary | None = None
    supply_lines: list[SupplyLine] = field(default_factory=list)
    jeonse_lines: list[JeonseLine] = field(default_factory=list)
    #: 공고 단위 금액·호수. 「공급현황」 줄이 있으면 그걸로 채운다 — 요약(parse_supply)보다 정확하다
    totals: dict[str, int | None] = field(default_factory=dict)


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


def merge_supply_lines_into_complexes(rows: list[dict[str, Any]], lines: list[SupplyLine]) -> int:
    """공급현황 줄을 단지 행에 이름으로 묶어 호수·금액·면적을 채운다. 돌려주는 값은 채운 단지 수.

    호수는 (공급유형, 공급대상)마다 한 번만 센다 — 청년은 소득있음/소득없음 두 줄이 같은 호수 칸을 나눠 쓴다.
    """
    if not lines:
        return 0
    by_name: dict[str, list[SupplyLine]] = {}
    for l in lines:
        by_name.setdefault(_norm_name(l.complex_name), []).append(l)
    hit = 0
    for r in rows:
        mine = by_name.get(_norm_name(r["name"]))
        if not mine:
            continue
        counted: dict[tuple[str, str], int] = {}
        for l in mine:
            if l.units_total is not None:
                counted[(l.supply_type, l.tenant_class)] = l.units_total
        deposits = [l.deposit for l in mine if l.deposit]
        rents = [l.rent for l in mine if l.rent]
        areas = [l.area_exclusive for l in mine if l.area_exclusive]
        r["unit_count"] = sum(counted.values()) or None
        r["min_deposit"] = min(deposits) if deposits else None
        r["min_rent"] = min(rents) if rents else None
        r["area_min"] = min(areas) if areas else None
        r["area_max"] = max(areas) if areas else None
        hit += 1
    return hit


def merge_jeonse_lines_into_complexes(rows: list[dict[str, Any]], lines: list[JeonseLine]) -> int:
    """장기전세 신규공급 표의 면적별 줄을 단지 행에 묶는다. 돌려주는 값은 채운 단지 수."""
    if not lines:
        return 0
    by_name: dict[str, list[JeonseLine]] = {}
    for l in lines:
        by_name.setdefault(_norm_name(l.complex_name), []).append(l)
    hit = 0
    for r in rows:
        mine = by_name.get(_norm_name(r["name"]))
        if not mine:
            continue
        deposits = [l.deposit for l in mine if l.deposit]
        areas = [l.area_exclusive for l in mine if l.area_exclusive]
        r["unit_count"] = sum(l.units_total or 0 for l in mine) or None
        r["min_deposit"] = min(deposits) if deposits else None
        r["area_min"] = min(areas) if areas else None
        r["area_max"] = max(areas) if areas else None
        r["heating"] = next((l.heating for l in mine if l.heating), r.get("heating"))
        hit += 1
    return hit


def totals_from_supply_lines(lines: list[SupplyLine]) -> dict[str, int | None]:
    """「공급현황」 줄 → 공고 단위 금액 범위와 총 호수.

    호수는 (단지, 공급유형, 공급대상)마다 한 칸이다 — 청년 소득있음/없음 두 줄이 같은 칸을 나눠 쓰므로
    그대로 더하면 두 배가 된다. 2026년 2차 행복주택(309337)에서 이렇게 세면 공고문 머리의 「총 1,484호」와 맞는다.
    """
    if not lines:
        return {}
    counted: dict[tuple[str, str, str], int] = {}
    for l in lines:
        if l.units_total is not None:
            counted[(l.complex_name, l.supply_type, l.tenant_class)] = l.units_total
    deposits = [l.deposit for l in lines if l.deposit]
    rents = [l.rent for l in lines if l.rent]
    total = sum(counted.values())
    return {
        "min_deposit": min(deposits) if deposits else None,
        "max_deposit": max(deposits) if deposits else None,
        "min_rent": min(rents) if rents else None,
        "max_rent": max(rents) if rents else None,
        "supply_count": total or None,
    }


def parse_attachment(pages: list[tuple[int, str]], *, ref_year: int | None = None) -> AttachmentFacts:
    rows = parse_location_table(pages)
    facts: AttachmentFacts
    if rows:
        facts = AttachmentFacts("location_table", [
            {"name": r.name, "sido": r.sido, "sigungu": r.sigungu, "road_address": r.road_address,
             "is_new": r.is_new, "source_page": r.page, "complex_code": None, "heating": None, "zone": r.district,
             "unit_count": None, "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}
            for r in rows
        ])
        try:
            facts.jeonse_lines = parse_jeonse_supply(pages, [r.name for r in rows])
        except Exception as exc:  # noqa: BLE001
            log.warning("jeonse supply parse failed: %s", exc)
    else:
        addrs = parse_addr_table(pages)
        if addrs:
            facts = AttachmentFacts("addr_table", [
                {"name": r.name, "sido": r.sido, "sigungu": r.sigungu, "road_address": r.road_address,
                 "is_new": r.is_new, "source_page": r.page, "complex_code": None, "heating": r.heating,
                 "unit_count": None, "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}
                for r in addrs
            ])
            facts.schedule = parse_schedule(pages, ref_year)
            try:
                facts.supply = parse_supply(pages)
            except Exception as exc:  # noqa: BLE001
                log.warning("supply parse failed: %s", exc)
            try:
                facts.supply_lines = parse_supply_lines(pages, [r.name for r in addrs])
            except Exception as exc:  # noqa: BLE001
                log.warning("supply lines parse failed: %s", exc)
            # 「공급현황」 줄이 있으면 그쪽이 더 정확하다(단지별 호수·계층별 금액). 없을 때만 공고 단위 요약을 쓴다
            if not merge_supply_lines_into_complexes(facts.complexes, facts.supply_lines):
                merge_supply_into_complexes(facts.complexes, facts.supply)
            # 공고 단위 금액·호수도 줄에서 낸다. parse_supply는 장기전세 표를 겨냥한 파서라
            # 행복주택 양식에서는 신규공급 표 일부만 읽어 96호처럼 크게 어긋난 값이 나왔다(2026-09-09)
            facts.totals = totals_from_supply_lines(facts.supply_lines)
            if not facts.totals and facts.supply:
                facts.totals = {"min_deposit": facts.supply.min_deposit, "max_deposit": facts.supply.max_deposit,
                                "supply_count": facts.supply.unit_total or None}
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
    if facts.supply and not facts.totals:
        facts.totals = {"min_deposit": facts.supply.min_deposit, "max_deposit": facts.supply.max_deposit,
                        "supply_count": facts.supply.unit_total or None}
    if facts.kind in ("location_table", "addr_table"):
        # 신규공급 단지는 면적별 줄이 더 정확하다. 나머지는 공고 단위 요약으로 채운다
        merged = merge_jeonse_lines_into_complexes(facts.complexes, facts.jeonse_lines)
        merged += merge_supply_into_complexes(
            [r for r in facts.complexes if r.get("unit_count") is None], facts.supply)
        if merged:
            log.info("공급현황 표 → 단지 %d건에 호수·금액 붙임", merged)
    return facts
