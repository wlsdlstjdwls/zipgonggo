"""SH 스크래퍼 파서·매핑 테스트. 픽스처는 2026-09-08 실제 응답(전체 유형, cp=1)."""

from datetime import date
from pathlib import Path

import pytest

from zipgonggo_pipeline.sources.sh import last_page, parse_list
from zipgonggo_pipeline.stages.s1_sh import SH_TYPE_MAP, derive_status_sh, map_sh

FIXTURE = Path(__file__).parent / "fixtures" / "sh_list_cp1.html"
TODAY = date(2026, 9, 8)


def rows():
    return parse_list(FIXTURE.read_text(encoding="utf-8"))


def test_parse_list_reads_10_rows_with_links():
    rs = rows()
    assert len(rs) == 10
    first = rs[0]
    assert first.no == "81"
    assert first.type_name == "장기전세주택"
    assert first.title.startswith("제51차 장기전세주택")
    assert "-->" not in first.title
    assert first.posted == "2026-08-31" and first.announce == "2027-03-05"
    assert first.state == "모집중"
    assert first.ish_seq == "309467" and first.source_url.startswith("https://www.i-sh.co.kr/")
    assert first.portal_seq == "1" and first.portal_url.startswith("https://housing.seoul.go.kr/site/main/sh/publicLease/view?seq=1")


def test_last_page_from_pagination():
    assert last_page(FIXTURE.read_text(encoding="utf-8")) == 9


def test_all_fixture_types_are_mapped_or_excluded():
    for r in rows():
        assert r.type_name in SH_TYPE_MAP or r.type_name in {"상가임대", "용지분양", "장기안심주택"}


def test_map_sh_row():
    n = map_sh(rows()[0], TODAY)
    assert n is not None
    assert n["source"] == "sh_scrape" and n["agency"] == "SH" and n["sido"] == "서울특별시"
    assert n["source_key"] == "ish:309467"
    assert n["slug"] == "sh-2026-309467-janggi"
    assert n["housing_type"] == "장기전세" and n["sector"] == "공공임대"
    assert n["posted_at"] == date(2026, 8, 31) and n["announce_at"] == date(2027, 3, 5)
    assert n["status"] == "접수중"
    assert n["raw"]["sh_type"] == "장기전세주택"


def test_purchase_subtypes_normalize_to_maeip():
    r = next(x for x in rows() if x.type_name == "도시형생활주택")
    n = map_sh(r, TODAY)
    assert n is not None and n["housing_type"] == "매입임대"


@pytest.mark.parametrize(
    ("state", "title", "announce", "expected"),
    [
        ("모집중", "제51차 장기전세주택 입주자 모집공고", date(2027, 3, 5), "접수중"),
        ("모집마감", "2026년 사당동 공공원룸", date(2026, 4, 28), "접수마감"),
        ("모집중", "[수정] 2026년 사당동 공공원룸", date(2026, 12, 1), "정정공고중"),
        ("모집중", "x", None, "접수중"),
        # i-sh 게시판 글은 state가 항상 빈 문자열이다. 접수를 연기·취소한다는 안내문(첨부·확정 일정 없음)은
        # "공고중"(접수 예정)으로 두면 접수일이 영영 안 채워지는데도 목록에 계속 남는다 — 접수마감 취급
        ("", "2026년 재개발임대주택 입주자 모집 일정 연기 안내", None, "접수마감"),
        ("", "2026년 사당동 공공원룸 모집 취소 안내", None, "접수마감"),
        # state가 있는(포털발) 공고는 실제 접수 여부를 이미 알 수 있으니 이 규칙을 안 탄다
        ("모집중", "OO 접수기간 연기 안내", None, "접수중"),
    ],
)
def test_status_sh(state, title, announce, expected):
    assert derive_status_sh(state, title, announce, TODAY) == expected
