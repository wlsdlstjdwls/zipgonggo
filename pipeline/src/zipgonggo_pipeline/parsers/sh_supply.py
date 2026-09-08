"""SH 장기전세 공고문 「공급현황」 표 파서 — 전세금액·호수·전용면적.

정답지: 제51차 장기전세(309467) 13쪽 신규공급 표(단지 이름 | 전용면적 | 공급호수 계·일반·우선 | 전세금액(천 원) 계·계약금·잔금 | …),
15~19쪽 재공급 표(자치구 | 단지명 | 전용면적 | 유형 | 모집호수 | 전세금액 계·계약금·잔금 | …).

같은 글자 좌표 접근: 헤더 「전세금액」 칸의 x 범위를 잡고, 데이터 줄에서 그 범위 안 첫 숫자를 전세금 계(천 원)로 읽는다.
호수는 유형(일반·주거약자·우선) 글자 오른쪽 첫 숫자, 유형 글자가 없는 신규 표는 면적 다음 숫자(계).

재공급 표의 단지명 칸은 지구 단위 세로 병합(세곡지구 - 강남데시앙파크, 강남신동아파밀리에 2·3단지 …)이라
단지별 금액 배정은 아직 안 한다. 공고 단위 집계(최소·최대 전세금, 총 호수)만 낸다.
신규공급 표는 단지 이름이 행마다 있어 단지별로 낸다(이름 줄이 데이터 줄 바로 위에 따로 오는 경우 포함).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..sources.ish import group_rows, parse_chars, row_segments

DEPOSIT_HEADER_RE = re.compile(r"^(?:전세금액|임대보증금|보증금)\s*(?:\([^)]*\))?$")
# 표로 인정하려면 헤더 묶음에 호수 열이 있어야 한다. 보증금↔월세 전환표(자치구|단지|면적|임대보증금|월임대료)에는 없다
UNIT_HEADER_RE = re.compile(r"모집\s*세대수|공급\s*세대수|공급\s*호수|세대\s*수|호수")
MAX_UNITS_PER_ROW = 2000   # 한 행(단지·면적·유형)의 호수 상한. 넘으면 금액을 호수로 읽은 것
NAME_HEADER_RE = re.compile(r"단지\s*(?:이름|명)")
KIND_RE = re.compile(r"^(일반|주거약자|우선|특별)$")
NUM_RE = re.compile(r"^[\d,]+$")
LOCATION_RE = re.compile(r"^\(.+\)$")
TOTAL_RE = re.compile(r"^계$")
MIN_DEPOSIT_THOUSAND = 10_000   # 천 원 단위 1만 = 1,000만 원. 이보다 작은 숫자는 전세금이 아니다
MIN_AREA, MAX_AREA = 15.0, 200.0
NAME_SLACK = 90.0               # 단지명 칸으로 볼 수 있는 오른쪽 한계(전세금 헤더 왼쪽 끝 기준, px)
HEADER_SPAN = 6                 # 헤더 판정 시 위아래로 함께 보는 줄 수


@dataclass
class ComplexSupply:
    name: str
    unit_count: int = 0
    min_deposit: int | None = None   # 원
    max_deposit: int | None = None
    area_min: float | None = None
    area_max: float | None = None
    page: int | None = None


@dataclass
class SupplySummary:
    min_deposit: int | None = None   # 원
    max_deposit: int | None = None
    unit_total: int = 0
    rows: int = 0
    pages: list[int] = field(default_factory=list)
    complexes: list[ComplexSupply] = field(default_factory=list)


@dataclass
class _Cell:
    l: float
    r: float
    t: float
    text: str

    @property
    def cx(self) -> float:
        return (self.l + self.r) / 2


def _num(text: str) -> int | None:
    t = text.replace(",", "")
    return int(t) if t.isdigit() else None


def _deposit_thousand(token: str) -> int | None:
    """전세금 계(천 원). 6~7자리가 정상. 칸이 붙어 "45864045864412776…"처럼 길면
    앞 6·7자리를 떼고 그 다음이 10%(계약금)인지 확인해 맞는 쪽을 쓴다."""
    d = token.replace(",", "")
    if not d.isdigit():
        return None
    if len(d) <= 7:
        v = int(d)
        return v if v >= MIN_DEPOSIT_THOUSAND else None
    for n in (6, 7):
        head = int(d[:n])
        tenth = str(head // 10)
        if d[n : n + len(tenth)] == tenth and head >= MIN_DEPOSIT_THOUSAND:
            return head
    return None


def _cells_by_row(xml: str) -> list[list[_Cell]]:
    rows: list[list[_Cell]] = []
    for row in group_rows(parse_chars(xml)):
        t = min(c.t for c in row)
        cells = [_Cell(s.l, s.r, t, s.text) for s in row_segments(row)]
        if cells:
            rows.append(cells)
    return rows


def _find_header(rows: list[list[_Cell]]) -> tuple[int, _Cell] | None:
    """보증금 열 헤더. 라벨 하나만 있는 칸이어야 하고(본문 문장 배제),
    위아래 HEADER_SPAN줄 안에 호수 열 헤더가 같이 있어야 한다(전환표·안내표 배제)."""
    for i, cells in enumerate(rows):
        for c in cells:
            if not DEPOSIT_HEADER_RE.match(c.text.replace(" ", "")):
                continue
            near = [x.text for cs in rows[max(0, i - HEADER_SPAN) : i + HEADER_SPAN] for x in cs]
            if any(UNIT_HEADER_RE.search(t.replace(" ", "")) for t in near):
                return i, c
    return None


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", "", s.replace("[신규]", ""))


def parse_supply_page(xml: str, page: int, summary: SupplySummary) -> int:
    """한 쪽을 읽어 summary에 더한다. 돌려주는 값은 읽은 데이터 줄 수."""
    rows = _cells_by_row(xml)
    hit = _find_header(rows)
    if hit is None:
        return 0
    hidx, dep = hit
    # 「전세금액」 헤더 글자는 계·계약금·잔금 세 칸 위 가운데에 걸쳐 있어 열 x범위를 그대로 믿을 수 없다(쪽마다 어긋난다).
    # 대신 행 규칙을 쓴다: 왼쪽부터 첫 「큰 숫자」(천 원 단위 1만 이상)가 전세금 계다.
    # 호수는 수백 이하, 전용면적은 200 이하라 걸러지고, 계약금(10%)·잔금(90%)은 계보다 오른쪽이라 뒤에 온다.
    header_texts = [c.text for cells in rows[hidx : hidx + 5] for c in cells]
    per_complex = any(NAME_HEADER_RE.search(t) or t == "(위치)" for t in header_texts) and not any("자치구" in t for t in header_texts)
    name_col_r = dep.l - NAME_SLACK  # 단지명 후보는 전세금 칸 왼쪽
    current: ComplexSupply | None = None
    read = 0
    for cells in rows[hidx + 1 :]:
        texts = [c.text for c in cells]
        # 이름 줄: 숫자·괄호·유형이 아닌 한글 칸이 왼쪽 끝에 있으면 새 단지
        first = cells[0]
        if per_complex and first.r < name_col_r and not NUM_RE.match(first.text) and not LOCATION_RE.match(first.text) \
                and not KIND_RE.match(first.text) and not TOTAL_RE.match(first.text) and re.search(r"[가-힣]", first.text) \
                and len(first.text) >= 2 and not first.text.startswith(("※", "○", "-", "▶", "➜", "□")):
            current = ComplexSupply(name=_norm_name(first.text), page=page)
            summary.complexes.append(current)
        # 전세금 계: 왼쪽부터 첫 큰 숫자(천 원)
        deposit_k = None
        dep_x = None
        for c in cells:
            v = _deposit_thousand(c.text.split(" ")[0])
            if v is not None:
                deposit_k, dep_x = v, c.l
                break
        if deposit_k is None or dep_x is None:
            continue
        # 호수·면적: 전세금 칸 왼쪽의 칸들
        left = [c for c in cells if c.l < dep_x]
        kind_i = next((i for i, c in enumerate(left) if KIND_RE.match(c.text)), None)
        units = None
        area = None
        if kind_i is not None:
            nums_after = [_num(c.text) for c in left[kind_i + 1 :]]
            nums_after = [n for n in nums_after if n is not None]
            units = nums_after[0] if nums_after else None
            nums_before = [_num(c.text) for c in left[:kind_i]]
            nums_before = [n for n in nums_before if n is not None and MIN_AREA <= n <= MAX_AREA]
            area = float(nums_before[-1]) if nums_before else None
        else:
            nums = [_num(c.text) for c in left]
            nums = [n for n in nums if n is not None]
            if len(nums) >= 2 and MIN_AREA <= nums[0] <= MAX_AREA:
                area, units = float(nums[0]), nums[1]
            elif nums:
                units = nums[0]
        if units is None or units > MAX_UNITS_PER_ROW:
            continue
        won = deposit_k * 1000
        read += 1
        summary.rows += 1
        summary.unit_total += units
        summary.min_deposit = won if summary.min_deposit is None else min(summary.min_deposit, won)
        summary.max_deposit = won if summary.max_deposit is None else max(summary.max_deposit, won)
        if per_complex and current is not None:
            current.unit_count += units
            current.min_deposit = won if current.min_deposit is None else min(current.min_deposit, won)
            current.max_deposit = won if current.max_deposit is None else max(current.max_deposit, won)
            if area is not None:
                current.area_min = area if current.area_min is None else min(current.area_min, area)
                current.area_max = area if current.area_max is None else max(current.area_max, area)
    if read:
        summary.pages.append(page)
    return read


def parse_supply(pages: list[tuple[int, str]]) -> SupplySummary | None:
    summary = SupplySummary()
    for page, xml in pages:
        parse_supply_page(xml, page, summary)
    summary.complexes = [c for c in summary.complexes if c.unit_count > 0]
    return summary if summary.rows else None
