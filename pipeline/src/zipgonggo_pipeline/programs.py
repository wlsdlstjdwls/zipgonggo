"""공고 제목 → 정부 사업 이름(notice.programs, 0039).

housing_type은 법정 유형이다. 「매입임대」 한 칸에 청년, 신혼신생아, 든든전세, 장기미임대가 다 들어 있는데
사람들은 그 사업 이름으로 찾는다(사용자 요청 2026-10-06). 그 말이 공고 제목에만 있어 여기서 뽑는다.

- **판정은 여기 한 곳뿐이다.** repo.upsert_notice가 적재할 때마다 부르고, 규칙을 고친 뒤엔
  stages/s5_programs.py로 전량 다시 매긴다. web은 칸을 읽기만 한다(CLAUDE.md 디렉터리 경계)
- 값은 화면 이름 그대로이고 URL 식별자(/program/{사업})다. **이름을 바꾸면 URL이 바뀐다** — 추가만 한다
- 확실할 때만 단다. 애매하면 비워 둔다 — 빈 배열은 「특정 사업 아님」이지 오류가 아니다
- 사업과 이름이 같은 법정 유형(행복주택, 재개발임대, 청년안심주택)은 여기 두지 않는다. 그건 /type이 맡는다
- web/src/lib/programs.ts의 설명 카탈로그와 키가 같아야 한다. 이쪽에 사업을 더하면 저쪽에 글도 쓴다
  (글이 없으면 /program/{그 사업}은 404다 — 설명 없는 껍데기를 발행하지 않는다)
"""

from __future__ import annotations

import re

DEUNDEUN = "든든전세"
MIRINAE = "미리내집"
LONG_VACANT = "장기미임대"
NEWLYWED_BUY = "신혼신생아 매입임대"
YOUTH_BUY = "청년 매입임대"
MULTICHILD_BUY = "다자녀 매입임대"
GENERAL_BUY = "일반 매입임대"
PUBLIC_JEONSE = "공공전세주택"
SPECIAL_BUY = "특화형 매입임대"
ELDERLY_WELFARE = "고령자복지주택"
JEONSE_RENT_NEWLYWED = "신혼신생아 전세임대"

# 순서가 화면 순서다(/program 목록). web 카탈로그도 같은 순서로 둔다
PROGRAMS: tuple[str, ...] = (
    DEUNDEUN, MIRINAE, LONG_VACANT, NEWLYWED_BUY, YOUTH_BUY, MULTICHILD_BUY, GENERAL_BUY,
    PUBLIC_JEONSE, JEONSE_RENT_NEWLYWED, SPECIAL_BUY, ELDERLY_WELFARE,
)

# 특화형(수요자 맞춤형) 매입임대 — 협동조합, 직군(예술인, 창업인), 돌봄(의료안심, 홀몸어르신)에 맞춰 운영기관과 함께 공급한다.
# 단지마다 이름을 따로 지어 제목 말이 제각각이라 낱말로 잡는다
_SPECIAL_WORDS = (
    "특화형", "맞춤형", "두레주택", "협동조합", "예술인", "연극인", "음악인", "창업인", "창조기업인",
    "의료안심", "공공원룸", "지원주택",
)


def _norm(title: str) -> str:
    """공백과 가운뎃점/마침표를 걷고 로마숫자를 눕힌다(web notice-supply-type.ts의 norm과 같은 생각)."""
    t = re.sub(r"[\s·ㆍ.\-–—_'\"‧]", "", title)
    return t.replace("Ⅱ", "2").replace("Ⅰ", "1")


def classify(title: str, housing_type: str) -> list[str]:
    """이 공고가 속한 사업들. PROGRAMS 순서로 돌려준다."""
    t = _norm(title)
    out: set[str] = set()

    # 든든전세 — LH 매입 든든전세주택. SH의 「전세임대형 든든주택」은 이름만 비슷한 딴 사업이라 「든든전세」로만 잡는다
    if "든든전세" in t:
        out.add(DEUNDEUN)
    # 미리내집 — 서울시. 장기전세Ⅱ와 신혼신생아 매입임대Ⅱ, 공공한옥 연계형이 다 이 이름을 단다
    if "미리내집" in t:
        out.add(MIRINAE)

    if housing_type == "매입임대":
        if "장기미임대" in t or "미임대(원룸)" in t:
            out.add(LONG_VACANT)
        if "공공전세" in t:
            out.add(PUBLIC_JEONSE)
        # 든든전세는 신혼/다자녀 우선공급을 제목에 적기도 해 대상 사업으로 잘못 잡힌다 — 든든전세면 대상 갈래는 안 본다
        if DEUNDEUN not in out:
            buy = "매입" in t or "기숙사형" in t
            # LH는 「신혼·신생아Ⅰ 예비입주자 모집」처럼 「매입」을 빼고 쓴다 — 신생아는 매입임대 안에선 이 사업뿐이다.
            # 「신혼」만 있으면 「신혼부부를 위한 신정도시마을주택」 같은 SH 건설형이 섞여 「매입」을 같이 본다
            if "신생아" in t or ("신혼" in t and (buy or MIRINAE in out)):
                out.add(NEWLYWED_BUY)
            if "청년" in t and buy:
                out.add(YOUTH_BUY)
            if "다자녀" in t and buy:
                out.add(MULTICHILD_BUY)
            # 「일반주택형」 「일반형」은 집의 꼴이지 공급 대상이 아니다
            # 「기존주택 등 매입임대」(LH)와 옛 「다가구임대주택」(SH)도 같은 일반 매입이다
            general = (re.search(r"일반(?!주택형|형|공급)", t) and buy) or "기존주택등매입" in t or "다가구" in t
            if general and LONG_VACANT not in out:
                out.add(GENERAL_BUY)
        if any(w in t for w in _SPECIAL_WORDS):
            out.add(SPECIAL_BUY)

    if housing_type == "전세임대" and ("신혼" in t or "신생아" in t):
        out.add(JEONSE_RENT_NEWLYWED)

    if "고령자복지주택" in t:
        out.add(ELDERLY_WELFARE)

    return [p for p in PROGRAMS if p in out]
