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

# 흐름도에서 접수·당첨자발표 말고 더 읽는 단계. 위에서부터 먼저 맞는 하나만 쓴다(라벨이 서로 겹친다:
# 「서류심사대상자서류제출」은 발표 패턴에도 걸리므로 제출을 먼저 본다).
# 매칭은 공백을 지운 라벨에 한다 — 흐름도 상자는 줄바꿈으로 글자가 흩어진다.
EXTRA_STEPS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("서류 제출", re.compile(r"(?:심사|대상자).{0,6}서류제출|서류제출")),
    ("서류심사 대상자 발표", re.compile(r"(?:서류)?심사대상자.{0,2}발표|대상자발표")),
    ("계약 체결", re.compile(r"계약체결")),
)

WEEKDAY = "월화수목금토일"
# 띄어쓰기 날짜: ‘26 9 9(수) · 2026 8 28(금) · 09 15 (화)
SPACED_RE = re.compile(rf"(?:(\d{{2}}|\d{{4}})\s+)?(\d{{1,2}})\s+(\d{{1,2}})\s*\(([{WEEKDAY}])\)")
# 붙은 날짜: 260914(월) · 20260914(월) · 2026928(월) · 0915(화) · 928(월)
COMPACT_RE = re.compile(rf"(\d{{3,8}})\s*\(([{WEEKDAY}])\)")
YEAR_ONLY_RE = re.compile(r"^(20\d{2})$")
BELOW_PX = 150   # 라벨 아래 이만큼 안에서 날짜를 찾는다(매입임대는 마감 날짜가 142px 아래)
CHAIN_PX = 60    # 날짜를 하나 찾으면 그 밑으로 이만큼 더 본다 — 「2026 / 8 31(월) / 10:00 / ~ 9 2(수)」처럼
                 # 한 칸이 네 줄로 흩어지면 시작일만 읽고 마감일을 놓쳤다(미리내집 308644 1쪽, 2026-09-09)
STACK_PX = 26    # 같은 열에서 이만큼 안에 붙은 두 줄은 한 라벨(신청/접수, 당첨자/발표)
MAX_DATE_W = 220 # 이보다 넓은 칸은 흐름도 날짜가 아니라 본문 문장이다(라벨 폭 비율은 좁은 라벨에서 오작동)
# 흐름도 아래 주석("※ 입주예정기간은 2026. 1. 16.(월) ~ 2027. 1. 15.(금)입니다") — 날짜가 있어도 접수일이 아니다
NOTE_RE = re.compile(r"^\s*[※*·▶■□○-]")
# 접수 시각 — 「9 28(월) 10:00 ~ 9 30(수) 17:00」. _norm이 콜론을 지우므로 원문에서 먼저 뽑는다
TIME_RE = re.compile(r"([01]?\d|2[0-3])\s*:\s*([0-5]\d)")


def _times_in(text: str) -> list[str]:
    return [f"{int(h):02d}:{m}" for h, m in TIME_RE.findall(text)]


@dataclass(frozen=True)
class Hit:
    """흐름도에서 읽은 날짜 한 개. time은 같은 칸(또는 바로 아랫줄)에 적힌 "HH:MM"."""

    date: date
    weekday: str
    time: str | None = None


@dataclass(frozen=True)
class Step:
    """흐름도 상자 하나. end가 있으면 기간, 없으면 하루."""

    label: str
    start: date
    end: date | None
    start_time: str | None = None
    end_time: str | None = None


@dataclass(frozen=True)
class Schedule:
    apply_start: date | None
    apply_end: date | None
    announce: date | None
    page: int | None
    # 접수 시작·마감 시각("10:00"·"17:00"). 공고문에는 대개 적혀 있는데 화면에 없었다(사용자 지적 2026-09-09).
    # 흐름도에 시각이 없는 양식도 있어 None을 그대로 둔다 — 없는 시각을 지어내지 않는다.
    apply_start_time: str | None = None
    apply_end_time: str | None = None
    # 접수·발표 말고 흐름도에 같이 그려진 단계들(서류심사 대상자 발표·서류 제출·계약 체결).
    # 공고문에 있는데 화면에서 빠져 있다는 지적(사용자 2026-09-09)에 맞춰 통째로 싣는다.
    steps: tuple[Step, ...] = ()


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


