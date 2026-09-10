"""포털이 준 i-sh seq가 정정공고로 어긋날 때 되찾는 길 — 회귀.

실측 2026-09-10: 「2026년 2차 장기미임대」는 포털이 310046을, i-sh는 310107을 들고 있었다.
포털은 원 공고의 seq에 머물고 i-sh는 정정본을 새 글로 올려 seq가 갈린다.
"""

import pytest

from zipgonggo_pipeline.sources.ish import is_missing_page, short_view_url
from zipgonggo_pipeline.sources.ish_board import title_key

BASE = "https://www.i-sh.co.kr"


@pytest.mark.parametrize(("given", "want"), [
    # 포털 목록이 주는 긴 경로 — 없는 seq면 목록 페이지 166KB를 조용히 돌려준다
    (f"{BASE}/main/lay2/program/S1T294C295/www/brd/m_241/view.do?seq=310046",
     f"{BASE}/main/brd/m_241/view.do?seq=310046"),
    # m_247은 /app/ 프리픽스를 쓴다
    (f"{BASE}/app/lay2/program/S48T561C563/www/brd/m_247/view.do?seq=309807",
     f"{BASE}/app/brd/m_247/view.do?seq=309807"),
    # 이미 짧으면 그대로
    (f"{BASE}/main/brd/m_241/view.do?seq=310041", f"{BASE}/main/brd/m_241/view.do?seq=310041"),
])
def test_short_view_url(given, want):
    assert short_view_url(given) == want


def test_short_view_url_leaves_other_hosts():
    portal = "https://housing.seoul.go.kr/site/main/sh/publicLease/view?seq=3"
    assert short_view_url(portal) == portal


def test_missing_page():
    alert = (
        "\r\n\r\n<script type=\"text/javascript\">\r\n\t//<![CDATA[\r\n"
        "\talert('해당 데이터를 찾을 수 없습니다.');\r\n"
        "\twindow.location.href = '/index.do';\r\n\t//]]>\r\n</script>\r\n"
    )
    assert is_missing_page(alert)


def test_present_page_is_not_missing():
    # 첨부가 0건인 것과 「그 글이 없는 것」은 다르게 다뤄야 한다
    assert not is_missing_page("<html><body>" + "공고 본문 " * 500 + "</body></html>")


def test_title_key_ignores_amendment_prefix_and_date():
    portal = "2026년 2차 장기미임대 매입임대주택 예비자모집공고(2026. 8. 28.)"
    board = "(정정) 2026년 2차 장기미임대 매입임대주택 예비자모집공고(2026. 8. 28.)"
    assert title_key(portal) == title_key(board)


def test_title_key_keeps_different_notices_apart():
    a = "2026년 2차 장기미임대 매입임대주택 예비자모집공고(2026. 8. 28.)"
    b = "2026년 2차 행복주택 입주자 모집공고 (2026. 8. 28.)"
    assert title_key(a) != title_key(b)
