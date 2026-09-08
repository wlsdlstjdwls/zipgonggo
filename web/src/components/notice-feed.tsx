"use client";

// 무한 스크롤 목록. 첫 페이지는 서버가 HTML로 넣어 주고(SEO), 이후 페이지는 /api/notices 에서 받는다.
// 패턴 출처: smokespot admin/spots (IntersectionObserver sentinel, rootMargin), fitin-app useInView.
// 로딩 중 재호출 차단·마지막 페이지 종료·에러 시 수동 재시도 버튼.

import { useCallback, useEffect, useRef, useState } from "react";
import { NoticeCard } from "./notice-card";
import { SkeletonCards } from "./skeleton";
import { FEED_FADE_STEP_SEC, FEED_ROOT_MARGIN, PAGE_SIZE } from "@/lib/constants";
import { count } from "@/lib/format";
import { apiNoticesPath } from "@/lib/routes";
import type { NoticeListItem, NoticePage } from "@/types/notice";

type Props = {
  initial: NoticePage;
  /** 필터 쿼리스트링(sector·sido·type·sort). 바뀌면 목록을 처음부터 다시 그린다 */
  params: string;
};

export function NoticeFeed({ initial, params }: Props) {
  const [items, setItems] = useState<NoticeListItem[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 첫 페이지 카드는 서버 HTML 그대로(페이드 없음). 추가 로드된 카드부터 slide-up-fade.
  const firstCount = useRef(initial.items.length);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  // 필터가 바뀌어 서버가 새 initial을 내려주면 상태를 갈아끼운다
  useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
    setError(null);
    firstCount.current = initial.items.length;
    inFlight.current = false;
  }, [initial, params]);

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
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: FEED_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  return (
    <>
      <ul className="card-grid">
        {items.map((n, i) => {
          const fresh = i >= firstCount.current;
          // 같은 배치 안에서만 순차 지연. 배치 밖 인덱스는 0으로 돌려 첫 카드가 늦게 뜨지 않게 한다
          const delay = fresh ? `${((i - firstCount.current) % PAGE_SIZE) * FEED_FADE_STEP_SEC}s` : undefined;
          return <NoticeCard key={n.id} n={n} style={fresh ? { animation: `slide-up-fade 420ms var(--ease-out-emph) both`, animationDelay: delay } : undefined} />;
        })}
        {loading && <SkeletonCards />}
      </ul>

      {error && (
        <p className="feed-status">
          {error} <button type="button" className="btn" onClick={loadMore}>다시 시도</button>
        </p>
      )}
      {cursor ? (
        <div ref={sentinel} className="feed-sentinel" aria-hidden="true">
          {!loading && !error && (
            <button type="button" className="btn" onClick={loadMore}>더 보기</button>
          )}
        </div>
      ) : (
        items.length > 0 && <p className="feed-status end">모든 공고를 다 봤습니다 · {count(items.length)}</p>
      )}
    </>
  );
}
