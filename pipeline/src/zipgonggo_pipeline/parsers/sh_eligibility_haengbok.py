"""SH 행복주택 공고문 「4 신청자격 및 입주자 선정 방법」 파서.

장기전세(sh_eligibility.py)와 양식이 다르다 — 「소득기준 및 신청순위」 표가 없고, 계층(대학생·청년·신혼부부·고령자·주거급여수급자)
마다 절이 하나씩 있다. 공통 절(4-1)에 소득표·자산·자동차 기준, 계층 절(4-2~4-6)에 일반공급 요건·순위, 우선공급 순위·배점, 경쟁 시
선정 순서가 있다.

실측(2026년 2차 309337 18~32쪽, 2026년 1차 304864, 2025년 2차 298109):
- 「▶ 소득기준」 표: 구분 열(「가구원수별 / 가구당 월평균소득의 / N퍼센트」 세 줄 라벨, x<160) | 적용 조건(x 220~310) | 1~5인 가구(헤더
  「1인 가구」「2인 가구」는 윗줄, 「3인 가구」… 는 아랫줄). 1인 +20%p, 2인 +10%p가 표에 직접 들어 있다(각주). 6인 이상은 5인 + 1인당 평균금액.
  조건 칸은 행마다 줄 수가 다르고(120%는 7줄) 줄 간격(14~20)이 행 사이 간격(19~22)과 겹친다 → 값 줄 사이의 가장 넓은 틈에서 자른다.
- 「▶ 자산기준」·「▶ 자동차기준」: 계층별 글머리 「- 대학생 계층은 총자산 기준 10800만원 이하」 + 출생자녀 가산 「· … 1명인 경우: 11900만원 이하」
  「[단 … 추가로 있는 경우: 13000만원 이하]」 「· … 2명 이상인 경우: 13000만원 이하」.
- 계층 절 제목은 가운데 정렬 「4-2 대학생 계층」(x≥250). 「○ 일반공급」 요건은 ①②③(①-㉮ 갈래 포함), 「▷ 일반공급 순위」 표는 순위 라벨(x<100)이
  병합 칸 한가운데 + 글(x≥100) 여러 줄. 「○ 우선공급」 → 「▷ (우선공급) 순위」 → 「▷ (우선공급) 배점」(항목 | 3점 | (2점) | 1점) → 「▶/■ 경쟁 시
  입주자 선정기준」(구분 | 입주자 선정 순서).
- 배점표 항목 라벨(x<150)이 칸 글과 붙어 한 조각이 되기도 한다(309337 청년 「② 주택청약종합저축(청약저축 포함) 가입 2년이 경과한 자로서 …」)
  → 칸 열의 왼쪽 끝에서 글자를 가른다. 대학생 표는 「거주」(x 68)가 「대학생」「취업준비생」(x 108~119) 두 행에 걸친 라벨이다.
- 항목 글에 점수가 박힌 줄(「③ 장애인 … : 3점」)은 칸이 없다 → 끝의 「: n점」을 그 점수 칸에 넣는다.
"""

from __future__ import annotations

import re
from typing import Any

from .sh_eligibility import (
    Line,
    Seg,
    _clean,
    _find,
    _lines,
    _meaningful,
    _nearest,
    _squash,
)

