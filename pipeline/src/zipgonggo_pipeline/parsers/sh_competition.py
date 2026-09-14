"""SH 「청약 접수 결과」·「최종 청약경쟁률」 첨부 표 파서 — 회차별 경쟁률.

i-sh 게시판에는 모집공고와 별개로 결과 글이 올라온다. 지금까지 `ish_title.NOT_A_NOTICE`가
공고가 아니라는 이유로 버리던 글들인데, 첨부에 계층별·단지별 경쟁률 표가 들어 있다.
과거 경쟁률은 우리가 직접 SH 원문에서 뽑는다 — 남의 집계를 옮겨오지 않는다.

정답지 (2026-09-09 실측):
- 행복주택 양식: seq=288199 「2025년 1차 행복주택 … 청약 접수 결과」
  자치구 | 단지명 | 공급유형(㎡) | 공급구분(계층) | 우선/일반 | 금회 모집세대수(합계·공가A·예비B) |
  접수누계(인터넷·방문·계) | 우선경쟁률 | 단지경쟁률
- 청년안심주택 양식: seq=292457 · 308650 「… 최종 청약경쟁률 게시」
  단지명(+소재지) | 공급유형 | 신청자격 | 대상(순위) | 공급호수(호) | 신청자수 | 경쟁률

좌표로 읽어야 하는 이유 넷:

1. **소수점·쉼표가 딴 줄에 찍힌다.** 「72.1」은 숫자 '7''2''1'(t=208)과 '.'(t=219)로 흩어진다.
   열별로 글자를 모아 x 순으로 이으면 제자리를 찾는다. x가 같으면 폭 0(구두점)을 먼저 놓는다 —
   안 그러면 「2,162」가 「21,62」로 뒤집힌다.

2. **자치구·단지명이 세로 병합**이라 제 블록 정중앙에 한 번만 찍힌다. sh_complex의 DP로 되살린다.
   여러 줄로 접힌 칸도 있다 — 「서대」+「문구」는 이어 붙이고(자치구), 「DMC에코자이(가재울6)」+
   「서울리츠2호」는 첫 줄만 쓴다(단지명).

3. **Synap 텍스트 레이어가 글자를 흘린다.** seq=288199 어울채 신혼부부 우선경쟁률은 실제 188.8인데
   가운데 '8'이 빠져 '1','8','8','.'만 남는다. 그대로 이으면 **18.8이라는 그럴듯한 오답**이 된다.
   조용히 틀리는 게 제일 나쁘다.

4. 그래서 **구멍을 좌표로 잡는다.** 빠진 글자는 x 간격에 자간 1.5배가 넘는 틈으로 남는다(3번 예: 687→704).
   구멍 난 칸을 알면 성한 칸으로 되메울 수 있다 — 경쟁률 = 접수 계 ÷ 모집호수, 계 = 인터넷 + 방문.
   되메운 값은 추측이 아니라 따로 인쇄된 두 수의 산술이다. 양쪽 다 구멍이면 `reconciled=False`로 남긴다.
"""

from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass

from ..sources.ish import Char, Segment, group_rows, parse_chars, row_segments
from .sh_complex import _split_blocks

# 열 이름은 헤더 글자 그대로. 헤더가 여러 줄로 쪼개져 있어 한 줄에 다 있지 않다.
LAYOUT_A_MAIN = ("자치구", "단지명", "유형", "합계", "공가", "예비", "우선", "단지")
LAYOUT_A_SUB = ("구분", "일반", "인터넷", "방문", "계")
# 「공급호수(호)」처럼 단위가 붙어 와서 앞자리로 맞춘다
LAYOUT_B_COLS = ("단지명", "공급유형", "신청자격", "대상", "공급호수", "신청자수", "경쟁률")
# 매입임대 양식. 세로 병합이 없고 줄마다 값이 다 있다. 주소지까지 들어 있어 제일 값지다.
# 「주택형」과 「성별」은 붙어 찍혀 한 칸("주택형성별")으로 온다 — 형만 앞에서 떼어 쓴다.
LAYOUT_C_COLS = ("구분", "자치구", "주소지", "주택명", "주택형성별", "대상", "공급호수", "계", "경쟁률")

