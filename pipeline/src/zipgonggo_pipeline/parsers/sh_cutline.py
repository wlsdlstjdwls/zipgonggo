"""SH 당첨자 발표 첨부의 「커트라인」·「합격선」 표 파서 — 단지 × 주택형 × 대상별로 어디까지 붙었나.

경쟁률은 몇 명이 몰렸는지만 말한다. 신청자가 정말 궁금한 건 **내 점수로 붙었겠느냐**다.
SH는 당첨자 발표 글에 커트라인 표를 따로 올린다(2026-10-13 실측, 장기전세 46~49차, 미리내집 7·8차,
국민임대 2023~2025, 재개발임대 2023·2025, 청년안심 2023~2026). 서류심사대상자 발표 글에도 같은 꼴의 표가 있다.

양식은 머리글 이름만 다르고 뼈대가 같다 — 왼쪽에 라벨 칸(자치구 | 단지명 | 면적 | 구분 | 대상),
오른쪽에 커트라인 칸 하나나 둘(당첨자 | 예비자). 그래서 양식마다 파서를 두지 않고 머리글 이름으로 칸의 역할을 정한다.

| 문서 | 라벨 칸 | 병합 |
|---|---|---|
| 장기전세 49차 | 사업명 · 면적 · 대상 | 없음(줄마다 이름) |
| 장기전세 46차 | 단지명 · 주택형 · 면적 · 구분 · 대상 | 없음. 구분+대상이 한 조각으로 붙어 오기도(「주거약자주거약자1순위」) |
| 국민임대 2024·2025 | 자치구 · 지구 및 단지명 · 주택형 · 신청구분 | 없음 |
| 재개발임대 2023·2025 | 단지번호 · 자치구 · 단지명 · 신청유형(㎡) | 자치구만 세로 병합 |
| 청년안심주택 | 단지명(+소재지) · 공급유형 · 신청자격 | 단지명이 세로 병합 |

세로 병합 칸은 sh_competition과 같은 방법(sh_complex._split_blocks DP)으로 되살린다 — 병합 글자는 제 블록 정중앙에 찍힌다.

행복주택 「합격선」은 아직 안 받는다. 자치구 · 단지명 · 주택형 · 계층이 모두 겹겹이 병합이고 대부분 「일반 1순위 중 추첨」이라
병합을 잘못 풀었을 때 잃는 게 얻는 것보다 크다. 공공·주거환경임대 「순위/무주택기간/납입회차」 양식도 점수가 아니라 뺀다.

커트라인 칸 글은 **원문 그대로** 싣고(「1순위 22점 미성년자녀1명 전산추첨」), 순위·점수만 따로 뽑아 정렬과 비교에 쓴다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..sources.ish import Char, Segment, group_rows, parse_chars, row_center_y, row_segments
from .sh_complex import _split_blocks

# 머리글 → 칸 역할. 공백을 뗀 글자로 맞춘다
HEAD_ROLES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("gu", re.compile(r"^자치구$")),
    ("no", re.compile(r"^(?:단지번호|연번|번호|순번)$")),
    ("name", re.compile(r"^(?:단지명|단지|사업명|지구및단지명?|주택명)$")),
    ("house", re.compile(r"^주택형$")),
    ("type", re.compile(r"^(?:면적|전용면적|신청유형|공급유형)$")),
    ("bracket", re.compile(r"^(?:구분|공급구분)$")),
    ("class", re.compile(r"^(?:대상|신청구분|신청자격)$")),
)
CUT_HEAD = re.compile(r"커트라인|컷트라인|합격선")
# 행복주택(분류 · 합격선)과 공공·주거환경(무주택기간 · 납입회차)은 받지 않는다 — 모듈 설명.
# 경쟁률 칸이 같이 든 표(공공기숙사 297433: 공급 | 신청 | 경쟁률 | 커트라인)는 숫자 칸이 커트라인 칸으로 샌다
UNSUPPORTED_HEAD = re.compile(r"^(?:분류|주택형공급구분|경쟁률|신청자수?|모집호수|공급호수)$|납입")   # 「신청자격」은 받는다
TOTAL_NAME = re.compile(r"^(?:총계|합계|계|소계)$")
HEAD_MAX = 14            # 칸 머리글 길이 상한. 「서류심사대상자커트라인」이 11자
HEADER_WINDOW = 32.0     # 커트라인 머리글 줄 위아래로 이만큼까지 머리글이 여러 줄로 쪼개져 온다
NOTE_LINE = re.compile(r"^[※*○◦\-·]")
# 소수점이 딴 줄로 떨어지면 「15.75」가 「1575」로 온다 — 네 자리 넘는 숫자는 면적으로 받지 않는다
TYPE_RE = re.compile(r"^(\d{2,3}(?:\.\d+)?(?!\d)\s*[A-Z]?)")
SUBTYPE_SUFFIX = re.compile(r"\s*(셰어형|원룸형|투룸형)$")
GU_IN_ADDR = re.compile(r"\(\s*([가-힣]{1,4}구)\s")
EMPTY_CUT = {"-", "—", "–", ""}

RANK_RE = re.compile(r"(\d)\s*순위")
SCORE_RE = re.compile(r"(\d{1,3})\s*점")


@dataclass(frozen=True)
class CutlineRow:
    """표 한 줄. 커트라인은 원문 글 그대로, 순위·점수는 비교용으로 따로."""

    complex_name: str
    sigungu: str
    supply_type: str        # 면적 표기 "59" · "16A"
    bracket: str            # 구분 「우선」 「일반」 「예비자」 「주거약자」. 그 칸이 없는 양식은 빈 값
    tenant_class: str       # 대상 「일반」 「고령자」 「청년」 「신혼Ⅰ」
    winner_cut: str         # 당첨자(또는 서류심사대상자) 커트라인 원문. 「-」·빈 칸은 빈 값
    reserve_cut: str        # 예비자 커트라인 원문
    page: int

    @property
    def winner_rank(self) -> int | None:
        return cut_rank(self.winner_cut)

    @property
    def winner_score(self) -> int | None:
        return cut_score(self.winner_cut)

    @property
    def reserve_rank(self) -> int | None:
        return cut_rank(self.reserve_cut)

    @property
    def reserve_score(self) -> int | None:
        return cut_score(self.reserve_cut)


def cut_rank(text: str) -> int | None:
    m = RANK_RE.search(text)
    return int(m.group(1)) if m else None


def cut_score(text: str) -> int | None:
    """「1순위 22점 미성년자녀1명」 → 22. 점수가 없는 글(「전원」 「추첨」)은 None."""
    m = SCORE_RE.search(text)
    return int(m.group(1)) if m else None


@dataclass(frozen=True)
class _Col:
    role: str
    cx: float


@dataclass(frozen=True)
class _Line:
    y: float
    cells: dict[str, str]


def _key(s: str) -> str:
    return re.sub(r"\s+", "", s)


def _cx(s: Segment) -> float:
    return (s.l + s.r) / 2


def _role_of(text: str) -> str | None:
    k = re.sub(r"\(.*\)$", "", _key(text))      # 「주택형(㎡)」 「신청유형(㎡)」
    if CUT_HEAD.search(k):
        if "예비" in k:
            return "reserve"
        return "winner"
    for role, pat in HEAD_ROLES:
        if pat.fullmatch(k):
            return role
    return None


def _find_header(rows: list[tuple[float, list[Segment], list[Char]]]) -> tuple[list[_Col], float] | None:
    """커트라인 머리글 줄과 그 위아래로 쪼개진 머리글 → (칸 목록, 머리글 바닥 y). 받지 않는 양식이면 None."""
    # 제목 줄(「… 당첨자 및 예비자 커트라인」)도 커트라인이 들어 있다 — 칸 머리글은 짧다
    anchor = next((y for y, segs, _c in rows
                   if any(CUT_HEAD.search(k := _key(s.text)) and len(k) <= HEAD_MAX for s in segs)), None)
    if anchor is None:
        return None
    cols: list[_Col] = []
    bottom = anchor
    for y, segs, _c in rows:
        if abs(y - anchor) > HEADER_WINDOW:
            continue
        hit = False
        for s in sorted(segs, key=_cx):
            if UNSUPPORTED_HEAD.search(_key(s.text)):
                return None
            role = _role_of(s.text) if len(_key(s.text)) <= HEAD_MAX else None
            taken = {c.role for c in cols}
            # 국민임대 신규단지 표는 「면적 | 공급유형(우선공급) | 대상」 — 면적 다음 「공급유형」은 구분 칸이다
            if role == "type" and "type" in taken and "bracket" not in taken:
                role = "bracket"
            if role and role not in taken:
                cols.append(_Col(role, _cx(s)))
                hit = True
            elif _key(s.text).startswith("(") and y > anchor:
                hit = True          # 「(㎡)」 「(공고문)」 단위 줄
        if hit:
            bottom = max(bottom, y)
    roles = {c.role for c in cols}
    if "winner" not in roles or "name" not in roles:
        return None
    # 주택형만 있으면 그게 면적이다(국민임대). 면적과 같이 있으면(장기전세 46차: 주택형 97 · 면적 33) 칸은 두되 버린다 —
    # 칸을 지우면 그 글자가 옆 칸으로 샌다
    if "house" in roles and "type" not in roles:
        cols = [_Col("type", c.cx) if c.role == "house" else c for c in cols]
    return sorted(cols, key=lambda c: c.cx), bottom


def _widest_gap(chars: list[Char], lo: float, hi: float, min_w: float = 2.5) -> float | None:
    """[lo, hi) 안에서 글자가 한 번도 지나지 않은 가장 넓은 빈 띠의 한가운데(sh_competition과 같은 방법)."""
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


def _bounds(cols: list[_Col], data_chars: list[Char]) -> list[tuple[str, float, float]]:
    """칸 경계. **글자가 지나지 않는 빈 띠**에서 자르고, 없으면 머리글 중심의 중간점.

    중간점만 쓰면 왼쪽 정렬된 커트라인 칸이 옆 칸으로 샌다 — 46차 서류심사 표는 머리글이 칸 오른쪽에 치우쳐
    「고령자」 「14점」이 한 칸(대상)으로 묶였다. 구분 「주거약자」와 대상 「주거약자1순위」처럼 빈 띠가 없는 칸은 중간점으로 물러선다."""
    edges = []
    for a, b in zip(cols, cols[1:]):
        gap = _widest_gap(data_chars, a.cx, b.cx)
        edges.append(gap if gap is not None else (a.cx + b.cx) / 2)
    return [(c.role, float("-inf") if i == 0 else edges[i - 1], float("inf") if i == len(cols) - 1 else edges[i])
            for i, c in enumerate(cols)]


def _assign(chars: list[Char], bounds: list[tuple[str, float, float]]) -> dict[str, str]:
    """글자를 칸에. 조각 단위로 나누면 사이가 좁은 이웃 칸이 한 조각으로 붙어 온다(「주거약자주거약자1순위」)."""
    out: dict[str, list[Char]] = {}
    for ch in chars:
        x = (ch.l + ch.r) / 2
        role = next((r for r, lo, hi in bounds if lo <= x < hi), None)
        if role:
            out.setdefault(role, []).append(ch)
    cells: dict[str, str] = {}
    for role, cs in out.items():
        cs.sort(key=lambda c: (c.l, c.w != 0))
        text = ""
        prev_r = None
        for c in cs:
            if prev_r is not None and c.l - prev_r > max(c.h, 6.0) and not text.endswith(" "):
                text += " "      # 조각 사이가 벌어졌는데 공백 글자가 없다
            text += c.ch
            prev_r = c.r
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            cells[role] = text
    return cells


def _is_data(cells: dict[str, str]) -> bool:
    """한 줄이 표의 행인가. 커트라인 칸이나 대상 칸이 있어야 행이다 — 단지명만, 면적만 있는 줄은 병합 칸 라벨이다.
    두 줄로 접힌 커트라인 칸의 꼬리(「,」만 있는 줄)는 행이 아니다."""
    return any(re.search(r"[0-9A-Za-z가-힣-]", cells.get(k, "")) for k in ("winner", "reserve", "class"))


def _labels(lines: list[_Line], role: str) -> list[tuple[float, str]]:
    """세로 병합 라벨. 단지명 아래 붙은 소재지 줄(「(노원구 상계동 690)」)은 단지명에 묶는다."""
    out: list[tuple[float, str]] = []
    for ln in lines:
        v = ln.cells.get(role, "")
        if not v:
            continue
        # 소재지 줄은 블록을 열지 않는다 — 줄 간격은 문서 배율마다 달라(308537은 두 배) 거리로 재지 않는다
        if role == "name" and out and v.startswith("("):
            # 이름과 소재지가 두 줄로 한 칸이다 — 블록 중심은 두 줄 가운데
            out[-1] = ((out[-1][0] + ln.y) / 2, f"{out[-1][1]} {v}")
            continue
        out.append((ln.y, v))
    return out


def _fill(data: list[_Line], labels: list[tuple[float, str]]) -> list[str]:
    """데이터 줄마다 병합 라벨을 하나씩. 라벨이 줄보다 많으면(빈 블록) 가장 가까운 라벨로 물러선다."""
    if not labels:
        return [""] * len(data)
    ys = [d.y for d in data]
    if len(labels) > len(ys):
        return [min(labels, key=lambda lb: abs(lb[0] - y))[1] for y in ys]
    idx = _split_blocks(ys, [y for y, _t in labels])
    return [labels[k][1] if k >= 0 else "" for k in idx]


def _clean_name(raw: str) -> tuple[str, str]:
    """「해링턴 플레이스 노원 센트럴 (노원구 상계동 690)」 → (이름, 자치구). 「[우선공급] 래미안센터피스」는 꼬리표를 뗀다."""
    gu = ""
    m = GU_IN_ADDR.search(raw)
    if m:
        gu = m.group(1)
        raw = raw[: m.start()].strip()
    raw = re.sub(r"^\[[^\]]*\]\s*", "", raw).strip()
    return raw, gu


def _clean_type(raw: str) -> str:
    raw = SUBTYPE_SUFFIX.sub("", raw.strip())
    m = TYPE_RE.match(raw)
    return re.sub(r"\s+", "", m.group(1)) if m else ""


def _clean_class(raw: str) -> str:
    """「신혼 Ⅰ」 「신혼 I」 「신혼Ⅰ」을 하나로."""
    t = re.sub(r"\s+", " ", raw).strip()
    t = re.sub(r"\s*(?:Ⅱ|II)$", "Ⅱ", t)
    return re.sub(r"\s*(?:Ⅰ|I)$", "Ⅰ", t)


def _clean_cut(raw: str) -> str:
    t = re.sub(r"\s+", " ", raw).strip()
    return "" if t in EMPTY_CUT else t


def _page_lines(xml: str) -> list[tuple[float, list[Segment], list[Char]]]:
    out = []
    for row in group_rows(parse_chars(xml)):
        segs = row_segments(row)
        if segs:
            out.append((row_center_y(row), segs, row))
    return out


def parse_cutline_page(xml: str, page: int, cols: list[_Col] | None = None) -> tuple[list[CutlineRow], list[_Col] | None]:
    """한 쪽. 머리글이 없는 쪽(머리글을 첫 쪽에만 찍는 문서)은 앞 쪽 칸을 물려받는다. (행, 이 쪽에서 쓴 칸)."""
    rows = _page_lines(xml)
    found = _find_header(rows)
    if found:
        cols, bottom = found
    elif cols is None:
        return [], None
    else:
        bottom = float("-inf")
    body = [(y, segs, chars) for y, segs, chars in rows if y > bottom and not NOTE_LINE.match(segs[0].text)]
    bounds = _bounds(cols, [c for _y, _s, chars in body for c in chars])
    lines: list[_Line] = []
    for y, _segs, chars in body:
        cells = _assign(chars, bounds)
        if any(CUT_HEAD.search(_key(v)) for v in cells.values()):
            continue      # 다음 표 머리글(재공급 · 신규공급 두 표를 한 문서에 싣는다)
        lines.append(_Line(y, cells))
    data = [ln for ln in lines if _is_data(ln.cells)]
    if not data:
        return [], cols
    roles = {c.role for c in cols}
    filled: dict[str, list[str]] = {}
    for role in ("gu", "name", "type", "bracket", "class"):
        if role not in roles:
            filled[role] = [""] * len(data)
        elif all(d.cells.get(role) for d in data):
            filled[role] = [d.cells[role] for d in data]
        else:
            filled[role] = _fill(data, _labels(lines, role))
    out: list[CutlineRow] = []
    for i, d in enumerate(data):
        name, gu_addr = _clean_name(filled["name"][i])
        if not re.search(r"[가-힣A-Za-z]{2,}", name) or TOTAL_NAME.fullmatch(_key(name)):
            continue
        cls = _clean_class(filled["class"][i])
        out.append(CutlineRow(
            complex_name=name,
            sigungu=filled["gu"][i] or gu_addr,
            supply_type=_clean_type(filled["type"][i]),
            bracket=_key(filled["bracket"][i]),      # 「우 선」처럼 자간을 벌려 찍는다
            tenant_class=cls,
            winner_cut=_clean_cut(d.cells.get("winner", "")),
            reserve_cut=_clean_cut(d.cells.get("reserve", "")),
            page=page,
        ))
    return out, cols


def parse_cutline(pages: list[tuple[int, str]]) -> list[CutlineRow]:
    out: list[CutlineRow] = []
    cols: list[_Col] | None = None
    for page, xml in pages:
        rows, cols = parse_cutline_page(xml, page, cols)
        out.extend(rows)
    return out
