"use client";

// 홈 본문 — 좌 결과 행 목록 / 우 지도(map 뷰) 또는 행 목록만(list 뷰).
// 첫 페이지는 서버가 HTML로 넣어 주고(SEO), 이후 페이지는 /api/notices 에서 받는다.
// 무한 스크롤(IntersectionObserver sentinel, rootMargin) 유지 + 「더 보기」 버튼 폴백. 로딩 중 재호출 차단·에러 시 재시도.
// 행 등장은 CSS 애니메이션(.row + --stagger). 목록이 바뀌면 page.tsx가 key를 바꿔 다시 마운트되므로 등장 모션이 다시 돈다.

import { useCallback, useEffect, useRef, useState } from "react";
import { FEED_ROOT_MARGIN, PAGE_SIZE, ROW_STAGGER_MS } from "@/lib/constants";
import { count, moneyOf } from "@/lib/format";
import { apiNoticesPath } from "@/lib/routes";
import type { HomeView, NoticeListItem, NoticePage } from "@/types/notice";
import { HomeMap } from "./home-map";
import { NoticeRow } from "./notice-row";
import { SkeletonRows } from "./skeleton";

type Props = {
  initial: NoticePage;
  /** 필터 쿼리스트링(sector·sido·type·sort·closing). 바뀌면 page.tsx가 key로 다시 마운트한다 */
  params: string;
  view: HomeView;
  /** 지도 좌상단 칩 문구 — 현재 지역·유형 필터 */
  mapChips?: { region: string; regionCount: number | null; type: string };
};

export function NoticeExplorer({ initial, params, view, mapChips }: Props) {
  const [items, setItems] = useState<NoticeListItem[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<NoticeListItem | null>(null);
  const [visible, setVisible] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiNoticesPath(params, cursor), { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as NoticePage;
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.items.filter((n) => !seen.has(n.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError("더 불러오지 못했습니다.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor, params]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) loadMore(); }, { rootMargin: FEED_ROOT_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  const onEnter = useCallback((n: NoticeListItem) => setFocus(n), []);
  const onLeave = useCallback(() => setFocus(null), []);
  const onPinFocus = useCallback((id: number | null) => setFocus(id === null ? null : (items.find((n) => n.id === id) ?? null)), [items]);
  const onVisible = useCallback((n: number) => setVisible(n), []);

  const focusMoney = focus ? moneyOf(focus) : null;
  const loadLabel = !cursor ? "모두 표시했습니다" : loading ? "불러오는 중…" : `더 보기 +${Math.min(PAGE_SIZE, initial.total - items.length)}`;

  const list = (
    <div className="ex-list">
      <ul className="rows">
        {items.map((n, i) => (
          <NoticeRow
            key={n.id}
            n={n}
            variant={view}
            stagger={(i % PAGE_SIZE) * ROW_STAGGER_MS}
            focused={focus?.id === n.id}
            onEnter={view === "map" ? onEnter : undefined}
            onLeave={view === "map" ? onLeave : undefined}
          />
        ))}
      </ul>
      {loading && <SkeletonRows />}
      {error && (
        <p className="feed-error">
          {error} <button type="button" className="btn" onClick={loadMore}>다시 시도</button>
        </p>
      )}
      <div className={`more-bar${view === "list" ? " list" : ""}`}>
        <span className="cnt">{count(initial.total)} 중 {count(items.length)} 표시</span>
        <button type="button" className={`btn ink${view === "list" ? " lg" : ""}`} onClick={loadMore} disabled={!cursor || loading}>{loadLabel}</button>
      </div>
      {cursor && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
    </div>
  );

  if (view === "list") return list;

  return (
    <div className="ex">
      {list}
      <div className="ex-map">
        <HomeMap items={items} focusId={focus?.id ?? null} onFocus={onPinFocus} onVisible={onVisible} />
        {mapChips && (
          <div className="map-chips" aria-hidden="true">
            <span className="strong">{mapChips.region}{mapChips.regionCount != null && <b>{mapChips.regionCount}</b>}</span>
            <span>{mapChips.type}</span>
          </div>
        )}
        <div className="map-capsule" aria-live="polite">
          <span>{focus ? "선택한 공고" : "이 화면 안 공고"}</span>
          <b>{focus ? (focusMoney ? focusMoney.main : "금액 원문 확인") : visible === null ? "—" : count(visible)}</b>
        </div>
      </div>
    </div>
  );
}
