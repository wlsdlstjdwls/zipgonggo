"""공급유형 시드(db/seeds/eligibility.json) 불변식.

엑셀을 다시 뽑을 때마다 이 검사를 통과해야 한다. 자격요건은 틀리면 사용자에게 실질적 피해를 준다
(db/schema.sql의 eligibility.reviewed 주석과 같은 이유).
"""

import json
from pathlib import Path

import pytest

SEED = Path(__file__).resolve().parents[2] / "db" / "seeds" / "eligibility.json"

pytestmark = pytest.mark.skipif(not SEED.exists(), reason="시드 파일 없음 — s0_eligibility --xlsx 로 먼저 만든다")


@pytest.fixture(scope="module")
def seed():
    return json.loads(SEED.read_text(encoding="utf-8"))


def test_코드는_유일하고_비지_않는다(seed):
    codes = [t["code"] for t in seed["supply_types"]]
    assert codes and all(codes)
    assert len(codes) == len(set(codes))


def test_제한없음_표시는_None으로_눕는다(seed):
    # 999(소득%)·999999(만원)가 그대로 남으면 "월 999% 이하"처럼 진단이 뒤집힌다
    for t in seed["supply_types"]:
        assert t["income_pct"] != 999
        assert t["asset_limit_man"] != 999999
        assert t["car_limit_man"] != 999999


def test_자동차_0은_살려_둔다(seed):
    # 0은 "자동차를 아예 못 가짐"이라 무제한(None)과 다르다
    assert any(t["car_limit_man"] == 0 for t in seed["supply_types"])


def test_소득기준은_가구원수_1부터_7까지_전부_있다(seed):
    by_size = {}
    for r in seed["income_standard"]:
        by_size.setdefault(r["household"], set()).add(r["pct"])
    assert set(by_size) == set(range(1, 8))
    pcts = {frozenset(v) for v in by_size.values()}
    assert len(pcts) == 1, "가구원수마다 %구간이 달라선 안 된다"


def test_유형이_쓰는_소득_구간이_기준표에_다_있다(seed):
    have = {r["pct"] for r in seed["income_standard"]}
    used = {t["income_pct"] for t in seed["supply_types"] if t["income_pct"] is not None}
    assert used <= have


def test_지역등급은_서울과_연접만(seed):
    assert {t["tier"] for t in seed["region_tiers"]} == {"서울", "연접"}
    assert any(t["kind"] == "sido" for t in seed["region_tiers"]), "인천광역시는 시도 단위로 들어온다"


def test_혼인기간_제한은_미혼_유형에_붙지_않는다(seed):
    """「혼인 N년 이내」는 혼인 유형뿐 아니라 **무관** 유형에도 붙는다.

    청년안심주택 민간임대 일반공급(`ys_priv_general`)이 그렇다 — 만 39세 이하 청년이거나
    혼인 7년 이내면 신청할 수 있다. 화면도 그렇게 읽는다(`web/src/lib/eligibility.ts`의
    `marital === "무관"` 가지 → 「미혼이거나 혼인 N년 이내」).
    말이 안 되는 조합은 **미혼 + 혼인기간**뿐이다. 그것만 막는다.
    """
    for t in seed["supply_types"]:
        if t["marital_max_yr"]:
            assert t["marital"] in ("혼인", "무관"), t["code"]
