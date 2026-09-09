"use client";

// 저장된 스코프 복원 — 파라미터 없는 "/"로 들어왔을 때만 마지막 스코프로 옮긴다.
// 서버 렌더(ISR 캐시 한 장)는 저장값을 절대 보지 않는다(docs/url-structure.md) — 복원은 마운트 후 클라이언트에서만.
// 스코프가 붙은 URL(/area/{시도} 또는 ?sector=)은 건드리지 않으므로 공유 링크가 덮이지 않고,
// 복원 뒤 URL에 스코프가 실려 다시 걸리지 않는다(루프 없음). "전국"으로 되돌리려면 헤더 로고(HomeLink)가 저장값을 지운다.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ROUTES } from "@/lib/routes";
import { readScope, scopePath } from "@/lib/scope";

export function ScopeRestore() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname !== ROUTES.home || searchParams.toString()) return;
    const next = scopePath(readScope());
    if (next === ROUTES.home) return;
    router.replace(next);
  }, [pathname, searchParams, router]);

  return null;
}
