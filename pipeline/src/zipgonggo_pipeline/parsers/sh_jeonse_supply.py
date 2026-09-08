"""SH 장기전세 공고문 「공급현황」 표 파서 — 단지 × 전용면적 한 줄씩.

정답지: 제51차 장기전세(i-sh seq=309467).
- 13쪽 [신규공급]: 단지 이름(위치) | 전용면적(㎡) | 공급호수 계·일반·우선 | 전세금액(천 원) 계·계약금(10%)·잔금(90%)
                  | 세대당 계약면적 주거전용·주거공용·기타공용·합계 | 난방방식 | 입주시작(예정)
- 14쪽 [우선공급 배정]: 단지명(위치) | 전용면적 | 계 | 고령자 | 장애인 | 노부모부양자 | 국가유공자 등 | 2자녀이상가구
- 15~19쪽 [재공급]: 자치구 | 단지명 | 전용면적 | 유형(일반·주거약자) | 모집호수(예비) | 전세금액 3열 | 계약면적 4열 | 난방방식

**재공급 표는 읽지 않는다.** 단지명 칸이 지구 단위로 묶여 있어("상암2지구" 아래 "-상암월드컵파크9~12단지")
한 줄이 어느 단지 것인지 정해지지 않는다. 틀린 호수를 단지에 붙이느니 비워 둔다 — 공고 단위 집계는 sh_supply가 낸다.
신규공급 표(13쪽)만 단지별로 낸다.

행복주택 양식(sh_supply_lines)과 다른 점 — 공급구분(계층) 열이 없고, 월임대료가 없다(전세). 대신 난방방식과 우선공급 배정 상세가 있다.
같은 좌표 기법을 쓴다: 헤더 라벨의 x로 열 경계를 잡고, 붙어 온 숫자는 글자 x 중심으로 가른다.
단지명 칸은 「이름 / (자치구 동)」 두 줄이라 첫 줄만 이름으로 본다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..sources.ish import Char, columns_by_x, group_rows, parse_chars, row_segments
from .sh_supply_lines import FOOTNOTE_CHARS, NAME_GAP, PUNCT_ONLY, _area, _int, _name_blocks, _nearest, _Seg

HEADER_NAME = re.compile(r"^단지\s*(?:이름|명)$")
HEADER_AREA_COL = re.compile(r"^전용\s*면적$|^전용$")
HEADER_UNITS = re.compile(r"^공급\s*호수$|^모집\s*호수$|^호수$")
HEADER_GU = re.compile(r"^자치구$")
HEADER_MONEY = re.compile(r"^전세\s*금액\s*\(\s*천\s*원?\s*\)$")
HEADER_CONTRACT = re.compile(r"세대\s*당?\s*계약\s*면적")
HEADER_HEATING = re.compile(r"^난방$|^난방\s*방식$")
HEADER_KIND = re.compile(r"^유형$")

LOC_RE = re.compile(r"^\(.*\)$")        # 단지명 아래 「(강남구 도곡동)」 줄
TYPE_RE = re.compile(r"^\d{1,3}[A-Za-z]?$")
HEATING_RE = re.compile(r"(개별|지역|중앙)")
MOVEIN_DIGITS = re.compile(r"\d{3,4}")
THOUSAND = 1000
NAME_SLACK = 15.0   # 전용면적 칸 왼쪽 여유. 단지명이 이만큼 앞까지 밀고 들어온다


@dataclass(frozen=True)
class JeonseLine:
    complex_name: str
    area_type: str              # 전용면적 표기 "45" · "59"
    kind: str | None            # 재공급 표의 유형(일반·주거약자). 신규공급 표에는 없다
    is_new: bool
    units_total: int | None
    units_general: int | None   # 신규공급 표의 일반공급분
    units_priority: int | None  # 신규공급 표의 우선공급분
    deposit: int | None         # 전세금액 계(원)
    down_payment: int | None    # 계약금 10%(원)
    balance: int | None         # 잔금 90%(원)
    area_exclusive: float | None
    area_common: float | None
    area_etc: float | None
    area_total: float | None
    heating: str | None
    move_in_from: str | None
    page: int


def _header(rows: list[list[_Seg]]) -> tuple[int, dict[str, float], bool] | None:
    """헤더 줄 묶음 → (헤더 줄 번호, 열 이름 → x 중심, 신규 여부). 못 찾으면 None."""
    for i, segs in enumerate(rows):
        if not any(HEADER_NAME.match(s.text.replace(" ", "")) for s in segs):
            continue
        block = [s for r in rows[max(0, i - 6): i + 7] for s in r]
        a: dict[str, float] = {}
        units: _Seg | None = None
        gu: _Seg | None = None
        money: _Seg | None = None
        contract: _Seg | None = None
        for s in block:
            t = s.text.replace(" ", "")
            if HEADER_NAME.match(t):
                a.setdefault("name", s.cx)
            elif HEADER_UNITS.match(t):
                units = s
            elif HEADER_MONEY.match(t):
                money = s
            elif HEADER_CONTRACT.search(t):
                contract = s
            elif HEADER_HEATING.match(t):
                a.setdefault("heating", s.cx)
            elif HEADER_KIND.match(t):
                a.setdefault("kind", s.cx)
            elif HEADER_GU.match(t):
                gu = s
        if "name" not in a or units is None or money is None or contract is None:
            continue
        # 전용면적 열 — 「전용면적」이 계약면적 묶음 안에도 있어 호수 열보다 왼쪽 것만 쓴다
        for s in block:
            if HEADER_AREA_COL.match(s.text.replace(" ", "")) and a["name"] < s.cx < units.l:
                a.setdefault("area_type", s.cx)
        if "area_type" not in a:
            continue
        # 호수 열: 계 | 일반·우선(신규) / 계 하나(재공급)
        is_new = False
        for s in block:
            t = s.text.replace(" ", "")
            if not (units.l - 25 <= s.cx <= units.r + 25):
                continue
            if t == "계":
                a.setdefault("total", s.cx)
            elif t == "일반우선":   # 한 칸에 두 열
                a.setdefault("general", s.l + (s.r - s.l) / 4)
                a.setdefault("priority", s.r - (s.r - s.l) / 4)
                is_new = True
            elif t == "일반":
                a.setdefault("general", s.cx)
                is_new = True
            elif t == "우선":
                a.setdefault("priority", s.cx)
                is_new = True
        if "total" not in a:
            a["total"] = units.cx   # 「모집호수(예비)」처럼 아래에 낱개 라벨이 없는 표
        # 금액 3열: 계 | 계약금 | 잔금
        for s in block:
            t = s.text.replace(" ", "")
            if money.l - 40 <= s.cx <= money.r + 60:
                if t.startswith("계약금"):
                    a.setdefault("down", s.cx)
                elif t.startswith("잔금"):
                    a.setdefault("balance", s.cx)
                elif t == "계" and "total" in a and s.cx > a["total"] + 20:
                    a.setdefault("deposit", s.cx)
        if not {"down", "balance", "deposit"} <= a.keys():
            continue
        # 계약면적 4열
        sub = sorted([s for s in block if s.text.replace(" ", "") in ("전용", "공용", "합계") and contract.l - 30 <= s.cx <= contract.r + 40], key=lambda s: s.cx)
        if len(sub) < 4:
            continue
        for key, s in zip(("a_ex", "a_com", "a_etc", "a_tot"), sub[:4]):
            a[key] = s.cx
        if is_new:
            for s in block:   # 입주시작(예정) — 난방방식 오른쪽
                if s.cx > a.get("heating", a["a_tot"]) + 10 and ("시작" in s.text or "(예정)" in s.text.replace(" ", "")):
                    a.setdefault("movein", s.cx)
        # 자치구 열이 있는 표(재공급)에서만 단지명 왼쪽을 잘라낸다. 신규공급 표에는 자치구 열이 없어 이름 앞머리가 잘렸다
        a["_gu_cut"] = (gu.r + 6) if gu is not None else float("-inf")
        return i, a, is_new
    return None


def _bounds(a: dict[str, float]) -> tuple[list[float], list[str], float]:
    cols = sorted(((k, v) for k, v in a.items() if k not in ("name", "kind", "_gu_cut")), key=lambda kv: kv[1])
    xs = [v for _, v in cols]
    # 단지명은 헤더 폭을 훌쩍 넘긴다("두산위브더프레스티지"). 경계는 이름 칸 가운데가 아니라 전용면적 칸 바로 왼쪽에 둔다
    split = xs[0] - NAME_SLACK
    return [(xs[i] + xs[i + 1]) / 2 for i in range(len(xs) - 1)], [k for k, _ in cols], split


def _cells(row: list[Char], a: dict[str, float], bounds: list[float], names: list[str], split: float) -> dict[str, str]:
    out: dict[str, str] = {"name": "", "kind": ""}
    gu_cut = a["_gu_cut"]
    left = [c for c in row if gu_cut <= c.l + c.w / 2 < split]
    out["name"] = " ".join(s.text for s in row_segments(left)).strip()
    vals = columns_by_x([c for c in row if c.l + c.w / 2 >= split], bounds)
    for name, v in zip(names, vals):
        out[name] = "" if PUNCT_ONLY.match(v) else v.strip()
    if "kind" in a:   # 유형 열은 숫자 열 사이에 있어 x 경계로 따로 뽑는다
        lo, hi = a["kind"] - 24, a["kind"] + 24
        out["kind"] = "".join(c.ch for c in sorted((c for c in row if lo <= c.l + c.w / 2 <= hi), key=lambda c: c.l)).strip()
    return out


def _heating(text: str) -> str | None:
    m = HEATING_RE.search(text.replace(" ", ""))
    return m.group(1) + "난방" if m else None


def _movein(text: str) -> str | None:
    """입주시작(예정) 「’27.04」 — 따옴표·마침표가 다른 줄로 빠져 숫자만 남는다."""
    m = MOVEIN_DIGITS.search(text.replace(" ", ""))
    if not m:
        return None
    d = m.group(0)
    return f"’{d[:2]}.{d[2:].lstrip('0') or '0'}"


def parse_jeonse_page(xml: str, page: int, names_hint: list[str], start: int = 0) -> tuple[list[JeonseLine], int]:
    chars = parse_chars(xml)
    rows = group_rows(chars)
    segs = [[_Seg(s.l, s.r, r[0].t, s.text) for s in row_segments(r)] for r in rows]
    hit = _header(segs)
    if hit is None:
        return [], start
    hidx, a, is_new = hit
    bounds, colnames, split = _bounds(a)
    gu_cut = a["_gu_cut"] if a["_gu_cut"] > 0 else a["name"] - NAME_GAP

    data: list[tuple[float, dict[str, str]]] = []
    for r in rows[hidx + 1:]:
        if sum(1 for c in r if c.l + c.w / 2 < gu_cut and c.ch.strip()) >= FOOTNOTE_CHARS:
            break
        c = _cells(r, a, bounds, colnames, split)
        if any(c.values()):
            data.append((r[0].t, c))

    name_frags: list[tuple[float, str]] = []
    heat_anchors: list[tuple[float, str]] = []
    move_anchors: list[tuple[float, str]] = []
    body: list[tuple[float, dict[str, str]]] = []
    for y, c in data:
        # 단지명 칸은 「이름 / (자치구 동)」 두 줄. 위치 줄은 이름이 아니다
        n = c.get("name", "")
        if n and not LOC_RE.match(n):
            name_frags.append((y, n))
        h = _heating(c.get("heating", ""))
        if h:
            heat_anchors.append((y, h))
        m = _movein(c.get("movein", ""))
        if m:
            move_anchors.append((y, m))
        if _int(c.get("deposit", "")) is not None and TYPE_RE.match(c.get("area_type", "")):
            body.append((y, c))

    blocks, nxt = _name_blocks(name_frags, names_hint, start)
    if not blocks:
        return [], nxt

    out: list[JeonseLine] = []
    cur = 0
    for y, c in body:
        best = min(range(len(blocks)), key=lambda i: abs(blocks[i][0] - y))
        cur = max(cur, best)
        out.append(JeonseLine(
            complex_name=blocks[cur][1],
            area_type=c["area_type"],
            kind=(c.get("kind") or None),
            is_new=is_new,
            units_total=_int(c.get("total", "")),
            units_general=_int(c.get("general", "")),
            units_priority=_int(c.get("priority", "")),
            deposit=_mul(_int(c.get("deposit", "")), THOUSAND),
            down_payment=_mul(_int(c.get("down", "")), THOUSAND),
            balance=_mul(_int(c.get("balance", "")), THOUSAND),
            area_exclusive=_area(c.get("a_ex", "")),
            area_common=_area(c.get("a_com", "")),
            area_etc=_area(c.get("a_etc", "")),
            area_total=_area(c.get("a_tot", "")),
            heating=_heating(c.get("heating", "")) or _nearest(heat_anchors, y),  # type: ignore[arg-type]
            move_in_from=(_nearest(move_anchors, y) if is_new else None),  # type: ignore[arg-type]
            page=page,
        ))
    return out, nxt


def _mul(v: int | None, k: int) -> int | None:
    return None if v is None else v * k


def parse_jeonse_supply(pages: list[tuple[int, str]], names_hint: list[str]) -> list[JeonseLine]:
    out: list[JeonseLine] = []
    idx = 0
    for page, xml in sorted(pages):
        try:
            lines, idx = parse_jeonse_page(xml, page, names_hint, idx)
        except Exception:  # noqa: BLE001 — 한 쪽이 깨져도 나머지는 살린다
            continue
        out.extend(l for l in lines if l.is_new)   # 재공급 표는 단지명이 지구 단위라 버린다(모듈 설명 참조)
    return out
