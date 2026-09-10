"""S2 — 같은 공고가 여러 URL로 갈라진 걸 한 정본으로 묶는다.

    python -m zipgonggo_pipeline.stages.s2_dedupe [--dry-run] [--since 2026-01-01] [--reset]

slug을 기관 seq로 만들기 때문에 한 공고가 여러 번 들어온다(실측 2026-09-10, 세 벌).

    sh-2026-309403-maeip   포털 목록이 준 seq
    sh-2026-310046-maeip   포털이 정정공고로 어긋나게 준 seq
    sh-2026-310107-maeip   「(수정)」 붙은 정정공고 본체

**URL은 지우지 않는다**(CLAUDE.md 하지 말 것 6). 정본을 하나 정해 `notice.canonical_id`에 적고,
화면은 목록에서 딸림 글을 빼고 rel=canonical로 정본을 가리킨다. 상세 페이지는 그대로 열린다.

묶는 기준은 두 가지뿐이다. 헐거우면 남남인 공고가 한 덩이로 붙는다 — 그게 URL을 지우는 것보다 나쁘다.

    fingerprint   기관·제목·게시일·주택일련번호가 통째로 같다. 어긋난 seq가 여기 걸린다
    title_key     정정 표지만 뗀 제목이 같고 게시일도 같다. 「(수정) X」와 「X」가 여기 걸린다

두 번째 기준은 **SH 게시판 계열에만** 건다. 마이홈 API는 한 공고를 주택별로 쪼개 주기 때문에
(`lh-2026-21112-1‥22-gungmin`) 제목과 게시일이 같아도 남남이다 — 묶으면 21개 주택이 사라진다.

정본은 정정공고 쪽이다 — 나중에 고쳐 낸 글이 최신 사실이다. 정정 표지가 없으면 단지를 더 많이
읽어 둔 쪽, 그래도 같으면 나중에 들어온 행.
"""

from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from typing import Any

from ..db import connect
from ..normalize import is_amendment, title_key
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s2")

STAGE = "S2"
SOURCE = "dedupe"

# 한 공고가 한 행으로 오는 소스. 마이홈 API는 주택별로 쪼개져 오므로 제목 기준을 걸지 않는다
BOARD_SOURCES = {"sh_scrape", "ish_board", "ish_247"}

SELECT_SQL = """
SELECT n.id, n.slug, n.title, n.agency, n.source, n.posted_at, n.fingerprint, n.source_key,
       n.amends_source_key, n.canonical_id,
       (SELECT count(*) FROM notice_complex nc WHERE nc.notice_id = n.id) AS complexes
  FROM notice n
 WHERE (%(since)s::date IS NULL OR n.posted_at >= %(since)s::date)
 ORDER BY n.id
"""


def add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--since", default=None, help="이 게시일 이후 공고만 본다. 비우면 전부")
    ap.add_argument("--reset", action="store_true", help="기존 canonical_id를 모두 지우고 다시 매긴다")


def run(args: argparse.Namespace) -> Stats:
    stats = Stats()
    started = utc_now()
    conn = connect()
    try:
        with conn.cursor() as cur:
            if args.reset and not args.dry_run:
                cur.execute("UPDATE notice SET canonical_id = NULL WHERE canonical_id IS NOT NULL")
            cur.execute(SELECT_SQL, {"since": args.since})
            rows = cur.fetchall()
            stats.fetched_rows = len(rows)

            for group in _groups(rows):
                stats.groups += 1
                main, rest = _pick_main(group)
                log.info("정본 %s ← %s", main["slug"], " | ".join(r["slug"] for r in rest))
                if args.dry_run:
                    stats.skip("dry_run")
                    continue
                for r in rest:
                    if r["canonical_id"] == main["id"]:
                        stats.skip("already")
                        continue
                    cur.execute(
                        "UPDATE notice SET canonical_id = %s, updated_at = now() WHERE id = %s",
                        (main["id"], r["id"]),
                    )
                    stats.updated += 1
                # 정본이 남의 딸림으로 잡혀 있으면 풀어 준다(제목이 고쳐져 그룹이 바뀔 수 있다)
                if main["canonical_id"] is not None:
                    cur.execute("UPDATE notice SET canonical_id = NULL WHERE id = %s", (main["id"],))
                # 화면의 정정 체인은 amends_source_key로 그린다 — 이미 있는 배선을 그대로 쓴다
                _link_amend_chain(cur, main, rest)
        if not args.dry_run:
            with conn.cursor() as cur:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started)
            conn.commit()
    finally:
        conn.close()
    return stats


def _groups(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """두 기준으로 묶는다. 한 공고가 양쪽에 걸리면 한 덩이가 되도록 이어 붙인다."""
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        buckets[("fp", r["fingerprint"])].append(r)
        if r["source"] in BOARD_SOURCES:
            buckets[("title", r["agency"], r["posted_at"], title_key(r["title"]))].append(r)

    # 같은 행이 두 열쇠에 들어가므로 합집합으로 잇는다(union-find 대신 작은 그래프 훑기)
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    by_id = {r["id"]: r for r in rows}
    for members in buckets.values():
        if len(members) < 2:
            continue
        first = members[0]["id"]
        for m in members[1:]:
            union(first, m["id"])

    merged: dict[int, list[dict]] = defaultdict(list)
    for rid in by_id:
        root = find(rid)
        if root != rid or any(find(o) == rid for o in by_id if o != rid):
            merged[root].append(by_id[rid])
    return [g for g in merged.values() if len(g) > 1]


def _pick_main(group: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """정본 하나와 나머지. 정정공고 → 단지를 많이 읽은 쪽 → 나중에 들어온 행 순으로 고른다."""
    ordered = sorted(
        group,
        key=lambda r: (is_amendment(r["title"]), r["posted_at"], r["complexes"], r["id"]),
        reverse=True,
    )
    return ordered[0], ordered[1:]


def _link_amend_chain(cur, main: dict[str, Any], rest: list[dict[str, Any]]) -> None:
    """정본이 정정공고면 원 공고를 가리키게 한다. 화면이 「이 공고를 대체한 정정공고」를 그려 준다."""
    if not is_amendment(main["title"]):
        return
    origin = next((r for r in rest if not is_amendment(r["title"])), None)
    if origin is None or main.get("amends_source_key") == origin["source_key"]:
        return
    cur.execute(
        "UPDATE notice SET amends_source_key = %s, updated_at = now() WHERE id = %s AND amends_source_key IS NULL",
        (origin["source_key"], main["id"]),
    )


def main(argv: list[str] | None = None) -> int:
    return stage_main("S2 중복 공고 정본 묶기", run, add_args=add_args, argv=argv)


if __name__ == "__main__":
    raise SystemExit(main())
