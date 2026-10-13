"""SH 커트라인 표 파서 회귀. 정답지 다섯 — 네트워크 없음. 행 수는 원문 줄을 손으로 센 값이다.

- ish_306770_cut: 제49차 장기전세 최종 커트라인 1쪽. 사업명 | 면적 | 대상 | 당첨자 | 예비자, 병합 없음
- ish_303372_cut: 2025년 재개발임대 당첨자 커트라인 1쪽. 자치구만 세로 병합, 머리글 「신청유형(㎡)」
- ish_285122_cut: 제46차 장기전세 서류심사대상자 커트라인 1쪽. 커트라인 칸 하나, 값이 머리글보다 왼쪽에 붙는다
- ish_280880_cut: 2024년 국민임대 신규단지 서류심사 1쪽. 면적 | 공급유형(우선공급) | 대상, 단지명과 면적이 병합
- ish_308537_cut: 2026년 1차 청년안심 당첨자 커트라인 1~3쪽. 단지명 + 소재지가 세로 병합(블록 첫 줄이 이름보다 위에 온다)
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_cutline import cut_rank, cut_score, parse_cutline

FIX = Path(__file__).parent / "fixtures"


def _load(name: str):
    d = FIX / name
    return parse_cutline([(int(f.stem[1:]), f.read_text(encoding="utf-8")) for f in sorted(d.glob("p*.xml"))])


@pytest.fixture(scope="module")
def janggi():
    return _load("ish_306770_cut")


@pytest.fixture(scope="module")
def jaegaebal():
    return _load("ish_303372_cut")


@pytest.fixture(scope="module")
def janggi_doc():
    return _load("ish_285122_cut")


@pytest.fixture(scope="module")
def gukmin_new():
    return _load("ish_280880_cut")


@pytest.fixture(scope="module")
def youth():
    return _load("ish_308537_cut")


def test_cut_text_numbers():
    assert cut_rank("1순위 22점 미성년자녀1명 전산추첨") == 1
    assert cut_score("1순위 22점 미성년자녀1명 전산추첨") == 22
    assert cut_score("50%이하 1순위 미성년자녀3명 14점") == 14   # 자녀 수 「3명」을 점수로 읽지 않는다
    assert cut_score("전원") is None
    assert cut_rank("10점 무작위 추첨") is None


def test_janggi_flat(janggi):
    assert len(janggi) == 56
    first = janggi[0]
    assert (first.complex_name, first.supply_type, first.tenant_class) == ("강남데시앙파크(서울리츠3호)", "114", "일반")
    assert (first.winner_cut, first.reserve_cut) == ("1순위 23점 미성년자녀1명", "1순위 20점")
    assert (first.winner_rank, first.winner_score, first.reserve_score) == (1, 23, 20)


def test_janggi_reserve_only_row(janggi):
    # 당첨자 칸이 비고 예비자 칸만 있는 줄 — 칸을 x로 가르지 않으면 당첨자 커트라인으로 잘못 간다
    row = next(r for r in janggi if r.complex_name == "금천롯데캐슬골드파크1차")
    assert (row.winner_cut, row.reserve_cut) == ("", "1순위 22점")


def test_janggi_priority_rows(janggi):
    rows = [r for r in janggi if r.complex_name == "디에이치 대치 에델루이"]
    classes = {r.tenant_class: r.winner_cut for r in rows}
    assert classes["장애인"] == "중증장애인 16점"
    assert classes["국가유공자"] == ""      # 커트라인 칸이 빈 줄도 행이다


def test_jaegaebal_merged_gu(jaegaebal):
    assert len(jaegaebal) == 48
    assert {r.sigungu for r in jaegaebal[:3]} == {"강동구"}
    row = next(r for r in jaegaebal if r.complex_name == "미아두산위브트레지움(미아8)")
    assert (row.sigungu, row.supply_type, row.winner_cut, row.reserve_cut) == ("강북구", "39", "1순위 14점", "1순위 13점 추첨")
    # 헤더 「단지번호」 칸의 번호가 단지명에 섞이지 않는다
    assert all(not r.complex_name[0].isdigit() for r in jaegaebal if r.complex_name != "SK북한산시티(미아1-1)")


def test_janggi_document_left_aligned(janggi_doc):
    assert len(janggi_doc) == 34
    first = janggi_doc[0]
    # 「[우선공급]」 꼬리표를 떼고, 대상 「고령자」와 커트라인 「14점」을 가른다
    assert (first.complex_name, first.bracket, first.tenant_class, first.winner_cut) == ("래미안센터피스", "우선", "고령자", "14점")
    assert all(r.reserve_cut == "" for r in janggi_doc)


def test_gukmin_new_bracket_column(gukmin_new):
    assert len(gukmin_new) == 42
    first = gukmin_new[0]
    assert first.complex_name == "고덕강일공공주택지구2단지"
    assert (first.supply_type, first.bracket) == ("29", "우선공급")
    assert first.tenant_class == "만65세이상 직계존속 1년이상 부양자"
    assert first.winner_cut == "50%이하/8점" and first.winner_score == 8


def test_youth_merged_name(youth):
    assert len(youth) == 44
    by = [(r.complex_name, r.supply_type) for r in youth]
    # 블록 첫 줄(19)은 이름 「리마크빌 구의」보다 위에 찍혀 있다 — 블록 중심으로 가른다
    assert by[:3] == [("리마크빌 구의", "19"), ("리마크빌 구의", "39A"), ("리마크빌 구의", "39B")]
    assert ("세이지움 태릉입구역", "59") in by
    tae = next(r for r in youth if r.complex_name == "세이지움 태릉입구역" and r.supply_type == "59")
    assert (tae.sigungu, tae.tenant_class, tae.winner_cut) == ("중랑구", "신혼Ⅱ", "1순위 가점합계 7점")


def test_youth_share_type_and_none(youth):
    share = [r for r in youth if "셰어형" in r.tenant_class]
    assert share and all(r.page == 3 for r in share)
    nobody = [r for r in youth if r.winner_cut == "적격자 없음"]
    assert len(nobody) == 3 and all(r.winner_score is None for r in nobody)
