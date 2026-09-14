"""SH 청약 결과 표 파서 회귀. 정답지 셋 — 네트워크 없음.

- ish_288199: 2025년 1차 행복주택 청약 접수 결과 (자치구/단지/계층/우선·일반 양식).
  **Synap 텍스트 레이어가 글자를 흘리는 쪽**이라 구멍 감지·되메움·미검증 표시를 여기서 지킨다.
- ish_292457: 2025년 2차 청년안심주택 최종 청약경쟁률 (단지/유형/자격/순위 양식). 39개 블록 전부 산술이 맞는다.
- ish_307073: 2026년 1차 청년 매입임대 경쟁률 (구분/자치구/주소지/주택명/순위 양식). 줄마다 값이 다 있는 납작한 표.
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
    # 7 = 어울채 2 + DMC에코자이 일반·소계 2 + 왕십리자이 3. 고덕온빛채 36S 우선(인터넷 「17」→177 유실, 계 229 = 12 × 19.1)은
    # 계·경쟁률 두 인쇄값이 서로 맞고 그 두 칸에 구멍이 없어 이제 믿는다(2026-09-14, 305877에서 같은 꼴이 많았다)
    assert sum(1 for r in rows_a if not r.reconciled) == 7


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


# ── 매입임대 양식 ──────────────────────────────────────────────────────────

PAGES_C = [(n, (FIX / "ish_307073" / f"p{n}.xml").read_text(encoding="utf-8")) for n in (1, 3)]


@pytest.fixture(scope="module")
def rows_c():
    return parse_competition(PAGES_C)


def test_c_shape(rows_c):
    """줄마다 값이 다 있는 납작한 표. 한 쪽에 73줄씩."""
    assert Counter(r.page for r in rows_c) == {1: 73, 3: 73}
    assert all(r.reconciled for r in rows_c)


def test_c_wide_cell_does_not_bleed(rows_c):
    """「주소지」 칸이 넓어 헤더 중간점으로 경계를 잡으면 주소 끝자락이 「주택명」으로 넘어온다.

    빈 띠(글자가 한 번도 지나지 않는 x 구간)를 경계로 삼아야 「백년빌」이 「3백년빌」이 되지 않는다.
    """
    r = next(r for r in rows_c if r.page == 1 and r.supply_type == "26B")
    assert r.complex_name == "백년빌"
    assert r.sigungu == "강남구"      # 「강남구<재공」처럼 옆 칸이 붙지 않는다
    assert all(len(r.sigungu) <= 5 and r.sigungu.endswith("구") for r in rows_c)


def test_c_all_rows_kept(rows_c):
    """구분 칸의 첫 조각만 보면 옆 칸 「-」(성별)이 먼저 걸려 줄이 통째로 빠진다 — 3쪽 회귀."""
    assert {r.bracket for r in rows_c} <= {"일반1순위", "일반2순위", "일반3순위", "소계"}
    assert len([r for r in rows_c if r.page == 3]) == 73


def test_c_integer_ratio_is_accepted(rows_c):
    """이 양식은 경쟁률을 정수로 반올림해 찍는다 — 105명에 2호면 52.5가 아니라 53."""
    r = next(r for r in rows_c if r.page == 1 and r.complex_name == "백년빌"
             and r.supply_type == "26B" and r.bracket == "일반2순위")
    assert (r.units, r.applicants, r.ratio) == (2, 105, 53.0)
    assert r.reconciled and not r.repaired


# ── 행복주택 2026년 조판 (seq=305877) ───────────────────────────────────────
# 2025년과 표 뼈대는 같은데 셋이 다르다: 「공급구분」 헤더가 한 조각, 우선·일반 없이 「예비자」 한 줄뿐인 블록,
# 계층 「주거급여수급자」가 두 줄로 접힘. 띠를 못 열면 이웃 줄 숫자가 이어 붙어 integer를 넘긴다(적재가 통째로 되돌아갔다).

PAGES_A26 = [(1, (FIX / "ish_305877" / "p1.xml").read_text(encoding="utf-8"))]


@pytest.fixture(scope="module")
def rows_a26():
    return parse_competition(PAGES_A26)


def test_a26_tenant_class_from_single_header(rows_a26):
    assert {r.tenant_class for r in rows_a26} >= {"청년", "대학생", "고령자", "신혼부부"}
    assert "" not in {r.tenant_class for r in rows_a26}


def test_a26_reserve_only_block(rows_a26):
    """「예비자」만 있는 블록은 한 줄 + 소계. 단지경쟁률 칸의 값이 곧 그 줄의 경쟁률이다."""
    r = _find(rows_a26, "래미안개포루체하임", "49", "예비자")
    assert (r.units, r.applicants, r.ratio, r.reconciled) == (6, 126, 21.0, True)
    assert _find(rows_a26, "래미안개포루체하임", "49", "소계").ratio == 21.0
    assert not any(r.complex_name == "래미안개포루체하임" and r.bracket in ("우선", "일반") for r in rows_a26)


def test_a26_no_glued_numbers(rows_a26):
    assert all((r.units or 0) < 100_000 and (r.applicants or 0) < 1_000_000 for r in rows_a26)


def test_a26_ratio_corroborates_total(rows_a26):
    """인터넷 칸이 한 글자를 흘려(「8」+52 ≠ 140) 합이 안 맞아도, 계 140 ÷ 합계 18 = 7.8이 인쇄 경쟁률과 맞으면 믿는다."""
    r = _find(rows_a26, "강일리버파크1단지", "29", "우선")
    assert (r.units, r.applicants, r.ratio, r.reconciled) == (18, 140, 7.8, True)
