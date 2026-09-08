"""S1 매핑 단위 테스트. 네트워크·DB 없음. 입력은 docs/api-spec/samples 실응답."""

import json
from datetime import date
from pathlib import Path

import pytest

from zipgonggo_pipeline.stages.s1_collect import (
    UnmappedHousingType,
    derive_status,
    fingerprint,
    group_items,
    make_slug,
    map_notice,
    money,
    parse_date,
)

SAMPLE = Path(__file__).resolve().parents[2] / "docs" / "api-spec" / "samples" / "HWSPR02_rsdtRcritNtcList.json"
TODAY = date(2026, 9, 8)


def load_items():
    return json.loads(SAMPLE.read_text(encoding="utf-8"))["response"]["body"]["item"]


def test_sample_apartment_row_maps_all_fields():
    items = load_items()
    apt = next(i for i in items if i["houseTyNm"] == "아파트")
    m = map_notice([apt], TODAY)
    n = m.notice
    assert n["source"] == "myhome_api"
    assert n["source_key"] == f"{apt['pblancId']}:{apt['houseSn']}"
    assert n["housing_type"] == apt["suplyTyNm"]
    assert n["house_type"] == "아파트"
    assert n["pnu"] == apt["pnu"] and len(n["pnu"]) == 19
    assert n["address"] == apt["fullAdres"].strip()
    assert n["posted_at"] == parse_date(apt["rcritPblancDe"])
    assert n["apply_start_at"] == parse_date(apt["beginDe"])
    assert n["min_deposit"] == apt["rentGtn"]
    assert n["min_rent"] == apt["mtRntchrg"]
    assert n["portal_url"] == apt["pcUrl"]
    assert n["raw"] == {"items": [apt]}
    assert n["slug"].startswith("lh-2026-")
    assert len(m.areas) == 1 and m.areas[0]["sigungu"] == apt["signguNm"]


def test_sample_purchase_rental_row_has_null_address_and_money():
    items = load_items()
    row = next(i for i in items if i["houseTyNm"] == "다가구주택")
    n = map_notice([row], TODAY).notice
    assert n["address"] is None and n["pnu"] is None and n["complex_name"] is None
    assert n["sigungu"] is None
    assert n["min_deposit"] is None and n["min_rent"] is None  # 0 → 미기재
    assert n["supply_count"] == row["sumSuplyCo"]


def test_grouping_merges_sigungu_rows_into_one_notice():
    base = load_items()[0]
    rows = [
        {**base, "signguNm": "광명시", "sumSuplyCo": 10},
        {**base, "signguNm": "군포시", "sumSuplyCo": 5},
        {**base, "signguNm": "", "sumSuplyCo": 0},
    ]
    groups = group_items(rows)
    assert len(groups) == 1
    m = map_notice(next(iter(groups.values())), TODAY)
    assert m.notice["supply_count"] == 15
    assert m.notice["sigungu"] is None
    assert [(a["sigungu"], a["supply_count"]) for a in m.areas] == [("광명시", 10), ("군포시", 5), (None, None)]
    assert len(m.notice["raw"]["items"]) == 3


def test_unmapped_housing_type_raises():
    row = {**load_items()[0], "suplyTyNm": "신개념임대"}
    with pytest.raises(UnmappedHousingType):
        map_notice([row], TODAY)


@pytest.mark.parametrize(
    ("src", "begin", "end", "today", "expected"),
    [
        ("일반공고", date(2026, 9, 28), date(2026, 9, 30), date(2026, 9, 8), "공고중"),
        ("일반공고", date(2026, 9, 28), date(2026, 9, 30), date(2026, 9, 28), "접수중"),
        ("일반공고", date(2026, 9, 28), date(2026, 9, 30), date(2026, 10, 1), "접수마감"),
        ("정정공고", date(2026, 9, 28), date(2026, 9, 30), date(2026, 9, 8), "정정공고중"),
        ("정정공고", date(2026, 9, 28), date(2026, 9, 30), date(2026, 10, 1), "접수마감"),
        (None, None, None, date(2026, 9, 8), "공고중"),
    ],
)
def test_status_rules(src, begin, end, today, expected):
    assert derive_status(src, begin, end, today) == expected


def test_helpers():
    assert parse_date("20260907") == date(2026, 9, 7)
    assert parse_date("") is None and parse_date(None) is None
    assert money(0, zero_is_null=True) is None and money(0, zero_is_null=False) == 0
    assert money("", zero_is_null=False) is None
    assert make_slug("LH", date(2026, 9, 7), "21174", 1, "매입임대") == "lh-2026-21174-1-maeip"
    assert make_slug("충남개발공사", date(2026, 9, 7), "9", 0, "국민임대") == "충남개발공사-2026-9-0-gungmin"
    assert fingerprint("LH", "t", date(2026, 9, 7), 0) == fingerprint("LH", "t", date(2026, 9, 7), "")
    assert fingerprint("LH", "t", date(2026, 9, 7), 1) != fingerprint("LH", "t", date(2026, 9, 7), 2)
    assert fingerprint("LH", "t", date(2026, 9, 7), 1) != fingerprint("LH", "t", date(2026, 9, 7), 1, "21164:1")


def test_amendment_gets_distinct_fingerprint_and_link():
    base = load_items()[0]
    orig = {**base, "pblancId": "21164", "sttusNm": "일반공고", "beforePblancId": ""}
    amend = {**base, "pblancId": "21169", "sttusNm": "정정공고", "beforePblancId": "21164"}
    a, b = map_notice([orig], TODAY).notice, map_notice([amend], TODAY).notice
    assert a["fingerprint"] != b["fingerprint"]
    assert b["amends_source_key"] == a["source_key"]
    assert b["status"] == "정정공고중"
