"use client";

// 셀렉트 — 네이티브 <select>의 OS 드롭다운을 버리고 칩과 같은 톤의 목록으로 바꾼다(사용자 요청 2026-09-09).
// 버튼 겉모습은 기존 .sel 그대로라 스코프 바·필터 바·단지 탐색기가 나란히 서도 어긋나지 않는다.
// 접근성은 listbox 패턴 — ↑↓ 이동, Enter/Space 선택, Esc 닫기, Home/End 양끝, 바깥 클릭 닫기, 닫으면 버튼으로 포커스 복귀.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string; count?: number };

// 목록 배치 수치 — 버튼과의 틈, 화면 가장자리 여백, 최소 너비, 최대 높이
const GAP = 6;
const EDGE = 8;
const MIN_W = 190;
const MAX_H = 320;

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** value === "" 일 때 버튼에 보일 문구이자 목록 첫 줄(전체) */
  placeholder: string;
  ariaLabel: string;
  className?: string;
  /** 빈 값을 고를 수 없는 셀렉트. 목록 첫 줄의 placeholder(전체)를 넣지 않는다 — 기준 공고처럼 늘 하나를 골라야 하는 자리 */
  allowAll?: boolean;
};

export function Select({ value, options, onChange, placeholder, ariaLabel, className, allowAll = true }: Props) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // 버튼에 붙는 자리(뷰포트 좌표). 아래가 좁으면 위로 뒤집고, 오른쪽이 좁으면 오른쪽 끝에 맞춘다
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);

  const all: SelectOption[] = allowAll ? [{ value: "", label: placeholder }, ...options] : options;
  const current = all.find((o) => o.value === value) ?? all[0];

  const close = useCallback((focusBack = true) => {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  }, []);

  /** 버튼 자리에 맞춰 목록 위치를 잰다. 열 때와 스크롤·리사이즈 때마다 부른다 */
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, MIN_W);
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    // 아래가 목록 한 판(또는 그 절반)도 못 담으면 위로 띄운다
    const up = below < Math.min(MAX_H, 200) && above > below;
    const maxH = Math.max(120, Math.min(MAX_H, up ? above : below));
    const left = Math.min(Math.max(EDGE, r.left), Math.max(EDGE, window.innerWidth - width - EDGE));
    // 위로 뒤집을 땐 아래 끝을 버튼에 맞춘다 — top으로 잡으면 목록이 짧을 때 버튼과 사이가 벌어진다
    setPos(up
      ? { left, bottom: window.innerHeight - r.top + GAP, width, maxH }
      : { left, top: r.bottom + GAP, width, maxH });
  }, []);

  // 바깥 클릭으로만 닫는다. 목록은 버튼에 붙어 함께 움직이므로 스크롤로 닫지 않는다(사용자 지적 2026-09-09)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      // 목록이 body에 포털돼 있어 감싼 div만 봐선 안 된다 — 목록 안을 눌렀는지도 함께 본다
      if (wrap.current?.contains(t) || menu.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open]);

  // 자리는 그려지기 전에 잡는다 — 한 프레임 엉뚱한 곳에 떴다 옮겨 가는 걸 막는다
  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  // 스크롤·리사이즈를 따라 붙는다. 스크롤 컨테이너가 따로 있을 수 있어 캡처 단계로 듣는다
  useEffect(() => {
    if (!open) return;
    const on = () => place();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [open, place]);

  // 열리면 현재 값에 커서를 놓고 목록을 그 줄로 스크롤
  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, all.findIndex((o) => o.value === value));
    setActive(i);
    const row = menu.current?.children[i] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
    // all은 매 렌더 새 배열 — value·open만 의존한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const move = (next: number) => {
    const i = Math.max(0, Math.min(all.length - 1, next));
    setActive(i);
    (menu.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  };

  const pick = (v: string) => { onChange(v); close(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); move(active + 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); move(active - 1); return; }
    if (e.key === "Home") { e.preventDefault(); move(0); return; }
    if (e.key === "End") { e.preventDefault(); move(all.length - 1); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(all[active].value); }
  };

  return (
    <div className={`selw${className ? ` ${className}` : ""}`} ref={wrap}>
      <button
        type="button"
        ref={btn}
        className={`sel${value ? " on" : ""}${open ? " open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
      >
        <span className="sel-v">{current.label}</span>
        {current.count !== undefined && <small>{current.count}</small>}
      </button>

      {open && pos && createPortal(
        <ul
          id={id}
          ref={menu}
          role="listbox"
          aria-label={ariaLabel}
          className={`selmenu${pos.bottom !== undefined ? " up" : ""}`}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxHeight: pos.maxH }}
          tabIndex={-1}
          onKeyDown={onKey}
        >
          {all.map((o, i) => (
            <li
              key={o.value || "__all"}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`${o.value === value ? "on" : ""}${i === active ? " cur" : ""}`.trim() || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <span>{o.label}</span>
              {o.count !== undefined && <small>{o.count}</small>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
