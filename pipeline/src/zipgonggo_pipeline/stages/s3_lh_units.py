"""S3-LH — LH 공고 첨부 「공급주택목록」(xlsx)에서 호실을 읽어 notice_complex·unit 적재.

    python -m zipgonggo_pipeline.stages.s3_lh_units [--dry-run] [--limit N] [--slug SLUG] [--all] [--cached]

마이홈 API는 LH 매입임대·든든전세 공고의 위치를 시군구까지만 준다(fullAdres·pnu가 비어 온다).
주택 주소는 첨부 엑셀에만 있다 — 그걸 읽어야 지도에 집이 찍히고 단지 지면이 생긴다.
수집 허용: 2026-09-08 서울시 협의 때 LH도 같이 받았다(docs/data-sources.md 6절).

대상: 원문이 apply.lh.or.kr이고 주소가 빈 매입임대 공고 중 **아직 단지가 없는 것**(`--all`이면 있는 것도 다시).
전세임대는 집을 본인이 구해 오는 제도라 목록이 없다 — 고르지 않는다.
받은 파일은 pipeline/data/lh/{panId}/{fileid}.xlsx.bin 에 둔다(커밋 금지). `--cached`는 그것만 다시 읽는다.

좌표는 여기서 안 넣는다. 단지 행의 도로명주소를 S6이 요약DB와 오프라인 조인한다(CLAUDE.md 하지 말 것 1).
"""

from __future__ import annotations

import argparse
import logging
import sys

from ..config import PIPELINE_ROOT, settings
from ..db import connect
from ..parsers.lh_house_list import LhUnit, build_rows, parse_house_list
from ..repo import replace_notice_complexes, replace_units, update_notice_attach_facts
from ..sources.lh import LhClient, find_attachments, pan_id
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s3.lh")

STAGE = "S3"
SOURCE = "lh_attach"
CACHE_ROOT = PIPELINE_ROOT / "data" / "lh"

SELECT_SQL = """
SELECT n.id, n.slug, n.title, n.source_url, n.sido, n.sigungu, n.supply_count FROM notice n
WHERE n.source_url LIKE '%%apply.lh.or.kr%%'
  AND (%(slug)s::text IS NOT NULL OR (
        n.housing_type = '매입임대' AND COALESCE(n.address, '') = ''
        -- 목록이 PDF뿐인 공고는 단지가 영영 안 생겨 매번 다시 고른다. 오래된 건 그만 두드린다
        AND n.posted_at >= current_date - 120
        AND (%(all)s OR NOT EXISTS (SELECT 1 FROM notice_complex c WHERE c.notice_id = n.id))))
  AND (%(slug)s::text IS NULL OR n.slug = %(slug)s)
ORDER BY n.posted_at DESC, n.id DESC
LIMIT %(limit)s
"""


def only_region(units: list[LhUnit], sigungu: str | None) -> list[LhUnit]:
    """공고가 시군구 하나를 겨누는데 목록이 여러 공고 합본이면 그 시군구만 남긴다.

    제주는 제주시 공고(17호)와 서귀포시 공고(8호)가 같은 25줄짜리 파일을 붙인다(2026-10-02 실측).
    걸러서 하나도 안 남으면 거르지 않는다 — 표기가 달라 못 맞춘 것이지 그 공고에 집이 없는 게 아니다.
    """
    if not sigungu:
        return units
    kept = [u for u in units if sigungu in u.address or (u.sigungu_col and sigungu in u.sigungu_col)]
    return kept or units


def _load_cached(pid: str) -> list[tuple[str, bytes]]:
    """받아 둔 목록. zip이 아닌 파일은 버린다 — 회사 PC 문서보안(DRM)이 .xlsx를 OLE로 암호화해 둔 것이다(2026-10-02)."""
    d = CACHE_ROOT / pid
    if not d.is_dir():
        return []
    files = [(p.name.split(".")[0], p.read_bytes()) for p in sorted(d.glob("*.xlsx*"))]
    return [(fid, data) for fid, data in files if data[:2] == b"PK"]


