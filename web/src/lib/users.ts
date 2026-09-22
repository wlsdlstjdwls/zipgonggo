// 회원 표(user_account · user_saved_notice · user_profile)에 대고 읽고 쓰는 자리.
//
// **web이 DB에 쓰는 예외 셋이 여기 있다**(나머지 하나는 /api/track의 page_view, CLAUDE.md).
// 로그인도 관심 공고 담기도 조건 저장도 브라우저에서만 생기는 사실이라 파이프라인이 알 길이 없다.
// 쓰기는 이 파일에 모아 둔다 — 화면이나 라우트에서 INSERT를 흩뿌리지 않는다.
import { SAVED_MAX_IDS } from "./constants";
import { query } from "./db";
import type { KakaoProfile } from "./kakao";

/**
 * 카카오로 들어온 사람을 회원 표에 맞춰 넣는다. 처음이면 가입, 이미 있으면 접속 기록만 고친다.
 *
 * 별명·프로필 사진은 **매번 덮어쓴다** — 카카오에서 바꾼 이름이 우리 화면에도 따라와야 한다.
 * 다만 이번에 안 온 값(동의 철회 등)으로 있던 값을 지우지는 않는다(COALESCE).
 * 약관 동의 시각은 가입 때 한 번만 찍는다 — 「언제 동의했나」가 흐려지면 기록으로서 쓸모가 없다.
 */
export async function upsertKakaoUser(p: KakaoProfile, termsVersion: string): Promise<number | null> {
  const rows = await query<{ id: number }>(
    `INSERT INTO user_account (kakao_id, nickname, profile_image, email, terms_version)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (kakao_id) DO UPDATE SET
       nickname      = COALESCE(EXCLUDED.nickname, user_account.nickname),
       profile_image = COALESCE(EXCLUDED.profile_image, user_account.profile_image),
       email         = COALESCE(EXCLUDED.email, user_account.email),
       last_login_at = now(),
       login_count   = user_account.login_count + 1
     RETURNING id`,
    [p.kakaoId, p.nickname, p.profileImage, p.email, termsVersion],
  );
  return rows[0]?.id ?? null;
}

/** 탈퇴. 행을 지운다 — 관심 공고와 저장해 둔 조건은 CASCADE로 같이 사라진다. 되돌릴 길은 없다(그게 의도다) */
export async function deleteUser(userId: number): Promise<void> {
  await query(`DELETE FROM user_account WHERE id = $1`, [userId]);
}

