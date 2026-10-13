"""SH 옛 「청약 경쟁률」 표 범용 파서 — 양식 A~F가 못 읽은 표에만 돈다(sh_competition.parse_competition_page).

2019~2024년 행복주택, 역세권청년주택, 국민임대, 재개발임대 결과 글은 문서마다 조판이 다르다(2026-10-13 실측:
행복주택 11건에 머리글 배치가 7가지). 양식마다 파서를 두는 대신 sh_cutline과 같은 방식으로 간다 —
**머리글 이름으로 칸 역할을 정하고**, 칸 경계는 글자가 지나지 않는 빈 띠에서 자르고, 세로 병합 칸(자치구, 단지명,
면적, 계층)은 sh_complex._split_blocks DP로 블록에 되돌린다.

양식을 모르고 읽는 만큼 **산술로만 믿는다.** 경쟁률 = 신청자 ÷ 공급호수가 인쇄된 경쟁률과 맞는 줄만 reconciled.
경쟁률 칸이 비어 있는 줄(행복주택 일반 띠)은 두 숫자 칸에 글자 구멍이 없을 때만 산술값으로 채우고 repaired로 단다.
라벨은 산술이 지켜 주지 않는다 — 블록 중심이 어긋나면 남의 단지 이름이 붙는다. 그래서 라벨이 블록보다 많거나
데이터 줄이 하나도 이름을 못 받으면 그 쪽은 통째로 버린다.
"""

from __future__ import annotations

import re
import statistics

from ..sources.ish import Char, Segment
from .sh_complex import _split_blocks

ROLES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("gu", re.compile(r"^자치구?$")),
    ("name", re.compile(r"^(?:단지명?|지명|지구및단지명?|주택명)$")),
    ("type", re.compile(r"^(?:신청유형|공급유형|주택형|유형|면적|전용면적)$")),
    ("class", re.compile(r"^(?:신청자격|공급대상|대상|자격)$")),      # 「신청 / 자격」 두 줄이면 아랫줄만 온다
    # 「공급구분」은 대상 칸이 따로 있으면 구분(일반/주거약자/우선), 없으면 계층(행복주택 청년/신혼부부) — _header가 가른다
    ("class2", re.compile(r"^공급구분$")),
    ("bracket", re.compile(r"^(?:구분|분류)$")),
    ("units", re.compile(r"^(?:공급호수|모집호수|호수|호|합계|공급세대수?|모집세대수?|모집호수계)$")),
    ("applicants", re.compile(r"^(?:신청자수?|신청자계|계|청약자수?|신청인원|접수합계|접수계)$")),
)
RATIO_HEAD = re.compile(r"^경쟁률")
# 쓰지 않는 칸. 머리글을 칸으로 세워 두지 않으면 그 칸 숫자가 이웃 칸으로 샌다(합계 4 + 공가 4 → 「44」)
SKIP = re.compile(r"^(?:단지|우선|번호|단지번호|연번)$|공가|예비|인터넷|방문|우편|비고|입주자|금회공급|성별|주소지|소재지")   # 「할 공가 입」처럼 쪼개져도 잡는다
UMBRELLA = re.compile(r"^(?:신청현황|접수누계|접수현황)$")
HEADER_WINDOW = 45.0
BRACKET_VALUE = re.compile(r"^(?:우선|일반|특별|예비자?|신규|재공급|신규공급)$")
NOTE_LINE = re.compile(r"^[※*○◦]")
LABEL_ROLES = ("gu", "name", "type", "class", "bracket", "units")
SUBTOTAL = re.compile(r"소계|합계|총계")
# 청년 매입임대 2025-2차는 한 칸에 「<재공급> 강동구 [해담빌] (29A) - 서울특별시 강동구 …」를 통째로 싣는다
COMPOSITE = re.compile(r"<\s*(신규공급|재공급)\s*>\s*([가-힣]{1,4}구)\s*\[([^\]]+)\]\s*\(\s*([0-9]{2,3}[A-Z]?)\s*\)\s*-?\s*(.*)$")
RANK_ROW = re.compile(r"\d순위$")
TOTAL_LINE = re.compile(r"^(?:총계|계|합계)$")
TYPE_RE = re.compile(r"(\d{2,3})(?:\.\d+)?\s*([A-Z])?")      # 「29.25」 → 29, 「29S」 → 29S
GU_IN_ADDR = re.compile(r"\(\s*([가-힣]{1,3}?구)")


