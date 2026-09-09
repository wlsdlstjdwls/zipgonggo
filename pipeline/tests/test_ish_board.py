"""i-sh 모집공고 게시판 목록 파서 회귀. 픽스처: 2026-09-09 p20(isRecrnoti=Y) = 2020년 공고. 네트워크 없음."""

from pathlib import Path

import pytest

from zipgonggo_pipeline.sources.ish_board import PAGE_SIZE, BoardNotice, parse_board_list

FIX = Path(__file__).parent / "fixtures" / "ish_board_p20.html"


@pytest.fixture(scope="module")
def rows() -> list[BoardNotice]:
    return parse_board_list(FIX.read_text(encoding="utf-8", errors="replace"))


def test_page_is_full(rows):
    assert len(rows) == PAGE_SIZE


def test_every_row_complete(rows):
    for r in rows:
        assert r.seq.isdigit(), r
        assert r.title and r.dept and r.no
        assert len(r.posted) == 10 and r.posted[4] == "-", r.posted
        assert r.url == f"https://www.i-sh.co.kr/main/brd/m_241/view.do?seq={r.seq}"


def test_backfill_reaches_2020(rows):
    """20쪽이 2020년이라는 게 백필 깊이의 근거다 — 서울주거포털은 2024-09까지밖에 안 간다."""
    assert {r.year for r in rows} == {2020}


def test_new_badge_stripped():
    html = """<table><tr><th>번호</th></tr>
    <tr><td>1</td><td><a href="#none" onclick="getDetailView(309467); return false;">NEW 제51차 장기전세주택 입주자 모집공고</a></td>
    <td>주거복지처</td><td>2026-08-31</td><td>1234</td></tr></table>"""
    rows = parse_board_list(html)
    assert len(rows) == 1
    assert rows[0].seq == "309467"
    assert rows[0].title == "제51차 장기전세주택 입주자 모집공고"


def test_no_result_table_is_empty():
    assert parse_board_list("<html><table><tr><td>검색 결과가 없습니다</td></tr></table></html>") == []
