"""SH 공고문 「단지별 주소」 표 파서 — 행복주택·국민임대 양식의 공급 단지 목록.

정답지: 2026년 2차 행복주택(i-sh seq=309337) 51~52쪽.
표 형식: 공급구분 | 공급단지 | 사업주체 | 주소 | 난방방식.

「주택 위치 안내」 표(sh_complex)와 다른 점:
- 헤더 이름이 다르고, 주소가 도로명·지번 섞여 있다("서울특별시 구로구 개봉동 199-4", "서울특별시 강남구 삼성로 11 (개포동 …)")
- 사업주체와 주소가 한 칸에 붙어 오는 줄이 있다("서울주택도시개발공사서울특별시 강동구 고덕로98길 101 (…)")
- 「신규」 표시가 공급구분 칸에 별도 줄로 온다

헤더 칸의 x 중심으로 열 경계를 만들고, 각 칸을 중심 좌표로 열에 배정한다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..sources.ish import group_rows, parse_chars, row_segments

HEADER_KEYS = ("공급단지", "주소")
HEADER_ALL = ("공급구분", "공급단지", "사업주체", "주소", "난방방식")
SIDO_RE = re.compile(r"(서울특별시|경기도|인천광역시|부산광역시|대구광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)")
SIGUNGU_RE = re.compile(r"^(?:\S+)\s+([가-힣]+(?:시|군|구))\b")
NEW_RE = re.compile(r"^\[?\s*신\s*규\s*\]?$")
# 단지명 뒤에 붙는 사업주체·괄호 지구명을 떼려고 쓴다: "창경궁롯데캐슬시그니처(삼선5)서울리츠2호"
RITZ_RE = re.compile(r"서울리츠\d*호?$")
TRAIL_RE = re.compile(r"[\s_,·]+$")


@dataclass(frozen=True)
class AddrRow:
    name: str
    road_address: str   # 시군구부터 시작하는 주소(도로명 또는 지번)
    sido: str
    sigungu: str
    is_new: bool
    page: int


@dataclass
class _Cell:
    l: float
    r: float
    text: str

    @property
    def cx(self) -> float:
        return (self.l + self.r) / 2


def _rows(xml: str) -> list[list[_Cell]]:
    out: list[list[_Cell]] = []
    for row in group_rows(parse_chars(xml)):
        cells = [_Cell(s.l, s.r, s.text) for s in row_segments(row)]
        if cells:
            out.append(cells)
    return out


def _find_header(rows: list[list[_Cell]]) -> tuple[int, dict[str, _Cell]] | None:
    for i, cells in enumerate(rows):
        by = {c.text.replace(" ", ""): c for c in cells}
        if all(k in by for k in HEADER_KEYS):
            return i, {k: by[k] for k in HEADER_ALL if k in by}
    return None


def _bounds(header: dict[str, _Cell]) -> list[tuple[str, float, float]]:
    """헤더 칸 중심 사이의 중간점을 열 경계로. (열이름, 왼쪽, 오른쪽)"""
    cols = sorted(header.items(), key=lambda kv: kv[1].cx)
    out: list[tuple[str, float, float]] = []
    for i, (name, cell) in enumerate(cols):
        left = float("-inf") if i == 0 else (cols[i - 1][1].cx + cell.cx) / 2
        right = float("inf") if i == len(cols) - 1 else (cell.cx + cols[i + 1][1].cx) / 2
        out.append((name, left, right))
    return out


def _col_of(cx: float, bounds: list[tuple[str, float, float]]) -> str | None:
    for name, lo, hi in bounds:
        if lo <= cx < hi:
            return name
    return None


def _clean_name(text: str) -> str:
    t = TRAIL_RE.sub("", text.strip())
    t = RITZ_RE.sub("", t).strip()
    return TRAIL_RE.sub("", t)


def _split_address(text: str) -> str | None:
    """칸에서 주소만. 사업주체가 앞에 붙어 있으면 시도 이름부터 자른다."""
    m = SIDO_RE.search(text)
    if not m:
        return None
    return re.sub(r"\s+", " ", text[m.start():]).strip()


def parse_addr_page(xml: str, page: int) -> list[AddrRow]:
    rows = _rows(xml)
    hit = _find_header(rows)
    if hit is None:
        return []
    hidx, header = hit
    bounds = _bounds(header)
    out: list[AddrRow] = []
    pending_new = False
    for cells in rows[hidx + 1 :]:
        # 다음 쪽 헤더가 같은 쪽에 또 나오면 건너뛴다
        if all(k in [c.text.replace(" ", "") for c in cells] for k in HEADER_KEYS):
            continue
        cols: dict[str, list[_Cell]] = {}
        for c in cells:
            name = _col_of(c.cx, bounds)
            if name:
                cols.setdefault(name, []).append(c)
        # 「신규」만 있는 줄 — 바로 다음 단지 행에 적용
        gubun = " ".join(c.text for c in cols.get("공급구분", []))
        if NEW_RE.match(gubun.replace(" ", "")) and "공급단지" not in cols:
            pending_new = True
            continue
        name_cells = cols.get("공급단지", [])
        # 주소 열을 먼저 본다. 사업주체 열은 주소가 거기 붙어 온 줄에만 쓴다
        # (사업주체 칸이 "서울특별시"라 먼저 보면 시도 이름만 주소로 잡힌다)
        addr_cells = cols.get("주소", []) or cols.get("사업주체", [])
        if not name_cells or not addr_cells:
            continue
        name = _clean_name(" ".join(c.text for c in sorted(name_cells, key=lambda c: c.l)))
        addr = None
        for c in sorted(addr_cells, key=lambda c: c.l):
            cand = _split_address(c.text)
            if cand and SIGUNGU_RE.match(cand):
                addr = cand
                break
        if not name or not addr:
            continue
        sido_m = SIDO_RE.match(addr)
        if not sido_m:
            continue
        sido = sido_m.group(1)
        gu_m = SIGUNGU_RE.match(addr)
        if not gu_m:
            continue
        out.append(AddrRow(
            name=name,
            road_address=addr[len(sido):].strip(),
            sido=sido,
            sigungu=gu_m.group(1),
            is_new=pending_new or NEW_RE.match(gubun.replace(" ", "")) is not None,
            page=page,
        ))
        pending_new = False
    return out


def parse_addr_table(pages: list[tuple[int, str]]) -> list[AddrRow]:
    out: list[AddrRow] = []
    seen: set[tuple[str, str]] = set()
    for page, xml in pages:
        for r in parse_addr_page(xml, page):
            key = (r.name, r.road_address)
            if key in seen:
                continue
            seen.add(key)
            out.append(r)
    return out
