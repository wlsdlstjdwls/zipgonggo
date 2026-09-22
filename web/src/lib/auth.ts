// 이용자 로그인 세션. 카카오로 들어온 사람에게 주는 쪽지 한 장이 전부다.
//
// 세션 표를 두지 않는다 — 운영자 쿠키(lib/admin-auth.ts)와 같은 방식으로 **서명된 쪽지**만 준다.
// 쪽지: `v1.<만료ms>.<회원id>.<HMAC>`. 서버가 들고 있는 열쇠는 env AUTH_SECRET 하나다.
// 로그아웃은 쿠키를 지우는 것이고, 전원 강제 로그아웃은 AUTH_SECRET을 갈아끼우는 것이다.
//
// **쿠키에 별명도 이메일도 싣지 않는다.** 회원 id만 싣고 나머지는 그때그때 DB에서 읽는다 —
// 쿠키에 실어 두면 카카오에서 별명을 바꿔도 우리 화면만 옛 이름을 계속 말한다.
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./db";

export const USER_COOKIE = "zg_user";
/** 카카오로 나갈 때 심는 물표 쿠키(state + 돌아갈 자리). 라우트 파일은 GET/POST 말고는
 *  내보낼 수 없어(Next가 타입으로 막는다) 두 라우트가 같이 쓰는 이 이름을 여기 둔다 */
export const OAUTH_COOKIE = "zg_oauth";
export const OAUTH_COOKIE_PATH = "/api/auth";
/** 카카오 로그인 화면에서 머무를 수 있는 시간(초). 넘기면 물표가 사라져 처음부터 다시 */
export const OAUTH_MAX_AGE = 600;
/** 로그인 유지 기간(초). 한 달에 한 번쯤 다시 누르는 정도 */
export const USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type SessionUser = {
  id: number;
  /** 카카오 회원번호. 운영자 본인인지 가리는 데만 쓴다(lib/admin-auth.ts adminKakaoId) */
  kakao_id: string;
  nickname: string | null;
  profile_image: string | null;
  email: string | null;
  created_at: string;
};

/** 서명 열쇠. 없으면 로그인 기능 자체를 끈다 — 빈 문자열로 서명하면 누구나 쪽지를 위조한다 */
export function authSecret(): string | null {
  const s = process.env.AUTH_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function makeUserSession(userId: number): string | null {
  const key = authSecret();
  if (!key) return null;
  const payload = `${Date.now() + USER_COOKIE_MAX_AGE * 1000}.${userId}`;
  return `v1.${payload}.${sign(payload, key)}`;
}

/** 쪽지가 우리 것이고 아직 안 죽었으면 회원 id. 아니면 null */
export function readUserSession(value: string | undefined | null): number | null {
  const key = authSecret();
  if (!key || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, exp, uid, sig] = parts;
  const want = sign(`${exp}.${uid}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!Number(exp) || Number(exp) < Date.now()) return null;
  const id = Number(uid);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 쿠키만 본다(DB 왕복 없음). 「로그인했나」만 알면 되는 자리에서 쓴다 */
export async function currentUserId(): Promise<number | null> {
  const jar = await cookies();
  return readUserSession(jar.get(USER_COOKIE)?.value);
}

/**
 * 지금 들어와 있는 사람. **쿠키가 가리키는 회원이 DB에 없으면 null**이다 —
 * 탈퇴한 사람의 쿠키가 브라우저에 남아 있어도 유령 로그인이 되지 않는다.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const id = await currentUserId();
  if (id === null) return null;
  const rows = await query<SessionUser>(
    `SELECT id, kakao_id, nickname, profile_image, email, created_at FROM user_account WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * 로그인 뒤 돌아갈 자리. 같은 오리진의 **사람이 보는 앱 경로**만 허용한다.
 *
 * 둘을 막는다.
 * 1) 오픈 리다이렉트 — "//evil.com"·"@evil.com"·"\evil.com"은 origin 뒤에 붙이면 다른 호스트가 된다
 * 2) **제자리 뺑뺑이** — next가 `/login`이나 `/api/…`이면 로그인 직후 다시 그리로 가고,
 *    `/login`은 이미 로그인한 사람을 또 next로 보내 무한 리다이렉트가 된다.
 *    로그인 지면에서 로그인 버튼을 한 번 더 누르면 실제로 `next=%2Flogin`이 실린다(2026-09-21 사용자 제보)
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[@\\]/.test(raw)) return fallback;
  const path = raw.split(/[?#]/)[0];
  if (path === "/login" || path.startsWith("/login/") || path.startsWith("/api/")) return fallback;
  return raw;
}
