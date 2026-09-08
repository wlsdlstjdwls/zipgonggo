"""SH 장기전세 「공급현황」 신규공급 표 파서 회귀. 정답지: 제51차 장기전세(i-sh seq=309467) 13쪽. 네트워크 없음.

값은 벤치마크(ayounghome) 단지 상세와 대조해 맞춘 것(2026-09-08): 래미안레벤투스 45㎡ = 14호(우선 4 일반 10),
전세금 717,600,000원, 전용 45.98㎡, 공용 63.20㎡(주거공용 22.85 + 기타공용 40.35), 지역난방, 입주 ’27.4.
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_complex import parse_location_table
from zipgonggo_pipeline.parsers.sh_jeonse_supply import parse_jeonse_supply

FIX = Path(__file__).parent / "fixtures" / "ish_309467"
SUPPLY = [(13, (FIX / "p13.xml").read_text(encoding="utf-8"))]
LOC = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (49, 50, 51, 52)]


@pytest.fixture(scope="module")
def lines():
    names = [r.name for r in parse_location_table(LOC)]
    return parse_jeonse_supply(SUPPLY, names)


def test_counts(lines):
    # 신규공급 9개 단지 · 면적별 12줄 · 291호
    assert len(lines) == 12
    assert len({l.complex_name for l in lines}) == 9
    assert sum(l.units_total or 0 for l in lines) == 291
    # 우선공급 합은 14쪽 「우선공급 배정」 표의 계와 같아야 한다
    assert sum(l.units_priority or 0 for l in lines) == 38


def test_names_are_not_clipped(lines):
    """단지명이 헤더 폭을 넘겨 「두산위브더프레스티」로 잘리던 회귀."""
    assert {"두산위브더프레스티지", "이문3 복합공공청사", "영등포자이 디그니티"} <= {l.complex_name for l in lines}


def test_ramian_lebentus(lines):
    a45 = next(l for l in lines if l.complex_name == "래미안레벤투스" and l.area_type == "45")
    assert (a45.units_total, a45.units_general, a45.units_priority) == (14, 10, 4)
    assert (a45.deposit, a45.down_payment, a45.balance) == (717_600_000, 71_760_000, 645_840_000)
    assert (float(a45.area_exclusive), float(a45.area_total)) == (45.98, 109.18)
    assert round(float(a45.area_common) + float(a45.area_etc), 2) == 63.20
    assert a45.heating == "지역난방"
    assert a45.move_in_from == "’27.4"
    assert a45.is_new is True


def test_resupply_table_is_skipped():
    """재공급 표(15~19쪽)는 단지명이 지구 단위로 묶여 있어 읽지 않는다 — 틀린 호수를 붙이느니 비워 둔다."""
    pages = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (15, 16, 17, 18, 19)]
    assert parse_jeonse_supply(pages, []) == []
