"""SH 첨부 공고문 「입주자 모집 절차 및 일정」 흐름도 파서 — 접수 시작·마감·당첨자 발표일.

흐름도는 상자(라벨) 아래에 날짜가 붙는 그림이라 줄 단위 텍스트로는 순서가 섞인다.
그래서 Synap XML의 글자 좌표를 쓴다: 라벨 칸의 x 범위와 겹치면서 바로 아래(t가 큰 쪽)에 있는 날짜를 그 라벨의 날짜로 본다.

양식별 실측(2026-09-08):
- 장기전세 309467·303557 9쪽: 「1순위 접수기간」 ’26.09.14(월) ~09.15(화) … 「3・4순위 접수기간」 09.17(목), 「당첨자발표」 ’27.03.05(금)
- 매입임대 309403 4쪽: 「신청접수」 아래 2026 / 9 28(월) 10:00 ~ 2026. / 9 30(수) 17:00 (연도가 윗줄에 따로), 「당첨자」+「발표」 두 줄 라벨
- 행복주택 309337 1쪽: 「신청」+「접수」 두 줄 라벨, ‘26 9 9(수) ~ ‘26 9 11(금) (띄어쓰기 날짜)
- 미리내집 308971 4쪽: 「모집일정(요약)」, 「당첨자(예비자)」+「최종발표」
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from ..sources.ish import group_rows, parse_chars, row_segments

RANK_APPLY_RE = re.compile(r"(\d)\s*(?:[・·.]\s*\d\s*)?순위\s*(?:청약)?\s*접수")
APPLY_RE = re.compile(r"^(?:신청\s*접수|청약\s*접수|접수\s*기간|신청접수\(인터넷\))")
ANNOUNCE_RE = re.compile(r"당첨자.{0,8}발표")
HEADING_RE = re.compile(r"모집\s*절차\s*및\s*일정|공급\s*일정|모집\s*일정")

WEEKDAY = "월화수목금토일"
# 띄어쓰기 날짜: ‘26 9 9(수) · 2026 8 28(금) · 09 15 (화)
SPACED_RE = re.compile(rf"(?:(\d{{2}}|\d{{4}})\s+)?(\d{{1,2}})\s+(\d{{1,2}})\s*\([{WEEKDAY}]\)")
# 붙은 날짜: 260914(월) · 20260914(월) · 2026928(월) · 0915(화) · 928(월)
COMPACT_RE = re.compile(rf"(\d{{3,8}})\s*\([{WEEKDAY}]\)")
YEAR_ONLY_RE = re.compile(r"^(20\d{2})$")
BELOW_PX = 150   # 라벨 아래 이만큼 안에서 날짜를 찾는다
STACK_PX = 26    # 같은 열에서 이만큼 안에 붙은 두 줄은 한 라벨(신청/접수, 당첨자/발표)


@dataclass(frozen=True)
class Schedule:
    apply_start: date | None
    apply_end: date | None
    announce: date | None
    page: int | None


@dataclass
class _Box:
    l: float
    r: float
    t: float
    text: str


def _norm(text: str) -> str:
    t = re.sub(r"[’‘'`]", "", text)
    t = re.sub(r"[.:~*]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _year(v: str | None, ref_year: int | None) -> int | None:
    if v is None:
        return ref_year
    return int(v) if len(v) == 4 else 2000 + int(v)


def _mk(y: int | None, m: int, d: int) -> date | None:
    if y is None:
        return None
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _compact_candidates(digits: str, ref_year: int | None) -> list[date]:
    """자릿수별 해석 후보. 5·7자리는 월/일 경계가 둘이라 후보가 둘일 수 있다."""
    n = len(digits)
    out: list[date | None] = []
    if n == 8:
        out.append(_mk(int(digits[:4]), int(digits[4:6]), int(digits[6:])))
    elif n == 7:
        y = int(digits[:4])
        out += [_mk(y, int(digits[4:5]), int(digits[5:])), _mk(y, int(digits[4:6]), int(digits[6:]))]
    elif n == 6:
        out.append(_mk(2000 + int(digits[:2]), int(digits[2:4]), int(digits[4:])))
    elif n == 5:
        y = 2000 + int(digits[:2])
        out += [_mk(y, int(digits[2:3]), int(digits[3:])), _mk(y, int(digits[2:4]), int(digits[4:]))]
    elif n == 4:
        out.append(_mk(ref_year, int(digits[:2]), int(digits[2:])))
    elif n == 3:
        out += [_mk(ref_year, int(digits[:1]), int(digits[1:])), _mk(ref_year, int(digits[:2]), int(digits[2:]))]
    return [d for d in out if d]


def _pick(cands: list[date], ref: date | None) -> date | None:
    if not cands:
        return None
    if ref is None:
        return cands[0]
    after = [d for d in cands if d >= ref]
    return min(after) if after else cands[0]


def _dates_in(text: str, ref_year: int | None, ref: date | None) -> list[date]:
    t = _norm(text)
    out: list[date] = []
    for m in SPACED_RE.finditer(t):
        d = _mk(_year(m.group(1), ref_year), int(m.group(2)), int(m.group(3)))
        if d:
            out.append(d)
            ref, ref_year = d, d.year
    if out:
        return out
    for m in COMPACT_RE.finditer(t):
        d = _pick(_compact_candidates(m.group(1), ref_year), ref)
        if d:
            out.append(d)
            ref, ref_year = d, d.year
    return out


def _boxes(xml: str) -> list[_Box]:
    boxes: list[_Box] = []
    for row in group_rows(parse_chars(xml)):
        t = min(c.t for c in row)
        for s in row_segments(row):
            boxes.append(_Box(s.l, s.r, t, s.text))
    return boxes


def _overlap(a: _Box, b: _Box) -> float:
    inter = min(a.r, b.r) - max(a.l, b.l)
    return inter / max(1.0, min(a.r - a.l, b.r - b.l))


def _stacked_labels(boxes: list[_Box]) -> list[_Box]:
    """같은 열에 바로 붙은 두 줄을 이어 붙인 가상 라벨(신청+접수, 당첨자+발표)도 후보에 넣는다."""
    out = list(boxes)
    by_t = sorted(boxes, key=lambda b: b.t)
    for i, a in enumerate(by_t):
        for b in by_t[i + 1 :]:
            if b.t - a.t > STACK_PX:
                break
            if b.t > a.t and _overlap(a, b) >= 0.6 and re.search(r"[가-힣]", a.text) and re.search(r"[가-힣]", b.text):
                out.append(_Box(min(a.l, b.l), max(a.r, b.r), a.t, a.text + b.text))
    return out


def _dates_below(label: _Box, boxes: list[_Box], ref_year: int | None) -> list[date]:
    """라벨 아래(같은 열)에 붙은 날짜들. 위에서 아래 순. 연도만 있는 줄(2026)은 다음 날짜의 연도로 쓴다."""
    below = sorted((b for b in boxes if label.t < b.t <= label.t + BELOW_PX and _overlap(label, b) >= 0.4), key=lambda b: (b.t, b.l))
    found: list[date] = []
    ref: date | None = None
    for b in below:
        t = _norm(b.text)
        ym = YEAR_ONLY_RE.match(t)
        if ym:
            ref_year = int(ym.group(1))
            continue
        for d in _dates_in(b.text, ref_year, ref):
            found.append(d)
            ref, ref_year = d, d.year
    return found


def parse_schedule_page(xml: str, ref_year: int | None = None) -> Schedule | None:
    boxes = _boxes(xml)
    if not any(HEADING_RE.search(b.text) for b in boxes):
        return None
    labels = _stacked_labels(boxes)
    ranked: list[tuple[int, _Box]] = []
    plain: list[_Box] = []
    announce_labels: list[_Box] = []
    for b in labels:
        m = RANK_APPLY_RE.search(b.text)
        if m:
            ranked.append((int(m.group(1)), b))
        elif APPLY_RE.match(b.text.replace(" ", "")):
            plain.append(b)
        elif ANNOUNCE_RE.search(b.text.replace(" ", "")):
            announce_labels.append(b)

    start = end = None
    if ranked:
        ranked.sort(key=lambda x: (x[0], x[1].t))
        first = _dates_below(ranked[0][1], boxes, ref_year)
        last = _dates_below(ranked[-1][1], boxes, first[-1].year if first else ref_year)
        start = first[0] if first else None
        end = max(last) if last else (max(first) if first else None)
    else:
        for lab in sorted(plain, key=lambda b: b.t):
            ds = _dates_below(lab, boxes, ref_year)
            if ds:
                start, end = min(ds), max(ds)
                break
    announce = None
    for lab in sorted(announce_labels, key=lambda b: b.t):
        ds = _dates_below(lab, boxes, (end or start).year if (end or start) else ref_year)
        if ds:
            announce = ds[0]
            break
    if start is None and end is None and announce is None:
        return None
    if start and end and end < start:
        end = None
    return Schedule(start, end, announce, None)


def parse_schedule(pages: list[tuple[int, str]], ref_year: int | None = None) -> Schedule | None:
    """앞쪽 12쪽 안에서 일정 흐름도를 찾는다. 표지(1쪽)에도 같은 그림이 있어 먼저 잡히면 그걸 쓴다."""
    for page, xml in pages[:12]:
        s = parse_schedule_page(xml, ref_year)
        if s and (s.apply_start or s.apply_end):
            return Schedule(s.apply_start, s.apply_end, s.announce, page)
    return None
