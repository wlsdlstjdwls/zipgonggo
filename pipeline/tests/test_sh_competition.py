"""SH 청약 결과 표 파서 회귀. 정답지 둘 — 네트워크 없음.

- ish_288199: 2025년 1차 행복주택 청약 접수 결과 (자치구/단지/계층/우선·일반 양식).
  **Synap 텍스트 레이어가 글자를 흘리는 쪽**이라 구멍 감지·되메움·미검증 표시를 여기서 지킨다.
- ish_292457: 2025년 2차 청년안심주택 최종 청약경쟁률 (단지/유형/자격/순위 양식). 39개 블록 전부 산술이 맞는다.
"""

from collections import Counter
from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_competition import parse_competition

FIX = Path(__file__).parent / "fixtures"
PAGES_A = [(1, (FIX / "ish_288199" / "p1.xml").read_text(encoding="utf-8"))]
PAGES_B = [(n, (FIX / "ish_292457" / f"p{n}.xml").read_text(encoding="utf-8")) for n in (1, 2, 3, 4, 5)]


@pytest.fixture(scope="module")
def rows_a():
    return parse_competition(PAGES_A)


@pytest.fixture(scope="module")
def rows_b():
    return parse_competition(PAGES_B)


def _find(rows, name, supply_type, bracket):
    return next(r for r in rows if r.complex_name == name and r.supply_type == supply_type and r.bracket == bracket)


# ── 행복주택 양식 ──────────────────────────────────────────────────────────


def test_a_shape(rows_a):
    # 블록 13개 × (우선·일반·소계). 줄 수가 어긋나면 띠 나누기가 깨진 것
    assert len(rows_a) == 39
    assert Counter(r.bracket for r in rows_a) == {"우선": 13, "일반": 13, "소계": 13}


def test_a_vertical_merge_restored(rows_a):
    """세로 병합된 자치구·단지명이 제 블록으로 돌아왔나. 고덕온빛채는 블록 4개를 걸친다."""
    assert {r.sigungu for r in rows_a} >= {"강동구", "강북구", "광진구", "서대문구", "성동구", "성북구", "은평구"}
    godeok = [r for r in rows_a if r.complex_name == "고덕온빛채"]
    assert len(godeok) == 12
    assert {r.supply_type for r in godeok} == {"29", "29S", "36", "36S"}
    # 「서대」+「문구」가 두 줄로 접혀 온다 — 이어 붙여야 자치구가 된다
    assert _find(rows_a, "DMC에코자이", "39", "우선").sigungu == "서대문구"


def test_a_split_punctuation(rows_a):
    """소수점·쉼표가 딴 줄에 찍혀도 제자리를 찾나. 「2162」+「,」 → 2,162 / 「721」+「.」 → 72.1"""
    r = _find(rows_a, "고덕온빛채", "29", "우선")
    assert (r.units, r.applicants, r.ratio) == (30, 2162, 72.1)
    assert r.reconciled and not r.repaired
    assert _find(rows_a, "고덕온빛채", "29", "소계").ratio == 34.2


def test_a_hole_repaired_from_intact_cells(rows_a):
    """경쟁률 칸에만 구멍이 나면 접수 계 ÷ 모집호수로 되메운다.

    고덕온빛채 36 청년 소계는 인쇄된 「8.3」이 실제 88.3의 앞자리가 빠진 값이다.
    """
    r = _find(rows_a, "고덕온빛채", "36", "소계")
    assert (r.units, r.applicants) == (38, 3357)
    assert r.ratio == 88.3 and r.repaired and r.reconciled


def test_a_unrepairable_stays_flagged(rows_a):
    """되메울 성한 칸이 없으면 조용히 고치지 않고 미검증으로 남긴다.

    어울채 23 청년은 접수 인터넷(5,444)·계(5,444)·우선경쟁률(777.7) 세 칸이 모두 글자를 흘렸다.
    셋 다 구멍이라 무엇이 참인지 정할 수 없다 — 그럴듯한 오답(77.7)을 싣지 않는 게 요점이다.
    """
    r = _find(rows_a, "어울채", "23", "우선")
    assert not r.reconciled
    assert not _find(rows_a, "어울채", "23", "소계").reconciled
    # 상한선: 이 쪽은 원문이 유난히 상했다. 더 늘면 파서가 퇴행한 것
    assert sum(1 for r in rows_a if not r.reconciled) == 9


# ── 청년안심주택 양식 ──────────────────────────────────────────────────────


def test_b_shape(rows_b):
    assert len(rows_b) == 169
    assert {r.bracket for r in rows_b} <= {"1순위", "2순위", "3순위", "4순위", "5순위", "소계"}
    # 이 문서는 원문이 성해서 한 줄도 어긋나지 않는다
    assert all(r.reconciled for r in rows_b)
    assert not any(r.repaired for r in rows_b)


def test_b_values(rows_b):
    """단지 하나를 원문과 통째로 대조. 20A 청년 62호 — 1순위 140명 2.3 … 소계 4,606명 74.3"""
    got = {r.bracket: (r.units, r.applicants, r.ratio) for r in rows_b if r.complex_name == "퀸즈W 청량리역" and r.supply_type == "20A"}
    assert got == {
        "1순위": (62, 140, 2.3),
        "2순위": (62, 2314, 37.3),
        "3순위": (62, 2152, 34.7),
        "소계": (62, 4606, 74.3),
    }


def test_b_address_gives_sigungu(rows_b):
    """단지명 밑에 접혀 오는 소재지 줄에서 자치구를 뽑는다 — 「(동대문구 전농동 127-359)」"""
    assert all(r.sigungu for r in rows_b)
    assert _find(rows_b, "퀸즈W 청량리역", "20A", "소계").sigungu == "동대문구"


def test_b_tenant_class_not_doubled(rows_b):
    """블록 값이 띠마다 되풀이 인쇄돼도 이어 붙지 않는다 — 「청청년년」 회귀"""
    assert all(r.tenant_class in {"청년", "신혼I", "신혼Ⅰ", "신혼II", "신혼Ⅱ"} for r in rows_b), {r.tenant_class for r in rows_b}
