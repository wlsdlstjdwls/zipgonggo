// 카카오가 code를 들고 돌아오는 자리. 여기서 로그인이 확정된다.
//
// 순서 — state 물표 확인 → code를 토큰으로 → 토큰으로 프로필 한 번 → 회원 표에 업서트 →
// 세션 쿠키 발급 → 원래 보던 자리로. **액세스 토큰은 저장하지 않는다**(lib/kakao.ts 머리글).
//
// 실패는 전부 로그인 지면으로 돌려보내며 `?error=` 한 마디만 붙인다. 왜 실패했는지 자세히 말하면
// 남의 계정을 찔러 보는 쪽에 힌트가 된다 — 자세한 사유는 서버 로그에만 남긴다.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  makeUserSession, OAUTH_COOKIE, OAUTH_COOKIE_PATH, safeNextPath, USER_COOKIE, USER_COOKIE_MAX_AGE,
} from "@/lib/auth";
import { exchangeCode, fetchKakaoProfile } from "@/lib/kakao";
import { upsertKakaoUser } from "@/lib/users";
import { loginPath, ROUTES } from "@/lib/routes";
import { TERMS_EFFECTIVE_DATE } from "@/components/terms-content";

export const dynamic = "force-dynamic";

function fail(origin: string, next: string, why: string) {
  const to = new URL(loginPath(next), origin);
  to.searchParams.set("error", "1");
  const res = NextResponse.redirect(to);
  // 실패한 물표는 치운다 — 남겨 두면 다음 시도가 옛 state와 부딪힌다
  res.cookies.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });
  console.warn("[kakao] 로그인 실패:", why);
  return res;
}

/** 길이가 달라도 터지지 않는 상수시간 비교 */
function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  const jar = await cookies();
  const [wantState, stashedNext] = (jar.get(OAUTH_COOKIE)?.value ?? "").split("|");
  const next = safeNextPath(stashedNext, ROUTES.my);

  // 이용자가 카카오 동의 화면에서 「취소」를 눌렀을 때도 여기로 온다. 그건 사고가 아니라 선택이다
  if (url.searchParams.get("error")) return fail(origin, next, `카카오가 거절: ${url.searchParams.get("error")}`);

  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  if (!code || !gotState || !wantState || !sameState(gotState, wantState)) {
    return fail(origin, next, "state 불일치 또는 code 없음");
  }

  const token = await exchangeCode(origin, code);
  if (!token) return fail(origin, next, "토큰 발급 실패");

  const profile = await fetchKakaoProfile(token);
  if (!profile) return fail(origin, next, "프로필 조회 실패");

  // 로그인 버튼은 약관 동의 체크 없이는 안 눌린다 — 로그인이 성사됐다는 건 이 버전에 동의했다는 뜻이다.
  // 언제 어느 버전에 동의했는지를 가입 기록으로 남긴다(개인정보보호법 동의 입증)
  const userId = await upsertKakaoUser(profile, TERMS_EFFECTIVE_DATE);
  if (userId === null) return fail(origin, next, "회원 저장 실패");

  const session = makeUserSession(userId);
  if (!session) return fail(origin, next, "AUTH_SECRET 없음");

  const res = NextResponse.redirect(new URL(next, origin));
  res.cookies.set(USER_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: USER_COOKIE_MAX_AGE,
  });
  res.cookies.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });
  return res;
}
