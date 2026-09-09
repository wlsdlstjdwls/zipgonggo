"""i-sh 게시판 결과 글 제목 판별 — 경쟁률 게시·당첨자 발표.

`ish_title.is_notice`가 False를 주는 글 가운데 **쓸모 있는 것만** 골라낸다.
공고가 아니라고 버리던 글들이지만, 첨부에 계층별·단지별 경쟁률과 합격선이 들어 있다.

실측 2026-09-09:
- 게시판 목록을 `isRecrnoti=Y`(모집공고만)로 받으면 결과 글이 통째로 가려진다. 449건 중 19건뿐이다.
  필터를 풀면 3개월치 250건에 결과 글이 61건 — 아카이브 전체로는 수천 건이다.
- 필터를 풀면 **채용 공고가 섞여 들어온다.** 「청년 체험형 인턴 서류전형 합격자 발표」
  「정비사업본부장 채용 최종 합격자 발표」처럼 발표·합격이 들어간 인사 글이다. 먼저 걷어낸다.
- 결과 글 제목은 거의 다 원 공고일을 인용한다 — 「(2025.04.25.공고)」 「(2025. 7. 30.)」 「(26. 8. 5.)」.
  이 날짜가 원 공고를 찾는 열쇠다. 제목 문자열끼리 맞추는 것보다 훨씬 튼튼하다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

# 사람을 뽑는 글. 「발표」·「합격자」가 들어가도 주택 공급과 무관하다.
HIRING = re.compile(r"채용|인턴|직원|사원|경력\s*직|전형|임용|대체인력|인사|면접|필기|공무직|기간제")
# 경쟁률이 실린 글. 「청약경쟁률 게시」·「1순위 청약경쟁률 및 2순위 청약안내」
COMPETITION = re.compile(r"청약\s*경쟁률|경쟁률\s*(?:게시|공개|안내|발표)")
# 합격선(커트라인)이 실린 글. **누가 발표되는가**로 가른다 — 「당첨자」만 보면
# 「당첨자 사전방문 행사 안내」까지 딸려 오고, 「발표」만 보면 채용·행정 글이 섞인다.
# 장기전세·국민임대는 「입주대상자 발표」, 매입임대는 「서류심사대상자 발표」로 낸다(실측 2026-09-09).
WINNER = re.compile(
    r"(?:당첨자|예비\s*당첨자|예비\s*입주자|예비자|입주\s*대상자|공급\s*대상자|서류심사\s*대상자)"
    r"\s*(?:및\s*\S+\s*)*(?:발표|게시|결과)"
    r"|당첨자발표|추첨\s*결과|선정\s*결과"
)
# 결과 표가 없는 뒷절차·행정 글. WINNER가 좁아진 뒤로는 안전망이다.
FOLLOW_UP = re.compile(r"사전방문|동호\s*배정\s*명단|계약\s*대상자|발표일\s*변경|일정\s*변경|취소")
# 원 공고일 인용. 연도는 2자리(26)·4자리(2026) 둘 다 온다.
NOTICE_DATE = re.compile(r"\(\s*(\d{2,4})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})\s*\.?\s*(?:공고)?\s*\)")
# 예비 순번. 「예비2차」·「예비 3차」
RESERVE_ROUND = re.compile(r"예비\s*(\d+)\s*차")
# SH가 제목 앞에 다는 분류 꼬리표. 「[당첨자발표] … 동호배정 및 계약 안내」처럼 본문과 어긋나기도 해서
# 판정 전에 뗀다. 「[예비1차]」는 순번 정보라 남긴다 — 발표·공고·모집이 든 꼬리표만 걷는다.
CATEGORY_TAG = re.compile(r"^\s*\[[^\]]*(?:발표|공고|모집)[^\]]*\]\s*")


@dataclass(frozen=True)
class ResultPost:
    kind: str                    # competition · winner
    notice_date: date | None     # 제목이 인용한 원 공고일. 원 공고를 잇는 열쇠
    reserve_round: int | None    # 예비 N차 발표면 N. 본 발표면 None
    housing_type: str | None     # ish_title.derive_housing_type 결과


def notice_date(title: str) -> date | None:
    """제목이 인용한 원 공고일. 「(2025.04.25.공고)」 「(26. 8. 5.)」 → date"""
    m = NOTICE_DATE.search(title)
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    if y < 100:
        y += 2000
    try:
        return date(y, mo, d)
    except ValueError:
        return None      # 「(2026.13.1.)」 같은 오타는 없는 것으로 친다


def classify(title: str) -> ResultPost | None:
    """결과 글이면 ResultPost, 아니면 None.

    발표문 뒤 절차 글(사전방문·동호배정명단·계약대상자)은 결과 표가 없어 제외한다. 다만
    「당첨자 발표 및 계약안내」처럼 발표와 절차를 한 글에 묶는 제목이 있어 계약안내만으로는 버리지 않는다.
    """
    from .ish_title import derive_housing_type

    body = CATEGORY_TAG.sub("", title)
    if HIRING.search(body):
        return None
    kind = "competition" if COMPETITION.search(body) else ("winner" if WINNER.search(body) else None)
    if kind is None:
        return None
    if kind == "winner" and FOLLOW_UP.search(body):
        return None
    m = RESERVE_ROUND.search(title)
    return ResultPost(kind, notice_date(title), int(m.group(1)) if m else None, derive_housing_type(title))
