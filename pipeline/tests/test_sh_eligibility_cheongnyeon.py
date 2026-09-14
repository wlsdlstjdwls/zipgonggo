"""SH 청년 매입임대주택 공고문 「신청자격」 파서 회귀. 정답지는 2026년 1차(306214) 22~28쪽, 2024년 2차(282650) 15~19쪽 XML.

값은 공고문 원문과 대조했다(2026-09-14). 장기전세·행복주택·장기미임대 파서가 전부 None을 돌려주던 네 번째 양식이다.
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_eligibility import parse_eligibility, verify_income_table
from zipgonggo_pipeline.parsers.sh_eligibility_cheongnyeon import _fix_pct

FIX = Path(__file__).parent / "fixtures"
BASE_2025 = {1: 3813363, 2: 5866270, 3: 8168429, 4: 8802202, 5: 9326985, 6: 9906263, 7: 10651279}


def pages(seq: str, nums):
    d = FIX / f"ish_{seq}"
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


@pytest.fixture(scope="module")
def c26():
    e = parse_eligibility(pages("306214", range(22, 29)))
    assert e is not None
    return e


@pytest.fixture(scope="module")
def c24():
    e = parse_eligibility(pages("282650", range(15, 20)))
    assert e is not None
    return e


def rows(e):
    return e.rank_tables[0]["rows"]


# ── 2026년 1차 ──────────────────────────────────────────────


def test_kind_and_pages(c26):
    assert c26.kind == "cheongnyeon"
    assert c26.class_blocks == []
    assert c26.source_pages == [22, 25, 26, 27, 28]


def test_applicant_types(c26):
    names = [t["name"] for t in c26.applicant_types]
    assert names == ["대학생", "취업준비생", "청년", "이공계인재"]
    by = {t["name"]: t["text"] for t in c26.applicant_types}
    assert by["청년"] == "만19세이상~만39세이하인자"
    assert by["취업준비생"].startswith("대학또는「초 중등교육법」에따른고등 고등기술학교를졸업(졸업유예자포함)하거나중퇴후")
    assert by["취업준비생"].endswith("2년이내인사람으로서직장에재직중이지않은자")
    # 표 위 글머리의 이어지는 줄(「유형 한 가지를 선택하여 신청」)이 요건에 섞이면 안 된다
    assert "선택하여" not in by["대학생"]


def test_rank_rows(c26):
    r = rows(c26)
    assert [(x["rank"], x["label"]) for x in r] == [
        (1, "생계 의료 주거급여 수급자가구"), (1, "지원대상 한부모가족"), (1, "차상위계층 가구"), (2, "일반"), (3, "일반"),
    ]
    # 1순위: 소득·자산 없음. 주석(※)은 요건과 갈라 note로 — 이어지는 줄까지
    assert r[0]["income_pct"] is None and r[0]["asset_man"] is None
    assert r[0]["requirement"] == "「국민기초생활보장법」제7조에따른생계의료주거급여중어느 하나에해당하는급여를받는수급자가구"
    assert r[0]["note"].endswith("등록등본표에등재된신청자의부모")
    assert r[2]["note"] == "차상위계층자격인정범위:신청자본인 혹은신청자와동일한 주민등록등본표에등재된신청자의부모"
    # 2순위: 본인과 부모 소득 100%, 국민임대 자산 기준
    assert (r[3]["income_pct"], r[3]["income_scope"], r[3]["asset_man"], r[3]["car_man"]) == (100, "본인과 부모", 34500, 4542)
    # 3순위: 본인 소득 100%, 행복주택(청년) 자산 기준. 「12순위」는 「1,2순위」로
    assert (r[4]["income_pct"], r[4]["income_scope"], r[4]["asset_man"], r[4]["car_man"]) == (100, "본인", 25100, 4542)
    assert r[4]["requirement"].startswith("1,2순위에해당하지아니하는사람중")


def test_asset(c26):
    assert c26.asset == {
        "columns": ["2순위", "3순위"],
        "rows": [{"label": "총자산", "values_man": [34500, 25100]}, {"label": "자동차", "values_man": [4542, 4542]}],
    }


def test_income_table_verified(c26):
    t = c26.income_table
    assert t["households"] == [1, 2, 3]
    assert t["bump"] == {"1": 20, "2": 10}
    assert [(r["pct"], r["won"]) for r in t["rows"]] == [
        (50, [2669354, 3519762, 4084215]),
        (100, [4576036, 6452897, 8168429]),
    ]
    checked = verify_income_table(t, BASE_2025)
    assert checked["verified"] is True and checked["clean"] == 6 and checked["mismatches"] == []
    # 순위별 가구원 산정 각주 셋 — 화면이 「2순위는 본인과 부모, 3순위는 1인 기준」을 설명할 때 쓴다
    assert len(t["notes"]) == 3
    assert t["notes"][0].startswith("1순위신청자는")
    assert "본인과부모를포함" in t["notes"][1]
    assert "1인가구기준" in t["notes"][2]


def test_selection(c26):
    assert len(c26.selection) == 1
    s = c26.selection[0]
    assert [r["group"] for r in s["rows"]] == ["서류심사대상자선정", "당첨자선정"]
    assert s["rows"][0]["steps"] == ["신청자신청순위", "배점표합산", "최대6배수선정(동점자모두서류대상자선발)"]
    assert s["rows"][1]["steps"] == ["신청자신청순위", "배점표합산", "배점표각호의순서대로고득점자", "무작위전산추첨"]
    assert "무작위" in s["tie_break"]


def test_score_table(c26):
    assert len(c26.score_tables) == 1
    t = c26.score_tables[0]
    assert t["points"] == [3, 2, 1]
    items = t["items"]
    assert [i["label"][:1] for i in items] == ["①", "②", "③", "④", "⑤", "⑥", "⑦"]
    # 적용대상 병합 칸: 「1순위」가 ①②, 「공통」이 ④⑤에 걸친다
    assert [i["target"] for i in items] == ["1순위", "1순위", "공통", "공통", "공통", "2,3순위", "공통"]
    # 점수 칸: ①은 3점, ③은 2점, ⑤는 1점 칸에만 글이 있다
    assert items[0]["cells"][0].startswith("「국민기초생활보장법」") and items[0]["cells"][1] == "" and items[0]["cells"][2] == ""
    assert items[2]["cells"] == ["", "신청자의부모가무주택자인경우", ""]
    assert items[4]["cells"][2].startswith("「장애인복지법」") and items[4]["cells"][0] == ""
    assert items[5]["label"] == "⑥소득기준 50% 이하"
    # ⑦ 청약저축: 세 줄이 3·2·1점 칸으로 갈린다. 라벨 안의 ※는 note로
    assert items[6]["cells"] == ["가24회이상", "나.12회이상24회미만", "다6회이상12회미만"]
    assert items[6]["label"].startswith("⑦청약저축") and "납입횟수" in items[6]["label"]
    assert items[6]["note"] == "신청자명의통장의 인정회차기준"
    # 칸 안의 ※(인정범위)는 항목 note로 — 칸 글은 요건만
    assert "※" not in items[0]["cells"][0] and "인정범위" in items[0]["note"]
    # 표 아래 각주(※, 본문 왼끝)는 notes로
    assert len(c26.notes) == 3 and c26.notes[0].startswith("청약신청 시")


# ── 2024년 2차 — 같은 양식, 값과 잔조판이 다르다 ───────────────


def test_2024_layout(c24):
    assert c24.kind == "cheongnyeon"
    assert [t["name"] for t in c24.applicant_types] == ["대학생", "취업준비생", "청년"]   # 이공계인재는 2026년에 생겼다
    r = rows(c24)
    assert [(x["rank"], x["label"]) for x in r][:3] == [(1, "생계 의료 주거급여 수급자가구"), (1, "지원대상 한부모가족"), (1, "차상위계층 가구")]
    assert (r[3]["asset_man"], r[3]["car_man"], r[4]["asset_man"]) == (34500, 3708, 27300)
    assert [(x["pct"], x["won"]) for x in c24.income_table["rows"]] == [
        (50, [2438075, 3249427, 3599325]),
        (100, [4179557, 5957283, 7198649]),
    ]
    # 2024년은 「[서류심사대상자선정] …」 첫 줄이 다음 줄(「(동점자모두서류대상자선발)」)로 이어진다
    s = c24.selection[0]
    assert s["rows"][0]["steps"][-1] == "최대6배수선정 (동점자모두서류대상자선발)"
    t = c24.score_tables[0]
    assert t["items"][0]["label"] == "①생계 의료급여 수급자"
    assert [i["target"] for i in t["items"]] == ["1순위", "1순위", "공통", "공통", "공통", "2,3순위", "공통"]
    assert t["items"][6]["cells"] == ["가24회이상", "나12회이상24회미만", "다.6회이상12회미만"]
    # 「※ ‘부모무주택’ 가점의 경우 …」는 이 해엔 표 아래 각주다
    assert c24.notes[0].startswith("‘부모무주택’")


def test_fix_pct_synap_drop():
    # Synap이 「100%」의 0을 떨어뜨리면 「10%」 — 이 양식에 10% 기준은 없으니 100으로 되메운다
    assert _fix_pct(10) == 100
    assert _fix_pct(50) == 50 and _fix_pct(100) == 100 and _fix_pct(None) is None
