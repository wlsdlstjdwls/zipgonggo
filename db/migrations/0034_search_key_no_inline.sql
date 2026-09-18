-- 0034 — 검색 열쇠 함수를 인라인 불가로 굳힌다 (0033 후속)
--
-- 0033의 인덱스는 **함수 호출 꼴 그대로** 저장된다:
--   gin (notice_search_key(title, complex_name, ...) gin_trgm_ops)
-- 그런데 질의에서 같은 함수를 부르면 플래너가 LANGUAGE sql 함수를 **인라인**해 버려
-- regexp_replace(lower(...)) || '|' || … 라는 생짜 식으로 바뀐다. 저장된 식과 모양이 달라져
-- 인덱스가 안 잡히고 Seq Scan으로 떨어진다(2026-09-18 EXPLAIN 실측).
--
-- `SET search_path`가 붙은 SQL 함수는 인라인되지 않는다 — 실행 전에 설정을 갈아야 해서다.
-- 그 성질을 그대로 쓴다. 질의도 인덱스도 함수 호출 꼴로 남아 서로 맞는다.
-- 덤으로 search_path를 함수가 스스로 들고 있어 CREATE INDEX의 잠긴 search_path 문제(0033 머리글)도 사라진다.
--
-- 표가 2천 행 남짓이라 지금은 Seq Scan도 몇 ms다. 그래도 고쳐 두는 건 공고가 쌓이는 표이기 때문이고,
-- 「인덱스는 있는데 안 탄다」가 제일 늦게 들키는 종류의 빚이기 때문이다.

DROP INDEX IF EXISTS idx_notice_search;
DROP INDEX IF EXISTS idx_notice_complex_search;

CREATE OR REPLACE FUNCTION notice_search_key(
  title text, complex_name text, address text, agency text, sido text, sigungu text
) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, public
  AS $$ SELECT public.search_norm(title) || '|' || public.search_norm(complex_name) || '|' || public.search_norm(address)
            || '|' || public.search_norm(agency) || '|' || public.search_norm(sido) || '|' || public.search_norm(sigungu) $$;

CREATE OR REPLACE FUNCTION complex_search_key(
  name text, road_address text, sido text, sigungu text
) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, public
  AS $$ SELECT public.search_norm(name) || '|' || public.search_norm(road_address)
            || '|' || public.search_norm(sido) || '|' || public.search_norm(sigungu) $$;

CREATE INDEX idx_notice_search ON notice USING gin (
  notice_search_key(title, complex_name, address, agency, sido, sigungu) gin_trgm_ops
);

CREATE INDEX idx_notice_complex_search ON notice_complex USING gin (
  complex_search_key(name, road_address, sido, sigungu) gin_trgm_ops
);
