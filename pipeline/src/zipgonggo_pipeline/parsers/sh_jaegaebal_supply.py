"""SH 재개발임대주택 공고문 「공급대상 현황 및 금액」 표 파서 — 단지 × 신청유형 한 줄씩.

정답지: 2026년 재개발임대주택 일반모집 공고(i-sh seq=310041) 10~15쪽, 162단지.
표 형식: 자치구(방문청약일) | 연번 | 단지명 | 신청유형(㎡) | 모집세대수 합계(A+B)·공가입주자(A)·예비입주자(B)
        | 임대보증금(천원) 합계·계약금(20%)·잔금(80%) | 월임대료(원)
        | 세대별 계약면적(㎡) 주거전용·주거공용·기타공용·합계

칸 사이가 좁아 숫자가 붙어 온다("10,520164,600"처럼 잔금과 월임대료가 한 덩이) — 단어 단위(gap) 분할이 아니라
글자 하나하나의 x 중심을 헤더 열 경계와 비교하는 `columns_by_x`를 쓴다. 헤더 라벨 자체로 안 붙는 문제라
행 단위로 다시 합쳐도 못 가른다.

단지명은 길면 두세 줄로 감긴다("래미안트리베라2차" / [데이터 줄] / "(래미안트리베라12)") — 이름 조각을
`_name_blocks`(sh_supply_lines, 단지별 주소 표의 이름 순서와 대조)로 이어 붙인다. 장기전세 파서와 같은 기법.
"""

from __future__ import annotations

import re

from ..sources.ish import Char, columns_by_x, group_rows, parse_chars, row_segments
from .sh_supply_lines import FOOTNOTE_CHARS, PUNCT_ONLY, SupplyLine, _int, _name_blocks, _norm, _Seg

HEADER_UNITS = "모집세대수"
HEADER_MONEY = "임대보증금(천원)"
HEADER_AREA = "세대별계약면적(㎡)"
NAME_SLACK = 20.0   # 신청유형 칸 왼쪽 여유. 단지명이 길면 이만큼 앞까지 밀고 들어온다


def _flat(text: str) -> str:
    return text.replace(" ", "")


def _header(rows: list[list[_Seg]]) -> tuple[int, dict[str, float]] | None:
    """헤더 줄 묶음(7줄에 걸쳐 흩어짐) → 열 이름 → x 중심. 못 찾으면 None."""
    for i, segs in enumerate(rows):
        texts = {_flat(s.text) for s in segs}
        if not ({"연번"} <= texts and "단지명" in texts):
            continue
        block = [s for r in rows[max(0, i - 2): i + 12] for s in r]
        if not any(_flat(s.text) == HEADER_UNITS for s in block):
            continue  # 다른 표의 「연번」·「단지명」(예: 단지별 주소 표)일 수 있다
        a: dict[str, float] = {}
        anchors: dict[str, list[_Seg]] = {}
        for s in block:
            anchors.setdefault(_flat(s.text), []).append(s)

        def first(label: str) -> _Seg | None:
            xs = anchors.get(label)
            return xs[0] if xs else None

        yeonbeon, danji = first("연번"), first("단지명")
        yuhyeong, hapgye_a = first("유형"), first("공가")
        yebi, gyeyakgeum = first("예비"), first("계약금")
        janggeum, imdaeryo = first("잔금"), first("임대료")
        jeonyong = first("전용")
        gongyong = sorted(anchors.get("공용", []), key=lambda s: s.cx)
        if not all([yeonbeon, danji, yuhyeong, hapgye_a, yebi, gyeyakgeum, janggeum, imdaeryo, jeonyong]) or len(gongyong) < 2:
            continue
        a["yeonbeon"] = yeonbeon.cx
        a["type"] = yuhyeong.cx
        a["vacant"] = hapgye_a.cx
        a["reserve"] = yebi.cx
        a["down"] = gyeyakgeum.cx
        a["balance"] = janggeum.cx
        a["rent"] = imdaeryo.cx
        a["a_ex"] = jeonyong.cx
        a["a_com"] = gongyong[0].cx
        a["a_etc"] = gongyong[1].cx
        # 「합계」가 세 군데(모집세대수·임대보증금·계약면적) — 이웃 열 사이 위치로 가른다
        totals = sorted((s for s in anchors.get("합계", []) if s.cx > a["yeonbeon"]), key=lambda s: s.cx)
        for s in totals:
            if a["type"] < s.cx < a["vacant"]:
                a["units_total"] = s.cx
            elif a["reserve"] < s.cx < a["down"]:
                a["deposit"] = s.cx
            elif s.cx > a["a_etc"]:
                a["a_tot"] = s.cx
        if not {"units_total", "deposit", "a_tot"} <= a.keys():
            continue
        return i, a
    return None


def _bounds(a: dict[str, float]) -> tuple[list[float], list[str], float]:
    cols = sorted(((k, v) for k, v in a.items() if k not in ("yeonbeon", "danji")), key=lambda kv: kv[1])
    xs = [v for _, v in cols]
    split = xs[0] - NAME_SLACK
    return [(xs[i] + xs[i + 1]) / 2 for i in range(len(xs) - 1)], [k for k, _ in cols], split