def _dates_in(text: str, ref_year: int | None, ref: date | None) -> list[tuple[date, str]]:
    """(날짜, 원문에 적힌 요일 글자) 쌍. 요일은 검증용 — 쓰는 쪽에서 버릴지 정한다."""
    t = _norm(text)
    out: list[tuple[date, str]] = []
    for m in SPACED_RE.finditer(t):
        d = _mk(_year(m.group(1), ref_year), int(m.group(2)), int(m.group(3)))
        if d:
            out.append((d, m.group(4)))
            ref, ref_year = d, d.year
    if out:
        return out
    for m in COMPACT_RE.finditer(t):
        d = _pick(_compact_candidates(m.group(1), ref_year), ref)
        if d:
            out.append((d, m.group(2)))
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
    """같은 열에 바로 붙은 두 줄을 이어 붙인 가상 라벨(신청+접수, 당첨자+발표)도 후보에 넣는다.

    합친 라벨의 t는 아래쪽 줄(b.t)을 쓴다 — 날짜는 라벨 마지막 줄 밑에 오므로 거기서부터 BELOW_PX를 세야
    두 줄짜리 라벨이 손해를 보지 않는다. 위쪽 줄 기준으로 재던 때는 미리내집 「신청접수/(인터넷)」의
    접수일이 151px 아래라 한 칸 차이로 빠졌다(308644 1쪽, 2026-09-09)."""
    out = list(boxes)
    by_t = sorted(boxes, key=lambda b: b.t)
    for i, a in enumerate(by_t):
        for b in by_t[i + 1 :]:
            if b.t - a.t > STACK_PX:
                break
            if b.t > a.t and _overlap(a, b) >= 0.6 and re.search(r"[가-힣]", a.text) and re.search(r"[가-힣]", b.text):
                out.append(_Box(min(a.l, b.l), max(a.r, b.r), b.t, a.text + b.text))
    return out


def _dates_below(label: _Box, boxes: list[_Box], ref_year: int | None) -> list[Hit]:
    """라벨 아래(같은 열)에 붙은 날짜들. 위에서 아래 순. 연도만 있는 줄(2026)은 다음 날짜의 연도로 쓴다.
    ※로 시작하는 주석과 라벨보다 훨씬 넓은 칸(본문 문장)은 건너뛴다 — 「입주예정기간」을 접수기간으로 읽던 회귀."""
    below = sorted(
        (b for b in boxes
         if b.t > label.t
         and _overlap(label, b) >= 0.4
         and (b.r - b.l) <= MAX_DATE_W
         and not NOTE_RE.match(b.text)),
        key=lambda b: (b.t, b.l),
    )
    found: list[Hit] = []
    ref: date | None = None
    limit = label.t + BELOW_PX
    for b in below:
        if b.t > limit:
            break
        t = _norm(b.text)
        ym = YEAR_ONLY_RE.match(t)
        if ym:
            ref_year = int(ym.group(1))
            limit = max(limit, b.t + CHAIN_PX)
            continue
        ds = _dates_in(b.text, ref_year, ref)
        tms = _times_in(b.text)
        if ds:
            for i, (d, wd) in enumerate(ds):
                found.append(Hit(d, wd, tms[i] if i < len(tms) else None))
                ref, ref_year = d, d.year
                limit = max(limit, b.t + CHAIN_PX)
        elif tms and found and found[-1].time is None:
            # 시각만 따로 떨어진 줄(「9 28(월)」 밑에 「10:00」) — 바로 위 날짜에 붙인다
            found[-1] = Hit(found[-1].date, found[-1].weekday, tms[0])
            limit = max(limit, b.t + CHAIN_PX)
    return found