SECTION_RE = re.compile(r"^4-(\d)\s*(.+)$")
CLASS_TITLE_MIN_L = 250
RANK_RE = re.compile(r"^(\d)\s*순위$")
RANK_MAX_L = 100
PCT_LABEL_RE = re.compile(r"^(\d+)\s*퍼센트$")
PCT_LABEL_ALT_RE = re.compile(r"월평균소득의(\d+)%$")   # 매입임대 소득기준표 「가구당 월평균소득의 130%」
HOUSEHOLD_RE = re.compile(r"^(\d)인\s*가구$")
POINT_RE = re.compile(r"^(\d+)\s*점$")
INLINE_POINT_RE = re.compile(r"[:：]\s*(\d+)\s*점\s*$")
ITEM_RE = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]")
MANWON_RE = re.compile(r"([\d,]+)\s*만\s*원")
NOTE_RE = re.compile(r"^[※＊*]")
LABEL_MAX_L = 150        # 배점표·순위표·선정표의 왼쪽 라벨 열
SPAN_LABEL_MAX_L = 90    # 대학생 배점표 「거주」처럼 두 행에 걸친 라벨은 더 왼쪽에 있다
NOTE_MAX_L = 66          # 표 아래 각주(※)는 본문 왼끝(57~58). 칸 안의 ※ 주석은 170 이상
COND_MIN_L = 200         # 소득표 적용 조건 열
CONTINUATION_MIN_L = 66  # 요건·각주의 이어지는 줄은 첫 줄보다 들여쓴다
SCORE_COL_HALF = 30

INCOME_HEADING = "소득기준"
ASSET_HEADING = "자산기준"
CAR_HEADING = "자동차기준"
COMMON_END = "기타 사항"
GENERAL_HEADING = "일반공급"
PRIORITY_HEADING = "우선공급"
GENERAL_RANK_HEADING = "일반공급 순위"
PRIORITY_RANK_HEADINGS = ("우선공급 순위", "순위")
SCORE_HEADINGS = ("우선공급 배점", "배점")
SELECTION_HEADING = "경쟁 시 입주자 선정기준"
SECTION_END = "신청접수 안내"

BONUS_COLUMNS = ("기본", "출생자녀 1명", "출생자녀 1명과 이전 출생 자녀", "출생자녀 2명 이상")


def _cut_rows(anchors: list[float], ys: list[float]) -> list[float]:
    """병합 칸 행 경계. 라벨(anchor)은 칸 한가운데에 있고 칸 높이는 행마다 달라 「가까운 라벨」로는 못 가른다 —
    이웃한 두 라벨 사이에 놓인 줄들 중 가장 넓은 틈이 행 경계다(줄이 하나 이하면 라벨 중간점)."""
    cuts: list[float] = []
    for a, b in zip(anchors, anchors[1:]):
        between = sorted(y for y in ys if a < y < b)
        pts = [a, *between, b]
        gaps = [(y2 - y1, (y1 + y2) / 2) for y1, y2 in zip(pts, pts[1:])]
        cuts.append(max(gaps, key=lambda g: g[0])[1])
    return cuts


def _row_index(y: float, cuts: list[float]) -> int:
    return sum(1 for c in cuts if y > c)


def _heading(ln: Line) -> str:
    """「▶ 소득기준」「○ 일반공급」「▷ 우선공급 배점(…)」 → 글머리를 뗀 제목. 제목 줄이 아니면 빈 문자열."""
    f = ln.first()
    if not re.match(r"^[▶▷○■◦]", f):
        return ""
    return _squash(re.sub(r"\(.*", "", f[1:]))


def _is_heading(ln: Line, *names: str) -> bool:
    h = _heading(ln)
    return bool(h) and any(h == _squash(n) for n in names)


def _starts_heading(ln: Line, *names: str) -> bool:
    h = _heading(ln)
    return bool(h) and any(h.startswith(_squash(n)) for n in names)


# ── 4-1 공통: 소득표 ──────────────────────────────────────────


