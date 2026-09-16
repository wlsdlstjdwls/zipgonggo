// 관리자 콘솔의 껍데기. 셋을 한다 — 출입 확인, 탭, 색인 차단.
//
// 로그인 화면을 **따로 URL로 두지 않는다**: 안 들어온 사람에게는 이 레이아웃이 children 대신
// 로그인 칸을 그린다. /admin/login 같은 자리를 만들면 그 자리만 이 레이아웃의 확인을 비껴가야 해서
// 「가드가 안 걸리는 예외 경로」가 생긴다 — 예외가 하나 생기는 순간 실수가 들어온다.
//
// 데이터 보호는 화면이 아니라 이 확인 하나에 달려 있다(회원 시스템이 없어 DB 쪽 RLS가 없다).
// 그래서 각 page도 제 몫으로 한 번 더 확인한다 — 레이아웃이 안 그려도 자식 세그먼트의
// 서버 컴포넌트는 먼저 돌 수 있기 때문이다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminCreds, isAdmin } from "@/lib/admin-auth";
import { recentFailCount } from "@/lib/admin";
import { AdminNav } from "./admin-nav";
import { LoginForm } from "./login-form";

// 사람이 눌러야 값이 바뀌는 화면이 아니라 「지금 상태」를 보는 화면이다. 캐시하면 거짓말이 된다
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "관리자 콘솔",
  // robots.ts도 /admin을 막지만, 그건 크롤러에게 부탁하는 것뿐이다. 페이지에도 붙인다
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 계정을 안 정한 배포에는 콘솔이 아예 없다 — 빈 값끼리 맞아떨어지는 사고를 원천에서 막는다
  if (!adminCreds()) notFound();
  if (!(await isAdmin())) return <LoginForm />;

  const fails30d = await recentFailCount();
  return (
    <div className="adm">
      <AdminNav fails30d={fails30d} />
      {children}
    </div>
  );
}
