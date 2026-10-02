"""LH 공고 첨부 「공급주택목록」(xlsx) → 호실 행.

LH 매입임대(청년·신혼신생아·다자녀·일반)와 든든전세는 공고문에 주택 주소가 없고 별첨 엑셀에만 있다.
마이홈 API는 시군구까지만 준다 — 이 표가 지도와 단지 지면의 유일한 재료다.
수집 허용은 2026-09-08 서울시 협의 때 같이 받았다(docs/data-sources.md 6절).

**양식이 지역본부마다 다르다.** 2026-10-02 실측 65개 파일에서 머리행만 40가지 가까이 나왔다 —
칸 순서도, 이름도(「주소」/「도로명주소」, 「층수」/「층」, 「지자체명」/「기초지자체」/「명」), 머리행 줄 수도 다르다.
그래서 칸 위치를 외우지 않고 **머리글 이름으로 칸을 찾는다.** 이름은 몇 가지 말로 수렴한다.

- 머리행은 「호」 칸과 「주소」가 든 칸이 같이 있는 첫 줄이다. 위에 제목·안내 문구가 몇 줄 붙는다
- 두 줄 머리(위: 계층 「청년1순위」, 아래: 「기본임대보증금」)는 아래 줄 이름을 쓰고 위 줄을 묶음 이름으로 붙든다
- 금액 묶음이 여럿이면(1순위/2·3순위, 수급자/소득70%) **첫 묶음**이 보증금·임대료다. 계층마다 금액이 다른 건
  공고문이 설명할 몫이고, 여기서는 「이 집은 얼마부터」만 맞으면 된다 — 첫 묶음이 가장 낮은 계층이다
- 든든전세는 월임대료 칸 자체가 없다. 지어내지 않고 None으로 둔다
- 「주차 유의사항」 같은 안내 시트는 머리행이 없어 그냥 건너뛴다(인천 청년 목록, 2026-10-02)
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

import openpyxl

from ..geo.roadaddr import normalize_sido, parse_dong, parse_road_address

HEADER_SCAN_ROWS = 25


@dataclass
class LhUnit:
    sheet: str
    row: int                       # 엑셀 줄 번호(1부터). 원문 대조용
    seq: int | None                # 표의 「순번」. 없으면 None
    address: str                   # 원문 주소 그대로(공백만 정리)
    jibun: str | None
    sido_col: str | None           # 「시도」·「광역지자체」 칸. 주소에 시도가 빠진 양식을 메운다
    sigungu_col: str | None
    group: str | None              # 모집단위(주택군) — 「강동둔촌동(은슬림둔촌)」
    dong: str | None
    ho: str | None
    area: Decimal | None           # 전용면적(㎡)
    area_common: Decimal | None
    rooms: int | None
    floor: int | None
    elevator: str | None           # 원문 표기(Y/N/유/무)
    house_type: str | None         # 다가구주택·도시형생활주택·오피스텔…
    deposit: int | None            # 첫 금액 묶음의 임대보증금(원)
    rent: int | None               # 첫 금액 묶음의 월임대료(원). 든든전세는 칸이 없어 None
    tier: str | None = None        # 첫 금액 묶음의 이름(두 줄 머리일 때만) — 「청년1순위」


@dataclass
class Sheet:
    name: str
    header_row: int
    columns: dict[str, int] = field(default_factory=dict)


def _norm(v) -> str:
    return re.sub(r"\s+", "", str(v)) if v is not None else ""


def _key(name: str) -> str:
    """칸 이름 비교용 — 단위 괄호를 뗀다. 「전용면적(㎡)」→「전용면적」, 「임대보증금(원)」→「임대보증금」."""
    return name.replace("(㎡)", "").replace("(원)", "")


# 같은 뜻의 칸 이름들. 앞에 있는 것이 우선이다 — 「도로명주소」와 「주소」가 둘 다 있으면 도로명을 쓴다
ALIASES: dict[str, tuple[str, ...]] = {
    "address": ("도로명주소", "주소"),
    "jibun": ("지번주소", "지번"),
    "dong": ("동", "동번호"),
    "ho": ("호",),
    "area": ("전용면적", "전용"),
    "area_common": ("주거공용면적", "공용면적", "공용"),
    "rooms": ("방수",),
    "floor": ("층수", "층"),
    "elevator": ("승강기유무", "승강기"),
    "house_type": ("주택유형",),
    "group": ("모집단위(주택군)", "주택군", "주택군이름", "신청지역(주택군이름)", "주택군이름(동(주택)단지)"),
    "sido_col": ("시도", "광역지자체"),
    "sigungu_col": ("시군구", "기초지자체", "지자체명", "지자체"),
    "seq": ("순번",),
}
DEPOSIT_NAMES = ("임대보증금", "기본임대보증금", "보증금")
RENT_NAMES = ("월임대료", "기본월임대료", "임대료")


def _find_header(rows: list[tuple]) -> int | None:
    for i, r in enumerate(rows[:HEADER_SCAN_ROWS]):
        cells = [_norm(x) for x in r]
        if "호" in cells and any("주소" in c for c in cells):
            return i
    return None


def _merge_header(h1: list[str], h2: list[str] | None) -> tuple[list[str], list[str | None]]:
    """(칸 이름, 묶음 이름). 두 줄 머리면 아래 줄이 이름이고, 위 줄의 마지막 값이 묶음이다(병합 칸은 첫 칸에만 값이 있다)."""
    if not h2:
        return h1, [None] * len(h1)
    names, groups, current = [], [], None
    for a, b in zip(h1, h2 + [""] * (len(h1) - len(h2))):
        if a:
            current = a
        names.append(b or a)
        groups.append(current if b else None)
    return names, groups


def _is_subheader(h1: list[str], h2: list[str]) -> bool:
    """머리행 다음 줄이 금액·면적의 아래 칸 이름인가. 데이터 첫 줄과 구별해야 한다 — 데이터에는 숫자가 있다."""
    words = [c for c in h2 if c]
    if not words:
        return False
    hits = sum(1 for c in words if any(k in c for k in ("보증금", "임대료", "전용", "공용", "계약금", "잔금")))
    return hits >= 1 and not any(re.fullmatch(r"[\d.,]+", c) for c in words)


def _map_columns(names: list[str]) -> dict[str, int]:
    keys = [_key(n) for n in names]
    out: dict[str, int] = {}
    for field_name, aliases in ALIASES.items():
        for alias in aliases:
            if alias in keys:
                out[field_name] = keys.index(alias)
                break
    # 금액은 「처음 나오는」 보증금, 그 오른쪽에서 처음 나오는 임대료. 「상한임대보증금」·「최대전환시…」는 이름이 달라 안 걸린다
    dep = next((i for i, k in enumerate(keys) if k in DEPOSIT_NAMES), None)
    if dep is not None:
        out["deposit"] = dep
        nxt_dep = next((i for i, k in enumerate(keys) if i > dep and k in DEPOSIT_NAMES), len(keys))
        rent = next((i for i, k in enumerate(keys) if dep < i < nxt_dep and k in RENT_NAMES), None)
        if rent is not None:
            out["rent"] = rent
    return out


def _text(v) -> str | None:
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def _int(v) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return int(round(v))
    s = re.sub(r"[,\s원]", "", str(v))
    m = re.fullmatch(r"-?\d+(\.\d+)?", s)
    return int(round(float(s))) if m else None


def _dec(v) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v).replace(",", "").strip())
    except InvalidOperation:
        return None
    return d.quantize(Decimal("0.01")) if d > 0 else None


def _floor(v, ho: str | None) -> int | None:
    """「2층」·「2」·2. 칸이 없으면 호에서 — 「1003」→10층, 「302」→3층. 지하·규칙 밖은 지어내지 않는다."""
    if v not in (None, ""):
        m = re.fullmatch(r"(\d{1,2})층?", _norm(v))
        if m:
            return int(m.group(1))
        return None
    if ho:
        m = re.fullmatch(r"(\d{1,2})\d{2}", ho)
        if m and int(m.group(1)) > 0:
            return int(m.group(1))
    return None


def _ho(v) -> str | None:
    """호 표기 정리. 엑셀이 숫자로 들고 있으면 「304.0」이 되지 않게 정수로 편다."""
    if v is None or v == "":
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = _norm(v)
    s = re.sub(r"호$", "", s)
    return s or None


def _dong(v) -> str | None:
    s = _ho(v)
    if s is None:
        return None
    return re.sub(r"동$", "", s) or None


def parse_sheet(name: str, rows: list[tuple]) -> list[LhUnit]:
    hi = _find_header(rows)
    if hi is None:
        return []
    h1 = [_norm(x) for x in rows[hi]]
    h2 = [_norm(x) for x in rows[hi + 1]] if hi + 1 < len(rows) else []
    two = _is_subheader(h1, h2)
    names, groups = _merge_header(h1, h2 if two else None)
    cols = _map_columns(names)
    if "address" not in cols or "ho" not in cols:
        return []

    def cell(r: tuple, f: str):
        i = cols.get(f)
        return r[i] if i is not None and i < len(r) else None

    tier = groups[cols["deposit"]] if "deposit" in cols else None
    out: list[LhUnit] = []
    start = hi + (2 if two else 1)
    for n, r in enumerate(rows[start:], start + 1):
        addr = _text(cell(r, "address"))
        if not addr or len(addr) < 6 or re.fullmatch(r"(합\s*계|소\s*계|계)", addr):
            continue
        ho = _ho(cell(r, "ho"))
        area = _dec(cell(r, "area"))
        if ho is None and area is None:
            continue
        out.append(LhUnit(
            sheet=name, row=n, seq=_int(cell(r, "seq")),
            address=addr, jibun=_text(cell(r, "jibun")),
            sido_col=_text(cell(r, "sido_col")), sigungu_col=_text(cell(r, "sigungu_col")),
            group=_text(cell(r, "group")),
            dong=_dong(cell(r, "dong")), ho=ho,
            area=area, area_common=_dec(cell(r, "area_common")),
            rooms=_int(cell(r, "rooms")), floor=_floor(cell(r, "floor"), ho),
            elevator=_text(cell(r, "elevator")), house_type=_text(cell(r, "house_type")),
            deposit=_int(cell(r, "deposit")), rent=_int(cell(r, "rent")),
            tier=tier,
        ))
    return out


# 줄 머리가 도로명 꼬리 — 「로 45」 「번길 5」 「길 9-11」 「번안길 3」. 뒤에 공백·숫자·괄호가 와야 한다(「로데오」는 아니다)
_ROAD_TAIL_HEAD = re.compile(r"^(?:대?로|번?[가-힣]?길)(?=[\s\d(]|$)")


def _join_wrapped(v: str | None) -> str | None:
    """PDF 칸 안 줄바꿈을 잇는다. 도로명 중간에서 끊긴 줄(「우치로110번\\n길 9-11」, 「대남대로85\\n번길 5」,
    「선운중앙\\n로 45」)은 붙이고, 나머지는 띄운다 — 「무등로\\n374」는 띄워도 붙여도 도로명 파서가 읽는다."""
    if not v:
        return v
    lines = [s.strip() for s in v.split("\n")]
    out = lines[0]
    for s in lines[1:]:
        glue = out.endswith(("번", "-")) or bool(_ROAD_TAIL_HEAD.match(s))
        out += s if glue else f" {s}"
    return out


def parse_house_list_pdf(data: bytes) -> list[LhUnit]:
    """PDF 바이트 → 호실. 2026년 3차 전국 공고는 목록을 엑셀 대신 PDF로만 붙였다(2026-10-02 실측 4건).

    엑셀과 칸 구성이 같고 괘선 있는 텍스트 PDF라 표가 그대로 뽑힌다. **쪽마다 머리행이 다시 나와서**
    쪽 하나를 시트 하나로 보고 parse_sheet에 넘긴다. 머리행 없는 쪽은 parse_sheet가 알아서 건너뛴다.
    """
    import pdfplumber   # PDF 목록이 있을 때만 쓴다

    units: list[LhUnit] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            for t, table in enumerate(page.extract_tables()):
                rows = [tuple(_join_wrapped(c) for c in r) for r in table]
                units.extend(parse_sheet(f"p{i}" + (f"-{t + 1}" if t else ""), rows))
    return units


def parse_house_list(data: bytes) -> list[LhUnit]:
    """xlsx(또는 PDF) 바이트 → 모든 시트의 호실. 안내 시트(머리행 없음)는 조용히 건너뛴다."""
    if data[:4] == b"%PDF":
        return parse_house_list_pdf(data)
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        units: list[LhUnit] = []
        for ws in wb.worksheets:
            units.extend(parse_sheet(ws.title, [tuple(r) for r in ws.iter_rows(values_only=True)]))
        return units
    finally:
        wb.close()


# ── 단지로 묶기 ─────────────────────────────────────────────────────────
# notice_complex 한 행 = 같은 「도로명 + 건물번호」. 동이 갈린 집(시온그랜드빌 101동·102동)도 번지가 같으면 한 단지다.
# 도로명을 못 읽는 주소(지번만 적힌 줄)는 주소 글자 그대로를 열쇠로 쓴다 — S6의 --juso-api가 나중에 맞춘다.

# 괄호 한 겹 안의 괄호까지 — 「(창원무동휴먼빌아파트(1단지))」
_PAREN = re.compile(r"\(((?:[^()]|\([^()]*\))*)\)")
# 괄호 없이 번지 뒤에 바로 붙은 건물명 — 「하귀3길 35 하귀 수하우스」
_AFTER_NO = re.compile(r"(?:로|길)\s*\d+(?:-\d+)?\s+(.+)$")


def _region(u: LhUnit, default_sido: str) -> tuple[str, str | None]:
    """(시도, 시군구). 주소 앞머리가 먼저, 없으면 시도·시군구 칸, 그래도 없으면 공고의 시도."""
    key = parse_road_address(u.address)
    sido = key.sido if key else None
    sigungu = key.sigungu if key else None
    if not sigungu:
        d = parse_dong(u.address) or parse_dong(u.jibun)
        if d:
            sido, sigungu = sido or d[0], d[1]
    if not sido and u.sido_col:
        sido = normalize_sido(u.sido_col)
    return sido or default_sido, sigungu


def complex_key(u: LhUnit) -> str:
    key = parse_road_address(u.address)
    if key is None:
        return re.sub(r"\s+", "", u.address)
    return f"{key.sigungu or ''}|{key.road_name}|{'지하' if key.underground else ''}{key.main_no}-{key.sub_no}"


_REGION_TOKEN = re.compile(r"^[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리|가)$|^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$")


def _is_region(text: str) -> bool:
    """「춘천시 동면」·「전주시 덕진구」·「강원 춘천시」 — 주택군 괄호에 건물명 대신 지역이 든 양식이 있다."""
    tokens = text.split()
    return bool(tokens) and all(_REGION_TOKEN.match(t) for t in tokens)


def _clean_name(text: str | None) -> str | None:
    """이름 후보 다듬기. 지번 괄호·앞 쉼표·동 번호 꼬리를 뗀다. 남는 게 숫자뿐이거나 지역이면 None."""
    if not text:
        return None
    t = re.sub(r"\([^)]*\d[^)]*\)", " ", text)                  # 「(대도동 126-11)」·「(988-1)」 지번 괄호
    t = re.sub(r"\s+", " ", t).strip(" ,.-·()")
    t = re.sub(r"^(?:[\d-]+,|[A-Za-z\d]{1,4}동)\s*\(?\s*", "", t).strip()   # 「98-2, 정더하기」·「101동 (용문센트럴뷰」
    if re.search(r"(?:동|가|리|읍|면)\d*\s+산?\d+(?:-\d+)?$", t):             # 「장성동 1386-14」 — 지번이다
        return None
    t = re.sub(r"\s*(?:제)?[A-Za-z\d]{1,4}동$", "", t).strip()      # 「시온빌라트 B동」·「천수빌A동」·「제A동」
    t = re.sub(r"\s+\d{1,4}$", "", t).strip()                       # 「코아루드림 102」의 동 번호
    if not t or re.fullmatch(r"[\d\s,-]+", t) or _is_region(t):
        return None
    return t


_DONG_ONLY = re.compile(r"^[가-힣\d]+(?:동|가|리|읍|면)\d*$")


def complex_name(u: LhUnit) -> str:
    """단지 이름. 지어낸 이름은 없다 — 원문에서 건물명으로 읽히는 첫 후보를 쓴다.

    1. 주소 괄호의 건물명 「(둔촌동,은슬림 둔촌)」, 법정동 없이 건물명만 든 괄호 「(창원무동휴먼빌아파트…)」
    2. 주소 뒤에 붙은 건물명 「…(상계동) 시온빌라트 B동」
    3. 주택군 괄호 「강동둔촌동(은슬림둔촌)」 — 단 「경남 창원시(진해)」처럼 앞머리가 지역이면 괄호도 지역이라 안 쓴다
    4. 도로명 번지 「명일로10가길 10」
    """
    m = _PAREN.search(u.address)
    if m:
        inner = m.group(1)
        cand = inner.split(",", 1)[1] if "," in inner else (None if _DONG_ONLY.match(inner.strip()) else inner)
        name = _clean_name(cand)
        if name:
            return name
    if m:
        name = _clean_name(u.address[m.end():])
    else:
        after = _AFTER_NO.search(u.address)
        name = _clean_name(after.group(1)) if after else None
    if name:
        return name
    if u.group:
        g = _PAREN.search(u.group)
        head = u.group[: g.start()].strip() if g else ""
        if g and not (" " in head and _is_region(head)):
            name = _clean_name(g.group(1))
            if name:
                return name
    key = parse_road_address(u.address)
    if key:
        return f"{key.road_name} {key.main_no}{'-' + str(key.sub_no) if key.sub_no else ''}"
    return u.address


def _strip_sido(addr: str, sido: str) -> str:
    """notice_complex.road_address는 시군구부터 쓴다(0007). 시도는 sido 칸에 있다."""
    head, _, rest = addr.partition(" ")
    return rest.strip() if rest and normalize_sido(head) else addr


def _elevator(v: str | None) -> str | None:
    """승강기 Y/N → SH 별첨과 같은 말(설치/미설치). 화면은 「미설치」만 따로 표시한다. 모르는 표기는 원문대로."""
    if not v:
        return None
    t = v.strip().upper()
    if t in ("Y", "유", "O", "있음", "설치"):
        return "설치"
    if t in ("N", "무", "X", "없음", "미설치"):
        return "미설치"
    return v.strip()


def build_rows(units: list[LhUnit], *, default_sido: str) -> tuple[list[dict], list[dict]]:
    """호실 → (notice_complex 행, unit 행). 단지는 처음 나온 순서를 지킨다(표 순서가 곧 지역 묶음 순서다).

    단지 이름이 공고 안에서 겹치면(다른 구의 「양지쉐르빌」 둘) 시군구를 붙여 가른다 — 이름이 단지 URL이다.
    """
    groups: dict[str, list[LhUnit]] = {}
    for u in units:
        groups.setdefault(complex_key(u), []).append(u)

    names: dict[str, str] = {k: complex_name(us[0]) for k, us in groups.items()}
    seen: dict[str, int] = {}
    for n in names.values():
        seen[n] = seen.get(n, 0) + 1
    complexes, rows = [], []
    used: set[str] = set()
    for k, us in groups.items():
        first = us[0]
        sido, sigungu = _region(first, default_sido)
        name = names[k]
        if seen[name] > 1:
            name = f"{name}({sigungu or sido})"
        base, i = name, 2
        while name in used:
            name, i = f"{base}-{i}", i + 1
        used.add(name)
        road = _strip_sido(re.sub(r"\s+", " ", first.address).strip(), sido)
        areas = [u.area for u in us if u.area is not None]
        deps = [u.deposit for u in us if u.deposit]
        rents = [u.rent for u in us if u.rent is not None]
        complexes.append({
            "name": name, "sido": sido, "sigungu": sigungu or "", "road_address": road,
            "is_new": False, "source_page": None, "complex_code": None,
            "unit_count": len(us),
            "min_deposit": min(deps) if deps else None,
            "min_rent": min(rents) if rents else None,
            "area_min": min(areas) if areas else None,
            "area_max": max(areas) if areas else None,
        })
        for u in us:
            rows.append({
                "nc_name": name, "nc_road": road, "complex_code": None,
                "unit_key": "-".join(x for x in (name, u.dong, u.ho) if x),
                "road_address": road, "complex_name": name,
                "building": u.dong, "room": u.ho, "floor": u.floor,
                "sido": sido, "sigungu": sigungu or "",
                "area_m2": u.area, "deposit": u.deposit, "rent": u.rent,
                "deposit_jeonse": None, "rent_jeonse": None, "deposit_wolse": None, "rent_wolse": None,
                "room_layout": f"방{u.rooms}개" if u.rooms else None,
                "elevator": _elevator(u.elevator),
                "has_elevator": None if _elevator(u.elevator) is None else _elevator(u.elevator) == "설치",
                "seq": u.seq, "source_page": None,
            })
    # 같은 호가 두 번 나오면(동 칸이 빈 다세대) 줄 번호를 붙여 살린다 — 조용히 사라지는 줄이 없어야 한다
    count: dict[str, int] = {}
    for r in rows:
        count[r["unit_key"]] = count.get(r["unit_key"], 0) + 1
    for r, u in zip(rows, [u for us in groups.values() for u in us]):
        if count[r["unit_key"]] > 1:
            r["unit_key"] = f"{r['unit_key']}-r{u.row}"
    return complexes, rows
