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
RESUPPLY = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (17, 18)]
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


# ── 재공급 표 (2026-09-09) ───────────────────────────────────
# 매입형 재공급(18쪽)은 한 줄이 한 단지라 읽는다. 같은 양식으로 보이지만 열이 어긋나 읽히는 17쪽 윗부분
# (공사 건설형, 단지명이 지구 단위)은 _plausible 검문에서 전부 걸러져야 한다.


@pytest.fixture(scope="module")
def relines():
    names = [r.name for r in parse_location_table(LOC)]
    return parse_jeonse_supply(RESUPPLY, names)


def test_maeip_resupply_rows(relines):
    """매입형 재공급 단지가 살아 나온다 — 이걸 통째로 버려 단지 상세가 비어 있었다."""
    by = {(l.complex_name, l.area_type): l for l in relines}
    assert ("래미안퍼스티지", "84") in by
    l = by[("래미안퍼스티지", "84")]
    assert l.is_new is False
    assert l.units_total == 5
    assert l.deposit == 1_388_400_000
    assert l.area_exclusive == pytest.approx(84.93)
    assert l.area_total == pytest.approx(168.42)
    assert l.heating == "지역난방"


def test_misaligned_rows_are_dropped(relines):
    """17쪽 윗부분(공사 건설형)은 유형 숫자와 전용면적이 안 맞는다 — 한 줄도 나오면 안 된다."""
    for l in relines:
        n = int("".join(ch for ch in l.area_type if ch.isdigit()) or 0)
        assert l.area_exclusive is not None and abs(l.area_exclusive - n) <= 1.5
        assert 5_000_000 <= (l.deposit or 0) <= 5_000_000_000


# ── 공사 건설형 재공급 지구 묶음 (2026-09-10) ───────────────────────
# 15~16쪽은 단지명이 「OO지구」 아래 번호 범위("9~12단지")·쉼표 목록("2,3,5,6,7단지")으로 묶여 있다.
# 실제 단지명은 「단지별 주소」 표(LOC)에 낱개로 있으니 대조해서 펴야 한다 — 전에는 통째로 버려졌다.

DISTRICT_BLOCK = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (15, 16)]


@pytest.fixture(scope="module")
def district_lines():
    names = [r.name for r in parse_location_table(LOC)]
    return parse_jeonse_supply(DISTRICT_BLOCK, names)


def test_district_range_is_expanded(district_lines):
    """「상암월드컵파크9~12단지」 범위 표기가 4개 단지 모두에 같은 전세금으로 펴진다."""
    by_name = {l.complex_name: l for l in district_lines if l.area_type == "84" and l.kind == "일반"}
    members = [f"상암월드컵파크 {n}단지" for n in (9, 10, 11, 12)]
    for name in members:
        assert name in by_name, name
        assert by_name[name].deposit == 500_760_000
        assert by_name[name].heating == "지역난방"
        # 호수는 지구 합계라 단지별로 못 나눈다 — 억지로 안 나누고 비워 둔다
        assert by_name[name].units_total is None


def test_district_comma_list_is_expanded(district_lines):
    """「서초포레스타23567단지」처럼 쉼표를 잃고 붙어 온 목록도 낱개 단지로 펴진다.

    이름과 번호가 서로 다른 줄로 갈리는 경우("서초포레스타" 다음 줄에 "23567단지")까지 포함한다.
    """
    names = {l.complex_name for l in district_lines}
    for n in (2, 3, 5, 6, 7):
        assert f"서초포레스타 {n}단지" in names


def test_district_single_complex_kept(district_lines):
    """번호 묶음이 아닌 단독 단지(세곡지구)는 지구 합계가 아니라 자기 호수를 그대로 갖는다."""
    l = next(l for l in district_lines if l.complex_name == "강남데시앙파크")
    assert l.units_total == 11
    assert l.deposit == 616_980_000