# 2026년 1차(seq=305877)부터 우선·일반 띠 없이 「예비자」 한 줄만 있는 블록이 생겼다(예비입주자만 뽑는 단지)
BRACKET_A = re.compile(r"^(우선|일반|예비자)$")
BRACKET_B = re.compile(r"^(?:(?:우선|일반)\s*)?\d+\s*순위$|^소계$")   # 「3순위」와 「일반1순위」 둘 다
TOTAL_ROW = re.compile(r"^(총계|계)$")
SUPPLY_TYPE_RE = re.compile(r"(\d+\s*[A-Z]?)\s*$")     # "아4)39" → "39", "20A" → "20A"
SUPPLY_TYPE_HEAD = re.compile(r"^(\d+\s*[A-Z]?)")       # "26B-" → "26B" (뒤에 성별 칸이 붙어 온다)
NAME_OK = re.compile(r"[가-힣A-Za-z]{2,}")             # "_" "( 4)" 같은 조각을 거른다
BAND_PAD = 6.0        # 구분 글자 위로 이만큼은 같은 띠로 본다
LABEL_GAP = 25.0      # 이 안에 붙은 라벨 줄은 한 칸이 접힌 것
HOLE_RATIO = 1.5      # 자간이 이 배를 넘으면 글자가 빠진 자리


@dataclass(frozen=True)
class CompetitionRow:
    """표 한 줄. 단지 × 공급유형 × 계층 × 구분(우선/일반/순위)."""

    complex_name: str
    sigungu: str
    address: str            # 표의 소재지. 매입임대 양식에만 있다
    supply_kind: str        # 재공급 · 신규공급. 매입임대 양식에만 있다(다른 양식은 빈 값)
    supply_type: str        # 면적 표기 "29S" · "20A" · "41C"
    tenant_class: str       # 계층 "청년" · "신혼부부" · "고령자" · "신혼 I"
    bracket: str            # 우선 · 일반 · 1순위 · 2순위 · 3순위 · 소계
    units: int | None       # 모집호수
    applicants: int | None  # 신청자수
    ratio: float | None     # 경쟁률
    reconciled: bool        # 산술이 맞아떨어졌나. False면 글자가 흘러 못 믿는 줄이다
    repaired: bool          # 인쇄된 값이 아니라 성한 칸에서 산술로 채운 값(구멍 메움 · 일반공급 경쟁률처럼 원래 없는 칸)
    page: int


@dataclass
class _Band:
    """구분 글자 하나가 이끄는 가로 띠. 구두점이 다음 줄에 찍히므로 t 범위로 자른다."""

    label: str
    lo: float
    hi: float
    chars: list[Char]


@dataclass(frozen=True)
class _Cell:
    text: str
    hole: bool   # 글자가 빠진 자리가 있다


def _cx(c: Char) -> float:
    return (c.l + c.r) / 2


def _seg_cx(s: Segment) -> float:
    return (s.l + s.r) / 2


def _pitch(chars: list[Char]) -> float:
    """쪽 전체 숫자 자간의 중앙값. 칸 안 간격이 이보다 훨씬 넓으면 글자가 빠진 자리다."""
    gaps: list[float] = []
    digits = sorted((c for c in chars if c.ch.isdigit()), key=lambda c: (round(c.t), c.l))
    for a, b in zip(digits, digits[1:]):
        d = b.l - a.l
        if abs(a.t - b.t) <= 2 and 0 < d < 20:
            gaps.append(d)
    return statistics.median(gaps) if gaps else 7.5


