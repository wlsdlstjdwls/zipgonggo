"""SH 「공급현황」 표(행복주택 양식) 파서 회귀. 정답지: 2026년 2차 행복주택(i-sh seq=309337) 11~15쪽. 네트워크 없음.

11쪽이 [신규 공급](입주시작 예정 열이 있고 예비입주자 열이 없다), 12~15쪽이 [재공급].
합계 검산: 공고문 머리글의 「공급현황 : 총 1484호」와 호수 합이 같아야 한다.
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_addr_table import parse_addr_table
from zipgonggo_pipeline.parsers.sh_attach import parse_attachment
from zipgonggo_pipeline.parsers.sh_supply_lines import parse_supply_lines

FIX = Path(__file__).parent / "fixtures" / "ish_309337"
SUPPLY_PAGES = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (11, 12, 13, 14, 15)]
ADDR_PAGES = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (51, 52)]


@pytest.fixture(scope="module")
def names():
    return [r.name for r in parse_addr_table(ADDR_PAGES)]


@pytest.fixture(scope="module")
def lines(names):
    return parse_supply_lines(SUPPLY_PAGES, names)


def test_counts(lines):
    # 금액 줄 106건 = 공급 82건 + 청년 소득있음/소득없음으로 갈린 24건
    assert len(lines) == 106
    assert len({(l.complex_name, l.supply_type, l.tenant_class) for l in lines}) == 82
    assert len({l.complex_name for l in lines}) == 62


def test_unit_total_matches_notice_header(lines):
    """호수 칸은 청년 소득있음/없음 두 줄이 나눠 쓴다 — 한 번만 세야 공고문의 총 1484호와 맞는다."""
    counted = {(l.supply_type, l.tenant_class, l.complex_name): l.units_total for l in lines if l.units_total is not None}
    assert sum(counted.values()) == 1484


def test_all_names_come_from_addr_table(names, lines):
    """단지명 칸이 세로 병합이라 조각으로 온다. 「단지별 주소」 표 이름과 하나도 어긋나면 안 된다."""
    assert {l.complex_name for l in lines} == set(names)


def test_reсupply_row(lines):
    """재공급 줄 한 건 전수 검산 — ayounghome 상세와 맞춰 본 값(2026-09-08)."""
    (s,) = [l for l in lines if l.complex_name == "공덕SK리더스뷰2단지"]
    assert (s.supply_type, s.tenant_class, s.income_option) == ("40", "신혼부부", None)
    assert (s.units_total, s.units_priority, s.units_general, s.units_reserve) == (22, 4, 5, 13)
    assert s.units_vacant == 9
    assert (s.deposit, s.down_payment, s.balance, s.rent) == (125_600_000, 25_120_000, 100_480_000, 493_000)
    assert (float(s.area_exclusive), float(s.area_total)) == (40.70, 99.36)
    assert round((s.area_common or 0) + (s.area_etc or 0), 2) == 58.66
    assert s.is_new is False


def test_new_supply_rows(lines):
    """신규 공급 표는 예비입주자 열이 없고 입주시작(예정)이 붙는다. 「’27.5」의 따옴표·마침표는 다른 줄로 빠진다."""
    new = [l for l in lines if l.is_new]
    assert {l.complex_name for l in new} == {"두산위브더프레스티지(개봉동 199-4)", "창경궁롯데캐슬시그니처(삼선5)"}
    assert all(l.units_reserve is None for l in new)
    assert {l.move_in_from for l in new} == {"’27.4", "’27.5"}
    # 창경궁은 39㎡ 하나에 청년(소득 2줄)·신혼부부·고령자가 붙는다 — 세로 병합 복원 확인
    ccg = [l for l in new if l.complex_name.startswith("창경궁")]
    assert {l.supply_type for l in ccg} == {"39"}
    assert sorted({l.tenant_class for l in ccg}) == ["고령자", "신혼부부", "청년"]


def test_income_option_split(lines):
    """청년은 소득있음/소득없음 두 줄이고 호수 칸은 공유, 금액만 다르다."""
    y = [l for l in lines if l.complex_name == "강동리엔파크11단지" and l.tenant_class == "청년"]
    assert sorted(l.income_option for l in y) == ["소득없음", "소득있음"]
    assert {l.units_total for l in y} == {6}
    assert {l.rent for l in y} == {340_000, 321_000}


def test_dispatcher_fills_complex_rows():
    """디스패처가 공급현황 줄을 읽어 단지 행의 호수·금액·면적까지 채운다."""
    facts = parse_attachment(SUPPLY_PAGES + ADDR_PAGES, ref_year=2026)
    assert facts.kind == "addr_table"
    assert len(facts.supply_lines) == 106
    by = {r["name"]: r for r in facts.complexes}
    assert by["공덕SK리더스뷰2단지"]["unit_count"] == 22
    assert by["공덕SK리더스뷰2단지"]["min_rent"] == 493_000
    # 강동리엔파크11단지: 청년 29㎡ 6호 + 고령자 29S 27호. 청년 두 줄을 두 번 세면 39가 된다
    assert by["강동리엔파크11단지"]["unit_count"] == 33
    assert by["백련산해모로(응암11)"]["heating"] == "개별난방"
