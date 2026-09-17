"""S5 매핑 단위 테스트. 네트워크·DB 없음.

픽스처는 실측 응답을 잘라 온 것이다(2026-09-17, 단지정보 15110581 · 대기현황 15108378).
여기 걸린 것은 전부 **실제로 데이터가 그랬던** 함정이다 — 합성 예제가 아니다.
"""

import json
from datetime import date
from pathlib import Path

from zipgonggo_pipeline.stages.s5_complex import (
    complex_slug,
    map_complex,
    map_complex_types,
    map_waitlist,
    match_notices,
    sigungu_codes,
)

FIX = Path(__file__).resolve().parent / "fixtures"
TODAY = date(2026, 9, 17)


def rows() -> list[dict]:
    return json.loads((FIX / "myhome_complex_rows.json").read_text(encoding="utf-8"))


def grouped() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows():
        out.setdefault(str(r["hsmpSn"]), []).append(r)
    return out


def waits() -> list[dict]:
    return json.loads((FIX / "myhome_waitlist_rows.json").read_text(encoding="utf-8"))


# ── 호출 대상 ─────────────────────────────────────────────────


def test_sigungu_codes_from_pnu():
    """PNU 앞 5자리가 시도(2)+시군구(3). 코드표 없이 공고에서 호출 대상을 얻는다."""
    got = sigungu_codes(["4421010700104630001", "4421010700199990000", "1111018300101870001", "", None])
    assert got == [("11", "110"), ("44", "210")]


# ── 단지 ─────────────────────────────────────────────────────


def test_map_complex_reads_facts_from_first_row():
    c = map_complex(grouped()["30700104"])
    assert c["complex_code"] == "30700104"
    assert c["name"] == "석림주공3단지"
    assert c["agency"] == "LH대전충남"
    assert c["pnu"] == "4421010700104630001"
    assert c["sido"] == "충청남도" and c["sigungu"] == "서산시"
    assert c["sido_code"] == "44" and c["sigungu_code"] == "210"
    assert c["completed_on"] == date(1995, 6, 15)
    assert c["heating"] == "중앙가스난방"
    assert c["building_style"] == "복도식"
    assert c["elevator"] == "전체동 설치"     # boolean으로 접지 않는다 — 「일부동 설치」가 있다
    assert c["parking_cnt"] == 198
    assert c["slug"] == "석림주공3단지-30700104"


def test_map_complex_takes_max_household():
    """세대수만은 유형 블록마다 다르게 온다(영구임대 388 / 50년임대 387). 큰 값을 쓴다."""
    got = {r["hshldCo"] for r in grouped()["30700104"]}
    assert got == {387, 388}
    assert map_complex(grouped()["30700104"])["household_cnt"] == 388


def test_map_complex_dominant_housing_type():
    """한 단지에 유형이 섞인다. 대표 유형은 행이 많은 쪽 — 형 줄은 유형별로 따로 남는다."""
    c = map_complex(grouped()["30700104"])
    assert c["housing_type"] in ("영구임대", "50년임대")


def test_complex_slug_strips_spaces_and_brackets():
    assert complex_slug("그린카운티(울산북구 달천)", "1") == "그린카운티울산북구-달천-1"
    assert complex_slug("서울특별시 종로구", "2") == "서울특별시-종로구-2"
    assert complex_slug("   ", "3") == "단지-3"


# ── 형 ───────────────────────────────────────────────────────


def test_same_style_same_money_merges_into_area_range():
    """울산구영1 51형 — 전용 51.79 / 51.84 / 51.92㎡ 세 행인데 금액이 같다. 한 줄 + 면적 범위."""
    ts = map_complex_types("30699560", grouped()["30699560"])
    t51 = [t for t in ts if t["style_name"] == "51"]
    assert len(t51) == 1
    t = t51[0]
    assert t["row_count"] == 3
    assert float(t["exclusive_area"]) == 51.79
    assert float(t["exclusive_area_max"]) == 51.92
    assert t["base_deposit"] == 24255000 and t["base_rent"] == 192000


def test_single_row_style_has_no_area_max():
    """한 행짜리 형은 상한을 비운다 — 화면이 「51.79~51.79㎡」를 그리지 않게."""
    ts = map_complex_types("30699560", grouped()["30699560"])
    t59 = next(t for t in ts if t["style_name"] == "59")
    assert t59["row_count"] == 1
    assert t59["exclusive_area_max"] is None
    assert t59["common_area_max"] is None


def test_types_split_by_housing_type():
    """석림주공3단지는 영구임대 26형과 50년임대 37형을 같이 갖는다 — 유형이 키에 있어야 갈린다."""
    ts = map_complex_types("30700104", grouped()["30700104"])
    pairs = {(t["housing_type"], t["style_name"]) for t in ts}
    assert pairs == {("영구임대", "26"), ("50년임대", "37")}


def test_common_area_range_when_only_common_differs():
    """석림 37형은 전용은 같고 공용만 15.48 / 17.14로 갈린다."""
    ts = map_complex_types("30700104", grouped()["30700104"])
    t = next(t for t in ts if t["style_name"] == "37")
    assert t["exclusive_area_max"] is None
    assert float(t["common_area"]) == 15.48
    assert float(t["common_area_max"]) == 17.14


def test_types_sorted_by_area():
    ts = map_complex_types("30699560", grouped()["30699560"])
    areas = [float(t["exclusive_area"]) for t in ts]
    assert areas == sorted(areas)


