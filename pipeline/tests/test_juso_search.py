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
