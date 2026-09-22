-- SH 포털 상세 링크(publicLease/view?seq=N)를 비운다.
--
-- 그 seq는 공고 식별자가 아니라 **목록에서의 자리 번호**다(실측 2026-09-22). 공고가 하나 올라올 때마다
-- 모든 자리가 한 칸씩 밀린다 — 2026-09-08에 seq=11로 저장한 「금천구 1인가구 청년 맞춤형주택」 링크는
-- 2주 뒤 「2026년 국민임대주택 공고」를 가리키고 있었다. 공고 상세의 「서울주거포털 ↗」 단추가
-- 남의 공고로 보내고 있었다는 뜻이다.
--
-- 앞으로 S1-SH는 제목으로 검색한 목록 URL(sv=제목)을 넣는다(sources/sh.py portal_search_url).
-- 여기서는 썩은 값을 지우기만 한다 — 아직 살아 있는 공고는 다음 수집이 새 값으로 채우고,
-- 목록에서 내려간 공고는 가리킬 포털 지면이 애초에 없으니 NULL이 맞다.
UPDATE notice
   SET portal_url = NULL, updated_at = now()
 WHERE source = 'sh_scrape'
   AND portal_url LIKE '%/site/main/sh/publicLease/view?seq=%';
