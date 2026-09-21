-- 0035 — 회원(카카오 로그인)
--
-- **CLAUDE.md의 「web은 DB를 읽기만 한다」에 두 번째 예외를 연다**(사용자 결정 2026-09-21).
-- 0029의 page_view와 같은 이유다 — 로그인도 관심 공고 담기도 브라우저에서만 생기는 사실이라
-- 파이프라인이 알 길이 없다. 파이프라인은 이 두 표를 쳐다보지 않는다.
--
-- 무엇을 적나 — 카카오가 주는 회원번호와 별명, 프로필 이미지 주소, 동의 시각, 접속 시각뿐이다.
-- **액세스 토큰은 한 글자도 저장하지 않는다.** 로그인 순간에만 쓰고 버린다 —
-- 저장해 두면 유출 시 남의 카카오 계정을 대신 부를 수 있는 열쇠가 된다.
-- 이메일은 카카오 동의항목 검수를 받은 뒤에만 들어온다. 안 오면 NULL로 둔다(없어도 서비스가 돈다).
--
-- 탈퇴는 행을 지운다(soft delete를 두지 않는다). 남겨 둘 이유가 없는 정보라 유예 없이 지우고,
-- 같은 카카오 계정으로 다시 들어오면 새 회원으로 시작한다.

CREATE TABLE user_account (
  id              bigserial   PRIMARY KEY,
  kakao_id        text        NOT NULL UNIQUE,   -- 카카오 회원번호. 앱마다 다른 값이라 다른 서비스와 이어지지 않는다
  nickname        text,                          -- 카카오 프로필 별명. 바뀌면 다음 로그인 때 따라간다
  profile_image   text,                          -- 카카오 프로필 이미지 URL. 파일을 우리가 보관하지 않는다
  email           text,                          -- 카카오 검수를 통과한 앱에만 온다. 보통 NULL
  terms_version   text        NOT NULL,          -- 동의한 이용약관 시행일. 약관이 바뀌면 재동의를 받는 근거
  terms_agreed_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz NOT NULL DEFAULT now(),
  login_count     integer     NOT NULL DEFAULT 1
);

COMMENT ON TABLE  user_account IS
  '카카오 로그인 회원. web이 직접 쓰는 두 번째 표(page_view에 이어). 파이프라인은 건드리지 않는다';
COMMENT ON COLUMN user_account.kakao_id IS
  '카카오 회원번호(id). 앱 단위로 다른 값이라 이것만으로는 카카오 계정을 특정할 수 없다';
COMMENT ON COLUMN user_account.terms_version IS
  '가입 시점의 이용약관 시행일(TERMS_EFFECTIVE_DATE). 로그인 버튼은 동의 체크 없이는 안 눌린다';
COMMENT ON COLUMN user_account.login_count IS '로그인 횟수. 운영자 콘솔에서 살아 있는 회원을 가리는 데 쓴다';

-- 가입 순 목록(운영자 콘솔)·최근 접속 순 목록
CREATE INDEX user_account_created_idx ON user_account (created_at DESC);
CREATE INDEX user_account_login_idx   ON user_account (last_login_at DESC);

-- 관심 공고(★). 여태 브라우저 localStorage에만 있던 목록을 로그인한 사람만 서버로 업어 둔다.
-- 로그아웃 상태에서는 예전 그대로 브라우저에만 남는다 — 로그인이 없어도 서비스는 그대로 돈다.
CREATE TABLE user_saved_notice (
  user_id    bigint      NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  notice_id  bigint      NOT NULL REFERENCES notice (id)       ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notice_id)
);

COMMENT ON TABLE user_saved_notice IS
  '로그인 회원의 관심 공고(★). 탈퇴하면 CASCADE로 같이 지워진다. 공고가 사라져도(재적재) 같이 지워진다';

-- 「이 공고를 몇 명이 담았나」 — 운영자 콘솔의 인기 공고
CREATE INDEX user_saved_notice_notice_idx ON user_saved_notice (notice_id);
