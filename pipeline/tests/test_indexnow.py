"""IndexNow 발행기.

DB·네트워크를 타지 않는 부분만 묶는다 — URL 만들기와 제출 페이로드·상태코드 판정.
「두 번 쏘지 않기」 로직은 SQL 안에 있어(0028 해시 비교) 여기서는 규격 준수만 지킨다.
"""

import pytest

from zipgonggo_pipeline.indexnow import (
    ENDPOINT,
    HOST,
    is_notice_detail,
    notice_url,
    parse_sitemap,
    sitemap_urls,
    submit,
)


def test_slug_is_encoded():
    """slug에 한글·콜론이 들어간다. web의 noticePath(encodeURIComponent)와 같은 결과여야
    사이트맵·canonical과 다른 URL을 쏘는 사고가 안 난다."""
    assert notice_url("sh-2026-51-jangki") == "https://zipgonggo.com/notice/sh-2026-51-jangki"
    assert notice_url("서울-2026") == "https://zipgonggo.com/notice/%EC%84%9C%EC%9A%B8-2026"
    # 슬래시가 살아 있으면 다른 경로가 된다 — safe=''로 막는다
    assert notice_url("a/b") == "https://zipgonggo.com/notice/a%2Fb"


class _Res:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")


class _Client:
    """httpx 대역. 마지막 요청을 들고 있는다."""

    def __init__(self, status=200):
        self.status = status
        self.url = None
        self.json = None

    def post(self, url, json=None, timeout=None):
        self.url = url
        self.json = json
        return _Res(self.status)


def test_payload_follows_spec():
    c = _Client()
    urls = ["https://zipgonggo.com/notice/a"]
    assert submit(urls, "KEY", client=c) is True
    assert c.url == ENDPOINT
    assert c.json == {
        "host": HOST,
        "key": "KEY",
        "keyLocation": "https://zipgonggo.com/KEY.txt",
        "urlList": urls,
    }


@pytest.mark.parametrize("status,ok", [(200, True), (202, True), (400, False), (403, False), (422, False)])
def test_status_judgement(status, ok):
    """202는 「접수했고 키는 나중에 검증한다」라 성공이다. 실패로 읽으면 매 회차 같은 URL을 다시 쏜다."""
    assert submit(["https://zipgonggo.com/notice/a"], "KEY", client=_Client(status)) is ok


# ── 사이트맵에서 읽는 쪽 (0030) ────────────────────────────────────────────────

_NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'


def _urlset(*locs):
    body = "".join(f"<url><loc>{u}</loc><lastmod>2026-09-16</lastmod></url>" for u in locs)
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset {_NS}>{body}</urlset>'


@pytest.mark.parametrize("url,detail", [
    ("https://zipgonggo.com/notice/sh-2026-51-jangki", True),
    # 단지는 한 칸 더 깊다 — 사이트맵 쪽이 맡는다
    ("https://zipgonggo.com/notice/sh-2026-51-jangki/%EA%B0%95%EB%82%A8-1", False),
    ("https://zipgonggo.com/type/%ED%96%89%EB%B3%B5%EC%A3%BC%ED%83%9D", False),
    ("https://zipgonggo.com/area/%EC%84%9C%EC%9A%B8", False),
    ("https://zipgonggo.com", False),
])
def test_notice_detail_is_left_to_the_hash_publisher(url, detail):
    """공고 상세를 양쪽에서 쏘면 같은 URL을 두 번 던진다 — IndexNow가 하지 말라는 짓이다."""
    assert is_notice_detail(url) is detail


def test_sitemapindex_is_followed():
    """40,000을 넘겨 web이 사이트맵을 쪼개는 날 여기를 안 고쳐도 되게 한 단은 따라간다."""
    child = "https://zipgonggo.com/sitemap/1.xml"
    index = (f'<?xml version="1.0"?><sitemapindex {_NS}>'
             f"<sitemap><loc>{child}</loc></sitemap></sitemapindex>")
    urls, children = parse_sitemap(index)
    assert (urls, children) == ([], [child])


class _Sitemap:
    """httpx 대역. URL별로 다른 XML을 준다."""

    def __init__(self, pages):
        self.pages = pages
        self.seen = []

    def get(self, url, timeout=None):
        self.seen.append(url)
        return _Res(200, self.pages[url])


def test_sitemap_urls_drops_notices_and_keeps_order():
    home = "https://zipgonggo.com"
    hub = "https://zipgonggo.com/type/happy"
    complex_url = "https://zipgonggo.com/notice/sh-2026-51/gangnam-1"
    c = _Sitemap({"https://zipgonggo.com/sitemap.xml": _urlset(
        home, hub, "https://zipgonggo.com/notice/sh-2026-51", complex_url, hub,
    )})
    # 사이트맵 순서가 곧 우선순위다(홈 → 허브 → 단지). 중복은 한 번만
    assert sitemap_urls(client=c) == [home, hub, complex_url]
