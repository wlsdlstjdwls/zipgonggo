"use client";

// 사진·도면 전체화면 뷰어 — 좌우로 넘기고 확대한다(사용자 요청 2026-09-14).
//
// 평면도는 치수와 실별 면적이 적힌 그림이라 썸네일로는 못 읽는다. 확대가 본론이고 넘기기가 곁이다.
// 라이브러리를 쓰지 않는다 — web의 의존성은 next·react·pg 셋뿐이고, 뷰어 하나 때문에 늘리지 않는다.
// 제스처는 Pointer Events로 직접 받는다(마우스·터치·펜이 같은 경로).
//
// 참고: smokespot의 photo-lightbox.tsx. 거긴 framer-motion을 쓰고 확대가 없다 —
// 넘기기 판정 문턱(이동 비율 또는 속도)과 portal로 body에 그리는 이유만 가져왔다.
// portal이 필요한 까닭: transform이 걸린 조상 아래의 fixed는 뷰포트가 아니라 그 조상을 기준으로 잡힌다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 넘기기 판정 — 슬라이드 폭 대비 이동 비율 또는 놓는 순간 속도 중 하나만 넘으면 넘어간다.
const SWIPE_RATIO = 0.22;
const SWIPE_VELOCITY_PX_S = 450;
const MAX_SCALE = 6;
// 두 번 눌러 확대할 때의 배율. 평면도 실별 면적표가 읽히는 선.
const DOUBLE_TAP_SCALE = 2.8;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
// 이보다 작은 원본은 확대해도 뭉갠다. SH 실내 사진이 여기 걸린다(650~770px 실측)
const SMALL_ORIGINAL_PX = 1200;