def parse_income_table(lines: list[Line]) -> dict[str, Any] | None:
    """「▶ 소득기준」 표 → {households, rows:[{pct, won[], conditions[]}], bump, per_person_won}.

    값은 글자 하나하나를 가구원수 열(x)에 넣는다 — 열이 붙어 「10618958114428631212508112878142」처럼 한 조각으로 읽히는 양식(매입임대)
    도 같은 함수로 읽기 위해서다. 행은 「N퍼센트」 라벨의 y로 정하고 값 줄은 가장 가까운 라벨에 붙인다(라벨 세 줄 중 가운데 줄이 값 줄).
    """
    start = _find(lines, _squash(INCOME_HEADING))
    if start is None:
        return None
    end = min(i for i in (_find(lines, _squash(ASSET_HEADING), start + 1), len(lines)) if i is not None)
    span = lines[start + 1:end]
    households: list[tuple[int, float]] = []
    header_y: float | None = None
    header_bottom = 0.0
    for ln in span:
        hh = [(int(HOUSEHOLD_RE.match(s.text.replace(" ", "")).group(1)), s.cx)
              for s in ln.segs if HOUSEHOLD_RE.match(s.text.replace(" ", ""))]
        if hh and (header_y is None or ln.y - header_y <= 12):
            households.extend(hh)
            header_y = ln.y if header_y is None else header_y
            header_bottom = ln.y + 12
        elif households:
            break
    if len(households) < 3:
        return None
    households.sort()
    col_xs = [x for _, x in households]
    value_min_l = min(col_xs) - 40

    pct_rows: list[tuple[int, float]] = []
    value_lines: list[Line] = []
    cond_frags: list[tuple[float, str]] = []
    notes: list[str] = []
    for ln in span:
        if ln.y <= header_bottom:
            continue
        f = ln.first()
        if NOTE_RE.match(f) and ln.segs[0].l < value_min_l - 60 and ln.segs[0].l < COND_MIN_L:
            # 표 아래 각주(「＊위 표의 …」「* 6인 이상 가구는 …」). 표는 여기서 끝난다
            notes.append(ln.text())
            continue
        if notes:
            notes[-1] = notes[-1] + " " + ln.text()
            continue
        for s in ln.segs:
            key = s.text.replace(" ", "")
            m = PCT_LABEL_RE.match(key) or PCT_LABEL_ALT_RE.search(key)
            if m and s.l < 200:
                pct_rows.append((int(m.group(1)), ln.y))
        digit_segs = [s for s in ln.segs if s.l >= value_min_l and re.fullmatch(r"[\d,]+", s.text.replace(" ", ""))]
        if digit_segs:
            value_lines.append(ln)
        for s in ln.segs:
            if s in digit_segs or s.l >= value_min_l:
                continue
            if s.l >= COND_MIN_L:
                cond_frags.append((ln.y, s.text))
            elif s.r > COND_MIN_L + 20 and s.chars:
                # 「가구당 월평균소득의 2 맞벌이인 동시에」 — 라벨과 조건이 한 조각. 조건 열 왼끝에서 가르되 낱말 중간(「…의」)은 넘긴다
                k = next((i for i, c in enumerate(s.chars) if c.l >= COND_MIN_L), len(s.chars))
                while 0 < k < len(s.chars) and s.chars[k - 1].ch.strip():
                    k += 1
                right = "".join(c.ch for c in s.chars[k:]).strip()
                if right:
                    cond_frags.append((ln.y, right))
    if not pct_rows or not value_lines:
        return None

    row_ys = [y for _, y in pct_rows]
    digits: dict[tuple[int, int], list[tuple[float, str]]] = {}
    value_ys: dict[int, float] = {}
    for ln in value_lines:
        ri = _nearest(ln.y, row_ys)
        if abs(row_ys[ri] - ln.y) > 24:
            continue
        value_ys.setdefault(ri, ln.y)
        for sg in ln.segs:
            if sg.l < value_min_l:
                continue
            for c in sg.chars:
                if c.ch in "0123456789":
                    ci = _nearest(c.l + c.w / 2, col_xs)
                    digits.setdefault((ri, ci), []).append((c.l, c.ch))

    # 적용 조건: 값 줄 사이의 가장 넓은 틈에서 행을 가른다(조건 칸은 행마다 줄 수가 달라 가까운 라벨로는 못 가른다)
    cond_sorted = sorted(cond_frags)
    anchors = [value_ys.get(i, row_ys[i]) for i in range(len(pct_rows))]
    cuts = _cut_rows(anchors, [y for y, _ in cond_sorted])
    conds_by_row: list[list[str]] = [[] for _ in pct_rows]
    for y, text in cond_sorted:
        conds_by_row[_row_index(y, cuts)].append(text)

    rows = []
    for ri, (pct, _) in enumerate(pct_rows):
        won: list[int | None] = []
        for ci in range(len(households)):
            ds = sorted(digits.get((ri, ci), []))
            won.append(int("".join(ch for _, ch in ds)) if ds else None)
        rows.append({"pct": pct, "won": won, "conditions": _join_conditions(conds_by_row[ri])})

    note_text = " ".join(notes)
    per_person: dict[str, int] = {}
    for m in re.finditer(r"(\d+)퍼센트는\s*1인당\s*평균금액\*?\s*\(\s*([\d,]+)\s*원", note_text):
        per_person[m.group(1)] = int(m.group(2).replace(",", ""))
    bump = {"1": 20, "2": 10} if "20%p" in note_text.replace(" ", "") or "20%p" in _squash(note_text) else {}
    return {
        "households": [h for h, _ in households],
        "rows": rows,
        "bump": bump,
        "keep_blank": True,   # 1인 110% 이상 칸은 원문에 없다 — 검산 뒤에도 채우지 않는다
        "per_person_won": per_person,
        "notes": [_clean(n.lstrip("＊* ")) for n in notes],
    }