def _key(s: str) -> str:
    return re.sub(r"\([^)]*\)", "", re.sub(r"\s+", "", s))


MERGED_TOKENS: tuple[tuple[str, str], ...] = (
    ("신청유형", "type"), ("공급구분", "bracket"), ("모집세대수", "units"), ("공급호수", "units"), ("공가입주자", "skip"),
    ("예비입주자", "skip"), ("신청자수", "applicants"), ("경쟁률", "ratio"),
    ("청약자", "applicants"),
    ("신청", "skip"),            # 2019 서울리츠 「신청 구분」의 윗줄 「신청」과 「공급호수」가 붙었다      # 미리내집 8차 「인터넷 청약자(수) / 총 청약자(수)」가 붙었다 — 뒤(총)가 덮는다
)


def _split_merged(k: str) -> list[tuple[str, str]] | None:
    """붙은 머리글을 아는 낱말로 끝까지 쪼갤 수 있으면 [(낱말, 역할)]. 낱말 둘 이상일 때만."""
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(k):
        hit = next(((w, r) for w, r in MERGED_TOKENS if k.startswith(w, i)), None)
        if not hit:
            return None
        out.append(hit)
        i += len(hit[0])
    return out if len(out) >= 2 else None


def _cx(s: Segment) -> float:
    return (s.l + s.r) / 2


