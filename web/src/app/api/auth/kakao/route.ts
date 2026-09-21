// 카카오로 보내는 자리. 브라우저를 kauth.kakao.com으로 통째로 넘긴다.
//
// 넘기기 전에 **state 한 조각**을 쿠키에 심는다. 카카오가 돌려줄 때 같은 값을 들고 오는지 보는
// 물표다 — 없으면 남이 만든 로그인 요청의 결과를 우리 콜백에 밀어 넣는 CSRF가 열린다.
// 돌아갈 자리(next)도 같이 심는다: 카카오에 들려 보내면 state가 길어지고, 돌아온 값은 어차피 못 믿는다.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { kakaoAuthorizeUrl } from "@/lib/kakao";
import { loginPath, ROUTES } from "@/lib/routes";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, OAUTH_MAX_AGE, safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNextPath(url.searchParams.get("next"), ROUTES.my);
  const state = randomBytes(16).toString("base64url");

  const authorize = kakaoAuthorizeUrl(url.origin, state);
  // 키를 안 넣은 배포에서는 카카오로 보낼 수 없다. 로그인 지면이 「준비 중」을 말하므로 거기로 돌려보낸다
  if (!authorize) return NextResponse.redirect(new URL(loginPath(next), url.origin));

  const res = NextResponse.redirect(authorize);
  res.cookies.set(OAUTH_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    sameSite: "lax", // 카카오에서 돌아오는 건 top-level GET이라 lax로 따라온다. strict면 안 온다
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE,
  });
  return res;
}
