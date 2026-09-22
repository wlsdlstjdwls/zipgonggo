"use client";

// 관심 공고(★) 목록 본문(/my). 서버는 이 화면의 내용을 모른다 — 목록은 브라우저 localStorage에만 있다.
// 그래서 순서가 이렇다: 마운트 → localStorage 읽기(SaveProvider) → id 묶음을 /api/notices/by-ids에 묻기 → 행 그리기.
//
// 두 가지를 일부러 이렇게 뒀다.
// 1) **지운 행을 바로 치우지 않는다.** ★을 다시 눌러 끄면 흐려지기만 하고 자리에 남는다 —
//    잘못 눌렀을 때 되돌릴 길이 있어야 한다. 다음에 이 화면을 열면 그때 빠진다.
// 2) **ready 전에는 빈 상태를 그리지 않는다.** 담아 둔 게 있는 사람에게 「담아 둔 공고가 없습니다」가
//    한 번 번쩍였다가 목록이 들어오면 그게 더 나쁜 거짓말이다.
// 3) **상태 국면으로 덩이를 나눈다**(사용자 요청 2026-09-22). 담아 둔 목록은 「지금 뭘 해야 하나」를 묻는
//    화면이라 오늘 마감과 이미 끝난 공고가 한 줄에 섞이면 안 된다. 가르는 규칙은 D-day 칩과 같다
//    (format.ts의 noticePhase) — 칩과 덩이가 다른 말을 하면 둘 중 하나가 거짓말이 된다.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAGE_SIZE, ROW_STAGGER_MS, SAVED_MAX_IDS } from "@/lib/constants";
import { count, noticePhase, PHASE_LABEL, PHASE_ORDER, type NoticePhase } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import type { NoticeListItem } from "@/types/notice";
import { useListState } from "./list-state";
import { NoticeRow } from "./notice-row";
import { useSave } from "./save-context";
import { SkeletonRows } from "./skeleton";

export function SavedNotices() {
  const { saved, ready, isSaved } = useSave();
  // 보기 모드(카드/목록/간략)는 목록 화면에서 고른 취향을 그대로 따른다
  const { view } = useListState();
  const [shown, setShown] = useState<number[]>([]);
  const [items, setItems] = useState<NoticeListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // 화면에 한 번 올린 id는 저장을 풀어도 목록에서 빼지 않는다(위 1번)
  const shownRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!ready) return;
    let added = false;
    for (const id of saved) {
      if (shownRef.current.size >= SAVED_MAX_IDS) break;
      if (shownRef.current.has(id)) continue;
      shownRef.current.add(id);
      added = true;
    }
    if (added) setShown([...shownRef.current]);
    // 저장이 하나도 없는 사람 — 조회할 게 없으니 여기서 빈 목록으로 확정한다
    else if (shownRef.current.size === 0) setItems((prev) => prev ?? []);
  }, [saved, ready]);

  const key = useMemo(() => shown.join(","), [shown]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setError(false);
    fetch(`${ROUTES.apiNoticesByIds}?ids=${key}`, { headers: { accept: "application/json" } })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() as Promise<{ items: NoticeListItem[] }>; })
      .then((d) => { if (!cancelled) setItems(d.items); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [key, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);

  // 화면 제목은 지우고(사용자 요청 2026-09-22) 이름은 스크린리더에만 남긴다 —
  // 지면에 h1이 아예 없으면 이 장이 무슨 장인지 읽어 줄 것이 사라진다.
  // 보관 위치를 밝히던 한 줄(「이 브라우저에만 남습니다」)도 뺐다(사용자 요청 2026-09-22).
  const head = <h1 className="sr-only">관심 공고</h1>;

  // 아직 localStorage도 못 읽었거나 첫 조회가 안 끝난 상태
  if (!ready || (items === null && !error)) {
    return (
      <>
        {head}
        <SkeletonRows />
      </>
    );
  }

  if (error && items === null) {
    return (
      <>
        {head}
        <p className="feed-error">
          관심 공고를 불러오지 못했습니다. <button type="button" className="btn" onClick={reload}>다시 시도</button>
        </p>
      </>
    );
  }

  if (!items || items.length === 0) {
    return (
      <>
        {head}
        <div className="state-wrap">
          <div className="empty-box" role="status">
            <span className="ico" aria-hidden="true"><i /></span>
            <h2>아직 담아 둔 공고가 없습니다</h2>
            <p>공고 목록이나 상세 화면에서 ☆를 누르면 여기 모입니다. 접수 마감이 가까운 순서로 보여 줍니다.</p>
            <Link href={ROUTES.home} className="btn ink">공고 둘러보기</Link>
          </div>
        </div>
      </>
    );
  }

  // 국면별로 가른다. 조회가 이미 마감 임박순으로 정렬해 오므로 덩이 안 순서는 그대로 둔다.
  // 빈 덩이는 제목도 내지 않는다 — 「오늘 마감 0건」은 알려 줄 것이 없는 줄이다
  const groups = new Map<NoticePhase, NoticeListItem[]>();
  for (const n of items) {
    const phase = noticePhase(n);
    const bucket = groups.get(phase);
    if (bucket) bucket.push(n);
    else groups.set(phase, [n]);
  }

  return (
    <div className="ex-list">
      {head}
      {PHASE_ORDER.filter((phase) => groups.has(phase)).map((phase) => {
        const rows = groups.get(phase) as NoticeListItem[];
        return (
          <section key={phase} className={`saved-group ph-${phase}`}>
            <h2>
              {PHASE_LABEL[phase]}
              <em>{count(rows.length)}</em>
            </h2>
            <ul className={`rows v-${view}`}>
              {rows.map((n, i) => (
                <NoticeRow key={n.id} n={n} stagger={(i % PAGE_SIZE) * ROW_STAGGER_MS} muted={!isSaved(n.id)} />
              ))}
            </ul>
          </section>
        );
      })}
      {error && (
        <p className="feed-error">
          목록을 새로 고치지 못했습니다. <button type="button" className="btn" onClick={reload}>다시 시도</button>
        </p>
      )}
    </div>
  );
}
