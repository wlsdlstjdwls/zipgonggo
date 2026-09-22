// 「지금 누가 들어와 있나」 한 줄. 헤더의 계정 메뉴가 뜨자마자 이걸 한 번 묻는다.
//
// **루트 레이아웃에서 쿠키를 읽지 않으려고 만든 자리다.** 레이아웃이 cookies()를 건드리는 순간
// 전 지면이 동적 렌더로 떨어져 ISR이 통째로 죽는다(공고 3만 지면이 매 요청 렌더된다).
// 로그인 여부는 화면 한 귀퉁이의 사실일 뿐이라 브라우저가 따로 물어 오는 편이 싸다.
import { adminKakaoId, isAdmin } from "@/lib/admin-auth";
import { authSecret, currentUser } from "@/lib/auth";
import { kakaoConfig } from "@/lib/kakao";

export const dynamic = "force-dynamic";

export async function GET() {
  // 키가 없는 배포에는 로그인 기능 자체가 없다 — 헤더가 「로그인」 문을 아예 안 그린다
  const enabled = kakaoConfig() !== null && authSecret() !== null;
  const user = enabled ? await currentUser() : null;
  // 운영자인지도 같이 답한다 — 아직 안 연 메뉴(자격진단)를 운영자에게만 보이려면 브라우저가 이걸 알아야 한다.
  // 이 라우트는 이미 쿠키를 읽는 자리라 왕복이 늘지 않는다.
  //
  // **이 답은 「메뉴를 보일까」일 뿐 콘솔 출입 자격이 아니다.** 콘솔은 /admin 레이아웃과 각 page,
  // 서버 액션이 저마다 isAdmin()(zg_admin 쿠키)을 다시 본다 — 여기가 true여도 그 문은 안 열린다.
  // 그래서 콘솔 쿠키 말고 **운영자 본인의 카카오 로그인**도 받아 준다(사용자 요청 2026-09-22):
  // 평소 카카오로 들어와 있는데 메뉴 하나 보자고 콘솔에 또 로그인하는 게 번거롭다.
  // 회원 표에 관리자 플래그를 두지 않으려고 맞춰 볼 값은 env(ADMIN_KAKAO_ID)에 둔다.
  const ownerKakao = adminKakaoId();
  const admin = (await isAdmin()) || (ownerKakao !== null && user?.kakao_id === ownerKakao);
  return Response.json(
    {
      enabled,
      admin,
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
