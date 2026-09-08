"""SH 매입임대 공고문 「[별첨1] 주택목록」 파서 — 호실 단위 표(가로표를 90° 눕혀 실은 별첨).

정답지: 2026년 2차 장기미임대 매입임대주택(i-sh seq=309403) 24~35쪽, 133단지/476호.
헤더: 연번 | 자치구 | 주택단지(코드 0001J) | 주택명(지번) | 호 | 주소 | 전용면적 | 구조 | 승강기
      | 기준 임대보증금·임대료 | 전세전환(80%) 임대보증금·임대료 | 월세전환(60%) 임대보증금·임대료

실측(2026-09-08)에서 나온 함정:
- 칸 사이 간격이 좁아 x 간격 분할이 섞인다(코드+주택명+호, 면적+구조, 구조+승강기, 금액 4개가 한 칸). 칸은 내용으로 식별한다.
- 소수점 '.'이 텍스트 레이어에 거의 없다(쪽당 2개). 전용면적은 자리수로 복원한다: 4자리→/100 (4219→42.19), 3자리→/10 (555→55.5).
- 자치구 칸은 세로 병합이라 첫 행에만 붙어 온다("강남구0001J") — 주소에서 도출하므로 버린다.
- 쪽마다 제본 여백이 달라 x 절대값은 쓰지 않는다. 헤더 줄도 칸이 섞여 못 믿는다 — 행 자체의 형태(연번·코드·호·주소)로 판정.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from ..sources.ish import ROTATED_SLACK, group_rows, is_rotated, parse_chars, row_segments, transpose

log = logging.getLogger(__name__)

SEQ_RE = re.compile(r"^\d{1,3}$")
CODE = r"(?:[가-힣]+(?:구|시))?(?P<code>\d{4}[A-Z])"
CODE_RE = re.compile(rf"^{CODE}$")
CODE_NAME_HO_RE = re.compile(rf"^{CODE}\s*(?P<name>.*?)\s*(?P<ho>\d{{4}})$")   # 코드+주택명+호 한 칸
NAME_HO_RE = re.compile(r"^(?P<name>.*?\))\s*(?P<ho>\d{4})$")                 # 주택명+호 한 칸
HO_RE = re.compile(r"^\d{4}$")
ADDR_RE = re.compile(
    r"^(?P<sido>서울특별시|서울시|경기도|인천광역시)\s*(?P<sigungu>[가-힣]+(?:구|시))\s*"
    r"(?P<road>[^()]+(?:로|길)\s*\d+(?:-\d+)?)\s*"  # 탐욕: 괄호 전까지 가장 긴 '…로/길 번지'. 비탐욕이면 '개포로17길 9-12'가 '개포로17'에서 끊긴다
    r"(?:\((?P<paren>[^)]*)\))?\s*(?P<tail>.*)$"
)
DONG_RE = re.compile(r"(제?\d+동|[가-힣]동(?=\s|\d|$))")
HO_TAIL_RE = re.compile(r"(\d{1,4})호")
AREA_RE = re.compile(r"^(\d{2,4})(?:\.(\d{1,2}))?\s*(.*)$")
ELEVATOR_RE = re.compile(r"(미설치|전체동\s*설치|일부\s*설치|설치)\s*$")
MONEY_RE = re.compile(r"\d{1,3}(?:,\d{3})+|\d{4,}")


@dataclass(frozen=True)
class UnitRow:
    seq: int
    code: str            # 주택단지 코드 (0001J)
    building: str        # 주택명 (지번 괄호 뗌)
    jibun: str           # 괄호 안 지번
    ho: str              # 0203
    sido: str
    sigungu: str
    road_address: str    # 시군구부터. 동·호 없음
    dong: str | None
    area: float | None   # 전용면적 ㎡
    structure: str | None
    elevator: str | None
    deposit: int | None      # 기준 임대보증금
    rent: int | None         # 기준 월임대료
    deposit_jeonse: int | None
    rent_jeonse: int | None
    deposit_wolse: int | None
    rent_wolse: int | None
    page: int


@dataclass
class UnitComplex:
    """같은 단지코드의 호실 묶음 → notice_complex 1행."""

    code: str
    name: str
    sido: str
    sigungu: str
    road_address: str
    page: int
    units: list[UnitRow] = field(default_factory=list)

    @property
    def unit_count(self) -> int:
        return len(self.units)

    def _agg(self, attr: str, fn):
        vals = [getattr(u, attr) for u in self.units if getattr(u, attr) is not None]
        return fn(vals) if vals else None

    @property
    def min_deposit(self) -> int | None:
        return self._agg("deposit", min)

    @property
    def min_rent(self) -> int | None:
        return self._agg("rent", min)

    @property
    def area_min(self) -> float | None:
        return self._agg("area", min)

    @property
    def area_max(self) -> float | None:
        return self._agg("area", max)


def _money(s: str | None) -> int | None:
    return int(s.replace(",", "")) if s else None


def _area(intpart: str, frac: str | None) -> float:
    if frac:
        return float(f"{intpart}.{frac}")
    # 소수점 유실. 주거 전용면적은 10~200㎡ 대라 자리수로 복원한다
    n = int(intpart)
    if len(intpart) >= 4:
        return n / 100
    if len(intpart) == 3:
        return n / 10
    return float(n)


def _split_name(name_raw: str) -> tuple[str, str]:
    m = re.match(r"^(.*?)\s*\(([^)]*)\)?\s*$", name_raw.strip())
    if not m:
        return name_raw.strip(), ""
    return m.group(1).strip(), m.group(2).strip()


CODE_ANY_RE = re.compile(rf"^{CODE}(?P<rest>.*)$")
SIDO_POS_RE = re.compile(r"서울특별시|서울시|경기도|인천광역시")


def parse_unit_row(segs: list[str], page: int) -> UnitRow | None:
    """칸 텍스트 목록 → 호실. 단지코드 칸을 먼저 찾고, 그 앞에서 연번, 뒤에서 주택명·호·주소를 잡는다.

    세로 병합된 자치구 글자 조각('작', '20')이 연번 앞뒤에 끼거나, 호+주소+면적이 한 칸으로 붙어도 읽힌다.
    """
    segs = [s for s in segs if s]
    if len(segs) < 4:
        return None
    code_i = next((i for i, s in enumerate(segs[:4]) if CODE_ANY_RE.match(s.replace(" ", ""))), None)
    if code_i is None:
        return None
    seq_s = next((segs[i] for i in range(code_i - 1, -1, -1) if SEQ_RE.match(segs[i])), None)
    if seq_s is None:
        return None
    seq = int(seq_s)
    cm = CODE_ANY_RE.match(segs[code_i].replace(" ", ""))
    assert cm
    code = cm.group("code")
    after = [cm.group("rest")] if cm.group("rest") else []
    after += segs[code_i + 1 :]
    # 주소 칸: 그대로거나, 앞에 호(0303)나 주택명까지 붙은 형태. 칸 안에서 시도 표기 위치로 자른다
    addr_i = ho_prefix = None
    addr_text = ""
    prefix = ""
    for i, s in enumerate(after):
        sm = SIDO_POS_RE.search(s)
        if not sm:
            continue
        cand = s[sm.start() :]
        if not ADDR_RE.match(cand):
            continue
        head = s[: sm.start()].strip()
        hp = re.search(r"(\d{4})$", head)
        if hp:
            ho_prefix = hp.group(1)
            head = head[: hp.start()].strip()
        addr_i, addr_text, prefix = i, cand, head
        break
    if addr_i is None:
        return None
    middle = after[:addr_i] + ([prefix] if prefix else [])
    ho = ho_prefix
    if ho is None and middle and HO_RE.match(middle[-1]):
        ho = middle.pop()
    name_raw = " ".join(middle).strip()
    if ho is None:
        m2 = re.match(r"^(?P<name>.*?)\s*(?P<ho>\d{4})$", name_raw)
        if not m2:
            return None
        name_raw, ho = m2.group("name"), m2.group("ho")
    building, jibun = _split_name(name_raw)
    segs = after[addr_i:]  # 이하 addr_i=0 기준
    addr_i = 0

    am = ADDR_RE.match(addr_text)
    assert am
    sido = {"서울시": "서울특별시"}.get(am.group("sido"), am.group("sido"))
    road = re.sub(r"\s+", " ", am.group("road")).strip()
    road = re.sub(r"\s*-\s*", "-", road)
    road_address = f"{am.group('sigungu')} {road}"
    if sido != "서울특별시":
        road_address = f"{sido} {road_address}"
    tail = am.group("tail") or ""
    dm = DONG_RE.search(tail)
    dong = dm.group(1) if dm else None
    # 주소 꼬리에 면적이 붙어 온 경우("401호4705")
    rest_from_tail = ""
    hm = HO_TAIL_RE.search(tail)
    if hm and tail[hm.end() :].strip():
        rest_from_tail = tail[hm.end() :].strip()

    rest = (rest_from_tail + " " + " ".join(segs[addr_i + 1 :])).strip()
    area = structure = elevator = None
    m_area = AREA_RE.match(rest)
    if m_area:
        area = _area(m_area.group(1), m_area.group(2))
        rest = m_area.group(3)
    m_first_money = MONEY_RE.search(rest)
    head = (rest[: m_first_money.start()] if m_first_money else rest).strip()
    money_part = rest[m_first_money.start() :] if m_first_money else ""
    m_el = ELEVATOR_RE.search(head)
    if m_el:
        elevator = re.sub(r"(전체동|일부)\s*설치", r"\1 설치", m_el.group(1))
        head = head[: m_el.start()].strip()
    structure = head or None
    moneys = MONEY_RE.findall(money_part)
    vals = [_money(x) for x in moneys[:6]] + [None] * (6 - min(6, len(moneys)))
    if len(moneys) != 6:
        log.debug("p%d 연번 %d 금액 칸 %d개: %s", page, seq, len(moneys), money_part)
    return UnitRow(
        seq=seq, code=code, building=building, jibun=jibun, ho=ho,
        sido=sido, sigungu=am.group("sigungu"), road_address=road_address, dong=dong,
        area=area, structure=structure, elevator=elevator,
        deposit=vals[0], rent=vals[1], deposit_jeonse=vals[2], rent_jeonse=vals[3], deposit_wolse=vals[4], rent_wolse=vals[5],
        page=page,
    )


def parse_unit_pages(pages: list[tuple[int, str]]) -> list[UnitRow]:
    """회전된 쪽만 골라 호실 행을 읽는다. 연번 중복(쪽 경계 재인쇄)은 첫 것만."""
    out: list[UnitRow] = []
    seen: set[int] = set()
    for page, xml in pages:
        chars = parse_chars(xml)
        if not is_rotated(chars):
            continue
        rows = group_rows(transpose(chars), slack=ROTATED_SLACK)
        for r in rows:
            u = parse_unit_row([s.text for s in row_segments(r)], page)
            if u and u.seq not in seen:
                seen.add(u.seq)
                out.append(u)
    return out


def group_units(units: list[UnitRow]) -> list[UnitComplex]:
    by: dict[str, UnitComplex] = {}
    for u in units:
        c = by.get(u.code)
        if c is None:
            c = by[u.code] = UnitComplex(code=u.code, name=u.building, sido=u.sido, sigungu=u.sigungu, road_address=u.road_address, page=u.page)
        c.units.append(u)
    return list(by.values())
