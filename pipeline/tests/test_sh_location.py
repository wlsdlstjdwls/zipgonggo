"""SH 매입임대 공고문 본문의 주택 위치 파서 회귀. 정답지는 실제 공고문 쪽 XML. 네트워크 없음."""

from pathlib import Path

from zipgonggo_pipeline.parsers.sh_location import parse_locations, road_address, title_name

FIX = Path(__file__).parent / "fixtures"


def pages(seq: str, nums):
    d = FIX / f"ish_{seq}"
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


def table(locs):
    return [(c["name"], c["road_address"], c["unit_count"]) for c in locs]


def test_target_table_jarip():
    """자립준비청년 대상주택 표: 주소 줄 다음에 「이름(지번)」 줄. 공급호수는 주택형마다 한 줄이라 더한다."""
    locs = table(parse_locations(pages("296598", [3]), "자립준비청년 2025년 하반기 청년 매입임대주택 우선공급"))
    assert locs[0] == ("초행지붕천호", "강동구 상암로41길 75-1", 5)
    assert ("삼화에코빌", "마포구 월드컵북로9길 62", 7) in locs
    assert len(locs) == 8


def test_site_table_dosihyeong():
    """도시형생활주택 「단지 | 소재지」 표: 이름이 주소 윗줄에 있거나 같은 줄에 있다."""
    locs = table(parse_locations(pages("308167", [3]), "2026년 1~2인가구를 위한 도시형생활주택(건설형원룸) 잔여세대"))
    assert locs[:3] == [
        ("방화동원룸", "강서구 개화동로21길 49", None),
        ("문정동원룸", "송파구 새말로 14-1", None),
        ("역삼동원룸", "강남구 도곡로23길 5", None),
    ]
    # 「1인가구 무주택세대구성원」의 「인가구」를 구로 읽으면 안 된다
    assert all(not c[1].startswith("인가구") for c in locs)


def test_site_table_number_two_rows_down():
    """「강남구 밤고개로21길」 / (이름 줄) / 「56」 — 건물번호가 두 줄 아래로 넘어간 칸."""
    locs = table(parse_locations(pages("296634", [3]), "1~2인가구를 위한 도시형생활주택(건설형 원룸) 잔여세대"))
    assert ("율현리엔파크", "강남구 밤고개로21길 56", None) in locs


def test_site_table_header_second_line_is_not_a_name():
    """머리글 둘째 줄 「최고층수」가 단지 칸에 걸려도 이름이 아니다. 이름은 주소 아랫줄에 있다."""
    locs = table(parse_locations(pages("299109", [3]), "2026년 신내의료안심주택 잔여세대 입주자모집공고"))
    assert locs == [("신내의료안심주택", "중랑구 신내로16길 3", None)]


def test_label_pair_and_split_label():
    """「주택명 / 주소지」 짝(협동조합), 「□ 위 / 치: …」로 칸이 쪼개진 위치 줄(아우르네빌리지)."""
    assert table(parse_locations(pages("306066", [5]), "x")) == [
        ("만리동예술인협동조합주택(막쿱)", "중구 만리재로27길 69", None)]
    title = "2026년 창동 아우르네빌리지 예비입주자 모집공고(일자리연계형 지원주택, 2026.03.10.공고)"
    assert table(parse_locations(pages("301406", [3]), title)) == [
        ("창동 아우르네빌리지", "도봉구 마들로13길 84", None)]


def test_road_address_and_title():
    assert road_address("서울특별시 중랑구 신내로 16길 3") == ("중랑구", "중랑구 신내로16길 3")
    assert road_address("(강동구상암로35길10,") == ("강동구", "강동구 상암로35길 10")
    assert road_address("강남구 밤고개로21길") is None
    assert road_address("1인가구 무주택세대구성원") is None
    assert title_name("2026-2차 사당동원룸 잔여세대 입주자모집공고(26. 6. 26.)") == "사당동원룸"
