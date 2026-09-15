"""서울시 청년안심주택(민간임대) 첨부 공고문 PDF — 임대보증금·월임대료 표.

실측 2026-09-15, 2019~2026 표본 12건:
- 전부 PDF(텍스트 레이어 있음). HWP 출력물이라 표에 괘선이 있어 pdfplumber `find_tables()`(lines 전략)가 칸을 그대로 잡는다.
  SH의 Synap XML처럼 글자 좌표를 직접 다룰 필요가 없다.
- 2019~2021 공고는 가로 2단 조판(A4 두 쪽을 841×595 한 장에). 반으로 잘라 읽지 않으면 왼쪽 표와 오른쪽 문단이 섞인다.
- 표 머리는 사업자마다 다르지만 뼈대는 하나다:
    [공급유형/구분/신청자격] [주거전용(타입)/전용면적/주택형] [공급호수/세대수] [보증금 N% → (보증금, 임대료)] × 비율 개수
  변형 셋 —
    (1) 추가모집: 「층수」 「계약개시일」 열이 더 있고 단위가 원(2026 우장산역 해링턴타워)
    (2) 호실 단위: 「1701호」가 유형 칸에 있고 「옵션」 열에 「보증금 40%」(2026 쌍문역 인히어쌍문)
    (3) 2020~2021: 천원 단위, 비율마다 「계 | 계약금 | 잔금 | 월임대료」 네 열(동대문 영하우스·서초꽃마을)
- 단위는 표 위 「(단위 : 만원)」에 있고, 열 머리에 「(천원)」「(원)」이 따로 붙기도 한다(열 머리가 우선).
  둘 다 없으면 크기로 가른다 — 보증금이 10만 미만이면 만원, 월임대료가 1만 미만이면 만원.
- 특별공급/일반공급은 (a) 행의 유형 칸, (b) 표 머리 칸(「주택형 | 특별공급」), (c) 표 위 제목(「(1) 특별공급」) 세 곳 중 하나에 있다.
  행 → 머리 → 제목 순으로 본다. 공급대상(청년·신혼부부)도 같은 순서.
- 표 없는 첨부: 1쪽짜리 「퇴거예정세대 신규계약」 안내문(2024 가좌역 스타타워). 표 없음으로 건너뛴다.
"""

from __future__ import annotations

import io
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# 표 위에서 제목·단위를 찾는 띠 높이(pt). 「■ 임대보증금 및 월 임대료 / (1) 특별공급 / - 청년(40세대) / (단위 : 만원)」 네 줄이 든다
CONTEXT_HEIGHT = 130

# 깨진 PDF를 다시 적을 때 쓰는 줄바꿈
CRLF = b"\r\n"

_WS = re.compile(r"\s+")
_UNIT = re.compile(r"단\s*위\s*[:：]?\s*(원|만\s*원|천\s*원)")
_RATIO = re.compile(r"(\d{1,3})\s*%")
_FIXED = re.compile(r"(\d[\d,]*)\s*만\s*원")
_KIND = re.compile(r"(특별|일반)\s*공급")
_KIND_SHORT = re.compile(r"^(특별|일반)$")
_ROOM = re.compile(r"(\d{3,4})\s*호")
_FLOOR = re.compile(r"(\d{1,2})\s*층")
_AREA = re.compile(r"(\d{1,3}(?:\.\d{1,2})?)")
_AREA_BOUND = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d{1,3})?)(?![\d.])")   # 「18.038㎡」 소수 셋째 자리까지
# 배율을 곱한 결과가 이 밖이면 단위 표기가 표와 안 맞는 것(「(단위 : 만원)」 밑에 원 단위 금액 — 세이지움 개봉 2026)
_DEPOSIT_RANGE = (1_000_000, 1_500_000_000)   # 실측 최대 4억대. 15억을 넘으면 단위를 잘못 읽은 것
_RENT_RANGE = (10_000, 20_000_000)
_PAREN = re.compile(r"[(（]([^)）]*)[)）]")
_NUM_CELL = re.compile(r"^[\d,.\s]+$")
_SUBTOTAL = re.compile(r"^(소\s*계|합\s*계|계|총\s*계)$")
_DASH = re.compile(r"[-－—\s]+")
_TENANT_JOIN = re.compile(r"\s*(?:or|또는|및|/|·|,|&|과|와)\s*")
# 유형 칸의 「특별」「일반」 — 「청년⏎특별」처럼 「공급」 없이 줄만 바꿔 적기도 한다
_KIND_ANY = re.compile(r"(특별|일반)\s*(?:공급)?")
_MONEY_DOT = re.compile(r"^\d{1,3}(?:\.\d{3})+$")
_TYPE_ONLY = re.compile(r"\d{1,3}[A-Za-z]")   # 「17A」만 적힌 유형 칸(괘선 없는 옛 조판)
_CURRENCY = re.compile(r"[₩￦\\Ww]|원$")


# ---------------------------------------------------------------- PDF → 표

@dataclass(frozen=True)
class RawTable:
    """pdfplumber가 잡은 표 하나. context는 표 바로 위 띠의 글(제목·단위·공급대상). 회귀 픽스처가 이 모양으로 저장된다."""

    page: int
    half: str                 # 2단 조판이면 a/b, 아니면 ''
    context: str
    rows: list[list[str | None]]

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


