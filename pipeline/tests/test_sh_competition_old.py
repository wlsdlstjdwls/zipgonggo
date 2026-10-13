"""옛 「청약 경쟁률」 표 회귀(2026-10-13) — 양식 D를 넓힌 것과 범용 파서(sh_competition_flat). 네트워크 없음.

- ish_229829: 제39차 장기전세 최종 접수결과 1쪽. 「신청자수경쟁률」 머리글이 한 조각, 맨 오른쪽 「구분」은 마감 여부
- ish_284025: 제46차 장기전세 접수결과 2쪽. 「신청자수」 머리글이 「신」 「청자수」로 쪼개져 경쟁률 칸 경계가 무너지던 쪽
- ish_218173: 2020년 1차 행복주택 청약경쟁률 1쪽. 단지명, 면적, 계층이 세로 병합. 「계 | 경쟁률」 머리글 줄이 「계」로 시작한다
- ish_276345: 2024년 1차 행복주택 접수 결과 1쪽. 「경쟁률」 묶음 머리글 밑에 우선/단지 경쟁률 두 칸, 「우선 / 일반」 두 줄 구분 머리글
- ish_245422: 2021년 2차 행복주택 접수 결과 1쪽. 「신청현황」 아래 「계」만 있는 신청자 칸, 소수점을 흘린 경쟁률(「557」)
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_competition import parse_competition

FIX = Path(__file__).parent / "fixtures"


def _load(name: str):
    d = FIX / name
    return parse_competition([(int(f.stem[1:]), f.read_text(encoding="utf-8")) for f in sorted(d.glob("p*.xml"))])


def _sub(rows):
    return [r for r in rows if r.bracket == "소계"]


@pytest.mark.parametrize("name,subtotals,ok", [
    ("ish_229829", 32, 30), ("ish_284025", 35, 33), ("ish_218173", 34, 34), ("ish_276345", 11, 6), ("ish_245422", 29, 28),
])
def test_shape(name, subtotals, ok):
    sub = _sub(_load(name))
    assert len(sub) == subtotals
    assert sum(r.reconciled for r in sub) == ok


def test_janggi39_merged_header():
    first = _load("ish_229829")[0]
    assert (first.complex_name, first.supply_type, first.tenant_class, first.bracket) == ("신마곡벽산블루밍", "72", "일반1순위", "일반")
    assert (first.units, first.applicants, first.ratio, first.reconciled) == (4, 133, 33.3, True)


def test_janggi46_split_applicant_header():
    first = _load("ish_284025")[0]
    assert (first.complex_name, first.units, first.applicants, first.ratio, first.reconciled) == ("신이문어울림", 1, 78, 78.0, True)


def test_haengbok2020_merged_labels():
    rows = _load("ish_218173")
    gangil = [r for r in rows if r.complex_name == "강일리버파크11" and r.bracket != "소계"]
    assert [(r.supply_type, r.tenant_class, r.bracket, r.units, r.applicants) for r in gangil[:4]] == [
        ("29", "주거급여수급자", "우선", 10, 27), ("29", "주거급여수급자", "일반", 10, 3),
        ("29", "청년", "우선", 45, 269), ("29", "청년", "일반", 45, 54),
    ]


def test_haengbok2024_lost_digit_is_not_trusted():
    rows = _load("ish_276345")
    # 주거급여수급자 우선: 실제 공급 11호인데 Synap이 「1」로 흘렸다. 인쇄된 경쟁률 17.7과 안 맞아 믿지 않는다
    r = next(r for r in rows if r.tenant_class == "주거급여수급자" and r.bracket == "우선")
    assert (r.units, r.applicants, r.ratio, r.reconciled) == (1, 195, 17.7, False)
    gen = next(r for r in rows if r.tenant_class == "대학생" and r.bracket == "일반")
    # 일반 띠는 경쟁률이 인쇄되지 않는다 — 산술로 채우고 repaired로 단다
    assert (gen.ratio, gen.reconciled, gen.repaired) == (3.9, True, True)


def test_haengbok2021_dot_dropped_ratio():
    first = _load("ish_245422")[0]
    assert (first.complex_name, first.tenant_class, first.bracket, first.ratio, first.repaired) == ("구의자이르네", "대학생", "우선", 55.7, True)
