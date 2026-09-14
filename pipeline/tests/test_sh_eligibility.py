"""SH 장기전세 공고문 「신청자격」 파서 회귀. 정답지는 제51차(309467) 6~8쪽·30~32쪽 XML. 네트워크 없음.

값은 공고문 원문과 대조했다(2026-09-14). 사용자 지적 셋이 곧 시험 항목이다:
면적×순위×자녀가산×맞벌이 소득 매트릭스, 동일순위 경쟁 시 선정 기준, 소득표 연도.
"""

from pathlib import Path

import pytest

from zipgonggo_pipeline.parsers.sh_eligibility import parse_eligibility, verify_income_table

FIX = Path(__file__).parent / "fixtures"


def pages(seq: str, nums):
    d = FIX / f"ish_{seq}"
    return [(n, (d / f"p{n}.xml").read_text(encoding="utf-8")) for n in nums]


@pytest.fixture(scope="module")
def elig():
    # 1·9쪽(일정)·13쪽(단지 표)을 섞어도 자격 표만 골라 읽어야 한다
    e = parse_eligibility(pages("309467", [1, 6, 7, 8, 9, 13, 30, 31, 32]))
    assert e is not None
    return e


def row(table, area, rank):
    hits = [r for r in table["rows"] if r["area"] == area and r["rank"] == rank]
    assert len(hits) == 1, (area, rank, hits)
    return hits[0]


# ── 6~7쪽 소득기준·신청순위 ─────────────────────────────────


def test_rank_tables_three_groups(elig):
    assert [t["group"] for t in elig.rank_tables] == [
        "공사 건설형(일반 주거약자) 서울리츠3호", "매입형(일반공급)", "매입형(우선공급)",
    ]
    assert elig.source_pages == [6, 7, 8, 30, 31, 32]


def test_건설형_60이하_순위별_소득(elig):
    """60㎡ 이하: 1·2순위 70%(맞벌이 완화 없음), 3·4순위 105%(맞벌이 140%). 사용자 지적 1."""
    t = elig.rank_tables[0]
    r1, r2, r3, r4 = (row(t, "60㎡ 이하", k) for k in (1, 2, 3, 4))
    assert (r1["income_pct"], r1["dual_income_pct"]) == (70, None)
    assert (r2["income_pct"], r2["dual_income_pct"]) == (70, None)
    assert (r3["income_pct"], r3["dual_income_pct"]) == (105, 140)
    assert (r4["income_pct"], r4["dual_income_pct"]) == (105, 140)
    assert r1["requirement"] == "주택청약종합저축(청약저축) 약정납입회차 24회 이상"
    assert r2["requirement"] == "1순위 미해당자 (단 약정납입회차 6회 이상 우선)"
    assert r4["requirement"] == "3순위 미해당자 (단 약정납입회차 6회 이상 우선)"


def test_건설형_60초과_85초과(elig):
    t = elig.rank_tables[0]
    r = row(t, "60㎡ 초과 85㎡ 이하", 3)
    assert (r["income_pct"], r["dual_income_pct"]) == (150, 200)
    assert r["requirement"] == "1,2순위 미해당자"          # 원문 「1・2순위」 — Synap이 가운뎃점을 떨어뜨린다
    r = row(t, "85㎡ 초과", 1)
    assert r["requirement"].startswith("주택청약종합저축(청약예금)에 가입하여 2년 경과하고 청약 예치기준금액 이상 납입")
    assert "102㎡ 초과 135㎡ 이하:1000만원이상" in r["requirement"]
    assert row(t, "85㎡ 초과", 2)["requirement"] == "1순위 미해당자"
    # 쪽 머리글(「제51차 장기전세주택 입주자모집」)이 첫 줄 요건에 섞이면 안 된다
    assert "입주자모집" not in row(t, "60㎡ 이하", 1)["requirement"]


def test_매입형_거주지순위와_우선공급(elig):
    t = elig.rank_tables[1]
    assert row(t, "50㎡ 미만", 1)["requirement"] == "신청주택이 위치한 자치구 거주"
    assert row(t, "50㎡ 미만", 3)["requirement"] == "그 외 서울시 자치구 거주"
    assert row(t, "50㎡ 이상 60㎡ 이하", 1)["income_pct"] == 105
    pri = elig.rank_tables[2]
    assert pri["classes"] == ["고령자", "장애인", "노부모부양자", "2자녀이상 가구", "국가유공자 등"]
    assert pri["rows"] == [{"area": "60㎡ 이하", "rank": None, "income_pct": 105, "dual_income_pct": 140,
                            "requirement": "상세사항: 공고문 29쪽(1순위 접수기간에 신청)"}]


# ── 7~8쪽 출생자녀 가산·자산 ────────────────────────────────


