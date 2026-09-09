"use client";

// 셀렉트 — 네이티브 <select>의 OS 드롭다운을 버리고 칩과 같은 톤의 목록으로 바꾼다(사용자 요청 2026-09-09).
// 버튼 겉모습은 기존 .sel 그대로라 스코프 바·필터 바·단지 탐색기가 나란히 서도 어긋나지 않는다.
// 접근성은 listbox 패턴 — ↑↓ 이동, Enter/Space 선택, Esc 닫기, Home/End 양끝, 바깥 클릭 닫기, 닫으면 버튼으로 포커스 복귀.
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; count?: number };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** value === "" 일 때 버튼에 보일 문구이자 목록 첫 줄(전체) */
  placeholder: string;
  ariaLabel: string;
  /** 목록을 버튼 오른쪽 끝에 맞춘다 */
  align?: "start" | "end";
  className?: string;
};

export function Select({ value, options, onChange, placeholder, ariaLabel, align = "start", className }: Props) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all: SelectOption[] = [{ value: "", label: placeholder }, ...options];
  const current = all.find((o) => o.value === value) ?? all[0];

  const close = useCallback((focusBack = true) => {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  }, []);

  // 바깥 클릭·스크롤로 닫기. 목록이 버튼에 붙어 있어 스크롤하면 떠 보이므로 같이 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

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

      {open && (
        <ul
          id={id}
          ref={menu}
          role="listbox"
          aria-label={ariaLabel}
          className={`selmenu${align === "end" ? " end" : ""}`}
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
        </ul>
      )}
    </div>
  );
}
