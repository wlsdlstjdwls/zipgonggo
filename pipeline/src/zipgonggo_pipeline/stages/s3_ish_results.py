"""S3-RESULT — i-sh 게시판 결과 글 → result_post · notice_result 적재.

    python -m zipgonggo_pipeline.stages.s3_ish_results [--dry-run] [--max-pages N] [--since-year 2022] [--limit N]

게시판에서 결과 글(경쟁률 게시·당첨자 발표)을 골라 원장에 넣고, 첨부 미리보기의 표를 읽어
회차별 경쟁률을 적재한다. 과거 실적은 SH 원문에서 직접 뽑는다 — 제3자 집계를 옮겨오지 않는다.

두 가지를 기존 스테이지와 다르게 한다.

- **목록을 `isRecrnoti=Y` 없이 받는다.** 모집공고만 걸러 받으면 결과 글이 449건 중 19건뿐이다.
  대신 채용·행정 글이 섞여 오므로 `ish_result_title.classify`가 걷어낸다.
- **원 공고는 제목이 인용한 공고일로 찾는다.** 「(2025.04.25.공고)」가 열쇠다. 같은 날 같은 유형 공고가
  여럿이면 제목으로 가른다(결과 글 제목이 원 공고 제목을 통째로 인용한다). 그래도 안 좁혀지면 잇지 않고
  원장에만 남긴다 — 잘못 이으면 남의 공고에 남의 경쟁률이 붙는다. 공고가 뒤늦게 들어오면 --relink로 잇는다.

받은 XML은 pipeline/data/ish/{seq}/ 에 캐시한다(커밋 금지). 요청 간격은 ThrottledHttp가 지킨다.
"""

from __future__ import annotations

import argparse
import logging
import sys

from ..config import PIPELINE_ROOT, settings
from ..db import connect
from ..normalize import parse_ymd
from ..parsers.ish_result_title import classify
from ..parsers.sh_competition import parse_competition
from ..repo import find_notice_for_result, relink_result_posts, replace_notice_results, upsert_result_post
from ..sources.ish import IshClient, find_attachments
from ..sources.ish_board import IshBoardClient
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s3.ish_results")

STAGE = "S3"
SOURCE = "ish_result"
AGENCY = "SH"
CACHE_ROOT = PIPELINE_ROOT / "data" / "ish"
MAX_PAGES_PER_DOC = 40   # 결과 표는 길어야 열 쪽 남짓. 상한을 둬 잘못된 문서에 매달리지 않는다


def _row_dict(r, row_no: int) -> dict:
    return {
        "row_no": row_no,
        "address": r.address,
        "complex_name": r.complex_name,
        "sigungu": r.sigungu,
        "supply_kind": r.supply_kind,
        "supply_type": r.supply_type,
        "tenant_class": r.tenant_class,
        "bracket": r.bracket,
        "units": r.units,
        "applicants": r.applicants,
        "ratio": r.ratio,
        "reconciled": r.reconciled,
        "repaired": r.repaired,
        "source_page": r.page,
    }


def _parse_post(client: IshClient, seq: str, url: str) -> tuple[list[dict], str | None]:
    """결과 글 첨부에서 표를 읽는다. (줄, 사유). 첨부가 없거나 양식을 모르면 빈 줄 + 사유."""
    atts = find_attachments(client.fetch_notice_html(url))
    if not atts:
        return [], "첨부 없음"
    reason = "미리보기 해석 실패"
    for att in atts:
        doc = client.resolve_preview(att.preview_url)
        if doc is None:
            continue
        pages = list(client.iter_pages(doc, cache_dir=CACHE_ROOT / seq, max_pages=MAX_PAGES_PER_DOC))
        rows = parse_competition(pages)
        if rows:
            return [_row_dict(r, i) for i, r in enumerate(rows, 1)], None
        reason = "아는 표 양식이 없음"
    return [], reason


def _parsed_seqs(cur) -> set[str]:
    cur.execute("SELECT seq FROM result_post WHERE parsed_at IS NOT NULL")
    return {r["seq"] for r in cur.fetchall()}


