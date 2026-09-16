"""서울 구멍(sources/egress.py)이 어떤 요청을 감싸고 어떤 걸 그냥 두는가.

한국 정부 사이트가 GitHub 러너 IP를 간헐로 안 받아 web의 /api/egress(icn1)를 거친다.
**안 켜면 아무것도 안 바뀌어야 한다** — 로컬(한국)은 직접 붙는 게 빠르다.
"""

import urllib.parse

import httpx

from zipgonggo_pipeline.sources.egress import Egress, from_env
from zipgonggo_pipeline.sources.http import ThrottledHttp

PROXY = "https://zipgonggo.com/api/egress"
# 비밀값은 **ASCII여야 한다** — HTTP 헤더 값으로 실려 나간다(한글을 넣으면 httpx가 인코딩에서 죽는다)
ON = Egress(PROXY, "s3cr3t-ascii")
OFF = Egress("", "")


def _seen(egress: Egress) -> tuple[ThrottledHttp, list[httpx.Request]]:
    caught: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        caught.append(req)
        return httpx.Response(200, text="ok")

    http = httpx.Client(transport=httpx.MockTransport(handler), headers={"User-Agent": "test-agent"})
    return ThrottledHttp(delay_sec=0, http=http, egress=egress), caught


# ── 무엇을 감싸는가 ────────────────────────────────────────────

def test_켜져_있으면_한국_사이트는_구멍으로_나간다():
    c, seen = _seen(ON)
    c.get("https://apis.data.go.kr/1613000/HWSPR02/rsdtRcritNtcList", params={"pageNo": 1})
    assert len(seen) == 1
    sent = seen[0]
    assert sent.url.host == "zipgonggo.com" and sent.url.path == "/api/egress"
    assert sent.headers["x-egress-secret"] == "s3cr3t-ascii"


def test_원래_주소는_쿼리까지_통째로_실린다():
    """serviceKey처럼 값에 +·=가 든 게 있다. 이어 붙이면 상대가 다른 값으로 읽는다."""
    c, seen = _seen(ON)
    key = "a+b/c=="
    c.get("https://apis.data.go.kr/1613000/HWSPR02/x", params={"serviceKey": key, "pageNo": 3})

    inner = urllib.parse.parse_qs(seen[0].url.query.decode())["url"][0]
    parts = urllib.parse.parse_qs(urllib.parse.urlsplit(inner).query)
    assert parts["serviceKey"] == [key]
    assert parts["pageNo"] == ["3"]
    assert urllib.parse.urlsplit(inner).hostname == "apis.data.go.kr"


def test_상대에게_보낼_UA를_따로_실어_준다():
    """프록시로 가는 요청의 UA는 프록시 것이다. 상대가 볼 UA는 이름을 바꿔 넘긴다."""
    c, seen = _seen(ON)
    c.get("https://housing.seoul.go.kr/site/main/sh/publicLease/02/list")
    assert seen[0].headers["x-egress-user-agent"] == "test-agent"


def test_POST도_같은_구멍으로_간다():
    """i-sh 게시판은 mainform POST만 받는다 — GET만 감싸면 그 축이 통째로 빠진다."""
    c, seen = _seen(ON)
    c.post("https://www.i-sh.co.kr/main/lay2/S1T111C133/board.do", data={"cp": "2"})
    assert seen[0].method == "POST"
    assert seen[0].url.host == "zipgonggo.com"
    assert b"cp=2" in seen[0].content


# ── 무엇을 그냥 두는가 ─────────────────────────────────────────

def test_안_켜면_아무것도_안_바뀐다():
    c, seen = _seen(OFF)
    c.get("https://apis.data.go.kr/x", params={"a": 1})
    assert seen[0].url.host == "apis.data.go.kr"
    assert "x-egress-secret" not in seen[0].headers


def test_비밀값만_있고_주소가_없으면_안_켜진다():
    c, seen = _seen(Egress("", "s3cr3t-ascii"))
    c.get("https://apis.data.go.kr/x")
    assert seen[0].url.host == "apis.data.go.kr"


def test_목록에_없는_호스트는_직접_나간다():
    """IndexNow나 우리 웹훅까지 서울을 거칠 이유가 없다."""
    c, seen = _seen(ON)
    c.get("https://api.indexnow.org/indexnow")
    assert seen[0].url.host == "api.indexnow.org"
    assert "x-egress-secret" not in seen[0].headers


def test_환경변수가_비면_꺼진_채로_온다(monkeypatch):
    monkeypatch.delenv("EGRESS_PROXY_URL", raising=False)
    monkeypatch.delenv("EGRESS_SECRET", raising=False)
    assert not from_env().enabled


def test_환경변수_둘_다_있어야_켜진다(monkeypatch):
    monkeypatch.setenv("EGRESS_PROXY_URL", PROXY)
    monkeypatch.delenv("EGRESS_SECRET", raising=False)
    assert not from_env().enabled
    monkeypatch.setenv("EGRESS_SECRET", "s3cr3t-ascii")
    assert from_env().enabled
