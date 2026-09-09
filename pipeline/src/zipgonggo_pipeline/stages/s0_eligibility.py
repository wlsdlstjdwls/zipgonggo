"""S0 — 공급유형 자격·배점 사양 시드.

    python -m zipgonggo_pipeline.stages.s0_eligibility                     # 시드 파일 → DB
    python -m zipgonggo_pipeline.stages.s0_eligibility --xlsx "…/내집마련.xlsx"   # 엑셀 → 시드 파일 → DB

원본은 사용자가 만든 자격진단 엑셀이다. 그 파일은 커밋하지 않고(CLAUDE.md: 데이터 파일 커밋 금지),
파이프라인이 뽑아낸 db/seeds/eligibility.json을 정본으로 둔다 — 규칙이 바뀌면 그 diff가 리뷰 대상이다.

이 값들은 공고가 아니라 제도 자체의 규칙이라 수집 스테이지(S1~)보다 앞선다. 그래서 S0.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from ..config import PIPELINE_ROOT
from ..db import connect
from ..parsers.eligibility_xlsx import parse_workbook
from ..repo import replace_income_standard, replace_region_tiers, replace_supply_types
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s0.eligibility")

STAGE = "S0"
SOURCE = "eligibility_xlsx"
SEED_PATH = PIPELINE_ROOT.parent / "db" / "seeds" / "eligibility.json"
DEFAULT_INCOME_YEAR = 2025  # 2025년 고시액을 2026년에 적용한다


def add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--xlsx", type=Path, default=None, help="엑셀에서 시드 파일을 다시 만든다")
    ap.add_argument("--seed", type=Path, default=SEED_PATH)
    ap.add_argument("--year", type=int, default=DEFAULT_INCOME_YEAR, help="소득기준 고시연도")


def run(args: argparse.Namespace) -> Stats:
    stats = Stats()
    started = utc_now()

    if args.xlsx:
        data = parse_workbook(args.xlsx, year=args.year)
        args.seed.parent.mkdir(parents=True, exist_ok=True)
        args.seed.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        log.info("시드 갱신 %s", args.seed)
    else:
        if not args.seed.exists():
            stats.error("seed_missing", str(args.seed), FileNotFoundError("시드 파일이 없다. --xlsx로 한 번 만들 것"))
            return stats
        data = json.loads(args.seed.read_text(encoding="utf-8"))

    types, income, tiers = data["supply_types"], data["income_standard"], data["region_tiers"]
    stats.fetched_rows = len(types) + len(income) + len(tiers)
    if args.dry_run:
        stats.skipped["dry_run"] = stats.fetched_rows
        log.info("유형 %d · 소득기준 %d · 지역 %d", len(types), len(income), len(tiers))
        return stats

    conn = connect()
    try:
        with conn.cursor() as cur:
            stats.updated += replace_supply_types(cur, types)
            stats.updated += replace_income_standard(cur, income, year=data.get("income_year", args.year))
            stats.updated += replace_region_tiers(cur, tiers)
            finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started,
                          supply_types=len(types), income_standard=len(income), region_tiers=len(tiers))
        conn.commit()
    finally:
        conn.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    return stage_main("S0 공급유형 자격·배점 시드", run, add_args=add_args, argv=argv)


if __name__ == "__main__":
    raise SystemExit(main())
