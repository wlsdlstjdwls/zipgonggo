"""서울시 청년안심주택 게시판 파서·매핑 테스트. 픽스처는 2026-09-15 실제 목록 JSON 1쪽(10행)."""

import json
from datetime import date, time
from pathlib import Path

from zipgonggo_pipeline.sources.youth import parse_facts, parse_location, parse_period, parse_supply, post_from_row
from zipgonggo_pipeline.stages.s1_youth import derive_status, map_post

FIXTURE = Path(__file__).parent / "fixtures" / "youth_list_p1.json"
TODAY = date(2026, 9, 15)


def posts():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [post_from_row(r) for r in data["resultList"]]


def test_fixture_rows_are_private_recruits():
    ps = posts()
    assert len(ps) == 10
    assert all(p.is_private for p in ps)
    first = ps[0]
    assert first.board_id == "6665" and first.posted == "2026-09-10" and first.apply_date == "2026-09-10"
    assert first.round_code == "2" and first.source_url.endswith("boardId=6665&menuNo=400008")
    assert first.file_url.startswith("https://soco.seoul.go.kr/coHouse/cmmn/file/fileDown.do?atchFileId=")


def test_parse_facts_reads_complex_schedule_contact():
    f = parse_facts(posts()[0].content_html, base_year=2026)
    assert f.complex_name == "미아 헤리츠타워"
    assert f.address == "서울특별시 성북구 월계로 38" and f.sigungu == "성북구"
    assert f.total_household == 254 and f.supply_count is None  # 「예비자 모집」
    assert f.developer == "(주)하월곡동대한제43호위탁관리부동산투자회사"
    assert (f.apply_start, f.apply_end) == (date(2026, 9, 10), date(2026, 9, 14))
    assert (f.apply_start_tm, f.apply_end_tm) == (time(17, 0), time(23, 0))
    assert f.apply_url == "https://Heritz-Tower.com" and f.phone == "02-909-4601"


def test_parse_period_variants():
    assert parse_period("‘26. 09. 10. (목) 17:00 ~ 09. 14. (월) 23:00")[:2] == (date(2026, 9, 10), date(2026, 9, 14))
    assert parse_period("‘26. 09. 10. (월) 10:00 ~ 17:00") == (date(2026, 9, 10), date(2026, 9, 10), time(10, 0), time(17, 0))
    assert parse_period("2022.11.21.(월)~2022.11.23.(수) [3일간]")[:2] == (date(2022, 11, 21), date(2022, 11, 23))
    assert parse_period("‘25. 07. 25. (금) 10시 ~ 07. 30. (수) 17시") == (date(2025, 7, 25), date(2025, 7, 30), time(10, 0), time(17, 0))
    assert parse_period("2025년 1월 16일(목) 9시 ~ 17일(금) 18시")[:2] == (date(2025, 1, 16), date(2025, 1, 17))
    # 연도 없이 해가 바뀐 마감일
    assert parse_period("‘25. 12. 30. (화) 10:00 ~ 01. 02. (금) 17:00")[:2] == (date(2025, 12, 30), date(2026, 1, 2))
    assert parse_period(None) == (None, None, None, None)
    assert parse_period("추후 개별 연락")[0] is None


def test_parse_supply_variants():
    assert parse_supply("총 254세대 중 금회 추가모집 공공지원민간임대 예비자 모집") == (254, None)
    assert parse_supply("총  299세대 중 금회 추가모집 공공지원민간임대 3세대 (특별공급 2세대, 일반공급 1세대)") == (299, 3)
    assert parse_supply("총 496세대 중 공공지원 민간임대 409세대(특별공급 82세대, 일반공급 327세대)") == (496, 409)
    assert parse_supply("67호 (특별공급 14호, 일반공급 53호)") == (None, 67)
    assert parse_supply("33B (1세대)     *해당 공급타입의 임대요율은 40%입니다.") == (None, 1)
    assert parse_supply("특별공급  17.75형  1세대/예비자 10세대") == (None, 1)
    assert parse_supply(None) == (None, None)


def test_parse_location_normalises_sido():
    assert parse_location("서울시 강남구 삼성동 140-32 (2호선 선릉역 10번 출구)") == ("서울특별시 강남구 삼성동 140-32", "강남구")
    assert parse_location("서울특별시 관악구 신림동 75-6번지 일원 (2호선 신림역 1번출구)") == ("서울특별시 관악구 신림동 75-6번지 일원", "관악구")


def test_map_post_builds_private_notice():
    n, f = map_post(posts()[0], TODAY)
    assert n["slug"] == "youth-2026-6665-mingan" and n["source_key"] == "youth:6665"
    assert n["source"] == "youth_scrape" and n["agency"] == "서울시"
    assert n["housing_type"] == "공공지원민간임대" and n["sector"] == "민간임대"
    assert n["sido"] == "서울특별시" and n["sigungu"] == "성북구" and n["complex_name"] == "미아 헤리츠타워"
    assert (n["apply_start_at"], n["apply_end_at"]) == (date(2026, 9, 10), date(2026, 9, 14))
    assert n["status"] == "접수마감" and n["source_status"] == "추가모집"
    assert n["portal_url"] == "https://Heritz-Tower.com"
    assert n["contact"] == "(주)하월곡동대한제43호위탁관리부동산투자회사 | 02-909-4601"
    assert "·" not in n["contact"]
    assert n["raw"]["file_url"].endswith("&fileSn=1")


def test_map_post_uses_list_apply_date_over_body():
    # 목록 청약신청일(optn4)이 본문 시작일과 다르면 목록을 믿고 본문 기간 길이만 얹는다
    p = posts()[1]  # 상봉생활: optn4=2026-09-13
    n, f = map_post(p, TODAY)
    assert n["apply_start_at"] == date(2026, 9, 13)
    if f.apply_start and f.apply_end:
        assert n["apply_end_at"] == date(2026, 9, 13) + (f.apply_end - f.apply_start)


def test_derive_status():
    assert derive_status(date(2026, 9, 20), date(2026, 9, 22), TODAY) == "공고중"
    assert derive_status(date(2026, 9, 14), date(2026, 9, 16), TODAY) == "접수중"
    assert derive_status(date(2026, 9, 10), date(2026, 9, 14), TODAY) == "접수마감"
    assert derive_status(date(2026, 9, 12), None, TODAY) == "접수중"      # 마감 모름, 7일 안
    assert derive_status(date(2026, 9, 1), None, TODAY) == "접수마감"     # 마감 모름, 7일 지남
    assert derive_status(None, None, TODAY) == "공고중"