def test_bonus_conditions_and_matrix(elig):
    assert elig.bonus_conditions == [
        "① 2023.3.28. 이후 출생한 자녀(태아 포함)만 1명 있는 경우: 10%p 가산",
        "② 2023.3.28. 이후 출생한 자녀(태아 포함)가 2명 이상인 경우: 20%p 가산",
        "③ 2023.3.28. 이후 출생한 자녀(태아 포함)가 1명 있고 2023.3.27.이전 출생한 미성년자녀가 있는 경우: 20%p 가산",
    ]
    m = elig.income_matrix
    assert m["columns"] == ["기본", "①에 해당 시", "② ③에 해당 시", "맞벌이"]
    assert [(r["area"], r["applicant"], r["pcts"]) for r in m["rows"]] == [
        ("60㎡ 이하", "공사 건설형 1,2순위 신청자", [70, 80, 90, None]),
        ("60㎡ 이하", "공사 건설형 3,4순위 매입형 신청자", [105, 115, 125, 140]),
        ("60㎡ 초과", "", [150, 160, 170, 200]),
    ]


def test_asset(elig):
    """시드(6억 4,000만)와 다른 원문 값 — 총자산 6억 6,200만, 가산 시 7억 2,800만 / 7억 9,400만."""
    assert elig.asset["rows"] == [
        {"label": "총자산", "values_man": [66200, 72800, 79400]},
        {"label": "자동차", "values_man": [4542, 4996, 5451]},
    ]


# ── 8쪽 소득표 ──────────────────────────────────────────────


def test_income_table_read_and_verified(elig):
    t = elig.income_table
    assert t["households"] == [1, 2, 3, 4, 5, 6]
    assert [r["pct"] for r in t["rows"]] == [70, 80, 90, 105, 115, 125, 140, 150, 160, 170, 200]
    assert t["rows"][0]["won"] == [2669354, 4106389, 5717900, 6161541, 6528890, 6934384]
    # 90% 줄은 1·2인 칸이 XML에 아예 없고(None) 숫자가 두 줄로 갈라진다 — 글자 단위로 다시 묶어야 읽힌다
    assert t["rows"][2]["won"] == [None, None, 7351586, 7921982, 8394287, 8915637]

    base = {1: 3813363, 2: 5866270, 3: 8168429, 4: 8802202, 5: 9326985, 6: 9906263}
    v = verify_income_table(t, base)
    assert v["verified"] and not v["mismatches"] and v["clean"] >= 50
    assert v["rows"][2]["won"][0] == 3432027                  # 빈칸은 검산 뒤 기준액 × 90%로 채운다
    assert v["rows"][10]["won"] == [7626726, 11732540, 16336858, 17604404, 18653970, 19812526]


def test_income_table_mismatch_blocks_fill():
    table = {"households": [1, 2], "rows": [{"pct": 70, "won": [2669354, 4106389]}, {"pct": 80, "won": [None, 4693016]}]}
    v = verify_income_table(table, {1: 3813363, 2: 5866270})
    assert v["verified"] is False and v["clean"] == 3          # 6칸 미만이면 검증 안 함
    assert v["rows"][1]["won"] == [None, 4693016]              # 빈칸은 그대로
    bad = {"households": [1], "rows": [{"pct": 70, "won": [2669355]}]}
    v = verify_income_table(bad, {1: 3813363})
    assert v["mismatches"] and v["rows"][0]["won"] == [None]   # 어긋난 값은 내보내지 않는다


# ── 30~31쪽 동일순위 선정 기준 ──────────────────────────────


