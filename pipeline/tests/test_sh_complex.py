"""SH 첨부 공고문 「주택 위치 안내」 표 파서 회귀. 정답지: 51차 장기전세(i-sh seq=309467) 49~52쪽. 네트워크 없음."""

import re
from collections import Counter
from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_complex import ROAD_ADDR_RE, _split_blocks, parse_location_table
from zipgonggo_pipeline.sources.ish import SynapDoc, find_attachments, group_rows, page_rows, parse_chars

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


def test_find_attachments_old_board_app_prefix():
    """구 게시판(2020년 등)은 /app/ 프리픽스를 쓴다 — /main/만 받으면 아카이브 백필이 통째로 비어 나온다."""
    html = """
    <tr><td><a href="#" class="btnAttach" onclick="existFile('0'); return false;">2020 행복주택 매입형 공고문.pdf</a></td>
    <td><a href="/app/com/util/htmlConverter.do?brd_id=JI1901&amp;seq=1234&amp;data_tp=A&amp;file_seq=1">미리보기</a></td></tr>
    """
    atts = find_attachments(html)
    assert len(atts) == 1
    assert atts[0].preview_url.endswith("/app/com/util/htmlConverter.do?brd_id=JI1901&seq=1234&data_tp=A&file_seq=1")


def test_synap_doc_page_url_keeps_rs_prefix():
    """rs는 302 Location에 실려 오는 값이라 /app/이든 /main/이든 그대로 써야 한다."""
    doc = SynapDoc(rs="/app/upload/bbs/JI1901/html/", fn="20200625112039731")
    assert doc.page_url(1) == "https://www.i-sh.co.kr/app/upload/bbs/JI1901/html/20200625112039731.files/20200625112039731_1.xml"


# --- 지구명 세로 병합 복원 -------------------------------------------------

def test_district_counts(rows):
    """15개 지구에 74단지. 나머지 64단지는 지구명 칸이 `-`인 단독 단지."""
    by = Counter(r.district for r in rows if r.district)
    assert len(by) == 15
    assert sum(by.values()) == 74
    assert sum(1 for r in rows if r.district is None) == 64


def test_district_blocks_are_exact(rows):
    """블록 경계가 밀리면 바로 여기서 걸린다 — 세곡/세곡2, 천왕/천왕2처럼 크기가 다른 이웃 블록이 함정."""
    got = {}
    for r in rows:
        if r.district:
            got.setdefault(r.district, []).append(r.name)
    assert got["세곡지구"] == ["강남신동아파밀리에2단지", "강남신동아파밀리에3단지", "세곡리엔파크4단지", "강남데시앙파크"]
    assert got["세곡2지구"] == ["래미안포레(세곡2-3)", "강남한양수자인(세곡2-4)", "강남한신휴플러스6단지(2-6)", "강남한신휴플러스8단지(2-8)"]
    assert got["천왕지구"] == [f"천왕이펜하우스 {n}단지" for n in (2, 3, 4, 5, 6)]
    assert got["천왕2지구"] == ["천왕연지타운 1단지", "천왕연지타운 2단지"]
    assert got["강일지구"] == [f"강일리버파크{n}단지" for n in (2, 3, 4, 6, 9, 10)]
    assert got["강일2지구"] == [f"고덕리엔파크{n}단지" for n in (1, 2, 3)]
    assert len(got["마곡지구"]) == 13 and all(n.startswith("마곡엠밸리") for n in got["마곡지구"])


def test_district_never_leaks_to_standalone(rows):
    """지구명 칸이 `-`인 줄은 지구가 없어야 한다. 있으면 병합 블록이 이웃 줄을 삼킨 것."""
    standalone = {"래미안레벤투스", "청담르엘", "수서하니움", "청담자이", "고덕아이파크", "등촌장기전세주택"}
    for r in rows:
        if r.name in standalone:
            assert r.district is None, r


def test_district_matches_complex_name(rows):
    """지구명 앞머리가 단지명·주소에 안 보이는 조합은 블록이 어긋난 신호(휴리스틱 감시용)."""
    for r in rows:
        if r.district in ("은평1지구", "은평2지구", "은평3지구"):
            assert r.sigungu == "은평구", r


def test_split_blocks_prefers_center_over_nearest():
    """가장 가까운 라벨에 붙이면 틀리는 실제 배치(51차 49쪽 강일/강일2)를 DP가 바로잡는지."""
    ys = [852.1, 874.2, 896.3, 919.0, 940.9, 963.1, 985.1, 1007.3, 1029.5]
    assert _split_blocks(ys, [907.7, 1007.3]) == [0, 0, 0, 0, 0, 0, 1, 1, 1]
    # 963.1은 907.7보다 1007.3에 가깝지만(55 vs 44) 블록 중심으로는 앞 덩어리다
    assert abs((ys[0] + ys[5]) / 2 - 907.7) < 1