def _cell(chars: list[Char], lo: float, hi: float, pitch: float, *, lines: bool = False) -> _Cell:
    """열 범위 안 글자를 x 순으로 잇는다. 폭 0(쉼표·마침표)은 같은 x의 숫자보다 앞선다.

    lines=True면 줄(y)을 먼저 본다 — 글자 칸(계층 「주거급여」/「수급자」 두 줄)은 x로만 이으면 두 줄이 지퍼처럼 섞인다
    (「주수거급급자여」, 실측 seq=305877). 숫자 칸은 소수점이 딴 줄에 찍히므로 x 순이어야 한다."""
    sel = [c for c in chars if lo <= _cx(c) < hi and c.ch.strip()]
    if lines:
        # 줄 번호: t 순으로 훑어 6px 넘게 벌어지면 새 줄. 같은 줄 글자도 t가 1~2px씩 달라 반올림으로는 못 가른다
        line_of: dict[int, int] = {}
        prev_t, ln = None, 0
        for c in sorted(sel, key=lambda c: c.t):
            if prev_t is not None and c.t - prev_t > 6:
                ln += 1
            line_of[id(c)] = ln
            prev_t = c.t
        sel.sort(key=lambda c: (line_of[id(c)], c.l, c.w != 0))
    else:
        sel.sort(key=lambda c: (c.l, c.w != 0))
    text = "".join(c.ch for c in sel).strip()
    wide = [c for c in sel if c.w > 0]
    hole = any(b.l - a.l > pitch * HOLE_RATIO for a, b in zip(wide, wide[1:]))
    return _Cell(text, hole)


def _int(cell: _Cell) -> int | None:
    """정수 칸. 여덟 자리 넘는 값은 이웃 줄이 이어 붙은 것이라 None — 실측 2026-09-14, 띠 경계가 어긋나면
    「322153991526368223886250」 같은 값이 나와 DB integer를 넘겨 적재 전체가 되돌아갔다."""
    t = cell.text.replace(",", "").replace(" ", "")
    return int(t) if t.isdigit() and len(t) <= 7 else None


def _ratio(cell: _Cell) -> float | None:
    t = cell.text.replace(",", "").replace(" ", "")
    return float(t) if re.fullmatch(r"\d+(?:\.\d+)?", t) else None


def _close(a: float | None, b: float | None) -> bool:
    return a is not None and b is not None and abs(a - b) <= 0.15


def _rows(xml: str) -> list[tuple[float, list[Segment], list[Char]]]:
    """글자 줄. 표 밑 「총계」 행은 뺀다 — 마지막 띠가 삼키면 신청자수가 이어 붙어
    「4576」+「75432」=754453726 같은 값이 된다."""
    out: list[tuple[float, list[Segment], list[Char]]] = []
    for row in group_rows(parse_chars(xml)):
        segs = row_segments(row)
        if segs and not TOTAL_ROW.fullmatch(segs[0].text.replace(" ", "")):
            out.append((min(c.t for c in row), segs, row))
    return out


def _labels_of(
    rows: list[tuple[float, list[Segment], list[Char]]], names: tuple[str, ...], *, prefix: bool = False
) -> dict[str, tuple[float, Segment]]:
    """헤더 글자를 이름 → (줄 y, 칸)으로.

    **처음 것을 쓴다.** 「우선」「일반」「계」는 헤더 이름이면서 데이터 값이기도 해서
    나중 것까지 받으면 헤더가 표 맨 아래까지 내려간다.
    """
    found: dict[str, tuple[float, Segment]] = {}
    for t, segs, _chars in rows:
        for s in segs:
            key = s.text.replace(" ", "")
            hit = next((n for n in names if (key.startswith(n) if prefix else key == n)), None)
            if hit and hit not in found:
                found[hit] = (t, s)
    return found


def _widest_gap(chars: list[Char], lo: float, hi: float, min_w: float = 2.5) -> float | None:
    """[lo, hi) 안에서 글자가 한 번도 지나지 않은 가장 넓은 빈 띠의 한가운데."""
    spans = sorted((c.l, c.r) for c in chars if c.ch.strip() and c.r > lo and c.l < hi)
    best: tuple[float, float] | None = None
    cur = lo
    for l, r in spans:
        if l - cur >= min_w and (best is None or l - cur > best[1] - best[0]):
            best = (cur, l)
        cur = max(cur, r)
    if hi - cur >= min_w and (best is None or hi - cur > best[1] - best[0]):
        best = (cur, hi)
    return (best[0] + best[1]) / 2 if best else None


