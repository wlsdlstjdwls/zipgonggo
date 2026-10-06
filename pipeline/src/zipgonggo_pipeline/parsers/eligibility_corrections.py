"""자격진단 시드 정정표 — 엑셀(「내집마련.xlsx」) 값을 실제 공고문과 맞대 고친 것. 순수 함수.

근거 전문은 docs/eligibility-audit.md(2026-10-06). 엑셀은 사용자가 만든 원본이라 손대지 않고,
뽑아낸 뒤 여기서 덮는다 — `--xlsx`로 시드를 다시 뽑아도 정정이 날아가지 않게(s0가 시드를 읽을 때도 한 번 더 건다. 멱등).

정정하지 않은 것:
- 배점표(score)와 순위 문구 대부분 — 3단계(순위와 배점 계산)에서 기계가 읽을 꼴로 다시 만든다
- 근거 공고가 없는 유형(ls_gen, pub_ls), HUG 든든전세 — 대조표 「확인 불가」
- 면적별로 갈리는 기준(국민임대 50㎡, 미리내집 60㎡)은 신청할 수 있는 가장 넓은 쪽으로 두고 note에 적는다
화면 문자열(note)이라 가운뎃점을 쓰지 않는다.
"""

from __future__ import annotations

from typing import Any

# 1인 +20%p, 2인 +10%p 가산을 쓰는 유형(대조표 「공통 소견」). 장기전세, 미리내집, 민간 청년안심, 공공지원민간임대는 안 쓴다
SMALL_BONUS = {
    "happy_student", "happy_youth", "happy_newlywed", "happy_elderly",
    "ys_youth", "ys_new1", "ys_new2",
    "buy_youth", "buy_new1", "buy_new2", "buy_gen",
    "rent_nat", "rent_perm", "rent_redev",
    "ls_new1", "ls_new2", "ls_multi",
    "custom",
}

# 이 줄을 맞대 본 공고. 화면이 「근거 공고」로 링크할 수 있다
BASIS = {
    "happy_student": "sh-2026-309337-haengbok",
    "happy_youth": "sh-2026-309337-haengbok",
    "happy_newlywed": "sh-2026-309337-haengbok",
    "happy_elderly": "sh-2026-309337-haengbok",
    "happy_welfare": "sh-2026-309337-haengbok",
    "ys_youth": "sh-2026-302646-cheongnyeon",
    "ys_new1": "sh-2026-302646-cheongnyeon",
    "ys_new2": "sh-2026-302646-cheongnyeon",
    "ys_priv_youth": "youth-2026-6645-mingan",
    "ys_priv_newlywed": "youth-2026-6645-mingan",
    "ys_priv_general": "youth-2026-6645-mingan",
    "buy_youth": "lh-2026-21304-0-maeip,sh-2026-306214-maeip",
    "buy_new1": "lh-2026-21302-0-maeip",
    "buy_new2": "lh-2026-21303-0-maeip,sh-2026-308644-maeip",
    "buy_long": "sh-2026-310107-maeip",
    "buy_gen": "lh-2026-21330-0-maeip",
    "rent_nat": "sh-2026-308340-gungmin",
    "rent_perm": "lh-2026-21379-1-yeonggu",
    "rent_redev": "sh-2026-310041-jaegaebal",
    "ls_youth": "lh-2026-19631-0-jeonse",
    "ls_new1": "lh-2026-19833-0-jeonse,sh-2026-302368-jeonse",
    "ls_new2": "lh-2026-19832-0-jeonse",
    "ls_multi": "lh-2026-19834-0-jeonse",
    "lt1": "sh-2026-309467-janggi",
    "lt2": "sh-2026-308944-janggi",
    "safe": "lh-2026-21370-0-maeip",
    "custom": "sh-2026-308799-maeip",
    "ppmh_youth": "youth-2026-6645-mingan",
    "ppmh_newlywed": "youth-2026-6645-mingan",
    "ppmh_general": "youth-2026-6645-mingan",
}

_SIX = "만 6세 이하 자녀가 있으면 혼인기간을 보지 않는다"