def parse_jaegaebal_page(xml: str, page: int, names_hint: list[str], start: int = 0) -> tuple[list[SupplyLine], int]:
    chars = parse_chars(xml)
    rows = group_rows(chars)
    segs = [[_Seg(s.l, s.r, r[0].t, s.text) for s in row_segments(r)] for r in rows]
    hit = _header(segs)
    if hit is None:
        return [], start
    hidx, a = hit
    bounds, colnames, split = _bounds(a)
    name_cut = a["yeonbeon"] + 8   # 연번 칸 오른쪽부터 단지명

    name_frags: list[tuple[float, str]] = []
    body: list[tuple[float, dict[str, str]]] = []
    for r in rows[hidx + 1:]:
        # 왼쪽(연번보다 왼쪽) 글자가 FOOTNOTE_CHARS자 넘게 있으면 표가 끝난 것(자치구 세로 글자는 그보다 적다)
        if sum(1 for c in r if c.l + c.w / 2 < a["yeonbeon"] - 30 and c.ch.strip()) >= FOOTNOTE_CHARS:
            break
        left: list[Char] = [c for c in r if name_cut <= c.l + c.w / 2 < split]
        name = " ".join(s.text for s in row_segments(left)).strip()
        vals = columns_by_x([c for c in r if c.l + c.w / 2 >= split], bounds)
        cells = {k: ("" if PUNCT_ONLY.match(v) else v.strip()) for k, v in zip(colnames, vals)}
        y = r[0].t
        if name and not re.match(r"^\d", name):
            name_frags.append((y, name))
        if any(cells.values()):
            body.append((y, cells))

    blocks, nxt = _name_blocks(name_frags, names_hint, start)
    if not blocks:
        return [], nxt

    out: list[SupplyLine] = []
    cur = 0
    for y, c in body:
        vacant, reserve = _int(c.get("vacant", "")), _int(c.get("reserve", ""))
        units_total = _int(c.get("units_total", ""))
        if units_total is None and vacant is None and reserve is None:
            continue  # 유형 칸만 있고 나머지가 빈 줄(단지명이 이어진 이름 전용 줄)
        best = min(range(len(blocks)), key=lambda i: abs(blocks[i][0] - y))
        cur = max(cur, best)
        out.append(SupplyLine(
            complex_name=blocks[cur][1],
            supply_type=re.sub(r"\D", "", c.get("type", "")) or c.get("type", ""),
            tenant_class="일반공급",
            income_option=None,
            is_new=False,
            units_total=units_total,
            units_priority=None,
            units_general=vacant,
            units_reserve=reserve,
            deposit=_thousand(_int(c.get("deposit", ""))),
            down_payment=_thousand(_int(c.get("down", ""))),
            balance=_thousand(_int(c.get("balance", ""))),
            rent=_int(c.get("rent", "")),
            area_exclusive=_area(c.get("a_ex", "")),
            area_common=_area(c.get("a_com", "")),
            area_etc=_area(c.get("a_etc", "")),
            area_total=_area(c.get("a_tot", "")),
            move_in_from=None,
            page=page,
        ))
    return out, nxt


def _thousand(v: int | None) -> int | None:
    return None if v is None else v * 1000


def _area(text: str) -> float | None:
    """면적 칸 — 소수점이 글자로 남아 있으면 그대로, 빠졌으면(자릿수만 남으면) 100으로 나눈다."""
    t = text.strip()
    if "." in t:
        try:
            v = float(re.sub(r"[^\d.]", "", t))
        except ValueError:
            return None
        return v if 0 < v < 1000 else None
    digits = re.sub(r"\D", "", t)
    if not digits or len(digits) > 6:
        return None
    v = int(digits) / 100.0
    return v if 0 < v < 1000 else None


# 검문 — 틀린 값을 싣느니 비워 둔다(CLAUDE.md). 신청유형(전용면적을 버림한 값)과 전용면적이 맞아야 한다.
UNITS_MAX = 500
DEPOSIT_MIN, DEPOSIT_MAX = 500_000, 200_000_000
AREA_MIN, AREA_MAX = 10.0, 120.0
AREA_SLACK = 1.5


def _plausible(l: SupplyLine, names: set[str]) -> bool:
    if not l.complex_name or _norm(l.complex_name) not in names:
        return False
    if l.deposit is None or not (DEPOSIT_MIN <= l.deposit <= DEPOSIT_MAX):
        return False
    if l.units_total is not None and not (1 <= l.units_total <= UNITS_MAX):
        return False
    digits = re.sub(r"\D", "", l.supply_type or "")
    if not digits:
        return False
    n = int(digits)
    if not (AREA_MIN <= n <= AREA_MAX):
        return False
    return l.area_exclusive is not None and abs(l.area_exclusive - n) <= AREA_SLACK


def parse_jaegaebal_supply(pages: list[tuple[int, str]], names_hint: list[str]) -> list[SupplyLine]:
    names = {_norm(x) for x in names_hint}
    out: list[SupplyLine] = []
    idx = 0
    for page, xml in sorted(pages):
        try:
            lines, idx = parse_jaegaebal_page(xml, page, names_hint, idx)
        except Exception:  # noqa: BLE001 — 한 쪽이 깨져도 나머지는 살린다
            continue
        out.extend(l for l in lines if _plausible(l, names))
    return out
