"""SH 특화형 매입임대주택(구 사회적주택) 공고문 파서 — 1쪽 「Ⅱ. 공급주택」 표와 「Ⅰ. 모집일정」 흐름도.

정답지: 309802(금천구 소담 404호, 2026-09-10) · 309807(강동구 리츠하우스 203호, 2026-09-07).

이 양식은 운영기관(사회적협동조합 등)에 임대운영을 맡긴 물건이라 **호실 한 채가 공고 한 건**이다.
서울주거포털에도 m_241 게시판에도 안 올라오고 인터넷청약시스템 게시판(m_247)에만 뜬다.

1쪽 생김새(글자 좌표 기준):
- `Ⅱ. 공급주택 : 서울특별시 금천구 시흥대로8길 18 소담 404호`  ← 주소·건물명·호수가 한 줄
- 표 머리 두 줄: 「공급대상 | 방개수 | 면적(㎡) | 임대조건(원) | 모집호수」 / 「계 | 전용 | 공용 | 보증금 | 임대료」
- 표 몸 한 줄: `404호 | 0 | 33.86 | 26.29 | 7.57 | 36,750,000 | 255,000 | 1호`
- `※ 입주가능일 : 2026년 10월 12일`
- 모집일정 흐름도: 모집공고 → 서류접수 → 자격심사 → 주택개방 → 대상자발표 → 계약체결. 날짜는 라벨 아래 두 줄(시작/~마감).

숫자는 Synap이 **같은 글자가 잇달으면 하나를 안 그린다**(parsers/synap_repair). 그래서 금액·면적은
글자 x 좌표의 빈 자리를 찾아 되메운 뒤에 읽는다. 못 메우면 그 칸만 None으로 둔다 — 지어내지 않는다.
20쪽 입주신청서에도 같은 표가 한 번 더 나오지만 1쪽만 읽는다(같은 값, 열 폭만 다르다).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date

from ..sources.ish import Segment, group_rows, parse_chars, row_segments
from .synap_repair import HOLE, holes_by_x, read_number, repair, repair_text

log = logging.getLogger(__name__)

TITLE_RE = re.compile(r"특화형\s*매입임대주택\s*[\[(]?\s*(?P<cls>청년|고령자|신혼부부|장애인|일반)?")
SUPPLY_HEAD_RE = re.compile(r"^Ⅱ\s*\.?\s*공급주택\s*[:：]\s*(?P<addr>.+)$")
MOVE_IN_RE = re.compile(r"입주가능일\s*[:：]?\s*(?P<y>\d{4})\s*년\s*(?P<m>\d{1,2})\s*월\s*(?P<d>\d{1,2})\s*일")
ROOM_RE = re.compile(r"^\d+(?:-\d+)?호$")
UNITS_RE = re.compile(r"^(\d+)\s*호$")
ADDRESS_RE = re.compile(
    r"^(?P<sido>\S+?(?:특별시|광역시|특별자치시|도|특별자치도))\s+"
    r"(?P<sigungu>\S+?[구시군])\s+"
    r"(?P<road>\S*(?:로|길))\s+"
    r"(?P<bno>\d+(?:-\d+)?)\s*"
    r"(?P<name>.*?)\s*"
    r"(?P<room>\d+(?:-\d+)?호)$"
)

# 표 머릿글 → 열 이름. 두 줄로 나뉘어 있어 각각 찾는다.
HEAD_LOWER = {"계": "area_total", "전용": "area_exclusive", "공용": "area_common",
              "보증금": "deposit", "임대료": "rent"}
HEAD_UPPER = {"공급대상": "target", "방개수": "rooms", "모집호수": "units"}
HEAD_UPPER_RE = {"target": re.compile(r"^공급\s*대상$"), "rooms": re.compile(r"^방\s*개수$"),
                 "units": re.compile(r"^모집\s*호수$")}

SCHEDULE_LABELS = {"모집공고": "notice", "서류접수": "apply", "자격심사": "screen",
                   "주택개방": "open", "대상자발표": "announce", "계약체결": "contract"}
AREA_SCALE = 100.0
ROOM_LAYOUT = {0: "원룸", 1: "원룸", 2: "투룸", 3: "쓰리룸"}
DATE_BELOW_PX = 60      # 흐름도 라벨 아래 이만큼에서 날짜를 찾는다
ROW_BAND_PX = 16        # 한 줄로 볼 세로 폭. 쉼표·마침표는 숫자보다 10px쯤 아래에 그려진다
LINE_GAP_PX = 8         # 흐름도 날짜 두 줄(시작/~마감)을 가르는 세로 간격


@dataclass(frozen=True)
class TeukhwaHouse:
    """공급주택 한 채. 이 양식은 공고 1건에 한 채다(첨부가 여럿이면 첨부마다 한 채)."""

    address: str            # 원문 그대로
    sido: str
    sigungu: str
    road_address: str       # 시군구부터 — notice_complex.road_address 규칙
    name: str               # 건물명. 없으면 도로명주소로 대신한다
    room: str               # "404호"
    rooms: int | None       # 방 개수
    area_total: float | None
    area_exclusive: float | None
    area_common: float | None
    deposit: int | None
    rent: int | None
    units: int | None       # 모집호수
    move_in: date | None
    page: int

    @property
    def room_layout(self) -> str | None:
        return ROOM_LAYOUT.get(self.rooms) if self.rooms is not None else None


@dataclass(frozen=True)
class TeukhwaFacts:
    houses: list[TeukhwaHouse]
    apply_start: date | None = None
    apply_end: date | None = None
    tenant_class: str = "일반공급"   # 공고문 제목의 「특화형 매입임대주택[청년]」


def _center(seg: Segment) -> float:
    return (seg.l + seg.r) / 2


def _address_line(xml: str) -> str | None:
    """「Ⅱ. 공급주택 : …」 줄. 주소에서도 글자가 떨어지므로(「시흥대로88길」→「시흥대로8길」) 되메워서 읽는다."""
    for row in group_rows(parse_chars(xml)):
        text = repair_text([(c.l, c.w, c.ch) for c in row])
        m = SUPPLY_HEAD_RE.match(text.strip())
        if m:
            return m.group("addr").strip()
    return None


def _rows(xml: str) -> list[tuple[float, list[Segment]]]:
    rows = group_rows(parse_chars(xml))
    return [(r[0].t, row_segments(r)) for r in rows]


def _bounds(anchors: list[tuple[float, str]]) -> list[tuple[float, float, str]]:
    """열 중심 x 목록 → (왼쪽, 오른쪽, 열 이름). 경계는 이웃 중심의 가운데."""
    anchors = sorted(anchors)
    out: list[tuple[float, float, str]] = []
    for i, (x, name) in enumerate(anchors):
        lo = -1e9 if i == 0 else (anchors[i - 1][0] + x) / 2
        hi = 1e9 if i == len(anchors) - 1 else (anchors[i + 1][0] + x) / 2
        out.append((lo, hi, name))
    return out


def _cell_chars(chars, lo: float, hi: float, t0: float, band: float = ROW_BAND_PX):
    """열 x 범위 · 줄 y 범위 안의 글자를 (x, 글자)로. 쉼표·마침표가 아랫줄에 그려지므로 아래로 넉넉히 본다."""
    return [(c.l, c.ch) for c in chars
            if lo <= c.l + c.w / 2 < hi and t0 - 4 <= c.t <= t0 + band and c.ch.strip()]


def _area(chars) -> float | None:
    v = read_number(chars)
    if v is None:
        return None
    f = v / AREA_SCALE
    return f if 0 < f < 1000 else None


def _find_table(rows) -> tuple[int, list[tuple[float, str]]] | None:
    """「계·전용·공용·보증금·임대료」 머릿줄을 찾아 (줄 번호, 열 중심) 목록. 못 찾으면 None."""
    for i, (_t, segs) in enumerate(rows):
        names = {s.text.strip() for s in segs}
        if not {"계", "전용", "공용", "보증금", "임대료"} <= names:
            continue
        anchors = [(_center(s), HEAD_LOWER[s.text.strip()]) for s in segs if s.text.strip() in HEAD_LOWER]
        # 「공급대상·방개수·모집호수」는 한 줄 위에 있다(면적·임대조건 묶음 머리와 같은 줄)
        for _t2, up in rows[max(0, i - 3):i]:
            for s in up:
                for key, pat in HEAD_UPPER_RE.items():
                    if pat.match(s.text.strip()):
                        anchors.append((_center(s), key))
        return i, anchors
    return None


def _data_row(rows, head_idx: int) -> tuple[float, list[Segment]] | None:
    """머릿줄 아래 첫 몸줄 — 맨 왼쪽 칸이 「404호」 꼴이다."""
    for t, segs in rows[head_idx + 1:head_idx + 6]:
        if segs and ROOM_RE.match(segs[0].text.strip()):
            return t, segs
    return None


def _parse_date_digits(digits: str | None) -> date | None:
    """「260910」·「20260910」 → date. 자릿수가 안 맞으면 None."""
    if not digits:
        return None
    if len(digits) == 6:
        digits = "20" + digits
    if len(digits) != 8:
        return None
    try:
        return date(int(digits[:4]), int(digits[4:6]), int(digits[6:]))
    except ValueError:
        return None


def _schedule(rows, chars) -> tuple[date | None, date | None]:
    """흐름도의 「서류접수」 칸 → (시작, 마감). 라벨 아래 두 줄에 시작·~마감이 한 줄씩 있다."""
    for i, (_t, segs) in enumerate(rows):
        labels = [(s, SCHEDULE_LABELS[s.text.replace(" ", "")]) for s in segs
                  if s.text.replace(" ", "") in SCHEDULE_LABELS]
        if len(labels) < 4:
            continue
        bounds = _bounds([(_center(s), name) for s, name in labels])
        lo, hi = next(((lo, hi) for lo, hi, name in bounds if name == "apply"), (None, None))
        if lo is None:
            return None, None
        t0 = rows[i][0]
        below = [c for c in chars if lo <= c.l + c.w / 2 < hi and t0 < c.t <= t0 + DATE_BELOW_PX and c.ch.isdigit()]
        lines = _digit_lines(below)
        if not lines:
            return None, None
        # 시작 줄과 「~마감」 줄이 세로로 붙어 있다. 한 줄뿐이면 시작일만 읽는다
        return _line_date(lines[0]), (_line_date(lines[1]) if len(lines) > 1 else None)
    return None, None


def _digit_lines(chars) -> list[list[tuple[float, str]]]:
    """숫자 글자를 줄(t)별로 묶는다. 쉼표·마침표는 이미 빠졌으므로 같은 줄 숫자는 t가 거의 같다."""
    out: list[list[tuple[float, str]]] = []
    for c in sorted(chars, key=lambda c: (c.t, c.l)):
        if out and abs(c.t - out[-1][-1][2]) <= LINE_GAP_PX:
            out[-1].append((c.l, c.ch, c.t))
        else:
            out.append([(c.l, c.ch, c.t)])
    return [[(l, ch) for l, ch, _t in line] for line in out]


def _line_date(cells: list[tuple[float, str]]) -> date | None:
    """날짜 한 줄의 숫자 → date.

    맨 뒤에서 떨어진 글자(「26.09.11」의 둘째 1)는 x 간격에 구멍을 남기지 않는다 — 뒤에 잴 글자가 없다.
    그래서 자릿수가 모자라면 구멍을 한 자리씩 끼워 넣어 보고, **말이 되는 날짜가 하나뿐일 때만** 쓴다.
    """
    if not cells:
        return None
    # 흐름도 날짜는 표 칸이 아니라 흐르는 글줄이라 글자 간격이 들쭉날쭉하다 — x 좌표로 구멍을 세지 않고
    # 자릿수로 본다(날짜는 6자리 아니면 8자리다).
    shown = "".join(ch for _x, ch in sorted(cells))
    direct = _parse_date_digits(shown)
    if direct:
        return direct
    if len(shown) + 1 not in (6, 8):
        return None
    found = {d for k in range(len(shown) + 1)
             for d in [_parse_date_digits(repair(shown[:k] + HOLE + shown[k:]))] if d}
    return next(iter(found)) if len(found) == 1 else None


def parse_teukhwa(pages: list[tuple[int, str]]) -> TeukhwaFacts | None:
    """특화형 양식이면 TeukhwaFacts, 아니면 None."""
    for page, xml in pages[:3]:
        rows = _rows(xml)
        text = " ".join(s.text for _t, segs in rows for s in segs)
        title = TITLE_RE.search(text)
        if not title:
            continue
        addr_line = _address_line(xml)
        table = _find_table(rows)
        if addr_line is None or table is None:
            continue
        head_idx, anchors = table
        data = _data_row(rows, head_idx)
        if data is None:
            continue
        chars = parse_chars(xml)
        t0, _segs = data
        cells = {name: _cell_chars(chars, lo, hi, t0) for lo, hi, name in _bounds(anchors)}
        move_in = next((date(int(m.group("y")), int(m.group("m")), int(m.group("d")))
                        for _t, segs in rows
                        for m in [MOVE_IN_RE.search(" ".join(s.text for s in segs))] if m), None)
        house = _house(addr_line, cells, move_in, page)
        if house is None:
            continue
        start, end = _schedule(rows, chars)
        return TeukhwaFacts(houses=[house], apply_start=start, apply_end=end,
                            tenant_class=title.group("cls") or "일반공급")
    return None


def _house(addr_line: str, cells: dict, move_in: date | None, page: int) -> TeukhwaHouse | None:
    addr = re.sub(r"\s*,\s*$", "", addr_line).strip()
    m = ADDRESS_RE.match(addr)
    if m is None:
        log.warning("특화형: 주소를 못 가름 — %s", addr)
        return None
    road_address = f"{m.group('sigungu')} {m.group('road')} {m.group('bno')}"
    units_text = "".join(ch for _x, ch in sorted(cells.get("units", [])))
    units_m = UNITS_RE.match(units_text.strip())
    return TeukhwaHouse(
        address=addr,
        sido=m.group("sido"),
        sigungu=m.group("sigungu"),
        road_address=road_address,
        name=m.group("name").strip() or road_address,
        room=m.group("room"),
        rooms=read_number(cells.get("rooms", [])),
        area_total=_area(cells.get("area_total", [])),
        area_exclusive=_area(cells.get("area_exclusive", [])),
        area_common=_area(cells.get("area_common", [])),
        deposit=read_number(cells.get("deposit", [])),
        rent=read_number(cells.get("rent", [])),
        units=int(units_m.group(1)) if units_m else None,
        move_in=move_in,
        page=page,
    )
