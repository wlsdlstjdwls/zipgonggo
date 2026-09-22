// 관리자 콘솔(/admin) 출입 확인. 이 서비스에는 회원 시스템이 없다 —
// 운영자 한 사람만 들어오면 되므로 DB에 계정 표를 만들지 않고 env 두 줄로 끝낸다.
//
//   ADMIN_EMAIL          로그인 아이디
//   ADMIN_PASSWORD_HASH  scrypt 해시. **평문 비밀번호는 어디에도 두지 않는다**
//
// **둘 중 하나라도 비면 콘솔 자체가 없는 것으로 친다(404).** 값을 안 정한 배포에서
// 빈 문자열끼리 맞아떨어져 아무나 들어오는 사고를 원천에서 막는다.
//
// 쿠키에는 비밀번호도 해시도 싣지 않는다. 서명된 쪽지 한 장(만료시각 + 이메일 + HMAC)만 준다.
// 서명 열쇠는 저장된 해시 자체다 — 비밀번호를 바꾸면 발급해 둔 쪽지가 **전부 한꺼번에 무효**가 된다.
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "zg_admin";
/** 로그인 유지 기간(초). 운영자 혼자 쓰는 화면이라 넉넉히 30일 */
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// scrypt 작업 인자. N=16384면 한 번 계산에 16MB를 쓴다 — Node 기본 maxmem(32MB) 안이라
// 별도 설정 없이 돈다. 더 올리려면 scryptSync에 maxmem을 같이 올려야 한다.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export type AdminCreds = { email: string; hash: string };

export function adminCreds(): AdminCreds | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const hash = process.env.ADMIN_PASSWORD_HASH?.trim();
  return email && hash ? { email, hash } : null;
}

/**
 * 운영자 본인의 카카오 회원번호. **오직 「아직 안 연 메뉴를 보일까」를 가리는 데만 쓴다**
 * (components/admin-only.tsx). 사용자 요청 2026-09-22: 평소 카카오로 로그인해 있는데
 * 메뉴 하나 보자고 콘솔에 따로 로그인하는 게 번거롭다.
 *
 * **이 값으로는 콘솔에 못 들어온다.** /admin의 출입은 위 `isAdmin()`(zg_admin 쿠키) 하나뿐이고
 * 레이아웃과 각 page, 서버 액션이 전부 그걸 본다 — 여기를 아무리 맞춰도 그 문은 안 열린다.
 * CLAUDE.md의 「카카오 로그인으로 콘솔에 들어올 수 없다」가 그대로 지켜진다.
 *
 * 회원 표에 관리자 플래그를 두지 않으려고 env로 뺐다. 이메일이 아니라 회원번호로 맞추는 이유는
 * 카카오 이메일이 [선택] 동의 항목이라 **동의하지 않으면 아예 없기 때문**이다.
 */
export function adminKakaoId(): string | null {
  const v = process.env.ADMIN_KAKAO_ID?.trim();
  return v ? v : null;
}

/** 저장 꼴: `scrypt:N:r:p:salt:key` (salt·key는 base64).
 *  **구분자가 `$`면 안 된다** — Next의 env 로더(@next/env)가 `.env` 값에서 `$16384`를 변수 참조로 읽어
 *  통째로 빈 문자열로 만든다(2026-09-16 실측: 맞는 비밀번호가 계속 틀렸다고 나왔다).
 *  scripts/admin-password.mjs가 이 꼴로 찍는다 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString("base64")}:${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const key = Buffer.from(keyB64, "base64");
  let got: Buffer;
  try {
    got = scryptSync(password, Buffer.from(saltB64, "base64"), key.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    // 해시 문자열이 상했을 때. 「비밀번호가 틀렸다」와 같은 답을 준다
    return false;
  }
  return got.length === key.length && timingSafeEqual(got, key);
}

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

function sign(payload: string, key: string): string {
  return b64url(createHmac("sha256", key).update(payload).digest());
}

/** 쿠키에 담을 쪽지. `v1.<만료ms>.<이메일>.<서명>` */
export function makeSession(creds: AdminCreds): string {
  const exp = Date.now() + ADMIN_COOKIE_MAX_AGE * 1000;
  const payload = `${exp}.${b64url(Buffer.from(creds.email))}`;
  return `v1.${payload}.${sign(payload, creds.hash)}`;
}

/** 쪽지가 우리 것이고 아직 안 죽었으면 이메일을 돌려준다. 아니면 null */
export function readSession(value: string | undefined | null): string | null {
  const creds = adminCreds();
  if (!creds || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, exp, emailB64, sig] = parts;
  const want = sign(`${exp}.${emailB64}`, creds.hash);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!Number(exp) || Number(exp) < Date.now()) return null;
  // 서명이 맞아도 이메일이 바뀌었으면 안 들여보낸다(env에서 계정을 갈아끼운 경우)
  const email = Buffer.from(emailB64, "base64url").toString();
  return email === creds.email ? email : null;
}

/** 서버 컴포넌트·서버 액션·라우트 핸들러 공용. 쿠키 한 장만 본다 */
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return readSession(jar.get(ADMIN_COOKIE)?.value) !== null;
}