def _bounds(header: dict[str, tuple[float, Segment]], data: list[Char] | None = None) -> list[tuple[str, float, float]]:
    """열 경계. **글자가 지나지 않는 빈 띠**를 경계로 삼고, 없으면 헤더 중심의 중간점으로 물러선다.

    중간점만 쓰면 넓은 칸이 옆으로 샌다 — 매입임대 양식의 「주소지」는 칸이 넓은데 헤더는 그 한가운데
    찍혀 있어, 중간점이 주소 칸 안쪽에 떨어지고 주소 뒷부분이 「주택명」으로 넘어간다(실측 seq=307073).
    """
    cols = sorted(((n, seg) for n, (_t, seg) in header.items()), key=lambda kv: _seg_cx(kv[1]))
    edges: list[float] = []
    for (an, a), (bn, b) in zip(cols, cols[1:]):
        ax, bx = _seg_cx(a), _seg_cx(b)
        gap = _widest_gap(data, ax, bx) if data else None
        edges.append(gap if gap is not None else (ax + bx) / 2)
    out: list[tuple[str, float, float]] = []
    for i, (name, _seg) in enumerate(cols):
        out.append((name, float("-inf") if i == 0 else edges[i - 1],
                    float("inf") if i == len(cols) - 1 else edges[i]))
    return out


def _span(bounds: list[tuple[str, float, float]], name: str) -> tuple[float, float]:
    for n, lo, hi in bounds:
        if n == name:
            return lo, hi
    return float("nan"), float("nan")


def _header_bottom(header: dict[str, tuple[float, Segment]]) -> float:
    return max((t for t, _s in header.values()), default=0.0) + 1.0


def _bands(
    rows: list[tuple[float, list[Segment], list[Char]]],
    bounds: list[tuple[str, float, float]],
    key_col: str,
    pattern: re.Pattern[str],
    header_bottom: float,
) -> list[_Band]:
    """구분 열에서 띠를 연다. 띠는 다음 구분 글자 바로 위까지 — 그 사이 구두점이 제 값에 붙는다."""
    lo, hi = _span(bounds, key_col)
    # 칸 범위 안 조각 중 **패턴에 맞는 것**을 고른다. 첫 조각만 보면 옆 칸의 「-」(성별)이
    # 먼저 걸려 그 줄이 통째로 빠진다(실측 seq=307073 3쪽).
    anchors: list[tuple[float, str]] = []
    for t, segs, _c in rows:
        if t < header_bottom:
            continue
        hit = next((m for s in segs if lo <= _seg_cx(s) < hi
                    and pattern.fullmatch(m := s.text.replace(" ", ""))), None)
        if hit:
            anchors.append((t, hit))
    if not anchors:
        return []
    all_chars = [c for _t, _s, chars in rows for c in chars]
    # 마지막 띠는 앞 띠들의 간격만큼만 연다. inf로 두면 표 밑 「총계」 행을 제 값으로 삼킨다.
    steps = [b[0] - a[0] for a, b in zip(anchors, anchors[1:])]
    tail = statistics.median(steps) * 1.5 if steps else 30.0
    out: list[_Band] = []
    for i, (t, label) in enumerate(anchors):
        start = t - BAND_PAD
        end = anchors[i + 1][0] - BAND_PAD if i + 1 < len(anchors) else t + tail
        out.append(_Band(label, start, end, [c for c in all_chars if start <= c.t < end]))
    return out


def _block_of(ranges: list[tuple[float, float]], t: float) -> int:
    return next((i for i, (lo, hi) in enumerate(ranges) if lo <= t < hi), -1)


