// 관리자 콘솔(/admin) 출입 확인. 이 서비스에는 회원 시스템이 없다 —
// 운영자 한 사람만 들어오면 되므로 계정 대신 `ADMIN_TOKEN` 하나를 쓴다.
//
// **env가 비어 있으면 콘솔 자체가 없는 것으로 친다(404).** 토큰을 안 정한 배포에서
// 빈 문자열끼리 맞아떨어져 아무나 들어오는 사고를 원천에서 막는다.
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "zg_admin";
/** 로그인 유지 기간(초). 운영자 혼자 쓰는 화면이라 넉넉히 30일 */
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function adminToken(): string | null {
  const t = process.env.ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

/** 길이가 달라도 터지지 않는 상수시간 비교. 길이 자체는 어차피 새어도 무해하다 */
export function tokenMatches(given: string | undefined | null): boolean {
  const token = adminToken();
  if (!token || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 서버 컴포넌트·서버 액션·라우트 핸들러 공용. 쿠키 한 장만 본다 */
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return tokenMatches(jar.get(ADMIN_COOKIE)?.value);
}
