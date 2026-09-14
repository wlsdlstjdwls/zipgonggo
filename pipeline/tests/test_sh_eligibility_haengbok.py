"""SH 행복주택·매입임대 공고문 「신청자격」 파서 회귀. 정답지는 2026년 2차 행복주택(309337) 18~32쪽, 2026년 2차 장기미임대(310107) 6·8쪽 XML.

값은 공고문 원문과 대조했다(2026-09-14). 장기전세 파서(test_sh_eligibility.py)가 None을 돌려주던 두 양식이다.
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_eligibility import parse_eligibility, verify_income_table

FIX = Path(__file__).parent / "fixtures"
BASE_2025 = {1: 3813363, 2: 5866270, 3: 8168429, 4: 8802202, 5: 9326985, 6: 9906263, 7: 10651279}


def pages(seq: str, nums):
    d = FIX / f"ish_{seq}"
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


@pytest.fixture(scope="module")
def hb():
    # 1·11~15쪽(단지 표)을 섞어도 자격 절만 골라 읽어야 한다
    e = parse_eligibility(pages("309337", [1, 11, 12, 13, 14, 15, *range(18, 33)]))
    assert e is not None
    return e


@pytest.fixture(scope="module")
def mi():
    e = parse_eligibility(pages("310107", [6, 8]))
    assert e is not None
    return e


def block(e, name):
    hits = [c for c in e.class_blocks if c["name"] == name]
    assert len(hits) == 1, [c["name"] for c in e.class_blocks]
    return hits[0]


# ── 행복주택 ────────────────────────────────────────────────


def test_haengbok_kind_and_classes(hb):
    assert hb.kind == "haengbok"
    assert [c["name"] for c in hb.class_blocks] == ["대학생 계층", "청년 계층", "(예비)신혼부부 한부모가족 계층", "고령자", "주거급여수급자"]
    assert hb.source_pages == list(range(18, 33))
    assert hb.rank_tables == []


def test_haengbok_income_table_with_bump(hb):
    """1인 +20%p·2인 +10%p가 표에 직접 들어 있다. 1인은 100%만, 2인은 120%까지, 3인은 130%까지 칸이 있다."""
    t = hb.income_table
    assert t["households"] == [1, 2, 3, 4, 5]
    assert [r["pct"] for r in t["rows"]] == [100, 110, 120, 130, 140]
    assert t["bump"] == {"1": 20, "2": 10}
    assert t["rows"][0]["won"] == [4576036, 6452897, 8168429, 8802202, 9326985]
    assert t["rows"][2]["won"] == [None, 7626151, 9802115, 10562642, 11192382]
    assert t["rows"][4]["won"] == [None, None, None, 12323083, 13057779]
    assert t["per_person_won"] == {"100": 579278, "110": 637205, "120": 695133, "130": 753061, "140": 810989}
    v = verify_income_table(t, BASE_2025)
    assert v["verified"] and v["clean"] == 18 and v["mismatches"] == []
    # keep_blank: 원문에 없는 1인 110% 칸은 검산 뒤에도 비어 있다
    assert v["rows"][1]["won"][0] is None


def test_haengbok_income_conditions(hb):
    """조건 칸은 행마다 줄 수가 달라(120%는 7줄) 값 줄 사이 가장 넓은 틈으로 갈랐다."""
    conds = {r["pct"]: r["conditions"] for r in hb.income_table["rows"]}
    assert conds[100] == ["공통 (청년계층은 세대원인 경우 본인만 해당)"]
    assert conds[110] == ["공통 (2023년 3월 28일 이후 출생 자녀 1명)"]
    assert conds[120][0] == "공통"
    assert conds[120][1].startswith("① 2023년 3월 28일 이후 출생 자녀 1명")
    assert conds[120][-1] == "신혼부부 계층 (예비 포함 맞벌이인 경우)"
    assert conds[130] == ["신혼부부 계층 (맞벌이인 동시에 2023년 3월 28일 이후 출생자녀1명)"]
    assert conds[140][1].startswith("① 맞벌이인 동시에")
    assert conds[140][2].startswith("② 맞벌이인 동시에")   # 「가구당 월평균소득의 2 맞벌이인」 한 조각에서 갈라낸 것


def test_haengbok_asset_and_car(hb):
    a = hb.asset
    assert a["columns"] == ["기본", "출생자녀 1명", "출생자녀 1명과 이전 출생 자녀", "출생자녀 2명 이상"]
    rows = {r["label"]: r["values_man"] for r in a["rows"]}
    assert rows["대학생 계층 총자산"] == [10800, 11900, 13000, 13000]
    assert rows["청년 계층(세대주가 아닌 경우 본인만) 총자산"] == [25100, 27600, 30100, 30100]
    assert rows["신혼부부 계층 | 고령자 총자산"] == [34500, 37900, 41300, 41300]
    assert rows["대학생 계층(본인) 자동차"] == [0, 0, 0, 0]
    assert rows["청년 계층(세대주가 아닌 경우 본인만) | 신혼부부 계층 | 고령자 자동차"] == [4542, 4996, 5451, 5451]


def test_haengbok_student_block(hb):
    c = block(hb, "대학생 계층")
    g = c["general"]
    assert g["intro"].startswith("입주자모집공고일(2026. 8. 28.) 현재 무주택자로서")
    assert [r[:4] for r in g["requirements"]] == ["①-㉮ ", "①-㉯ ", "② 혼인", "③ 신청", "④ 신청"]
    assert [r["rank"] for r in g["ranks"]] == [1, 2, 3]
    assert g["ranks"][2]["text"] == "1순위 및 2순위에 해당하지 않는 자"
    assert "연접지역(의정부시 남양주시" in g["ranks"][0]["text"]
    p = c["priority"]
    # 우선공급 순위 표는 세 열(순위 | 자치구 | 대학생/취업준비생 갈래) — 열은 x, 열 안은 y 순으로 잇는다
    assert p["ranks"][0]["text"].startswith("행복주택이 위치하는 서울특별시 해당 자치구가 (대학생) 재학 중인 대학 소재지이거나")
    assert p["ranks"][0]["text"].endswith("(취업준비생) 거주지인 자")
    # 「거주」(x 68)가 「대학생」「취업준비생」 두 행에 걸친 라벨
    s = p["score"]
    assert s["points"] == [3, 1]
    assert [i["label"] for i in s["items"]] == ["거주 (대학생)", "거주 (취업준비생)"]
    assert s["items"][0]["cells"][0] == "부모 모두 서울특별시 외 지역에 거주"
    assert s["items"][1]["cells"][1].startswith("신청자 본인이 행복주택이 위치한 서울특별시 자치구에 3년 미만 거주")
    assert c["selection"]["rows"] == [
        {"group": "우선공급", "area": None, "steps": ["2세 미만의 자녀가 있는 자", "순위", "배점(1순위만 적용)", "추첨"]},
        {"group": "일반공급", "area": None, "steps": ["순위", "추첨"]},
    ]
    assert p["notes"][0] == "대학생 및 취업준비생의 배점 항목은 우선공급 1순위로 신청한 분에게만 적용합니다"


def test_haengbok_youth_score_label_split_from_cell(hb):
    """「② 주택청약종합저축(청약저축 포함) 가입 2년이 경과한 자로서 매월 약정」이 한 조각 — 칸 열 왼끝에서 갈랐다."""
    s = block(hb, "청년 계층")["priority"]["score"]
    assert [i["label"] for i in s["items"]] == ["① 거주지 및 거주기간", "② 주택청약종합저축(청약저축 포함) 납입횟수"]
    assert s["items"][1]["cells"] == [
        "가입 2년이 경과한 자로서 매월 약정 납입일에 월납입금을 24회 이상 납입한 자",
        "가입 6개월이 경과한 자로서 매월 약정 납입일에 월납입금을 6회 이상 23회 이하 납입한 자",
    ]
    reqs = block(hb, "청년 계층")["general"]["requirements"]
    assert reqs[0] == "①-㉮ (청년) 만 19세 이상 만 39세 이하인 자 (출생일 1986 8 29~2007 8 28)"
    assert "1인인 경우에는 120퍼센트 2인인 경우에는 110퍼센트" in reqs[3]


def test_haengbok_newlywed_selection_has_residence_step(hb):
    c = block(hb, "(예비)신혼부부 한부모가족 계층")
    assert c["selection"]["rows"][0]["steps"] == ["2세 미만의 자녀가 있는 자", "순위", "배점", "해당 순위 지역의 거주기간이 오래인 자", "추첨"]
    assert len(c["general"]["requirements"]) == 8
    assert "(맞벌이 신혼부부의 경우 120퍼센트 이하)" in c["general"]["requirements"][4]


def test_haengbok_senior_three_point_table_and_inline_item(hb):
    """3점 | 2점 | 1점 세 열. 「③ 장애인 … : 3점」은 칸 없이 항목 글에 점수가 박혀 있다(두 줄)."""
    c = block(hb, "고령자")
    assert c["general"]["ranks"] == []   # 일반공급 순위 표 없음 — 선정은 「일반공급 → 추첨」
    assert c["selection"]["rows"][1] == {"group": "일반공급", "area": None, "steps": ["추첨"]}
    s = c["priority"]["score"]
    assert s["points"] == [3, 2, 1]
    assert s["items"][0]["label"] == "① 신청자 나이"
    assert s["items"][0]["cells"] == ["만 75세 이상", "만 70세 이상 〜 만 75세 미만", "만 65세 이상 ~ 만 70세 미만"]
    # 병합 칸 행 경계 — 「행복주택이 위치하는」(y 828)은 ②의 첫 줄이지 ①(y 798)에 가까운 줄이 아니다
    assert s["items"][1]["cells"][0].startswith("행복주택이 위치하는 서울특별시 해당 자치구에 5년 이상 거주")
    assert s["items"][1]["cells"][2] == "행복주택이 위치하는 서울특별시 해당 자치구 외 서울특별시에 거주"
    assert s["items"][2]["label"].startswith("③ 장애인 국가유공자 중 상이 1~7급자")
    assert s["items"][2]["label"].endswith("경도장애 이상의 장애등급자")
    assert s["items"][2]["cells"] == ["해당", "", ""]


def test_haengbok_housing_benefit_block(hb):
    c = block(hb, "주거급여수급자")
    assert c["general"]["requirements"] == ["① 「주거급여법」 제2조제2호 및 제3호에 따른 주거급여수급자 자격이 있을 것"]
    s = c["priority"]["score"]
    assert s["items"][1]["label"].startswith("② 국가유공자 보훈보상대상자 518민주유공자")
    assert s["items"][1]["cells"] == ["해당", "", ""]


def test_haengbok_no_middle_dot(hb):
    import json
    text = json.dumps(hb.as_json(), ensure_ascii=False)
    assert "·" not in text and "・" not in text and "‧" not in text


# ── 매입임대(장기미임대) ─────────────────────────────────────


def test_maeip_rank_rows_and_income(mi):
    assert mi.kind == "maeip"
    assert mi.source_pages == [6, 8]
    t = mi.rank_tables[0]
    assert t["group"] == "신청자격"
    assert [(r["rank"], r["income_pct"]) for r in t["rows"]] == [(1, 130), (2, None)]
    assert t["rows"][0]["requirement"] == "도시근로자 가구원수별 가구당 월평균 소득 130% 이하 세대"
    assert mi.selection[0]["rows"][0]["steps"] == ["동일순위자 경합시 추첨에 의해 순위 결정"]
    it = mi.income_table
    assert it["households"] == [1, 2, 3, 4, 5, 6]
    # 3~6인 값이 한 조각 「10618958114428631212508112878142」로 붙어 온다 — 글자 x로 열을 가른다
    assert it["rows"][0]["won"] == [5720045, 8212778, 10618958, 11442863, 12125081, 12878142]
    v = verify_income_table(it, BASE_2025)
    assert v["verified"] and v["clean"] == 6


def test_maeip_bump_applies_to_expected_values():
    """검산이 1인 +20%p·2인 +10%p를 안다 — 없으면 1인 5,720,045(=3,813,363×1.5)가 mismatch로 잡힌다."""
    table = {"households": [1, 2, 3], "rows": [{"pct": 130, "won": [5720045, 8212778, 10618958]}], "bump": {"1": 20, "2": 10}}
    assert verify_income_table(table, BASE_2025)["mismatches"] == []
    table_nobump = {**table, "bump": {}}
    assert len(verify_income_table(table_nobump, BASE_2025)["mismatches"]) == 2