def test_selection_tables(elig):
    """사용자 지적 2 — 화면에 없던 「동일순위 경쟁 시 입주자 선정기준」."""
    titles = [t["title"] for t in elig.selection]
    assert titles == ["일반공급(일반)", "일반공급(주거약자)", "우선공급"]
    gen = elig.selection[0]
    assert gen["tie_break"] == "배점 동일할 경우 미성년자녀 수가 많은 자 → 전산추첨으로 결정"
    r = gen["rows"][0]
    assert (r["group"], r["area"]) == ("공사 건설형 서울 리츠3호", "60㎡ 이하")
    assert r["steps"] == [
        "도시근로자 가구원수별 가구당 월평균소득 70% 이하",
        "주택청약종합저축 (청약저축) 순위",
        "배점합산",
        "(남은 주택 있을 시) 도시근로자가구원수별 가구당 월평균소득 70% 초과 105% 이하",
        "주택청약종합저축 (청약저축) 순위",
        "배점합산",
    ]
    assert [(r["group"], r["area"], r["steps"]) for r in gen["rows"][1:]] == [
        ("공사 건설형 서울 리츠3호", "60㎡ 초과 85㎡ 이하", ["주택청약종합저축(청약저축) 순위", "배점합산"]),
        ("공사 건설형 서울 리츠3호", "85㎡ 초과", ["주택청약종합저축(청약예금) 순위", "배점합산"]),
        ("매입형", "50㎡ 미만", ["거주지순위", "배점합산"]),
        ("매입형", "50㎡ 이상 85㎡ 이하", ["주택청약종합저축(청약저축) 순위", "배점합산"]),
        ("매입형", "85㎡ 초과", ["주택청약종합저축(청약예금) 순위", "배점합산"]),
    ]
    weak = elig.selection[1]
    assert [(r["group"], r["area"]) for r in weak["rows"]] == [("공사 건설형", "60㎡ 이하"), ("공사 건설형", "60㎡ 초과 85㎡ 이하")]
    assert weak["tie_break"] == "배점 동일할 경우 전산추첨으로 결정"
    pri = elig.selection[2]
    assert [(r["group"], r["steps"]) for r in pri["rows"]] == [
        ("국가유공자 등", ["국가보훈부에서 통보한 순위에 따름"]),
        ("장애인", ["장애의 정도가 심한 자", "배점합산"]),
        ("그 외 우선공급계층", ["배점합산"]),
    ]


# ── 31~32쪽 가감점 배점표 ───────────────────────────────────


def test_score_tables(elig):
    t5, t3 = elig.score_tables
    assert (t5["group"], t5["points"]) == ("일반공급(일반) | 우선공급", [5, 4, 3, 2, 1])
    labels = [i["label"] for i in t5["items"]]
    assert labels[:4] == [
        "① 공급 신청자의 서울특별시 연속거주기간(만19세 이후)",
        "② 무주택기간",
        "③ 공급 신청자의 (만)나이",
        "④ 공급 신청자의 부양가족 수 (태아 포함 공급신청자 제외)",
    ]
    assert labels[4].startswith("⑤1 (85㎡ 이하 신청자)") and labels[5].startswith("⑤2 (85㎡ 초과 1순위 신청자)")
    assert t5["items"][0]["cells"] == ["10년 이상", "7년 이상 10년 미만", "5년 이상 7년 미만", "3년 이상 5년 미만", "3년 미만"]
    # 칸 안 「※」 주석이 5점 칸 「10년 이상」과 한 조각으로 붙어 온다(글자 간격 11px) — 좁은 간격으로 다시 나눠야 한다
    assert t5["items"][1]["cells"] == ["10년 이상", "7년 이상 10년 미만", "5년 이상 7년 미만", "3년 이상 5년 미만", "3년 미만"]
    assert t5["items"][1]["note"] == "만30세 미만의 미혼신청자는 무주택기간 점수 없음"
    assert t5["items"][2]["cells"] == ["50세 이상", "45세 이상 50세 미만", "40세 이상 45세 미만", "35세 이상 40세 미만", "35세 미만"]
    assert t5["items"][4]["cells"] == ["96회 이상", "84회 이상 96회 미만", "72회 이상 84회 미만", "60회 이상 72회 미만", "24회 이상 60회 미만"]
    assert t5["items"][5]["cells"] == ["8년 이상", "6년 이상 8년 미만", "4년 이상 6년 미만", "2년 이상 4년 미만", "2년 미만"]

    assert (t3["group"], t3["points"]) == ("일반공급(주거약자)", [3, 2, 1])
    assert [i["cells"] for i in t3["items"]] == [
        ["3인이상", "2인", "1인"],
        ["5년이상", "3년이상 5년미만", "1년이상 3년미만"],
        ["", "생계급여 또는 의료급여 수급자", "차상위계층이거나 생계의료급여 이외의 수급자"],
        ["60회 이상", "48회이상 60회미만", "36회이상 48회미만"],
        ["", "장애의 정도가 심한 장애인", "장애의 정도가 심하지 않은 장애인"],
    ]


def test_penalties(elig):
    p = elig.penalties
    assert [(r["points"]) for r in p["rows"]] == [-6, -4, -2]
    assert p["rows"][0]["label"] == "가. 당첨자 발표일 기준 3년 이내에 장기전세주택 임대차계약 사실이 있는 경우"
    assert p["rows"][2]["label"] == "다. 당첨자 발표일 기준 가목 및 나목 이외의 장기전세주택 임대차계약 사실이 있는 경우"
    assert p["notes"] and p["notes"][0].startswith("단 결혼 출산 노부모 부양 사망 등의 사유로")


# ── 다른 양식 ───────────────────────────────────────────────


def test_other_layout_returns_none():
    """행복주택 공고(309337)엔 「소득기준 및 신청순위」 표가 없다 — None. 시드 카드로 후퇴한다."""
    assert parse_eligibility(pages("309337", [1])) is None