def run(*, dry_run: bool, limit: int, slug: str | None, all_: bool = False, cached: bool = False) -> Stats:
    cfg = settings()
    client = LhClient(delay_sec=cfg.scrape_delay_sec)
    started = utc_now()
    stats = Stats()

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SELECT_SQL, {"slug": slug, "all": all_, "limit": limit})
            notices = cur.fetchall()
            conn.commit()   # 내려받는 동안 트랜잭션을 쥐고 있지 않는다(Neon idle-in-transaction)
            stats.fetched_rows = len(notices)
            for n in notices:
                pid = pan_id(n["source_url"])
                if not pid:
                    stats.skip("no_pan_id")
                    continue
                try:
                    files: list[tuple[str, bytes]]
                    if cached:
                        files = _load_cached(pid)
                        if not files:
                            stats.skip("no_cache")
                            continue
                    else:
                        atts = find_attachments(client.fetch_detail(n["source_url"]))
                        lists = [a for a in atts if a.is_house_list]
                        if not lists:
                            # PDF·hwpx 목록(전남 보유주택목록, 경남 목록요약)과 목록 없는 공고. 사람이 볼 수 있게 이름을 남긴다
                            stats.skip("no_xlsx_list")
                            log.info("%s xlsx 목록 없음: %s", n["slug"], [a.name for a in atts])
                            continue
                        files = []
                        for a in lists:
                            data = client.download(a)
                            (CACHE_ROOT / pid).mkdir(parents=True, exist_ok=True)
                            # .xlsx로 두면 문서보안(DRM)이 암호화해 --cached로 못 읽는다
                            (CACHE_ROOT / pid / f"{a.file_id}.xlsx.bin").write_bytes(data)
                            files.append((a.file_id, data))
                    units: list[LhUnit] = []
                    for _, data in files:
                        units.extend(parse_house_list(data))
                except Exception as exc:  # noqa: BLE001
                    stats.error("fetch_error", n["slug"], exc)
                    continue

                units = only_region(units, n["sigungu"])
                if not units:
                    stats.skip("no_rows")
                    log.warning("%s 목록은 있는데 호실을 한 줄도 못 읽었다 — 새 양식일 수 있다", n["slug"])
                    continue
                complexes, rows = build_rows(units, default_sido=n["sido"])
                stats.groups += 1
                if n["supply_count"] and n["supply_count"] != len(units):
                    stats.skip("count_mismatch")
                log.info("%s: 호실 %d (공고 %s호) · 단지 %d", n["slug"], len(units), n["supply_count"], len(complexes))
                if dry_run:
                    stats.updated += 1
                    continue

                deps = [u.deposit for u in units if u.deposit]
                rents = [u.rent for u in units if u.rent is not None]
                cur.execute("SAVEPOINT lh")
                try:
                    replace_notice_complexes(cur, n["id"], complexes)
                    replace_units(cur, n["id"], rows)
                    update_notice_attach_facts(
                        cur, n["id"],
                        min_deposit=min(deps) if deps else None, max_deposit=max(deps) if deps else None,
                        min_rent=min(rents) if rents else None, max_rent=max(rents) if rents else None,
                    )
                    cur.execute("RELEASE SAVEPOINT lh")
                    conn.commit()
                    stats.inserted += len(rows)
                    stats.updated += 1
                except Exception as exc:  # noqa: BLE001
                    cur.execute("ROLLBACK TO SAVEPOINT lh")
                    stats.error("db_error", n["slug"], exc)
            if not dry_run:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
                conn.commit()
    finally:
        conn.close()
    return stats


def _add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--slug", default=None, help="공고 1건만")
    ap.add_argument("--all", action="store_true", help="단지가 이미 있는 공고도 다시 읽는다(파서를 고친 뒤)")
    ap.add_argument("--cached", action="store_true", help="네트워크 없이 받아 둔 엑셀만 다시 읽는다")


def main(argv: list[str] | None = None) -> int:
    return stage_main(
        "S3 LH 첨부 공급주택목록 수집",
        lambda a: run(dry_run=a.dry_run, limit=a.limit, slug=a.slug, all_=a.all, cached=a.cached),
        add_args=_add_args,
        stage=STAGE, source=SOURCE,
        argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
