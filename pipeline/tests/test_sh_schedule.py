"""SH 첨부 공고문 일정 흐름도·공급현황 표 파서 회귀. 정답지는 실제 공고문 쪽 XML. 네트워크 없음."""

from datetime import date
from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_attach import merge_supply_into_complexes
from zipgonggo_pipeline.parsers.sh_schedule import parse_schedule
from zipgonggo_pipeline.parsers.sh_supply import parse_supply, parse_supply_page, SupplySummary

FIX = Path(__file__).parent / "fixtures"


def pages(seq: str, nums):
    d = FIX / f"ish_{seq}"
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


# ── 일정 흐름도 ─────────────────────────────────────────────


def test_schedule_janggi_51():
    """51차 장기전세 1쪽: 1순위 접수 09.14(월) ~ 3·4순위 09.17(목), 당첨자발표 ’27.03.05(금)."""
    s = parse_schedule(pages("309467", [1]), ref_year=2026)
    assert s is not None
    assert s.apply_start == date(2026, 9, 14)
    assert s.apply_end == date(2026, 9, 17)
    assert s.announce == date(2027, 3, 5)


def test_schedule_maeip_ranked_absent():
    """매입임대 4쪽: 순위 없는 「신청접수」 양식. 09.28(월) ~ 09.30(수), 당첨자 발표 12.28(월)."""
    s = parse_schedule(pages("309403", [4]), ref_year=2026)
    assert s is not None
    assert s.apply_start == date(2026, 9, 28)
    assert s.apply_end == date(2026, 9, 30)
    assert s.announce == date(2026, 12, 28)


def test_schedule_none_without_flowchart():
    """일정 흐름도가 없는 쪽(주택 위치 안내 표)에서는 None."""
    assert parse_schedule(pages("309467", [49, 50]), ref_year=2026) is None


# ── 공급현황 표 ─────────────────────────────────────────────


def test_supply_new_page_13():
    """13쪽 신규공급: 계 291호, 단지 9곳. 전세금은 천 원 단위 → 원."""
    s = SupplySummary()
    parse_supply_page((FIX / "ish_309467" / "p13.xml").read_text(encoding="utf-8"), 13, s)
    assert s.unit_total == 291           # 표의 「계 291」과 일치
    assert s.min_deposit == 295_620_000  # 이문3 복합공공청사 43㎡
    assert s.max_deposit == 1_170_000_000  # 청담르엘 59㎡
    names = {c.name: c.unit_count for c in s.complexes}
    assert names["청담르엘"] == 57
    assert names["디에이치방배"] == 133
    assert sum(names.values()) == 291


@pytest.mark.parametrize(
    "page,units,lo,hi",
    [
        (15, 243, 264_420_000, 655_980_000),
        (16, 451, 244_140_000, 730_860_000),
        (17, 152, 306_540_000, 1_193_400_000),  # 계약금(10%) 열을 계로 잘못 읽던 회귀
        (18, 228, 255_060_000, 1_388_400_000),
        (19, 16, 458_640_000, 572_520_000),     # 계·계약금이 한 칸에 붙어 오는 쪽
    ],
)
def test_supply_refill_pages(page, units, lo, hi):
    s = SupplySummary()
    parse_supply_page((FIX / "ish_309467" / f"p{page}.xml").read_text(encoding="utf-8"), page, s)
    assert (s.unit_total, s.min_deposit, s.max_deposit) == (units, lo, hi)


def test_supply_whole_notice():
    s = parse_supply(pages("309467", [13, 15, 16, 17, 18, 19]))
    assert s is not None
    assert s.unit_total == 1381
    assert s.min_deposit == 244_140_000
    assert s.max_deposit == 1_388_400_000


def test_merge_supply_into_complexes():
    """공급현황 단지명을 「주택 위치 안내」 단지 행에 붙인다. 짧은 조각 이름은 안 붙는다."""
    s = parse_supply(pages("309467", [13]))
    rows = [
        {"name": "청담르엘", "unit_count": None, "min_deposit": None, "area_min": None, "area_max": None},
        {"name": "래미안 레벤투스", "unit_count": None, "min_deposit": None, "area_min": None, "area_max": None},
        {"name": "없는단지", "unit_count": None, "min_deposit": None, "area_min": None, "area_max": None},
    ]
    assert merge_supply_into_complexes(rows, s) == 2
    assert rows[0]["unit_count"] == 57
    assert rows[1]["min_deposit"] == 717_600_000
    assert rows[2]["unit_count"] is None
