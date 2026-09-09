"""행안부 도로명주소 위치정보 요약DB(출입구정보) → 로컬 SQLite 적재기.

전국본은 642만 행 960MB다. CLAUDE.md "하지 말 것 2" — 원본을 Postgres에 넣지 않는다.
여기서 SQLite로 만들어 두고, S6이 공고 주소와 오프라인 조인해서 **맞은 좌표만** Postgres로 보낸다.

    python -m zipgonggo_pipeline.geo.entrance --src "C:/Users/…/주소관련"

입력 파일 두 종류를 한 번에 받는다.

    RNENTDATA_YYMM_{시도코드}.txt              전체분 (시도별 16개)
    AlterD.JUSUEC.YYYYMMDD.TH_SGCO_RNADR_POSITION.TXT   일변동분

둘 다 CP949·`|` 구분·19칸으로 형식이 같다. 다른 건 이동사유코드(13번 칸)뿐 —
전체분은 비어 있고, 변동분은 31(신규)·34(변경)·63(폐지)이 온다. 63은 지운다.

좌표는 원본이 EPSG:5179(UTM-K/GRS80)다. 적재할 때 WGS84로 한 번만 바꿔 넣는다 —
조회 때마다 변환하면 6백만 번을 다시 하는 셈이고, 지도·PostGIS는 어차피 4326을 쓴다.
"""

from __future__ import annotations

import argparse
import logging
import re
import sqlite3
import sys
from collections.abc import Iterator
from pathlib import Path

from pyproj import Transformer

log = logging.getLogger(__name__)

ENCODING = "cp949"
FIELDS = 19
# 원본 칸 순서 — 관리번호|법정동코드|시도|시군구|읍면동|리|도로명코드|도로명|지하여부|본번|부번|
#                우편번호|일자|이동사유코드|출입구일련번호|출입구유형|출입구구분|X|Y
F_BDONG, F_SIDO, F_SIGUNGU, F_EMD, F_RI = 1, 2, 3, 4, 5
F_ROAD_CODE, F_ROAD_NAME, F_UNDERGROUND, F_MAIN, F_SUB = 6, 7, 8, 9, 10
F_ZIP, F_DATE, F_REASON, F_X, F_Y = 11, 12, 13, 17, 18

REASON_DELETE = "63"  # 폐지

FULL_GLOB = "RNENTDATA_*.txt"
ALTER_GLOB = "AlterD.*.TH_SGCO_RNADR_POSITION.TXT"
_ALTER_DATE = re.compile(r"AlterD\.\w+\.(\d{8})\.", re.IGNORECASE)

BATCH = 50_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS entrance (
  road_code    TEXT    NOT NULL,   -- 도로명코드 12자리. 전국 유일
  underground  INTEGER NOT NULL,   -- 지하여부 0/1
  main_no      INTEGER NOT NULL,   -- 건물본번
  sub_no       INTEGER NOT NULL,   -- 건물부번
  sido         TEXT    NOT NULL,
  sigungu      TEXT    NOT NULL,   -- 세종특별자치시는 빈 문자열
  eupmyeondong TEXT    NOT NULL,
  ri           TEXT    NOT NULL,
  road_name    TEXT    NOT NULL,
  bdong_code   TEXT    NOT NULL,   -- 법정동코드 10자리
  zipcode      TEXT,
  lon          REAL    NOT NULL,   -- WGS84. 원본 EPSG:5179를 적재 때 변환
  lat          REAL    NOT NULL,
  changed_on   TEXT,               -- 효력발생일 또는 변동일자 YYYYMMDD
  PRIMARY KEY (road_code, underground, main_no, sub_no)
) WITHOUT ROWID;

