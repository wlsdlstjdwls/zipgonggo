"""검색어 다듬기와 후보 고르기. 네트워크는 타지 않는다 — 순수 함수와 _pick만 본다."""

from zipgonggo_pipeline.geo.juso_search import JusoHit, JusoSearch, clean_query


def hit(road_addr="", *, main=1, sub=0, sigungu="강동구", emd="고덕동", name=""):
    return JusoHit(road_addr, "1174031240", False, main, sub, "서울특별시", sigungu, emd, name)


def test_구역을_뭉뚱그린_꼬리표는_뗀다():
    assert clean_query("동대문구 휘경동 172번지 일대") == "동대문구 휘경동 172"
    assert clean_query("성북구 장위동 62-1번지 일대") == "성북구 장위동 62-1"


def test_괄호_부연과_쉼표_뒤는_버린다():
    assert clean_query("구로구 항동 136-5 하버라인 9단지 (항동 하버라인9단지)") == "구로구 항동 136-5 하버라인 9단지"
    assert clean_query("강남구 논현로28길 12-3, 101동 501호") == "강남구 논현로28길 12-3"


def test_지번_뒤_건물명은_남긴다():
    # 동명이지번을 가려 주는 단서다
    assert clean_query("강남구 개포동 1281 디에이치아너힐즈") == "강남구 개포동 1281 디에이치아너힐즈"


def _pick(hits, query, how="addr", sido="서울특별시"):
    return JusoSearch("key")._pick(hits, sido, query, how)


def test_한_건이면_그대로_받고_시도를_적는다():
    got = _pick([hit(main=11, name="고덕그라시움")], "강동구 고덕동 693 고덕그라시움", how="bunji")
    assert (got.main_no, got.how) == (11, "bunji")


def test_동네가_갈리면_포기한다():
    # 같은 지번이 여러 동에 있으면 엉뚱한 데를 찍느니 비워 둔다
    hits = [hit(sigungu="강동구", emd="고덕동"), hit(sigungu="강북구", emd="미아동")]
    assert _pick(hits, "고덕동 693") is None


def test_한_단지의_여러_출입구면_주거동을_고른다():
    hits = [
        hit(main=353, name="고덕그라시움(제1상가)"),
        hit(main=333, name="고덕그라시움"),
        hit(main=29, name="고덕그라시움(제2상가)"),
    ]
    got = _pick(hits, "강동구 고덕동 693 고덕그라시움")
    assert got.main_no == 333


def test_시도가_다른_후보는_먼저_걸러낸다():
    hits = [hit(main=1, name="가"), JusoHit("", "x", False, 2, 0, "경기도", "고양시", "행신동", "나")]
    got = _pick(hits, "고덕동 693 가")
    assert got.main_no == 1


# ── 회로 차단기 ────────────────────────────────────────────────
# 서버가 통째로 안 받는 판에서 주소마다 20초씩 세 번을 기다리면 회차가 타임아웃까지 간다.
# 연속 실패가 GIVE_UP_AFTER에 닿으면 그 판은 접는다(2026-09-16).

import urllib.error

import pytest

from zipgonggo_pipeline.geo import juso_search


def _client(monkeypatch, answers):
    """_get을 갈아 끼운다. answers는 호출마다 돌려줄 값 — Exception이면 던진다."""
    c = JusoSearch("key", delay_sec=0)
    seq = list(answers)

    def fake_open(url, timeout=None):
        got = seq.pop(0) if seq else urllib.error.URLError("timed out")
        if isinstance(got, BaseException):
            raise got
        raise AssertionError("이 테스트는 성공 응답을 안 쓴다")

    monkeypatch.setattr(juso_search.time, "sleep", lambda *_: None)
    monkeypatch.setattr(juso_search.urllib.request, "urlopen", fake_open)
    return c


def test_연속_실패가_쌓이면_그_판을_접는다(monkeypatch):
    c = _client(monkeypatch, [])
    for _ in range(juso_search.GIVE_UP_AFTER):
        c.find("강동구 상일동 36-3 강동리엔파크")
        # 캐시에 걸리지 않게 주소를 바꿔 준다
        c._cache.clear()
    assert c.given_up


def test_접은_뒤에는_한_번도_안_부른다(monkeypatch):
    c = _client(monkeypatch, [])
    for _ in range(juso_search.GIVE_UP_AFTER):
        c.find("강동구 상일동 36-3 강동리엔파크")
        c._cache.clear()
    before = c.calls
    assert c.find("성북구 장위동 62-1 장위자이") is None
    assert c.calls == before


def test_중간에_한_번_붙으면_연속이_끊긴다(monkeypatch):
    """한 번이라도 답이 오면 연속 실패는 0으로 돌아간다 — 특정 주소만 안 나오는 것과 구분한다."""
    c = JusoSearch("key", delay_sec=0)
    monkeypatch.setattr(juso_search.time, "sleep", lambda *_: None)

    # 실패 4번(GIVE_UP_AFTER=5에 하나 모자라게) → 성공 1번 → 다시 실패 4번.
    # _get 한 번이 안에서 RETRY회 두드리므로 결과는 _get 단위로 정한다
    plan = ["fail"] * (juso_search.GIVE_UP_AFTER - 1) + ["ok"] + ["fail"] * (juso_search.GIVE_UP_AFTER - 1)
    now = {"outcome": "fail"}

    class Body:
        def read(self):
            return b'{"results": {"common": {"errorCode": "0"}, "juso": []}}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_open(url, timeout=None):
        if now["outcome"] == "fail":
            raise urllib.error.URLError("timed out")
        return Body()

    monkeypatch.setattr(juso_search.urllib.request, "urlopen", fake_open)

    for n, outcome in enumerate(plan):
        now["outcome"] = outcome
        c._get("https://x.test/?n=%d" % n)
    assert not c.given_up, "성공 한 번이 연속 실패를 0으로 안 돌렸다"
    assert c._misfires == juso_search.GIVE_UP_AFTER - 1
