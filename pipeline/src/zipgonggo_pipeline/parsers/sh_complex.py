"""SH 공고문 「주택 위치 안내」 표 파서 — 공급 단지의 도로명주소.

정답지: 제51차 장기전세주택 입주자모집공고(2026.08.31, i-sh seq=309467) 49~52쪽, 137단지.
표 형식: 자치구 | 지구명 | 단지명 | 소재지. 자치구·지구명 칸은 세로 병합이라 줄 단위로는 못 읽는다 —
자치구는 소재지에서 도출하고 지구명은 이 버전에서 다루지 않는다.
단지명 앞 `[신규]`는 금회 신규공급 표시.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..sources.ish import Segment, page_rows

ROAD_ADDR_RE = re.compile(
    r"^(?:(?P<sido>서울특별시|서울시|서울|경기도|인천광역시|인천)\s+)?"
    r"(?P<sigungu>[가-힣]+(?:시|구|군))\s+"
    r"(?P<rest>[가-힣A-Za-z0-9·]+(?:로|길)\s*\d[\d\-\s]*(?:\([^)]*\))?)$"
)
NEW_RE = re.compile(r"^\[?\s*신\s*규\s*\]?\s*")
HEADER_KEYS = ("단지명", "소재지")

SIDO_FULL = {"서울": "서울특별시", "서울시": "서울특별시", "인천": "인천광역시"}


@dataclass(frozen=True)
class ComplexRow:
    name: str
    road_address: str
    sido: str
    sigungu: str
    is_new: bool
    page: int


def _norm_addr(text: str) -> str:
    # "111 - 11" → "111-11", "진관4로 78" 유지
    t = re.sub(r"\s*-\s*", "-", text)
    return re.sub(r"\s+", " ", t).strip()


def _match_addr(text: str) -> re.Match[str] | None:
    return ROAD_ADDR_RE.match(_norm_addr(text))


def is_header_row(segs: list[Segment]) -> bool:
    texts = [s.text.replace(" ", "") for s in segs]
    return all(any(k == t for t in texts) for k in HEADER_KEYS)


def parse_location_rows(rows: list[list[Segment]], page: int) -> list[ComplexRow]:
    """한 쪽의 줄들 → 단지 행. 주소 칸(도로명 정규식) 바로 왼쪽 칸이 단지명."""
    out: list[ComplexRow] = []
    pending_name = ""  # 주소 없이 단지명만 있는 줄(두 줄로 감긴 단지명)의 앞부분
    for segs in rows:
        if not segs or is_header_row(segs):
            continue
        addr_idx = next((i for i, s in enumerate(segs) if _match_addr(s.text)), None)
        if addr_idx is None:
            # 주소 없는 줄. 표 안에서 단지명만 감겨 내려온 경우를 대비해 마지막 칸을 기억한다
            pending_name = segs[-1].text if len(segs[-1].text) >= 2 and not _looks_like_prose(segs[-1].text) else ""
            continue
        m = _match_addr(segs[addr_idx].text)
        assert m
        name = segs[addr_idx - 1].text if addr_idx >= 1 else ""
        if not name and pending_name:
            name = pending_name
        elif pending_name and name and not NEW_RE.match(name) and len(name) <= 4:
            name = f"{pending_name}{name}"
        pending_name = ""
        is_new = bool(NEW_RE.match(name))
        name = NEW_RE.sub("", name).strip()
        if not name:
            continue
        sido = SIDO_FULL.get(m.group("sido") or "", m.group("sido") or "서울특별시")
        sigungu = m.group("sigungu")
        road = f"{sigungu} {_norm_addr(m.group('rest'))}"
        if sido != "서울특별시":
            road = f"{sido} {road}"
        out.append(ComplexRow(name=name, road_address=road, sido=sido, sigungu=sigungu, is_new=is_new, page=page))
    return out


def _looks_like_prose(text: str) -> bool:
    return len(text) > 30 or text.endswith((".", "다", "요")) or "○" in text


def parse_location_table(pages: list[tuple[int, str]]) -> list[ComplexRow]:
    """(쪽번호, XML) 목록 → 단지 행. 헤더(단지명·소재지)가 처음 나온 쪽부터 읽고, 주소가 안 나오는 쪽에서 멈춘다."""
    started = False
    out: list[ComplexRow] = []
    for page, xml in pages:
        rows = page_rows(xml)
        if not started:
            if not any(is_header_row(r) for r in rows):
                continue
            started = True
        found = parse_location_rows(rows, page)
        if not found:
            break
        out.extend(found)
    return _dedupe(out)


def _dedupe(rows: list[ComplexRow]) -> list[ComplexRow]:
    seen: set[tuple[str, str]] = set()
    out: list[ComplexRow] = []
    for r in rows:
        key = (r.name, r.road_address)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out