def _join_conditions(frags: list[str]) -> list[str]:
    """조건 칸 조각을 조건 단위로 잇는다. 「공통」「신혼부부 계층」은 새 조건의 머리, 「① …」「② …」「1 …」「2 …」도 새 조건이다."""
    out: list[str] = []
    for t in frags:
        key = t.strip()
        new = key in ("공통", "신혼부부 계층") or re.match(r"^[①②③④⑤]|^[12]\s", key) is not None
        if new or not out:
            out.append(key)
        else:
            out[-1] = out[-1] + " " + key
    cleaned = []
    for c in out:
        c = re.sub(r"^([12])\s+", lambda m: "①②"[int(m.group(1)) - 1] + " ", c)
        cleaned.append(_clean(c))
    return cleaned


# ── 4-1 공통: 자산·자동차 ─────────────────────────────────────


def _manwon(text: str) -> int | None:
    m = MANWON_RE.search(text.replace(" ", ""))
    return int(m.group(1).replace(",", "")) if m else None


def parse_asset(lines: list[Line]) -> dict[str, Any] | None:
    """「▶ 자산기준」 + 「▶ 자동차기준」 글머리 → 계층 × (기본 | 출생자녀 1명 | 1명+이전 자녀 | 2명 이상)."""
    start = _find(lines, _squash(ASSET_HEADING))
    if start is None:
        return None
    end = min(i for i in (_find(lines, _squash(COMMON_END), start + 1), len(lines)) if i is not None)
    rows: list[dict[str, Any]] = []
    kind = "총자산"
    cur: dict[str, Any] | None = None
    for ln in lines[start + 1:end]:
        f = ln.first()
        if _is_heading(ln, CAR_HEADING):
            kind = "자동차"
            cur = None
            continue
        text = ln.text()
        if f.startswith("-") and ln.segs[0].l < 100:   # 2026년 61~70, 2025년(298109) 78~91
            label = re.sub(r"^-\s*", "", text)
            label = re.split(r"(?:은|는)\s*(?:총자산|현재가치|자동차)", label)[0]
            label = re.sub(r"\s*[・·]\s*", " | ", label)   # 「신혼부부 계층 · 고령자」 — 화면 나열 구분은 「 | 」
            v = _manwon(text)
            if v is None and kind == "자동차" and "소유하고있지않아야" in text.replace(" ", ""):
                v = 0
            cur = {"label": _clean(f"{label} {kind}"), "values_man": [v, None, None, None]}
            rows.append(cur)
        elif cur is not None and f[:1] in "·•[" and ln.segs[0].l < 120:   # 가산 줄. 2025년은 「•」 x 103~110
            v = _manwon(text)
            if v is None:
                continue
            squashed = text.replace(" ", "")
            if "2명이상" in squashed:
                cur["values_man"][3] = v
            elif "추가로있는" in squashed:
                cur["values_man"][2] = v
            elif "1명" in squashed:
                cur["values_man"][1] = v
    if not rows:
        return None
    for r in rows:
        if r["values_man"][0] == 0:
            r["values_man"] = [0, 0, 0, 0]   # 대학생 자동차: 소유 불가
    return {"columns": list(BONUS_COLUMNS), "rows": rows}


