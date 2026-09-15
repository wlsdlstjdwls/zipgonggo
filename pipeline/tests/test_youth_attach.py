"""청년안심주택(민간임대) 첨부 공고문 표 파서. 픽스처는 pdfplumber가 잡은 표(RawTable)를 JSON으로 굳힌 것 —
PDF 원본은 pipeline/data/youth/(커밋 안 함). 다시 만들려면 tables_from_pdf → dump_tables."""

import json
from decimal import Decimal
from pathlib import Path

from zipgonggo_pipeline.parsers.youth_attach import (
    YouthAttachFacts, fill_missing_class, lines_from_tables, load_tables, supply_rows, unit_rows,
)

FIX = Path(__file__).parent / "fixtures" / "youth_attach"


def lines(name):
    return lines_from_tables(load_tables((FIX / f"{name}.json").read_text(encoding="utf-8")))


def test_standard_two_tables_special_and_general():
    """2026 맹그로브창천 최초모집 — 특별/일반 두 표, (단위 : 만원), 타입 「26A-1」, 비율 30/50/70."""
    ls = lines("2026_mangrove_first")
    assert len(ls) == 11
    sp = [x for x in ls if x.supply_kind == "특별공급"]
    ge = [x for x in ls if x.supply_kind == "일반공급"]
    assert len(sp) == 5 and len(ge) == 6
    first = sp[0]
    assert first.tenant_class == "청년" and first.area == Decimal("23.20") and first.type_code == "26A-1"
    assert first.count == 30 and not first.reserve_only and first.page == 8
    assert [(o.label, o.ratio, o.deposit, o.rent) for o in first.options] == [
        ("30%", 30, 77_900_000, 750_000), ("50%", 50, 129_900_000, 540_000), ("70%", 70, 181_900_000, 320_000),
    ]
    assert first.base.deposit == 77_900_000
    facts = YouthAttachFacts(lines=ls)
    assert (facts.min_deposit, facts.max_deposit, facts.min_rent, facts.max_rent) == (77_900_000, 246_000_000, 320_000, 1_000_000)
    assert (facts.area_min, facts.area_max) == (Decimal("23.20"), Decimal("29.90"))
    # 같은 타입이 특별·일반에 다 있어도 income_option(특별/일반)이 갈라 준다
    rows = supply_rows(facts, complex_name="맹그로브창천", is_new=True)
    assert len(rows) == 11
    r = next(x for x in rows if x["supply_type"] == "26A-1" and x["income_option"] == "일반공급")
    assert r["units_total"] == 29 and r["deposit"] == 92_600_000 and r["rent"] == 900_000 and r["is_new"]
    assert json.loads(r["deposit_options"])[2] == {"label": "70%", "ratio": 70, "deposit": 216_000_000, "rent": 380_000}
    assert unit_rows(facts, complex_name="x", road_address="r", sido="s", sigungu="g") == []


def test_additional_with_floor_and_move_in_in_won():
    """2026 우장산역 해링턴타워 추가 — (단위 : 원), 층수·계약개시일 열, 「예비자」 줄, 유형 칸 세로 병합."""
    ls = lines("2026_harrington_add")
    assert len(ls) == 9
    reserve = [x for x in ls if x.reserve_only]
    assert len(reserve) == 7 and all(x.count == 0 for x in reserve)
    real = [x for x in ls if not x.reserve_only]
    assert [(x.type_code, x.count, x.floor, x.move_in, x.supply_kind, x.tenant_class) for x in real] == [
        ("23A", 1, 11, "26.10.26", "특별공급", "청년"), ("43C", 1, 12, "26.10.30", "특별공급", "청년/신혼부부"),
    ]
    assert real[0].options[0].deposit == 45_440_000 and real[0].options[0].rent == 303_600 and real[0].options[0].ratio == 40
    # 소계 줄 뒤 첫 줄은 앞 묶음의 유형을 물려받지 않는다
    assert ls[3].supply_kind == "특별공급" and ls[3].type_code == "17"


def test_room_rows_become_units():
    """2026 쌍문역 인히어쌍문 추가 — 호실 단위 표. 「옵션」 열의 비율, 같은 타입은 notice_supply 한 줄로 합친다."""
    ls = lines("2026_inhere_add")
    assert [x.room for x in ls] == ["1701", "1704", "1609", "1518", "510", "311", "1111", "417"]
    assert ls[0].floor == 17 and ls[4].floor == 5
    assert ls[5].options[0].ratio == 30 and ls[5].options[0].deposit == 28_800_000
    facts = YouthAttachFacts(lines=ls)
    us = unit_rows(facts, complex_name="인히어쌍문", road_address="도봉구 쌍문동 1", sido="서울특별시", sigungu="도봉구")
    assert len(us) == 8 and us[0]["unit_key"] == "1701" and us[0]["area_m2"] == Decimal("36") and us[0]["deposit"] == 74_480_000
    rows = supply_rows(facts, complex_name="인히어쌍문", is_new=False)
    assert len(rows) == 5
    b1 = next(r for r in rows if r["supply_type"] == "B1")
    assert b1["units_total"] == 3 and b1["deposit"] == 28_800_000  # 세 호실 중 보증금이 가장 낮은 30% 옵션
    assert len(json.loads(b1["deposit_options"])) == 3