/** label은 화면에 그대로 쓰는 한 줄이다 — 종류와 캡션을 따로 받아 뷰어가 이으면 「평면도 49 평면도」가 된다 */
type Slide = { src: string; label: string };
type Zoom = { scale: number; tx: number; ty: number };
const NO_ZOOM: Zoom = { scale: 1, tx: 0, ty: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function PhotoViewer({
  slides, index, onIndex, onClose, title,
}: {
  slides: Slide[]; index: number; onIndex: (i: number) => void; onClose: () => void; title: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [drag, setDrag] = useState(0);
  // 슬라이드 줄을 밀 거리는 무대 폭이 있어야 정해진다. 첫 그림에는 아직 상자가 없으니 재서 상태로 들고 있는다
  const [width, setWidth] = useState(0);
  // 손을 떼고 나서만 애니메이션을 건다. 끄는 중에 transition이 걸리면 손가락을 따라오지 않는다.
  // 처음엔 꺼 둔다 — 아래 useEffect 참고.
  const [animate, setAnimate] = useState(false);
  // 지금 사진 원본의 가로 픽셀. SH가 올린 실내 사진은 650~770px뿐이라 크게 보면 흐리다 — 그걸 미리 말해 준다
  const [natural, setNatural] = useState(0);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | null
    // onImage: 누르기 시작한 자리가 그림 위였는지. pointerup에서는 못 본다 —
    // setPointerCapture를 걸면 이후 이벤트의 target이 잡은 요소(무대)로 바뀐다
    | { mode: "swipe" | "pan"; x0: number; y0: number; t0: number; tx0: number; ty0: number; onImage: boolean }
    | { mode: "pinch"; dist0: number; scale0: number; tx0: number; ty0: number }
  >(null);
  const lastTap = useRef(0);

  const zoomed = zoom.scale > 1.01;

  // 사진을 바꾸면 확대는 풀린다. 이전 사진의 배율로 다음 사진을 보면 엉뚱한 데가 잡힌다.
  useLayoutEffect(() => {
    setZoom(NO_ZOOM);
    setDrag(0);
    setNatural(0);
  }, [index]);

  useLayoutEffect(() => {
    const measure = () => setWidth(stageRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // 열릴 때만은 transition을 끈다. 켜 둔 채 열면 줄이 0에서 -index*폭으로 미끄러져,
  // 열한 번째 사진을 눌렀는데 앞 열 장이 주르륵 지나간 뒤에야 그 사진이 선다(사용자 지적 2026-09-14).
  // 첫 그림은 폭을 재야 자리가 정해지므로(width) 자리잡기 자체가 한 번의 transform 변화다 — 그걸 안 태운다.
  // rAF 두 번: 한 번은 아직 같은 프레임이라 제자리 그림이 화면에 나가기 전에 켜질 수 있다.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setAnimate(true)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, []);

  const go = useCallback((next: number) => {
    onIndex(clamp(next, 0, slides.length - 1));
  }, [onIndex, slides.length]);

  // 뒤 지면 스크롤 잠금 + 키보드 조작.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(index - 1);
      if (e.key === "ArrowRight") go(index + 1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, index, onClose]);

  /** 그림이 실제로 그려진 자리. `object-fit: contain`이라 요소 상자 안에서 위아래(또는 좌우)가 남는다.
   *
   *  요소 상자를 그림으로 치면 두 군데가 어긋난다 — 남는 여백까지 끌 수 있게 되고, 여백을 눌러도
   *  「그림 위」로 읽혀 탭 닫기가 안 먹는다. 배율 1일 때만 부르므로 transform은 셈에 넣지 않는다.
   */
  const contentRect = useCallback(() => {
    const el = imgRef.current;
    if (!el || !el.naturalWidth) return null;
    const box = el.getBoundingClientRect();
    const s = Math.min(box.width / el.naturalWidth, box.height / el.naturalHeight);
    const w = el.naturalWidth * s;
    const h = el.naturalHeight * s;
    return { box, w, h, left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2 };
  }, []);

  /** 확대한 그림이 화면 밖으로 달아나지 않게 가둔다. 그려진 크기가 상자를 넘는 만큼만 끌린다. */
  const clampPan = useCallback((scale: number, tx: number, ty: number): Zoom => {
    const c = contentRect();
    if (!c) return { scale, tx, ty };
    const maxX = Math.max(0, (c.w * scale - c.box.width) / 2);
    const maxY = Math.max(0, (c.h * scale - c.box.height) / 2);
    return { scale, tx: clamp(tx, -maxX, maxX), ty: clamp(ty, -maxY, maxY) };
  }, [contentRect]);

  /** 화면 위 한 점을 붙들어 둔 채 배율만 바꾼다. 커서·손가락 아래가 그대로 있어야 확대가 자연스럽다. */
  const zoomAt = useCallback((nextScale: number, px: number, py: number) => {
    const box = imgRef.current?.getBoundingClientRect();
    setZoom((z) => {
      const scale = clamp(nextScale, 1, MAX_SCALE);
      if (scale <= 1.01) return NO_ZOOM;
      const f = scale / z.scale;
      const cx = box ? box.left + box.width / 2 : px;
      const cy = box ? box.top + box.height / 2 : py;
      return clampPan(scale, (px - cx) * (1 - f) + z.tx * f, (py - cy) * (1 - f) + z.ty * f);
    });
  }, [clampPan]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // 포인터가 이미 놓인 뒤면 throw한다(창 밖으로 나갔다 온 경우 등). 여기서 터지면 제스처가 통째로 죽는다
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* 잡지 못해도 이벤트는 계속 온다 */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimate(false);
    if (pointers.current.size === 2) {
      gesture.current = { mode: "pinch", dist0: dist(), scale0: zoom.scale, tx0: zoom.tx, ty0: zoom.ty };
    } else if (pointers.current.size === 1) {
      const c = contentRect();
      gesture.current = {
        mode: zoomed ? "pan" : "swipe",
        x0: e.clientX, y0: e.clientY, t0: performance.now(), tx0: zoom.tx, ty0: zoom.ty,
        onImage: !!c
          && e.clientX >= c.left && e.clientX <= c.left + c.w
          && e.clientY >= c.top && e.clientY <= c.top + c.h,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.mode === "pinch") {
      if (pointers.current.size < 2) return;
      setZoom(clampPan(clamp((g.scale0 * dist()) / g.dist0, 1, MAX_SCALE), g.tx0, g.ty0));
      return;
    }
    if (g.mode === "pan") {
      setZoom((z) => clampPan(z.scale, g.tx0 + (e.clientX - g.x0), g.ty0 + (e.clientY - g.y0)));
      return;
    }
    setDrag(e.clientX - g.x0);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    setAnimate(true);

    // 두 번 누르기는 **확대 중에도** 받아야 한다. swipe에서만 보면 확대한 뒤에는 제스처가 pan이라
    // 두 번 눌러도 아무 일이 없어 되돌릴 길이 사라진다(사용자 지적 2026-09-14)
    if (g && (g.mode === "swipe" || g.mode === "pan")) {
      const dx = e.clientX - g.x0;
      const dt = Math.max(1, performance.now() - g.t0);
      const width = stageRef.current?.clientWidth ?? window.innerWidth;
      const velocity = (dx / dt) * 1000;
      // 짧고 안 움직인 누름은 탭이다. 그림 위에서 두 번 이으면 확대(확대 중이면 원래대로), 여백을 누르면 닫는다.
      // 여백 탭을 곧장 닫기로 쓰는 건 그림 위 탭과 갈리기 때문이다 — 타이머로 두 번 탭을 기다릴 필요가 없다.
      if (Math.abs(dx) < TAP_SLOP_PX && Math.abs(e.clientY - g.y0) < TAP_SLOP_PX) {
        // 확대 중에는 여백 탭으로 닫지 않는다. 크게 본 그림은 가장자리가 어디까지인지 눈에 안 잡혀
        // 짚었다가 통째로 닫히면 억울하다. 확대를 먼저 풀면 그 다음 탭이 닫는다
        if (!g.onImage && !zoomed) {
          onClose();
          return;
        }
        const now = performance.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          // 이미 확대돼 있으면 두 번 눌러 되돌린다
          zoomAt(zoomed ? 1 : DOUBLE_TAP_SCALE, e.clientX, e.clientY);
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      } else if (g.mode === "swipe") {
        if (dx < -width * SWIPE_RATIO || velocity < -SWIPE_VELOCITY_PX_S) go(index + 1);
        else if (dx > width * SWIPE_RATIO || velocity > SWIPE_VELOCITY_PX_S) go(index - 1);
      }
      if (g.mode === "swipe") setDrag(0);
    }

    if (pointers.current.size === 0) gesture.current = null;
    // 핀치에서 손가락 하나를 떼면 남은 손가락으로 이어서 끌 수 있게 제스처를 다시 연다
    else if (pointers.current.size === 1 && g?.mode === "pinch") {
      const [p] = [...pointers.current.values()];
      gesture.current = { mode: "pan", x0: p.x, y0: p.y, t0: performance.now(), tx0: zoom.tx, ty0: zoom.ty, onImage: true };
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    // 데스크탑 확대. 휠은 기본이 지면 스크롤인데 뒤 지면은 이미 잠겨 있으니 그대로 배율에 쓴다
    zoomAt(zoom.scale * (1 - e.deltaY / 400), e.clientX, e.clientY);
  };

  const slide = slides[index];
  const trackX = -index * width + drag;

  return createPortal(
    <div className="pv" role="dialog" aria-modal="true" aria-label={`${title} 사진과 도면`}>
      <div
        className="pv-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className={`pv-track${animate ? " anim" : ""}`} style={{ transform: `translate3d(${trackX}px,0,0)` }}>
          {slides.map((s, i) => (
            <figure className="pv-slide" key={s.src}>
              {/* 원본 크기를 저장하지 않아 next/image를 못 쓴다. 옆 사진은 미리 받아 둔다 — 넘겼을 때 빈 칸이 보이지 않게 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={i === index ? imgRef : undefined}
                src={s.src}
                alt={`${title} ${s.label}`}
                draggable={false}
                loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
                onLoad={i === index ? (ev) => setNatural(ev.currentTarget.naturalWidth) : undefined}
                style={i === index && zoomed
                  ? { transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` }
                  : undefined}
              />
            </figure>
          ))}
        </div>
      </div>

      <div className="pv-top">
        <span className="pv-count">{index + 1} / {slides.length}</span>
        <span className="pv-cap">{slide.label}</span>
        <button type="button" className="pv-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>

      {slides.length > 1 && (
        <>
          <button type="button" className="pv-nav prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label="이전 사진">‹</button>
          <button type="button" className="pv-nav next" onClick={() => go(index + 1)} disabled={index === slides.length - 1} aria-label="다음 사진">›</button>
        </>
      )}

      <div className="pv-foot">
        {zoomed
          ? <button type="button" className="pv-chip" onClick={() => setZoom(NO_ZOOM)}>확대 풀기</button>
          : <span className="pv-chip">
              두 번 누르거나 손가락을 벌리면 확대됩니다
              {natural > 0 && natural < SMALL_ORIGINAL_PX && ` | 원본이 ${natural}px이라 크게 보면 흐립니다`}
            </span>}
      </div>
    </div>,
    document.body,
  );
}
