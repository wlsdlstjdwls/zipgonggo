"""값 정규화 — 소스 공통 순수 함수. 네트워크·DB 없음.

날짜 계산은 전부 KST. 서버 로컬 타임존(GitHub Actions는 UTC)에 기대지 않는다.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def today_kst() -> date:
    return datetime.now(KST).date()


def nz(value: Any) -> str | None:
    """빈 문자열·공백은 NULL."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def parse_date(value: Any) -> date | None:
    """YYYYMMDD → date. 마이홈 API 형식."""
    s = nz(value)
    if s and len(s) == 8 and s.isdigit():
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return None


def parse_ymd(value: Any) -> date | None:
    """YYYY-MM-DD · YYYY.MM.DD · YYYYMMDD 모두 받는다. 화면 스크래핑 형식."""
    s = (nz(value) or "").replace("-", "").replace(".", "")
    return parse_date(s)


def money(value: Any, *, zero_is_null: bool) -> int | None:
    """금액. 보증금·월임대료 0은 미기재로 본다(매입·전세임대 219건이 전부 0). 계약금·중도금·잔금 0은 실제 0일 수 있어 유지."""
    if value in (None, ""):
        return None
    n = int(value)
    if n == 0 and zero_is_null:
        return None
    return n


def fingerprint(agency: str, title: str, posted: date, house_sn: Any = None, amends: str | None = None) -> str:
    """sha256(기관|공고명|게시일|주택일련번호|원공고키). 정정공고는 원공고와 제목·게시일이 같아 amends를 섞는다."""
    sn = "" if house_sn in (None, "", 0, "0") else str(house_sn)
    return hashlib.sha256(f"{agency}|{title}|{posted.isoformat()}|{sn}|{amends or ''}".encode()).hexdigest()


# 정정 표시 — 제목 앞이나 뒤에 괄호·대괄호로 붙는다. 「(수정)」「[수정공고]」「(정정공고)」「(2026.1.14.수정)」
# 제목 한가운데 문장으로 적힌 정정 사유("…인터넷 청약 시작일 변경, 청약방법 정정")는 건드리지 않는다 —
# 그건 공고 제목의 일부지 표지가 아니다. 잘못 떼면 서로 다른 공고가 한 덩이로 묶인다.
_AMEND_WORD = r"(?:수정|정정|변경|재공고)"
_AMEND_HEAD = re.compile(rf"^\s*[(\[（][^)\]）]*{_AMEND_WORD}[^)\]）]*[)\]）]\s*")
_AMEND_TAIL = re.compile(rf"\s*[(\[（][^)\]）]*{_AMEND_WORD}[^)\]）]*[)\]）]\s*$")
# 「…모집공고_수정게시」처럼 밑줄로 붙인 꼬리
_AMEND_UNDER = re.compile(rf"[_\-]\s*{_AMEND_WORD}\S*\s*$")


def is_amendment(title: str) -> bool:
    """제목 앞뒤에 정정 표지가 붙었나. 본문이 아니라 표지만 본다."""
    return base_title(title) != title.strip()


def base_title(title: str) -> str:
    """정정 표지를 떼어 원 공고 제목을 얻는다. 너무 짧아지면 뗀 게 표지가 아니었던 것이니 되돌린다."""
    t = title.strip()
    for pat in (_AMEND_HEAD, _AMEND_TAIL, _AMEND_UNDER):
        stripped = pat.sub("", t).strip()
        if len(stripped) >= 10:
            t = stripped
    return t


def title_key(title: str) -> str:
    """제목 비교용 열쇠. 정정 표지를 떼고 공백·마침표·가운뎃점을 턴다."""
    return re.sub(r"[\s.·・]", "", base_title(title))
