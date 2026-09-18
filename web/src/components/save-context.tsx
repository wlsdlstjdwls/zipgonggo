"use client";

// ★ 저장 목록 + 토스트. 서버 저장 없음 — localStorage에만 둔다(사용자 식별이 생기면 옮긴다).
// 마운트 후에 읽어야 SSR HTML(전부 ☆)과 첫 렌더가 일치한다(hydration mismatch 방지).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SAVED_STORAGE_KEY, TOAST_MS } from "@/lib/constants";

type Ctx = {
  saved: ReadonlySet<number>;
  /** localStorage를 한 번 읽고 난 뒤 true. 저장 목록 화면이 "아직 모른다"와 "하나도 없다"를 구별하는 데 쓴다 —
   *  구별하지 않으면 재방문자에게 빈 화면이 한 번 번쩍였다가 목록이 들어온다 */
  ready: boolean;
  isSaved: (id: number) => boolean;
  toggle: (id: number) => void;
  /** 방금 토글된 id — 팝 애니메이션 대상. 460ms 후 해제 */
  popped: number | null;
  toast: (text: string) => void;
};

const SaveCtx = createContext<Ctx | null>(null);

function read(): Set<number> {
  try {
    const raw = window.localStorage.getItem(SAVED_STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((v): v is number => typeof v === "number") : []);
  } catch {
    return new Set();
  }
}

export function SaveProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Set<number>>(() => new Set());
  const [ready, setReady] = useState(false);
  const [popped, setPopped] = useState<number | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSaved(read());
    setReady(true);
    // 다른 탭에서 바꾸면 따라간다
    const onStorage = (e: StorageEvent) => { if (e.key === SAVED_STORAGE_KEY) setSaved(read()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), TOAST_MS);
  }, []);

  const toggle = useCallback((id: number) => {
    setSaved((prev) => {
      const next = new Set(prev);
      const on = !next.has(id);
      if (on) next.add(id); else next.delete(id);
      try { window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...next])); } catch { /* 프라이빗 모드 등 — 메모리에만 */ }
      toast(on ? "저장했습니다" : "저장을 해제했습니다");
      return next;
    });
    setPopped(id);
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setPopped(null), 460);
  }, [toast]);

  const value = useMemo<Ctx>(() => ({ saved, ready, isSaved: (id) => saved.has(id), toggle, popped, toast }), [saved, ready, toggle, popped, toast]);

  return (
    <SaveCtx.Provider value={value}>
      {children}
      <div className={`toast${toastText ? " show" : ""}`} role="status" aria-live="polite">
        <span><i aria-hidden="true" />{toastText ?? ""}</span>
      </div>
    </SaveCtx.Provider>
  );
}

export function useSave(): Ctx {
  const c = useContext(SaveCtx);
  if (!c) throw new Error("SaveProvider 밖에서 useSave를 불렀다");
  return c;
}
