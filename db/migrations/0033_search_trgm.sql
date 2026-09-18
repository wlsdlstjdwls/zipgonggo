-- 0033 — 자유 입력 검색(pg_trgm)
--
-- 지금까지 목록을 좁히는 길은 필터(부문·시도·유형·마감)뿐이었다. 「고덕리엔파크」나 「강동구」처럼
-- **이름을 아는 사람**이 들어올 문이 없었다 — 검색에서 넘어온 사람도, 재방문자도 홈에서 필터를 다시 조립해야 했다.
--
-- 한국어라 Postgres 기본 전문검색(to_tsvector)은 쓰지 않는다. 형태소 사전이 없어 어절을 통째로만 잡아
-- 「고덕리엔」으로 「고덕리엔파크2단지」를 못 찾는다. trigram은 부분 문자열을 잡으므로 이쪽이 맞다.
--
-- 정규화는 **공백을 전부 걷고 소문자로**. 사람이 「고덕 리엔파크」라고 띄어 쳐도 붙여 적힌 이름에 닿아야 한다.
-- 필드를 이을 때는 '|'를 남긴다 — 걷어 버리면 단지명 끝과 주소 첫머리가 붙어 없던 낱말이 생긴다.
--
-- 인덱스는 **질의에 쓰는 식과 글자 하나까지 같아야** 플래너가 탄다. 그래서 식을 함수로 굳혀 두고
-- 인덱스도 질의도 그 함수만 부른다(web/src/lib/queries.ts의 searchNotices·searchComplexes).
--
-- 함수 본문에서 `public.`을 **반드시 박는다.** CREATE INDEX는 식을 계획하는 동안 search_path를
-- pg_catalog로 잠근다(인덱스 식이 스키마 바꿔치기에 당하지 않게 하는 보안 장치). 스키마를 안 적으면
-- 「function search_norm(text) does not exist」로 떨어진다 — 세션에서는 멀쩡히 도는데 인덱스만 못 선다(2026-09-18 실측).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 검색 정규화 한 겹. lower()·regexp_replace()는 둘 다 IMMUTABLE이라 인덱스 식에 쓸 수 있다.
CREATE OR REPLACE FUNCTION search_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT regexp_replace(lower(coalesce(t, '')), '[[:space:]]+', '', 'g') $$;

COMMENT ON FUNCTION search_norm(text) IS '검색 정규화: 공백 제거 + 소문자. 인덱스 식과 질의가 공유한다';

-- 공고 검색 열쇠. 제목·단지명·주소·기관·지역을 한 줄로 잇는다.
-- 여기 드는 열은 전부 notice 한 행 안의 값이라 함수 인덱스로 굳을 수 있다.
CREATE OR REPLACE FUNCTION notice_search_key(
  title text, complex_name text, address text, agency text, sido text, sigungu text
) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.search_norm(title) || '|' || public.search_norm(complex_name) || '|' || public.search_norm(address)
            || '|' || public.search_norm(agency) || '|' || public.search_norm(sido) || '|' || public.search_norm(sigungu) $$;

-- 단지 검색 열쇠. 단지 이름과 도로명주소가 본체다.
CREATE OR REPLACE FUNCTION complex_search_key(
  name text, road_address text, sido text, sigungu text
) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.search_norm(name) || '|' || public.search_norm(road_address)
            || '|' || public.search_norm(sido) || '|' || public.search_norm(sigungu) $$;

-- gin_trgm_ops는 LIKE '%…%'를 가속한다. similarity(%)가 아니라 LIKE를 쓰는 이유:
-- 긴 제목에 짧은 말을 던지면 유사도가 길이에 눌려 문턱을 못 넘는다. 「들어 있나」가 우리가 묻는 질문이다.
CREATE INDEX IF NOT EXISTS idx_notice_search ON notice USING gin (
  notice_search_key(title, complex_name, address, agency, sido, sigungu) gin_trgm_ops
);

CREATE INDEX IF NOT EXISTS idx_notice_complex_search ON notice_complex USING gin (
  complex_search_key(name, road_address, sido, sigungu) gin_trgm_ops
);
