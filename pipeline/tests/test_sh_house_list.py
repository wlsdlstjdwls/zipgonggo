"""SH 매입임대 「주택목록」 별도 첨부 파서 회귀. 정답지는 실제 첨부의 쪽 XML. 네트워크 없음."""

from pathlib import Path

from zipgonggo_pipeline.parsers.sh_house_list import _area, _name_dong, parse_house_list

FIX = Path(__file__).parent / "fixtures"


def pages(name: str, nums):
    d = FIX / name
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


def by_key(h):
    return {u["unit_key"]: u for u in h.units}


def test_sinhon1_columns_and_tiers():
    """신혼·신생아Ⅰ 상세 1쪽: 30호. 금액 두 벌의 계층 이름은 금액 칸 위 두 줄을 이어 붙인 것이다."""
    h = parse_house_list(pages("ish_310650_list", [1]))
    assert h is not None
    assert len(h.units) == 30
    assert h.tiers == ["소득50% 이하 신청자 (수급계층 포함)", "소득70% 이하 신청자 (맞벌이인 경우 소득90% 이하)"]
    u = by_key(h)["서도휴빌(2차)-102동-0201"]
    assert (u["road_address"], u["building"], u["room"], u["floor"]) == ("강동구 강동대로55길 40", "102동", "0201", 2)
    assert (u["area_m2"], u["room_layout"], u["elevator"]) == (44.42, "투룸", "설치")
    assert u["price_tiers"] == [
        {"label": h.tiers[0], "deposit": 19_530_000, "rent": 254_400},
        {"label": h.tiers[1], "deposit": 32_560_000, "rent": 424_100},
    ]
    assert (u["deposit"], u["rent"]) == (19_530_000, 254_400)


def test_sinhon1_lost_decimal_and_dong_grouping():
    """쉼표와 소수점이 다음 줄로 흘러간 줄(「5671」 = 56.71㎡)도 읽는다.
    천호에스하임3 가동/나동은 같은 주소의 한 단지다 — 동은 이름에서 떼어 호실 쪽으로 옮긴다."""
    h = parse_house_list(pages("ish_310650_list", [1, 5]))
    u = by_key(h)
    assert u["예성빌-0202"]["area_m2"] == 56.71
    assert (u["예성빌-0202"]["deposit"], u["예성빌-0202"]["rent"]) == (36_540_000, 376_500)
    # 소수 셋째 자리까지 적힌 면적(「55165」 = 55.165 → 55.16)
    assert u["모던빌-0203"]["area_m2"] == 55.16
    c = {x["name"]: x for x in h.complexes}
    assert c["천호에스하임3"]["unit_count"] == 2
    assert {x["building"] for x in h.units if x["complex_name"] == "천호에스하임3"} == {"가동", "나동"}
    assert c["예성빌"]["is_new"] is True and c["서도휴빌(2차)"]["is_new"] is False


def test_sinhon2_road_without_paren():
    """괄호 없이 건물명과 동호가 붙은 주소(「경인로15나길 65-4 궁동에스하임 제101동 302호」)는 번지에서 끊는다."""
    h = parse_house_list(pages("ish_310653_list", [1]))
    c = {x["name"]: x for x in h.complexes}
    assert c["궁동에스하임"]["road_address"] == "구로구 경인로15나길 65-4"
    assert c["궁동에스하임"]["unit_count"] == 3
    assert {x["building"] for x in h.units if x["complex_name"] == "궁동에스하임"} == {"101동", "102동"}


def test_cheongnyeon_four_tiers():
    """청년 매입임대 1쪽: 금액 네 벌. 대학생 계층은 보증금이 100만 원 고정이라 비율 검산에 걸리면 안 된다."""
    h = parse_house_list(pages("ish_306214_list", [1]))
    assert h.tiers == [
        "1순위(시세 30% 적용) 청년", "1순위(시세 30% 적용) 대학생 및 취업준비생",
        "2~3순위(시세 50% 적용) 청년", "2~3순위(시세 50% 적용) 대학생 및 취업준비생",
    ]
    u = by_key(h)["성지빌라-0201"]
    assert u["road_address"] == "강동구 양재대로95길 36-9"
    assert u["room_layout"] == "개방형원룸"
    assert [(t["deposit"], t["rent"]) for t in u["price_tiers"]] == [
        (20_700_000, 213_300), (1_000_000, 254_300), (34_500_000, 355_500), (2_000_000, 423_200)]
    assert all(t["deposit"] for x in h.units for t in x["price_tiers"])


def test_jangimiimdae_list_without_prices():
    """장기미임대 주택목록: 금액 칸이 없다. 호실 행은 못 만들어도 단지(이름은 주소 뒤 건물명)는 낸다."""
    h = parse_house_list(pages("ish_301759_list", [1]))
    assert h is not None and h.units == [] and h.tiers == []
    c = {x["road_address"]: x for x in h.complexes}
    assert c["강남구 논현로12길 3-8"]["name"] == "동영빌"
    assert c["강동구 천중로18길 29"]["name"] == "천호에스하임Ⅲ"


def test_split_address_cell_is_joined():
    """주소 칸이 「서울특별시 서초구 논현로5길 23-7」 / 「(양재동 400-11)」 두 조각으로 온다(304699 4쪽).
    뒤 조각만 붙으면 도로명이 「서초구 」로 빈다."""
    h = parse_house_list(pages("ish_304699_list", [1, 4]))
    roads = {x["name"]: x["road_address"] for x in h.complexes}
    assert roads["예미담"] == "서초구 논현로5길 23-7"
    assert all(" " in r and r.split(" ", 1)[1] for r in roads.values())


def test_area_restore():
    assert _area("44.42") == 44.42
    assert _area("4575") == 45.75
    assert _area("538") == 53.8
    assert _area("548339") == 54.83
    assert _area("2855") == 28.55


def test_name_dong():
    road = "강북구 인수봉로64길 15"
    assert _name_dong("아트라움 101동", None, road) == ("아트라움", "101동")
    assert _name_dong("고척랜드플러스 (101동)", "101동", road) == ("고척랜드플러스", "101동")
    # 주소는 「비동」, 이름은 「B동」 — 같은 동이다
    assert _name_dong("포엠빌 B동", "비동", road) == ("포엠빌", "B동")
    # 이름이 없거나 건축물대장 기본값뿐이면 도로명을 이름으로 쓴다
    assert _name_dong("-", None, road) == ("인수봉로64길 15", None)
    assert _name_dong("주건축물제1동", None, road) == ("인수봉로64길 15", "1동")
    # 지역 동 이름은 동 표기가 아니다
    assert _name_dong("블루밍하우스 수유동", None, road) == ("블루밍하우스 수유동", None)