-- 읍면동 중심 좌표. 지번주소만 있는 단지의 마지막 수단이라 미리 접어 둔다 —
-- 600만 행을 매번 훑으면 조회 한 건에 수 초가 걸린다
CREATE TABLE IF NOT EXISTS dong_center (
  sido         TEXT    NOT NULL,
  sigungu      TEXT    NOT NULL,
  eupmyeondong TEXT    NOT NULL,
  lon          REAL    NOT NULL,
  lat          REAL    NOT NULL,
  n            INTEGER NOT NULL,   -- 평균에 쓴 출입구 수
  PRIMARY KEY (sido, sigungu, eupmyeondong)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS load_log (
  filename   TEXT PRIMARY KEY,
  rows       INTEGER NOT NULL,
  loaded_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""
# 도로명 조회 인덱스 — S6은 도로명코드를 모른 채 "자하문로 94"로 찾는다
LOOKUP_INDEX = "CREATE INDEX IF NOT EXISTS idx_entrance_lookup ON entrance (road_name, main_no, sub_no, underground)"

UPSERT = """
INSERT INTO entrance (road_code, underground, main_no, sub_no, sido, sigungu, eupmyeondong, ri,
                      road_name, bdong_code, zipcode, lon, lat, changed_on)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT (road_code, underground, main_no, sub_no) DO UPDATE SET
  sido=excluded.sido, sigungu=excluded.sigungu, eupmyeondong=excluded.eupmyeondong, ri=excluded.ri,
  road_name=excluded.road_name, bdong_code=excluded.bdong_code, zipcode=excluded.zipcode,
  lon=excluded.lon, lat=excluded.lat, changed_on=excluded.changed_on
"""
DELETE = "DELETE FROM entrance WHERE road_code=? AND underground=? AND main_no=? AND sub_no=?"


def _transformer() -> Transformer:
    return Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)


def read_rows(path: Path) -> Iterator[list[str]]:
    """CP949 `|` 구분 19칸. 칸 수가 안 맞는 줄은 버린다(변동분 꼬리에 빈 줄이 섞인다)."""
    with path.open(encoding=ENCODING, errors="replace") as f:
        for line in f:
            row = line.rstrip("\r\n").split("|")
            if len(row) == FIELDS:
                yield row


def _batches(path: Path, tr: Transformer) -> Iterator[tuple[list[tuple], list[tuple]]]:
    """(upsert 묶음, delete 묶음). 좌표 변환은 묶음 단위로 한 번에 한다."""
    keep: list[list[str]] = []
    drop: list[tuple] = []
    for row in read_rows(path):
        key = (row[F_ROAD_CODE], int(row[F_UNDERGROUND] or 0), int(row[F_MAIN] or 0), int(row[F_SUB] or 0))
        if row[F_REASON] == REASON_DELETE:
            drop.append(key)
        elif row[F_X] and row[F_Y]:
            keep.append(row)
        # 좌표 칸이 빈 행이 있다 — 주소는 살아 있으나 출입구 측량이 안 된 것. 쓸 데가 없어 버린다
        if len(keep) + len(drop) >= BATCH:
            yield _convert(keep, tr), drop
            keep, drop = [], []
    if keep or drop:
        yield _convert(keep, tr), drop


def _convert(rows: list[list[str]], tr: Transformer) -> list[tuple]:
    if not rows:
        return []
    lons, lats = tr.transform([float(r[F_X]) for r in rows], [float(r[F_Y]) for r in rows])
    return [
        (
            r[F_ROAD_CODE], int(r[F_UNDERGROUND] or 0), int(r[F_MAIN] or 0), int(r[F_SUB] or 0),
            r[F_SIDO], r[F_SIGUNGU], r[F_EMD], r[F_RI], r[F_ROAD_NAME], r[F_BDONG],
            r[F_ZIP] or None, lon, lat, r[F_DATE] or None,
        )
        for r, lon, lat in zip(rows, lons, lats, strict=True)
    ]


def source_files(src: Path) -> list[Path]:
    """전체분 먼저, 그 뒤 변동분을 날짜 오름차순으로. 순서가 곧 적용 순서다."""
    full = sorted(src.glob(FULL_GLOB))
    alter = sorted(src.glob(ALTER_GLOB), key=_alter_sort_key)
    return full + alter


def _alter_sort_key(path: Path) -> str:
    m = _ALTER_DATE.search(path.name)
    return m.group(1) if m else path.name


def load(src: Path, dest: Path, *, force: bool = False) -> dict[str, int]:
    """src 안의 요약DB 파일을 dest SQLite에 적재한다. 이미 넣은 파일은 건너뛴다(--force면 다시)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(dest)
    conn.executescript(SCHEMA)
    # 대량 적재 동안만 안전장치를 끈다. 중간에 죽으면 다시 돌리면 된다
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA cache_size = -200000")

    done = {r[0] for r in conn.execute("SELECT filename FROM load_log")}
    tr = _transformer()
    stats = {"files": 0, "skipped_files": 0, "upserted": 0, "deleted": 0}

    for path in source_files(src):
        if path.name in done and not force:
            stats["skipped_files"] += 1
            continue
        rows = 0
        for ups, dels in _batches(path, tr):
            if ups:
                conn.executemany(UPSERT, ups)
            if dels:
                conn.executemany(DELETE, dels)
            rows += len(ups) + len(dels)
            stats["upserted"] += len(ups)
            stats["deleted"] += len(dels)
        conn.execute(
            "INSERT INTO load_log (filename, rows) VALUES (?, ?) "
            "ON CONFLICT (filename) DO UPDATE SET rows=excluded.rows, loaded_at=datetime('now')",
            (path.name, rows),
        )
        conn.commit()
        stats["files"] += 1
        log.info("%s %s행", path.name, f"{rows:,}")

    conn.execute(LOOKUP_INDEX)
    conn.execute("DELETE FROM dong_center")
    conn.execute(
        "INSERT INTO dong_center (sido, sigungu, eupmyeondong, lon, lat, n) "
        "SELECT sido, sigungu, eupmyeondong, avg(lon), avg(lat), count(*) FROM entrance "
        "GROUP BY sido, sigungu, eupmyeondong"
    )
    conn.commit()
    conn.execute("PRAGMA optimize")
    total = conn.execute("SELECT count(*) FROM entrance").fetchone()[0]
    conn.close()
    stats["total"] = total
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="도로명주소 요약DB(출입구정보) → 로컬 SQLite 적재")
    ap.add_argument("--src", required=True, type=Path, help="RNENTDATA_*.txt / AlterD.*.TXT 가 있는 폴더")
    ap.add_argument("--dest", type=Path, default=None, help="기본값 pipeline/data/juso/entrance.sqlite")
    ap.add_argument("--force", action="store_true", help="이미 적재한 파일도 다시 넣는다")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    dest = args.dest or default_db_path()
    if not args.src.is_dir():
        sys.exit(f"--src 폴더가 없다: {args.src}")
    stats = load(args.src, dest, force=args.force)
    log.info("적재 완료 %s → %s", stats, dest)
    return 0


def default_db_path() -> Path:
    """pipeline/data/juso/entrance.sqlite. 적재기는 DB 접속이 없어도 돌아야 하니 settings()를 쓰지 않는다."""
    import os

    from ..config import PIPELINE_ROOT

    return PIPELINE_ROOT / os.environ.get("JUSO_SUMMARY_DB_PATH", "./data/juso/") / "entrance.sqlite"


if __name__ == "__main__":
    raise SystemExit(main())
