"use client";

// 목록 상태(스코프+필터) 동기화 — URL이 곧 저장값이다.
// 1) 목록 페이지가 상태를 URL에 달고 있으면 그대로 기억한다. 스코프 바를 눌렀든, 링크를 받았든, 뒤로 왔든 동일.
// 2) 상태 없는 "/"로 들어오면 마지막 상태로 옮긴다. 3) 상태 없는 "/area/{시도}"는 그 시도의 마지막 필터만 되살린다.
// 서버 렌더(ISR 캐시 한 장)는 저장값을 절대 보지 않는다(docs/url-structure.md) — 전부 마운트 뒤 클라이언트에서만.
// 복원 뒤 URL에 상태가 실려 다시 걸리지 않는다(루프 없음). "전국 전체"로 되돌리려면 헤더 로고(HomeLink)가 저장값을 지운다.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { hasFilter, parseNoticeFilters } from "@/lib/notice-filters";
import { ROUTES } from "@/lib/routes";
import { readScope, scopePath, writeScope } from "@/lib/scope";

function sidoFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/area\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function ScopeSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    const sido = sidoFromPath(pathname);
    if (pathname !== ROUTES.home && !sido) return;

    // 정렬 기본값(posted)은 URL에 없으므로 parse 결과를 그대로 저장하면 안 된다 — URL에 있는 것만 담는다
    const p = parseNoticeFilters((k) => searchParams.get(k));
    const fromUrl = { sector: p.sector, type: p.type, closing: p.closing, sort: searchParams.get("sort") === "deadline" ? p.sort : undefined, sido };

    if (query) { writeScope(fromUrl); return; }

    const saved = readScope();
    if (sido) {
      // 같은 시도로 맨몸 진입 — 그 시도에서 마지막에 보던 부문·필터를 되살린다
      if (saved.sido === sido && hasFilter({ ...saved, sido: undefined })) { router.replace(scopePath(saved)); return; }
      writeScope({ sido });
      return;
    }

    const next = scopePath(saved);
    if (next !== ROUTES.home) router.replace(next);
  }, [pathname, query, searchParams, router]);

  return null;
}
