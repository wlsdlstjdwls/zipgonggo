"""S3-SH — SH 공고 첨부 공고문에서 공급 단지 표를 읽어 notice_complex 적재.

    python -m zipgonggo_pipeline.stages.s3_sh_complex [--dry-run] [--limit N] [--slug SLUG]

대상: source='sh_scrape'이고 원문이 i-sh.co.kr인 공고. 첨부 미리보기(Synap 뷰어)의 쪽 XML을 1초 간격으로 받고
「주택 위치 안내」 표(단지명·소재지)를 파싱한다. 받은 XML은 pipeline/data/ish/{seq}/ 에 캐시(커밋 금지).
표가 없는 공고(매입임대 등 다른 양식)는 0건으로 기록만 남긴다 — 양식별 파서는 이후 추가.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

from ..config import PIPELINE_ROOT, settings
from ..db import connect
from ..parsers.sh_attach import parse_attachment
from ..repo import replace_notice_complexes
from ..sources.ish import IshClient, find_attachments
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s3.sh")

STAGE = "S3"
SOURCE = "sh_attach"
CACHE_ROOT = PIPELINE_ROOT / "data" / "ish"
SEQ_RE = re.compile(r"[?&]seq=(\d+)")

SELECT_SQL = """
SELECT id, slug, title, source_url FROM notice
WHERE source = 'sh_scrape' AND source_url LIKE '%%i-sh.co.kr%%'
  AND (%(slug)s::text IS NULL OR slug = %(slug)s)
ORDER BY posted_at DESC, id DESC
LIMIT %(limit)s
"""


def pick_attachment(atts, title: str):
    """공고문 본체 첨부 1개. 이름에 '공고'가 든 PDF 우선, 없으면 첫 미리보기."""
    pdfs = [a for a in atts if a.name.lower().endswith(".pdf")]
    for a in pdfs:
        if "공고" in a.name:
            return a
    return (pdfs or atts or [None])[0]


def run(*, dry_run: bool, limit: int, slug: str | None) -> Stats:
    cfg = settings()
    client = IshClient(delay_sec=cfg.scrape_delay_sec)
    started = utc_now()
    stats = Stats()

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SELECT_SQL, {"slug": slug, "limit": limit})
            notices = cur.fetchall()
            stats.fetched_rows = len(notices)
            for n in notices:
                seq_m = SEQ_RE.search(n["source_url"])
                if not seq_m:
                    stats.skip("no_seq")
                    continue
                seq = seq_m.group(1)
                try:
                    html = client.fetch_notice_html(n["source_url"])
                    att = pick_attachment(find_attachments(html), n["title"])
                    if att is None:
                        stats.skip("no_attachment")
                        log.info("%s 첨부 없음", n["slug"])
                        continue
                    doc = client.resolve_preview(att.preview_url)
                    if doc is None:
                        stats.skip("preview_unresolved")
                        continue
                    pages = list(client.iter_pages(doc, cache_dir=CACHE_ROOT / seq))
                    kind, rows, units = parse_attachment(pages)
                except Exception as exc:  # noqa: BLE001
                    stats.error("fetch_error", n["slug"], exc)
                    continue
                stats.groups += 1
                log.info("%s: %d쪽 · %s · 단지 %d건 · 호실 %d건 (%s)", n["slug"], len(pages), kind, len(rows), len(units), att.name)
                if not rows:
                    stats.skip("no_table")
                    continue
                stats.skip(f"kind:{kind}")
                if dry_run:
                    stats.updated += 1
                    continue
                cur.execute("SAVEPOINT nc")
                try:
                    replace_notice_complexes(cur, n["id"], rows)
                    cur.execute("RELEASE SAVEPOINT nc")
                    stats.inserted += len(rows)
                    stats.updated += 1
                    conn.commit()
                except Exception as exc:  # noqa: BLE001
                    cur.execute("ROLLBACK TO SAVEPOINT nc")
                    stats.error("db_error", n["slug"], exc)
            if not dry_run:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
                conn.commit()
    finally:
        conn.close()
    return stats


def _add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--slug", default=None, help="공고 1건만")


def main(argv: list[str] | None = None) -> int:
    return stage_main(
        "S3 SH 첨부 공고문 단지 표 수집",
        lambda a: run(dry_run=a.dry_run, limit=a.limit, slug=a.slug),
        add_args=_add_args,
        argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