def _label_rows(
    rows: list[tuple[float, list[Segment], list[Char]]],
    bounds: list[tuple[str, float, float]],
    col: str,
    header_bottom: float,
    ranges: list[tuple[float, float]],
    *,
    join: bool,
) -> list[tuple[float, str]]:
    """세로 병합 칸의 라벨 줄. 접혀 있는 줄은 한 칸으로 묶는다.

    join=True(자치구)면 조각을 이어 붙이고(「서대」+「문구」→「서대문구」),
    join=False(단지명)면 첫 줄만 쓴다(「DMC에코자이(가재울6)」+「서울리츠2호」).

    묶기는 **블록 경계를 넘지 않는다.** 단지명이 줄마다 되풀이 인쇄되는 양식(308650)에서
    경계를 넘겨 묶으면 다음 단지 이름이 앞 단지에 먹힌다.
    """
    lo, hi = _span(bounds, col)
    raw: list[tuple[float, str]] = []
    for t, segs, _c in rows:
        if t < header_bottom:
            continue
        text = " ".join(s.text for s in segs if lo <= _seg_cx(s) < hi).strip()
        if text and NAME_OK.search(text) and not TOTAL_ROW.fullmatch(text.replace(" ", "")):
            raw.append((t, text))
    out: list[tuple[float, str]] = []
    for t, text in raw:
        if out and t - out[-1][0] <= LABEL_GAP and _block_of(ranges, t) == _block_of(ranges, out[-1][0]):
            if join:
                out[-1] = (out[-1][0], out[-1][1] + text)
            continue
        out.append((t, text))
    return out


def _restore_merged(blocks: list[tuple[float, float]], labels: list[tuple[float, str]]) -> dict[int, str]:
    """세로 병합 칸을 블록에 되돌린다. 병합 글자는 제 블록 정중앙에 찍히므로 중심 y를 맞춰 가른다."""
    if not blocks or not labels:
        return {}
    labels = sorted(labels)[: len(blocks)]
    centers = [(lo + hi) / 2 for lo, hi in blocks]
    return {i: labels[k][1] for i, k in enumerate(_split_blocks(centers, [y for y, _t in labels])) if k >= 0}


def _addr_rows(
    rows: list[tuple[float, list[Segment], list[Char]]],
    bounds: list[tuple[str, float, float]],
    col: str,
    header_bottom: float,
) -> list[tuple[float, str]]:
    """단지명 열에서 소재지 괄호가 든 줄만. 「퀸즈W 청량리역」 밑에 따로 접혀 오므로
    라벨 묶기(_label_rows)로는 잘려 나간다 — 자치구는 여기서 뽑는다."""
    lo, hi = _span(bounds, col)
    out: list[tuple[float, str]] = []
    for t, segs, _c in rows:
        if t < header_bottom:
            continue
        text = " ".join(s.text for s in segs if lo <= _seg_cx(s) < hi).strip()
        if (gu := _sigungu_from(text)):
            out.append((t, gu))
    return out


def _clean_complex(text: str) -> str:
    """단지명 칸에서 소재지 괄호를 뗀다. 「퀸즈W 청량리역 (동대문구 전농동 127-359)」"""
    return re.sub(r"\s*\([^)]*\d[^)]*\)\s*$", "", text).strip()


def _road_address(text: str) -> str:
    """「<재공급> 강남구 [백년빌] (26B) - 서울특별시 강남구 개포로24길 13」에서 주소만."""
    m = re.search(r"(서울특별시|경기도|인천광역시)\s*\S+.*$", text)
    return re.sub(r"\s+", " ", m.group(0)).strip() if m else ""


def _sigungu_from(text: str) -> str:
    m = re.search(r"\(\s*([가-힣]+구)\s", text)
    return m.group(1) if m else ""


def _supply_type(cell: _Cell) -> str:
    """면적 칸. 왼쪽 단지명이 넘어와 붙는 일이 잦아 끝의 숫자(+영문 한 자)만 남긴다."""
    m = SUPPLY_TYPE_RE.search(cell.text)
    return m.group(1).replace(" ", "") if m else cell.text


def _ranges(blocks: list[list[_Band]]) -> list[tuple[float, float]]:
    return [(bs[0].lo, bs[-1].hi) for bs in blocks]


