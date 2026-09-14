"""SH 청년 매입임대주택 공고문 「신청자격」 파서 — 신청유형 표, 순위 셋 표, 선정 순서, 가점 배점표, 소득 미니표.

장기전세(면적×순위)·행복주택(계층 절)·장기미임대 매입(순위 두 줄)과 다른 네 번째 양식이다.
실측(2026년 1차 306214 22~28쪽, 2025년 2차 304699, 2025년 1차 290219, 2024년 2차 282650 — 네 차수 조판이 같다):
- 「■신청유형」 표: 라벨(대학생·취업준비생·청년·이공계인재, x 54~136) | 요건(x≥145). 라벨은 병합 칸 한가운데, 요건은 한두 줄.
  「• 대학생 유형 관련 세부 기준」 글머리에서 표가 끝난다. 표 위의 「• 아래의 신청 유형 중 …」 글머리 이어지는 줄(x 69~83)은
  라벨이 아니다 — 라벨은 r도 142 안이다.
- 「순위 | 자격 | 상세요건」 표: 순위(x 78~112) | 자격(x 150~280) | 상세(x≥282). 1순위는 자격이 셋(수급자가구·한부모가족·차상위계층),
  2·3순위는 「일반」 하나. 순위 라벨은 병합 칸 한가운데라 행 경계는 **2×중심−윗변**(49차 장기전세 병합 칸과 같은 법).
  자격 하나가 여러 줄(「생계·의료·주거급여 / 수급자가구」)이라 y 틈 30 안이면 한 자격. 자격이 둘 이상이면 상세 줄은 이웃 자격 사이
  가장 넓은 틈(_cut_rows)으로 가른다. 「※ 세대구성원이 …」(x 53) 각주에서 표가 끝난다(2024년은 「■동일순위내경합시…」).
- 선정 순서: 「[서류심사대상자선정]…→…」 「[당첨자선정]…→…」 두 줄(2024년은 첫 줄이 다음 줄로 이어진다 — x 208).
  그 위 「•」 글머리 넷 중 「무작위」가 든 것이 동점 처리.
- 「(표2)가점사항배점표」: 적용대상(x 64~111) | 가점항목(x 137~275) | 내용(x 286~664) | 배점(x 702~709). 항목은 ①~⑦, 항목 라벨은
  병합 칸 한가운데. 행 경계는 이웃 항목 사이 가장 넓은 틈 — 적용대상 열(「공통」이 ④⑤에 걸친다)은 틈 계산에서 뺀다.
  적용대상 라벨도 병합 칸 한가운데 — 제 행의 중심에서 벗어난 만큼 반대쪽으로 펼쳐(2×중심−윗변) 걸친 항목에 다 붙인다.
  ⑦ 청약저축은 내용 칸이 「가 24회 이상 3 / 나 12회 이상 24회 미만 2 / 다 6회 이상 12회 미만 1」 세 줄 — 배점이 둘 이상이면
  내용 줄을 가장 가까운 배점 줄에 붙인다. 표 아래 각주(※, x 54)에서 끝난다.
- 소득 미니표: 「기준 | 1인가구(+20%p) | 2인가구(+10%p) | 3인가구」 머리 + 「50%이하」「100%이하」 두 줄. 1인 +20%p·2인 +10%p가 값에
  직접 들어 있다(bump). Synap이 「100%」의 0을 떨어뜨려 「10%」로 읽힐 수 있다(309802 실측) — 이 양식에 10% 기준은 없으니 100으로 본다.
  표 밑 「□1순위신청자는 … 심사를 진행하지 않습니다」 「□2순위 … 본인과부모를포함」 「□3순위 … 1인가구기준」 세 줄은 화면이 쓰는 각주.
"""

from __future__ import annotations

import re
from typing import Any

