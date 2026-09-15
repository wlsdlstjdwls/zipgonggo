"""괘선 없는 임대조건 표 — 글자 좌표로 칸을 되살린다(2019~2022 역세권청년주택 최초모집공고).

`youth_attach`는 pdfplumber `find_tables()`가 잡은 칸을 읽는다. 그런데 2019~2022 SH 양식은 표에 세로 괘선이 없어
한 칸에 「보증금 보증금 보증금⏎세⏎30%」처럼 여러 열이 뭉개져 들어온다. 실측 캐시 452건 중 10여 건이 그렇고,
전부 단지의 **최초모집공고**라 공급현황이 가장 알찬 쪽이다.

여기서는 낱말의 x·y 좌표로 열을 다시 세워 `RawTable`(= find_tables가 준 것과 같은 모양)을 만든다.
만들고 나면 뒤 단계(`_lines_from_table`)는 괘선이 있던 표와 똑같이 읽는다 — 역할·단위·계층 판정을 두 번 쓰지 않는다.

조판의 생김새(구산주택 2021 5쪽):

      구분              특별공급                      일반공급
      공 세 총   보증금   보증금   보증금      보증금   보증금   보증금
      급 대 세    30%     35%     40%        30%     35%     40%
      유 타 대  임대  월임 임대 월임 임대 월임  임대  월임 …
      형 입 수  보증금 대료 보증금 대료 …
      17A  115  31  3,600  35  4,200  32  …   84  4,000  42  …
      청년
      17B   28   -    -     -    -     -   …   28  4,000  42  …

- 칸이 가운데 맞춤이라 열은 낱말의 **가운데**로 모은다. 왼쪽 끝(x0)으로 모으면 「35」와 「4,200」이 다른 열로 갈린다.
- 머리는 세로로 쪼개져 여러 줄에 걸린다(「공급유형」이 「공」「급」「유」「형」). 열마다 조각을 이어 붙여 한 줄로 만든다.
- 「특별공급」·「보증금 30%」 같은 묶음 머리는 칸 가운데에 한 번만 적힌다. 가로로 병합된 칸이라 **가장 가까운 묶음 머리**를
  열마다 나눠 준다(왼쪽부터 물려주는 `_columns`의 규칙으로는 머리보다 왼쪽에 있는 열이 비어 버린다).
- 한 줄에 특별공급과 일반공급이 나란히 있는 표는 **표 둘로 쪼갠다**. 뒤 단계는 줄 하나에 공급구분 하나를 매기므로
  쪼개지 않으면 30%가 두 번 쌓여 특별공급 금액이 일반공급 줄에 섞인다.
- 계층(「청년」·「신혼부부」)은 줄 사이에 끼어 있고 여러 줄을 덮는다. 가장 가까운 숫자 줄에 붙이고(같으면 위),
  나머지는 `_lines_from_table`의 세로 병합 규칙이 물려받는다.
"""

from __future__ import annotations

import logging
import re
from typing import Any

log = logging.getLogger(__name__)

LINE_TOL = 3.5        # 같은 줄로 볼 y 차이(pt)
COL_TOL = 11.0        # 같은 열로 볼 가운데 x 차이
OWN_TOL = 16.0        # 열 자기 머리로 인정할 최대 거리(pt)
GROUP_MAX = 170.0     # 묶음 머리가 덮을 수 있는 최대 거리(pt). 더 멀면 남의 묶음이다
HEAD_UP = 5           # 비율 줄 위로 몇 줄까지 머리로 볼지(「구분 | 특별공급 | 일반공급」)
CONTEXT_PT = 130.0    # 표 위에서 제목·단위를 찾는 띠 높이
MIN_BODY_NUMS = 3     # 이만큼 숫자가 있는 줄부터 본문으로 본다
MIN_COLS = 4          # 열이 이보다 적으면 임대조건 표가 아니다
STACK_GAP = 15.0      # 세로로 이어진 글자 조각으로 볼 y 간격(pt)
LABEL_GAP = 12.0      # 머리 줄에서 낱말이 이만큼 안에 붙어 있으면 한 머리로 본다

