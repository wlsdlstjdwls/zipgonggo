"""SH 매입임대 「공급주택목록」 별도 첨부 파서 — 공고문과 따로 붙는 호실 목록 PDF.

공고문 본문에는 주소가 없고(「공지사항에 별도 첨부된 주택목록을 반드시 참고」) 이 첨부에만 있다.
이걸 안 읽어 신혼·신생아 매입임대 공고가 지도도 단지도 없이 공고일과 발표일만 남았다(사용자 지적 2026-10-12).

양식 둘(실측 2026-10-12, 둘 다 정방향 표, 머리글은 첫 쪽에만):
- 신혼·신생아Ⅰ·Ⅱ 2026 하반기(310650·310653) 「주택목록(상세)」:
  연번 | 구 | 대표단지명 | 주택형 | 지번주소 | 도로명 주소(+동 호) | 호 | 전용면적 | 방개수 | 유형 | 신규/재공급
  | 소득50% 이하 보증금·임대료 | 소득70% 이하 보증금·임대료 | 지하철역 … 연락처
- 청년 매입임대 2026-1차(306214) 「주택목록」:
  연번 | 구분 | 자치구 | 호 | 주택명 | 소재지 주소(지번 괄호) | 주택형 | 주택구조 | 성별 | 전용면적
  | 1순위 청년 · 1순위 대학생 · 2~3순위 청년 · 2~3순위 대학생 보증금·임대료

칸은 내용이 아니라 머리글의 x 위치로 가른다 — 두 양식의 칸 순서가 다르고, 쪽마다 위치는 같다.
금액은 계층이 여럿이라 전부 싣는다(price_tiers). 하나만 고르면 다른 계층 신청자에게 틀린 금액이 된다.
Synap이 쉼표·소수점을 다음 줄로 흘리는 줄이 반씩 섞인다(「4575」 = 45.75㎡) — 면적은 자리수로 복원한다.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from statistics import median
from typing import Any

from ..sources.ish import Segment, group_rows, parse_chars, row_segments
from .sh_location import SEOUL_GU, ROAD_RE as LOC_ROAD_RE

_re_gu = re.compile(rf"^(?:{SEOUL_GU})")

log = logging.getLogger(__name__)

# 머리글(공백 뗀 원문) → 필드. 여기 없는 머리글도 칸으로는 세운다 — 그래야 옆 칸 값이 엉뚱한 필드로 안 샌다
HEADER_FIELDS = {
    "연번": "seq",
    "구": "gu", "자치구": "gu",
    "대표단지명": "name", "주택명": "name", "단지명": "name",
    "주택형": "type",
    "지번주소": "jibun",
    "도로명주소": "addr", "소재지주소": "addr",
    "호": "ho",
    "전용면적": "area", "전용면적(㎡)": "area",
    "방개수": "rooms",
    "주택구조": "layout",
    "신규/재공급": "new", "구분": "new",
    "승강기": "elevator",
    # 미리내집 주택목록(299476)·공고문 본문 목록(293061): 「지역구 | 주택형 | 주택명(주택단지) | 주소 | 동 | 호 | 방개수 | 면적」
    "지역구": "gu", "주택단지": "name", "주소": "addr", "동": "dong_col", "개수": "rooms", "면적": "area",
}
DEPOSIT_HEADS = {"임대보증금(원)", "임대보증금", "보증금"}
RENT_HEADS = {"임대료(원)", "임대료", "월임대료"}

SEQ_RE = re.compile(r"^\d{1,4}$")
HO_RE = re.compile(r"^\d{3,4}$")
MONEY_RE = re.compile(r"^\d[\d,]*$")
AREA_RE = re.compile(r"^(\d{2,6})(?:\.(\d{1,4}))?$")
SIDO_RE = re.compile(r"^(서울특별시|서울시|경기도|인천광역시)\s*")
ROAD_RE = re.compile(r"^(.+(?:로|길)\s*\d+(?:-\d+)?)(.*)$")
# 공백 없는 꼬리 끝의 동·호: 「…제101동302호」·「…가동501호」·「…B동」
FLAT_DONG_RE = re.compile(r"제?((?:\d{1,3}|[A-Za-z]|에이|비|씨|디|[가나다라마바사])동)(?:\d{1,4}호)?$")
DONG_HO_RE = re.compile(r"(?:^|\s)([가-힣A-Za-z0-9]+동)\s*(?:제?\d+호)?\s*$")
ROOMS = {"1": "원룸", "2": "투룸", "3": "쓰리룸"}
MERGE_PX = 30     # 두 머리글 중심이 이만큼 안이면 한 칸(「전용면적」 / 「(㎡)」 두 줄)
COLUMN_MAX_CH = 10  # 이보다 긴 머리글 조각은 칸 이름이 아니라 주석이다
# 금액 검산 — Synap이 숫자를 흘리면 자릿수가 하나 빠져 값이 10배쯤 어긋난다. 같은 계층의 중앙값에서
# 이 배수 넘게 벗어나면 버린다(실측 폭: 청년 1순위 임대료 11만~85만, 중앙값의 0.4~2.8배).
# 보증금/임대료 비율로 보면 안 된다 — 대학생 계층은 보증금이 100만 원 고정이라 비율이 호실마다 다르다
MONEY_FACTOR = 5


@dataclass
class _Col:
    center: float
    field: str | None
    head: str


@dataclass
class HouseList:
    """주택목록 한 벌 → notice_complex 행, unit 행, 공고 단위 요약."""

    complexes: list[dict[str, Any]] = field(default_factory=list)
    units: list[dict[str, Any]] = field(default_factory=list)
    totals: dict[str, int | None] = field(default_factory=dict)
    tiers: list[str] = field(default_factory=list)
    dropped: int = 0


def _flat(s: str) -> str:
    return re.sub(r"\s+", "", s)


def _mid(s: Segment) -> float:
    return (s.l + s.r) / 2


def _field(t: str) -> str | None:
    """머리글 → 필드. 장기미임대 목록은 주소 머리글이 「서울특별시 소재지주소(지번주소)」처럼 길다(301759)."""
    if t in HEADER_FIELDS:
        return HEADER_FIELDS[t]
    if "소재지주소" in t or "도로명" in t:
        return "addr"
    if t.startswith(("전용면적", "면적(")):
        return "area"
    return None


# 「시세의 60%」 / 「시세의 70%」처럼 표가 구간별로 되풀이되는 목록(미리내집). 구간이 곧 신청 계층이다
SECTION_RE = re.compile(r"시세의\s*\d+\s*%")


@dataclass
class _Pair:
    label: str
    conversion: bool   # 「전세형 상호전환 상한선」 — 계층이 아니라 같은 신청자의 전환 금액이다. 싣지 않는다
    scale: int         # 보증금 단위(「(만원)」이면 10000)


_re_punct = re.compile(r"[.,\s()]+")


def _numeric(s: Segment) -> bool:
    return bool(re.fullmatch(r"[\d.,~\s-]+", s.text))


def _header(rows: list[list[Segment]]) -> tuple[list[_Col], list[_Pair], int] | None:
    """주소 머리글이 있는 쪽의 머리글 블록 → (칸들, 금액 짝들, 첫 자료 줄 번호).

    「연번」은 없을 수도 있고(299476) 「연 / 번」 두 줄로 쪼개질 수도 있다(293061) — 주소 머리글로 찾는다."""
    head_i = next((i for i, r in enumerate(rows)
                   if any(_field(_flat(s.text)) == "addr" and len(_flat(s.text)) <= 20 for s in r)), None)
    if head_i is None:
        return None
    # 첫 자료 줄: 칸이 다섯 개 이상이고 숫자 칸이 셋 이상(호·면적·금액)
    data_i = next((i for i in range(head_i + 1, min(len(rows), head_i + 12))
                   if len(rows[i]) >= 5 and sum(_numeric(x) for x in rows[i]) >= 3), None)
    if data_i is None:
        return None
    # 머리글 블록: 주소 줄 위로 여덟 줄(신혼Ⅰ은 계층 이름 첫 줄이 여섯 줄 위), 아래로 첫 자료 줄 전까지
    block = rows[max(0, head_i - 8):data_i]
    block = [r for r in block if not SECTION_RE.search(" ".join(x.text for x in r))]
    money = sorted((x for r in block for x in r if _flat(x.text) in DEPOSIT_HEADS | RENT_HEADS), key=lambda x: x.l)
    pairs: list[tuple[Segment, Segment]] = []
    for a, b in zip(money, money[1:]):
        if _flat(a.text) in DEPOSIT_HEADS and _flat(b.text) in RENT_HEADS:
            pairs.append((a, b))
    # 금액 칸이 없는 목록(장기미임대 301759)도 받는다 — 호실 행은 못 만들어도 단지와 지도는 만든다
    lo, hi = (money[0].l - 20, money[-1].r + 20) if pairs else (float("inf"), float("-inf"))

    cols: list[_Col] = []
    for r in block:
        for x in r:
            t = _flat(x.text)
            if t in DEPOSIT_HEADS or t in RENT_HEADS:
                continue
            if lo <= _mid(x) <= hi:
                continue  # 금액 칸 위의 계층 이름 — 칸이 아니다
            if len(t) > COLUMN_MAX_CH and _field(t) is None:
                continue
            cols.append(_Col(_mid(x), _field(t), t))
    merged: list[_Col] = []
    for c in sorted(cols, key=lambda c: c.center):
        if merged and c.center - merged[-1].center <= MERGE_PX:
            if merged[-1].field is None and c.field is not None:
                merged[-1] = c
            continue
        merged.append(c)
    for i, (a, b) in enumerate(pairs):
        merged.append(_Col(_mid(a), f"dep{i}", a.text))
        merged.append(_Col(_mid(b), f"rent{i}", b.text))

    # 계층 이름: 금액 영역 안의 머리글 조각을 줄마다 가장 가까운 짝에 붙인다(위 줄부터 이어 쓴다)
    names: list[list[str]] = [[] for _ in pairs]
    centers = [(_mid(a) + _mid(b)) / 2 for a, b in pairs]
    manwon = [x for r in block for x in r if "만원" in x.text]
    for r in block:
        cands = [x for x in r if lo <= _mid(x) <= hi and _flat(x.text) not in DEPOSIT_HEADS | RENT_HEADS
                 and "보증금" not in x.text and "만원" not in x.text and not re.fullmatch(r"\(?원\)?", _flat(x.text))]
        if not cands:
            continue
        for k, c in enumerate(centers):
            best = min(cands, key=lambda x: abs(_mid(x) - c))
            names[k].append(best.text.strip())
    # 「전세형 상호전환 상한선」은 그 짝의 칸 범위 위에 있을 때만 그 짝의 것이다 — 이름 붙이기는 가장 가까운 조각을
    # 짝마다 고르므로 옆 짝(기본형)에도 같은 말이 붙는다(299476)
    conv_segs = [x for r in block for x in r if "전환" in _flat(x.text)]
    out_pairs = []
    for k, (a, b) in enumerate(pairs):
        label = re.sub(r"\s*,\s*", " ", " ".join(names[k])).strip()
        conversion = any(x.l < b.r and x.r > a.l for x in conv_segs)
        # 「(만원)」 표기가 이 짝의 보증금 칸 가까이에 있으면 만 원 단위다(293061·308644 본문 목록)
        scale = 10000 if any(abs(_mid(m) - _mid(a)) < abs(_mid(m) - _mid(b)) and abs(_mid(m) - _mid(a)) < 60
                             for m in manwon) else 1
        out_pairs.append(_Pair(label, conversion, scale))
    if not any(c.field == "addr" for c in merged) or not any(c.field == "ho" for c in merged):
        return None
    return merged, out_pairs, data_i


# 글자 칸은 한 칸이 조각 둘로 올 수 있다(304699 「서울특별시 서초구 논현로5길 23-7」 / 「(양재동 400-11)」) — 이어 붙인다
JOIN_FIELDS = {"addr", "name", "jibun"}


def _assign(row: list[Segment], cols: list[_Col]) -> dict[str, str]:
    """자료 줄의 칸을 가장 가까운 머리글에 붙인다. 한 머리글에 둘이 오면 숫자 칸은 더 가까운 쪽만, 글자 칸은 이어 붙인다."""
    best: dict[int, tuple[float, Segment]] = {}
    joined: dict[int, list[Segment]] = {}
    for s in row:
        m = _mid(s)
        k = min(range(len(cols)), key=lambda i: abs(cols[i].center - m))
        d = abs(cols[k].center - m)
        joined.setdefault(k, []).append(s)
        if k not in best or d < best[k][0]:
            best[k] = (d, s)
    out = {}
    for k, (_, s) in best.items():
        f = cols[k].field
        if not f:
            continue
        out[f] = " ".join(x.text for x in sorted(joined[k], key=lambda x: x.l)) if f in JOIN_FIELDS else s.text
    return out


def _area(v: str | None) -> float | None:
    if not v:
        return None
    m = AREA_RE.match(v.replace(" ", ""))
    if not m:
        return None
    if m.group(2):
        return round(float(f"{m.group(1)}.{m.group(2)}"), 2)
    # 소수점 유실. 매입임대 전용면적은 10~99㎡라 정수부를 두 자리로 본다(sh_units와 같은 규칙)
    # (4575 → 45.75, 55165 → 55.165, 548339 → 54.8339 — 소수 셋째·넷째 자리까지 적힌 호실이 있다)
    n = m.group(1)
    return round(int(n) / 10 ** max(0, len(n) - 2), 2)


def _money(v: str | None) -> int | None:
    if not v or not MONEY_RE.match(v.replace(" ", "")):
        return None
    return int(re.sub(r"\D", "", v))


def _addr(addr: str, gu: str | None) -> tuple[str, str, str, str | None, str | None, str]:
    """주소 칸 → (시도, 시군구, 도로명주소(시군구부터, 서울 밖은 시도부터), 동, 괄호 속 지번, 번지 뒤 건물명).

    건물명은 이름 칸이 없는 목록(장기미임대 301759 「강남구 논현로12길 3-8 동영빌 (개포동 1195-10)」)에서 이름으로 쓴다."""
    t = re.sub(r"\s+", " ", addr).strip()
    sido = "서울특별시"
    m = SIDO_RE.match(t)
    if m:
        sido = {"서울시": "서울특별시"}.get(m.group(1), m.group(1))
        t = t[m.end():]
    head, _, rest = t.partition("(")
    paren, _, tail = rest.partition(")")
    # 띄어쓰기 없는 표기(「강북구삼양로173가길18」·「광진구면목로192다베로102」)는 공백을 지운 글자에서 도로명과 번지를 끊는다
    fh = _flat(head)
    if gu and not fh.startswith(gu) and not _re_gu.match(fh):
        fh = gu + fh
    lm = LOC_ROAD_RE.search(fh) if sido == "서울특별시" else None
    if lm and lm.start() <= 2:
        no, end = lm.group("no"), lm.end()
        # 원문에 공백이 있으면 그 공백이 번지의 끝이다 — 「장월로1마길 23 101동」을 지운 채 읽으면 번지가 「23101」이 된다(304699)
        tokens = re.findall(r"\d+(?:-\d+)?", head)
        if no not in tokens:
            cut = next((t for t in tokens if no.startswith(t) and len(t) < len(no)), None)
            if cut:
                end -= len(no) - len(cut)
                no = cut
        road = f"{lm.group('gu')} {lm.group('road')} {no}"
        # 건물명은 원문 공백을 살려 뗀다(「다드림 10차」가 「다드림10차」가 되면 이전 적재와 다른 단지가 된다)
        bm = re.search(rf"(?<![\d-]){re.escape(no)}(?![\d-])\s*(.*)$", head)
        building = bm.group(1).strip() if bm else fh[end:]
        dm = FLAT_DONG_RE.search(_flat(f"{building}{tail}"))
        dong = dm.group(1) if dm else None
        jm = re.match(r"^([가-힣0-9]+(?:동|가|리))\s*(\d+(?:-\d+)?)$", paren.strip())
        jibun = f"{lm.group('gu')} {jm.group(1)} {jm.group(2)}" if jm else None
        if dm and dm.start() <= len(building):
            building = building[: dm.start()]
        return sido, lm.group("gu"), road, dong, jibun, building
    # 괄호 없이 건물명과 동호가 이어지는 주소(「경인로15나길 65-4 궁동에스하임 제101동 302호」)는 번지에서 끊는다
    rm = ROAD_RE.match(head.strip())
    building = ""
    if rm and rm.group(2).strip():
        head, tail = rm.group(1), f"{rm.group(2)} {tail}"
        building = rm.group(2).strip()
    road = re.sub(r"\s*-\s*", "-", head.strip().rstrip(","))
    first = road.split(" ", 1)[0]
    if not re.search(r"(구|시|군)$", first) and gu:
        road = f"{gu} {road}"
        first = gu
    sigungu = first
    if sido != "서울특별시":
        road = f"{sido} {road}"
    dm = DONG_HO_RE.search(tail.strip())
    dong = re.sub(r"^제", "", dm.group(1)) if dm else None
    # 괄호 안 「(성내동 404-10)」은 지번, 「(성내동, 서도휴빌)」은 건물명이다
    jm = re.match(r"^([가-힣0-9]+(?:동|가|리))\s*(\d+(?:-\d+)?)$", paren.strip())
    jibun = f"{sigungu} {jm.group(1)} {jm.group(2)}" if jm else None
    return sido, sigungu, road, dong, jibun, building


# 건축물대장 기본 건물명(「주건축물제1동」)과 「제B동」은 이름이 아니라 동이다
DONG = r"(?:주건축물제?|제)?(?:\d+|[A-Za-z]|[가나다라마바사]|에이|비|씨|디)동"
DONG_ONLY_RE = re.compile(rf"^\(?({DONG})\)?$")
NAME_DONG_RE = re.compile(rf"^(?P<name>.+?)(?:\s+\(?|\(|(?<=[^\d\s])(?=\d{{2,3}}동\)?$))(?P<dong>{DONG})\)?$")


# 같은 동을 주소는 「에이동/비동」, 이름은 「A동/B동」으로 적는다(포엠빌 중화동, 2026-10-12) — 영문으로 맞춘다
LETTER_DONG = {"에이": "A", "비": "B", "씨": "C", "디": "D"}


def _dong(v: str) -> str:
    v = re.sub(r"^(?:주건축물제?|제)", "", v)
    return LETTER_DONG.get(v[:-1], v[:-1]) + "동"


def _name_dong(name: str, dong: str | None, road: str) -> tuple[str, str | None]:
    """대표단지명과 동을 가른다. 이름 끝에 붙은 동(「아트라움 101동」·「고척랜드플러스 (101동)」·「천호에스하임3 가동」)은
    동으로 옮겨 한 건물의 동들을 한 단지로 묶는다. 이름이 없거나(「-」) 동뿐이면(「주건축물제1동」·「B동」)
    도로명(시군구 뗀 것)을 이름으로 쓴다 — 지어낸 이름보다 낫다."""
    if dong:
        dong = _dong(dong)
    n = re.sub(r"\s+", " ", name).strip()
    m = NAME_DONG_RE.match(n)
    only = DONG_ONLY_RE.match(n)
    if m and m.group("name").strip(" -"):
        nd = _dong(m.group("dong"))
        if dong is None or dong == nd:
            n, dong = m.group("name").strip(), nd
    elif only:
        dong = dong or _dong(only.group(1))
        n = ""
    if not n.strip("- ") or n in ("명칭없음", "미정"):
        n = road.split(" ", 1)[1] if " " in road else road
    return n, dong


def _floor(ho: str) -> int | None:
    m = re.match(r"^(\d{1,2})\d{2}$", ho)
    n = int(m.group(1)) if m else 0
    return n if 1 <= n <= 99 else None


def _disambiguate(parsed: list[dict[str, Any]]) -> None:
    """같은 이름의 다른 건물(「삼화에코빌」 송파·동대문·양천)에 구를, 같은 구면 도로명을 붙인다.
    단지 URL이 /notice/{공고}/{단지명}이라 이름이 겹치면 둘째 단지로 들어갈 길이 없다(2026-10-12)."""
    by_name: dict[str, set[str]] = {}
    for p in parsed:
        by_name.setdefault(p["name"], set()).add(p["road"])
    fix: dict[tuple[str, str], str] = {}
    for name, rs in by_name.items():
        for r in rs:
            if "-" in r:
                fix[(name, r.replace("-", ""))] = r
    for p in parsed:
        p["road"] = fix.get((p["name"], p["road"]), p["road"])
    roads: dict[str, set[str]] = {}
    for p in parsed:
        roads.setdefault(p["name"], set()).add(p["road"])
    for p in parsed:
        rs = roads[p["name"]]
        if len(rs) < 2:
            continue
        gus = [r.split(" ", 1)[0] for r in rs]
        tag = p["sigungu"] if gus.count(p["sigungu"]) == 1 else p["road"].split(" ", 1)[-1]
        p["name"] = f"{p['name']} ({tag})"


def parse_house_list(pages: list[tuple[int, str]]) -> HouseList | None:
    """주택목록 쪽들 → HouseList. 머리글을 못 찾으면 None(이 양식이 아니다).

    같은 호실이 구간(시세의 60% / 70%)마다 한 번씩 나오면 한 호실로 합치고 구간을 계층으로 싣는다.
    연번은 구간마다 1부터 다시 시작한다(293061) — 연번으로 중복을 거르면 둘째 구간이 통째로 사라진다."""
    cols: list[_Col] | None = None
    pairs: list[_Pair] = []
    raw: list[tuple[int, str | None, dict[str, str]]] = []
    section: str | None = None
    for page, xml in pages:
        rows = [row_segments(r) for r in group_rows(parse_chars(xml))]
        h = _header(rows)
        if h is not None:
            cols, pairs, _ = h
        if cols is None:
            # 머리글보다 앞 쪽의 구간 제목도 놓치지 않는다
            for r in rows:
                sm = SECTION_RE.search(" ".join(x.text for x in r))
                if sm:
                    section = sm.group(0).replace(" ", "")
            continue
        pending: str | None = None   # 주택단지 이름이 자료 줄 윗줄에 따로 오는 목록(293061 「북한산 에버아트」)
        for ri, r in enumerate(rows):
            text = " ".join(x.text for x in r)
            sm = SECTION_RE.search(text)
            if sm and len(r) <= 3:
                section = sm.group(0).replace(" ", "")
                continue
            r = [x for x in r if not _re_punct.fullmatch(x.text)]
            if not r:
                continue
            nxt = [x for x in rows[ri + 1] if not _re_punct.fullmatch(x.text)] if ri + 1 < len(rows) else []
            if nxt and all(_numeric(x) for x in nxt) and len(nxt) >= 2 and any(HO_RE.match(_flat(x.text)) for x in r):
                r = r + nxt
            v = _assign(r, cols)
            if v.get("addr") and v.get("ho") and HO_RE.match(_flat(v["ho"])) and re.search(r"(?:로|길)\s*\d", v["addr"]):
                if not v.get("name") and pending:
                    v["name"] = pending
                raw.append((page, section, v))
                pending = None
            elif v.get("name") and not v["name"].lstrip().startswith("(") and not _numeric(r[0]):
                pending = v["name"]
    if cols is None or not raw:
        return None
    return _build(raw, pairs)


def parse_house_xlsx(data: bytes) -> HouseList | None:
    """엑셀 주택목록(청년 매입임대 290219 「[주택목록] … .xlsx」) → HouseList. PDF와 칸 구성이 같아 뒷부분(_build)을 같이 쓴다.

    머리글은 여러 줄이다: 「연번 | … | 소재지 주소 | … | 보증금 및 임대료(원)」 / 「1순위(시세 30% 적용)」 / 「청년」 / 「보증금 | 임대료」.
    병합 칸은 첫 칸에만 값이 있어 계층 이름 줄은 오른쪽으로 채워 읽는다."""
    import io

    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    ws = wb.worksheets[0]
    grid = [["" if v is None else str(v).strip() for v in row] for row in ws.iter_rows(values_only=True)]
    head_i = next((i for i, r in enumerate(grid) if any(_field(_flat(c)) == "addr" for c in r)), None)
    if head_i is None:
        return None
    fields: dict[int, str] = {}
    for j, c in enumerate(grid[head_i]):
        f = _field(_flat(c))
        if f:
            fields[j] = f
    money_i = next((i for i in range(head_i, min(len(grid), head_i + 6))
                    if any(_flat(c) in DEPOSIT_HEADS for c in grid[i])), None)
    pairs: list[_Pair] = []
    if money_i is not None:
        filled = []
        for i in range(head_i + 1, money_i):
            row, last = [], ""
            for c in grid[i]:
                last = c or last
                row.append(last)
            filled.append(row)
        heads = grid[money_i]
        for j, c in enumerate(heads):
            if _flat(c) in DEPOSIT_HEADS and j + 1 < len(heads) and _flat(heads[j + 1]) in RENT_HEADS:
                label = " ".join(r[j] for r in filled if j < len(r) and r[j]).strip()
                k = len(pairs)
                fields[j], fields[j + 1] = f"dep{k}", f"rent{k}"
                pairs.append(_Pair(label, "전환" in _flat(label), 1))
    raw: list[tuple[int, str | None, dict[str, str]]] = []
    for i in range((money_i or head_i) + 1, len(grid)):
        v = {f: grid[i][j] for j, f in fields.items() if j < len(grid[i]) and grid[i][j]}
        if v.get("addr") and v.get("ho") and HO_RE.match(_flat(v["ho"])):
            raw.append((1, None, v))
    return _build(raw, pairs) if raw else None


def _build(raw: list[tuple[int, str | None, dict[str, str]]], pairs: list["_Pair"]) -> HouseList:
    real = [k for k, pr in enumerate(pairs) if not pr.conversion]

    def tier_label(sec: str | None, k: int) -> str:
        own = pairs[k].label
        parts = ([sec] if sec else []) + ([own] if own and (len(real) > 1 or not sec) else [])
        return " ".join(parts) or f"계층{k + 1}"

    # 한 호실 = (단지, 도로명, 동, 호). 구간마다 다시 나오면 금액만 보탠다
    tiers: list[str] = []
    units: dict[tuple, dict[str, Any]] = {}
    order = 0
    # 하이픈이 빠진 번지(299476 융성그린빌 「17-9」 / 「179」가 줄마다 섞인다)는 호실을 합치기 전에 맞춘다 —
    # 합친 뒤에 고치면 같은 호가 두 번 센다
    addrs = [_addr(v["addr"], v.get("gu")) for _, _, v in raw]
    hyphen = {(a[2].replace("-", "")): a[2] for a in addrs if "-" in a[2].rsplit(" ", 1)[-1]}
    for (page, sec, v), a in zip(raw, addrs):
        sido, sigungu, road, dong, jibun, building = a
        road = hyphen.get(road, road)
        dcol = _flat(v.get("dong_col") or "")
        # 동 칸: 「102」·「A동」·「101동」(308644 새울센스빌 A동/B동 — 빠뜨리면 두 동의 0201호가 한 호실로 합쳐진다)
        if dcol and not dong:
            if re.fullmatch(r"\d{1,3}", dcol):
                dong = f"{dcol}동"
            elif re.fullmatch(r"(?:\d{1,3}|[A-Za-z]|[가-힣]{1,2})동", dcol):
                dong = dcol
        name, dong = _name_dong(v.get("name") or building, dong, road)
        raw_ho = _flat(v["ho"])
        ho = raw_ho.zfill(4)
        key = (name, road, dong, ho)
        p = units.get(key)
        if p is None:
            order += 1
            layout = v.get("layout")
            if not layout and _flat(v.get("rooms") or "") in ROOMS:
                layout = ROOMS[_flat(v["rooms"])]
            elev = v.get("elevator")
            p = units[key] = {
                "seq": int(v["seq"]) if v.get("seq") and SEQ_RE.match(v["seq"]) else order, "page": page,
                "name": name, "sido": sido, "sigungu": sigungu, "road": road, "dong": dong,
                "jibun": jibun or (v.get("jibun") or None), "ho": ho, "area": _area(v.get("area")),
                "prices": {}, "layout": re.sub(r"\s+", "", layout) if layout else None,
                "elevator": {"O": "설치", "X": "미설치"}.get((elev or "").strip().upper()),
                "is_new": "신규" in (v.get("new") or ""),
                "short_ho": len(raw_ho) == 3,
            }
        for k in real:
            label = tier_label(sec, k)
            if label not in tiers:
                tiers.append(label)
            d, r = _money(v.get(f"dep{k}")), _money(v.get(f"rent{k}"))
            p["prices"].setdefault(label, (d * pairs[k].scale if d is not None else None, r))
    parsed = list(units.values())
    for p in parsed:
        p["prices"] = [p["prices"].get(t, (None, None)) for t in tiers]

    out = HouseList(tiers=tiers)

    # 계층마다 보증금과 임대료를 따로 중앙값에 대 자릿수 유실을 걸러낸다
    mids = []
    for k in range(len(tiers)):
        ds = [p["prices"][k][0] for p in parsed if p["prices"][k][0]]
        rs = [p["prices"][k][1] for p in parsed if p["prices"][k][1]]
        mids.append((median(ds) if ds else None, median(rs) if rs else None))

    def near(v: int | None, mid: float | None) -> bool:
        return bool(v and mid and mid / MONEY_FACTOR <= v <= mid * MONEY_FACTOR)

    for p in parsed:
        for k, (d, r) in enumerate(p["prices"]):
            ok = near(d, mids[k][0]) and near(r, mids[k][1])
            if not ok and (d or r):
                log.warning("주택목록 %s %s호 계층 %s 금액 검산 실패(%s / %s) — 비운다", p["name"], p["ho"], tiers[k], d, r)
            if not ok:
                p["prices"][k] = (None, None)

    # 4자리 호(「0201」)로 적힌 단지에 3자리 호가 섞이면 Synap이 겹친 숫자를 흘린 것이다(299476 「1102」→「102」).
    # 「1001」도 「101」이 되므로 되살릴 수 없다 — 틀린 호수를 보이느니 그 호실 행은 만들지 않는다(단지 호수에는 센다)
    four = {}
    for p in parsed:
        if not p.get("short_ho"):
            four[(p["name"], p["road"])] = four.get((p["name"], p["road"]), 0) + 1
    for p in parsed:
        p["lossy_ho"] = bool(p.get("short_ho")) and four.get((p["name"], p["road"]), 0) >= 3
    _disambiguate(parsed)
    keys: dict[str, int] = {}
    for p in parsed:
        base = next((t for t in p["prices"] if t[0] is not None and t[1] is not None), (None, None))
        if p["lossy_ho"]:
            out.dropped += 1
            log.warning("주택목록 %s %s호: 호수 숫자가 빠진 줄로 보여 호실 행을 만들지 않는다", p["name"], p["ho"])
            continue
        if p["area"] is None or base[0] is None:
            # 금액 칸이 없는 목록(장기미임대)은 원래 호실 행을 못 만든다 — 그때는 조용히 단지만 낸다
            if tiers:
                out.dropped += 1
                log.warning("주택목록 연번 %d: 면적이나 첫 계층 금액이 비어 호실 행을 만들지 않는다", p["seq"])
            continue
        key = "-".join(_flat(x) for x in (p["name"], p["dong"], p["ho"]) if x)
        keys[key] = keys.get(key, 0) + 1
        out.units.append({
            "complex_code": None,
            "nc_name": p["name"],
            "nc_road": p["road"],
            "unit_key": key,
            "road_address": p["road"],
            "complex_name": p["name"],
            "building": p["dong"],
            "room": p["ho"],
            "floor": _floor(p["ho"]),
            "sido": p["sido"],
            "sigungu": p["sigungu"],
            "area_m2": p["area"],
            "deposit": base[0],
            "rent": base[1],
            "deposit_jeonse": None, "rent_jeonse": None, "deposit_wolse": None, "rent_wolse": None,
            "price_tiers": [{"label": t, "deposit": d, "rent": r} for t, (d, r) in zip(tiers, p["prices"])],
            "room_layout": p["layout"],
            "elevator": p["elevator"],
            "has_elevator": None if p["elevator"] is None else p["elevator"] != "미설치",
            "seq": p["seq"],
            "source_page": p["page"],
        })
    # 같은 단지·동·호가 두 번 나오는 줄(동 표기 없는 다세대)은 연번을 붙여 둘 다 살린다
    for u in out.units:
        if keys[u["unit_key"]] > 1:
            u["unit_key"] = f"{u['unit_key']}-{u['seq']}"

    # 단지는 호실 행이 못 선 줄까지 포함해 목록 전체에서 낸다 — 호수와 면적은 목록에 적힌 그대로
    def low(a, b):
        return min(x for x in (a, b) if x is not None) if a is not None or b is not None else None

    def high(a, b):
        return max(x for x in (a, b) if x is not None) if a is not None or b is not None else None

    by: dict[tuple[str, str], dict[str, Any]] = {}
    for p in parsed:
        k = (p["name"], p["road"])
        c = by.get(k)
        if c is None:
            c = by[k] = {"name": k[0], "sido": p["sido"], "sigungu": p["sigungu"], "road_address": k[1],
                         "is_new": False, "source_page": p["page"], "complex_code": None, "heating": None,
                         "unit_count": 0, "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}
        base = next((t for t in p["prices"] if t[0] is not None and t[1] is not None), (None, None))
        c["unit_count"] += 1
        c["is_new"] = c["is_new"] or p["is_new"]
        c["min_deposit"] = low(c["min_deposit"], base[0])
        c["min_rent"] = low(c["min_rent"], base[1])
        c["area_min"] = low(c["area_min"], p["area"])
        c["area_max"] = high(c["area_max"], p["area"])
    out.complexes = list(by.values())

    deps = [t["deposit"] for u in out.units for t in u["price_tiers"] if t["deposit"]]
    rents = [t["rent"] for u in out.units for t in u["price_tiers"] if t["rent"]]
    out.totals = {
        "min_deposit": min(deps, default=None), "max_deposit": max(deps, default=None),
        "min_rent": min(rents, default=None), "max_rent": max(rents, default=None),
        "supply_count": len(parsed) or None,
    }
    return out