def _block_cell(bands: list[_Band], span: tuple[float, float], pitch: float, *, lines: bool = False) -> _Cell:
    """블록 하나에 한 번만 있는 값(단지경쟁률·면적·계층·공급호수).

    두 경우가 섞여 온다. 값이 띠마다 되풀이 인쇄되면(「청년」「청년」) 하나만 쓰고,
    한 값이 띠에 걸쳐 쪼개져 있으면(숫자는 우선 띠, 소수점은 일반 띠) 이어 붙인다.
    """
    cells = [_cell(b.chars, *span, pitch, lines=lines) for b in bands]
    filled = [c for c in cells if c.text]
    if not filled:
        return _Cell("", False)
    if len({c.text for c in filled}) == 1:
        return filled[0]
    return _cell([c for b in bands for c in b.chars], *span, pitch, lines=lines)


def parse_competition_page(xml: str, page: int) -> list[CompetitionRow]:
    rows = _rows(xml)
    if not rows:
        return []
    if {"인터넷", "방문"} <= set(_labels_of(rows, LAYOUT_A_SUB)):
        return _parse_layout_a(rows, page)
    cols_c = _labels_of(rows, LAYOUT_C_COLS, prefix=True)
    if {"주택명", "주소지", "대상", "경쟁률"} <= set(cols_c):
        return _parse_layout_c(rows, page, cols_c)
    cols = _labels_of(rows, LAYOUT_B_COLS, prefix=True)
    if {"신청자수", "경쟁률"} <= set(cols):
        return _parse_layout_b(rows, page, cols)
    return []


