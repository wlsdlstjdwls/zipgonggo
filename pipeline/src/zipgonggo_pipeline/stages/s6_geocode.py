"""S6 — 주소 → 좌표. 행안부 요약DB(출입구정보) 오프라인 조인.

    python -m zipgonggo_pipeline.stages.s6_geocode [--dry-run] [--limit N] [--refresh] [--target both]

좌표는 지오코딩 API를 부르지 않고 pipeline/data/juso/entrance.sqlite에서만 얻는다(CLAUDE.md 하지 말 것 1).
그 SQLite는 geo.entrance 적재기가 만든다.

    python -m zipgonggo_pipeline.geo.entrance --src "…/주소관련"

대상 두 곳.
    notice_complex  공고문에서 읽은 단지 목록. road_address가 시군구부터 시작해 시도는 sido 칸에서 보탠다
    complex         마이홈 API 단지. road_address가 없으면 jibun_address는 손대지 않는다(지번 조인은 아직 없다)

정확도는 요약DB가 어디까지 맞았는지 그대로 적는다 — building만 색인 대상이다(docs/url-structure.md).
못 맞춘 주소는 로그에 표기별로 모아 남긴다. 파서를 고칠 자리를 그 목록이 알려 준다.
"""

from __future__ import annotations

import argparse
import logging
from collections import Counter
from pathlib import Path

from ..db import connect
from ..geo.entrance import default_db_path
from ..geo.store import EntranceStore
from ..repo import set_complex_geom, set_notice_complex_geom, upsert_address_match
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s6")

STAGE = "S6"
SOURCE = "juso_summary"

NOTICE_COMPLEX_SQL = """
SELECT id, name, sido, road_address FROM notice_complex
WHERE road_address <> ''
  AND (%(refresh)s OR geom IS NULL)
ORDER BY id
LIMIT %(limit)s
"""

COMPLEX_SQL = """
SELECT id, name, sido, road_address FROM complex
WHERE road_address IS NOT NULL AND road_address <> ''
  AND (%(refresh)s OR geom IS NULL)
ORDER BY id
LIMIT %(limit)s
"""


def add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--limit", type=int, default=100_000)
    ap.add_argument("--refresh", action="store_true", help="이미 좌표가 있는 행도 다시 맞춘다")
    ap.add_argument("--target", choices=("notice_complex", "complex", "both"), default="both")
    ap.add_argument("--dong-fallback", action="store_true",
                    help="도로명을 못 맞춘 지번주소를 읍면동 중심 좌표로 대신 채운다(정확도 dong, 색인 제외)")
    ap.add_argument("--db", default=None, help="요약DB SQLite 경로. 기본값 pipeline/data/juso/entrance.sqlite")


def run(args: argparse.Namespace) -> Stats:
    stats = Stats()
    started = utc_now()
    precision_count: Counter[str] = Counter()
    misses: list[str] = []

    store = EntranceStore(Path(args.db) if args.db else default_db_path())
    conn = connect()
    try:
        with conn.cursor() as cur:
            targets = ("notice_complex", "complex") if args.target == "both" else (args.target,)
            for table in targets:
                sql = NOTICE_COMPLEX_SQL if table == "notice_complex" else COMPLEX_SQL
                cur.execute(sql, {"refresh": args.refresh, "limit": args.limit})
                rows = cur.fetchall()
                stats.fetched_rows += len(rows)
                setter = set_notice_complex_geom if table == "notice_complex" else set_complex_geom
                for row in rows:
                    match = store.lookup_address(row["road_address"], sido=row["sido"])
                    if match is None and args.dong_fallback:
                        match = store.lookup_dong_address(row["road_address"], sido=row["sido"])
                    if match is None:
                        stats.skip(f"{table}_no_match")
                        if len(misses) < 200:
                            misses.append(f"{table}#{row['id']} {row['name']} | {row['road_address']}")
                        continue
                    precision_count[match.precision] += 1
                    if args.dry_run:
                        stats.skip("dry_run")
                        continue
                    upsert_address_match(cur, match)
                    setter(cur, row["id"], match)
                    stats.updated += 1
        if not args.dry_run:
            with conn.cursor() as cur:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started,
                              precision=dict(precision_count), misses=misses[:20])
            conn.commit()
    finally:
        conn.close()
        store.close()

    log.info("정확도 %s", dict(precision_count))
    for m in misses[:20]:
        log.info("못 맞춤: %s", m)
    return stats


def main(argv: list[str] | None = None) -> int:
    return stage_main("S6 주소-좌표 오프라인 조인", run, add_args=add_args, argv=argv)


if __name__ == "__main__":
    raise SystemExit(main())
