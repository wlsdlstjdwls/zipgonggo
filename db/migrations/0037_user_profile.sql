-- 0037 — 회원이 저장해 둔 「내 조건」. web이 직접 쓰는 네 번째 표(CLAUDE.md 예외, 2026-09-22)
--
-- 신청 조건은 브라우저에서만 생긴다 — 파이프라인은 알 길이 없고 쳐다보지도 않는다.
-- **행이 있으면 계정 저장이 켜진 것이다.** 따로 깃발 열을 두지 않는다 — 두면 「행은 있는데 꺼짐」
-- 같은 상태가 생기고, 그 상태가 무슨 뜻인지 아무도 모른다. 끄기는 DELETE 한 줄이다.
--
-- data를 jsonb 한 칸으로 두는 이유: 장기전세는 회차마다 묻는 칸이 갈린다. 열로 펴면 회차마다
-- 마이그레이션이 붙는다. 대신 들어오는 값은 web/src/lib/profile.ts의 sanitizeProfile이
-- 화이트리스트로 걸러 넣는다 — 모르는 키는 저장되지 않는다.
--
-- **장애 여부처럼 건강과 이어지는 값은 이 표에 들어오지 않는다**(개인정보처리방침 3항).
-- 거르는 자리가 둘이다: 브라우저가 stripSensitive로 빼고, 서버가 sanitizeProfile(…, false)로 또 뺀다.
CREATE TABLE IF NOT EXISTS user_profile (
  user_id         bigint      PRIMARY KEY REFERENCES user_account (id) ON DELETE CASCADE,
  data            jsonb       NOT NULL,
  privacy_version text        NOT NULL,
  consented_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 프로필 한 벌은 1KB가 채 안 된다. 4KB를 넘겼다면 우리가 만든 값이 아니다
  CONSTRAINT user_profile_small CHECK (pg_column_size(data) < 4096)
);

COMMENT ON TABLE  user_profile IS
  '회원이 저장해 둔 자격진단 조건. 행이 있으면 계정 저장이 켜진 것이다. 탈퇴하면 CASCADE로 같이 지워진다';
COMMENT ON COLUMN user_profile.data IS
  'lib/profile.ts의 UserProfile에서 민감 칸(장애 여부 등)을 뺀 사본. 모르는 키는 sanitizeProfile이 떨군다';
COMMENT ON COLUMN user_profile.privacy_version IS
  '이 값을 저장할 때 동의한 개인정보처리방침 시행일. 방침이 바뀌면 언제 판에 동의했는지 여기로 가린다';
COMMENT ON COLUMN user_profile.updated_at IS
  '마지막으로 고친 시각. 브라우저 사본과 어느 쪽이 최신인지 이 값으로 가른다. 24개월 지나면 파기 대상';

-- 인덱스를 두지 않는다. 조회는 늘 WHERE user_id = $1 이고 PK가 그 일을 한다.
-- 파기 잡만 updated_at을 훑는데, 회원 수가 인덱스를 아쉬워할 만큼 불면 그때 붙인다.