def _open_pdf(path: str | Path):
    """PDF 하나를 연다. 마지막 증분 갱신이 깨진 파일은 그 조각을 떼고 앞 판으로 연다.

    실측(캐시 452건 중 16건, 전부 같은 사업자 편집기): 파일 끝 xref 스트림의 `/Length`가 실제 스트림보다 커서
    pdfminer가 여는 순간 `Unexpected EOF`로 죽는다. 그 객체 바로 앞에서 자르고 `/Prev`가 가리키는 앞 판을
    startxref로 다시 적으면 열린다 — 앞 판은 파일 안에 온전히 들어 있다(본문은 증분 갱신 전이나 후나 같다).
    """
    import pdfplumber  # 무거워서 여기서만

    try:
        return pdfplumber.open(str(path))
    except Exception as exc:  # noqa: BLE001
        data = Path(path).read_bytes()
        i = data.rfind(b"startxref")
        tail = data[i + 9:].split() if i > 0 else []
        off = int(tail[0]) if tail and tail[0].isdigit() else 0
        m = re.search(rb"/Prev\s+(\d+)", data[off:off + 400]) if off else None
        if not m:
            raise
        log.warning("%s: 마지막 증분 갱신이 깨져 앞 판으로 연다(%s)", Path(path).name, exc)
        fixed = data[:off] + b"startxref" + CRLF + str(int(m.group(1))).encode() + CRLF + b"%%EOF" + CRLF
        return pdfplumber.open(io.BytesIO(fixed))


def tables_from_pdf(path: str | Path, *, words: bool = False) -> list[RawTable]:
    """괘선으로 칸을 읽는다. `words=True`면 괘선을 무시하고 글자 좌표로 열을 세운다(옛 조판 되살리기)."""
    from .youth_attach_words import tables_from_words   # 순환 참조를 피해 여기서만

    out: list[RawTable] = []
    halves_left: list[tuple[int, str, Any]] = []
    with _open_pdf(path) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            w, h = page.width, page.height
            halves = [("a", page.crop((0, 0, w / 2, h))), ("b", page.crop((w / 2, 0, w, h)))] if w > h else [("", page)]
            for tag, half in halves:
                halves_left.append((i, tag, half))
                if words:
                    continue
                for t in half.find_tables():
                    rows = t.extract()
                    if not rows or not _looks_like_rent_table(rows):
                        continue
                    x0, top, x1, _ = t.bbox
                    ctx_top = max(half.bbox[1], top - CONTEXT_HEIGHT)
                    ctx = half.crop((half.bbox[0], ctx_top, half.bbox[2], top)).extract_text() or "" if top > ctx_top else ""
                    out.append(RawTable(page=i, half=tag, context=ctx, rows=rows))
        if words:
            for i, tag, half in halves_left:
                out.extend(tables_from_words(half, i, tag, RawTable))
    return out


def _looks_like_rent_table(rows: list[list[str | None]]) -> bool:
    head = " ".join(" ".join(c or "" for c in r) for r in rows[:4])
    return "보증금" in head and "임대료" in head


def dump_tables(tables: list[RawTable]) -> str:
    return json.dumps([t.as_json() for t in tables], ensure_ascii=False, indent=1)


def load_tables(text: str) -> list[RawTable]:
    return [RawTable(**d) for d in json.loads(text)]


# ---------------------------------------------------------------- 표 → 줄

@dataclass(frozen=True)
class Option:
    """보증금 비율 하나의 (보증금, 월임대료). 금액은 원. ratio가 없는 고정액 옵션은 label로만 구분한다(「보증금 9000만원」)."""

    label: str
    ratio: int | None
    deposit: int | None
    rent: int | None

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SupplyLine:
    tenant_class: str              # 청년 · 신혼부부 · 청년/신혼부부 · 1인가구 …
    supply_kind: str | None        # 특별공급 · 일반공급
    area: Decimal | None           # 주거전용 ㎡
    type_code: str | None          # 26A-1 · 23A · D1. 없으면 면적이 유형
    count: int | None              # 이번 공급호수. 예비자만 모집이면 0
    reserve_only: bool
    room: str | None               # 호실 단위 표만: "1701"
    floor: int | None
    move_in: str | None            # 계약개시일 원문 "26.10.26"
    options: list[Option]
    page: int

    @property
    def supply_type(self) -> str:
        if self.type_code:
            return self.type_code
        return f"{self.area.normalize():f}" if self.area is not None else "미상"

    @property
    def base(self) -> Option | None:
        """기준 금액 — 보증금이 가장 낮은 옵션(민간임대 표의 첫 열이자 notice.min_deposit과 같은 뜻)."""
        priced = [o for o in self.options if o.deposit is not None]
        return min(priced, key=lambda o: o.deposit) if priced else None


@dataclass
class _Col:
    idx: int
    role: str                      # class · area · count · floor · move_in · room · deposit · rent · option · skip
    label: str                     # 비율 열의 짝 맞추기 열쇠 "30%" · "9000만원" · ''
    ratio: int | None
    scale: int | None              # 열 머리에 단위가 있으면 1 · 1000 · 10000


def _norm(cell: str | None) -> str:
    return _WS.sub(" ", (cell or "").replace("\n", " ")).strip()


def _flat(cell: str | None) -> str:
    """줄바꿈으로 갈린 낱말을 붙인다 — 「신혼⏎부부」 → 「신혼부부」, 「일반⏎공급」 → 「일반공급」."""
    return _WS.sub("", cell or "")


