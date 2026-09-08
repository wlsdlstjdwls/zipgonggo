"""SH 「단지별 주소」 표 파서 회귀. 정답지: 2026년 2차 행복주택(i-sh seq=309337) 51~52쪽. 네트워크 없음."""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_addr_table import parse_addr_page, parse_addr_table
from zipgonggo_pipeline.parsers.sh_attach import parse_attachment

FIX = Path(__file__).parent / "fixtures" / "ish_309337"
PAGES = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (51, 52)]


@pytest.fixture(scope="module")
def rows():
    return parse_addr_table(PAGES)


def test_row_count(rows):
    # 쪽별 36 + 26. 어긋나면 열 경계(헤더 중심 중간점) 또는 주소 열 우선순위가 깨진 것
    assert len(rows) == 62
    assert len(parse_addr_page(PAGES[0][1], 51)) == 36


def test_addresses_are_seoul(rows):
    assert all(r.sido == "서울특별시" for r in rows)
    assert all(r.sigungu.endswith(("구", "시", "군")) for r in rows)
    # road_address는 시도를 뗀 나머지 — 시군구로 시작한다
    assert all(r.road_address.startswith(r.sigungu) for r in rows)


def test_jibeon_and_road_both_read(rows):
    by = {r.name: r for r in rows}
    # 지번 주소만 있는 단지
    assert by["두산위브더프레스티지(개봉동 199-4)"].road_address == "구로구 개봉동 199-4"
    # 사업주체와 주소가 한 칸에 붙어 온 줄 — 사업주체를 떼고 주소만
    assert by["강동리엔파크11단지"].road_address.startswith("강동구 고덕로98길 101")
    # 사업주체 칸이 "서울특별시"라 그걸 주소로 잡던 회귀
    assert by["디에이치 아너힐즈"].road_address.startswith("강남구 삼성로 11")
    # 같은 표 안에서 시도가 줄임말로 온 줄("서울 은평구 …"). 이 줄을 놓쳐 62곳이 61곳이던 회귀
    assert by["백련산해모로(응암11)"].sido == "서울특별시"
    assert by["백련산해모로(응암11)"].road_address.startswith("은평구 응암로 30길 15")


def test_new_flag(rows):
    assert [r.name for r in rows if r.is_new] == ["창경궁롯데캐슬시그니처(삼선5)"]


def test_dispatcher_picks_addr_table():
    """디스패처가 이 양식을 addr_table로 판정하고 일정도 같이 읽는다."""
    facts = parse_attachment([(1, (FIX / "p1.xml").read_text(encoding="utf-8"))] + PAGES, ref_year=2026)
    assert facts.kind == "addr_table"
    assert len(facts.complexes) == 62
    assert facts.schedule is not None and str(facts.schedule.apply_start) == "2026-09-09"
