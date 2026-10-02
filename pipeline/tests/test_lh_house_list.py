"""LH 첨부 「공급주택목록」(xlsx) 파서 회귀. 정답지는 2026-10-02에 받은 원문 넷. 네트워크 없음.

    21370  서울 든든전세    한 줄 머리 · 월임대료 칸 없음 · 동이 갈린 단지(시온그랜드빌 101/102동)
    21299  인천 신혼신생아1 두 줄 머리(위: 계층, 아래: 금액) · 금액 묶음 둘
    21098  제주 신혼신생아1 제주시(17)·서귀포시(8) 두 공고가 같이 붙인 합본 · 주소에 시도가 없다
    21187  경남 신혼신생아2 주택군이 「경남 창원시(진해)」 꼴(괄호가 지역) · 괄호 겹친 주소
"""

from decimal import Decimal
from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.lh_house_list import _clean_name, build_rows, parse_house_list
from zipgonggo_pipeline.sources.lh import LhAttachment, find_attachments, pan_id
from zipgonggo_pipeline.stages.s3_lh_units import only_region

FIX = Path(__file__).parent / "fixtures" / "lh_house_list"


def load(name: str):
    # 확장자가 .xlsx.bin인 건 이 저장소를 여는 회사 PC의 문서보안(DRM)이 .xlsx를 OLE로 암호화해 버려서다(2026-10-02).
    # 그래도 걸리면 zip이 아니게 된다 — 파서 회귀가 아니라 파일이 바뀐 것이니 그렇게 알린다
    data = (FIX / f"{name}.bin").read_bytes()
    assert data[:2] == b"PK", f"{name}: zip이 아니다 — DRM이 암호화했을 수 있다. git checkout으로 되돌릴 것"
    return parse_house_list(data)


@pytest.fixture(scope="module")
def seoul():
    return load("21370_seoul_deundeun.xlsx")


def test_seoul_row_count_matches_supply(seoul):
    # 마이홈 API sumSuplyCo 56호와 같다
    assert len(seoul) == 56


def test_seoul_first_row(seoul):
    u = seoul[0]
    assert u.address == "서울특별시 강동구 명일로10가길 10(둔촌동,은슬림 둔촌)"
    assert (u.dong, u.ho, u.floor, u.rooms) == ("101", "202", 2, 3)
    assert u.area == Decimal("54.18")
    assert u.deposit == 342_280_000
    # 든든전세는 월임대료 칸이 없다 — 0으로 지어내지 않는다
    assert u.rent is None
    assert u.house_type == "도시형생활주택"


def test_seoul_numeric_ho_is_not_float(seoul):
    # 엑셀이 호를 숫자 304로 들고 있는 줄이 있다 — 「304.0」이 되면 안 된다
    assert {u.ho for u in seoul if u.address.startswith("서울특별시 강서구")} == {"304", "506"}


def test_seoul_complexes(seoul):
    complexes, rows = build_rows(seoul, default_sido="서울특별시")
    assert len(complexes) == 25 and len(rows) == 56
    by = {c["name"]: c for c in complexes}
    # 주소 괄호의 건물명이 단지 이름이다. 도로명주소는 시군구부터(시도는 sido 칸)
    assert by["은슬림 둔촌"]["road_address"] == "강동구 명일로10가길 10(둔촌동,은슬림 둔촌)"
    assert by["은슬림 둔촌"]["sigungu"] == "강동구"
    # 101동·102동이 갈려도 번지가 같으면 한 단지
    assert by["시온그랜드빌"]["unit_count"] == 2
    assert by["미래하이츠"]["unit_count"] == 16
    assert by["미래하이츠"]["min_deposit"] == 300_800_000
    # 다른 구의 같은 이름은 아니지만 띄어쓰기만 다른 두 단지(「양지 쉐르빌」 광진 / 「양지쉐르빌」 노원)는 둘 다 산다
    assert {"양지 쉐르빌", "양지쉐르빌"} <= set(by)
    assert len({r["unit_key"] for r in rows}) == len(rows)