def _is_header_row(row: list[str | None]) -> bool:
    """머리 줄 — 숫자만 든 칸이 하나도 없다(「보증금 30%」는 %가 있어 숫자만은 아니다)."""
    return not any(_NUM_CELL.match(_norm(c)) for c in row if _norm(c))


def _columns(header: list[list[str | None]], ncols: int) -> tuple[list[_Col], str | None]:
    """열마다 역할을 정한다. 돌려주는 둘째 값은 표 머리에 적힌 특별/일반공급."""
    own: list[list[str]] = [[] for _ in range(ncols)]
    inherited: list[list[str]] = [[] for _ in range(ncols)]
    table_kind: str | None = None
    for row in header:
        carry = ""
        for j in range(ncols):
            c = _norm(row[j]) if j < len(row) else ""
            if c:
                own[j].append(c)
                carry = c
            elif carry:
                inherited[j].append(carry)   # 가로로 병합된 묶음 머리(「보증금 30%」)가 오른쪽 빈 칸까지 덮는다
    cols: list[_Col] = []
    for j in range(ncols):
        labels = [x for x in own[j] if not _KIND_SHORT.match(_flat(x)) and _flat(x) not in ("특별공급", "일반공급")]
        kinds = [x for x in own[j] if _flat(x) in ("특별공급", "일반공급")]
        if kinds and table_kind is None:
            table_kind = _flat(kinds[0])
        label = labels[-1] if labels else ""
        group = " ".join(own[j] + inherited[j])
        cols.append(_Col(idx=j, role=_role(_flat(label), _flat(group)), label=_ratio_label(group),
                         ratio=_ratio_of(group), scale=_scale_of(group)))
    # 비율 열 안에서 「임대보증금」 묶음 밑의 「계」는 보증금, 「계약금·잔금」은 버린다(_role이 라벨로 가른다)
    # 보증금 열이 하나뿐이고 라벨이 없으면 옵션 열이나 단일 금액 표다
    return cols, table_kind


_AREA_WORDS = ("전용", "㎡", "m2", "m²", "타입", "TYPE", "Type", "주택형", "면적")


def _role(label: str, group: str) -> str:
    # 「최대전환시 임대조건」 — 보증금을 더 낮추거나 올렸을 때의 값이라 공급 조건이 아니다(2019 공공임대 병기 양식).
    # 읽으면 「(-)」 줄이 보증금 828만원짜리 공급 줄로 새어 나온다
    if "전환" in group:
        return "skip"
    if not label:
        # 머리가 빈 열 — 가로로 병합된 머리의 오른쪽 조각. 「주택형 | (빈칸)」이면 면적, 「공급유형 | (빈칸) | (빈칸)」이면
        # 유형 칸의 조각(「청년 | 일반공급 | 1701호」)이라 칸 내용으로 다시 가른다
        if any(k in group for k in _AREA_WORDS) and not any(k in group for k in ("유형", "구분", "자격")):
            return "area"
        return "unlabeled"
    if "임대료" in label:
        return "rent"
    if "계약금" in label or "잔금" in label:
        return "skip"
    if "옵션" in label:
        return "option"
    if "보증금" in label or (label == "계" and "보증금" in group):
        return "deposit"     # 「계」는 묶음 머리가 보증금일 때만. 「신청자격별 공급호수 | 계」의 계는 호수다
    if any(k in label for k in _AREA_WORDS):
        return "area"        # 「주거전용(타입)호수」 — 호수보다 먼저. 「공급호수」엔 면적 낱말이 없다
    if "호수" in label or "세대수" in label:
        return "count"
    if _SUBTOTAL.match(label) and any(k in group for k in ("호수", "세대")):
        return "count"       # 「신청자격별 공급호수 | 계 | 특별 | 일반」의 계
    if "층" in label:
        return "floor"
    if "계약개시" in label or "입주" in label or "시작일" in label:
        return "move_in"
    if "호실" in label or "동호" in label:
        return "room"
    if any(k in label for k in _AREA_WORDS):
        return "area"
    if any(k in label for k in ("유형", "구분", "자격", "대상", "계층")):
        return "class"
    return "unlabeled"


def _ratio_of(text: str) -> int | None:
    m = _RATIO.search(text)
    return int(m.group(1)) if m else None


def _ratio_label(text: str) -> str:
    m = _RATIO.search(text)
    if m:
        return f"{m.group(1)}%"
    m = _FIXED.search(text)
    return f"{m.group(1)}만원" if m else ""


_COL_UNIT = re.compile(r"[(（]\s*(천\s*원|만\s*원|원)\s*[)）]")


def _scale_of(text: str) -> int | None:
    """열 머리의 「(천원)」「(원)」. 괄호 없는 「보증금 9000만원」은 고정액 라벨이지 단위가 아니다."""
    m = _COL_UNIT.search(text)
    if not m:
        return None
    return {"원": 1, "만원": 10000, "천원": 1000}[_flat(m.group(1))]


def _table_scale(context: str) -> int | None:
    m = _UNIT.search(context)
    if not m:
        return None
    return {"원": 1, "만원": 10000, "천원": 1000}[_flat(m.group(1))]


