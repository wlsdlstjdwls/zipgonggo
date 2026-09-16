-- 0030 — 공고 아닌 URL의 IndexNow 제출 이력 (indexnow_url)
--
-- 0028은 **공고 상세**(`/notice/{공고}`)만 맡는다. 그런데 지면은 그게 다가 아니다 —
-- 단지(`/notice/{공고}/{호실}`) · 유형 허브(`/type/{유형}`) · 지역×유형(`/area/{시군구}/{유형}`) ·
-- 지역(`/area/{시도}`)까지 합쳐 1,700장이 넘는데, 이것들은 사이트맵으로만 알리고 있었다.
-- 사이트맵은 「이 URL들이 있다」이고 IndexNow는 「방금 이게 생겼다」다. 새 페이지일수록 후자가 빠르다.
--
-- **왜 URL 표인가 — notice에 컬럼을 더 붙일 수 없는 이유.**
-- 단지는 `notice_complex`라 수집 때마다 통째로 replace된다(0026·0027이 별도 표로 빠진 것과 같은 이유).
-- 유형 허브·지역 페이지는 아예 DB 행이 없다 — 발행 여부를 web의 `sitemap.ts`가 판정한다.
-- 그래서 붙일 데가 없다. URL 문자열 자체를 열쇠로 쓰는 표를 따로 둔다.
--
-- **왜 발행 대상을 사이트맵에서 읽나.** 「무엇을 색인시킬 것인가」의 판정식이 web에 하나뿐이다
-- (`sitemap.ts` → `queries.ts`의 COMPLEX_FIELDS·AREA_MIN_COUNT·AREA_TYPE_MIN_COUNT).
-- pipeline이 같은 기준을 SQL로 베껴 쓰면 두 벌이 되고, 한쪽만 고치는 날 색인 대상과 발행 대상이 갈린다.
-- 배포된 `/sitemap.xml`을 읽는 건 import가 아니라 HTTP라 디렉터리 경계(CLAUDE.md)도 안 넘는다.
--
-- **왜 「처음 본 URL」만 쏘고 lastmod는 안 보나.**
-- 사이트맵의 허브·지역 페이지 lastmod는 「가장 최근 공고의 updated_at」이라 수집이 돌 때마다 움직인다.
-- 그걸 신호로 삼으면 같은 60장을 매시 다시 던지게 되고, 반복 제출은 IndexNow가 하지 말라는 짓이다.
-- 단지 페이지의 내용 변화는 제 공고가 바뀔 때 0028 경로로 이미 알려진다(공고 지면이 단지를 싣는다).
-- 그래서 이 표는 「이 URL을 한 번이라도 알렸는가」만 기억한다. 열은 그래서 둘뿐이다.
--
-- 지운 URL은? 지우지 않는다(CLAUDE.md 하지 말 것 5) — 그래서 이 표도 행을 지우지 않는다.
-- 어떤 URL을 다시 쏘고 싶으면 그 행만 DELETE 하면 다음 회차가 새 URL로 본다.

CREATE TABLE IF NOT EXISTS indexnow_url (
  url          text PRIMARY KEY,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE indexnow_url IS
  '공고 상세가 아닌 발행 URL(단지/유형/지역/정책문서)의 IndexNow 제출 이력. 있으면 이미 알린 것이다';
COMMENT ON COLUMN indexnow_url.submitted_at IS
  '처음 제출한 시각. 갱신하지 않는다 — 이 표는 재발행 신호가 아니라 「알렸다」는 사실만 든다';
