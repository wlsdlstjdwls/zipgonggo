"use client";

// 오버레이 공통 장치 — ESC 스택, 배경 스크롤 잠금, 트윈.
// fitin-app(common_hooks/common_overlay, common_bottom_sheet)의 동작을 그대로 옮겼다.
// 다른 점 하나: fitin은 motion/react의 animate()를 쓰지만 web의 의존성은 next·react·pg 셋뿐이라
// 같은 곡선을 rAF로 직접 돌린다(사진 뷰어가 이미 같은 방침이다).

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ── 큐빅 베지어 ────────────────────────────────────────────
// CSS transition으로는 스크림 투명도와 시트 위치를 한 프레임에 같이 못 움직인다
// (드래그 중에는 transition이 없어야 손을 따라온다). 두 값을 한 루프에서 같이 그리려고 직접 푼다.

type Ease = readonly [number, number, number, number];

/** 진행도 t(0~1)를 곡선에 통과시킨다. 표준 뉴턴-랩슨 + 이분법 보정 */
export function cubicBezier([x1, y1, x2, y2]: Ease) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-4) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    // 기울기가 0에 가까운 구간 — 이분법으로 마무리
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-4) break;
      if (v < x) lo = t;
      else hi = t;
      t = (hi + lo) / 2;
    }
    return sampleY(t);
  };
}

export type TweenHandle = { stop: () => void };

/** from에서 to까지 duration(ms) 동안 곡선을 따라 흐르며 매 프레임 onFrame(값)을 부른다 */
export function tween(
  from: number,
  to: number,
  duration: number,
  ease: Ease,
  onFrame: (value: number) => void,
  onDone?: () => void,
): TweenHandle {
  const curve = cubicBezier(ease);
  const t0 = performance.now();
  let raf = 0;
  let alive = true;

  const step = (now: number) => {
    if (!alive) return;
    const p = duration <= 0 ? 1 : Math.min(1, (now - t0) / duration);
    onFrame(from + (to - from) * curve(p));
    if (p < 1) {
      raf = requestAnimationFrame(step);
      return;
    }
    alive = false;
    onDone?.();
  };
  raf = requestAnimationFrame(step);

  return {
    stop: () => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
    },
  };
}

// ── ESC 스택 ──────────────────────────────────────────────
// 오버레이마다 document keydown을 따로 달면 겹쳐 열린 창이 ESC 한 번에 전부 닫힌다
// (예: 계산기 위에 셀렉트 목록). 열린 순서로 쌓아 두고 맨 위 하나만 반응시킨다.

const escapeStack: symbol[] = [];

/**
 * ESC로 닫히는 오버레이로 등록한다. 겹친 것 중 가장 나중에 열린 하나만 ESC를 받는다.
 * 「지금은 닫으면 안 된다」는 enabled=false가 아니라 onEscape 안에서 무시해야 한다 —
 * 그래야 맨 위 자리를 유지해 ESC가 아래 창으로 새지 않는다.
 */
export function useEscapeStack(enabled: boolean, onEscape: () => void): void {
  const ref = useRef(onEscape);
  useLayoutEffect(() => { ref.current = onEscape; });

  useEffect(() => {
    if (!enabled) return;
    const token = Symbol("overlay");
    escapeStack.push(token);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escapeStack[escapeStack.length - 1] !== token) return;
      ref.current();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const i = escapeStack.lastIndexOf(token);
      if (i !== -1) escapeStack.splice(i, 1);
    };
  }, [enabled]);
}

// ── 배경 스크롤 잠금 ───────────────────────────────────────

/**
 * 오버레이가 떠 있는 동안 뒤 지면이 따라 움직이지 않게 잠근다.
 * overflow:hidden만으로는 iOS에서 배경이 튀어 position:fixed로 자리를 고정하고 돌려놓는다.
 * keep은 그 안에서는 스크롤을 허용할 선택자다(시트 본문 · 뷰어 무대).
 * .selmenu도 넣는다 — 셀렉트 목록은 body로 포털돼 시트 밖에 있어, 빼면 목록 위 터치드래그가 막힌다.
 */
export function useScrollLock(locked: boolean, keep = ".sheet, .pv, .selmenu"): void {
  useEffect(() => {
    if (!locked) return;

    const html = document.documentElement;
    const body = document.body;
    const saved = {
      htmlOverflow: html.style.overflow,
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    const scrollY = window.scrollY;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollY > 0) {
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.width = "100%";
    }

    // 오버레이 밖에서 시작한 터치 스크롤은 아예 막는다 — 안 막으면 배경이 딸려 움직인다
    const onTouchMove = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest(keep)) e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      html.style.overflow = saved.htmlOverflow;
      body.style.overflow = saved.overflow;
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.width = saved.width;
      if (scrollY > 0) window.scrollTo(0, scrollY);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [locked, keep]);
}

// ── 뷰포트 질의 ───────────────────────────────────────────

/**
 * 미디어 질의 결과. 서버 렌더와 어긋나지 않게 처음엔 false로 시작하고 마운트 직후 실제 값이 된다.
 * 오버레이는 열릴 때만 그려지므로(portal) 이 한 프레임 차이가 화면에 보이지 않는다.
 */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}
