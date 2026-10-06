"""S5 — 공고 전체의 사업 이름(notice.programs) 다시 매기기.

    python -m zipgonggo_pipeline.stages.s5_programs            # 바뀐 행만 고친다
    python -m zipgonggo_pipeline.stages.s5_programs --dry-run  # 사업별 건수와 바뀔 행 수만

새로 들어오는 공고는 repo.upsert_notice가 적재할 때 매긴다. 이 스테이지는 **programs.py 규칙을 고친 뒤**
이미 쌓인 공고에 같은 규칙을 다시 거는 자리다. 멱등 — 두 번 돌려도 두 번째는 0행.
updated_at은 건드리지 않는다(공고 내용이 바뀐 게 아니다).
"""

from __future__ import annotations

import argparse
import logging
from collections import Counter

from ..db import connect
from ..programs import classify
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s5.programs")

STAGE = "S5"
SOURCE = "programs"


def run(args: argparse.Namespace) -> Stats:
    stats = Stats()
    started = utc_now()
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, title, housing_type::text AS housing_type, programs FROM notice")
            rows = cur.fetchall()
            stats.fetched_rows = len(rows)
            per = Counter()
            changes: list[tuple[list[str], int]] = []
            for r in rows:
                new = classify(r["title"], r["housing_type"])
                per.update(new)
                if new != list(r["programs"] or []):
                    changes.append((new, r["id"]))
            log.info("사업별 %s", dict(per))
            log.info("바뀔 행 %d / %d", len(changes), len(rows))
            if args.dry_run:
                stats.skipped["dry_run"] = len(changes)
                return stats
            # 왕복 한 번에 — 줄마다 execute하면 Neon 왕복이 행 수만큼 쌓인다(55차)
            cur.executemany("UPDATE notice SET programs = %s WHERE id = %s", changes)
            stats.updated = len(changes)
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, **dict(per))
        conn.commit()
    finally:
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    return stage_main("S5 사업 이름 다시 매기기", run, stage=STAGE, source=SOURCE, argv=argv)


if __name__ == "__main__":
    raise SystemExit(main())
