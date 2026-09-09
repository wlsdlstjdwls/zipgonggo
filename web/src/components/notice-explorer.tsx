"use client";

// 목록 본문 — 결과 행 + 무한 스크롤. 지도는 없다(공고별 지도는 상세의 공급 단지 탐색기, 2026-09-08 결정).
// 첫 페이지는 서버가 필터 없이 HTML로 넣어 주고(SEO·ISR 캐시 한 장), 필터가 걸리면 여기서 /api/notices로 갈아끼운다.
// 라우팅을 하지 않으므로 URL이 지저분해지지 않고 화면도 깜빡이지 않는다(사용자 요청 2026-09-09).
// 무한 스크롤(IntersectionObserver sentinel, rootMargin) + 「더 보기」 버튼 폴백. 로딩 중 재호출 차단·에러 시 재시도.

import { useCallback, useEffect, useRef, useState } from "react";
import { FEED_ROOT_MARGIN, PAGE_SIZE, ROW_STAGGER_MS } from "@/lib/constants";
import { count } from "@/lib/format";
import { feedParams } from "@/lib/notice-filters";
import { apiNoticesPath, ROUTES } from "@/lib/routes";
import type { NoticeListItem, NoticePage } from "@/types/notice";
import { EmptyState } from "./empty-state";
import { useListState } from "./list-state";
import { NoticeRow } from "./notice-row";
import { SkeletonRows } from "./skeleton";

type Props = {
  /** 서버가 준 첫 페이지 — 필터 없이 스코프(시도)만 걸린 상태 */
  initial: NoticePage;
  /** 목록 머리의 h1. 총 건수는 필터가 바뀌면 이 컴포넌트가 다시 센다 */
  title: string;
};

export function NoticeExplorer({ initial, title }: Props) {
  const { f, pathSido, ready, reset, view } = useListState();
  // 서버가 렌더해 준 첫 페이지의 조건 — 홈은 무필터, /area/{시도}는 그 시도만
  const serverKey = feedParams({ sido: pathSido });
  const key = feedParams(f);

  const [page, setPage] = useState<NoticePage>(initial);
  const [items, setItems] = useState<NoticeListItem[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const applied = useRef(serverKey);
  // layout의 부트 스크립트가 걸어 둔 가림막. 저장된 필터로 갈아끼운 뒤(또는 갈아끼울 게 없다고 판명된 뒤) 뗀다
  const unveil = useCallback(() => { document.documentElement.removeAttribute("data-booting"); }, []);

  // 서버가 준 페이지로 되돌린다(필터를 전부 풀었을 때) — 다시 받아올 필요가 없다
  useEffect(() => { setPage(initial); setItems(initial.items); setCursor(initial.nextCursor); applied.current = serverKey; }, [initial, serverKey]);

  // 필터가 바뀌면 1페이지를 새로 받아 통째로 갈아끼운다. 받는 동안 기존 목록을 지우지 않는다(깜빡임 방지)
  useEffect(() => {
    if (!ready) return;
    if (key === applied.current) { unveil(); return; }
    let cancelled = false;
    applied.current = key;
    setSwapping(true);
    setError(null);
    if (key === serverKey) {
      setPage(initial); setItems(initial.items); setCursor(initial.nextCursor); setSwapping(false);
      unveil();
      return;
    }
    fetch(`${ROUTES.apiNotices}?${key}`, { headers: { accept: "application/json" } })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() as Promise<NoticePage>; })
      .then((p) => { if (cancelled) return; setPage(p); setItems(p.items); setCursor(p.nextCursor); })
      .catch(() => { if (!cancelled) setError("목록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setSwapping(false); unveil(); });
    return () => { cancelled = true; };
  }, [key, ready, serverKey, initial, unveil]);

  const loadMore = useCallback(async () => {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiNoticesPath(applied.current, cursor), { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as NoticePage;
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...next.items.filter((n) => !seen.has(n.id))];
      });
      setCursor(next.nextCursor);
    } catch {
      setError("더 불러오지 못했습니다.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) loadMore(); }, { rootMargin: FEED_ROOT_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  const head = (
    <div className="list-top">
      <h1>{title}</h1>
      <span>{count(page.total)}</span>
    </div>
  );

  if (!swapping && items.length === 0) {
    return (
      <>
        {head}
        <EmptyState
          lead={f.sector === "민간임대"
            ? "민간임대는 청년안심주택 등 수집을 준비 중입니다. 지역이나 유형을 넓혀 보세요."
            : "지역이나 유형을 넓히거나, 마감 임박 필터를 풀어 보세요."}
          onReset={reset}
        />
      </>
    );
  }

  return (
    <div className={`ex-list${swapping ? " swapping" : ""}`} aria-busy={swapping}>
      {head}
      <ul className={`rows v-${view}`} key={applied.current}>
        {items.map((n, i) => (
          <NoticeRow key={n.id} n={n} stagger={(i % PAGE_SIZE) * ROW_STAGGER_MS} />
        ))}
      </ul>
      {loading && <SkeletonRows />}
      {error && (
        <p className="feed-error">
          {error} <button type="button" className="btn" onClick={loadMore}>다시 시도</button>
        </p>
      )}
      {/* 무한 스크롤이 기본. 버튼은 관찰자가 안 먹는 환경의 폴백이라 남은 게 있을 때만 둔다 */}
      {cursor && (
        <div className="more-bar">
          <button type="button" className="btn ink lg" onClick={loadMore} disabled={loading}>
            {loading ? "불러오는 중…" : `더 보기 +${Math.min(PAGE_SIZE, page.total - items.length)}`}
          </button>
        </div>
      )}
      {cursor && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
    </div>
  );
}
