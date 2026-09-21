// 「지금 누가 들어와 있나」 한 줄. 헤더의 계정 메뉴가 뜨자마자 이걸 한 번 묻는다.
//
// **루트 레이아웃에서 쿠키를 읽지 않으려고 만든 자리다.** 레이아웃이 cookies()를 건드리는 순간
// 전 지면이 동적 렌더로 떨어져 ISR이 통째로 죽는다(공고 3만 지면이 매 요청 렌더된다).
// 로그인 여부는 화면 한 귀퉁이의 사실일 뿐이라 브라우저가 따로 물어 오는 편이 싸다.
import { authSecret, currentUser } from "@/lib/auth";
import { kakaoConfig } from "@/lib/kakao";

export const dynamic = "force-dynamic";

export async function GET() {
  // 키가 없는 배포에는 로그인 기능 자체가 없다 — 헤더가 「로그인」 문을 아예 안 그린다
  const enabled = kakaoConfig() !== null && authSecret() !== null;
  const user = enabled ? await currentUser() : null;
  return Response.json(
    {
      enabled,
      user: user && {
        id: user.id,
        nickname: user.nickname,
        profileImage: user.profile_image,
        createdAt: user.created_at,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
