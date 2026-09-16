-- 0029 — 방문 집계 (page_view)
--
-- **이 표만 web이 직접 쓴다.** 다른 모든 표는 pipeline이 넣고 web은 읽기만 한다(CLAUDE.md 디렉터리 경계).
-- 예외를 둔 이유: 방문은 브라우저에서만 생기는 사실이라 파이프라인이 알 길이 없다. 사용자 결정(2026-09-16).
--
-- 무엇을 적나 — 무작위 방문자 식별자, 경로, 유입 도메인(호스트만), 시각. 넷뿐이다.
-- **IP도, User-Agent도, 쿼리스트링도 적지 않는다.** visitor_id는 브라우저 localStorage에서
-- 만든 난수 UUID라 사람과 이어지지 않고, 사이트 데이터를 지우면 다음 방문은 남남이 된다.
--
-- 봇은 세 겹으로 거른다: (1) 집계가 JS 비콘이라 스크립트를 안 도는 크롤러는 애초에 안 들어온다,
-- (2) 라우트에서 User-Agent 패턴을 막는다, (3) navigator.webdriver인 자동화 브라우저는 안 쏜다.
-- 그래도 뚫는 놈이 있으면 경로별로 눈에 띈다 — 봇은 사람과 달리 전 지면을 고르게 훑는다.

CREATE TABLE page_view (
  id            bigserial   PRIMARY KEY,
  visitor_id    uuid        NOT NULL,          -- 브라우저가 만든 난수. 사람 식별자가 아니다
  path          text        NOT NULL,          -- 경로만. 쿼리스트링은 떼고 받는다
  referrer_host text,                          -- 유입 도메인. NULL이면 직접 유입
  entry         boolean     NOT NULL DEFAULT false,  -- 이 방문의 첫 조회. 유입 집계는 이 행만 센다
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  page_view IS '방문 집계. web이 직접 쓰는 유일한 표(/api/track). 12개월 뒤 지운다';
COMMENT ON COLUMN page_view.visitor_id IS 'localStorage의 난수 UUID. 브라우저 데이터를 지우면 새 값이 된다';
COMMENT ON COLUMN page_view.entry IS
  '페이지를 새로 연 첫 조회. 클라이언트 라우팅으로 옮겨 다닐 때는 document.referrer가 안 바뀌어 유입 출처가 거짓이 된다';

-- 오늘·최근 N일·동시접속이 전부 시각 범위 훑기다
CREATE INDEX page_view_recent  ON page_view (created_at DESC);
-- 인기 경로
CREATE INDEX page_view_path    ON page_view (path, created_at DESC);
-- 방문자 수(distinct visitor_id)
CREATE INDEX page_view_visitor ON page_view (visitor_id, created_at DESC);
-- 유입 출처는 entry 행만 본다. 전체의 일부라 부분 인덱스가 싸다
CREATE INDEX page_view_entry   ON page_view (created_at DESC) WHERE entry;