def _header(rows: list[tuple[float, list[Segment], list[Char]]]) -> tuple[dict[str, float], float] | None:
    """칸 역할 → 칸 중심 x, 머리글 바닥 y. 경쟁률 머리글이 없거나 숫자 칸 셋을 못 갖추면 None."""
    heads = [t for t, segs, _c in rows if any("경쟁률" in (k := _key(s.text)) and len(k) <= 10 for s in segs)]
    # 표 위 총계 줄에 「모집호수 | 신청자수 | 경쟁률」만 따로 찍는 문서가 있다(2022-2 서울리츠) — 단지명 머리글이 곁에 있는 줄을 먼저 고른다
    named = [t for t in heads if any(abs(rt - t) <= HEADER_WINDOW and any(_key(x.text) in ("단지명", "단지") for x in segs)
                                     for rt, segs, _c in rows)]
    anchor = (named or heads or [None])[0]
    if anchor is None:
        return None
    cols: dict[str, float] = {}
    bottom = anchor
    brk_x: float | None = None
    umbrella: float | None = None
    gye: list[float] = []
    name_from = ""
    ratio_heads: list[tuple[float, float]] = []
    for t, segs, _c in rows:
        if abs(t - anchor) > HEADER_WINDOW:
            continue
        # 머리글 줄엔 숫자가 없다. 머리글 바로 밑 데이터 줄(「일반 | 일반 | 60 | 294」)을 머리글로 읽으면 칸이 뒤틀린다
        if any(ch.isdigit() for seg in segs for ch in seg.text) and not any(RATIO_HEAD.match(_key(seg.text)) for seg in segs):
            continue
        hit = False
        for s in sorted(segs, key=_cx):
            k = _key(s.text)
            if RATIO_HEAD.match(k) and len(k) <= 8:
                ratio_heads.append((t, _cx(s)))
                hit = True
                continue
            parts = _split_merged(k)
            if parts:
                # 머리글 여럿이 한 조각으로 붙었다(39차 「신청자수경쟁률」, 국민임대 2023 「신청유형공급구분」
                # 「모집세대수공가입주자예비입주자」). 글자 수 비율로 조각 안 자리를 나눠 각자 칸을 세운다
                total = sum(len(w) for w, _r in parts)
                acc = 0
                for w, r in parts:
                    x = s.l + (s.r - s.l) * (acc + len(w) / 2) / total
                    acc += len(w)
                    if r == "ratio":
                        ratio_heads.append((t, x))
                    elif r == "skip":
                        cols[f"skip@{x:.0f}"] = x
                    else:
                        cols[r] = x      # 붙은 머리글 쪽 자리가 더 정확하다 — 윗줄 묶음 머리글(「공급 세대」)로 잡은 자리를 덮는다
                hit = True
                continue
            if UMBRELLA.fullmatch(k):
                umbrella = umbrella or _cx(s)      # 「신청현황」 아래 「계」가 총계 줄로 걸러져도 신청자 칸 자리는 안다
                continue
            role = next((r for r, p in ROLES if p.fullmatch(k)), None)
            # 면적 칸이 이미 섰는데 또 「공급유형」이면 그건 구분 칸(일반/주거약자)이다(국민임대 2022)
            if role == "type" and "type" in cols and "bracket" not in cols:
                role = "bracket"
            if k == "일반":
                brk_x = _cx(s)      # 「우선 / 일반」 두 줄 머리글 — 구분 칸이다(행복주택 2024)
            if k == "계":
                gye.append(_cx(s))
            if k == "단지명" and name_from == "단지" and "name" in cols:
                # 「단지 / 번호」 두 줄 머리글의 「단지」를 이름 칸으로 먼저 잡았다(재개발 2021) — 「단지명」이 진짜다
                old = cols.pop("name")
                cols[f"skip@{old:.0f}"] = old
            if role == "name" and "name" not in cols:
                name_from = k
            if k == "계" and "applicants" in cols and _cx(s) < cols["applicants"] - 30:
                cols["units"] = _cx(s)     # 신청자 칸이 따로 있으면 왼쪽 「계」는 모집호수 합계다(2022-2 서울리츠 재공급 표)
                hit = True
            elif role and role not in cols:
                cols[role] = _cx(s)
                hit = True
            elif role and abs(cols[role] - _cx(s)) > 30:
                cols[f"skip@{_cx(s):.0f}"] = _cx(s)    # 같은 머리글이 또 나온 칸(39차 맨 오른쪽 「구분」은 마감 여부다)
                hit = True
            elif SKIP.search(k) and t > anchor - HEADER_WINDOW and not any(abs(x - _cx(s)) < 12 for x in cols.values()):
                cols[f"skip@{_cx(s):.0f}"] = _cx(s)
                hit = True
            elif s.text.strip().startswith("(") and t > anchor:
                hit = True
        if hit:
            bottom = max(bottom, t)
    # 「경쟁률」이 여러 번 나오면 가장 아랫줄 것들이 칸이다. 윗줄은 두 칸(우선경쟁률, 단지경쟁률)을 덮는 묶음 머리글이라
    # 칸으로 세우면 경계가 두 칸 사이에 서서 인쇄된 경쟁률을 놓친다(2024 행복주택). 아랫줄의 왼쪽(우선)을 쓰고 나머지는 건너뛴다
    low = max(t for t, _x in ratio_heads)
    xs = sorted(x for t, x in ratio_heads if abs(t - low) < 3)
    cols["ratio"] = xs[0]
    for x in xs[1:]:
        cols[f"skip@{x:.0f}"] = x
    if brk_x is not None and abs(cols.get("bracket", brk_x) - brk_x) > 15:
        # 「공급 구분」 머리글은 계층 칸이었다. 진짜 구분 칸은 「우선 / 일반」
        if "class" not in cols:
            cols["class"] = cols["bracket"]
        cols["bracket"] = brk_x
    elif brk_x is not None:
        cols["bracket"] = brk_x
    if "class2" in cols:
        if "class" not in cols:
            cols["class"] = cols.pop("class2")
        elif "bracket" not in cols:
            cols["bracket"] = cols.pop("class2")
        else:
            x = cols.pop("class2")
            cols[f"skip@{x:.0f}"] = x
    # 「우선」 「단지」는 경쟁률 두 칸의 윗줄이기도 하다 — 경쟁률 칸과 겹치면 건너뛸 칸이 아니다
    for k in [k for k in cols if k.startswith("skip@")]:
        if any(abs(cols[k] - cols[r]) < 15 for r in cols if not r.startswith("skip@")):
            del cols[k]
    # 「계」가 둘이면(모집 계 | 신청 계, 재개발 2021) 왼쪽이 모집호수, 오른쪽이 신청자다
    if "units" not in cols and len(gye) >= 2:
        cols["units"], cols["applicants"] = min(gye), max(gye)
        for k in [k for k in cols if k.startswith("skip@") and abs(cols[k] - max(gye)) < 3]:
            del cols[k]
    if "applicants" not in cols and umbrella is not None:
        cols["applicants"] = umbrella
    # 단지가 하나뿐인 공고(행복주택 상아2차)는 단지명 칸이 없다 — 이름 없이 회차 숫자만 싣는다
    if not {"units", "applicants", "ratio"} <= set(cols):
        return None
    return cols, bottom + 1.0


