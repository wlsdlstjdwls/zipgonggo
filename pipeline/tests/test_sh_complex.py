"""SH 첨부 공고문 「주택 위치 안내」 표 파서 회귀. 정답지: 51차 장기전세(i-sh seq=309467) 49~52쪽. 네트워크 없음."""

import re
from collections import Counter
from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_complex import ROAD_ADDR_RE, parse_location_table
from zipgonggo_pipeline.sources.ish import find_attachments, group_rows, page_rows, parse_chars

FIX = Path(__file__).parent / "fixtures" / "ish_309467"
PAGES = [(n, (FIX / f"p{n}.xml").read_text(encoding="utf-8")) for n in (49, 50, 51, 52)]
SEOUL_GU = {
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구", "은평구",
    "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구", "강동구",
}


@pytest.fixture(scope="module")
def rows():
    return parse_location_table(PAGES)


def test_row_count_regression(rows):
    # 쪽별 25 + 39 + 38 + 36. 하나라도 어긋나면 줄 묶기·주소 정규식이 깨진 것
    assert len(rows) == 138
    assert Counter(r.page for r in rows) == {49: 25, 50: 39, 51: 38, 52: 36}


def test_every_row_complete(rows):
    for r in rows:
        assert r.name and r.sigungu and r.road_address and r.sido
        assert not re.search(r"\d \d", r.road_address), r  # 숫자 사이 공백은 글자 간격 오판


def test_address_regex_full_match(rows):
    for r in rows:
        assert ROAD_ADDR_RE.match(r.road_address), r.road_address
        assert re.search(r"(로|길)\s\d+(-\d+)?$", r.road_address), r.road_address


def test_hyphen_restored(rows):
    # 하이픈은 baseline이 어긋나 별도 줄로 떨어지기 쉽다. 번지 하이픈 19건이 전부 붙어 있어야 한다
    hy = [r.road_address for r in rows if "-" in r.road_address]
    assert len(hy) == 19
    assert "강서구 마곡서1로 111-11" in hy and "구로구 오리로 1102-10" in hy
    # 단지명 안 하이픈도 복원된다
    assert any(r.name == "래미안포레(세곡2-3)" for r in rows)
    assert any(r.name == "상림마을6-1단지" for r in rows)


def test_sigungu_and_sido(rows):
    gus = {r.sigungu for r in rows if r.sido == "서울특별시"}
    assert gus <= SEOUL_GU, gus - SEOUL_GU
    outside = [r for r in rows if r.sido != "서울특별시"]
    assert [(r.name, r.road_address) for r in outside] == [
        ("수락리버시티1단지", "경기도 의정부시 누원로 51"),
        ("수락리버시티2단지", "경기도 의정부시 누원로 52"),
    ]


def test_new_flag(rows):
    new = sorted(r.name for r in rows if r.is_new)
    assert new == sorted(["래미안레벤투스", "청담르엘", "두산위브더프레스티지", "이문3 복합공공청사", "디에이치방배", "오티에르반포", "성동자이리버뷰", "영등포자이 디그니티", "어반하임102"])


def test_row_grouping_does_not_chain_merged_cells():
    # 세로 병합 칸(자치구) 글자가 다음 줄과 겹쳐도 표 행이 이어 붙지 않는다
    chars = parse_chars(PAGES[0][1])
    rows = group_rows(chars)
    assert 30 <= len(rows) <= 120  # 표 25행 + 본문 줄. 이어 붙으면 한 자리 수로 떨어진다
    texts = [" ".join(s.text for s in r) for r in page_rows(PAGES[0][1])]
    assert any("래미안레벤투스" in t and "도곡로 242" in t for t in texts)


def test_find_attachments_from_markup():
    html = """
    <tr class="gs0401tr"><th>첨부</th><td class="gs0401td">
      <a href="#" class="btnAttach v1" onclick="existFile('0'); return false;">
        제51차 장기전세 입주자 모집공고.pdf
      </a></td>
      <td><a href="/main/com/util/htmlConverter.do?brd_id=GS0401&amp;seq=309467&amp;data_tp=A&amp;file_seq=1" class="btn">미리보기</a></td></tr>
    """
    atts = find_attachments(html)
    assert len(atts) == 1
    assert atts[0].name == "제51차 장기전세 입주자 모집공고.pdf"
    assert atts[0].preview_url == "https://www.i-sh.co.kr/main/com/util/htmlConverter.do?brd_id=GS0401&seq=309467&data_tp=A&file_seq=1"
