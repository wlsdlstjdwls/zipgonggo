"use client";

// 목록 상태 저장소 — 부문·유형·마감·정렬을 URL에서 뺐다(사용자 요청 2026-09-09: URL이 지저분하고 화면이 깜빡인다).
// 필터는 이제 라우팅이 아니라 이 컨텍스트 + /api/notices 재조회로 바뀐다. 서버 렌더(ISR)는 필터 없는 한 장뿐이라
// 캐시가 갈라지지 않고, 크롤러는 항상 같은 목록을 본다(docs/url-structure.md의 "필터 URL은 색인하지 않는다"와 같은 결론).
// 스코프의 시도만 경로(/area/{시도})로 남는다 — 발행 페이지라 URL이 있어야 한다.
// 저장은 localStorage. 예전 ?sector=… 링크로 들어오면 그 값을 상태로 흡수하고 주소창을 깨끗이 지운다.
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readScope, writeScope } from "@/lib/scope";
import { areaPath, ROUTES } from "@/lib/routes";
import { isSector, type NoticeClosing, type NoticeFilters, type NoticeSort } from "@/types/notice";

/** sido는 경로에서 오므로 여기 담지 않는다. */
export type ListFilters = Omit<NoticeFilters, "sido">;

type Ctx = {
  f: ListFilters;
  /** 경로에서 읽은 스코프 시도. 홈이면 undefined */
  sido?: string;
  /** 저장값·레거시 쿼리 흡수가 끝났는가. 끝나기 전엔 목록이 서버가 준 첫 페이지를 그대로 쓴다 */
  ready: boolean;
  set: (patch: Partial<ListFilters>) => void;
  reset: () => void;
  /** 시도 이동 — 이것만 라우팅이다 */
  goSido: (sido?: string) => void;
};

const ListCtx = createContext<Ctx | null>(null);

export function useListState(): Ctx {
  const c = useContext(ListCtx);
  if (!c) throw new Error("useListState는 ListStateProvider 안에서만 쓴다");
  return c;
}

function sidoFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/area\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

const QUERY_KEYS = ["sector", "type", "closing", "sort"] as const;

export function ListStateProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sido = sidoFromPath(pathname);
  const [f, setF] = useState<ListFilters>({});
  const [ready, setReady] = useState(false);
  const booted = useRef(false);

  // 마운트 1회 — 레거시 쿼리 > 저장값 순으로 초기 상태를 정하고, 홈에 맨몸으로 들어왔으면 마지막 시도로 옮긴다.
  // 클라이언트 이동으로 "/"에 다시 와도 여기가 다시 돌지 않는다(전국을 골랐는데 되튀면 안 된다).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const url = new URL(window.location.href);
    const q = url.searchParams;
    const fromQuery = QUERY_KEYS.some((k) => q.has(k));
    const saved = readScope();

    if (fromQuery) {
      const sector = q.get("sector");
      setF({
        sector: isSector(sector) ? sector : undefined,
        type: q.get("type") || undefined,
        closing: q.get("closing") === "7d" ? ("7d" as NoticeClosing) : undefined,
        sort: q.get("sort") === "deadline" ? ("deadline" as NoticeSort) : undefined,
      });
      // 주소창만 정리한다 — 라우팅이 아니라 history 치환이라 다시 렌더하지 않는다
      window.history.replaceState(null, "", url.pathname);
    } else {
      setF({ sector: saved.sector, type: saved.type, closing: saved.closing, sort: saved.sort });
    }
    setReady(true);

    if (!sido && pathname === ROUTES.home && saved.sido) router.replace(areaPath(saved.sido));
    // 마운트 1회 — pathname·sido는 그때 값으로 충분하다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 상태·시도가 정해진 뒤부터만 저장한다(초기화 전에 쓰면 저장값을 스스로 지운다)
  useEffect(() => {
    if (!ready) return;
    writeScope({ ...f, sido });
  }, [ready, f, sido]);

  const set = useCallback((patch: Partial<ListFilters>) => setF((cur) => ({ ...cur, ...patch })), []);
  const reset = useCallback(() => setF({}), []);
  const goSido = useCallback((next?: string) => router.push(next ? areaPath(next) : ROUTES.home), [router]);

  const value = useMemo<Ctx>(() => ({ f, sido, ready, set, reset, goSido }), [f, sido, ready, set, reset, goSido]);
  return <ListCtx.Provider value={value}>{children}</ListCtx.Provider>;
}
