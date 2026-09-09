"""결과 글 제목 판별 회귀. 제목은 전부 i-sh 게시판 실물(2026-09-09 수집). 네트워크 없음."""

from datetime import date

import pytest

from zipgonggo_pipeline.parsers.ish_result_title import classify, notice_date

COMPETITION = [
    ("2025년 1차 행복주택 입주자 모집(2025.04.25.공고) 최종 청약 경쟁률 게시", date(2025, 4, 25), "행복주택"),
    ("2025년 2차 청년안심주택(공공임대) 입주자 모집공고(2025. 7. 30.) 최종 청약경쟁률 게시", date(2025, 7, 30), "청년안심주택"),
    ("2026년 2차 청년안심주택(공공임대) 입주자 모집공고(2026.7.31.) 최종 청약경쟁률 게시(첨부파일 재등록)", date(2026, 7, 31), "청년안심주택"),
    ("2026년 1~2인가구를 위한 도시형생활주택(건설형원룸) 잔여세대 입주자 모집공고(26. 8. 5.) 1순위 청약경쟁률 및 2순위 청약안내",
     date(2026, 8, 5), "매입임대"),
]

WINNER = [
    ("제48차 장기전세주택 입주자 모집공고(2025.8.14.) 당첨자 및 예비입주자 발표", date(2025, 8, 14), "장기전세"),
    ("[당첨자발표] 2026년 다자녀 매입임대주택 입주자모집공고(2026. 5. 29.) 당첨자 및 예비자 발표", date(2026, 5, 29), "매입임대"),
    ("2026년 1차 청년안심주택 서류심사대상자 발표(2026.03.31.공고)", date(2026, 3, 31), "청년안심주택"),
    ("2025년 재개발임대주택 예비4차 당첨자 발표(2025.10.24.공고)", date(2025, 10, 24), "재개발임대"),
]

# 발표·합격이 들어가도 사람을 뽑는 글이다. 필터를 풀면 같은 게시판에 섞여 온다
HIRING = [
    "2026년 청년 체험형 인턴 서류전형 합격자 발표 및 면접전형 대상자 안내",
    "서울주택도시개발공사 정비사업본부장 채용 최종 합격자 발표",
    "한시사업 기간제 직원 최종 합격자 발표",
    "주거복지직 대체인력뱅크 상시모집 3회차 채용 면접전형 합격자 발표 및 임용등록 안내",
]

# 결과 표가 없는 뒷절차 글
FOLLOW_UP = [
    "마곡 도전숙(2026.5.4. 공고) 당첨자 사전방문 행사 실시 안내",
    "[당첨자발표] 2025년 전세형 매입임대 예비3차 당첨자 동호배정 및 계약 안내",
    "[당첨자발표] 2025년 2-2차 미리내집(신혼신생아매입임대주택2) 동호배정명단 발표",
]


@pytest.mark.parametrize("title,day,ht", COMPETITION)
def test_competition(title, day, ht):
    got = classify(title)
    assert got is not None and got.kind == "competition"
    assert got.notice_date == day
    assert got.housing_type == ht


@pytest.mark.parametrize("title,day,ht", WINNER)
def test_winner(title, day, ht):
    got = classify(title)
    assert got is not None and got.kind == "winner"
    assert got.notice_date == day
    assert got.housing_type == ht


@pytest.mark.parametrize("title", HIRING)
def test_hiring_excluded(title):
    assert classify(title) is None


@pytest.mark.parametrize("title", FOLLOW_UP)
def test_follow_up_excluded(title):
    assert classify(title) is None


def test_announcement_with_contract_notice_is_kept():
    """발표와 계약안내를 한 글에 묶은 제목은 살린다 — 앞쪽에 결과 표가 붙어 온다."""
    got = classify("[예비1차] 2026년 휘경마을 두레주택 잔여세대 모집공고(26. 5. 13.) 당첨자발표 및 계약 안내")
    assert got is not None and got.kind == "winner"
    assert got.reserve_round == 1


def test_reserve_round():
    assert classify("2025년 3차 청년안심주택(2025. 12. 30. 공고) 예비2차 당첨자 발표").reserve_round == 2
    assert classify("제48차 장기전세주택 입주자 모집공고(2025.8.14.) 당첨자 및 예비입주자 발표").reserve_round is None


def test_two_digit_year_and_bad_date():
    assert notice_date("(26. 8. 5.)") == date(2026, 8, 5)
    assert notice_date("(2026.13.1.)") is None
    assert notice_date("날짜가 없는 제목") is None
