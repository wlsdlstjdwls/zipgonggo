"""값 정규화 — 소스 공통 순수 함수. 네트워크·DB 없음.

날짜 계산은 전부 KST. 서버 로컬 타임존(GitHub Actions는 UTC)에 기대지 않는다.
"""

from __future__ import annotations

import hashlib
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