# ── 계층 절 ──────────────────────────────────────────────────


def _split_sections(lines: list[Line]) -> list[tuple[str, list[Line]]]:
    out: list[tuple[str, list[Line]]] = []
    cur: list[Line] | None = None
    for ln in lines:
        f = ln.first()
        m = SECTION_RE.match(f.replace("  ", " "))
        if m and ln.segs[0].l >= CLASS_TITLE_MIN_L and len(ln.segs) == 1:
            if m.group(1) == "1":
                cur = None
                continue
            cur = []
            out.append((_clean(m.group(2)), cur))
            continue
        if cur is not None and _squash(SECTION_END) in _squash(ln.text()) and ln.segs[0].l < 200:
            cur = None
            continue
        if cur is not None:
            cur.append(ln)
    return out


def _collect_notes(lines: list[Line]) -> list[str]:
    """본문 왼끝의 ※ 각주. 들여쓴 다음 줄은 이어 붙인다."""
    notes: list[str] = []
    open_ = False
    for ln in lines:
        f = ln.first()
        l = ln.segs[0].l
        if NOTE_RE.match(f) and l < NOTE_MAX_L:
            notes.append(f.lstrip("※* ") + " " + " ".join(s.text for s in ln.segs[1:]))
            open_ = True
        elif open_ and l >= CONTINUATION_MIN_L and l < 100 and not re.match(r"^[○▷▶■①②③④⑤⑥⑦⑧⑨⑩\-·(\[]", f):
            notes[-1] = notes[-1] + " " + ln.text()
        else:
            open_ = False
    return [_clean(n) for n in notes]


def _requirements(lines: list[Line]) -> tuple[str | None, list[str]]:
    """「○ 일반공급」 아래 머리말과 ①②③ 요건. 「①-㉮ (대학생)…」 갈래도 한 줄이다. ※ 단서는 요건 뒤에 붙는다."""
    intro: list[str] = []
    reqs: list[str] = []
    for ln in lines:
        f = ln.first()
        l = ln.segs[0].l
        text = ln.text()
        if ITEM_RE.match(f) and (reqs or f.startswith("①")):
            # 첫 요건은 ①로 시작한다. 머리말이 「(대학생은 ①-㉮와 ②~④ …」/「②~④)을 모두 갖춘 자」로 갈린 줄(298109)은 요건이 아니다
            reqs.append(text)
        elif reqs and (NOTE_RE.match(f) and l >= 66 and l < 100):
            reqs[-1] = reqs[-1] + " " + text
        elif reqs and l >= 75 and not NOTE_RE.match(f):
            reqs[-1] = reqs[-1] + " " + text
        elif not reqs and not NOTE_RE.match(f):
            intro.append(text)
    return (_clean(" ".join(intro)) or None, [_clean(r) for r in reqs])


def _rank_rows(lines: list[Line]) -> list[dict[str, Any]]:
    """순위 표: 순위 라벨(x<100)은 병합 칸 한가운데, 글은 여러 줄·여러 열. 글 줄은 가장 가까운 라벨에 붙이고 열은 x로 가른다."""
    ranks: list[tuple[int, float]] = []
    frags: list[tuple[float, Seg]] = []
    for ln in lines:
        for s in ln.segs:
            key = s.text.replace(" ", "")
            m = RANK_RE.match(key)
            if m and s.l < RANK_MAX_L:
                ranks.append((int(m.group(1)), ln.y))
            elif s.l >= RANK_MAX_L:
                frags.append((ln.y, s))
    if not ranks:
        return []
    cuts = _cut_rows([y for _, y in ranks], [y for y, _ in frags])
    buckets: list[list[Seg]] = [[] for _ in ranks]
    for y, s in frags:
        buckets[_row_index(y, cuts)].append(s)
    rows = []
    for (rank, _), segs in zip(ranks, buckets):
        cols: list[list[Seg]] = []
        for s in sorted(segs, key=lambda s: s.l):
            for col in cols:
                if abs(s.l - col[0].l) <= 40:
                    col.append(s)
                    break
            else:
                cols.append([s])
        text = " ".join(" ".join(c.text for c in sorted(col, key=lambda c: c.y)) for col in cols)
        rows.append({"rank": rank, "text": _clean(text)})
    return rows