def _money(cell: str | None) -> Decimal | None:
    """만원 단위 표는 「75.4」처럼 소수를 쓴다 — 배율을 곱하기 전엔 자르지 않는다.

    원문 오타 둘을 되돌린다: 「9.880」은 쉼표를 마침표로, 「37,4」는 마침표를 쉼표로 잘못 친 칸.
    쉼표 뒤가 세 자리가 아닌데 되돌릴 수도 없는 칸(「69,000,00」)은 버린다 — 틀린 금액을 싣느니 비우는 게 낫다.
    """
    t = _norm(cell).replace(" ", "")
    # 원 표시를 붙여 적은 칸 — 「\60,000,000」(￦가 역슬래시로 뽑힌다) 「60,000,000원」
    t = _CURRENCY.sub("", t)
    if not t or t in ("-", "－", "미정", "—"):
        return None
    if _MONEY_DOT.match(t):          # 「9.880」 — 쉼표를 마침표로 잘못 친 칸
        t = t.replace(".", "")
    if "," in t:
        head, *rest = t.split(",")
        if len(rest) == 1 and len(rest[0]) in (1, 2) and "." not in t:
            t = f"{head}.{rest[0]}"          # 「37,4」 → 37.4
        elif any(len(x) != 3 for x in rest):
            return None                      # 자릿수가 어긋난 쉼표 — 값을 못 믿는다
        else:
            t = t.replace(",", "")
    try:
        return Decimal(t)
    except Exception:  # noqa: BLE001
        return None


def _scaled(v: Decimal | None, col_scale: int | None, table_scale: int | None, kind: str) -> int | None:
    if v is None:
        return None
    scale = col_scale or table_scale
    if scale is None:
        # 단위 표기가 없다 — 크기로 가른다. 보증금 10만 미만·월임대료 1만 미만은 만원 단위다
        scale = 10000 if (v < 100_000 if kind == "deposit" else v < 10_000) else 1
    lo, hi = _DEPOSIT_RANGE if kind == "deposit" else _RENT_RANGE
    out = int(v * scale)
    if lo <= out <= hi:
        return out
    # 표기된 단위와 칸의 값이 안 맞는다(「(단위 : 만원)」 밑의 원 단위 금액, 천원 단위 금액).
    # 서울 민간임대에서 있을 수 있는 금액대에 드는 배율이 하나뿐이면 그걸로 읽는다. 여럿이거나 없으면 비운다
    fits = [int(v * s) for s in (1, 1000, 10_000) if lo <= v * s <= hi]
    if len(fits) == 1:
        return fits[0]
    log.warning("단위를 못 가린 금액을 비운다: %s(배율 %s, %s)", v, scale, kind)
    return None


def _parse_area(cell: str | None) -> tuple[Decimal | None, str | None, str | None]:
    """「23.68㎡ (23A)」 → (23.68, "23A", None). 괄호에 호가 들어 있으면(「35㎡ (305호)」) 타입이 아니라 호실이다."""
    t = _norm(cell)
    if not t:
        return None, None, None
    code = room = None
    m = _PAREN.search(t)
    if m:
        inner = m.group(1).strip()
        rm = _ROOM.fullmatch(inner.replace(" ", ""))
        if rm:
            room = rm.group(1)
        else:
            code = _WS.sub("", re.sub(r"타입|type|형", "", inner, flags=re.I)).strip("-_ ") or None
        t = _PAREN.sub(" ", t)
    # 「18.55m2 (18B) 732호」 「단층형 1201호」 — 괄호 밖에 호가 붙기도 한다. 면적을 찾기 전에 뗀다(1201호의 120을 면적으로 읽지 않게)
    rm = _ROOM.search(t)
    if rm:
        room = room or rm.group(1)
        t = _ROOM.sub(" ", t)
    t = re.sub(r"(단층|\d+층)형", " ", t)
    # 「17A」 「33B」만 적힌 유형 칸(괘선 없는 옛 조판) — 숫자는 면적, 글자까지가 타입이다
    if code is None and _TYPE_ONLY.fullmatch(t.replace(" ", "")):
        code = t.replace(" ", "")
    m = _AREA_BOUND.search(t)
    area = Decimal(m.group(1)) if m else None
    return area, code, room


def _tenant(text: str) -> str:
    t = _flat(text)
    # 괄호 안 부연은 지우되, 「일반(청년,신혼부부)」처럼 계층이 괄호에 든 양식은 괄호만 벗긴다
    t = re.sub(r"[(（]([^)）]*)[)）]",
               lambda m: f"/{m.group(1)}/" if re.search(r"청년|신혼|가구|고령|대학생", m.group(1)) else "", t)
    t = t.replace("대학생포함", "")
    t = t.replace("계층", "").replace("공급대상", "")
    t = _KIND_ANY.sub("", t)
    t = _TENANT_JOIN.sub("/", t).strip("/ ")
    t = t.replace("신혼/부부", "신혼부부")
    # 표기가 사업자마다 다르다 — 「청년/신혼」 「신혼부부청년」 「청년또는신혼부부형」 전부 같은 뜻. 두 계층은 고정 표기로
    has_youth, has_newly = "청년" in t, "신혼" in t
    if has_youth and has_newly:
        return "청년/신혼부부"
    if has_newly:
        return "신혼부부"
    if has_youth:
        return "청년"
    return t.rstrip("형")


