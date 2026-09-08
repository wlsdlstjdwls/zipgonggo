"""SH 첨부 공고문 → notice_complex 행. 양식별 파서를 순서대로 시도한다.

1. 장기전세·행복주택형: 「주택 위치 안내」 표 (parsers/sh_complex) — 단지명·소재지
2. 매입임대형: 「[별첨1] 주택목록」 회전 표 (parsers/sh_units) — 호실 단위 → 단지코드로 묶음
둘 다 0건이면 빈 목록. 새 양식이 나오면 여기 3번으로 붙인다.
"""

from __future__ import annotations

import logging
from typing import Any

from .sh_complex import parse_location_table
from .sh_units import UnitRow, group_units, parse_unit_pages

log = logging.getLogger(__name__)


def parse_attachment(pages: list[tuple[int, str]]) -> tuple[str, list[dict[str, Any]], list[UnitRow]]:
    """(양식명, notice_complex 행, 호실 행). 호실 행은 아직 DB에 넣지 않고 로그·검수용으로만 돌려준다."""
    rows = parse_location_table(pages)
    if rows:
        return "location_table", [
            {"name": r.name, "sido": r.sido, "sigungu": r.sigungu, "road_address": r.road_address,
             "is_new": r.is_new, "source_page": r.page, "complex_code": None,
             "unit_count": None, "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}
            for r in rows
        ], []
    units = parse_unit_pages(pages)
    if units:
        complexes = group_units(units)
        return "unit_list", [
            {"name": c.name, "sido": c.sido, "sigungu": c.sigungu, "road_address": c.road_address,
             "is_new": False, "source_page": c.page, "complex_code": c.code,
             "unit_count": c.unit_count, "min_deposit": c.min_deposit, "min_rent": c.min_rent,
             "area_min": c.area_min, "area_max": c.area_max}
            for c in complexes
        ], units
    return "none", [], []