def _split_at(s: Seg, bounds: list[float]) -> list[Seg]:
    """조각이 칸 경계를 넘으면 경계에서 글자를 갈라 조각 여럿으로. 한 칸 안의 조각은 그대로."""
    crossing = [b for b in bounds if s.l < b - 6 and s.r > b + 6]
    if not crossing or not s.chars:
        return [s]
    out: list[Seg] = []
    cur: list = []
    edges = [*crossing, float("inf")]
    ei = 0
    for c in sorted(s.chars, key=lambda c: c.l):
        while c.l + c.w / 2 > edges[ei] and ei < len(edges) - 1:
            if cur:
                out.append(Seg(cur[0].l, cur[-1].r, "".join(x.ch for x in cur).strip(), list(cur), s.y))
            cur = []
            ei += 1
        cur.append(c)
    if cur:
        out.append(Seg(cur[0].l, cur[-1].r, "".join(x.ch for x in cur).strip(), list(cur), s.y))
    return [p for p in out if p.text]


def _score_table(lines: list[Line]) -> dict[str, Any] | None:
    header = next((ln for ln in lines if sum(1 for s in ln.segs if POINT_RE.match(s.text.replace(" ", ""))) >= 2), None)
    if header is None:
        return None
    points = [(int(POINT_RE.match(s.text.replace(" ", "")).group(1)), s.cx)
              for s in header.segs if POINT_RE.match(s.text.replace(" ", ""))]
    centers = [c for _, c in points]
    body: list[Line] = []
    for ln in lines[lines.index(header) + 1:]:
        if NOTE_RE.match(ln.first()) and ln.segs[0].l < NOTE_MAX_L:
            break
        body.append(ln)
    if not body:
        return None
    # 칸 열의 왼쪽 끝 — 라벨 조각이 여기를 넘으면 글자를 가른다
    cell_ls = [s.l for ln in body for s in ln.segs if s.l >= LABEL_MAX_L]
    cell_left = min(cell_ls) if cell_ls else LABEL_MAX_L
    labels: list[tuple[float, float, str]] = []   # (y, l, text)
    cells: list[tuple[float, Seg]] = []
    inline: list[tuple[float, int, str]] = []     # 「③ 장애인 … : 3점」
    # 칸 사이 경계(헤더 점수 x의 중간점). 두 칸에 걸쳐 한 조각으로 읽힌 글(「※ 자치구 최종전입일이 2021 ※ 자치구 최종전입일이 2021」)을 여기서 가른다
    bounds = [(a + b) / 2 for a, b in zip(centers, centers[1:])]
    for ln in body:
        for s in ln.segs:
            if s.l < LABEL_MAX_L:
                m = INLINE_POINT_RE.search(s.text)
                if m:
                    # 「… 장애등급자 : 3점」 — 칸 없이 항목 글에 점수가 박힌 줄
                    inline.append((ln.y, int(m.group(1)), INLINE_POINT_RE.sub("", s.text)))
                    continue
                wide = len(centers) >= 2 and s.r >= centers[1]   # 표 폭 전체를 쓰는 항목 글(앞 줄)
                if not wide and s.r > cell_left + 8 and s.chars:
                    left = "".join(c.ch for c in s.chars if c.l < cell_left - 4).strip()
                    right = "".join(c.ch for c in s.chars if c.l >= cell_left - 4).strip()
                    if left:
                        labels.append((ln.y, s.l, left))
                    if right:
                        rl = min(c.l for c in s.chars if c.l >= cell_left - 4)
                        cells.append((ln.y, Seg(rl, s.r, right, [], ln.y)))
                    continue
                labels.append((ln.y, s.l, s.text))
            else:
                cells.extend((ln.y, p) for p in _split_at(s, bounds))
    if not labels and not inline:
        return None
    # 항목: 라벨 줄을 항목으로 묶는다. ① 표시가 있거나 앞 라벨과 20px 넘게 떨어지면 새 항목
    span_labels = [x for x in labels if x[1] < SPAN_LABEL_MAX_L and not ITEM_RE.match(x[2])]
    sub_labels = [x for x in labels if x[1] >= SPAN_LABEL_MAX_L]
    items: list[dict[str, Any]] = []
    if span_labels and sub_labels:
        span_text = _clean(" ".join(t for _, _, t in sorted(span_labels)))
        for y, _, t in sorted(sub_labels):
            items.append({"y": y, "label": f"{span_text} ({_clean(t)})", "cells": [[] for _ in points]})
    else:
        prev_y: float | None = None
        for y, _, t in sorted(labels):
            if items and not ITEM_RE.match(t) and prev_y is not None and y - prev_y <= 20:
                items[-1]["label"] += " " + t
                items[-1]["y"] = (items[-1]["y0"] + y) / 2
            else:
                items.append({"y": y, "y0": y, "label": t, "cells": [[] for _ in points]})
            prev_y = y
    for it in items:
        it.pop("y0", None)
    if items:
        items.sort(key=lambda it: it["y"])
        cuts = _cut_rows([it["y"] for it in items], [y for y, _ in cells])
        for y, s in cells:
            it = items[_row_index(y, cuts)]
            ci = _nearest(s.cx, centers)
            it["cells"][ci].append((y, s.l, s.text))
    for y, pt, text in inline:
        cells_ = [[] for _ in points]
        if pt in [p for p, _ in points]:
            cells_[[p for p, _ in points].index(pt)].append((y, 0, "해당"))
        items.append({"y": y, "label": text, "cells": cells_})
    # 항목 글이 두 줄인 인라인 항목(「③ 장애인 … 등급」/「1~14급자 … : 3점」) — 앞 줄 라벨을 잇는다
    out_items = []
    for it in sorted(items, key=lambda x: x["y"]):
        cells_txt = [_clean(" ".join(t for _, _, t in sorted(c))) if c else "" for c in it["cells"]]
        out_items.append({"label": _clean(it["label"]), "cells": cells_txt, "note": None})
    merged: list[dict[str, Any]] = []
    for it in out_items:
        # 앞 항목이 칸 없는 글 한 줄(「③ 장애인 … 신체장해등급」)이고 이 항목이 ① 표시 없는 뒷줄(「1~14급자 … : 3점」)이면 한 항목
        if merged and not any(merged[-1]["cells"]) and not ITEM_RE.match(it["label"]):
            merged[-1]["label"] += " " + it["label"]
            merged[-1]["cells"] = it["cells"]
        else:
            merged.append(it)
    return {"group": None, "points": [p for p, _ in points], "items": merged}