def lines_from_tables(tables: list[RawTable]) -> list[SupplyLine]:
    lines: list[SupplyLine] = []
    page_scale: dict[tuple[int, str], int] = {}   # 한 쪽 안에서 단위는 안 바뀐다 — 둘째 표부터는 위 표 텍스트가 띠를 덮어 못 읽는다
    page_kind: dict[tuple[int, str], str] = {}    # 비율이 많아 표를 둘로 끊은 양식(20/25/30 · 35/40/45) — 뒤 표엔 제목이 없다
    for t in tables:
        key = (t.page, t.half)
        try:
            scale = _table_scale(t.context)
            if scale is None:
                scale = page_scale.get(key)
            else:
                page_scale[key] = scale
            got = _lines_from_table(t, scale)
            kinds = {ln.supply_kind for ln in got if ln.supply_kind}
            if len(kinds) == 1:
                page_kind[key] = kinds.pop()
            elif not kinds and key in page_kind:
                for ln in got:
                    ln.supply_kind = page_kind[key]
            lines.extend(got)
        except Exception as exc:  # noqa: BLE001
            log.warning("표를 못 읽었다 p%d%s: %s", t.page, t.half, exc)
    return lines


def _lines_from_table(t: RawTable, table_scale: int | None = None) -> list[SupplyLine]:
    rows = t.rows
    ncols = max(len(r) for r in rows)
    header: list[list[str | None]] = []
    for r in rows:
        if len(header) >= 5 or not _is_header_row(r):
            break
        header.append(r)
    body = rows[len(header):]
    if not header or not body:
        return []
    cols, header_kind = _columns(header, ncols)
    roles = {c.role for c in cols}
    if "deposit" not in roles and "rent" not in roles:
        return []
    ctx_kind = _last_kind(t.context)
    # 계층 열이 아예 없는 표는 표 위 글에서 계층을 읽는다. 「(n세대)」가 붙은 쪽이 확실하지만,
    # 예비자 표처럼 세대수가 없는 양식도 있어 그때는 낱말만으로 받는다
    class_cells = any(_norm(r[c.idx]) and not _SUBTOTAL.match(_flat(r[c.idx])) and not _KIND_ANY.fullmatch(_flat(r[c.idx]))
                      for c in cols if c.role in ("class", "unlabeled") for r in body if c.idx < len(r))
    ctx_tenant = _tenant_from_context(t.context, loose=not class_cells)

    deposit_cols = [c for c in cols if c.role == "deposit"]
    rent_cols = [c for c in cols if c.role == "rent"]
    option_col = next((c for c in cols if c.role == "option"), None)
    count_col = next((c for c in cols if c.role == "count"), None)
    # 표 전체가 예비자 모집이면 호수 열에 숫자 없이 「예비자」만 있다
    count_cells = [_norm(r[count_col.idx]) for r in body if count_col and count_col.idx < len(r)]
    table_reserve = bool(count_cells) and any("예비" in c for c in count_cells) and not any(c.isdigit() for c in count_cells)

    out: list[SupplyLine] = []
    carry: dict[int, str] = {}     # 세로 병합 칸(유형·공급구분·면적)의 직전 값
    for r in body:
        cells = [(_norm(r[j]) if j < len(r) else "") for j in range(ncols)]
        class_text_parts: list[str] = []
        room = floor = move_in = None
        area = code = None
        count: int | None = None
        reserve = table_reserve
        for c in cols:
            v = cells[c.idx]
            if c.role in ("class", "unlabeled"):
                if v:
                    carry[c.idx] = v
                elif c.idx in carry:
                    v = carry[c.idx]
                if not v or _DASH.fullmatch(v):
                    continue          # 「-」는 그 자격에 배정이 없다는 뜻이지 계층 이름이 아니다(「대학생-」)
                if _SUBTOTAL.match(_flat(v)):
                    class_text_parts.append(v)
                    continue
                if re.fullmatch(r"\d{1,3}(?:\.\d{1,2})?\s*형?", v):
                    v = v.rstrip("형").strip()
                    # 「공급유형(TYPE)」 열에 면적만 적은 2020년 양식. 면적 열을 이미 읽었으면 덮지 않는다 —
                    # 옆의 공급호수 조각(「13」)이 면적으로 들어앉는다
                    if area is None:
                        area = Decimal(v)
                    continue
                m = _ROOM.search(v)
                if m and room is None:
                    room = m.group(1)
                    v = _ROOM.sub("", v)
                m = _FLOOR.search(v)
                if m and floor is None and not any(k in v for k in ("청년", "신혼", "가구")):
                    floor = int(m.group(1))
                    v = _FLOOR.sub("", v)
                if _TYPE_ONLY.fullmatch(v) and area is None:
                    # 「공급유형」 한 칸에 계층과 타입이 같이 묶인 머리(괘선 없는 옛 조판) — 「16A」는 계층이 아니라 타입이다
                    area, code, _ = _parse_area(v)
                    continue
                if c.role == "unlabeled" and "㎡" in v and _parse_area(v)[0] is not None:
                    area, code, rm = _parse_area(v)
                    room = room or rm
                    continue
                class_text_parts.append(v)
            elif c.role == "area":
                if v:
                    carry[c.idx] = v
                elif c.idx in carry:
                    v = carry[c.idx]   # 「30m2(A)」 밑에 호실만 두 줄 — 면적 칸이 세로로 병합돼 있다
                a, k, rm = _parse_area(v)
                if a is not None or k:
                    area, code = a, k
                if rm and room is None:
                    room = rm
            elif c.role == "count":
                if v.isdigit():
                    count = int(v)
                elif "예비" in v:
                    reserve = True
            elif c.role == "floor":
                m = _FLOOR.search(v)
                floor = int(m.group(1)) if m else floor
            elif c.role == "move_in":
                move_in = v if v and v != "미정" else None
            elif c.role == "room":
                m = _ROOM.search(v) or re.search(r"\d{3,4}", v)
                room = m.group(1) if m else room
        class_text = " ".join(class_text_parts)
        # 조각 하나라도 「소계」·「합계」면 그 줄은 집계다 — 옆 칸이 세로 병합으로 계층을 물려받아 와도 줄로 세지 않는다
        if any(_SUBTOTAL.match(_flat(x)) for x in class_text_parts) or (not class_text and area is None and room is None):
            carry.clear()
            continue
        if area is None and room is None:
            continue

        # 옵션들 — 비율 라벨로 보증금·임대료 열을 짝짓는다
        options: list[Option] = []
        row_ratio = _ratio_of(cells[option_col.idx]) if option_col else None
        for dc in deposit_cols:
            dep = _scaled(_money(cells[dc.idx]), dc.scale, table_scale, "deposit")
            rc = next((x for x in rent_cols if x.label == dc.label), None)
            if rc is None and len(rent_cols) == 1:
                rc = rent_cols[0]
            rent = _scaled(_money(cells[rc.idx]), rc.scale, table_scale, "rent") if rc else None
            if dep is None and rent is None:
                continue
            ratio = dc.ratio if dc.ratio is not None else row_ratio
            label = dc.label or (f"{ratio}%" if ratio is not None else "기본")
            options.append(Option(label=label, ratio=ratio, deposit=dep, rent=rent))
        options = _drop_inconsistent(options)
        if not options:
            continue
        kind_m = _KIND_ANY.search(_flat(class_text))
        supply_kind = f"{kind_m.group(1)}공급" if kind_m else header_kind or ctx_kind
        tenant = _tenant(class_text) or ctx_tenant or "전체"
        if reserve and count is None:
            count = 0
        if count is not None and count >= 1000:
            room, count = room or str(count), 1   # 「공급호수」 칸에 동호수(1810)를 적은 표(더포디엄830 2026). 소계는 1
        if room and count is None:
            count = 1          # 호실 한 줄 = 한 호. 「각세대 호실명」 열만 있고 호수 열이 없는 표
        out.append(SupplyLine(
            tenant_class=tenant, supply_kind=supply_kind, area=area, type_code=code, count=count,
            reserve_only=reserve and not count, room=room, floor=floor if floor else (_floor_of_room(room)),
            move_in=move_in, options=options, page=t.page,
        ))
    return _fix_digit_typos(out)


