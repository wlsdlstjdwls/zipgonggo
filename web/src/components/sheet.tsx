"use client";

// 바텀시트 — 좁은 화면에서는 아래에서 올라오고 손가락으로 끌어 내려 닫는다.
// 넓은 화면에서는 같은 내용이 가운데 뜨는 창(팝업)으로 바뀐다.
//
// 동작과 수치는 fitin-app의 common_bottom_sheet / common_confirm_dialog를 그대로 옮겼다.
// 옮기면서 갈린 곳 둘:
//   1) 애니메이션 — fitin은 motion/react. 여기는 의존성을 늘리지 않고 lib/overlay의 rAF 트윈으로 같은 곡선을 돈다.
//   2) 색 — fitin 토큰(--Fitin_*) 대신 집공고 토큰(--ink·--line·--bg)에 맞췄다. 뼈대와 여백은 그대로다.
//
// 끌어 내리는 손잡이는 「핸들 줄 전체」다 — 회색 막대 옆 빈 자리를 잡아도 끌린다(fitin과 같다).
// 제목 줄도 손잡이다. 본문은 아니다 — 본문까지 손잡이면 목록을 스크롤하려다 창이 닫힌다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tween, useEscapeStack, useMedia, useScrollLock, type TweenHandle } from "@/lib/overlay";

// ── 수치 — fitin common_bottom_sheet의 상수를 그대로 옮긴 값 ─────────────
const ENTER_MS = 360;
const EXIT_MS = 220;
const SNAP_MS = 250;
const MODAL_MS = 180; // 넓은 화면 창의 진입·퇴장(fitin confirm_dialog와 같은 0.18s)

const ENTER_EASE = [0.32, 0.72, 0, 1] as const;
const EXIT_EASE = [0.4, 0, 1, 1] as const;
const SNAP_EASE = [0.25, 0.46, 0.45, 0.94] as const;

// 열린 직후 스크림으로 새어 들어오는 합성 click(ghost click)을 무시하는 기간
const GHOST_MS = 400;
// 올라오는 동안(360ms)에 여유를 더해, 다 서고 나서 손을 받는다
const INTERACTABLE_MS = 500;

// 끌어 내려 닫는 문턱 — 거리 또는 속도 하나만 넘으면 닫는다
const CLOSE_OFFSET_PX = 100;
const CLOSE_VELOCITY = 500;

// 스크림이 완전히 투명해지는 지점 — 화면 높이의 60%까지 내렸을 때
const FADE_RATIO = 0.6;

const DESKTOP_QUERY = "(min-width: 768px)";

export type SheetSize = "sm" | "md";

type Props = {
  open: boolean;
  /** 닫힘이 끝난 뒤(퇴장 애니메이션 포함) 부른다 */
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** 아래 고정 줄(버튼 등). 없으면 그리지 않는다 */
  footer?: React.ReactNode;
  /** 넓은 화면에서 창 너비 — sm 400px, md 560px */
  size?: SheetSize;
  /** 좁은 화면에서 시트 최대 높이 */
  maxHeight?: string;
};