def _selection(lines: list[Line]) -> dict[str, Any] | None:
    rows = []
    for ln in lines:
        label = [s for s in ln.segs if s.l < LABEL_MAX_L]
        steps = [s for s in ln.segs if s.l >= LABEL_MAX_L]
        if not label or not steps:
            continue
        if label[0].text in ("구분",):
            continue
        text = " ".join(s.text for s in sorted(steps, key=lambda s: s.l))
        parts = [_clean(p) for p in re.split(r"→", text) if _meaningful(p)]
        rows.append({"group": _clean(label[0].text), "area": None, "steps": parts})
    return {"title": "경쟁 시 입주자 선정기준", "rows": rows, "tie_break": None} if rows else None


def _parse_class(name: str, lines: list[Line]) -> dict[str, Any]:
    """계층 절 하나 → {name, general, priority, selection, notes}. 소제목 줄에서 상태를 바꾸며 한 번 훑는다."""
    parts: dict[str, list[Line]] = {"general": [], "general_rank": [], "priority": [], "priority_rank": [], "score": [], "selection": [], "tail": []}
    state = "general"
    for ln in lines:
        if _is_heading(ln, GENERAL_HEADING):
            state = "general"
            continue
        if _is_heading(ln, GENERAL_RANK_HEADING):
            state = "general_rank"
            continue
        if _is_heading(ln, PRIORITY_HEADING):
            state = "priority"
            continue
        if _is_heading(ln, *PRIORITY_RANK_HEADINGS):
            state = "priority_rank"
            continue
        if _starts_heading(ln, *SCORE_HEADINGS):
            state = "score"
            continue
        if _starts_heading(ln, SELECTION_HEADING):
            state = "selection"
            continue
        parts[state].append(ln)

    def body(ls: list[Line]) -> list[Line]:
        return [ln for ln in ls if not (NOTE_RE.match(ln.first()) and ln.segs[0].l < NOTE_MAX_L)]

    intro, reqs = _requirements(body(parts["general"]))
    p_intro, _ = _requirements(body(parts["priority"]))
    sel_lines = parts["selection"]
    # 선정 표는 첫 ※ 각주에서 끝나고 그 뒤는 계층 절 전체의 각주
    sel_body: list[Line] = []
    for ln in sel_lines:
        if NOTE_RE.match(ln.first()) and ln.segs[0].l < NOTE_MAX_L:
            break
        sel_body.append(ln)
    score_lines = parts["score"]
    return {
        "name": name,
        "general": {
            "intro": intro,
            "requirements": reqs,
            "ranks": _rank_rows(body(parts["general_rank"])),
            "notes": _collect_notes(parts["general"]) + _collect_notes(parts["general_rank"]),
        },
        "priority": {
            "intro": p_intro,
            "ranks": _rank_rows(body(parts["priority_rank"])),
            "score": _score_table(score_lines),
            "notes": _collect_notes(parts["priority"]) + _collect_notes(parts["priority_rank"]) + _collect_notes(score_lines),
        },
        "selection": _selection(sel_body),
        "notes": _collect_notes(sel_lines),
    }