# 코드 → 덮을 칸. 값마다 대조표의 근거 쪽수가 있다
CORRECTIONS: dict[str, dict[str, Any]] = {
    # 사회초년생은 나이 무관(요건 ①-㉯). 소득과 자산은 세대원이면 본인, 세대주면 세대 전체(「해당 세대」 정의)
    "happy_youth": {
        "age_exempt": ["사회초년생"],
        "income_scope": "세대주분기", "asset_scope": "세대주분기",
        "note": "미혼만 신청할 수 있다. 소득과 자산은 세대원이면 본인 것만, 세대주면 세대 전체를 본다. 입주 전까지 청약통장에 가입해야 한다",
    },
    # 100%(맞벌이 120%)
    "happy_newlywed": {
        "income_pct": 100, "income_pct_dual": 120,
        "note": f"외벌이 가구는 소득 100% 이하, 맞벌이 가구는 120% 이하. 예비신혼부부와 한부모가족도 신청할 수 있다. {_SIX}",
    },
    # 대학생과 취준생도 나이 요건은 똑같이 본다(21~22쪽)
    "ys_youth": {"age_exempt": []},
    "ys_new1": {
        "income_pct": 70, "income_pct_dual": 90,
        "note": f"외벌이 가구는 소득 70% 이하, 맞벌이 가구는 90% 이하. {_SIX}",
    },
    # 130%(맞벌이 200%), 자동차는 별도 한도 없이 총자산에 합산(29쪽), 5순위 기타 혼인가구
    "ys_new2": {
        "income_pct": 130, "income_pct_dual": 200, "car_limit_man": None,
        "ranks": ["신생아/보호대상한부모", "유자녀신혼", "무자녀신혼", "6세이하혼인가구", "그밖의혼인가구"],
        "note": "외벌이 가구는 소득 130% 이하, 맞벌이 가구는 200% 이하. 혼인기간과 무관하게 신청할 수 있다. 자동차는 따로 보지 않고 총자산에 더한다",
    },
    # 단독 세대주는 본인, 세대원이거나 가족 있는 세대주는 세대 전체(12쪽 ④)
    "ys_priv_youth": {
        "note": "미혼만 신청할 수 있다. 소득은 단독 세대주면 본인, 세대원이거나 가족이 있는 세대주면 세대 전체를 본다. 자산은 본인 것만 본다",
    },
    "buy_youth": {
        "ranks": ["수급자/차상위/한부모", "본인+부모소득100%+자산34500", "본인소득100%+자산25100"],
    },
    "buy_new1": {
        "income_pct": 70, "income_pct_dual": 90,
        "note": f"외벌이 가구는 소득 70% 이하, 맞벌이 가구는 90% 이하. {_SIX}",
    },
    "buy_new2": {
        "income_pct": 130, "income_pct_dual": 200,
        "ranks": ["신생아/보호대상한부모", "유자녀신혼", "무자녀신혼", "6세이하혼인가구", "그밖의혼인가구"],
        "note": "외벌이 가구는 소득 130% 이하, 맞벌이 가구는 200% 이하. 혼인기간과 무관하게 신청할 수 있다. 자동차는 따로 보지 않고 총자산에 더한다",
    },
    # 자격에 소득은 없지만 130%로 순위를 가른다. SH 공고는 서울 주민등록자만(6~7쪽) — LH도 같은 유형이라 「모집지역」
    "buy_long": {
        "region_limit": "모집지역",
        "ranking_method": "순위→추첨", "ranks": ["소득130%이하", "소득130%초과"],
        "note": "소득과 자산 자격 요건은 없다. 소득 130% 이하 세대가 1순위이고 같은 순위는 추첨한다. SH 공고는 서울 주민등록자만 받는다",
    },
    # 일반 신청자는 50%, 자산은 영구임대 기준 24,500. 모집 시군구 주민등록(2~4쪽)
    "buy_gen": {
        "income_pct": 50, "asset_limit_man": 24500, "region_limit": "모집지역",
        "note": "수급자, 한부모가족, 고령자, 장애인 가구가 1순위다. 그 밖에는 소득 50% 이하(장애인은 100%)여야 한다. 모집하는 시군구에 주민등록이 있어야 한다",
    },
    # SH는 서울 거주 성년자(22쪽). LH 국민임대는 대조하지 못해 「모집지역」으로 둔다
    "rent_nat": {
        "region_limit": "모집지역",
        "note": "소득 70% 이하. 50㎡ 미만은 소득 50% 이하 가구가 먼저 뽑힌다. SH 공고는 서울 거주자만 받는다",
    },
    # 일반 50%, 자산 24,500. 수급자와 한부모가족 등은 증명서로 갈음(4~5, 8쪽)
    "rent_perm": {
        "income_pct": 50, "asset_limit_man": 24500,
        "note": "일반 신청자는 소득 50% 이하. 수급자와 한부모가족 등은 증명서로 소득 심사를 갈음하고, 국가유공자와 북한이탈주민 등은 70%까지 본다",
    },
    "ls_youth": {"note": "2026년 상시 모집은 수급자, 한부모가족, 차상위계층 가구의 청년만 받는다"},
    # 70%(맞벌이 90%), 자산은 국민임대 기준 34,500, 4순위 유자녀 혼인가구
    "ls_new1": {
        "income_pct": 70, "income_pct_dual": 90, "asset_limit_man": 34500,
        "ranks": ["신생아/보호대상한부모", "유자녀신혼", "무자녀신혼", "6세이하혼인가구"],
        "note": f"외벌이 가구는 소득 70% 이하, 맞벌이 가구는 90% 이하. {_SIX}. 같은 순위 안에서는 선착순",
    },
    # 신혼 7년이 기준이고 매입임대Ⅱ와 달리 기타 혼인가구 순위가 없다(1쪽)
    "ls_new2": {
        "income_pct": 130, "income_pct_dual": 200, "marital_max_yr": 7, "newborn_exempt": True,
        "ranks": ["신생아/보호대상한부모", "유자녀신혼", "무자녀신혼", "6세이하혼인가구"],
        "note": f"외벌이 가구는 소득 130% 이하, 맞벌이 가구는 200% 이하. {_SIX}. 자동차는 따로 보지 않고 총자산에 더한다",
    },
    # 혼인 요건 없음 — 미성년 자녀 2명 이상을 키우는 무주택세대구성원(조손가정 포함)
    "ls_multi": {"marital": "무관", "marital_max_yr": 0},
    "lt1": {
        "age_min": 19, "region_limit": "서울",
        "note": "면적과 순위별 소득기준이 다르다(60㎡ 이하 1,2순위 70%, 3,4순위 105%, 60㎡ 초과 150%. 맞벌이는 140~200%). "
                "2023.3.28. 이후 출생자녀가 있으면 10~20%p 가산. 청약 24회 이상은 1순위 조건이고 못 미쳐도 아래 순위로 신청할 수 있다. "
                "서울 거주자만 받는다",
    },
    # 60㎡ 이하 120%(맞벌이 180%), 60㎡ 초과 150%(맞벌이 200%), 자산 66,200, 자녀 면제 없음, 5년 무주택(13~21쪽)
    "lt2": {
        "age_min": 19, "income_pct": 150, "income_pct_dual": 200, "asset_limit_man": 66200, "newborn_exempt": False,
        "note": "60㎡ 이하는 소득 120%(맞벌이 180%), 60㎡ 초과는 150%(맞벌이 200%). 신청자와 배우자가 최근 5년간 계속 무주택이어야 한다. 서울 거주자만 받는다",
    },
    # LH 든든전세 기준. 모집 권역 주민등록, 배점 합산 뒤 추첨(1, 3쪽)
    "safe": {
        "name": "든든전세", "region_limit": "모집지역", "ranking_method": "배점합산→추첨",
        "note": "소득과 자산은 보지 않는다. 신생아 가구와 자녀 수로 배점을 매기고 같은 점수는 추첨한다. 모집 권역(예: 서울, 인천, 경기)에 주민등록이 있어야 한다",
    },
    "custom": {"region_limit": "서울"},
    # 서울 청년안심주택 민간 공고 기준 — 자산과 자동차를 심사한다(12쪽 ⑤⑥)
    "ppmh_youth": {
        "asset_scope": "본인", "asset_limit_man": 25100, "car_limit_man": 4542,
        "note": "소득은 단독 세대주면 본인, 세대원이거나 가족이 있는 세대주면 세대 전체를 본다. 자산은 본인 것만 본다",
    },
    "ppmh_newlywed": {
        "age_max": 39, "asset_scope": "세대", "asset_limit_man": 34500, "car_limit_man": 4542,
        "note": "세대 합산 소득 120% 이하. 자산과 자동차도 심사한다",
    },
    "ppmh_general": {
        "age_max": 39, "car_limit_man": 4542,
        "note": "소득과 자산 요건 없이 추첨한다. 나이와 혼인, 무주택, 자동차는 청년안심주택 공통 요건으로 본다",
    },
}


