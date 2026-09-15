"""IndexNow 발행기.

DB·네트워크를 타지 않는 부분만 묶는다 — URL 만들기와 제출 페이로드·상태코드 판정.
「두 번 쏘지 않기」 로직은 SQL 안에 있어(0028 해시 비교) 여기서는 규격 준수만 지킨다.
"""

import pytest

from zipgonggo_pipeline.indexnow import ENDPOINT, HOST, notice_url, submit


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