from .sh_eligibility import Line, Seg, _clean, _lines, _meaningful, _nearest, _squash
from .sh_eligibility_haengbok import ITEM_RE, NOTE_RE, RANK_RE, _cut_rows, _row_index, _split_at

TYPE_HEADING = "■신청유형"
RANK_HEADER = ("순위", "자격", "상세요건")
SCORE_HEADER = ("적용대상", "가점항목", "내용", "배점")
SELECTION_RE = re.compile(r"^\[(.+?선정)\]\s*(.*)$")
PCT_ROW_RE = re.compile(r"^(\d+)%이하$")
HOUSEHOLD_RE = re.compile(r"^(\d)인가구")

TYPE_LABEL_MAX_R = 142      # 신청유형 라벨 열 오른끝
TYPE_TEXT_MIN_L = 145
RANK_MAX_L = 120            # 순위 열
QUAL_MIN_L, QUAL_MAX_L = 145, 282   # 자격 열
DETAIL_MIN_L = 282          # 상세요건 열
QUAL_GAP = 30               # 자격 라벨 줄 사이 틈이 이보다 넓으면 다른 자격
TARGET_MAX_L = 125          # 배점표 적용대상 열
ITEM_MIN_L, ITEM_MAX_L = 125, 282
CONTENT_MAX_L = 690
POINT_MIN_L = 690
BODY_MIN_L = 62             # 본문 왼끝(※ 각주·■ 제목). 칸 안의 ※는 170 이상
ROW_CENTER_TOL = 12         # 라벨이 제 행 중심에서 이만큼 안에 있으면 한 행짜리 칸


def _segs(ln: Line, bounds: list[float]) -> list[Seg]:
    """칸 경계를 넘는 조각은 경계에서 가른다(라벨과 칸 글이 한 조각으로 붙는 조판 — 2025년 1차 290219 배점표 ①)."""
    return [p for s in ln.segs for p in _split_at(s, bounds)]


def _fix_pct(pct: int | None) -> int | None:
    """Synap이 「100%」의 0을 떨어뜨리면 10%가 된다. 청년 매입임대에 10% 기준은 없다."""
    return 100 if pct == 10 else pct


def _first_l(ln: Line) -> float:
    return ln.segs[0].l if ln.segs else 0.0


def _is_body_note_or_heading(ln: Line) -> bool:
    f = ln.first()
    return _first_l(ln) < BODY_MIN_L + 8 and bool(re.match(r"^[※＊*■•]", f))


def _find_header(lines: list[Line], names: tuple[str, ...], start: int = 0) -> int | None:
    """조각 앞머리가 이름 순서대로 정확히 맞는 줄(표 머리)."""
    for i in range(start, len(lines)):
        keys = [_squash(s.text) for s in lines[i].segs]
        if len(keys) >= len(names) and all(k == n for k, n in zip(keys, names)):
            return i
    return None


# ── 신청유형 ────────────────────────────────────────────────


def parse_applicant_types(lines: list[Line]) -> tuple[list[dict[str, Any]], set[int]]:
    starts = [i for i, ln in enumerate(lines) if _squash(ln.first()) == _squash(TYPE_HEADING)]
    if not starts:
        return [], set()
    start = starts[-1]
    labels: list[tuple[float, str]] = []
    texts: list[tuple[float, str]] = []
    began = False
    for ln in lines[start + 1:start + 40]:
        f = ln.first()
        if re.match(r"^[•▪]", f) and _first_l(ln) < 70:
            if began:
                break
            continue
        if NOTE_RE.match(f) and _first_l(ln) < 70:
            continue
        # 여기서는 조각을 가르지 않는다 — 표 위 글머리의 이어지는 줄(x 69~745)이 갈리면 오른쪽 반이 요건으로 들어온다
        for s in ln.segs:
            if s.r <= TYPE_LABEL_MAX_R and s.l < TYPE_LABEL_MAX_R:
                labels.append((ln.y, s.text))
                began = True
            elif s.l >= TYPE_TEXT_MIN_L:
                texts.append((ln.y, s.text))
                began = True
    if not labels:
        return [], set()
    ys = [y for y, _ in labels]
    grouped: dict[int, list[str]] = {}
    for y, t in texts:
        grouped.setdefault(_nearest(y, ys), []).append(t)
    out = [{"name": _clean(name), "text": _clean(" ".join(grouped.get(i, [])))} for i, (_, name) in enumerate(labels)]
    return out, {lines[start].page}


