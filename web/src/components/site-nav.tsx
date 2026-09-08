"use client";

// 헤더 내비. 지도(/)·공고(/?view=list) 중 현재 뷰를 진하게.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { homePath, ROUTES } from "@/lib/routes";

export function SiteNav() {
  const path = usePathname();
  const sp = useSearchParams();
  const isHome = path === ROUTES.home;
  const isList = isHome && sp.get("view") === "list";
  return (
    <nav className="site-nav" aria-label="주요 화면">
      <Link href={ROUTES.home} className={isHome && !isList ? "on" : undefined}>지도</Link>
      <Link href={homePath({ view: "list" })} className={isList ? "on" : undefined}>공고</Link>
    </nav>
  );
}