def test_two_class_columns_and_all_reserve():
    """2026 청량리역 퀸즈W 추가 — 유형 칸이 「청년 | 일반공급」 둘, 호수 열에 「예비자」뿐."""
    ls = lines("2026_queensw_add")
    assert [(x.tenant_class, x.supply_kind, x.type_code) for x in ls] == [
        ("청년", "일반공급", "25A"), ("신혼부부", "특별공급", "53A"),
        ("청년/신혼부부", "일반공급", "52A"), ("청년/신혼부부", "일반공급", "51B"), ("청년/신혼부부", "일반공급", "53A"),
    ]
    assert all(x.reserve_only and x.count == 0 for x in ls)
    assert ls[0].options[0].deposit == 88_000_000 and ls[0].options[2].rent == 450_000   # 만원 → 원


def test_2022_house_type_form_kind_in_header():
    """2022 포레나 당산 — 「주택형 | 특별공급」 머리, 「17m2형」, [단위 : 만원]. pdfplumber가 양끝 열을 떨어뜨려
    공급대상은 표 제목(청년(135세대), 신혼부부(192세대))으로 채우고 50% 임대료는 비는 걸 그대로 둔다."""
    ls = lines("2022_forena_first")
    assert [(x.tenant_class, x.supply_kind, x.supply_type, x.count) for x in ls[:2]] == [
        ("청년", "특별공급", "17", 82), ("청년/신혼부부", "일반공급", "17", 135),
    ]
    assert ls[0].options[0].deposit == 58_000_000 and ls[0].options[0].rent == 370_000
    assert ls[0].options[2].rent is None


def test_2020_two_column_layout_thousand_won_headers():
    """2020 서초꽃마을 — 2단 조판, 비율마다 「계 | 계약금 | 잔금 | 월임대료」, 열 머리 단위 없음(크기로 만원)."""
    ls = lines("2020_seocho_first")
    assert [(x.tenant_class, x.supply_kind, str(x.area), x.count) for x in ls] == [
        ("청년", "일반공급", "16.63", 119), ("신혼부부", "일반공급", "30.89", 30), ("신혼부부", "일반공급", "32.41", 20),
        ("청년", "특별공급", "16.63", 43),
    ]
    assert [(o.label, o.deposit, o.rent) for o in ls[0].options] == [
        ("30%", 51_000_000, 530_000), ("35%", 59_000_000, 500_000), ("40%", 67_000_000, 460_000),
    ]


def test_2021_fixed_amount_option():
    """2021 화곡역 포르투나 블루 — 「구분 | 전용면적 | 세대수」, 「보증금 9000만원」 고정액 옵션과 「보증금 90%」."""
    ls = lines("2021_fortuna_first")
    assert ls[0].tenant_class == "1인가구" and ls[0].supply_kind == "특별공급" and ls[0].supply_type == "20.08"
    labels = [o.label for o in ls[0].options]
    assert labels == ["30%", "35%", "40%", "9000만원"]
    fixed = ls[0].options[3]
    assert fixed.ratio is None and fixed.deposit == 90_000_000 and fixed.rent == 240_000
    assert ls[3].tenant_class == "신혼부부" and ls[3].options[-1].label == "90%" and ls[3].options[-1].rent == 80_000


def test_room_only_table_without_count_column_merged_area():
    """2026 회기역 휘경제이스카이시티 — 「각세대 호실명」 열만 있고 호수 열이 없다(호실 = 1호), 면적 칸 세로 병합(703호),
    「청년⏎특별」처럼 「공급」 없는 구분, 「청년⏎&⏎신혼⏎부부」, 만원 소수 임대료 「40.2」."""
    ls = lines("2026_hwigyeong_add")
    assert [(x.room, x.tenant_class, x.supply_kind, str(x.area), x.type_code, x.count) for x in ls] == [
        ("1106", "청년", "특별공급", "14", "특D", 1), ("408", "청년", "특별공급", "17", "특B", 1),
        ("502", "청년", "일반공급", "29", "B1", 1), ("504", "청년/신혼부부", "일반공급", "30", "A", 1),
        ("703", "청년/신혼부부", "일반공급", "30", "A", 1), ("609", "청년/신혼부부", "일반공급", "32", "C", 1),
    ]
    assert ls[1].options[0].rent == 402_000 and ls[1].options[0].deposit == 76_000_000


