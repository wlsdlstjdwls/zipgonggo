"""i-sh 게시판 공고 제목 → 임대주택 유형.

서울주거포털 목록에는 「청약유형」 열이 있지만(sources.sh), SH 자체 게시판(sources.ish_board)에는
제목·담당부서·등록일뿐이다. 과거 공고 백필은 제목에서 유형을 뽑아야 한다.

원칙: **애매하면 버린다.** 잘못된 유형으로 URL을 만들면 slug가 불변이라 되돌리기 어렵다
(CLAUDE.md 「하지 말 것 6」). 못 가리는 제목은 None을 돌려주고 호출부가 review_queue로 보낸다.

실측 2026-09-09: 게시판 449건(2003-11-25~) 기준.
- 2009년 이전은 대부분 분양아파트라 임대가 아니다 — 제외 규칙에서 걸린다.
- 「… 모집공고 … 당첨자 발표」처럼 모집공고 제목을 통째로 인용한 발표문이 많다. 발표·당첨이 들어가면 공고가 아니다.
"""

from __future__ import annotations

import re

# 이미 올라간 공고에 자료만 덧붙인 글. 제목이 원 공고 제목 + 「… 추가」 꼴이라 그대로 두면
# 같은 공고가 목록에 두 번 나온다. 별도 공고로 만들지 않고 원 공고에 이어 붙인다.
AMENDMENT_SUFFIX = re.compile(
    r"\s*(?:주택|단지|평면도|자료|첨부|파일|공급)?\s*(?:정보|서류)?\s*(?:추가|추가\s*게시|추가\s*안내|재게시|등록)\s*$"
)

# 공고 자체가 아닌 글(발표문·안내문). 모집공고 제목을 인용하고 있어 유형 키워드는 다 들어 있다.
NOT_A_NOTICE = re.compile(r"당첨자|예비자\s*발표|발표|추첨\s*결과|선정\s*결과|취소|재계약|계약\s*안내|서류\s*제출|접수\s*연장|일정\s*변경")
# 임대주택이 아닌 공급. 2000년대 게시글 다수가 여기 걸린다.
NOT_RENTAL = re.compile(r"분양아파트|분양주택|분양상가|토지임대부|임대상가|상가\s*(?:공급|입찰|재공급|모집)|용지|주차장|사업자\s*모집|매각"
                        # 장기안심주택은 보증금을 지원하는 사업이지 주택 공급이 아니다(포털 매핑도 NOT_HOUSING)
                        r"|장기안심"
                        # 가든파이브(동남권유통단지) 상가·아파트형공장은 주택이 아니다
                        r"|아파트형\s*공장|가든파이브|유통단지")

# 앞에서부터 먼저 맞는 규칙을 쓴다 — 좁은 표기가 위로 온다.
RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"역세권\s*청년|청년\s*안심\s*주택"), "청년안심주택"),
    (re.compile(r"장기전세|시프트|미리내집|SHift|SHIFT", re.I), "장기전세"),   # 미리내집 = 장기전세 브랜드(2024~)
    (re.compile(r"행복주택"), "행복주택"),
    (re.compile(r"국민임대"), "국민임대"),
    (re.compile(r"영구임대"), "영구임대"),
    (re.compile(r"전세임대"), "전세임대"),
    (re.compile(r"희망하우징|기숙사"), "공공기숙사"),
    (re.compile(r"재개발|주거환경"), "재개발임대"),
    (re.compile(r"통합공공임대"), "통합공공임대"),
    # 매입임대의 여러 상품명. SH가 사들여 공급하는 건 전부 매입임대로 묶는다.
    (re.compile(r"매입임대|다가구|도시형생활주택|두레주택|수요자\s*맞춤형|공공원룸|원룸|"
                r"협동조합|공공한옥|지원주택|공동체주택|셰어형|공공전세|"
                # SH가 사들여 특정 계층에 공급하는 특화 상품들 — 전부 매입임대다
                r"의료안심|도시마을|예술인|연극인|음악인|창업인|어르신|고령자"), "매입임대"),
]


def amendment_base(title: str) -> str | None:
    """「… 입주자 모집공고(2026.08.14.) 주택정보 추가」 → 원 공고 제목. 자료 추가 글이 아니면 None.

    원 제목이 통째로 남아 있어야 원 공고를 찾을 수 있다 — 접미를 떼고도 「모집공고」가 남는 것만 인정한다.
    """
    base = AMENDMENT_SUFFIX.sub("", title).strip()
    if base == title.strip() or not re.search(r"모집\s*공고", base):
        return None
    return base


def is_notice(title: str) -> bool:
    """모집공고 글인가. 발표문·안내문·비임대 공급·자료 추가 글이면 False."""
    if NOT_A_NOTICE.search(title) or NOT_RENTAL.search(title) or amendment_base(title):
        return False
    # 「입주대기자모집정정공고」처럼 모집과 공고 사이에 말이 끼는 제목이 있다 — 둘 다 있으면 공고로 본다
    return bool(re.search(r"입주자\s*모집", title) or (re.search(r"모집", title) and re.search(r"공고", title)))


def derive_housing_type(title: str) -> str | None:
    """제목 → housing_type enum 값. 못 가리면 None."""
    t = title.replace(" ", "")
    for pat, ht in RULES:
        if pat.search(title) or pat.search(t):
            return ht
    return None