def apply_corrections(types: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """엑셀에서 뽑은 유형 행에 새 칸 기본값과 정정을 얹는다. 이미 얹은 행에 다시 걸어도 같다."""
    out = []
    for t in types:
        r = {"income_pct_dual": None, "income_small_bonus": False, "basis": None, **t}
        r["income_small_bonus"] = r["code"] in SMALL_BONUS
        r["basis"] = BASIS.get(r["code"], r.get("basis"))
        r.update(CORRECTIONS.get(r["code"], {}))
        out.append(r)
    return out


def _round(x: float) -> int:
    return int(x + 0.5)


def fix_income_standard(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """7인 가구 기준액을 공고 규칙대로 — 「6인 이상은 5인 + 1인당 (5인-3인)/2」.
    엑셀은 다른 산식을 써서 100% 10,651,279원이 됐는데 공고는 10,485,541원이다(대조표 income_standard 검산).
    % 줄은 100% 값에 곱해 반올림한다(1~6인 줄이 그렇게 맞는다)."""
    base = {r["household"]: r["monthly_won"] for r in rows if r["pct"] == 100}
    if not {3, 5}.issubset(base):
        return rows
    step = (base[5] - base[3]) / 2
    fixed = {h: _round(base[5] + step * (h - 5)) for h in (6, 7)}
    out = []
    for r in rows:
        if r["household"] in fixed:
            r = {**r, "monthly_won": _round(fixed[r["household"]] * r["pct"] / 100)}
        out.append(r)
    return out