# ── 입구 ────────────────────────────────────────────────────


def parse_haengbok(pages: list[tuple[int, str]]) -> dict[str, Any] | None:
    """행복주택 양식 → 신청자격 묶음(dict). 「4-1 공통 신청자격」·계층 절이 없으면 None."""
    lines = _lines(pages)
    sections = _split_sections(lines)
    if not sections:
        return None
    common_start = next((i for i, ln in enumerate(lines)
                         if SECTION_RE.match(ln.first()) and ln.segs[0].l >= CLASS_TITLE_MIN_L and ln.first().startswith("4-1")), None)
    common_end = next((i for i, ln in enumerate(lines)
                       if i > (common_start or 0) and SECTION_RE.match(ln.first()) and ln.segs[0].l >= CLASS_TITLE_MIN_L
                       and not ln.first().startswith("4-1")), len(lines))
    common = lines[common_start:common_end] if common_start is not None else []
    income = parse_income_table(common) if common else None
    asset = parse_asset(common) if common else None
    classes = [_parse_class(name, ls) for name, ls in sections]
    classes = [c for c in classes if c["general"]["requirements"] or c["priority"]["ranks"]]
    if not classes:
        return None
    pages_used = {ln.page for ln in common} | {ln.page for _, ls in sections for ln in ls}
    return {
        "kind": "haengbok",
        "source_pages": sorted(pages_used),
        "rank_tables": [],
        "bonus_conditions": [],
        "bonus_notes": [],
        "income_matrix": None,
        "asset": asset,
        "income_table": income,
        "selection": [],
        "score_tables": [],
        "penalties": None,
        "class_blocks": classes,
    }