def run(*, dry_run: bool, max_pages: int | None, since_year: int | None, limit: int | None,
        relink_only: bool, reparse: bool, kinds: set[str] | None = None) -> Stats:
    cfg = settings()
    started = utc_now()
    stats = Stats()

    conn = None if dry_run else connect()
    try:
        cur = conn.cursor() if conn else None
        if relink_only:
            n = relink_result_posts(cur, agency=AGENCY) if cur else 0
            log.info("원 공고를 새로 이은 결과 글 %d건", n)
            stats.groups = n
            if conn and cur:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, relinked=n)
                conn.commit()
            return stats

        board = IshBoardClient(delay_sec=cfg.scrape_delay_sec)
        # 모집공고 필터를 끄고 받는다 — 켜면 결과 글이 거의 다 가려진다
        posts = list(board.iter_notices(recruit_only=False, max_pages=max_pages or 40))
        stats.fetched_rows = len(posts)
        log.info("i-sh 게시판 %d행 · 요청 %d회", len(posts), board.call_count)

        client = IshClient(delay_sec=cfg.scrape_delay_sec)
        # 이미 읽은 글은 첨부를 다시 받지 않는다 — 아카이브 백필은 수천 건이라 재개할 수 있어야 한다
        parsed = set() if (reparse or cur is None) else _parsed_seqs(cur)
        done = 0
        for row in posts:
            if since_year and (row.year or 0) < since_year:
                stats.skip("too_old")
                continue
            got = classify(row.title)
            if got is None:
                stats.skip("not_a_result")
                continue
            stats.groups += 1
            posted = parse_ymd(row.posted)
            if posted is None:
                stats.error("no_posted_at", row.seq, ValueError(row.title))
                continue
            notice_id = None
            if cur and got.notice_date:
                notice_id = find_notice_for_result(cur, agency=AGENCY, notice_date=got.notice_date,
                                                   housing_type=got.housing_type, title=row.title)
            note = None if notice_id else ("공고일 인용 없음" if not got.notice_date else "원 공고 못 찾음")
            if cur:
                upsert_result_post(cur, {
                    "seq": row.seq, "title": row.title, "posted_at": posted, "result_kind": got.kind,
                    "notice_date": got.notice_date, "reserve_round": got.reserve_round,
                    "notice_id": notice_id, "note": note,
                })
            if notice_id is None:
                stats.skip("unlinked")
                continue
            # 원장엔 다 넣되 첨부는 고른 종류만 읽는다 — 당첨자 명단은 수십 쪽이라 경쟁률만 채울 땐 건너뛴다
            if kinds and got.kind not in kinds:
                stats.skip("kind_filtered")
                continue
            if row.seq in parsed:
                stats.skip("already_parsed")
                continue
            if limit is not None and done >= limit:
                stats.skip("limit_reached")
                continue
            try:
                rows, reason = _parse_post(client, row.seq, row.url)
            except Exception as exc:  # noqa: BLE001
                stats.error("attach_error", row.seq, exc)
                continue
            done += 1
            if cur:
                n = replace_notice_results(cur, notice_id=notice_id, post_seq=row.seq,
                                           result_kind=got.kind, rows=rows)
                stats.inserted += n
                if not rows:
                    cur.execute("UPDATE result_post SET note = %s WHERE seq = %s", (reason, row.seq))
            if not rows:
                stats.skip("no_table")

        if conn and cur:
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started,
                          calls=board.call_count + client.call_count)
            conn.commit()
    finally:
        if conn:
            conn.close()
    return stats


def _add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--since-year", type=int, default=None, help="이 해부터만 (예: 2022)")
    ap.add_argument("--limit", type=int, default=None, help="첨부를 읽을 글 수 상한. 원장 적재는 전부 한다")
    ap.add_argument("--relink", action="store_true", help="목록을 받지 않고, 못 이은 결과 글만 다시 이어 본다")
    ap.add_argument("--reparse", action="store_true", help="이미 읽은 글도 첨부를 다시 받아 파싱한다")
    ap.add_argument("--kind", action="append", choices=["competition", "winner"], default=None,
                    help="첨부를 읽을 결과 글 종류. 여러 번 줄 수 있다. 원장(result_post)은 종류와 무관하게 다 넣는다")


def main(argv: list[str] | None = None) -> int:
    return stage_main(
        "S3 i-sh 결과 글(경쟁률·당첨자 발표) 적재",
        lambda a: run(dry_run=a.dry_run, max_pages=a.max_pages, since_year=a.since_year,
                      limit=a.limit, relink_only=a.relink, reparse=a.reparse, kinds=set(a.kind) if a.kind else None),
        add_args=_add_args, stage=STAGE, source=SOURCE, argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
