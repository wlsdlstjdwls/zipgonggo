"""특화형 매입임대 공고문 파서 회귀. 정답지는 실제 공고문 1쪽 XML(2026-09-10 수집). 네트워크 없음.

값의 정답은 공고문 원문이다 — Synap이 떨어뜨린 글자를 되메운 뒤라야 맞는다(parsers/synap_repair):
보증금 36,750,000 · 임대료 255,000 · 계 33.86 · 주소 「시흥대로88길」 · 접수 마감 2026-09-11.
"""

from datetime import date
from pathlib import Path

from zipgonggo_pipeline.parsers.sh_attach import merge_teukhwa, parse_attachment, teukhwa_facts
from zipgonggo_pipeline.parsers.sh_teukhwa import parse_teukhwa

FIX = Path(__file__).parent / "fixtures"


def pages(name: str, nums=(1,)):
    d = FIX / f"ish_{name}"
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


def test_309802_house():
    """금천구 소담 404호 — 원룸 1호, 보증금 3,675만 원 / 월 25만 5,000원."""
    facts = parse_teukhwa(pages("309802"))
    assert facts is not None
    h = facts.houses[0]
    assert (h.sido, h.sigungu) == ("서울특별시", "금천구")
    assert h.road_address == "금천구 시흥대로88길 18"   # 화면 XML은 「시흥대로8길」 — 8 하나가 떨어진다
    assert (h.name, h.room) == ("소담", "404호")
    assert (h.deposit, h.rent) == (36750000, 255000)
    assert (h.area_exclusive, h.area_common, h.area_total) == (26.29, 7.57, 33.86)
    assert h.units == 1
    assert h.move_in == date(2026, 10, 12)
    assert h.room_layout == "원룸"
    assert facts.tenant_class == "청년"


def test_309802_schedule():
    """서류접수 2026.09.10 ~ 09.11. 마감일의 둘째 「1」이 떨어져 자릿수가 모자란 채로 온다."""
    facts = parse_teukhwa(pages("309802"))
    assert (facts.apply_start, facts.apply_end) == (date(2026, 9, 10), date(2026, 9, 11))


def test_309807_house():
    """강동구 리츠하우스 203호 — 투룸, 보증금 2,898만 원 / 월 58만 9,000원."""
    facts = parse_teukhwa(pages("309807"))
    h = facts.houses[0]
    assert h.road_address == "강동구 구천면로46길 38"
    assert (h.name, h.room, h.rooms) == ("리츠하우스", "203호", 2)
    assert (h.deposit, h.rent) == (28980000, 589000)
    assert (h.area_exclusive, h.area_total) == (54.04, 61.14)
    assert (facts.apply_start, facts.apply_end) == (date(2026, 9, 7), date(2026, 9, 8))


def test_attachment_kind_and_totals():
    """양식을 먼저 가른다 — 다른 양식 파서를 태우면 「공급현황」 요약이 엉뚱한 값을 읽는다."""
    facts = parse_attachment(pages("309802"), ref_year=2026)
    assert facts.kind == "teukhwa"
    assert facts.totals == {"min_deposit": 36750000, "max_deposit": 36750000,
                            "min_rent": 255000, "max_rent": 255000, "supply_count": 1}
    assert facts.complexes[0]["road_address"] == "금천구 시흥대로88길 18"
    assert facts.schedule.apply_end == date(2026, 9, 11)


def test_merge_two_attachments():
    """309807은 첨부가 둘, 주택도 둘이다 — 합치면 금액 범위와 호수가 넓어진다."""
    base = parse_attachment(pages("309807"), ref_year=2026)
    more = teukhwa_facts(pages("309807_att2"))
    assert more is not None
    merged = merge_teukhwa(base, more)
    assert [c["name"] for c in merged.complexes] == ["리츠하우스", "소담빌라"]
    assert merged.totals["supply_count"] == 2
    assert merged.totals["min_deposit"] == 28980000
    assert merged.totals["max_deposit"] == 36750000
    assert merged.totals["max_rent"] == 589000


def test_non_teukhwa_is_none():
    """다른 양식(51차 장기전세 1쪽)에서는 안 걸려야 한다."""
    assert parse_teukhwa(pages("309467")) is None