def _extra_steps(labels: list[_Box], boxes: list[_Box], ref_year: int | None, anchor: date | None) -> tuple[Step, ...]:
    """흐름도의 나머지 상자들. 같은 단계가 여러 라벨 조합으로 잡히므로 (단계, 날짜)로 한 번만 남긴다.

    anchor(접수 시작일)보다 앞선 날짜는 버린다 — 흐름도는 언제나 앞으로만 간다.
    ’27.1.20.처럼 연도가 두 자리로 적힌 칸에서 연도를 한 해 앞으로 읽는 경우가 실제로 있어(308123 8쪽),
    틀린 날짜를 싣느니 그 단계를 빼는 쪽이 낫다.
    같은 이유로 괄호 요일이 어긋나는 날짜도 버린다 — Synap이 자릿수를 흘리면(’26.9.11.(금) → ’26 9 1(금))
    날짜만 보고는 못 잡는다(308887 3쪽). 접수·발표는 기존 동작을 지키려 이 검사를 걸지 않는다."""
    hits: dict[str, tuple[float, Step]] = {}
    for b in labels:
        flat = re.sub(r"\s+", "", b.text)
        name = next((n for n, rx in EXTRA_STEPS if rx.search(flat)), None)
        if name is None:
            continue
        found = [h for h in _dates_below(b, boxes, ref_year)
                 if (anchor is None or h.date >= anchor) and WEEKDAY[h.date.weekday()] == h.weekday]
        if not found:
            continue
        lo, hi = min(found, key=lambda h: h.date), max(found, key=lambda h: h.date)
        step = Step(name, lo.date, hi.date if hi.date > lo.date else None,
                    lo.time, hi.time if hi.date > lo.date else None)
        # 같은 단계가 여러 번 잡히면 가장 왼쪽(= 흐름도에서 먼저 오는) 상자를 쓴다
        prev = hits.get(name)
        if prev is None or b.l < prev[0]:
            hits[name] = (b.l, step)
    return tuple(step for _, step in sorted(hits.values(), key=lambda x: (x[1].start, x[0])))


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

    start_h: Hit | None = None
    end_h: Hit | None = None
    if ranked:
        ranked.sort(key=lambda x: (x[0], x[1].t))
        first = _dates_below(ranked[0][1], boxes, ref_year)
        last = _dates_below(ranked[-1][1], boxes, first[-1].date.year if first else ref_year)
        start_h = first[0] if first else None
        pool = last or first
        end_h = max(pool, key=lambda h: h.date) if pool else None
    else:
        for lab in sorted(plain, key=lambda b: b.t):
            hits = _dates_below(lab, boxes, ref_year)
            if hits:
                start_h = min(hits, key=lambda h: h.date)
                end_h = max(hits, key=lambda h: h.date)
                break
    start = start_h.date if start_h else None
    end = end_h.date if end_h else None
    announce = None
    for lab in sorted(announce_labels, key=lambda b: b.t):
        hits = _dates_below(lab, boxes, (end or start).year if (end or start) else ref_year)
        if hits:
            announce = hits[0].date
            break
    if start is None and end is None and announce is None:
        return None
    if start and end and end < start:
        end = None
        end_h = None
    return Schedule(
        start, end, announce, None,
        steps=_extra_steps(labels, boxes, ref_year, start or end),
        apply_start_time=start_h.time if start_h else None,
        apply_end_time=end_h.time if end_h else None,
    )


def parse_schedule(pages: list[tuple[int, str]], ref_year: int | None = None) -> Schedule | None:
    """앞쪽 12쪽 안에서 일정 흐름도를 찾는다. 표지(1쪽)에도 같은 그림이 있어 먼저 잡히면 그걸 쓴다."""
    for page, xml in pages[:12]:
        s = parse_schedule_page(xml, ref_year)
        if s and (s.apply_start or s.apply_end):
            return Schedule(s.apply_start, s.apply_end, s.announce, page,
                            steps=s.steps,
                            apply_start_time=s.apply_start_time,
                            apply_end_time=s.apply_end_time)
    return None
