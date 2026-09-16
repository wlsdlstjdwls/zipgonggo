"""IndexNow 손수 발행 — 평소엔 스테이지가 알아서 부른다(stages/common.py).

    python pipeline/scripts/indexnow.py --dry-run     # 무엇을 쏠지만 본다
    python pipeline/scripts/indexnow.py               # 실제 제출(공고 + 사이트맵)
    python pipeline/scripts/indexnow.py --limit 50
    python pipeline/scripts/indexnow.py --only sitemap --limit 1000   # 첫 백필

발행기는 둘이다. **공고 상세**는 내용 해시로 고르고(0028), **나머지 지면**(단지·유형 허브·
지역×유형·지역·정책문서)은 배포된 사이트맵을 읽어 처음 보는 URL만 민다(0030).

첫 발행처럼 「전량을 한 번에」 밀 때, 또는 해시 계산을 고친 뒤 확인할 때 쓴다.
--dry-run은 DB를 건드리지 않는다.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from zipgonggo_pipeline.indexnow import BATCH_MAX, publish, publish_sitemap  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="IndexNow 발행")
    ap.add_argument("--limit", type=int, default=BATCH_MAX)
    ap.add_argument("--only", choices=("notice", "sitemap"), default=None,
                    help="한쪽만 돌린다. 기본은 둘 다")
    ap.add_argument("--dry-run", action="store_true", help="고르기만 하고 제출·기록 안 함")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    out = {}
    if args.only != "sitemap":
        out["notice"] = publish(args.limit, dry_run=args.dry_run)
    if args.only != "notice":
        out["sitemap"] = publish_sitemap(args.limit, dry_run=args.dry_run)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
