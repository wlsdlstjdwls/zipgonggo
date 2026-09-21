// 로그인 안내 지면. 카카오로 넘기기 전에 **무엇이 좋아지고 무엇을 받아 가는지**를 먼저 말한다.
//
// 색인하지 않는다 — 검색으로 들어올 이유가 없는 지면이고, 내용도 세 줄뿐이라
// 얇은 페이지 발행 금지(CLAUDE.md 4)에 걸린다.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginPanel } from "@/components/login-panel";
import { authSecret, currentUserId, safeNextPath } from "@/lib/auth";
import { kakaoConfig } from "@/lib/kakao";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "로그인",
  description: "카카오로 로그인하면 관심 공고가 기기를 넘어 남습니다.",
  robots: { index: false, follow: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next, ROUTES.my);

  // 이미 들어와 있으면 이 지면에 머무를 이유가 없다
  if (await currentUserId()) redirect(next);

  const ready = kakaoConfig() !== null && authSecret() !== null;
  return <LoginPanel next={next} ready={ready} failed={sp.error === "1"} />;
}