# 표 하나 안에서 「면적 × 비율」당 보증금이 중앙값의 몇 배 밖이면 원문 오타로 본다. 되돌린 값은 2배 안에 들어야 한다
_TYPO_FAR = 5
_TYPO_NEAR = 2


def _fix_digit_typos(lines: list[SupplyLine]) -> list[SupplyLine]:
    """한 표 안에서 보증금은 「면적 × 비율」에 거의 비례한다 — 0을 더 찍거나 뺀 칸을 여기서 잡는다.

    실측: 길동역 길동생활(A동) 2025 「106000」(단위 만원 → 10.6억). 같은 표의 17㎡/33㎡/34㎡ 줄은 ㎡·비율당 값이 고른데
    36.49㎡ 줄만 10배다. 한 줄 안에 비율 옵션이 하나뿐이라 `_drop_inconsistent`(줄 안 비교)로는 안 걸린다.

    10배·100배로 되돌린 값이 중앙값의 2배 안에 드는 배율이 하나뿐일 때만 고치고, 아니면 그 옵션을 버린다.
    견줄 줄이 3개 미만이면 손대지 않는다 — 중앙값을 믿을 수 없다.
    """
    norms = [(ln, o, Decimal(o.deposit) / (ln.area * (o.ratio or 100)))
             for ln in lines if ln.area for o in ln.options if o.deposit is not None]
    if len(norms) < 3:
        return lines
    mid = sorted(n for _, _, n in norms)[len(norms) // 2]
    if mid <= 0:
        return lines
    fixed: dict[int, Option] = {}
    for _, o, n in norms:
        if mid / _TYPO_FAR <= n <= mid * _TYPO_FAR:
            continue
        fits = [f for f in (Decimal(10), Decimal("0.1"), Decimal(100), Decimal("0.01"))
                if mid / _TYPO_NEAR <= n * f <= mid * _TYPO_NEAR]
        if len(fits) == 1:
            dep = int(Decimal(o.deposit) * fits[0])
            log.warning("자릿수 오타를 되돌린다: %s %s원 → %s원", o.label, o.deposit, dep)
            fixed[id(o)] = Option(label=o.label, ratio=o.ratio, deposit=dep, rent=o.rent)
        else:
            log.warning("표 안에서 비율·면적에 안 맞는 보증금을 버린다: %s %s원", o.label, o.deposit)
            fixed[id(o)] = None
    if not fixed:
        return lines
    out: list[SupplyLine] = []
    for ln in lines:
        opts = [fixed.get(id(o), o) for o in ln.options]
        ln.options = [o for o in opts if o is not None]
        if ln.options:
            out.append(ln)
    return out


def _drop_inconsistent(options: list[Option]) -> list[Option]:
    """한 줄 안에서 보증금은 비율에 비례한다 — 크게 어긋나는 옵션은 원문 오타다.

    실측: 「69,000,00」(0 하나 빠진 쉼표), 머리에 「보증금 3%」로 잘못 찍힌 열. 그 칸만 빼고 나머지는 살린다.
    견줄 짝이 없으면(비율 옵션이 하나뿐) 그대로 둔다 — 틀렸는지 알 길이 없다.
    """
    # 실측 최저 비율은 20%다. 한 자릿수 비율은 열 머리 오타(「30%」 → 「3%」)로, 금액도 같이 틀려 있다
    options = [o for o in options if o.ratio is None or o.ratio >= 10]
    # 보증금이 이 표의 본체다 — 보증금 칸을 못 읽은 옵션은 임대료만 남겨 봐야 화면에 「— / 월 69만」으로 뜬다
    options = [o for o in options if o.deposit is not None]
    priced = [o for o in options if o.ratio and o.deposit]
    if len(priced) < 3:
        return options
    per = sorted(o.deposit / o.ratio for o in priced)
    mid = per[len(per) // 2]
    bad = {id(o) for o in priced if not (mid / 2) <= o.deposit / o.ratio <= mid * 2}
    if not bad:
        return options
    for o in priced:
        if id(o) in bad:
            log.warning("비율에 안 맞는 금액을 버린다: %s %s원", o.label, o.deposit)
    return [o for o in options if id(o) not in bad]


def _floor_of_room(room: str | None) -> int | None:
    if not room or len(room) < 3:
        return None
    return int(room[:-2]) or None


def _last_kind(context: str) -> str | None:
    hits = list(_KIND.finditer(_flat(context)))
    return f"{hits[-1].group(1)}공급" if hits else None


# 표 위 띠에서 제목으로 볼 줄 수. 그 위는 앞 표의 본문 글자가 섞여 들어와 남의 계층을 물려받는다
CONTEXT_TITLE_LINES = 3


def _tenant_from_context(context: str, *, loose: bool = False) -> str | None:
    """표 제목 「- 청년(40세대), 임대 보증금 및 월임대료」 「신혼부부(16세대)」에서 공급대상을 읽는다. 마지막 줄이 표에 가장 가깝다."""
    title = chr(10).join(context.splitlines()[-CONTEXT_TITLE_LINES:]) if loose else context
    flat = _flat(title)
    hits = [(m.start(), m.group(0)) for m in re.finditer(r"청년/?신혼부부|신혼부부|청년|1인가구", flat)]
    if not hits:
        return None
    # 제목 줄에서 「청년(40세대)」처럼 세대수가 붙은 것만 센다. 「청년(135세대), 신혼부부(192세대)」처럼 둘이면
    # 표에 유형 칸이 없어 줄을 못 가른다 — 둘 다 적는다(포레나 당산 2022)
    counted: list[str] = []
    for pos, word in hits:
        if re.match(r"\(\d+세대\)", flat[pos + len(word):]) and word not in counted:
            counted.append(word)
    if not counted and loose:
        counted = list(dict.fromkeys(w for _, w in hits))
    if not counted:
        return None
    return _tenant("/".join(counted)) if len(counted) > 1 else _tenant(counted[0])


# ---------------------------------------------------------------- 공고 단위 집계

@dataclass
class YouthAttachFacts:
    lines: list[SupplyLine]
    pages: list[int] = field(default_factory=list)

    @property
    def min_deposit(self) -> int | None:
        xs = [o.deposit for ln in self.lines for o in ln.options if o.deposit is not None]
        return min(xs) if xs else None

    @property
    def max_deposit(self) -> int | None:
        xs = [o.deposit for ln in self.lines for o in ln.options if o.deposit is not None]
        return max(xs) if xs else None

    @property
    def min_rent(self) -> int | None:
        xs = [o.rent for ln in self.lines for o in ln.options if o.rent is not None]
        return min(xs) if xs else None

    @property
    def max_rent(self) -> int | None:
        xs = [o.rent for ln in self.lines for o in ln.options if o.rent is not None]
        return max(xs) if xs else None

    @property
    def area_min(self) -> Decimal | None:
        xs = [ln.area for ln in self.lines if ln.area is not None]
        return min(xs) if xs else None

    @property
    def area_max(self) -> Decimal | None:
        xs = [ln.area for ln in self.lines if ln.area is not None]
        return max(xs) if xs else None


# 좌표로 읽은 줄이 이 비율만큼 비율 라벨(30%·40%)을 달고 있어야 표를 알아본 것으로 본다
UNDERSTOOD_MIN = 0.8


def _if_understood(lines: list[SupplyLine]) -> list[SupplyLine]:
    """괘선 없는 조판을 좌표로 읽은 결과가 믿을 만한지 본다.

    머리를 제대로 세웠으면 금액마다 비율(「보증금 30%」)이 붙는다. 비율이 안 붙었다는 건 열을 잘못 갈랐다는 뜻이고,
    그때는 임대료도 같이 어긋나 있다 — 화면에 「보증금만 있고 월세는 모름」으로 싣느니 표가 없다고 본다.
    """
    if not lines:
        return lines
    ok = sum(1 for ln in lines if _sane(ln))
    if ok >= UNDERSTOOD_MIN * len(lines):
        return lines
    log.info("좌표로 읽은 표를 버린다 — 앞뒤가 맞는 줄 %d/%d", ok, len(lines))
    return []


def _sane(ln: SupplyLine) -> bool:
    """비율마다 금액이 제 자리에 들어갔는지 — 보증금은 비율 따라 오르고 월임대료는 내린다.

    열을 한 칸 밀려 읽으면 비율이 겹치거나(같은 「85%」가 둘) 월임대료가 열 배로 튄다. 그 표는 통째로 못 믿는다.
    """
    opts = [o for o in ln.options if o.ratio]
    if len(opts) != len(ln.options) or not opts:
        return False
    if len({o.ratio for o in opts}) != len(opts):
        return False
    opts = sorted(opts, key=lambda o: o.ratio)
    deposits = [o.deposit for o in opts if o.deposit is not None]
    rents = [o.rent for o in opts if o.rent is not None]
    if len(rents) != len(opts):
        return False
    return deposits == sorted(deposits) and rents == sorted(rents, reverse=True)


def parse_pdf(path: str | Path) -> YouthAttachFacts:
    tables = tables_from_pdf(path)
    lines = lines_from_tables(tables)
    if not lines:
        # 괘선으로는 한 줄도 못 읽었다 — 세로 괘선을 안 그린 옛 조판(2019~2022)일 수 있다. 글자 좌표로 다시 읽는다.
        # 괘선으로 읽히는 공고는 이 길로 오지 않는다 — 멀쩡한 결과를 새 경로가 덮어쓰지 않게
        lines = _if_understood(lines_from_tables(tables_from_pdf(path, words=True)))
    return YouthAttachFacts(lines=lines, pages=sorted({ln.page for ln in lines}))


def supply_rows(facts: YouthAttachFacts, *, complex_name: str, is_new: bool) -> list[dict[str, Any]]:
    """notice_supply 행. 같은 (공급대상, 특별/일반, 유형)은 한 줄로 합친다 — 호실 단위 표는 호실마다 줄이 나오므로."""
    merged: dict[tuple[str, str | None, str], dict[str, Any]] = {}
    for ln in facts.lines:
        key = (ln.tenant_class, ln.supply_kind, ln.supply_type)
        row = merged.get(key)
        if row is None:
            row = merged[key] = {
                "complex_name": complex_name, "supply_type": ln.supply_type, "accessible": False,
                "tenant_class": ln.tenant_class, "income_option": ln.supply_kind, "is_new": is_new,
                "units_total": None, "units_priority": None, "units_general": None, "units_reserve": None,
                "deposit": None, "down_payment": None, "balance": None, "rent": None,
                "area_exclusive": ln.area, "area_common": None, "area_etc": None, "area_total": None,
                "move_in_from": ln.move_in, "source_page": ln.page, "_options": [],
            }
        if ln.count is not None:
            row["units_total"] = (row["units_total"] or 0) + ln.count
        if row["move_in_from"] is None:
            row["move_in_from"] = ln.move_in
        for o in ln.options:
            # 같은 비율 라벨이 호실마다 다른 금액으로 들어온다 — 줄 하나에는 라벨마다 하나만, 보증금이 가장 낮은 것으로.
            # 호실별 금액은 unit 표가 말한다
            prev = next((x for x in row["_options"] if x["label"] == o.label), None)
            if prev is None:
                row["_options"].append(o.as_json())
            elif o.deposit is not None and (prev["deposit"] is None or o.deposit < prev["deposit"]):
                row["_options"][row["_options"].index(prev)] = o.as_json()
    rows = []
    for row in merged.values():
        opts = row.pop("_options")
        priced = [o for o in opts if o["deposit"] is not None]
        base = min(priced, key=lambda o: o["deposit"]) if priced else (opts[0] if opts else None)
        row["deposit"] = base["deposit"] if base else None
        row["rent"] = base["rent"] if base else None
        row["deposit_options"] = json.dumps(opts, ensure_ascii=False) if opts else None
        rows.append(row)
    return rows


def unit_rows(facts: YouthAttachFacts, *, complex_name: str, road_address: str, sido: str, sigungu: str) -> list[dict[str, Any]]:
    """호실 단위 표(「1701호」)만 unit 행이 된다. unit은 면적·보증금·임대료가 NOT NULL이라 하나라도 비면 건너뛴다."""
    rows = []
    seen: dict[str, int] = {}
    for i, ln in enumerate(l for l in facts.lines if l.room):
        base = ln.base
        if ln.area is None or base is None or base.deposit is None or base.rent is None:
            log.warning("호실 %s: 면적·금액이 비어 건너뛴다", ln.room)
            continue
        key = ln.room
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            key = f"{key}-{seen[key]}"
        rows.append({
            "complex_code": None, "unit_key": key, "road_address": road_address, "complex_name": complex_name,
            "building": None, "room": ln.room, "floor": ln.floor, "sido": sido, "sigungu": sigungu,
            "area_m2": ln.area, "deposit": base.deposit, "rent": base.rent,
            "deposit_jeonse": None, "rent_jeonse": None, "deposit_wolse": None, "rent_wolse": None,
            "room_layout": None, "elevator": None, "has_elevator": None, "seq": i + 1, "source_page": ln.page,
        })
    return rows
