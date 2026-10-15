"""구청 수요자 맞춤형 호실표 — 311549 성북구 도전숙 공실세대(원본 PDF 2~3쪽, 41호실)가 정답지."""

from pathlib import Path

from zipgonggo_pipeline.parsers.sh_custom_table import parse_custom_pdf

# .pdf로 두면 사내 DRM이 몇 분 뒤 파일을 감싸 버린다 — .xlsx.bin처럼 확장자를 바꿔 둔다
FIX = Path(__file__).parent / "fixtures" / "ish_311549_pdf" / "doc.pdf.bin"
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


# ── 손으로 옮긴 호실표(pipeline/manual/units) ─────────────────────────
import json

from zipgonggo_pipeline.parsers.sh_custom_table import from_manual

MANUAL = Path(__file__).parents[1] / "manual" / "units"


def _manual(seq: str):
    return json.loads((MANUAL / f"{seq}.json").read_text(encoding="utf-8"))


def test_manual_gangdong_matches_notice_counts():
    doc = _manual("311087")
    got = from_manual(doc, doc["title"])
    # 공고문 「총 7개소 37호실 — 암사도전숙 11, 강동드론마을 4, 천호예가 2, 청년안테나 4, 천호도전숙 9, 청년예가 2, 성내도전숙 5」
    assert got["totals"]["supply_count"] == 37 and len(got["units"]) == 37
    by = {}
    for c in got["complexes"]:
        key = c["name"].split()[0]
        by[key] = by.get(key, 0) + c["unit_count"]
    assert by == {"암사도전숙": 11, "강동드론마을": 4, "천호예가": 2, "청년안테나": 4, "천호도전숙": 9, "청년예가": 2, "성내도전숙": 5}
    # 50% 초과 계층이 언제나 더 비싸다 — 옮겨 적다 칸을 바꿔 쓰면 여기서 걸린다
    for u in got["units"]:
        a, b = u["price_tiers"]
        assert a["deposit"] < b["deposit"] and a["rent"] < b["rent"], u["unit_key"]


def test_manual_rejects_other_title():
    doc = _manual("311349")
    assert from_manual(doc, "은평구 다른 주택 잔여세대 모집 공고") is None
    got = from_manual(doc, doc["title"])
    assert [(u["room"], u["room_layout"], u["deposit"]) for u in got["units"]] == [("301", "여성", 8_820_000), ("401", "남성", 14_100_000)]