# ── 순위 | 자격 | 상세요건 ────────────────────────────────


def parse_rank_table(lines: list[Line]) -> tuple[list[dict[str, Any]], set[int]]:
    start = _find_header(lines, RANK_HEADER)
    if start is None:
        return [], set()
    body: list[Line] = []
    for ln in lines[start + 1:start + 60]:
        if _is_body_note_or_heading(ln):
            break
        body.append(ln)
    if not body:
        return [], set()
    anchors = [(ln.y, int(RANK_RE.match(s.text.replace(" ", "")).group(1)))
               for ln in body for s in ln.segs if s.l < RANK_MAX_L and RANK_RE.match(s.text.replace(" ", ""))]
    if not anchors:
        return [], set()
    # 병합 칸 경계: 순위 라벨은 칸 한가운데 → 아랫변 = 2×중심 − 윗변. 첫 윗변은 머리 줄과 첫 본문 줄의 중간
    top = (lines[start].y + body[0].y) / 2
    bounds: list[tuple[float, float, int]] = []
    for y, rank in anchors:
        bot = 2 * y - top
        bounds.append((top, bot, rank))
        top = bot
    rows: list[dict[str, Any]] = []
    for bi, (t, b, rank) in enumerate(bounds):
        last = bi == len(bounds) - 1
        span = [ln for ln in body if t <= ln.y < b or (last and ln.y >= t)]
        quals: list[tuple[float, str]] = []
        details: list[tuple[float, str]] = []
        for ln in span:
            for s in _segs(ln, [QUAL_MAX_L]):
                if QUAL_MIN_L <= s.l < QUAL_MAX_L:
                    quals.append((ln.y, s.text))
                elif s.l >= DETAIL_MIN_L:
                    details.append((ln.y, s.text))
        # 자격 라벨 묶기(줄 틈 30 안이면 한 자격)
        clusters: list[list[tuple[float, str]]] = []
        for y, text in sorted(quals):
            if clusters and y - clusters[-1][-1][0] <= QUAL_GAP:
                clusters[-1].append((y, text))
            else:
                clusters.append([(y, text)])
        names = [_clean(" ".join(t for _, t in c)) for c in clusters]
        centers = [sum(y for y, _ in c) / len(c) for c in clusters]
        details.sort()
        if len(clusters) >= 2:
            cuts = _cut_rows(centers, [y for y, _ in details])
            per: list[list[str]] = [[] for _ in clusters]
            for y, text in details:
                per[_row_index(y, cuts)].append(text)
        else:
            per = [[t for _, t in details]]
            names = names or [None]
        for name, frags in zip(names, per):
            rows.append(_rank_row(rank, name, frags))
    return rows, {ln.page for ln in body}


def _split_notes(frags: list[str]) -> tuple[list[str], list[str]]:
    """조각을 본문(□…)과 주석(※…)으로 가른다. ※ 뒤에 오는 조각은 다음 □가 나올 때까지 주석의 이어지는 줄이다
    (「※수급자자격인정범위:… 동일한주민 / 등록등본표에등재된신청자의부모」)."""
    main: list[str] = []
    notes: list[str] = []
    in_note = False
    for f in frags:
        t = f.strip()
        if t.startswith("□"):
            in_note = False
            main.append(t.lstrip("□ "))
        elif NOTE_RE.match(t):
            in_note = True
            notes.append(t.lstrip("※＊* "))
        elif in_note and notes:
            notes[-1] = notes[-1] + " " + t
        else:
            main.append(t)
    return main, notes


