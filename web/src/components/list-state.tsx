"use client";

// 목록 상태 저장소 — 부문·유형·마감·정렬을 URL에서 뺐다(사용자 요청 2026-09-09: URL이 지저분하고 화면이 깜빡인다).
// 필터는 이제 라우팅이 아니라 이 컨텍스트 + /api/notices 재조회로 바뀐다. 서버 렌더(ISR)는 필터 없는 한 장뿐이라
// 캐시가 갈라지지 않고, 크롤러는 항상 같은 목록을 본다(docs/url-structure.md의 "필터 URL은 색인하지 않는다"와 같은 결론).
// 시도도 URL에 싣지 않는다(사용자 요청 2026-09-09). /area/{시도}는 검색 유입용 발행 페이지로 계속 존재하지만,
// 사이트 안에서 시도를 고를 때는 라우팅하지 않고 이 상태만 바꾼다 — 주소창은 "/"에 머문다.
// 저장은 localStorage. 예전 ?sector=… 링크로 들어오면 그 값을 상태로 흡수하고 주소창을 깨끗이 지운다.
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readScope, writeScope } from "@/lib/scope";
import { ROUTES } from "@/lib/routes";
import { VIEW_STORAGE_KEY } from "@/lib/constants";
import { isNoticeView, isSector, type NoticeClosing, type NoticeFilters, type NoticeSort, type NoticeView } from "@/types/notice";

export type ListFilters = NoticeFilters;

type Ctx = {
  f: ListFilters;
  /** 경로가 /area/{시도}면 그 시도. 서버가 그 시도로 첫 페이지를 이미 렌더했다는 뜻이다 */
  pathSido?: string;
  /** 목록 화면인가(홈 또는 /area/{시도}). 공고 상세에선 스코프 바를 감춘다 */
  isList: boolean;
  /** 저장값·레거시 쿼리 흡수가 끝났는가. 끝나기 전엔 목록이 서버가 준 첫 페이지를 그대로 쓴다 */
  ready: boolean;
  /** 목록 보기 모드. 조회 조건이 아니라 화면 취향이라 필터와 따로 논다 */
  view: NoticeView;
  setView: (v: NoticeView) => void;
  set: (patch: Partial<ListFilters>) => void;
  reset: () => void;
  /** 시도 변경. /area/{시도}에 서 있었다면 경로와 화면이 어긋나므로 홈으로 옮기고 상태만 이어 간다 */
  setSido: (sido?: string) => void;
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

const QUERY_KEYS = ["sector", "type", "closing", "sort", "closed"] as const;

export function ListStateProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathSido = sidoFromPath(pathname);
  const isList = pathname === ROUTES.home || Boolean(pathSido);
  const [f, setF] = useState<ListFilters>({});
  // 기본은 카드 — 상태 테두리로 접수 중/마감이 한눈에 갈린다(사용자 결정 2026-09-09)
  const [view, setViewState] = useState<NoticeView>("card");
  const [ready, setReady] = useState(false);
  const booted = useRef(false);

  // 마운트 1회 — 레거시 쿼리 > 저장값 순으로 초기 상태를 정한다. 경로가 /area/{시도}면 그 시도가 저장값을 이긴다.
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
        closed: q.get("closed") === "1" || undefined,
        sido: pathSido ?? saved.sido,
      });
      // 주소창만 정리한다 — 라우팅이 아니라 history 치환이라 다시 렌더하지 않는다
      window.history.replaceState(null, "", url.pathname);
    } else {
      setF({ ...saved, sido: pathSido ?? saved.sido });
    }
    try {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (isNoticeView(v)) setViewState(v);
    } catch {
      // 프라이빗 모드 등 저장 실패는 화면 동작에 영향 없음
    }
    setReady(true);
    // 마운트 1회 — pathSido는 그때 값으로 충분하다. 저장된 시도로 옮기는 라우팅은 하지 않는다(주소창을 건드리지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 상태가 정해진 뒤부터만 저장한다(초기화 전에 쓰면 저장값을 스스로 지운다). 목록 화면에서만 — 상세는 스코프를 바꾸지 않는다
  useEffect(() => {
    if (!ready || !isList) return;
    writeScope(f);
  }, [ready, isList, f]);

  const setView = useCallback((v: NoticeView) => {
    setViewState(v);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* 저장 실패는 무시 */ }
  }, []);
  const set = useCallback((patch: Partial<ListFilters>) => setF((cur) => ({ ...cur, ...patch })), []);
  const reset = useCallback(() => {
    setF({});
    if (pathSido) router.replace(ROUTES.home);
  }, [pathSido, router]);
  const setSido = useCallback((next?: string) => {
    setF((cur) => ({ ...cur, sido: next }));
    // 경로가 /area/{시도}인데 다른 시도를 고르면 주소와 화면이 어긋난다 — 홈으로 치환한다(주소창이 오히려 짧아진다)
    if (pathSido && next !== pathSido) router.replace(ROUTES.home);
  }, [pathSido, router]);

  const value = useMemo<Ctx>(() => ({ f, pathSido, isList, ready, view, setView, set, reset, setSido }), [f, pathSido, isList, ready, view, setView, set, reset, setSido]);
  return <ListCtx.Provider value={value}>{children}</ListCtx.Provider>;
}
