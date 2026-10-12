"""결과 글 → 원 공고 잇기 규칙(pick_notice_for_result) 회귀. 후보는 2026-10-12 DB 실물을 줄였다. 네트워크·DB 없음."""

from datetime import date

from zipgonggo_pipeline.repo import _round_key, pick_notice_for_result


def n(id_, title, day, ht):
    return {"id": id_, "title": title, "posted_at": day, "housing_type": ht}


def test_round_key():
    assert _round_key("(수정)2023년 1차 청년 매입임대주택 입주자모집공고(2023.06.30.)") == "2023년1차청년매입임대주택"
    assert _round_key("2023년 1차 청년 매입임대주택(2023.06.30.) 인터넷 청약신청 최종 결과 및 경쟁률 공지") == "2023년1차청년매입임대주택"
    assert _round_key("[정정] 2025년 1차 행복주택 입주자 모집공고 (2025. 4. 25. 공고)") == "2025년1차행복주택"


def test_same_day_two_notices_split_by_round_name():
    """같은 날 매입임대 둘(청년 매입, 공공전세) — 제목의 회차 이름으로 가른다."""
    cands = [
        n(1262, "(수정)2023년 1차 청년 매입임대주택 입주자모집공고(2023.06.30.)", date(2023, 6, 30), "매입임대"),
        n(1263, "2023년 1차 공공전세주택 신규 입주자 모집공고(2023.06.30.공고)", date(2023, 6, 30), "매입임대"),
    ]
    got = pick_notice_for_result(cands, notice_date=date(2023, 6, 30), housing_type="매입임대",
                                 title="2023년 1차 청년 매입임대주택(2023.06.30.) 인터넷 청약신청 최종 결과 및 경쟁률 공지")
    assert got == 1262


def test_type_stored_differently_same_day_single():
    """SH 재개발임대 공고가 「국민임대」로 들어와 있다. 같은 날 공고가 하나뿐이면 유형이 달라도 잇는다."""
    cands = [n(1465, "2026년 재개발임대주택 일반모집 공고(2026. 9. 9.)", date(2026, 9, 9), "국민임대")]
    got = pick_notice_for_result(cands, notice_date=date(2026, 9, 9), housing_type="재개발임대",
                                 title="2026년 재개발임대 모집공고(2026.9.9.공고) 1순위 청약접수 결과 및 2순위 청약접수 안내")
    assert got == 1465


def test_result_post_stored_as_notice_is_never_a_candidate():
    """결과 글이 공고로 잘못 들어간 행(제목에 「경쟁률」)을 원 공고로 고르면 안 된다."""
    cands = [n(1143, "2025년 2차 청년안심주택(공공임대) 입주자 모집공고(2025. 7. 30.) 최종 청약경쟁률 게시", date(2025, 7, 30), "청년안심주택")]
    assert pick_notice_for_result(cands, notice_date=date(2025, 7, 30), housing_type="청년안심주택",
                                  title="2025년 2차 청년안심주택(공공임대) 입주자 모집공고(2025. 7. 30.) 최종 청약경쟁률 게시") is None


def test_near_day_needs_same_type():
    cands = [n(5, "2026년 2차 청년안심주택(공공임대) 입주자 모집공고(정정)", date(2026, 7, 31), "청년안심주택"),
             n(6, "[민간임대] 연신내역 루체스테이션 추가모집공고", date(2026, 7, 30), "공공지원민간임대")]
    assert pick_notice_for_result(cands, notice_date=date(2026, 7, 30), housing_type="청년안심주택",
                                  title="2026년 2차 청년안심주택(공공임대) 입주자 모집공고(2026.7.31.) 최종 청약경쟁률 게시") == 5
    assert pick_notice_for_result(cands[1:], notice_date=date(2026, 7, 31), housing_type="청년안심주택", title="x") is None


def test_no_date_needs_round_name():
    """공고일 인용이 없으면 회차 이름과 유형이 맞는 하나일 때만. 날짜만으로는 잇지 않는다."""
    cands = [n(7, "2021년 1차 행복주택 입주자모집공고(2021.05.20.)", date(2021, 5, 20), "행복주택"),
             n(8, "2021년 2차 행복주택 입주자모집공고(2021.12.28.)", date(2021, 12, 28), "행복주택")]
    assert pick_notice_for_result(cands, notice_date=None, housing_type="행복주택",
                                  title="2021년 1차 행복주택 입주자모집공고 경쟁률 게시") == 7
    assert pick_notice_for_result(cands, notice_date=None, housing_type="행복주택", title="행복주택 청약경쟁률 게시") is None
