"""SH 공고문 「주택 위치 안내」 표 파서 — 공급 단지의 도로명주소.

정답지: 제51차 장기전세주택 입주자모집공고(2026.08.31, i-sh seq=309467) 49~52쪽, 137단지.
표 형식: 자치구 | 지구명 | 단지명 | 소재지. 자치구·지구명 칸은 세로 병합이라 줄 단위로는 못 읽는다.
자치구는 소재지에서 도출한다(주소가 더 믿을 만하다). 지구명은 세로 병합을 좌표로 되살린다 — 아래 참조.
단지명 앞 `[신규]`는 금회 신규공급 표시.

세로 병합 복원(2026-09-09):
- 헤더 칸(자치구·지구명·단지명·소재지)의 x 중심 사이 중간점을 열 경계로 삼는다. 네 쪽 모두 헤더가 반복되고 좌표가 같다.
- 지구명 칸에 `-`가 오면 지구에 안 묶인 단독 단지다. 그 줄을 경계로 데이터 줄을 덩어리(run)로 자른다.
- 병합된 지구명 글자는 **자기 블록의 세로 정중앙**에 찍힌다(제 줄로 떨어지기도 하고 데이터 줄에 붙어 오기도 한다).
  그래서 한 run에 라벨이 K개면, run을 연속한 K덩어리로 갈라 `|덩어리 중심 - 라벨 y|` 합이 최소가 되는 분할을 고른다(DP).
  가장 가까운 라벨에 붙이는 방식은 틀린다 — 51차 50쪽 천왕지구(5행)/천왕2지구(2행)처럼 블록 크기가 다르면 경계가 밀린다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..sources.ish import Segment, page_rows_y

ROAD_ADDR_RE = re.compile(
    r"^(?:(?P<sido>서울특별시|서울시|서울|경기도|인천광역시|인천)\s+)?"
    r"(?P<sigungu>[가-힣]+(?:시|구|군))\s+"
    r"(?P<rest>[가-힣A-Za-z0-9·]+(?:로|길)\s*\d[\d\-\s]*(?:\([^)]*\))?)$"
)
NEW_RE = re.compile(r"^\[?\s*신\s*규\s*\]?\s*")
HEADER_KEYS = ("단지명", "소재지")
HEADER_ALL = ("자치구", "지구명", "단지명", "소재지")
DISTRICT_COL = "지구명"
NO_DISTRICT = "-"       # 지구에 안 묶인 단독 단지 표시

SIDO_FULL = {"서울": "서울특별시", "서울시": "서울특별시", "인천": "인천광역시"}


@dataclass(frozen=True)
class ComplexRow:
    name: str
    road_address: str
    sido: str
    sigungu: str
    is_new: bool
    page: int
    district: str | None = None   # 지구명(세곡2지구·마곡지구 …). 단독 단지는 None


def _norm_addr(text: str) -> str:
    # "111 - 11" → "111-11", "진관4로 78" 유지
    t = re.sub(r"\s*-\s*", "-", text)
    return re.sub(r"\s+", " ", t).strip()


def _match_addr(text: str) -> re.Match[str] | None:
    return ROAD_ADDR_RE.match(_norm_addr(text))


def is_header_row(segs: list[Segment]) -> bool:
    texts = [s.text.replace(" ", "") for s in segs]
    return all(any(k == t for t in texts) for k in HEADER_KEYS)


def header_bands(rows_y: list[tuple[float, list[Segment]]]) -> dict[str, tuple[float, float]]:
    """헤더 줄 → 열 이름별 x 구간. 헤더 칸 중심 사이의 중간점이 경계."""
    hdr = next((segs for _, segs in rows_y if is_header_row(segs)), None)
    if hdr is None:
        return {}
    cols = sorted(
        ((s.text.replace(" ", ""), (s.l + s.r) / 2) for s in hdr if s.text.replace(" ", "") in HEADER_ALL),
        key=lambda kv: kv[1],
    )
    bands: dict[str, tuple[float, float]] = {}
    for i, (name, cx) in enumerate(cols):
        lo = float("-inf") if i == 0 else (cols[i - 1][1] + cx) / 2
        hi = float("inf") if i == len(cols) - 1 else (cx + cols[i + 1][1]) / 2
        bands[name] = (lo, hi)
    return bands


def _in_band(seg: Segment, band: tuple[float, float]) -> bool:
    return band[0] <= (seg.l + seg.r) / 2 < band[1]


def _split_blocks(ys: list[float], labels: list[float]) -> list[int]:
    """데이터 줄 y들을 라벨 수만큼 연속 덩어리로 가른다. 각 줄이 몇 번째 라벨에 속하는지 돌려준다.

    병합 칸 글자는 블록 정중앙에 놓이므로, 덩어리의 (첫+끝)/2가 라벨 y에 맞도록 자르는 게 정답이다.
    cost[i][k] = 앞 i줄을 k덩어리로 가른 최소 오차. O(n²K).
    """
    n, K = len(ys), len(labels)
    if K == 0 or n == 0:
        return [-1] * n
    if K == 1:
        return [0] * n
    INF = float("inf")
    cost = [[INF] * (K + 1) for _ in range(n + 1)]
    back = [[0] * (K + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for k in range(1, K + 1):
        for i in range(k, n - (K - k) + 1):          # k덩어리를 채우려면 최소 k줄, 뒤 덩어리 몫도 남긴다
            for j in range(k - 1, i):
                if cost[j][k - 1] == INF:
                    continue
                c = cost[j][k - 1] + abs((ys[j] + ys[i - 1]) / 2 - labels[k - 1])
                if c < cost[i][k]:
                    cost[i][k], back[i][k] = c, j
    out = [-1] * n
    i = n
    for k in range(K, 0, -1):
        j = back[i][k]
        for t in range(j, i):
            out[t] = k - 1
        i = j
    return out


def assign_districts(rows_y: list[tuple[float, list[Segment]]], bands: dict[str, tuple[float, float]]) -> dict[int, str]:
    """데이터 줄 인덱스 → 지구명. 지구에 안 묶인 줄(`-`)과 라벨이 없는 덩어리는 넣지 않는다."""
    band = bands.get(DISTRICT_COL)
    if band is None:
        return {}
    data: list[tuple[int, float, bool]] = []   # (줄 인덱스, y, 단독 여부)
    labels: list[tuple[float, str]] = []
    for idx, (y, segs) in enumerate(rows_y):
        if not segs or is_header_row(segs):
            continue
        cell = next((s.text.strip() for s in segs if _in_band(s, band)), "")
        has_addr = any(_match_addr(s.text) for s in segs)
        if has_addr:
            data.append((idx, y, cell == NO_DISTRICT))
        elif cell and cell != NO_DISTRICT and len(segs) == 1:
            labels.append((y, cell))       # 제 줄로 떨어진 병합 라벨
        if has_addr and cell and cell != NO_DISTRICT:
            labels.append((y, cell))       # 데이터 줄에 붙어 온 병합 라벨
    labels.sort()
    out: dict[int, str] = {}
    run: list[tuple[int, float]] = []

    def flush(run: list[tuple[int, float]]) -> None:
        if not run:
            return
        lo, hi = run[0][1], run[-1][1]
        inside = [(y, t) for y, t in labels if lo - 1 <= y <= hi + 1]
        if not inside:
            return  # 지구 표기가 아예 없는 덩어리 — 억지로 붙이지 않는다
        if len(inside) > len(run):
            inside = inside[: len(run)]
        ys = [y for _, y in run]
        for (idx, _y), k in zip(run, _split_blocks(ys, [y for y, _t in inside])):
            if k >= 0:
                out[idx] = inside[k][1]

    for idx, y, alone in data:
        if alone:
            flush(run)
            run = []
            continue
        run.append((idx, y))
    flush(run)
    return out


def parse_location_rows(rows_y: list[tuple[float, list[Segment]]], page: int) -> list[ComplexRow]:
    """한 쪽의 줄들 → 단지 행. 주소 칸(도로명 정규식) 바로 왼쪽 칸이 단지명."""
    out: list[ComplexRow] = []
    districts = assign_districts(rows_y, header_bands(rows_y))
    pending_name = ""  # 주소 없이 단지명만 있는 줄(두 줄로 감긴 단지명)의 앞부분
    for idx, (_y, segs) in enumerate(rows_y):
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
        out.append(ComplexRow(
            name=name, road_address=road, sido=sido, sigungu=sigungu, is_new=is_new, page=page,
            district=districts.get(idx),
        ))
    return out


def _looks_like_prose(text: str) -> bool:
    return len(text) > 30 or text.endswith((".", "다", "요")) or "○" in text


def parse_location_table(pages: list[tuple[int, str]]) -> list[ComplexRow]:
    """(쪽번호, XML) 목록 → 단지 행. 헤더(단지명·소재지)가 처음 나온 쪽부터 읽고, 주소가 안 나오는 쪽에서 멈춘다."""
    started = False
    out: list[ComplexRow] = []
    for page, xml in pages:
        rows = page_rows_y(xml)
        if not started:
            if not any(is_header_row(segs) for _, segs in rows):
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