def _bounds(cols: dict[str, float], chars: list[Char]) -> list[tuple[str, float, float]]:
    from .sh_competition import _widest_gap

    order = sorted(cols.items(), key=lambda kv: kv[1])
    edges = []
    for (_a, ax), (_b, bx) in zip(order, order[1:]):
        gap = _widest_gap(chars, ax, bx)
        edges.append(gap if gap is not None else (ax + bx) / 2)
    return [(r, float("-inf") if i == 0 else edges[i - 1], float("inf") if i == len(order) - 1 else edges[i])
            for i, (r, _x) in enumerate(order)]


def _ratio_text(t: str) -> str:
    t = re.sub(r"[가-힣]+$", "", t.strip())          # 경계를 넘어온 「마감」
    return re.sub(r"\s*:\s*1\s*$", "", t).strip()


def parse_flat_page(rows: list[tuple[float, list[Segment], list[Char]]], page: int) -> list:
    """한 쪽에 머리글이 다른 표가 여럿이면(2022-2 서울리츠 <신규>/<재공급>) 「단지명」 머리글마다 잘라 따로 읽는다."""
    heads = [t for t, segs, _c in rows if any(_key(x.text) in ("단지명", "단지") for x in segs)]
    cuts = [h - HEADER_WINDOW for h in heads[1:] if h - heads[0] > 2 * HEADER_WINDOW]
    if not cuts:
        return _parse_table(rows, page)
    out: list = []
    edges = [float("-inf"), *cuts, float("inf")]
    for lo, hi in zip(edges, edges[1:]):
        out.extend(_parse_table([r for r in rows if lo <= r[0] < hi], page))
    return out