_NUM = re.compile(r"^[\d,]+(?:\.\d+)?$")
_PCT = re.compile(r"\d{1,3}\s*%")
_KIND = re.compile(r"(특별|일반)\s*공급")
_PROSE = re.compile(r"^[※*■◯○]|입니다|하시기|바랍니다|가능합니다")
_MONEY_LABEL = re.compile(r"보증금|임대료|계약금|잔금|^계$")
_COUNT_LABEL = re.compile(r"세대수|호수")
# 두 줄에 걸쳐 쓴 계층 — 아랫줄 조각이 윗줄과 붙어야 말이 되면 위로 올린다(「신혼」/「부부」)
_CLASS_WORD = re.compile(r"청년|신혼부부|대학생|고령자|1인가구")


def _text(words: list[dict[str, Any]]) -> str:
    return " ".join(w["text"] for w in words)


def _mid(w: dict[str, Any]) -> float:
    return (w["x0"] + w["x1"]) / 2


def _group_lines(words: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """낱말을 y로 묶어 줄로 만든다. 줄 안은 x 순서."""
    out: list[list[dict[str, Any]]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if out and abs(w["top"] - out[-1][0]["top"]) <= LINE_TOL:
            out[-1].append(w)
        else:
            out.append([w])
    return [sorted(ln, key=lambda w: w["x0"]) for ln in out]


def _num_count(line: list[dict[str, Any]]) -> int:
    return sum(1 for w in line if _NUM.match(w["text"]))


def _anchors(lines: list[list[dict[str, Any]]]) -> list[float]:
    """본문 줄 낱말의 가운데를 모아 열 자리를 잡는다."""
    xs = sorted(_mid(w) for ln in lines for w in ln)
    cols: list[list[float]] = []
    for x in xs:
        if cols and x - cols[-1][-1] <= COL_TOL:
            cols[-1].append(x)
        else:
            cols.append([x])
    return [sum(c) / len(c) for c in cols]


def _nearest(anchors: list[float], x: float) -> int:
    return min(range(len(anchors)), key=lambda j: abs(anchors[j] - x))


def _labels(line: list[dict[str, Any]], *, skip_kind: bool) -> list[tuple[float, str]]:
    """머리 줄을 낱말 사이 간격으로 끊어 묶음 머리 하나씩으로 만든다.

    「임대보증금 40% 기준」은 낱말 셋이지만 머리 하나다 — 낱말 단위로 열에 나눠 주면 「40%」가 옆 열(계약금)에 붙어
    정작 보증금 열에는 비율이 안 남는다.
    """
    out: list[list[dict[str, Any]]] = []
    for w in line:
        if skip_kind and _KIND.fullmatch(w["text"].replace(" ", "")):
            continue
        if out and w["x0"] - out[-1][-1]["x1"] <= LABEL_GAP:
            out[-1].append(w)
        else:
            out.append([w])
    return [((g[0]["x0"] + g[-1]["x1"]) / 2, "".join(w["text"] for w in g)) for g in out]


def _spread_row(line: list[dict[str, Any]], anchors: list[float], *, skip_kind: bool) -> list[str]:
    """묶음 머리 줄 — 열마다 가장 가까운 머리를 나눠 준다(가로 병합 칸을 되살린다)."""
    out = [""] * len(anchors)
    cand = _labels(line, skip_kind=skip_kind)
    if not cand:
        return out
    for j, a in enumerate(anchors):
        c, text = min(cand, key=lambda ct: abs(ct[0] - a))
        if abs(c - a) <= GROUP_MAX:
            out[j] = text
    return out


def _own_row(lines: list[list[dict[str, Any]]], anchors: list[float]) -> list[str]:
    """열 자기 머리 — 세로로 쪼개진 조각을 열마다 이어 붙인다(「월임」+「대료」 → 「월임대료」).

    「공급유형」처럼 세로로 쓴 머리는 비율 줄 위아래에 걸쳐 있다 — 머리 줄을 전부 훑되 묶음 낱말(특별공급)은 뺀다.
    """
    buckets: list[list[tuple[float, str]]] = [[] for _ in anchors]
    for ln in lines:
        for w in ln:
            if _KIND.fullmatch(w["text"].replace(" ", "")):
                continue
            j = _nearest(anchors, _mid(w))
            if abs(anchors[j] - _mid(w)) <= OWN_TOL:
                buckets[j].append((w["top"], w["text"]))
    return ["".join(t for _, t in sorted(b)) for b in buckets]


def _body_rows(lines: list[list[dict[str, Any]]], anchors: list[float]) -> list[list[str]]:
    """숫자가 있는 줄이 한 행. 숫자 없는 조각 줄(계층 이름)은 가장 가까운 행에 붙인다(같으면 위)."""
    numeric = [ln for ln in lines if _num_count(ln) >= 1]
    if not numeric:
        return []
    owned: dict[int, list[dict[str, Any]]] = {i: list(ln) for i, ln in enumerate(numeric)}
    # 「신혼」「부부」처럼 세로로 이어진 조각은 한 덩이다 — 덩이의 첫 줄에 붙여야 두 행을 다 덮는다(나머지는 세로 병합이 물려받는다)
    stacks: list[list[dict[str, Any]]] = []
    for ln in lines:
        if _num_count(ln) >= 1:
            continue
        for w in ln:
            prev = next((st for st in stacks
                         if abs(_mid(st[-1]) - _mid(w)) <= COL_TOL and 0 < w["top"] - st[-1]["top"] <= STACK_GAP), None)
            (prev if prev is not None else stacks.append([]) or stacks[-1]).append(w)
    for st in stacks:
        y = st[0]["top"]
        best = min(range(len(numeric)), key=lambda i: (abs(numeric[i][0]["top"] - y), numeric[i][0]["top"] > y))
        owned[best].extend(st)
    rows: list[list[str]] = []
    for i in range(len(numeric)):
        cells = [""] * len(anchors)
        for w in sorted(owned[i], key=lambda w: (w["top"], w["x0"])):
            j = _nearest(anchors, _mid(w))
            cells[j] = (cells[j] + w["text"]) if cells[j] else w["text"]
        rows.append(cells)
    for a in range(len(rows) - 1):
        for c in range(len(anchors)):
            top, bot = rows[a][c], rows[a + 1][c]
            if top and bot and _CLASS_WORD.fullmatch(top + bot):
                rows[a][c], rows[a + 1][c] = top + bot, ""   # 아래 행은 비워 둔다 — 세로 병합 규칙이 물려받는다
    return rows


def _block_end(lines: list[list[dict[str, Any]]], start: int) -> int:
    """본문이 끝나는 줄. 숫자가 없고 글이 길면(설명 문단) 거기서 끊는다."""
    i = start
    while i < len(lines):
        ln = lines[i]
        if _PROSE.match(_text(ln).lstrip()):
            break
        if _num_count(ln) == 0 and len(ln) > 3:
            break
        if _num_count(ln) == 0 and i > start and i + 1 < len(lines) and _num_count(lines[i + 1]) == 0:
            break
        i += 1
    return i


def _kind_groups(kind_words: list[dict[str, Any]], anchors: list[float], own: list[str]) -> list[tuple[str, list[int]]]:
    """특별공급·일반공급 묶음마다 어느 열이 딸리는지 가른다. 앞쪽 공통 열(유형·타입·총세대수)은 양쪽이 같이 쓴다."""
    money = [j for j, lb in enumerate(own) if _MONEY_LABEL.search(lb)]
    if len(kind_words) < 2 or not money:
        return []
    kinds = sorted(({_KIND.search(w["text"].replace(" ", "")).group(0): _mid(w) for w in kind_words}).items(),
                   key=lambda kv: kv[1])
    if len(kinds) < 2:
        return []
    taken: dict[int, int] = {}
    for j in money:
        taken[j] = min(range(len(kinds)), key=lambda k: abs(kinds[k][1] - anchors[j]))
    # 호수 열은 제 묶음의 금액 열 바로 왼쪽에 붙는다(「특별공급 | 세대수 | 보증금 30% …」).
    # 앞 묶음이 끝난 자리부터 이 묶음의 첫 금액 열 사이에 있는 호수 열 중 **마지막 것**이 이 묶음 몫이고,
    # 그보다 왼쪽(「총세대수」)은 양쪽이 같이 쓴다
    counts = [j for j, lb in enumerate(own) if _COUNT_LABEL.search(lb) and not _MONEY_LABEL.search(lb)]
    prev_end = -1
    for k in range(len(kinds)):
        cols = sorted(j for j, g in taken.items() if g == k)
        mine = [j for j in counts if prev_end < j < cols[0]]
        if mine:
            taken[mine[-1]] = k
        prev_end = cols[-1]
    shared = [j for j in range(len(anchors)) if j not in taken]
    return [(kinds[k][0], sorted(shared + [j for j, g in taken.items() if g == k])) for k in range(len(kinds))]


def _pick(row: list[str], cols: list[int]) -> list[str]:
    return [row[j] for j in cols]


def tables_from_words(page, page_no: int, half: str, table_cls) -> list[Any]:
    """한 쪽(2단 조판이면 한 쪽 반)에서 괘선 없는 임대조건 표를 찾아 RawTable로 만든다."""
    words = page.extract_words(x_tolerance=1.5, y_tolerance=2)
    if len(words) < 30:
        return []
    lines = _group_lines(words)
    out: list[Any] = []
    i = 0
    while i < len(lines):
        txt = _text(lines[i])
        # 「보증금」과 「30%」가 다른 줄에 있는 조판이 있다(세로로 쪼갠 머리) — 가까운 줄까지 같이 본다
        near = " ".join(_text(lines[j]) for j in range(max(0, i - 3), min(len(lines), i + 3)))
        if len(_PCT.findall(txt)) < 2 or "보증금" not in near:
            i += 1
            continue
        pct = i
        body = next((j for j in range(pct + 1, min(pct + 8, len(lines))) if _num_count(lines[j]) >= MIN_BODY_NUMS), None)
        if body is None:
            i = pct + 1
            continue
        end = _block_end(lines, body)
        head_top = pct
        while head_top > 0 and pct - head_top < HEAD_UP:
            prev = lines[head_top - 1]
            if _PROSE.match(_text(prev).lstrip()) or "단위" in _text(prev) or _num_count(prev) >= MIN_BODY_NUMS:
                break
            head_top -= 1
        anchors = _anchors(lines[body:end])
        if len(anchors) < MIN_COLS:
            i = end
            continue
        head_lines = lines[head_top:pct + 1]
        kind_words = [w for ln in head_lines for w in ln if _KIND.fullmatch(w["text"].replace(" ", ""))]
        own = _own_row(lines[head_top:body], anchors)
        # 묶음 머리 줄들(보증금·비율)을 한 줄로 합친다 — 머리 줄이 다섯을 넘으면 뒤 단계가 본문으로 읽는다
        ratio = ["".join(parts) for parts in zip(*[_spread_row(ln, anchors, skip_kind=True) for ln in head_lines])]
        body_rows = _body_rows(lines[body:end], anchors)
        top = lines[body][0]["top"]
        ctx = "\n".join(_text(ln) for ln in lines[:head_top] if ln[0]["top"] >= top - CONTEXT_PT)
        groups = _kind_groups(kind_words, anchors, own)
        if groups:
            for kind, cols in groups:
                rows = [[kind if j in cols and _MONEY_LABEL.search(own[j]) else "" for j in cols],
                        _pick(ratio, cols), _pick(own, cols), *[_pick(r, cols) for r in body_rows]]
                out.append(table_cls(page=page_no, half=half, context=ctx, rows=rows))
        else:
            out.append(table_cls(page=page_no, half=half, context=ctx, rows=[ratio, own, *body_rows]))
        i = end
    return out
