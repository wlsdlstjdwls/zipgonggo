"use client";

// 아직 안 연 메뉴를 운영자에게만 보이는 자리(사용자 요청 2026-09-21: "자격진단은 아직 오픈하기 힘들다").
//
// 「운영자」는 둘 중 하나다 — 콘솔 쿠키(zg_admin)로 들어왔거나, 운영자 본인의 카카오 계정으로
// 로그인했거나(env ADMIN_KAKAO_ID, 사용자 요청 2026-09-22). **콘솔 출입과는 별개다**:
// /admin은 어느 경우에도 zg_admin 쿠키만 본다(lib/admin-auth.ts adminKakaoId 주석).
//
// **서버에서 가리지 않는다.** 루트 레이아웃이나 ISR 지면이 쿠키를 읽으면 전 지면이 동적으로 떨어진다
// (CLAUDE.md, components/auth-context.tsx 머리글). 운영자 여부는 브라우저가 이미 묻고 있는
// /api/auth/me 답에 한 칸 얹어서 받는다 — 왕복이 늘지 않는다.
//
// 그래서 **이건 보안 장치가 아니다.** 링크를 감출 뿐이고 /eligibility 주소는 그대로 살아 있다
// (URL을 지우지 않는다 — CLAUDE.md 하지 말 것 5). 남에게 보이면 안 되는 값은 여기 담지 않는다.
import type { ReactNode } from "react";
import { useAuth } from "./auth-context";

export function AdminOnly({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  // 답을 받기 전(loading)에는 안 그린다 — 보였다 사라지는 깜빡임이 더 나쁘다
  return admin ? <>{children}</> : null;
}
