"use client";

// 콘솔 탭. 지금은 둘뿐이라 평평하게 깐다 — 늘어나면 smokespot admin처럼 「검수/운영」으로 묶는다.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "./actions";
import { ROUTES } from "@/lib/routes";

const TABS = [
  { href: ROUTES.admin, label: "대시보드" },
  { href: ROUTES.adminIngest, label: "수집 이력" },
] as const;

export function AdminNav({ fails30d }: { fails30d: number }) {
  const pathname = usePathname();
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