# ── 대기현황 ──────────────────────────────────────────────────


def test_waitlist_merges_duplicate_natural_key():
    """서울가좌 16형(사초생)이 대기 8/퇴거 17과 대기 0/퇴거 44 두 행으로 온다.

    회차가 다른 별개 명부인데 API가 그걸 가릴 필드를 안 준다 — 합쳐서 「기다리는 사람 수」로 싣는다.
    합치지 않으면 자연키가 겹쳐 적재가 CardinalityViolation으로 죽는다(실측 2026-09-17).
    """
    out = map_waitlist(waits(), TODAY)
    dup = [w for w in out if w["style_name"] == "16" and w["draw_unit"] == "16형(사초생)"]
    assert len(dup) == 1
    assert dup[0]["waiting_cnt"] == 8 + 0
    assert dup[0]["vacated_cnt"] == 17 + 44
    assert len(dup[0]["raw"]["rows"]) == 2


def test_waitlist_keeps_draw_units_apart():
    """같은 16형이라도 추첨단위(대학생·청년·고령자)가 다르면 다른 줄이다."""
    out = map_waitlist(waits(), TODAY)
    units = {w["draw_unit"] for w in out if w["style_name"] == "16"}
    assert units == {"16형(대학생)", "16형(사초생)", "16형(청년)", "16형(고령자)"}


def test_waitlist_natural_key_is_unique_after_merge():
    out = map_waitlist(waits(), TODAY)
    keys = [(w["complex_code"], w["housing_type"], w["style_name"], w["draw_unit"], w["surveyed_on"]) for w in out]
    assert len(keys) == len(set(keys))


# ── 공고 → 단지 ───────────────────────────────────────────────


def test_match_narrows_by_housing_type():
    """청주산남2-1은 한 PNU에 단지가 둘(주거복지동 · 산남주공2-1단지). 유형이 갈라 준다."""
    g = grouped()
    pnu = "4311210700103350000"
    both = [c for c, rs in g.items() if rs[0]["pnu"] == pnu]
    assert len(both) == 2

    m = match_notices([("lh-x-yeonggu", pnu, "영구임대", "영구임대주택 (청주산남2-1)", None)], g)
    # 둘 다 영구임대면 이름으로 좁힌다 — 못 좁히면 잇지 않는다
    assert len(m.links) + m.reasons["후보_여럿"] == 1


def test_match_links_single_candidate():
    m = match_notices([("lh-y-50nyeon", "4421010700104630001", "50년임대", "서삭석림3단지", 387)], grouped())
    assert m.links == [("lh-y-50nyeon", "30700104")]


def test_match_skips_when_pnu_unknown():
    m = match_notices([("lh-z", "9999999999999999999", "국민임대", "없는단지", None)], grouped())
    assert m.links == []
    assert m.reasons["단지_없음"] == 1


def test_match_never_guesses_between_candidates():
    """이름이 안 겹치고 유형도 같으면 **비워 둔다.** 아무거나 고르면 남의 단지 임대료를 싣게 된다."""
    g = grouped()
    m = match_notices([("lh-w", "4311210700103350000", "영구임대", "전혀 다른 이름", None)], g)
    assert m.links == []
    assert m.reasons["후보_여럿"] == 1


def test_match_rejects_when_household_is_an_order_apart():
    """익산부송1단지(1,582세대)에 「익산부송1 증축 주거복지동」(112세대)이 이름 점수로 뽑혔던 자리.

    이름은 그럴듯한데 세대수가 열 배 넘게 어긋난다 — 별채를 단지로 싣게 된다. 그런 연결은 버린다.
    후보가 하나뿐일 땐 이 검사를 하지 않는다: 같은 단지라도 공고는 단지 전체를, API 행은 그 유형분만
    세는 일이 흔해서다(원주흥업2 990 vs 794).
    """
    small = [{"hsmpSn": 1, "hsmpNm": "익산부송1 증축 주거복지동", "pnu": "4514010100100010000",
              "suplyTyNm": "영구임대", "hshldCo": 112, "styleNm": "26"}]
    other = [{"hsmpSn": 2, "hsmpNm": "전혀 다른 이름", "pnu": "4514010100100010000",
              "suplyTyNm": "영구임대", "hshldCo": 1500, "styleNm": "26"}]
    g = {"1": small, "2": other}
    m = match_notices([("lh-iksan", "4514010100100010000", "영구임대", "익산부송1단지", 1582)], g)
    assert m.links == []
    assert m.reasons["세대수_어긋남"] == 1


def test_match_allows_household_gap_within_reason():
    """원주흥업2 — 공고 990세대 / 단지 794세대. 같은 단지를 다르게 센 것이라 이건 이어야 한다."""
    a = [{"hsmpSn": 1, "hsmpNm": "원주흥업2단지", "pnu": "5113010100100010000",
          "suplyTyNm": "국민임대", "hshldCo": 794, "styleNm": "36"}]
    b = [{"hsmpSn": 2, "hsmpNm": "아주 다른 곳", "pnu": "5113010100100010000",
          "suplyTyNm": "국민임대", "hshldCo": 200, "styleNm": "36"}]
    m = match_notices([("lh-wonju", "5113010100100010000", "국민임대", "원주흥업2", 990)], {"1": a, "2": b})
    assert m.links == [("lh-wonju", "1")]
