"""IndexNow 발행 — 바뀐 공고 URL을 검색엔진에 밀어 넣는다.

받는 곳: 빙 · 네이버 · 얀덱스 · Seznam(`api.indexnow.org` 하나로 전부에 퍼진다).
**구글은 참여하지 않는다** — 구글은 사이트맵과 제 크롤 주기로만 온다.

왜 하나: 공고는 접수 기간이 2주 안팎이다. 크롤러가 제 주기로 올 때까지 기다리면 이미 마감이라
색인돼 봐야 쓸모가 없다. 사이트맵이 「이 URL들이 있다」면 IndexNow는 「방금 이게 바뀌었다」다.

왜 pipeline에 있나: CLAUDE.md 디렉터리 경계 — `pipeline/`이 수집·파싱·정규화·좌표매칭·**발행**이다.
web은 키 파일(`/{키}.txt`)을 내주기만 한다.

**두 번 쏘지 않기 — 이 모듈의 핵심.**
`repo.UPSERT_SQL`이 `updated_at = now()`를 조건 없이 걸어서, 값이 안 바뀌어도 수집 한 번에
updated_at이 새로 찍힌다. 그래서 updated_at이 아니라 **지면 내용 해시**를 본다(0028).
해시 재료에 자식 표 행 수를 넣는 이유는 S1이 목록만 넣고 S3가 첨부를 파싱해 알맹이를 채우기 때문이다 —
그때 notice 컬럼은 거의 안 움직이는데 지면은 껍데기에서 알맹이로 바뀐다.
"""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import quote

import httpx

from .db import connect

log = logging.getLogger("indexnow")

# 하나에 넣으면 참여 엔진 전부에 퍼진다. 엔진별 엔드포인트를 따로 때릴 필요 없다
ENDPOINT = "https://api.indexnow.org/indexnow"
HOST = "zipgonggo.com"
ORIGIN = f"https://{HOST}"

# 한 번에 보낼 URL 수. 규격 상한은 10,000이지만 우리는 매시 도는 잡이라 이만큼이면 늘 남는다.
# 상한을 두는 진짜 이유는 사고 방지다 — 해시 계산을 잘못 건드리면 전량이 「바뀜」으로 잡힌다
BATCH_MAX = 200

# 지면에 실제로 나가는 값들. 하나라도 바뀌면 다시 알린다.
# 자식 표는 행 수만 본다 — 내용까지 해시하면 좌표 하나 붙어도 전량 재발행이 된다
_HASH_SQL = """
  md5(ROW(
    n.title, n.status::text, n.housing_type::text, n.agency,
    n.apply_start_at, n.apply_end_at, n.announce_at,
    n.supply_count, n.min_deposit, n.min_rent, n.canonical_id,
    (SELECT count(*) FROM notice_supply     s WHERE s.notice_id = n.id),
    (SELECT count(*) FROM notice_complex    c WHERE c.notice_id = n.id),
    (SELECT count(*) FROM notice_eligibility e WHERE e.notice_id = n.id)
  )::text)
"""

# 마감된 지 이만큼 지난 공고는 IndexNow로 밀지 않는다(일).
# URL은 그대로 살아 있고(CLAUDE.md 하지 말 것 5) 사이트맵이 전부 싣는다 — IndexNow는 「지금 급한 것」 전용이다.
# 이 선이 없으면 첫 발행이 마감분까지 976건을 한꺼번에 밀어 「급한 것」 신호가 통째로 흐려진다
CLOSED_GRACE_DAYS = 14

# 공고일이 이보다 오래된 글은 밀지 않는다(일).
# i-sh 게시판 백필로 2004년치까지 들어와 있고(449건), 그중 278건은 접수 마감일이 아예 없어
# 위 CLOSED_GRACE_DAYS 조건을 그냥 통과한다. 두 조건을 **모두** 걸어야 옛 아카이브가 안 섞인다
RECENT_DAYS = 60

# 정본만 쏜다 — 딸림 글은 canonical이 정본을 가리켜 색인이 그리로 모인다(web generateMetadata).
# 해시가 예전 그대로면 지면이 안 바뀐 것이라 건너뛴다
_PENDING_SQL = f"""
SELECT n.id, n.slug, {_HASH_SQL} AS h
FROM notice n
WHERE n.canonical_id IS NULL
  AND n.posted_at >= CURRENT_DATE - %s::int
  AND (n.apply_end_at IS NULL OR n.apply_end_at >= CURRENT_DATE - %s::int)
  AND (n.indexnow_hash IS NULL OR n.indexnow_hash IS DISTINCT FROM {_HASH_SQL})
ORDER BY n.indexnow_at NULLS FIRST, n.posted_at DESC
LIMIT %s
"""


def key() -> str:
    """INDEXNOW_KEY. 비밀값이 아니다 — 규격이 `/{키}.txt`를 공개하라고 요구한다.
    비어 있으면 발행을 건너뛴다(로컬엔 배포된 웹이 없을 수 있다)."""
    return os.environ.get("INDEXNOW_KEY", "").strip()


def notice_url(slug: str) -> str:
    """web의 `noticePath`와 같은 규칙. slug에 한글·콜론이 들어가므로 인코딩한다."""
    return f"{ORIGIN}/notice/{quote(slug, safe='')}"


def submit(urls: list[str], api_key: str, *, client: Any = None) -> bool:
    """IndexNow에 한 묶음 제출. 성공 여부만 돌려준다.

    규격상 200(접수)과 202(접수, 키 검증 대기) 둘 다 성공이다.
    """
    payload = {
        "host": HOST,
        "key": api_key,
        "keyLocation": f"{ORIGIN}/{api_key}.txt",
        "urlList": urls,
    }
    post = client.post if client is not None else httpx.post
    r = post(ENDPOINT, json=payload, timeout=15.0)
    if r.status_code in (200, 202):
        return True
    # 422는 대개 키 파일을 못 읽은 것 — URL이 아니라 배포 쪽 문제라 본문을 남긴다
    log.warning("IndexNow 거절 %s: %s", r.status_code, r.text[:200])
    return False


def publish(limit: int = BATCH_MAX, *, dry_run: bool = False) -> dict[str, Any]:
    """바뀐 공고를 골라 제출하고 이력을 남긴다. 파이프라인을 막지 않는다 — 실패해도 예외를 던지지 않는다."""
    api_key = key()
    if not api_key:
        log.debug("INDEXNOW_KEY 미설정 — IndexNow 발행 건너뜀")
        return {"skipped": "no_key"}

    with connect() as conn, conn.cursor() as cur:
        cur.execute(_PENDING_SQL, (RECENT_DAYS, CLOSED_GRACE_DAYS, limit))
        rows = cur.fetchall()
        if not rows:
            return {"submitted": 0}
        urls = [notice_url(r["slug"]) for r in rows]
        if dry_run:
            return {"would_submit": len(urls), "urls": urls[:5]}

        if not submit(urls, api_key):
            return {"submitted": 0, "failed": len(urls)}

        # 제출한 것만 이력을 찍는다. 해시는 **고를 때 읽은 값**을 그대로 쓴다 —
        # 여기서 다시 계산하면 그 사이에 바뀐 내용을 「알린 것」으로 덮어써 영영 안 쏘게 된다
        cur.executemany(
            "UPDATE notice SET indexnow_at = now(), indexnow_hash = %s WHERE id = %s",
            [(r["h"], r["id"]) for r in rows],
        )
        conn.commit()

    log.info("IndexNow 제출 %d건", len(urls))
    return {"submitted": len(urls)}