def test_room_in_area_cell_without_area():
    """2026 노량진역 더써밋타워 — 면적 칸에 「단층형 1201호」만. 1201의 120을 면적으로 읽지 않는다."""
    ls = lines("2026_summit_add")
    assert [(x.room, x.area, x.supply_type, x.floor) for x in ls] == [
        ("1201", None, "미상", 12), ("2117", None, "미상", 21), ("2310", None, "미상", 23), ("1313", None, "미상", 13),
    ]
    facts = YouthAttachFacts(lines=ls)
    assert unit_rows(facts, complex_name="x", road_address="r", sido="s", sigungu="g") == []   # 면적 없이는 호실 행을 안 만든다


def test_unit_label_mismatch_falls_back_to_won():
    """2026 개봉역 세이지움 개봉 — 「(단위 : 만원)」 밑에 원 단위 금액(100,000,000 · 334100). 배율 결과가 범위를 벗어나면 원으로 본다."""
    ls = lines("2026_sageum_gaebong_add")
    assert len(ls) == 7 and all(x.room for x in ls)
    assert (ls[0].options[0].deposit, ls[0].options[0].rent) == (100_000_000, 273_500)
    assert (ls[2].options[0].deposit, ls[2].options[0].rent) == (84_000_000, 334_100)
    assert ls[0].room == "732" and ls[0].floor == 7 and ls[0].type_code == "18B"


def test_area_header_containing_hosu_is_area_not_count():
    """2026 태릉입구역 이니티움 — 머리 「주거전용(타입)호수」는 면적 열이다. 「(55형)」 → 55."""
    ls = lines("2026_initium_add")
    assert [(x.room, str(x.area), x.type_code, x.count, x.options[0].ratio, x.options[0].deposit) for x in ls] == [
        ("308", "41.68", "55", 1, 50, 171_000_000), ("805", "47.02", "67", 1, 50, 187_000_000),
    ]


def test_room_number_written_in_count_column():
    """2026 건대입구역 더포디엄830 — 「공급호수」 칸에 동호수(1810). 소계가 1이므로 호수 1, 호실 1810. 「청년 또는 신혼부부형(예비신혼포함)」."""
    ls = lines("2026_podium_add")
    assert [(x.room, x.count, x.tenant_class, x.supply_kind) for x in ls] == [
        ("1810", 1, "청년/신혼부부", "특별공급"), ("1503", 1, "청년", "일반공급"), ("2206", 1, "청년/신혼부부", "일반공급"),
    ]


def test_broken_comma_group_is_dropped():
    """2026 구산역 구산주택 — 「69,000,00」(0 하나 빠진 쉼표). 그 칸만 버리고 같은 줄의 35·40%는 살린다."""
    ls = lines("2026_gusan_add")
    row = next(x for x in ls if x.type_code == "33B" and x.supply_kind == "일반공급")
    assert [(o.label, o.deposit) for o in row.options] == [("35%", 80_000_000), ("40%", 91_000_000)]


def test_single_digit_ratio_header_is_dropped():
    """2026 광흥창역 이랜드PEER신촌 — 열 머리가 「보증금 3%」로 찍힌 오타(금액도 같이 틀렸다). 그 옵션만 버린다.
    같은 쪽 둘째·셋째 표는 표 위 띠가 앞 표 글자로 덮여 단위를 못 읽는다 — 첫 표의 「(단위 : 천 원)」을 물려받는다."""
    ls = lines("2026_peer_sinchon_add")
    assert [o.label for o in ls[2].options] == ["40%", "35%"]
    assert ls[0].options[0].deposit == 53_374_000    # 천원 단위가 살아 있다(만원으로 읽으면 5억이 된다)
    assert ls[1].options[0].deposit == 190_955_000 and ls[1].options[0].rent == 73_000


def test_decimal_comma_typo():
    """2026 회기역 하트리움 — 만원 단위 표에 「37,4」(37.4를 쉼표로). 374만이 아니라 37.4만이다."""
    ls = lines("2026_heartrium_hoegi_add")
    rents = {o.rent for x in ls for o in x.options if o.rent is not None}
    assert max(rents) == 390_000


def test_missing_class_inherits_from_other_table():
    """2026 장한평역 장안동 하트리움 — 예비자 표에 계층 열도 제목도 없다. 같은 공고의 다른 표가 한 계층만 말하면 물려받는다."""
    ls = fill_missing_class(lines("2026_heartrium_janghanpyeong_add"))
    assert {x.tenant_class for x in ls} == {"청년/신혼부부"}