def _rank_row(rank: int, label: str | None, frags: list[str]) -> dict[str, Any]:
    req_parts, note_parts = _split_notes(frags)
    requirement = _clean(" ".join(req_parts))
    note = _clean(" ".join(note_parts)) or None
    key = requirement.replace(" ", "")
    m = re.search(r"(\d+)%이하", key)
    asset = re.search(r"총자산([\d,]+)만원이하", key)
    car = re.search(r"자동차([\d,]+)만원이하", key)
    scope = "본인과 부모" if "본인과부모" in key else ("본인" if "본인의" in key or "본인이" in key else None)
    return {
        "area": None,
        "rank": rank,
        "label": label,
        "income_pct": _fix_pct(int(m.group(1))) if m else None,
        "dual_income_pct": None,
        "requirement": requirement or None,
        "note": note,
        "asset_man": int(asset.group(1).replace(",", "")) if asset else None,
        "car_man": int(car.group(1).replace(",", "")) if car else None,
        "income_scope": scope,
    }


# ── 선정 순서 ───────────────────────────────────────────────


def parse_selection(lines: list[Line], start: int) -> tuple[dict[str, Any] | None, set[int]]:
    """순위 표 다음의 「[서류심사대상자선정] …→…」 「[당첨자선정] …→…」와 그 위 글머리들."""
    rows: list[dict[str, Any]] = []
    notes: list[str] = []
    pages: set[int] = set()
    i = start
    cur: list[str] | None = None
    cur_group: str | None = None
    while i < len(lines) and i < start + 60:
        ln = lines[i]
        f = ln.first()
        m = SELECTION_RE.match(_squash(f) if f.startswith("[") else "")
        if m:
            if cur is not None:
                rows.append({"group": cur_group, "area": None, "steps": _arrow_steps(" ".join(cur))})
            cur_group, cur = _clean(m.group(1)), [ln.text()[ln.text().index("]") + 1:]]
            pages.add(ln.page)
        elif cur is not None and _first_l(ln) > 150 and not f.startswith("["):
            cur.append(ln.text())                       # 2024년 「(동점자모두서류대상자선발)」 이어지는 줄
        elif cur is not None:
            break
        elif re.match(r"^[•]", f) and _first_l(ln) < 70:
            notes.append(ln.text().lstrip("• "))
        elif notes and _first_l(ln) >= 70 and not re.match(r"^[•□■\[]", f):
            notes[-1] = notes[-1] + " " + ln.text()   # 글머리 이어지는 줄
        elif re.match(r"^[□■]", f) and _first_l(ln) < 70 and rows:
            break
        i += 1
    if cur is not None:
        rows.append({"group": cur_group, "area": None, "steps": _arrow_steps(" ".join(cur))})
    if not rows:
        return None, set()
    tie = next((_clean(n) for n in notes if "무작위" in n.replace(" ", "")), None)
    return {"title": "입주자 선정 순서", "rows": rows, "tie_break": tie, "notes": [_clean(n) for n in notes]}, pages


def _arrow_steps(text: str) -> list[str]:
    parts = [p.strip(" *") for p in re.split(r"→", text)]
    return [_clean(p) for p in parts if _meaningful(p)]


# ── 가점사항 배점표 ─────────────────────────────────────────