def _parse_table(rows: list[tuple[float, list[Segment], list[Char]]], page: int) -> list:
    """rows는 총계 줄을 거르지 않은 글자 줄이다 — 「계 | 경쟁률」처럼 「계」로 시작하는 머리글 줄이 있어서다(2020 행복주택)."""
    from .sh_competition import CompetitionRow, _Cell, _cell, _clean_complex, _close, _dot_dropped, _int, _pitch, _ratio

    found = _header(rows)
    if not found:
        return []
    cols, bottom = found
    body = [(t, segs, chars) for t, segs, chars in rows
            if t > bottom and not NOTE_LINE.match(segs[0].text) and not TOTAL_LINE.fullmatch(segs[0].text.replace(" ", ""))]
    if not body:
        return []
    bounds = _bounds(cols, [c for _t, _s, chars in body for c in chars])
    pitch = _pitch([c for _t, _s, chars in body for c in chars])

    lines: list[tuple[float, dict]] = []
    for t, _segs, chars in body:
        cells = {r: _cell(chars, lo, hi, pitch, lines=r in ("gu", "name", "class")) for r, lo, hi in bounds}
        lines.append((t, cells))

    def is_data(cells: dict) -> bool:
        # 표 중간의 단지 소계 줄(「단지소계」)은 행이 아니다 — 소계는 우리가 직접 더한다
        if any(SUBTOTAL.search(cells[r].text.replace(" ", "")) for r in ("name", "class", "bracket", "type") if r in cells):
            return False
        return _int(cells["applicants"]) is not None or _ratio(_Cell(_ratio_text(cells["ratio"].text), False)) is not None

    data = [(t, c) for t, c in lines if is_data(c)]
    if not data:
        return []
    # 표 머리의 합계 줄은 「총계」 글자 없이 숫자만 오기도 한다(재개발 2020). 라벨이 하나도 없는 데이터 줄은 다른 줄이 다 라벨을 가질 때 뺀다
    labelled = [any(c[r].text.strip() for r in LABEL_ROLES if r in c and r != "units") for _t, c in data]
    if sum(labelled) >= 0.8 * len(data) and not labelled[0]:
        data = data[1:]
    if not data:
        return []
    # 면적 칸에 「우선」 「일반」이 들어 있으면 그건 구분 칸이다(서울리츠 2021: 「공급 유형」 머리글이 두 줄)
    if "type" in cols and "bracket" not in cols:
        vals = [c["type"].text.replace(" ", "") for _t, c in data if c["type"].text]
        if vals and sum(bool(BRACKET_VALUE.fullmatch(v)) for v in vals) > len(vals) / 2:
            for _t, c in lines:
                c["bracket"] = c.pop("type")
            cols["bracket"] = cols.pop("type")
    spacing = statistics.median([b[0] - a[0] for a, b in zip(data, data[1:])]) if len(data) > 1 else 20.0

    def labels(role: str) -> list[tuple[float, str]]:
        out: list[tuple[float, str, bool]] = []      # (y, 글, 데이터 줄인가)
        for t, c in lines:
            v = c[role].text.strip() if role in c else ""
            if role == "gu" and v in ("·", "ㆍ"):
                continue
            if role == "name" and re.fullmatch(r"<[^>]*>", v.replace(" ", "")):
                continue          # 「<신규>」 「<재공급>」 표 제목(2022-2 서울리츠)
            if not v:
                continue
            own = is_data(c)
            # 「·」가 단지명 칸 왼쪽 경계를 넘어 자치구 칸으로 떨어지기도 한다
            if role == "name" and "gu" in c and c["gu"].text.strip() in ("·", "ㆍ"):
                v = "·" + v
            if role == "name" and out and v.startswith("·"):
                # 지구 이름 밑 「· 강남한양수자인」 — 단지 이름이다. 지구에 괄호로 붙인다(국민임대 2023)
                prev = out[-1][1]
                sub = v.lstrip("·").strip()
                joined = f"{prev[:-1]}, {sub})" if prev.endswith(")") and "·" not in prev else f"{prev}({sub})"
                out[-1] = ((out[-1][0] + t) / 2, joined, out[-1][2])
                continue
            if role == "name" and out and v.startswith("("):
                out[-1] = ((out[-1][0] + t) / 2, f"{out[-1][1]} {v}", out[-1][2])   # 단지명 밑 소재지 줄
                continue
            # 두 줄로 접힌 라벨(「주거급여」/「수급자」) — 데이터 줄이 아닌 라벨끼리 사이에 데이터 줄이 없으면 한 칸
            if (role in ("class", "gu") and out and not own and not out[-1][2]
                    and not any(out[-1][0] < dt < t for dt, _c in data)):
                out[-1] = ((out[-1][0] + t) / 2, out[-1][1] + v, False)
                continue
            out.append((t, v, own))
        return [(t, v) for t, v, _o in out]

    filled: dict[str, list[str]] = {}
    for role in LABEL_ROLES:
        if role not in cols:
            filled[role] = [""] * len(data)
            continue
        own = [c[role].text.strip() for _t, c in data]
        if all(own):
            filled[role] = own
            continue
        labs = labels(role)
        if not labs or len(labs) > len(data):
            if role == "name":
                return []          # 이름을 못 되돌리면 숫자가 맞아도 누구 숫자인지 모른다
            filled[role] = own
            continue
        idx = _split_blocks([t for t, _c in data], [y for y, _v in labs])
        filled[role] = [labs[k][1] if k >= 0 else "" for k in idx]

    # 병합 자치구는 DP가 어긋나도 산술이 못 잡는다. 한 단지에 자치구가 둘 이상 붙으면 이 쪽의 자치구는 못 믿는다 — 비운다
    # (국민임대 2023: 「발산지구」가 강서구와 구로구로 갈렸다). 빈 자치구는 화면이 단지 목록에서 이름으로 채운다
    if "gu" in cols and not all(c["gu"].text.strip() for _t, c in data):
        seen: dict[str, set[str]] = {}
        for nm, g in zip(filled["name"], filled["gu"]):
            seen.setdefault(nm, set()).add(g)
        if any(len(v) > 1 for v in seen.values()):
            filled["gu"] = [""] * len(data)

    out: list = []
    group: list = []

    def flush() -> None:
        if not group:
            return
        if len(group) > 1 or group[0].bracket != "소계":
            us = [r.units for r in group]
            ap = [r.applicants for r in group]
            ok = all(r.reconciled for r in group) and None not in us and None not in ap
            # 순위 줄(1순위, 2순위 …)은 같은 집의 공급호수를 줄마다 되풀이한다 — 더하지 않고 하나만. 우선/일반 띠는 호수가 따로라 더한다
            ranks = all(RANK_ROW.search(r.bracket) for r in group)
            u, a = ((max(us) if ranks else sum(us)), sum(ap)) if ok else (None, None)
            ratio = group[0].ratio if len(group) == 1 else (round(a / u, 1) if ok and u else None)   # 한 줄이면 인쇄된 값 그대로
            first = group[0]
            out.append(CompetitionRow(first.complex_name, first.sigungu, "", first.supply_kind, first.supply_type, first.tenant_class,
                                      "소계", u, a, ratio, ok and ratio is not None, True, first.page))
        group.clear()

    for i, (_t, c) in enumerate(data):
        raw_name = filled["name"][i]
        gu = filled["gu"][i] or (m.group(1) if (m := GU_IN_ADDR.search(raw_name)) else "")
        # 소재지 괄호(「(광진구 구의동 587-64)」)를 뗀다. 줄을 이으며 하이픈과 밑줄이 괄호 뒤로 밀리기도 한다
        name = _clean_complex(re.sub(r"\s*\([^)]*구[^)]*\)[\s_\-]*$", "", raw_name).strip(" _-")).strip(" _-")
        name = re.sub(r"\s*\[[^\]]*\]$", "", name)      # 「백년빌 [26B]」 — 주택형은 면적 칸에 따로 있다
        if "name" in cols and not re.search(r"[가-힣A-Za-z]{2,}", name):
            continue
        units_cell = c["units"] if c["units"].text else _Cell(filled["units"][i], False)
        units = _int(units_cell)
        applicants = _int(c["applicants"])
        rtext = _ratio_text(c["ratio"].text)
        ratio = _ratio(_Cell(rtext, False))
        derived = round(applicants / units, 1) if (units and applicants is not None) else None
        ok = _close(ratio, derived) or (applicants == 0 and ratio == 0)
        repaired = False
        if not ok and _dot_dropped(ratio, derived):
            ratio, ok, repaired = derived, True, True
        elif not ok and ratio is not None and derived is not None and "." not in rtext and ratio == round(derived):
            ok = True          # 정수로 반올림해 찍는 표(매입임대 C 양식과 같은 버릇)
        elif ratio is None and not rtext and derived is not None and not (units_cell.hole or c["applicants"].hole):
            ratio, ok, repaired = derived, True, True     # 경쟁률이 인쇄되지 않는 띠(행복주택 일반)
        bracket = filled["bracket"][i].replace(" ", "") or "소계"
        # 청년 매입임대의 「신규공급 / 재공급」은 구분이 아니라 공급 종류다(양식 C의 supply_kind와 같은 칸)
        kind = ""
        if bracket in ("신규", "신규공급", "재공급"):
            kind, bracket = ("신규공급" if bracket.startswith("신규") else "재공급"), "소계"
        tm = TYPE_RE.search(filled["type"][i])
        stype = (tm.group(1) + (tm.group(2) or "")) if tm else ""
        # 주소는 싣지 않는다 — 칸을 줄 단위로 이으며 띄어쓰기가 빠져 좌표 조인(S6) 열쇠로 못 쓴다
        if cm := COMPOSITE.search(raw_name):
            kind, gu, name, stype = cm.group(1), cm.group(2), cm.group(3).strip(), cm.group(4)
        cls = filled["class"][i].replace(" ", "").strip("-")
        if bracket == "소계" and re.search(r"\d순위$", cls):
            bracket, cls = cls, ""        # 대상 칸이 곧 순위다(청년 매입임대) — 양식 C처럼 구분에 싣는다
        row = CompetitionRow(name, gu, "", kind, stype, cls, bracket, units, applicants, ratio, ok, repaired, page)
        if group and (group[0].complex_name, group[0].supply_type, group[0].tenant_class) != (
                row.complex_name, row.supply_type, row.tenant_class):
            flush()
        out.append(row)
        if bracket != "소계":
            group.append(row)
    flush()
    return out