def test_seoul_unit_rows(seoul):
    _, rows = build_rows(seoul, default_sido="서울특별시")
    r = rows[0]
    assert r["unit_key"] == "은슬림 둔촌-101-202"
    assert (r["elevator"], r["has_elevator"], r["room_layout"]) == ("설치", True, "방3개")
    assert (r["nc_name"], r["nc_road"]) == ("은슬림 둔촌", r["road_address"])


def test_two_row_header_takes_first_money_group():
    units = load("21299_incheon_newlywed1.xlsx")
    assert len(units) == 77
    u = units[0]
    # 위 줄 「신혼부부1수급자등」 아래의 기본임대보증금·기본월임대료. 「상한임대보증금」은 이름이 달라 안 걸린다
    assert u.tier == "신혼부부1수급자등"
    assert (u.deposit, u.rent) == (5_737_000, 143_590)
    assert u.jibun == "인천광역시 검단구 마전동 일반번지 1126-16"
    complexes, _ = build_rows(units, default_sido="인천광역시")
    assert complexes[0]["name"] == "힐스타운" and complexes[0]["sigungu"] == "검단구"


def test_jeju_combined_file_is_filtered_by_notice_region():
    units = load("21098_jeju_combined.xlsx")
    assert len(units) == 25
    assert len(only_region(units, "제주시")) == 17
    assert len(only_region(units, "서귀포시")) == 8
    # 시군구를 모르는 공고는 거르지 않는다
    assert len(only_region(units, None)) == 25
    # 하나도 안 맞으면 거르지 않는다 — 표기가 달라 못 맞춘 것이지 집이 없는 게 아니다
    assert len(only_region(units, "강남구")) == 25


def test_jeju_sido_falls_back_to_notice():
    complexes, _ = build_rows(load("21098_jeju_combined.xlsx"), default_sido="제주특별자치도")
    assert {c["sido"] for c in complexes} == {"제주특별자치도"}
    # 괄호 없이 번지 뒤에 붙은 건물명
    assert complexes[0]["name"] == "하귀 수하우스"


def test_region_group_is_not_a_name():
    complexes, _ = build_rows(load("21187_gyeongnam_newlywed2.xlsx"), default_sido="경상남도")
    names = [c["name"] for c in complexes]
    # 「경남 창원시(진해)」의 「진해」를 이름으로 쓰지 않는다
    assert not {"창원", "마산", "진해"} & set(names)
    assert names[0] == "창원무동휴먼빌아파트"


@pytest.mark.parametrize("raw,want", [
    ("시온빌라트 B동", "시온빌라트"),
    ("천수빌A동", "천수빌"),
    (", 타워팰리스 (대도동 126-11)", "타워팰리스"),
    ("코아루드림 102", "코아루드림"),
    ("101동 (용문센트럴뷰", "용문센트럴뷰"),
    ("장성동 1386-14", None),
    ("춘천시 동면", None),
    ("(동천동 972, 101동)", None),
])
def test_clean_name(raw, want):
    assert _clean_name(raw) == want


def test_find_attachments_and_pan_id():
    html = (
        "<a href=\"#\" onclick=\"fileDownLoad('68775511');\">26년_2차_주택목록(서울지역본부).xlsx</a>"
        "<a onclick=\"fileDownLoad('68818385');\">공고문.pdf</a>"
        "fileDownLoad(\\''+list[i].cmnAhflSn+'\\')\">'+list[i].cmnAhflNm+'"
    )
    atts = find_attachments(html)
    assert [a.file_id for a in atts] == ["68775511", "68818385"]
    assert [a.is_house_list for a in atts] == [True, False]
    assert not LhAttachment("1", "보유주택목록.pdf").is_house_list
    url = "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=2015122300020843&mi=1026"
    assert pan_id(url) == "2015122300020843"
