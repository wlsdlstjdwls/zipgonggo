"""자격진단 시드 정정표 — docs/eligibility-audit.md(2026-10-06)의 공고문 값과 맞는지."""

import json

from zipgonggo_pipeline.parsers.eligibility_corrections import apply_corrections, fix_income_standard
from zipgonggo_pipeline.stages.s0_eligibility import SEED_PATH


def _seed():
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def _types():
    return {t["code"]: t for t in _seed()["supply_types"]}


def test_seed_already_corrected_and_idempotent():
    d = _seed()
    assert apply_corrections(d["supply_types"]) == d["supply_types"]
    assert fix_income_standard(d["income_standard"]) == d["income_standard"]


def test_seven_person_income_follows_notice_rule():
    # lh-2026-21330-0-maeip 4쪽, lh-2026-21379-1-yeonggu 5쪽: 7인 100% 10,485,541 / 70% 7,339,879 / 50% 5,242,771
    inc = {(r["household"], r["pct"]): r["monthly_won"] for r in _seed()["income_standard"]}
    assert inc[(7, 100)] == 10_485_541
    assert inc[(7, 70)] == 7_339_879
    assert inc[(7, 50)] == 5_242_771
    assert inc[(6, 100)] == 9_906_263  # 6인은 원래 맞았다


def test_newlywed_single_and_dual_income():
    t = _types()
    for code, single, dual in (("buy_new1", 70, 90), ("ys_new1", 70, 90), ("ls_new1", 70, 90),
                               ("buy_new2", 130, 200), ("ys_new2", 130, 200), ("ls_new2", 130, 200),
                               ("happy_newlywed", 100, 120)):
        assert (t[code]["income_pct"], t[code]["income_pct_dual"]) == (single, dual), code


def test_small_household_bonus_only_where_notices_use_it():
    t = _types()
    assert t["buy_youth"]["income_small_bonus"] and t["happy_youth"]["income_small_bonus"]
    for code in ("lt1", "lt2", "ys_priv_youth", "ppmh_youth"):
        assert not t[code]["income_small_bonus"], code


def test_general_buy_and_permanent_are_strict():
    t = _types()
    for code in ("buy_gen", "rent_perm"):
        assert t[code]["income_pct"] == 50 and t[code]["asset_limit_man"] == 24500, code


def test_region_and_scope_fixes():
    t = _types()
    assert t["lt1"]["region_limit"] == "서울"
    assert t["buy_gen"]["region_limit"] == "모집지역"
    assert t["happy_youth"]["income_scope"] == "세대주분기"
    assert t["lt2"]["asset_limit_man"] == 66200
    assert all(t[c]["basis"] for c in t if c not in ("ls_gen", "pub_ls"))
