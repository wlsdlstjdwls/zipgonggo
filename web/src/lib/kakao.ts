// 카카오 로그인(REST API). 카카오는 서버 대 서버로만 토큰을 내주므로 이 파일은 전부 서버 전용이다.
//
// 흐름은 셋뿐이다.
//   1) 브라우저를 kauth.kakao.com/oauth/authorize 로 보낸다 (/api/auth/kakao)
//   2) 카카오가 code를 붙여 우리 콜백으로 돌려보낸다 (/api/auth/kakao/callback)
//   3) code를 토큰으로 바꾸고, 그 토큰으로 프로필을 한 번 읽고, **토큰은 버린다**
//
// **카카오 개발자 콘솔에 콜백 주소를 등록해야 돈다.** 등록 안 된 주소로 보내면
// 카카오가 KOE006(redirect_uri 불일치)으로 튕긴다. 등록할 값 둘:
//   https://zipgonggo.com/api/auth/kakao/callback
//   http://localhost:3100/api/auth/kakao/callback
//
// 콘솔에 켜 둔 동의항목은 셋이다(2026-09-21 기준).
//   profile_nickname  필수 동의 — 화면에 부를 이름
//   profile_image     선택 동의 — 없으면 이니셜 동그라미로 대신한다
//   account_email     선택 동의 — 문의 회신과 중요한 공지에만 쓴다
// **선택 항목은 안 와도 정상이다.** 셋 다 scope에 실어 동의 화면에 띄우되, 빠진 값은 NULL로 둔다 —
// 없다고 로그인을 막지 않는다(막으면 선택 동의가 사실상 필수가 된다).

const AUTHORIZE = "https://kauth.kakao.com/oauth/authorize";
const TOKEN = "https://kauth.kakao.com/oauth/token";
const PROFILE = "https://kapi.kakao.com/v2/user/me";

/** 카카오가 code를 돌려보낼 자리. 콘솔 등록값과 **한 글자도 달라선 안 된다** */
export const KAKAO_CALLBACK_PATH = "/api/auth/kakao/callback";

export type KakaoConfig = { restApiKey: string; clientSecret: string | null };

/**
 * REST API 키가 없으면 로그인 기능 자체가 없는 것으로 친다 —
 * 운영자 콘솔이 env 없이 404가 되는 것과 같은 태도다(빈 값으로 어정쩡하게 돌지 않는다).
 * 클라이언트 시크릿은 콘솔에서 「사용함」으로 켠 앱만 필요하다. 켰는데 안 보내면 토큰 발급이 실패한다.
 */
export function kakaoConfig(): KakaoConfig | null {
  const restApiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restApiKey) return null;
  return { restApiKey, clientSecret: process.env.KAKAO_CLIENT_SECRET?.trim() || null };
}

export function kakaoAuthorizeUrl(origin: string, state: string): string | null {
  const cfg = kakaoConfig();
  if (!cfg) return null;
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", cfg.restApiKey);
  u.searchParams.set("redirect_uri", `${origin}${KAKAO_CALLBACK_PATH}`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "profile_nickname,profile_image,account_email");
  return u.toString();
}

/** code → 액세스 토큰. 실패하면 null(카카오가 주는 사유는 서버 로그에만 남긴다) */
export async function exchangeCode(origin: string, code: string): Promise<string | null> {
  const cfg = kakaoConfig();
  if (!cfg) return null;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.restApiKey,
    redirect_uri: `${origin}${KAKAO_CALLBACK_PATH}`,
    code,
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);

  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn("[kakao] 토큰 발급 실패", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export type KakaoProfile = {
  kakaoId: string;
  nickname: string | null;
  profileImage: string | null;
  email: string | null;
};

/** 토큰으로 프로필 한 번. **이 호출이 끝나면 토큰은 버린다** — 어디에도 저장하지 않는다 */
export async function fetchKakaoProfile(accessToken: string): Promise<KakaoProfile | null> {
  const res = await fetch(PROFILE, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn("[kakao] 프로필 조회 실패", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const json = (await res.json()) as {
    id?: number | string;
    kakao_account?: {
      email?: string;
      is_email_valid?: boolean;
      is_email_verified?: boolean;
      profile?: { nickname?: string; profile_image_url?: string; thumbnail_image_url?: string };
    };
    properties?: { nickname?: string; profile_image?: string; thumbnail_image?: string };
  };
  if (json.id === undefined || json.id === null) return null;

  // 같은 값이 kakao_account.profile 과 properties 두 군데로 온다. 동의항목 구성에 따라 한쪽만 차므로 둘 다 본다
  // 이메일은 선택 동의라 거부하면 안 온다. 동의했어도 카카오 쪽에서 미인증 상태면 안 줄 수 있어
  // is_email_valid/is_email_verified가 false인 주소는 아예 안 받는다 — 닿지 않는 주소를 들고 있어 봐야 짐이다
  const acc = json.kakao_account;
  const emailOk = acc?.email && acc.is_email_valid !== false && acc.is_email_verified !== false;
  const p = acc?.profile;
  return {
    kakaoId: String(json.id),
    nickname: p?.nickname ?? json.properties?.nickname ?? null,
    profileImage:
      p?.thumbnail_image_url ?? p?.profile_image_url ?? json.properties?.thumbnail_image ?? json.properties?.profile_image ?? null,
    email: emailOk ? (acc?.email ?? null) : null,
  };
}