export function Sheet({ open, onClose, title, children, footer, size = "md", maxHeight = "82vh" }: Props) {
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const desktop = useMedia(DESKTOP_QUERY);
  // 모션을 줄이기로 한 사람에게는 거리만 남기고 시간을 없앤다(끌기는 그대로 손을 따라온다)
  const reduce = useMedia("(prefers-reduced-motion: reduce)");

  const scrimRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // 지금 시트가 내려와 있는 거리(px). 상태로 두면 손가락보다 한 프레임 늦어 직접 style로 그린다
  const yRef = useRef(0);
  const animRef = useRef<TweenHandle | null>(null);
  const mountedRef = useRef(false);
  const closedRef = useRef(false);
  const openedAtRef = useRef(0);
  const interactRef = useRef(false);
  const desktopRef = useRef(desktop);
  const reduceRef = useRef(reduce);

  mountedRef.current = mounted;
  desktopRef.current = desktop;
  reduceRef.current = reduce;

  /** 모션 감소 설정이면 시간을 0으로 — 같은 자리에 곧바로 선다 */
  const ms = useCallback((value: number) => (reduceRef.current ? 0 : value), []);

  const viewportH = () => (typeof window === "undefined" ? 800 : window.innerHeight);

  /** 시트 위치와 스크림 투명도를 한 프레임에 같이 그린다 */
  const paint = useCallback((y: number) => {
    yRef.current = y;
    if (sheetRef.current) sheetRef.current.style.transform = `translate3d(0, ${y}px, 0)`;
    if (scrimRef.current) {
      const fade = viewportH() * FADE_RATIO;
      scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / fade)));
    }
  }, []);

  const stopAnim = useCallback(() => {
    animRef.current?.stop();
    animRef.current = null;
  }, []);

  /** 닫기 — 퇴장까지 마친 뒤에 부모에게 알린다(중복 호출 막음) */
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;

    const finish = () => {
      mountedRef.current = false;
      setMounted(false);
      setExiting(false);
      onClose();
    };

    if (desktopRef.current) {
      setExiting(true);
      window.setTimeout(finish, ms(MODAL_MS));
      return;
    }
    stopAnim();
    animRef.current = tween(yRef.current, viewportH(), ms(EXIT_MS), EXIT_EASE, paint, finish);
  }, [onClose, paint, stopAnim, ms]);

  // ── 마운트 / 부모가 직접 닫는 경우 ──────────────────────────
  useEffect(() => {
    if (open) {
      closedRef.current = false;
      setMounted(true);
      return;
    }
    if (!mountedRef.current) return;
    // 부모가 open=false로 닫았다 — 퇴장을 보여 주고 치운다
    if (desktopRef.current) {
      setExiting(true);
      const t = window.setTimeout(() => { setMounted(false); setExiting(false); }, ms(MODAL_MS));
      return () => window.clearTimeout(t);
    }
    stopAnim();
    animRef.current = tween(yRef.current, viewportH(), ms(EXIT_MS), EXIT_EASE, paint, () => setMounted(false));
  }, [open, paint, stopAnim, ms]);

  // 그려지기 전에 화면 밖으로 내려 둔다 — 안 그러면 iOS에서 제자리 시트가 한 프레임 번쩍인다
  useLayoutEffect(() => {
    if (!mounted) return;
    if (desktop) {
      // 좁은 화면에서 찍어 둔 인라인 값이 남아 있으면 창이 반투명하게 뜬다 — 지우고 CSS에 넘긴다
      if (sheetRef.current) sheetRef.current.style.transform = "";
      if (scrimRef.current) scrimRef.current.style.opacity = "";
      return;
    }
    openedAtRef.current = Date.now();
    paint(viewportH());
  }, [mounted, desktop, paint]);

  // ── 올라오기 + ghost 이벤트 차단 기간 ───────────────────────
  useEffect(() => {
    if (!mounted) return;
    openedAtRef.current = Date.now();
    interactRef.current = false;
    const timer = window.setTimeout(() => { interactRef.current = true; }, INTERACTABLE_MS);

    if (!desktop) {
      stopAnim();
      animRef.current = tween(viewportH(), 0, ms(ENTER_MS), ENTER_EASE, paint);
    }
    return () => {
      stopAnim();
      window.clearTimeout(timer);
      interactRef.current = false;
    };
  }, [mounted, desktop, paint, stopAnim, ms]);

  useScrollLock(mounted);
  useEscapeStack(mounted && !exiting, close);

  // ── 끌기 ────────────────────────────────────────────────
  const drag = useRef<{ id: number; y0: number; at0: number; lastY: number; lastT: number; prevY: number; prevT: number } | null>(null);

  const onGrabDown = useCallback((e: React.PointerEvent) => {
    if (desktopRef.current || !interactRef.current) return;
    // 스크림에서 시작한 끌기는 스크림 자체를 잡았을 때만 — 시트에서 버블링된 건 무시한다
    if (e.currentTarget === scrimRef.current && e.target !== e.currentTarget) return;
    stopAnim();
    const now = performance.now();
    drag.current = { id: e.pointerId, y0: e.clientY, at0: yRef.current, lastY: e.clientY, lastT: now, prevY: e.clientY, prevT: now };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [stopAnim]);

  const onGrabMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    d.prevY = d.lastY; d.prevT = d.lastT;
    d.lastY = e.clientY; d.lastT = now;
    // 위로는 못 올린다(fitin의 dragConstraints top:0 · elastic 0과 같다)
    paint(Math.max(0, d.at0 + (e.clientY - d.y0)));
  }, [paint]);

  const onGrabUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;

    const dt = Math.max(1, d.lastT - d.prevT);
    const velocity = ((d.lastY - d.prevY) / dt) * 1000;
    const offset = yRef.current - d.at0;

    if (velocity > CLOSE_VELOCITY || (offset > CLOSE_OFFSET_PX && velocity >= 0)) {
      close();
      return;
    }
    // 제자리로 — 스프링은 위로 튕겨 올라가 오버슛하므로 트윈으로 돌린다
    stopAnim();
    animRef.current = tween(yRef.current, 0, ms(SNAP_MS), SNAP_EASE, paint);
  }, [close, paint, stopAnim, ms]);

  const onScrimClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (Date.now() - openedAtRef.current < GHOST_MS) return; // 열자마자 날아든 합성 click
    close();
  }, [close]);

  if (!mounted || typeof document === "undefined") return null;

  const grab = desktop
    ? {}
    : { onPointerDown: onGrabDown, onPointerMove: onGrabMove, onPointerUp: onGrabUp, onPointerCancel: onGrabUp };

  return createPortal(
    <div className={`sheet-wrap${desktop ? " is-modal" : ""}${exiting ? " is-exit" : ""}`} data-size={size}>
      <button
        type="button"
        ref={scrimRef}
        className="sheet-scrim"
        aria-label={`${title} 닫기`}
        onClick={onScrimClick}
        {...grab}
      />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={desktop ? undefined : { maxHeight }}
      >
        {/* 손잡이 줄 — 막대 옆 빈 자리까지 이 줄 전체가 끌기 영역이다 */}
        <div className="sheet-grab" {...grab}>
          <span className="sheet-grip" aria-hidden="true" />
        </div>

        <div className="sheet-h" {...grab}>
          <b>{title}</b>
          <button type="button" className="sheet-x" onClick={close} aria-label="닫기">✕</button>
        </div>

        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
