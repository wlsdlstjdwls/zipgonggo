"""구청 수요자 맞춤형 호실표 — 311549 성북구 도전숙 공실세대(원본 PDF 2~3쪽, 41호실)가 정답지."""

from pathlib import Path

from zipgonggo_pipeline.parsers.sh_custom_table import parse_custom_pdf

FIX = Path(__file__).parent / "fixtures" / "ish_311549_pdf" / "doc.pdf"
TITLE = "성북구 도전숙(수요자맞춤) 잔여세대 입주자 모집 공고"


def _got():
    return parse_custom_pdf(FIX.read_bytes(), TITLE)


def test_counts_match_notice_header():
    got = _got()
    # 공고문 머리 「공급호수 : 총 41세대」, 「도전숙 공실세대 : 41세대(1인형 37세대 부부형 4세대)」
    assert got["totals"]["supply_count"] == 41
    assert len(got["units"]) == 41
    assert len(got["complexes"]) == 12
    assert sum(1 for u in got["units"] if u["room_layout"] == "부부형") == 4


def test_tiers_and_amounts():
    got = _got()
    assert got["tiers"] == ["소득 50% 이하", "소득 50% 초과 100% 이하"]
    u = next(u for u in got["units"] if u["complex_name"] == "도전숙 1호" and u["room"] == "203")
    assert u["area_m2"] == 14.27
    assert [(t["deposit"], t["rent"]) for t in u["price_tiers"]] == [(13_360_000, 74_900), (16_520_000, 92_300)]
    u = next(u for u in got["units"] if u["complex_name"] == "도전숙 15호")
    assert (u["deposit"], u["rent"]) == (28_560_000, 294_300)


def test_same_address_two_names_stay_apart():
    # 8호와 9호는 같은 지번(장위로19길 25)이다 — 원문 띄어쓰기(「장위로 19길 25」)가 달라도 도로명은 한 꼴로
    got = _got()
    by = {c["name"]: c for c in got["complexes"]}
    assert by["도전숙 8호"]["road_address"] == by["도전숙 9호"]["road_address"] == "성북구 장위로19길 25"
    assert (by["도전숙 8호"]["unit_count"], by["도전숙 9호"]["unit_count"]) == (1, 2)
    assert by["도전숙 10호"]["road_address"] == "성북구 보문로13다길 7-6"