def parse_score_table(lines: list[Line]) -> tuple[dict[str, Any] | None, set[int], list[str]]:
    start = _find_header(lines, SCORE_HEADER)
    if start is None:
        return None, set(), []
    body: list[Line] = []
    for ln in lines[start + 1:start + 80]:
        if _is_body_note_or_heading(ln):
            break
        body.append(ln)
    body = [Line(ln.page, ln.y, _segs(ln, [ITEM_MAX_L, CONTENT_MAX_L])) for ln in body]
    anchors = [ln.y for ln in body for s in ln.segs if ITEM_MIN_L <= s.l < ITEM_MAX_L and ITEM_RE.match(s.text)]
    if not anchors:
        return None, set(), []
    # 행 경계: 이웃 항목 사이 가장 넓은 틈. 적용대상 열(병합 「공통」)만 있는 줄은 뺀다
    ys = [ln.y for ln in body if any(s.l >= ITEM_MIN_L for s in ln.segs)]
    cuts = _cut_rows(anchors, ys)
    n = len(anchors)
    items: list[dict[str, Any]] = [{"label": [], "content": [], "points": [], "target": None} for _ in range(n)]
    tops = [body[0].y - 10, *cuts]
    bots = [*cuts, body[-1].y + 10]
    targets: list[tuple[float, str]] = []
    for ln in body:
        ri = _row_index(ln.y, cuts)
        for s in ln.segs:
            if s.l < TARGET_MAX_L:
                targets.append((ln.y, s.text))
            elif s.l < ITEM_MAX_L:
                items[ri]["label"].append((ln.y, s.text))
            elif s.l < CONTENT_MAX_L:
                items[ri]["content"].append((ln.y, s.text))
            elif re.fullmatch(r"\d+", s.text.strip()):
                items[ri]["points"].append((ln.y, int(s.text)))
    # 적용대상: 라벨이 제 행 중심에서 벗어난 만큼 반대쪽으로 펼친 범위에 중심이 드는 항목 전부
    centers = [(t + b) / 2 for t, b in zip(tops, bots)]
    for y, text in targets:
        ri = _row_index(y, cuts)
        t, b, c = tops[ri], bots[ri], centers[ri]
        if abs(y - c) <= ROW_CENTER_TOL:
            lo, hi = t, b
        elif y > c:
            lo, hi = t, 2 * y - t
        else:
            lo, hi = 2 * y - b, b
        for k in range(n):
            if lo <= centers[k] <= hi:
                items[k]["target"] = _clean(text)
    all_points = sorted({p for it in items for _, p in it["points"]}, reverse=True)
    out_items: list[dict[str, Any]] = []
    for it in items:
        label_main, label_note = _split_notes([t for _, t in sorted(it["label"])])
        content = sorted(it["content"])
        pts = sorted(it["points"])
        cells: dict[int, list[str]] = {}
        cell_notes: list[str] = []
        if len(pts) >= 2:
            pys = [y for y, _ in pts]
            for y, t in content:
                cells.setdefault(pts[_nearest(y, pys)][1], []).append(t)
        elif pts:
            main, cell_notes = _split_notes([t for _, t in content])   # 칸 안의 ※(인정범위 등)는 항목 주석으로
            cells[pts[0][1]] = main
        out_items.append({
            "label": _clean(" ".join(label_main)),
            "target": it["target"],
            "cells": [_clean(" ".join(cells.get(p, []))) for p in all_points],
            "note": _clean(" ".join(label_note + cell_notes)) or None,
        })
    foot: list[str] = []
    for ln in lines[start + 1 + len(body):start + 1 + len(body) + 12]:
        f = ln.first()
        if NOTE_RE.match(f) and _first_l(ln) < BODY_MIN_L + 8:
            foot.append(ln.text().lstrip("※＊* "))
        elif foot and _first_l(ln) >= BODY_MIN_L + 8 and not re.match(r"^[■•□]", f):
            foot[-1] = foot[-1] + " " + ln.text()
        else:
            break
    table = {"group": "가점사항", "points": all_points, "items": out_items}
    return table, {ln.page for ln in body}, [_clean(n) for n in foot]


# ── 소득 미니표 ─────────────────────────────────────────────


