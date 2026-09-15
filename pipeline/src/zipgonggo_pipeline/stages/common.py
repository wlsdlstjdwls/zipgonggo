"""스테이지 공통 — 집계·적재 루프·CLI 진입점.

각 스테이지는 `run(args) -> Stats`만 구현하고 나머지(인자·로깅·출력·종료코드)는 여기서 한다.
"""

from __future__ import annotations

import argparse
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import settings
from ..indexnow import publish as publish_indexnow
from ..repo import insert_ingest_log, upsert_notice

log = logging.getLogger("stage.common")


@dataclass
class Stats:
    fetched_rows: int = 0
    groups: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: dict[str, int] = field(default_factory=dict)
    unmapped_types: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    # 이번 실행에서 처음 들어온 공고 slug. 자동 수집이 「신규만 상세 파싱」을 고르는 근거다
    new_slugs: list[str] = field(default_factory=list)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1

    def unmapped(self, housing_type: str) -> None:
        self.skip("housing_type_unmapped")
        self.unmapped_types[housing_type] = self.unmapped_types.get(housing_type, 0) + 1

    def error(self, reason: str, key: str, exc: BaseException) -> None:
        self.skip(reason)
        self.errors.append(f"{key}: {exc}")

    @property
    def ok(self) -> bool:
        return not self.errors

    def summary(self, **extra: Any) -> dict[str, Any]:
        """ingest_log.message 용. errors는 앞 20건만."""
        return {
            **extra,
            "rows": self.fetched_rows, "groups": self.groups,
            "inserted": self.inserted, "updated": self.updated, "skipped": self.skipped,
            "unmapped_types": self.unmapped_types, "errors": self.errors[:20],
        }


def upsert_guarded(cur, stats: Stats, key: str, notice: dict[str, Any], areas: list[dict[str, Any]]) -> None:
    """공고 1건 upsert. 실패해도 트랜잭션을 살려 다음 건으로 간다(SAVEPOINT)."""
    cur.execute("SAVEPOINT grp")
    try:
        if upsert_notice(cur, notice, areas):
            stats.inserted += 1
            slug = notice.get("slug")
            if slug:
                stats.new_slugs.append(slug)
        else:
            stats.updated += 1
        cur.execute("RELEASE SAVEPOINT grp")
    except Exception as exc:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT grp")
        stats.error("db_error", key, exc)


def finish_ingest(cur, *, stage: str, source: str, stats: Stats, started: datetime, **extra: Any) -> None:
    insert_ingest_log(
        cur, stage=stage, source=source, ok=stats.ok, item_count=stats.inserted + stats.updated,
        message=stats.summary(**extra), started_at=started,
    )


def utc_now() -> datetime:
    return datetime.now(UTC)


def notify_web_revalidate(tags: list[str] | None = None) -> None:
    """DB를 갱신한 직후 web의 unstable_cache(REVALIDATE_SEC=1시간)를 즉시 비운다.

    URL·SECRET 둘 다 없으면 조용히 건너뛴다(로컬엔 배포된 웹이 없을 수 있다).
    실패해도 파이프라인을 막지 않는다 — 최악의 경우 예전처럼 1시간 안에 자연 반영된다(2026-09-09).
    """
    s = settings()
    if not s.web_revalidate_url or not s.revalidate_secret:
        log.debug("WEB_REVALIDATE_URL/REVALIDATE_SECRET 미설정 — 캐시 즉시 갱신 건너뜀")
        return
    try:
        r = httpx.post(
            s.web_revalidate_url,
            headers={"x-revalidate-secret": s.revalidate_secret},
            json={"tags": tags} if tags else {},
            timeout=10.0,
        )
        r.raise_for_status()
        log.info("웹 캐시 갱신 요청 %s", r.json())
    except Exception as exc:  # noqa: BLE001 — 웹훅 실패로 수집 자체를 실패 처리하지 않는다
        log.warning("웹 캐시 갱신 요청 실패(무시): %s", exc)


def stage_main(
    description: str,
    run: Callable[[argparse.Namespace], Stats],
    *,
    add_args: Callable[[argparse.ArgumentParser], None] | None = None,
    argv: list[str] | None = None,
) -> int:
    """공통 CLI. --dry-run · --max-pages · -v 는 모든 스테이지가 갖는다."""
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--dry-run", action="store_true", help="수집·매핑만, DB 쓰기 없음")
    ap.add_argument("--max-pages", type=int, default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    if add_args:
        add_args(ap)
    args = ap.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    stats = run(args)
    print(json.dumps(stats.__dict__, ensure_ascii=False, indent=1))
    if not args.dry_run and stats.ok:
        notify_web_revalidate()
        # 캐시를 비운 **뒤에** 알린다 — 먼저 알리면 크롤러가 옛 지면을 가져간다.
        # 실패해도 파이프라인을 막지 않는다(다음 회차가 같은 행을 다시 집는다 — 해시가 아직 옛것이라)
        try:
            result = publish_indexnow()
            if result.get("submitted"):
                log.info("IndexNow %s", result)
        except Exception as exc:  # noqa: BLE001 — 발행 실패로 수집을 실패 처리하지 않는다
            log.warning("IndexNow 발행 실패(무시): %s", exc)
    return 0 if stats.ok else 1