def _parse_layout_a(rows: list[tuple[float, list[Segment], list[Char]]], page: int) -> list[CompetitionRow]:
    header = {**_labels_of(rows, LAYOUT_A_MAIN), **_labels_of(rows, LAYOUT_A_SUB)}
    # 2026년 조판은 「공급구분」이 한 조각(2025년은 「공급」/「구분」 두 줄). 없으면 계층 열을 잃어 tenant_class가 빈다
    if "구분" not in header:
        alias = _labels_of(rows, ("공급구분",))
        if alias:
            header["구분"] = alias["공급구분"]
    if not {"자치구", "단지명", "유형", "일반", "인터넷", "계"} <= set(header):
        return []
    hb = _header_bottom(header)
    bounds = _bounds(header, [c for _t, _s, chars in rows for c in chars if c.t >= hb])
    bands = _bands(rows, bounds, "일반", BRACKET_A, hb)
    if not bands:
        return []
    pitch = _pitch([c for _t, _s, chars in rows for c in chars])

    # 우선 띠가 블록을 연다. 「일반」만 홀로 오는 블록도 있어 앞에 우선이 없으면 제 블록으로 둔다. 「예비자」는 언제나 한 줄짜리 블록.
    blocks: list[list[_Band]] = []
    for b in bands:
        if b.label in ("우선", "예비자") or not blocks or blocks[-1][-1].label in ("일반", "예비자"):
            blocks.append([b])
        else:
            blocks[-1].append(b)

    ranges = _ranges(blocks)
    gu = _restore_merged(ranges, _label_rows(rows, bounds, "자치구", hb, ranges, join=True))
    names = [(t, _clean_complex(s)) for t, s in _label_rows(rows, bounds, "단지명", hb, ranges, join=False)]
    name = _restore_merged(ranges, [(t, s) for t, s in names if s])

    out: list[CompetitionRow] = []
    for i, bs in enumerate(blocks):
        supply_type = _supply_type(_block_cell(bs, _span(bounds, "유형"), pitch))
        tenant = _block_cell(bs, _span(bounds, "구분"), pitch, lines=True).text
        block_ratio_cell = _block_cell(bs, _span(bounds, "단지"), pitch)
        units_sum = applicants_sum = 0
        all_ok = True
        for b in bs:
            units = _int(_cell(b.chars, *_span(bounds, "합계"), pitch))
            internet = _cell(b.chars, *_span(bounds, "인터넷"), pitch)
            visit = _cell(b.chars, *_span(bounds, "방문"), pitch)
            total_cell = _cell(b.chars, *_span(bounds, "계"), pitch)
            total = _int(total_cell)
            # 우선 띠는 우선경쟁률 칸, 예비자 한 줄 블록은 단지경쟁률 칸에 값이 있다. 일반 띠엔 경쟁률이 인쇄되지 않는다
            ratio_cell = (_cell(b.chars, *_span(bounds, "우선"), pitch) if b.label == "우선"
                          else _cell(b.chars, *_span(bounds, "단지"), pitch) if b.label == "예비자" else _Cell("", False))
            ratio = _ratio(ratio_cell)
            # 계 = 인터넷 + 방문. 둘 다 성하고 합이 맞으면 계를 믿는다.
            parts = (_int(internet) or 0) + (_int(visit) or 0)
            sum_ok = not (internet.hole or visit.hole or total_cell.hole) and total == parts
            ratio_ok = _close(ratio, round(total / units, 1)) if (ratio is not None and units and total) else False
            repaired = False
            if not ratio_ok and sum_ok and units and total and (ratio is None or ratio_cell.hole):
                ratio, ratio_ok, repaired = round(total / units, 1), True, True   # 경쟁률 칸에 구멍 → 산술로 되메움
            elif not sum_ok and total_cell.hole and not ratio_cell.hole and ratio and units:
                total, repaired = round(ratio * units), True                      # 계 칸에만 구멍 → 경쟁률로 되메움
                sum_ok = True
            # 일반 띠엔 경쟁률이 인쇄되지 않아 계 = 인터넷 + 방문만 본다. 우선·예비자 띠는 인쇄된 경쟁률이 계 ÷ 합계와 맞으면
            # 인터넷 칸이 글자를 흘렸어도(한 글자짜리는 구멍으로 못 잡는다 — 305877 「8」+「52」=「140」) 두 인쇄값이 서로 맞는 것이라 믿는다
            # 단, 계·경쟁률 칸 자체에 구멍이 있으면 안 믿는다 — 둘 다 한 자리씩 흘리면 산술이 우연히 맞는다(288199 어울채 5,444→544, 777.7→77.7)
            ok = sum_ok if b.label == "일반" else (sum_ok or (ratio_ok and not total_cell.hole and not ratio_cell.hole))
            all_ok &= ok
            out.append(CompetitionRow(name.get(i, ""), gu.get(i, ""), "", "", supply_type, tenant, b.label,
                                      units, total, ratio, ok, repaired, page))
            units_sum += units or 0
            applicants_sum += total or 0
        block_ratio = _ratio(block_ratio_cell)
        derived = round(applicants_sum / units_sum, 1) if units_sum else None
        repaired = False
        if all_ok and derived is not None and not _close(block_ratio, derived):
            block_ratio, repaired = derived, True     # 띠가 다 성하면 소계는 산술로 정한다
        out.append(CompetitionRow(name.get(i, ""), gu.get(i, ""), "", "", supply_type, tenant, "소계",
                                  units_sum or None, applicants_sum or None, block_ratio,
                                  all_ok and _close(block_ratio, derived), repaired, page))
    return out


