"""SH 행복주택·국민임대 공고문 「공급현황」 표 파서 — 단지 × 공급유형 × 공급대상 한 줄씩.

정답지: 2026년 2차 행복주택(i-sh seq=309337) 11~15쪽.
- 11쪽 [신규 공급]: 자치구|단지명|공급유형(㎡)|공급구분|공급호수 계·우선·일반|임대보증금 계·계약금20%·잔금80%|월임대료|계약면적 주거전용·주거공용·기타공용·합계|입주시작(예정)
- 12~15쪽 [재공급]: 위와 같고 호수가 합계(A+B)|공가(A) 우선·일반|금회 공급할 예비입주자(B) 로 갈린다

이 표가 「단지별 주소」 표(sh_addr_table)보다 알갱이가 잘다. 주소 표는 단지 61곳인데
공급현황은 단지 × 유형 × 계층으로 82줄이라, 화면에 보여줄 사실(공가 호수·예비자 호수·계약면적·계층별 금액)이 여기에만 있다.

## 좌표로 읽는 이유
칸이 세로로 병합돼 있어 줄 단위로 못 읽는다. 한 단지의 이름 칸은 그 단지의 모든 계층 줄에 걸쳐 있고,
공급유형 칸은 그 유형의 계층 줄들에, 호수 칸은 소득있음/소득없음 두 줄에 걸쳐 있다. 병합 칸은 걸친 구간의 **가운데**에 그려진다.
그래서 값마다 "세로로 가장 가까운 앵커"를 찾으면 병합이 복원된다.

또 쉼표·소수점은 baseline이 달라 별도 줄로 오고, 인접 칸의 숫자가 한 덩어리로 붙어 온다("18160036320" = 181,600 + 36,320).
그래서 줄을 칸으로 나눌 때 gap이 아니라 **글자 x 중심을 열 경계에 넣는 방식**(columns_by_x)을 쓴다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..sources.ish import Char, columns_by_x, group_rows, parse_chars, row_segments

# 열 이름(내부 키). 신규 표에는 reserve가 없고 movein이 있다
COLS = ("name", "type", "klass", "total", "priority", "general", "reserve",
        "deposit", "down", "balance", "rent", "a_ex", "a_com", "a_etc", "a_tot", "movein")

HEADER_NAME = re.compile(r"^단지\s*명$")
HEADER_TYPE = re.compile(r"^공급\s*유형$|^유형$")
HEADER_KLASS = re.compile(r"^공급\s*구분$|^구분$")
HEADER_MONEY = re.compile(r"^임대보증금\s*\(\s*천\s*원\s*\)$")
HEADER_AREA = re.compile(r"세대\s*별\s*계약\s*면적")
HEADER_RENT = re.compile(r"^월\s*임대료$|^임대료$")
HEADER_UNITS_NEW = re.compile(r"^공급\s*호수$")
HEADER_UNITS_RE = re.compile(r"^공가\s*입주자$|^\(\s*A\s*\+\s*B\s*\)$")

# 계층(공급대상). 「청년」은 소득있음/소득없음 두 줄로 쪼개져 오고 라벨 글자도 세로로 갈린다
KLASS_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"신혼부부"), "신혼부부"),
    (re.compile(r"고령자"), "고령자"),
    (re.compile(r"대학생"), "대학생"),
    (re.compile(r"주거\s*급여"), "주거급여수급자"),
    (re.compile(r"소득\s*있음|소득\s*없음"), "청년"),
    (re.compile(r"산단\s*근로자|근로자"), "산업단지근로자"),
    (re.compile(r"신생아"), "신생아"),
)
INCOME_RE = re.compile(r"소득\s*있음|소득\s*없음")

TYPE_RE = re.compile(r"^\d{1,3}[A-Za-z]?$")     # 39 · 29S
INT_RE = re.compile(r"^\d{1,5}$")
PUNCT_ONLY = re.compile(r"^[\s.,·'’\-—()]*$")
MOVEIN_DIGITS = re.compile(r"\d{3,4}")   # 입주시작 「’27.5」 — 따옴표·마침표가 별도 줄로 빠져 "275"만 남는다
THOUSAND = 1000                                  # 임대보증금 열 단위(천원)
AREA_SCALE = 100.0                               # 면적은 소수점 둘째 자리까지. 소수점은 별도 줄로 와 사라진다
FOOTNOTE_CHARS = 8                               # 자치구 칸보다 왼쪽에 이만큼 글자가 있으면 표가 끝난 것으로 본다


@dataclass(frozen=True)
class SupplyLine:
    """공급현황 표 한 줄 = 단지 × 공급유형 × 공급대상 × 소득옵션."""

    complex_name: str
    supply_type: str            # "39" · "29S". S는 주거약자용
    tenant_class: str           # 신혼부부 · 청년 · 고령자 · 대학생 · 주거급여수급자
    income_option: str | None   # 청년만: 소득있음 · 소득없음
    is_new: bool                # [신규 공급] 구간
    units_total: int | None     # 합계(A+B) — 신규는 공급호수 계
    units_priority: int | None  # 우선
    units_general: int | None   # 일반
    units_reserve: int | None   # 금회 공급할 예비입주자(B). 신규는 None
    deposit: int | None         # 임대보증금 계(원)
    down_payment: int | None    # 계약금 20%(원)
    balance: int | None         # 잔금 80%(원)
    rent: int | None            # 월임대료(원)
    area_exclusive: float | None
    area_common: float | None
    area_etc: float | None
    area_total: float | None
    move_in_from: str | None    # 입주시작(예정) 원문 표기. 신규만
    page: int

    @property
    def units_vacant(self) -> int | None:
        """공가(A) = 우선 + 일반. 재공급 표에서만 뜻이 있다."""
        if self.units_priority is None and self.units_general is None:
            return None
        return (self.units_priority or 0) + (self.units_general or 0)


@dataclass
class _Seg:
    l: float
    r: float
    t: float
    text: str

    @property
    def cx(self) -> float:
        return (self.l + self.r) / 2


def _norm(s: str) -> str:
    """단지명 비교용. 공백·괄호·밑줄과 사업주체 꼬리를 뗀다."""
    t = re.sub(r"서울리츠\s*\d*\s*호?", "", s)
    # 전각 괄호(（）)가 섞여 오는 줄이 있다 — 어차피 다 떼므로 함께 넣는다
    return re.sub(r"[\s_,·・()\[\]（）〔〕]", "", t)


def _int(text: str) -> int | None:
    t = re.sub(r"[^\d]", "", text)
    return int(t) if t and len(t) <= 9 else None


def _area(text: str) -> float | None:
    """면적 칸. 소수점이 별도 줄로 빠져 "4940" 꼴로 온다 → 49.40."""
    t = re.sub(r"[^\d]", "", text)
    if not t or len(t) > 6:
        return None
    v = int(t) / AREA_SCALE
    return v if 0 < v < 1000 else None


# ── 헤더에서 열 경계 만들기 ────────────────────────────────────────


def _header_anchors(rows: list[list[_Seg]]) -> tuple[int, dict[str, float]] | None:
    """헤더 줄 묶음에서 열 이름 → x 중심. 못 찾으면 None.

    헤더는 6~9줄에 걸쳐 흩어져 있어(단지명·유형·구분이 서로 다른 줄) 「단지명」이 있는 줄 앞뒤를 함께 본다.
    """
    for i, segs in enumerate(rows):
        if not any(HEADER_NAME.match(s.text.replace(" ", "")) for s in segs):
            continue
        block = [s for r in rows[max(0, i - 6): i + 6] for s in r]
        a: dict[str, float] = {}
        money: _Seg | None = None
        area: _Seg | None = None
        units_hdr: _Seg | None = None
        new_units: _Seg | None = None
        for s in block:
            t = s.text.replace(" ", "")
            if HEADER_NAME.match(t):
                a.setdefault("name", s.cx)
            elif HEADER_TYPE.match(t):
                a.setdefault("type", s.cx)
            elif HEADER_KLASS.match(t):
                a.setdefault("klass", s.cx)
            elif HEADER_MONEY.match(t):
                money = s
            elif HEADER_AREA.search(t):
                area = s
            elif HEADER_RENT.match(t):
                a.setdefault("rent", s.cx)
            elif HEADER_UNITS_NEW.match(t):
                new_units = s
            elif HEADER_UNITS_RE.match(t):
                units_hdr = s
        if "name" not in a or "type" not in a or money is None or area is None:
            continue
        # 금액 3열: 계 | 계약금(20%) | 잔금(80%) — 묶음 헤더 아래 낱개 라벨의 x를 쓴다
        for s in block:
            t = s.text.replace(" ", "")
            if t.startswith("계약금") and money.l - 20 <= s.cx <= money.r + 20:
                a.setdefault("down", s.cx)
            elif t.startswith("잔금") and money.l - 20 <= s.cx <= money.r + 20:
                a.setdefault("balance", s.cx)
        if "down" not in a or "balance" not in a:
            continue
        # 임대보증금 「계」 — 묶음 헤더는 칸 위에 가운데로 오지 크기가 칸을 안 덮는다. 낱개 라벨 「계」의 x를 쓴다
        for s2 in block:
            if s2.text.strip() == "계" and a["klass"] < s2.cx < a["down"]:
                a["deposit"] = max(a.get("deposit", 0.0), s2.cx)   # 공급호수 「계」와 겹치면 오른쪽 것이 보증금
        if "deposit" not in a:
            a["deposit"] = money.l + (a["down"] - money.l) / 2
        # 면적 4열: 주거전용 | 주거공용 | 기타공용 | 합계
        sub = sorted([s for s in block if s.text.replace(" ", "") in ("전용", "공용", "합계") and area.l - 20 <= s.cx <= area.r + 20], key=lambda s: s.cx)
        if len(sub) < 4:
            continue
        for key, s in zip(("a_ex", "a_com", "a_etc", "a_tot"), sub[:4]):
            a[key] = s.cx
        if "rent" not in a:
            a["rent"] = (a["balance"] + a["a_ex"]) / 2
        # 호수 열 — 공고마다 라벨이 조금씩 다르다(「우선」「일반」이 한 칸에 붙기도 하고, 「(B)」가 「()」+「B」로 갈리기도)
        lo, hi = a["klass"], a["deposit"]
        for s2 in block:
            t = s2.text.replace(" ", "")
            if not (lo < s2.cx < hi):
                continue
            if t == "우선일반":            # 한 칸에 두 열. 좌우 4분점을 각 열 중심으로
                a.setdefault("priority", s2.l + (s2.r - s2.l) / 4)
                a.setdefault("general", s2.r - (s2.r - s2.l) / 4)
            elif t == "우선":
                a.setdefault("priority", s2.cx)
            elif t == "일반":
                a.setdefault("general", s2.cx)
            elif t in ("(A+B)", "합계"):
                a.setdefault("total", s2.cx)
            elif t in ("예비", "입주자", "(B)", "B", "()"):
                a.setdefault("reserve", s2.cx)
            elif t == "계" and units_hdr is None and new_units is not None and new_units.l - 30 <= s2.cx <= new_units.r + 30:
                a.setdefault("total", s2.cx)
        if units_hdr is not None:   # 재공급: 합계(A+B) | 공가(A) 우선·일반 | 예비입주자(B)
            if not {"total", "priority", "general", "reserve"} <= a.keys():
                continue
        elif new_units is not None:  # 신규: 공급호수 계 | 우선 | 일반. 예비 열이 없고 입주시작(예정)이 붙는다
            a.pop("reserve", None)
            if not {"total", "priority", "general"} <= a.keys():
                continue
            for s2 in block:   # 입주시작(예정) — 면적 오른쪽
                if s2.cx > a["a_tot"] + 10 and ("시작" in s2.text or s2.text.strip() == "정"):
                    a.setdefault("movein", s2.cx)
        else:
            continue
        return i, a
    return None


NAME_GAP = 45.0      # 자치구 칸(세로로 한 글자씩)과 단지명 칸 사이. 단지명 중심에서 이만큼 왼쪽은 자치구다
TYPE_SLACK = 13.0    # 공급유형 칸 왼쪽 경계. 단지명은 길어서 헤더 폭을 넘기므로 유형 칸 기준으로 자른다


def _num_bounds(anchors: dict[str, float]) -> tuple[list[float], list[str], float]:
    """숫자 열(호수·금액·면적·입주시작)만 x 경계로 나눈다. 돌려주는 마지막 값은 글자 열과의 경계."""
    cols = sorted(((k, v) for k, v in anchors.items() if k not in ("name", "type", "klass")), key=lambda kv: kv[1])
    names = [k for k, _ in cols]
    xs = [v for _, v in cols]
    split = (anchors["klass"] + xs[0]) / 2
    bounds = [(xs[i] + xs[i + 1]) / 2 for i in range(len(xs) - 1)]
    return bounds, names, split


def _cells(row: list[Char], anchors: dict[str, float], bounds: list[float], names: list[str], split: float) -> dict[str, str]:
    """왼쪽(단지명·유형·구분)은 칸 사이가 벌어져 있어 gap으로 나누고, 오른쪽 숫자 열은 붙어 오므로 x 경계로 나눈다."""
    out: dict[str, str] = {k: "" for k in ("name", "type", "klass")}
    gu_cut = anchors["name"] - NAME_GAP
    type_lo = anchors["type"] - TYPE_SLACK
    # 단지명이 길면 유형 칸 글자와 한 덩어리로 이어져 온다("푸르내(서울리츠1호)28S") — 글자 x로 먼저 가르고 나서 gap으로 나눈다
    mid = [c for c in row if gu_cut <= c.l + c.w / 2 < split]
    for seg in row_segments([c for c in mid if c.l + c.w / 2 < type_lo]):
        out["name"] = (out["name"] + " " + seg.text).strip() if out["name"] else seg.text
    for seg in row_segments([c for c in mid if c.l + c.w / 2 >= type_lo]):
        # 유형은 숫자(+S), 그 밖은 공급구분. 「청」「년」처럼 세로로 갈린 계층 라벨이 유형 칸에 바짝 붙어 온다
        key = "type" if TYPE_RE.match(seg.text.replace(" ", "")) else "klass"
        out[key] = (out[key] + " " + seg.text).strip() if out[key] else seg.text
    vals = columns_by_x([c for c in row if c.l + c.w / 2 >= split], bounds)
    for name, v in zip(names, vals):
        out[name] = "" if PUNCT_ONLY.match(v) else v.strip()
    for k, v in out.items():
        if PUNCT_ONLY.match(v):
            out[k] = ""
    return out


def _nearest(anchors: list[tuple[float, object]], y: float) -> object | None:
    """세로로 가장 가까운 앵커 값. 병합 칸은 걸친 구간 가운데에 그려지므로 이게 곧 그 칸의 주인이다."""
    if not anchors:
        return None
    return min(anchors, key=lambda a: abs(a[0] - y))[1]


def parse_supply_page(xml: str, page: int, names_hint: list[str], start: int = 0) -> tuple[list[SupplyLine], int]:
    chars = parse_chars(xml)
    rows = group_rows(chars)
    segs = [[_Seg(s.l, s.r, r[0].t, s.text) for s in row_segments(r)] for r in rows]
    hit = _header_anchors(segs)
    if hit is None:
        return [], start
    hidx, anchors = hit
    is_new = "reserve" not in anchors
    bounds, colnames, split = _num_bounds(anchors)

    # 1) 데이터 줄을 열로 나눈다. 표 아래 각주(「• 신규 단지의 경우 …」)는 자치구 칸보다 왼쪽에서 시작해 구분된다
    gu_cut = anchors["name"] - NAME_GAP
    data: list[tuple[float, dict[str, str]]] = []
    for r in rows[hidx + 1:]:
        if sum(1 for c in r if c.l + c.w / 2 < gu_cut and c.ch.strip()) >= FOOTNOTE_CHARS:
            break   # 자치구 칸에는 길어야 「강남구」다. 그보다 길면 표가 끝나고 각주 문장이 시작된 것
        y = r[0].t
        c = _cells(r, anchors, bounds, colnames, split)
        if any(c.values()):
            data.append((y, c))

    # 2) 앵커 모으기 — 병합 칸의 주인을 찾기 위한 기준점
    type_anchors: list[tuple[float, str]] = []
    count_anchors: list[tuple[float, tuple[int | None, int | None, int | None, int | None]]] = []
    area_anchors: list[tuple[float, tuple[float | None, ...]]] = []
    money_rows: list[tuple[float, dict[str, str]]] = []
    movein_anchors: list[tuple[float, str]] = []
    name_frags: list[tuple[float, str]] = []
    for y, c in data:
        if TYPE_RE.match(c.get("type", "")):
            type_anchors.append((y, c["type"]))
        total = _int(c.get("total", ""))
        if total is not None:
            count_anchors.append((y, (total, _int(c.get("priority", "")), _int(c.get("general", "")), _int(c.get("reserve", "")))))
        areas = tuple(_area(c.get(k, "")) for k in ("a_ex", "a_com", "a_etc", "a_tot"))
        if sum(v is not None for v in areas) >= 3:
            area_anchors.append((y, areas))
        if _int(c.get("rent", "")) is not None:
            money_rows.append((y, c))
        mv = _movein(c.get("movein", ""))
        if mv:
            movein_anchors.append((y, mv))
        if c.get("name") and _looks_like_name(c["name"]):
            name_frags.append((y, c["name"]))

    # 3) 단지명 블록 — 조각을 순서대로 이어 붙이다 「단지별 주소」 표 이름과 맞으면 한 블록을 닫는다
    blocks, nxt = _name_blocks(name_frags, names_hint, start)
    if not blocks:
        return [], nxt

    # 4) 공급유형마다 단지를 정한다(세로로 가장 가까운 이름 블록). 순서는 뒤로만 간다
    type_owner: dict[float, str] = {}
    cur = 0
    for y, _t in type_anchors:
        best = min(range(len(blocks)), key=lambda i: abs(blocks[i][0] - y))
        cur = max(cur, best)
        type_owner[y] = blocks[cur][1]

    # 5) 금액 줄마다 유형·호수·면적을 붙여 한 줄씩 낸다
    out: list[SupplyLine] = []
    for y, c in money_rows:
        klass, income = _klass(c.get("klass", ""))
        if klass is None:
            continue
        ty = _nearest([(ay, ay) for ay, _ in type_anchors], y)
        if ty is None:
            continue
        counts = _nearest(count_anchors, y) or (None, None, None, None)
        areas = _nearest(area_anchors, y) or (None, None, None, None)
        total, priority, general, reserve = counts
        out.append(SupplyLine(
            complex_name=type_owner.get(ty, ""),
            supply_type=dict(type_anchors)[ty],
            tenant_class=klass,
            income_option=income,
            is_new=is_new,
            units_total=total, units_priority=priority, units_general=general, units_reserve=reserve,
            deposit=_mul(_int(c.get("deposit", "")), THOUSAND),
            down_payment=_mul(_int(c.get("down", "")), THOUSAND),
            balance=_mul(_int(c.get("balance", "")), THOUSAND),
            rent=_int(c.get("rent", "")),
            area_exclusive=areas[0], area_common=areas[1], area_etc=areas[2], area_total=areas[3],
            move_in_from=(_nearest(movein_anchors, y) if is_new else None),  # type: ignore[arg-type]
            page=page,
        ))
    return [l for l in out if l.complex_name], nxt


NAME_MAX = 30              # 단지명 조각 길이 상한. 각주 문장이 이름 칸으로 새는 걸 막는다
PROSE_RE = re.compile(r"니다|습니|하여|바랍|경우|따라")


def _looks_like_name(text: str) -> bool:
    return len(text) <= NAME_MAX and not PROSE_RE.search(text)


def _mul(v: int | None, k: int) -> int | None:
    return None if v is None else v * k


def _movein(text: str) -> str | None:
    """입주시작(예정) 칸. 「’27.5」의 따옴표와 마침표는 baseline이 달라 다른 줄로 빠지고 숫자만 남는다 → "275" → ’27.5"""
    m = MOVEIN_DIGITS.search(text.replace(" ", ""))
    if not m:
        return None
    d = m.group(0)
    return f"’{d[:2]}.{d[2:]}"


def _klass(text: str) -> tuple[str | None, str | None]:
    t = text.replace(" ", "")
    if not t:
        return None, None
    for pat, label in KLASS_RULES:
        if pat.search(t):
            inc = INCOME_RE.search(t)
            return label, (inc.group(0).replace(" ", "") if inc and label == "청년" else None)
    return None, None


def _name_blocks(frags: list[tuple[float, str]], names_hint: list[str], start: int = 0) -> tuple[list[tuple[float, str]], int]:
    """이름 조각을 순서대로 이어 붙여 (블록 중심 y, 단지명) 목록으로. 돌려주는 두 번째 값은 다음 쪽에서 이어 볼 힌트 위치.

    「단지별 주소」 표의 이름 목록(names_hint)과 순서가 같다는 성질을 쓴다 — 정규화한 누적값이
    기대 이름과 같아지면 블록을 닫는다. 표가 여러 쪽에 걸쳐 있어 위치(start)를 쪽 사이로 넘긴다.
    """
    if not names_hint:
        return list(frags), start
    out: list[tuple[float, str]] = []
    idx = start
    buf = ""
    ys: list[float] = []
    for y, t in frags:
        buf += t
        ys.append(y)
        got = _norm(buf)
        if not got:
            buf, ys = "", []
            continue
        # 힌트 목록에서 앞으로 몇 칸만 내다본다. 표에 없는 단지가 섞여도 목록이 통째로 밀리지 않게
        hit = next((j for j in range(idx, min(idx + LOOKAHEAD, len(names_hint)))
                    if _matches(got, _norm(names_hint[j]))), None)
        if hit is not None:
            out.append((sum(ys) / len(ys), names_hint[hit]))
            idx = hit + 1
            buf, ys = "", []
            continue
        if any(_norm(names_hint[j]).startswith(got) for j in range(idx, min(idx + LOOKAHEAD, len(names_hint)))):
            continue   # 아직 조각이 모자란다 — 다음 조각을 더 붙인다
        # 힌트에 없는 이름. 그대로 한 블록으로 세워 순서를 지킨다
        if len(got) >= 3:
            out.append((sum(ys) / len(ys), buf.strip()))
        buf, ys = "", []
    return out, idx


LOOKAHEAD = 6   # 「단지별 주소」 표 이름 목록에서 내다볼 칸 수. 표에 안 나오는 단지가 있어도 목록이 밀리지 않게


def _matches(got: str, want: str) -> bool:
    if not want or not got:
        return False
    return got == want or (len(want) >= 4 and (got.endswith(want) or want.endswith(got) and len(got) >= 6))


def parse_supply_lines(pages: list[tuple[int, str]], names_hint: list[str]) -> list[SupplyLine]:
    """표가 여러 쪽에 걸쳐 있어 단지명 힌트 위치를 쪽 사이로 넘긴다(쪽마다 처음부터 찾으면 앞 이름에 다시 걸린다)."""
    out: list[SupplyLine] = []
    idx = 0
    for page, xml in sorted(pages):
        try:
            lines, idx = parse_supply_page(xml, page, names_hint, idx)
        except Exception:  # noqa: BLE001 — 한 쪽이 깨져도 나머지는 살린다
            continue
        out.extend(lines)
    return out
