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

**발행기가 둘인 이유.**
`publish()`는 공고 상세(`/notice/{공고}`)만 맡는다. 지면의 나머지 — 단지·유형 허브·지역×유형·지역 —
는 DB 행이 없거나(허브·지역) 수집마다 replace되는 표라(단지) notice처럼 해시를 얹을 데가 없고,
애초에 「무엇을 발행하는가」의 판정식이 web의 `sitemap.ts` 한 곳에 있다. 그래서 `publish_sitemap()`은
배포된 `/sitemap.xml`을 읽어 **처음 보는 URL만** 한 번씩 민다(0030). 자세한 근거는 그 마이그레이션에.
"""

from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import quote, urlsplit

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
# 자식 표는 행 수만 본다 — 내용까지 해시하면 좌표 하나 붙어도 전량 재발행이 된다.
#
# `complex_code`가 들어 있는 이유(2026-09-17): 이 값이 붙는 순간 지면에 「단지 정보」 섹션이 통째로
# 생긴다(제원 + 주택형별 금액 + 예비 대기). 껍데기가 알맹이로 바뀌는 변화라 다시 알려야 한다.
# **대기 인원(waitlist)은 일부러 안 넣었다** — 날마다 움직이는 값이라 넣으면 단지 붙은 공고 전량을
# 매일 다시 쏘게 된다. 반복 제출은 IndexNow가 하지 말라는 짓이다(0028 주석).
_HASH_SQL = """
  md5(ROW(
    n.title, n.status::text, n.housing_type::text, n.agency,
    n.apply_start_at, n.apply_end_at, n.announce_at,
    n.supply_count, n.min_deposit, n.min_rent, n.canonical_id, n.complex_code,
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


# ── 사이트맵에서 읽는 쪽 (0030) ────────────────────────────────────────────────

SITEMAP_URL = f"{ORIGIN}/sitemap.xml"

# sitemaps.org 0.9. Next의 MetadataRoute.Sitemap이 이 네임스페이스로 낸다
_SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

# 사이트맵 색인(sitemapindex)을 따라 내려갈 깊이. url-structure.md대로 파일당 40,000을 넘기면
# web이 generateSitemaps로 쪼갤 텐데, 그때 여기를 고치지 않아도 되게 한 단은 따라간다
_SITEMAP_DEPTH = 1


def parse_sitemap(xml: str) -> tuple[list[str], list[str]]:
    """사이트맵 XML에서 (URL들, 하위 사이트맵들)을 뽑는다. lastmod는 읽지 않는다 — 0030 참고."""
    root = ET.fromstring(xml)
    locs = [(e.text or "").strip() for e in root.iter(f"{_SM_NS}loc")]
    if root.tag == f"{_SM_NS}sitemapindex":
        return [], [u for u in locs if u]
    return [u for u in locs if u], []


def is_notice_detail(url: str) -> bool:
    """`/notice/{공고}` 인가. 이건 `publish()`가 해시로 맡으므로 사이트맵 쪽은 건드리지 않는다.

    단지(`/notice/{공고}/{호실}`)는 여기 해당하지 않는다 — slug의 슬래시는 인코딩돼 있어
    경로 칸 수로 가른다(`notice_url`의 `safe=''`와 같은 약속).
    """
    segs = [s for s in urlsplit(url).path.split("/") if s]
    return len(segs) == 2 and segs[0] == "notice"


def sitemap_urls(
    *, client: Any = None, url: str = SITEMAP_URL, depth: int = _SITEMAP_DEPTH,
) -> list[str]:
    """배포된 사이트맵을 읽어 공고 상세를 뺀 URL 목록을 순서대로 돌려준다."""
    get = client.get if client is not None else httpx.get
    r = get(url, timeout=30.0)
    r.raise_for_status()
    urls, children = parse_sitemap(r.text)
    if children and depth > 0:
        for child in children:
            urls.extend(sitemap_urls(client=client, url=child, depth=depth - 1))
    # 순서·중복 정리. 사이트맵 순서가 곧 우선순위라(홈 → 허브 → 지역 → 단지) dict로 순서를 지킨다
    return list(dict.fromkeys(u for u in urls if not is_notice_detail(u)))


def publish_sitemap(
    limit: int = BATCH_MAX, *, dry_run: bool = False, client: Any = None,
) -> dict[str, Any]:
    """사이트맵에 새로 생긴 URL을 제출한다. 이미 알린 URL은 다시 쏘지 않는다(0030).

    `publish()`와 마찬가지로 실패해도 예외를 던지지 않는다 — 다음 회차가 같은 URL을 다시 집는다.
    """
    api_key = key()
    if not api_key:
        log.debug("INDEXNOW_KEY 미설정 — 사이트맵 발행 건너뜀")
        return {"skipped": "no_key"}

    urls = sitemap_urls(client=client)
    if not urls:
        return {"submitted": 0}

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT url FROM indexnow_url WHERE url = ANY(%s)", (urls,))
        known = {r["url"] for r in cur.fetchall()}
        fresh = [u for u in urls if u not in known][:limit]
        if not fresh:
            return {"submitted": 0, "known": len(known)}
        if dry_run:
            return {"would_submit": len(fresh), "known": len(known), "urls": fresh[:5]}

        if not submit(fresh, api_key):
            return {"submitted": 0, "failed": len(fresh)}

        # 제출한 것만 적는다. 중복 키는 조용히 넘긴다 — 두 잡이 겹쳐 돌아도 사고가 안 나게
        cur.executemany(
            "INSERT INTO indexnow_url (url) VALUES (%s) ON CONFLICT (url) DO NOTHING",
            [(u,) for u in fresh],
        )
        conn.commit()

    log.info("IndexNow 사이트맵 제출 %d건", len(fresh))
    return {"submitted": len(fresh), "known": len(known)}