def _parse_layout_b(
    rows: list[tuple[float, list[Segment], list[Char]]], page: int, header: dict[str, tuple[float, Segment]]
) -> list[CompetitionRow]:
    if not {"단지명", "공급유형", "대상", "공급호수", "신청자수", "경쟁률"} <= set(header):
        return []
    hb = _header_bottom(header)
    bounds = _bounds(header, [c for _t, _s, chars in rows for c in chars if c.t >= hb])
    bands = _bands(rows, bounds, "대상", BRACKET_B, hb)
    if not bands:
        return []
    pitch = _pitch([c for _t, _s, chars in rows for c in chars])

    blocks: list[list[_Band]] = []          # 소계가 블록을 닫는다
    for b in bands:
        if not blocks or blocks[-1][-1].label == "소계":
            blocks.append([b])
        else:
            blocks[-1].append(b)

    ranges = _ranges(blocks)
    raw_names = _label_rows(rows, bounds, "단지명", hb, ranges, join=False)
    name = _restore_merged(ranges, [(t, n) for t, s in raw_names if (n := _clean_complex(s))])
    gu = _restore_merged(ranges, _addr_rows(rows, bounds, "단지명", hb))

    out: list[CompetitionRow] = []
    for i, bs in enumerate(blocks):
        supply_type = _supply_type(_block_cell(bs, _span(bounds, "공급유형"), pitch))
        tenant = _block_cell(bs, _span(bounds, "신청자격"), pitch).text if "신청자격" in header else ""
        units = _int(_block_cell(bs, _span(bounds, "공급호수"), pitch))
        for b in bs:
            app_cell = _cell(b.chars, *_span(bounds, "신청자수"), pitch)
            ratio_cell = _cell(b.chars, *_span(bounds, "경쟁률"), pitch)
            applicants, ratio = _int(app_cell), _ratio(ratio_cell)
            # 순위 줄에 모집호수가 따로 없다 — 블록 공급호수로 나눈 값이 경쟁률이다.
            derived = round(applicants / units, 1) if (units and applicants is not None) else None
            ok, repaired = _close(ratio, derived), False
            if not ok and derived is not None and not app_cell.hole and (ratio is None or ratio_cell.hole):
                ratio, ok, repaired = derived, True, True
            out.append(CompetitionRow(name.get(i, ""), gu.get(i, ""), "", "", supply_type, tenant, b.label,
                                      units, applicants, ratio, ok, repaired, page))
    return out


def _parse_layout_c(
    rows: list[tuple[float, list[Segment], list[Char]]], page: int, header: dict[str, tuple[float, Segment]]
) -> list[CompetitionRow]:
    """매입임대 양식. 줄마다 값이 다 있어 띠 하나가 곧 한 줄이다 — 블록을 묶지 않는다."""
    if not {"자치구", "주택명", "대상", "공급호수", "계", "경쟁률"} <= set(header):
        return []
    hb = _header_bottom(header)
    bounds = _bounds(header, [c for _t, _s, chars in rows for c in chars if c.t >= hb])
    bands = _bands(rows, bounds, "대상", BRACKET_B, hb)
    if not bands:
        return []
    pitch = _pitch([c for _t, _s, chars in rows for c in chars])

    out: list[CompetitionRow] = []
    for b in bands:
        name = _cell(b.chars, *_span(bounds, "주택명"), pitch).text
        gu = _cell(b.chars, *_span(bounds, "자치구"), pitch).text
        kind = _cell(b.chars, *_span(bounds, "구분"), pitch).text if "구분" in header else ""
        addr = _road_address(_cell(b.chars, *_span(bounds, "주소지"), pitch).text) if "주소지" in header else ""
        m = SUPPLY_TYPE_HEAD.search(_cell(b.chars, *_span(bounds, "주택형성별"), pitch).text) if "주택형성별" in header else None
        units = _int(_cell(b.chars, *_span(bounds, "공급호수"), pitch))
        app_cell = _cell(b.chars, *_span(bounds, "계"), pitch)
        ratio_cell = _cell(b.chars, *_span(bounds, "경쟁률"), pitch)
        applicants, ratio = _int(app_cell), _ratio(ratio_cell)
        derived = round(applicants / units, 1) if (units and applicants is not None) else None
        # 이 양식은 경쟁률을 정수로 반올림해 찍는다 — 105호에 2호면 52.5가 아니라 53으로 나온다
        ok = _close(ratio, derived) or (ratio is not None and derived is not None and ratio == math.floor(derived + 0.5))
        repaired = False
        if not ok and derived is not None and not app_cell.hole and (ratio is None or ratio_cell.hole):
            ratio, ok, repaired = derived, True, True
        out.append(CompetitionRow(name, gu, addr, kind, m.group(1).replace(" ", "") if m else "", "",
                                  b.label.replace(" ", ""), units, applicants, ratio, ok, repaired, page))
    return out


def parse_competition(pages: list[tuple[int, str]]) -> list[CompetitionRow]:
    out: list[CompetitionRow] = []
    for page, xml in pages:
        out.extend(parse_competition_page(xml, page))
    return out
