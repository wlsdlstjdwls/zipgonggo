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


def test_schedule_ignores_note_line():
    """흐름도 아래 「※ 입주예정기간은 2026. 1. 16.(월) ~ 2027. 1. 15.(금)」 주석을 접수기간으로 읽던 회귀.
    실제 신청접수는 09.01(화)~09.03(목)."""
    s = parse_schedule(pages("308887", [3]), ref_year=2026)
    assert s is not None
    assert s.apply_start == date(2026, 9, 1)
    assert s.apply_end == date(2026, 9, 3)


def test_schedule_extra_steps_haengbok():
    """행복주택 1쪽 흐름도에는 접수·당첨자발표 말고도 세 상자가 더 있다(사용자 지적 2026-09-09).
    서류심사 대상자 발표 ’26.9.21.(월) · 서류 제출 ’26.9.28.(월)~9.30.(수) · 계약 체결 ’27.2.10.(수)~2.16.(화)."""
    s = parse_schedule(pages("309337", [1]), ref_year=2026)
    assert s is not None
    assert [(st.label, st.start, st.end) for st in s.steps] == [
        ("서류심사 대상자 발표", date(2026, 9, 21), None),
        ("서류 제출", date(2026, 9, 28), date(2026, 9, 30)),
        ("계약 체결", date(2027, 2, 10), date(2027, 2, 16)),
    ]


def test_schedule_step_drops_weekday_mismatch():
    """Synap이 자릿수를 흘려 ’26.9.11.(금) → ’26 9 1(금)으로 오는 칸이 있다(308887 3쪽 서류심사 대상자 발표).
    괄호 요일이 안 맞는 날짜는 틀린 값을 싣느니 그 단계를 통째로 뺀다."""
    s = parse_schedule(pages("308887", [3]), ref_year=2026)
    assert s is not None
    assert "서류심사 대상자 발표" not in {st.label for st in s.steps}
    assert ("서류 제출", date(2026, 9, 16), date(2026, 9, 18)) in [(st.label, st.start, st.end) for st in s.steps]


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


def test_supply_ignores_conversion_table():
    """보증금↔월세 전환표(자치구|단지|면적|임대보증금|월임대료)는 호수 열이 없어 표로 잡히면 안 된다.
    이 표를 읽어 공급호수가 41만 호로 나오던 회귀(공공주거환경임대 294206 18·19쪽)."""
    s = SupplySummary()
    for page in (18, 19):
        parse_supply_page((FIX / "ish_294206" / f"p{page}.xml").read_text(encoding="utf-8"), page, s)
    assert s.rows == 0
    assert s.unit_total == 0


def test_supply_real_table_in_same_notice():
    """같은 공고의 진짜 공급현황 표(모집세대수|임대보증금)는 읽는다."""
    s = SupplySummary()
    parse_supply_page((FIX / "ish_294206" / "p15.xml").read_text(encoding="utf-8"), 15, s)
    assert s.rows > 0
    assert 0 < s.unit_total < 2000
    assert s.max_deposit is not None and s.max_deposit < 1_000_000_000


def test_supply_ignores_unit_comparison_table():
    """호실별 「임대보증금(원)」이 두 세트로 나오는 재공급 현황표는 공급현황 표가 아니다.
    원 단위를 천 원으로 읽어 보증금이 30억으로 나오던 회귀(304925 4쪽)."""
    s = SupplySummary()
    parse_supply_page((FIX / "ish_304925" / "p4.xml").read_text(encoding="utf-8"), 4, s)
    assert s.rows == 0


def test_supply_does_not_count_total_households():
    """「총세대수」는 단지 전체 세대수라 공급호수가 아니다. 금액만 읽고 호수는 세지 않는다(306205 3쪽)."""
    s = SupplySummary()
    parse_supply_page((FIX / "ish_306205" / "p3.xml").read_text(encoding="utf-8"), 3, s)
    assert s.rows > 0
    assert s.unit_total == 0
    assert s.min_deposit == 18_710_000


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
