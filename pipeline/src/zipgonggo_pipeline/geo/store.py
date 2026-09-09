"""요약DB SQLite 조회. 주소 한 줄 → 좌표 한 점.

지오코딩 API를 부르지 않는다(CLAUDE.md "하지 말 것 1"). 여기서 나오는 좌표만 Postgres에 넣는다.

정확도 판정
    building  도로명 + 본번 + 부번까지 맞은 출입구 좌표
    road      부번만 못 맞춰 같은 본번의 다른 부번으로 대신한 좌표
    dong      도로명조차 못 맞춰 읍면동 출입구들의 평균으로 대신한 좌표
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .roadaddr import RoadKey, parse_dong, parse_road_address

Precision = str  # geo_precision 이넘과 같은 문자열: building · road · dong


@dataclass(frozen=True)
class Match:
    lon: float
    lat: float
    precision: Precision
    matched_by: str  # address_match.matched_by — road_addr · road_main · dong_center
    sido: str
    sigungu: str
    eupmyeondong: str
    road_code: str | None = None
    road_name: str | None = None
    underground: bool = False
    main_no: int | None = None
    sub_no: int = 0

    @property
    def normalized_addr(self) -> str:
        """address_match의 키. 공고 표기가 아니라 **맞은 주소** 기준이라 표기가 달라도 한 행으로 모인다."""
        if not self.road_name or self.main_no is None:
            return " ".join(x for x in (self.sido, self.sigungu, self.eupmyeondong) if x)
        no = f"{self.main_no}-{self.sub_no}" if self.sub_no else str(self.main_no)
        tail = f"지하 {no}" if self.underground else no
        return " ".join(x for x in (self.sido, self.sigungu, self.road_name, tail) if x)


_COLS = "road_code, road_name, underground, main_no, sub_no, sido, sigungu, eupmyeondong, lon, lat"
_SELECT = (
    f"SELECT {_COLS} FROM entrance WHERE road_name = ? AND main_no = ? AND sub_no = ? AND underground = ?"
)
_SELECT_MAIN = f"SELECT {_COLS} FROM entrance WHERE road_name = ? AND main_no = ? AND underground = 0"


class EntranceStore:
    """읽기 전용. 스레드마다 하나씩 만든다(sqlite3 커넥션은 스레드를 넘지 않는다)."""

    def __init__(self, db_path: Path):
        if not Path(db_path).exists():
            raise FileNotFoundError(f"요약DB SQLite가 없다: {db_path}. geo.entrance 적재기를 먼저 돌릴 것")
        self.conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> EntranceStore:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def lookup_address(self, address: str | None, *, sido: str | None = None) -> Match | None:
        """주소 한 줄로 찾는다. sido는 공고가 아는 시도(문자열이 시군구부터 시작할 때 보탠다)."""
        key = parse_road_address(address)
        if key is None:
            return None
        if key.sido is None and sido:
            key = RoadKey(key.road_name, key.underground, key.main_no, key.sub_no, sido, key.sigungu)
        return self.lookup(key)

    def lookup(self, key: RoadKey) -> Match | None:
        rows = self.conn.execute(
            _SELECT, (key.road_name, key.main_no, key.sub_no, int(key.underground))
        ).fetchall()
        hit = _pick(rows, key)
        if hit is not None:
            return _match(hit, "building", "road_addr")

        # 부번이 틀렸거나 공고가 안 적은 경우 — 같은 본번의 출입구로 대신한다
        if key.sub_no:
            rows = self.conn.execute(_SELECT_MAIN, (key.road_name, key.main_no)).fetchall()
            hit = _pick(rows, key)
            if hit is not None:
                return _match(hit, "road", "road_main")
        return None

    def lookup_dong_address(self, address: str | None, *, sido: str | None = None) -> Match | None:
        """지번주소만 있는 단지의 마지막 수단. 정확도는 dong이라 색인 대상이 아니다."""
        parsed = parse_dong(address)
        if parsed is None:
            return None
        addr_sido, sigungu, emd = parsed
        return self.dong_center(addr_sido or sido or "", sigungu or "", emd)

    def dong_center(self, sido: str, sigungu: str, eupmyeondong: str) -> Match | None:
        """읍면동 출입구 평균. 도로명을 못 맞췄을 때의 마지막 수단 — 색인 대상은 아니다."""
        if not (sido and sigungu and eupmyeondong):
            return None
        row = self.conn.execute(
            "SELECT lon, lat FROM dong_center WHERE sido = ? AND sigungu = ? AND eupmyeondong = ?",
            (sido, sigungu, eupmyeondong),
        ).fetchone()
        if row is None:
            return None
        return Match(row["lon"], row["lat"], "dong", "dong_center", sido, sigungu, eupmyeondong)


def _region_ok(row: sqlite3.Row, key: RoadKey) -> bool:
    """공고가 아는 만큼만 맞춰 본다. 시군구는 '수원시'처럼 앞토막만 적힌 표기를 받아 준다."""
    if key.sido and row["sido"] != key.sido:
        return False
    if key.sigungu:
        a, b = row["sigungu"], key.sigungu
        if a != b and not a.startswith(b) and not b.startswith(a):
            return False
    return True


def _pick(rows: list[sqlite3.Row], key: RoadKey) -> sqlite3.Row | None:
    """지역이 맞는 행 하나. 지역 단서가 없어 여럿이 남으면 동명이도로라 포기한다."""
    if not rows:
        return None
    fit = [r for r in rows if _region_ok(r, key)]
    if len(fit) == 1:
        return fit[0]
    if len(fit) > 1:
        # 같은 시군구 안에 같은 도로명·번호가 둘일 수는 없다. 남으면 지역 단서가 모자란 것
        return fit[0] if key.sigungu else None
    return None


def _match(row: sqlite3.Row, precision: Precision, matched_by: str) -> Match:
    return Match(
        row["lon"], row["lat"], precision, matched_by,
        row["sido"], row["sigungu"], row["eupmyeondong"],
        road_code=row["road_code"], road_name=row["road_name"],
        underground=bool(row["underground"]), main_no=row["main_no"], sub_no=row["sub_no"],
    )
