"use client";

// 콘솔 탭. 지금은 넷뿐이라 평평하게 깐다 — 늘어나면 「검수/운영」처럼 묶는다.
import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "./actions";
import { ROUTES } from "@/lib/routes";
import { VISIT_OPT_OUT_KEY } from "@/lib/constants";

const TABS = [
  { href: ROUTES.admin, label: "대시보드" },
  { href: ROUTES.adminIngest, label: "수집 이력" },
  { href: ROUTES.adminVisitors, label: "방문" },
  { href: ROUTES.adminMembers, label: "회원" },
] as const;

export function AdminNav({ fails30d }: { fails30d: number }) {
  const pathname = usePathname();

  // 콘솔에 들어온 브라우저는 방문 집계에서 뺀다. 운영자가 제 사이트를 돌아다닌 것까지 세면
  // 초기 숫자가 통째로 거짓이 된다(트래픽이 작을수록 더 심하다).
  //
  // **값이 없을 때만 심는다.** 매번 덮어쓰면 방문 화면의 끄는 버튼이 한 번도 안 먹는다 —
  // 껐다가 콘솔을 다시 여는 순간 되살아나서, 제 브라우저로는 집계를 영영 확인할 수 없다
  useEffect(() => {
    try {
      if (localStorage.getItem(VISIT_OPT_OUT_KEY) === null) {
        localStorage.setItem(VISIT_OPT_OUT_KEY, "1");
      }
    } catch {
      // 저장이 막힌 브라우저면 그냥 넘어간다 — 집계가 조금 부풀 뿐 화면은 멀쩡하다
    }
  }, []);

  return (
    <nav className="adm-nav" aria-label="관리자 메뉴">
      {TABS.map(({ href, label }) => {
        // 대시보드(/admin)는 하위 경로의 접두사이기도 해서 정확히 일치할 때만 활성
        const on = href === ROUTES.admin ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? "on" : ""}>
            {label}
            {href === ROUTES.adminIngest && fails30d > 0 && <em>{fails30d}</em>}
          </Link>
        );
      })}
      <form action={signOut}>
        <button type="submit">나가기</button>
      </form>
    </nav>
  );
}