/** 담아 둔 공고 id. 담은 순서가 아니라 **나중에 담은 것부터** 준다 */
export async function listSavedIds(userId: number): Promise<number[]> {
  const rows = await query<{ notice_id: number }>(
    `SELECT notice_id FROM user_saved_notice WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, SAVED_MAX_IDS],
  );
  return rows.map((r) => r.notice_id);
}

export async function addSaved(userId: number, noticeId: number): Promise<void> {
  // 공고가 없는 id(재적재로 사라진 공고)는 외래키가 조용히 막는다 — 그건 실패가 아니라 정상이다
  await query(
    `INSERT INTO user_saved_notice (user_id, notice_id)
     SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM notice WHERE id = $2)
     ON CONFLICT DO NOTHING`,
    [userId, noticeId],
  );
}

export async function removeSaved(userId: number, noticeId: number): Promise<void> {
  await query(`DELETE FROM user_saved_notice WHERE user_id = $1 AND notice_id = $2`, [userId, noticeId]);
}

/**
 * 로그인 직후 한 번 — 브라우저에 쌓여 있던 목록을 서버 목록에 **합친다**.
 * 서버 쪽을 지우지 않는다: 다른 기기에서 담아 둔 것이 이 기기의 빈 목록에 덮여 사라지면
 * 이용자로서는 이유를 알 길이 없는 손실이다. 합치기만 하고 빼기는 사람 손으로만 한다.
 */
export async function mergeSaved(userId: number, noticeIds: number[]): Promise<void> {
  const ids = [...new Set(noticeIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, SAVED_MAX_IDS);
  if (ids.length === 0) return;
  await query(
    `INSERT INTO user_saved_notice (user_id, notice_id)
     SELECT $1, n.id FROM notice n WHERE n.id = ANY($2::bigint[])
     ON CONFLICT DO NOTHING`,
    [userId, ids],
  );
}

// ─────────────────────────── 저장해 둔 「내 조건」 ───────────────────────────
//
// **행이 있으면 계정 저장이 켜진 것이다.** 깃발 열을 따로 두지 않는다 — 끄기는 행을 지우는 것이다.
// 들어오는 값은 반드시 sanitizeProfile(…, false)를 지난 뒤에만 여기 온다(라우트가 건다) —
// 민감 칸과 모르는 키는 그 문에서 떨어진다.

export type StoredUserProfile = { data: unknown; updated_at: string; privacy_version: string };

/** 저장해 둔 조건. 없으면 null — 그게 「계정 저장 꺼짐」이다 */
export async function getProfile(userId: number): Promise<StoredUserProfile | null> {
  const rows = await query<StoredUserProfile>(
    `SELECT data, updated_at, privacy_version FROM user_profile WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * 조건 한 벌을 넣거나 고친다. 처음 넣는 순간이 **동의한 시각**이라 consented_at은 그때 한 번만 찍는다 —
 * 값을 고칠 때마다 갱신하면 「언제 동의했나」가 흐려져 기록으로서 쓸모가 없다(가입 동의와 같은 태도).
 */
export async function putProfile(userId: number, data: unknown, privacyVersion: string): Promise<string | null> {
  const rows = await query<{ updated_at: string }>(
    `INSERT INTO user_profile (user_id, data, privacy_version)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       data            = EXCLUDED.data,
       privacy_version = EXCLUDED.privacy_version,
       updated_at      = now()
     RETURNING updated_at`,
    [userId, JSON.stringify(data), privacyVersion],
  );
  return rows[0]?.updated_at ?? null;
}

/** 계정 저장 끄기. 서버 사본만 지운다 — 브라우저에 있는 값은 그대로 남는다 */
export async function clearProfile(userId: number): Promise<void> {
  await query(`DELETE FROM user_profile WHERE user_id = $1`, [userId]);
}

/** 오래 손대지 않은 조건을 파기한다(개인정보처리방침 3항의 보유 기간). 지운 행 수를 돌려준다 */
export async function purgeStaleProfiles(months: number): Promise<number> {
  const rows = await query<{ n: number }>(
    `WITH gone AS (
       DELETE FROM user_profile
        WHERE updated_at < now() - ($1 || ' months')::interval
        RETURNING 1
     ) SELECT count(*)::int AS n FROM gone`,
    [String(months)],
  );
  return rows[0]?.n ?? 0;
}

// ─────────────────────────── 운영자 콘솔용 읽기 ───────────────────────────

export type MemberStats = {
  total: number;
  new7d: number;
  active30d: number;
  with_saved: number;
  saved_total: number;
  /** 계정 저장을 켠 회원 수. **값은 콘솔에 내지 않는다** — 운영자가 남의 소득을 들여다보는 화면을 만들지 않는다 */
  with_profile: number;
};

export type MemberRow = {
  id: number;
  nickname: string | null;
  email: string | null;
  profile_image: string | null;
  created_at: string;
  last_login_at: string;
  login_count: number;
  terms_version: string;
  saved_count: number;
};

/** 회원 요약 여섯. 질의 하나로 받는다 — 나눠 던지면 왕복이 늘고 커넥션이 더 열린다(lib/admin.ts와 같은 태도) */
export async function memberStats(): Promise<MemberStats> {
  const rows = await query<MemberStats>(
    `SELECT
       (SELECT count(*) FROM user_account)                                                    AS total,
       (SELECT count(*) FROM user_account WHERE created_at    > now() - interval '7 days')    AS new7d,
       (SELECT count(*) FROM user_account WHERE last_login_at > now() - interval '30 days')   AS active30d,
       (SELECT count(DISTINCT user_id) FROM user_saved_notice)                                AS with_saved,
       (SELECT count(*) FROM user_saved_notice)                                               AS saved_total,
       (SELECT count(*) FROM user_profile)                                                    AS with_profile`,
  );
  return rows[0] ?? { total: 0, new7d: 0, active30d: 0, with_saved: 0, saved_total: 0, with_profile: 0 };
}

/** 회원 목록. 최근 가입 순 */
export async function listMembers(limit: number, offset: number): Promise<MemberRow[]> {
  return query<MemberRow>(
    `SELECT u.id, u.nickname, u.email, u.profile_image, u.created_at, u.last_login_at,
            u.login_count, u.terms_version,
            (SELECT count(*) FROM user_saved_notice s WHERE s.user_id = u.id) AS saved_count
       FROM user_account u
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export type SavedRank = { id: number; slug: string; title: string; savers: number };

/** 회원들이 많이 담은 공고. 「무엇을 눈여겨보는가」는 방문 수보다 이쪽이 정직하다 */
export async function topSavedNotices(limit = 8): Promise<SavedRank[]> {
  return query<SavedRank>(
    `SELECT n.id, n.slug, n.title, count(*)::int AS savers
       FROM user_saved_notice s JOIN notice n ON n.id = s.notice_id
      GROUP BY n.id, n.slug, n.title
      ORDER BY savers DESC, n.id DESC
      LIMIT $1`,
    [limit],
  );
}