def parse_income_table(lines: list[Line]) -> tuple[dict[str, Any] | None, set[int]]:
    head = None
    for i, ln in enumerate(lines):
        hh = [s for s in ln.segs if HOUSEHOLD_RE.match(_squash(s.text))]
        if len(hh) >= 3:
            head = i
            break
    if head is None:
        return None, set()
    hdr = lines[head]
    households = sorted((int(HOUSEHOLD_RE.match(_squash(s.text)).group(1)), s.cx) for s in hdr.segs if HOUSEHOLD_RE.match(_squash(s.text)))
    col_xs = [x for _, x in households]
    bump = {"1": 20, "2": 10} if "+20%p" in _squash(hdr.text()) else {}
    rows: list[dict[str, Any]] = []
    end = head + 1
    for ln in lines[head + 1:head + 8]:
        pct = next((int(PCT_ROW_RE.match(_squash(s.text)).group(1)) for s in ln.segs if s.l < 320 and PCT_ROW_RE.match(_squash(s.text))), None)
        digits = [s for s in ln.segs if s.l >= col_xs[0] - 40 and re.fullmatch(r"[\d,]+", s.text.replace(" ", ""))]
        if pct is None or not digits:
            break
        won: list[int | None] = [None] * len(households)
        for s in digits:
            won[_nearest(s.cx, col_xs)] = int(s.text.replace(",", "").replace(" ", ""))
        rows.append({"pct": _fix_pct(pct), "won": won, "conditions": []})
        end += 1
    if not rows:
        return None, set()
    # 표 위 「□아래 월평균소득기준은 …」과 표 아래 「□1순위 …」「□2순위 …」「□3순위 …」 — 화면이 순위별 가구원 산정을 설명할 때 쓴다
    notes: list[str] = []
    for ln in lines[end:end + 8]:
        f = ln.first()
        if f.startswith("□") and re.match(r"^□\s*[123]\s*순위", f):
            notes.append(ln.text().lstrip("□ "))
        elif notes and _first_l(ln) >= 70 and not f.startswith("□"):
            notes[-1] = notes[-1] + " " + ln.text()
        elif f.startswith("□"):
            break
    return {
        "households": [h for h, _ in households],
        "rows": rows,
        "bump": bump,
        "per_person_won": {},
        "notes": [_clean(n) for n in notes],
        "keep_blank": False,
    }, {hdr.page}


# ── 묶기 ────────────────────────────────────────────────────


def parse_cheongnyeon(pages: list[tuple[int, str]]) -> dict[str, Any] | None:
    lines = _lines(pages)
    rank_rows, p_rank = parse_rank_table(lines)
    if not rank_rows:
        return None
    types, p_type = parse_applicant_types(lines)
    rank_start = _find_header(lines, RANK_HEADER) or 0
    selection, p_sel = parse_selection(lines, rank_start + 1)
    score, p_score, score_notes = parse_score_table(lines)
    income, p_inc = parse_income_table(lines)
    # 자산·자동차: 순위 표 상세요건에서 (2·3순위)
    asset_cols = [f"{r['rank']}순위" for r in rank_rows if r["asset_man"] is not None]
    asset = None
    if asset_cols:
        asset = {
            "columns": asset_cols,
            "rows": [
                {"label": "총자산", "values_man": [r["asset_man"] for r in rank_rows if r["asset_man"] is not None]},
                {"label": "자동차", "values_man": [r["car_man"] for r in rank_rows if r["asset_man"] is not None]},
            ],
        }
    return {
        "kind": "cheongnyeon",
        "source_pages": sorted(p_rank | p_type | p_sel | p_score | p_inc),
        "rank_tables": [{"group": "신청자격", "classes": [], "rows": rank_rows}],
        "bonus_conditions": [],
        "bonus_notes": [],
        "income_matrix": None,
        "asset": asset,
        "income_table": income,
        "selection": [selection] if selection else [],
        "score_tables": [score] if score else [],
        "penalties": None,
        "class_blocks": [],
        "applicant_types": types,
        "notes": score_notes,
    }
