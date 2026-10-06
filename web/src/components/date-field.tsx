"use client";

// 날짜 칸 — 네이티브 <input type="date">의 OS 달력을 버리고 셀렉트(select.tsx)와 같은 톤의 달력을 띄운다
// (사용자 지적 2026-10-06: "날짜 피커도 디자인이 안 되어 있다"). 값은 그대로 "YYYY-MM-DD" 문자열이다.
// 접근성은 grid 패턴 — ←→ 하루, ↑↓ 한 주, PageUp/PageDown 한 달, Home/End 주의 양끝, Enter/Space 고르기, Esc 닫기,
// 바깥 클릭 닫기, 닫으면 버튼으로 포커스 복귀. 목록처럼 body에 포털하고 스크롤을 따라 붙는다.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 8;
const W = 292;
const H = 340;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

type Ymd = { y: number; m: number; d: number }; // m은 0~11

function parse(v: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (x: Ymd) => `${x.y}-${pad(x.m + 1)}-${pad(x.d)}`;
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** 달을 넘나드는 날짜 더하기 — Date에 맡긴다 */
function shift(x: Ymd, days: number): Ymd {
  const t = new Date(x.y, x.m, x.d + days);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
function shiftMonth(x: Ymd, n: number): Ymd {
  const t = new Date(x.y, x.m + n, 1);
  return { y: t.getFullYear(), m: t.getMonth(), d: Math.min(x.d, daysIn(t.getFullYear(), t.getMonth())) };
}
function todayYmd(): Ymd {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
/** 버튼에 보일 글 — 「2026년 11월 14일 (토)」 */
function label(x: Ymd): string {
  return `${x.y}년 ${x.m + 1}월 ${x.d}일 (${DOW[new Date(x.y, x.m, x.d).getDay()]})`;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
};

export function DateField({ value, onChange, ariaLabel, placeholder = "날짜 선택" }: Props) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const sel = parse(value);
  // 커서가 놓인 날 — 보이는 달도 이걸 따른다
  const [cur, setCur] = useState<Ymd>(() => sel ?? todayYmd());
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const close = useCallback((focusBack = true) => {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  }, []);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const up = below < H && r.top - GAP - EDGE > below;
    const left = Math.min(Math.max(EDGE, r.left), Math.max(EDGE, window.innerWidth - W - EDGE));
    setPos(up ? { left, bottom: window.innerHeight - r.top + GAP } : { left, top: r.bottom + GAP });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const on = () => place();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open]);
  // 열 때 커서를 고른 날(없으면 오늘)에 두고, 그 칸으로 포커스를 옮긴다
  useEffect(() => {
    if (open) setCur(parse(value) ?? todayYmd());
    // value가 바뀔 때마다 커서를 끌어오지 않는다 — 여는 순간만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLButtonElement>(`[data-d="${fmt(cur)}"]`)?.focus();
  }, [open, cur]);

  const pick = (x: Ymd) => { onChange(fmt(x)); close(); };

  const onGridKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    const dow = new Date(cur.y, cur.m, cur.d).getDay();
    const moves: Record<string, () => Ymd> = {
      ArrowLeft: () => shift(cur, -1), ArrowRight: () => shift(cur, 1),
      ArrowUp: () => shift(cur, -7), ArrowDown: () => shift(cur, 7),
      PageUp: () => shiftMonth(cur, -1), PageDown: () => shiftMonth(cur, 1),
      Home: () => shift(cur, -dow), End: () => shift(cur, 6 - dow),
    };
    if (moves[k]) { e.preventDefault(); setCur(moves[k]()); return; }
    if (k === "Enter" || k === " ") { e.preventDefault(); pick(cur); return; }
    if (k === "Escape") { e.preventDefault(); close(); }
  };

  // 6주 판. 첫 칸은 그 달 1일이 든 주의 일요일
  const first = new Date(cur.y, cur.m, 1);
  const start = shift({ y: cur.y, m: cur.m, d: 1 }, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => shift(start, i));
  const today = todayYmd();
  const same = (a: Ymd | null, b: Ymd) => !!a && a.y === b.y && a.m === b.m && a.d === b.d;

  return (
    <>
      <button
        type="button"
        ref={btn}
        className={`elig-in df-btn${sel ? "" : " empty"}${open ? " open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        <span>{sel ? label(sel) : placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <rect x="2.2" y="3.2" width="11.6" height="10.6" rx="2" /><path d="M5.2 1.8v2.4M10.8 1.8v2.4M2.2 6.6h11.6" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          id={id}
          ref={pop}
          role="dialog"
          aria-label={`${ariaLabel} 달력`}
          className={`df-pop${pos.bottom !== undefined ? " up" : ""}`}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: W }}
        >
          <div className="df-head">
            <button type="button" className="df-nav" aria-label="이전 달" onClick={() => setCur(shiftMonth(cur, -1))}>‹</button>
            <b aria-live="polite">{cur.y}년 {cur.m + 1}월</b>
            <button type="button" className="df-nav" aria-label="다음 달" onClick={() => setCur(shiftMonth(cur, 1))}>›</button>
          </div>
          <div className="df-grid" role="grid" onKeyDown={onGridKey}>
            {DOW.map((w, i) => <span key={w} className={`df-dow${i === 0 ? " sun" : i === 6 ? " sat" : ""}`} role="columnheader">{w}</span>)}
            {cells.map((c) => {
              const out = c.m !== cur.m;
              const isSel = same(sel, c);
              const isCur = same(cur, c);
              const dow = new Date(c.y, c.m, c.d).getDay();
              return (
                <button
                  key={fmt(c)}
                  type="button"
                  role="gridcell"
                  data-d={fmt(c)}
                  tabIndex={isCur ? 0 : -1}
                  aria-selected={isSel}
                  aria-label={label(c)}
                  className={["df-day", out && "out", isSel && "on", same(today, c) && "today", dow === 0 && "sun", dow === 6 && "sat"].filter(Boolean).join(" ")}
                  onClick={() => pick(c)}
                >
                  {c.d}
                </button>
              );
            })}
          </div>
          <div className="df-foot">
            <button type="button" onClick={() => pick(today)}>오늘</button>
            {sel && <button type="button" onClick={() => { onChange(""); close(); }}>지우기</button>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
