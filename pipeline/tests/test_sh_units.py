"""SH 매입임대 「[별첨1] 주택목록」(회전 표) 파서 회귀. 정답지: 2026년 2차 장기미임대(i-sh seq=309403) 24~25쪽. 네트워크 없음."""

from collections import Counter
from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_attach import parse_attachment
from zipgonggo_pipeline.parsers.sh_units import group_units, parse_unit_pages
from zipgonggo_pipeline.sources.ish import is_rotated, parse_chars

FIX = Path(__file__).parent / "fixtures" / "ish_309403"
PAGES = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (24, 25)]


@pytest.fixture(scope="module")
def units():
    return parse_unit_pages(PAGES)


def test_rotation_detected():
    assert all(is_rotated(parse_chars(xml)) for _, xml in PAGES)


def test_row_count_regression(units):
    # 24쪽 38행 + 25쪽 37행. 연번 1~77 중 손상 행 2개(20·39 — 글자가 두 줄로 찢어짐)는 못 읽는다
    assert len(units) == 75
    assert units[0].seq == 1 and units[-1].seq == 77
    assert len(group_units(units)) == 33


def test_first_and_last_rows(units):
    f = units[0]
    assert (f.code, f.building, f.jibun, f.ho) == ("0001J", "해가온", "개포동 1244-13", "0203")
    assert f.road_address == "강남구 개포로17길 9-12" and f.sigungu == "강남구"
    assert f.area == 24.45 and f.structure == "개방형원룸" and f.elevator == "미설치"
    assert (f.deposit, f.rent, f.deposit_jeonse, f.rent_jeonse, f.deposit_wolse, f.rent_wolse) == (
        15_620_000, 203_600, 44_790_000, 40_700, 6_240_000, 223_100,
    )
    l = units[-1]
    assert (l.code, l.building, l.ho, l.road_address) == ("0024J", "자양에스하임8", "0301", "광진구 뚝섬로52마길 50-8")
    assert l.area == 33.8 and l.deposit == 13_930_000 and l.rent == 181_500


def test_hyphens_and_decimals_restored(units):
    # 하이픈·소수점은 텍스트 레이어에서 상자가 어긋나거나 아예 빠진다. 번지 하이픈 39건, 면적은 소수 둘째 자리
    assert sum("-" in u.road_address for u in units) == 39
    assert all(u.area is not None and 10 < u.area < 200 for u in units)
    # 연번 70은 텍스트 레이어에 공백·쉼표가 통째로 빠진 손상 행이라 금액 6개가 한 덩어리로 온다. 그 1행만 예외
    assert [u.seq for u in units if u.rent_wolse is None] == [70]
    assert [u.seq for u in units if not u.jibun] == [70]


def test_elevator_normalized(units):
    assert set(Counter(u.elevator for u in units)) == {"전체동 설치", "미설치"}


def test_complex_aggregation(units):
    c = next(x for x in group_units(units) if x.code == "0006J")
    assert (c.name, c.road_address, c.unit_count) == ("광채빌라", "강동구 상암로 111", 4)
    assert (c.min_deposit, c.min_rent, c.area_min, c.area_max) == (23_170_000, 301_800, 29.35, 42.39)


def test_dispatcher_picks_unit_list():
    kind, rows, units = parse_attachment(PAGES)
    assert kind == "unit_list" and len(rows) == 33 and len(units) == 75
    assert rows[0]["complex_code"] == "0001J" and rows[0]["unit_count"] == 1 and rows[0]["min_deposit"] == 15_620_000