def test_no_middle_dot_in_display_strings(elig):
    """화면 표기 규칙 — 가운뎃점 금지(CLAUDE.md)."""
    import json
    blob = json.dumps(elig.as_json(), ensure_ascii=False)
    assert "·" not in blob and "・" not in blob


# ── 제49차(297335, 2025-12) — 같은 양식, 다른 조판 ─────────────────
# 51차와 다른 점: 표 이름 글머리가 사설 영역 글자()·▶, 배점표 끝이 「* 가점 항목 기재 요령」, 감점 다목 라벨이
# 「-2점」 위아래 세 줄, 소득 가산 표의 신청자 라벨이 %줄 위아래 딴 줄, 건설형 면적 행이 넷(50㎡ 미만부터),
# 매입형 라벨이 두 줄뿐이라 병합 칸 중심이 높다(라벨 중간점으로 가르면 「85㎡ 초과」가 매입형으로 넘어갔다).


@pytest.fixture(scope="module")
def elig49():
    e = parse_eligibility(pages("297335", [6, 7, 8, 29, 30, 31]))
    assert e is not None
    return e


def test_49_source_pages_and_matrix(elig49):
    assert elig49.source_pages == [6, 7, 8, 29, 30, 31]
    m = elig49.income_matrix
    assert [(r["area"], r["applicant"], r["pcts"]) for r in m["rows"]] == [
        ("60㎡ 이하", "공사 건설형 1,2순위 신청자", [70, 80, 90, None]),
        ("60㎡ 이하", "공사 건설형 3,4순위 서울시 매입형 신청자", [105, 115, 125, 140]),
        ("60㎡ 초과", "", [150, 160, 170, 200]),
    ]
    assert elig49.asset["rows"][0] == {"label": "총자산", "values_man": [64000, 70400, 76800]}


def test_49_income_table_is_2024_statistics(elig49):
    """2025년 공고는 2024년 통계를 쓴다. 2025년 기준액으로 검산하면 어긋나고 2024년으로는 맞아야 한다."""
    t = elig49.income_table
    assert t["households"] == [1, 2, 3, 4, 5, 6]
    assert t["rows"][0] == {"pct": 70, "won": [2518715, 3833902, 5338881, 6004662, 6321734, 6813160]}
    base_2025 = {1: 3813363, 2: 5866270, 3: 8168429, 4: 8802202, 5: 9326985, 6: 9906263}
    assert not verify_income_table(t, base_2025)["verified"]
    base_2024 = {1: 3598164, 2: 5477003, 3: 7626973, 4: 8578088, 5: 9031048, 6: 9733086}
    v = verify_income_table(t, base_2024)
    assert v["verified"] and not v["mismatches"]
    assert v["rows"][0]["won"] == [2518715, 3833902, 5338881, 6004662, 6321734, 6813160]
    assert v["rows"][2]["won"][0] == 3238348   # 1인 90%: XML에 없는 칸을 기댓값으로 채운다


def test_49_selection_bullets_and_group_boundary(elig49):
    assert [t["title"] for t in elig49.selection] == ["일반공급(일반)", "일반공급(주거약자)", "우선공급"]
    gen = elig49.selection[0]
    assert [(r["group"], r["area"]) for r in gen["rows"]] == [
        ("공사 건설형 서울 리츠 3호", "50㎡ 미만"),
        ("공사 건설형 서울 리츠 3호", "50㎡ 이상 60㎡ 이하"),
        ("공사 건설형 서울 리츠 3호", "60㎡ 초과 85㎡ 이하"),
        ("공사 건설형 서울 리츠 3호", "85㎡ 초과"),
        ("서울시 매입형", "50㎡ 미만"),
        ("서울시 매입형", "50㎡ 이상 85㎡ 이하"),
    ]
    assert gen["rows"][0]["steps"][:3] == [
        "도시근로자 가구원수별 가구당 월평균소득 70% 이하", "주택청약종합저축 (청약저축) 순위", "배점합산",
    ]
    assert [r["group"] for r in elig49.selection[2]["rows"]] == ["국가유공자 등", "장애인", "그 외 우선공급계층"]


def test_49_scores_end_at_가점_요령_and_penalty_label_spans_lines(elig49):
    assert [len(t["items"]) for t in elig49.score_tables] == [5, 5]
    p = elig49.penalties
    assert [r["points"] for r in p["rows"]] == [-6, -4, -2]
    assert p["rows"][2]["label"] == "다. 당첨자발표일기준가목및나목이외의장기전세주택임대차계약사실이있는 경우"
    assert p["notes"][0].startswith("신청자 및 배우자(분리배우자 포함)가 계약한 사실이 있는 경우")
