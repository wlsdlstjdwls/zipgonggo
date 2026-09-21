"use client";

// ★ 관심 공고 목록 + 토스트.
//
// **로그아웃 상태에서는 예전 그대로 localStorage에만 둔다.** 로그인하면 거기에 서버 사본이 하나 더 붙는다:
// 들어오는 순간 브라우저 목록과 서버 목록을 **합치고**(빼지 않는다 — 다른 기기에서 담은 게 사라지면
// 이용자로서는 이유를 알 길이 없다), 그 뒤의 토글은 localStorage와 서버에 같이 적는다.
// 서버 쓰기가 실패해도 화면은 그대로 간다 — 별표가 안 켜지는 것보다 사본이 하루 늦는 편이 낫다.
// 화면 문구는 「관심 공고」로 통일한다(사용자 결정 2026-09-18). 코드의 save/saved는 그대로 둔다 — 키 이름까지 바꾸면 이미 저장된 목록이 날아간다.
// 마운트 후에 읽어야 SSR HTML(전부 ☆)과 첫 렌더가 일치한다(hydration mismatch 방지).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SAVED_STORAGE_KEY, TOAST_MS } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";
import { useAuth } from "./auth-context";

type Ctx = {
  saved: ReadonlySet<number>;
  /** localStorage를 한 번 읽고 난 뒤 true. 관심 공고 화면이 "아직 모른다"와 "하나도 없다"를 구별하는 데 쓴다 —
   *  구별하지 않으면 재방문자에게 빈 화면이 한 번 번쩍였다가 목록이 들어온다 */
  ready: boolean;
  isSaved: (id: number) => boolean;
  toggle: (id: number) => void;
  /** 방금 토글된 id — 팝 애니메이션 대상. 460ms 후 해제 */
  popped: number | null;
  toast: (text: string) => void;
};

const SaveCtx = createContext<Ctx | null>(null);

function write(ids: Set<number>): void {
  try {
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // 프라이빗 모드 등 — 메모리에만 둔다
  }
}

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
  const { user } = useAuth();
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

  // 로그인한 사람의 목록을 서버와 한 번 맞춘다. **로그인 직후 한 번만** —
  // 사람이 바뀌었을 때(다른 계정으로 다시 로그인)도 한 번 더 돈다
  const syncedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    const local = [...saved];
    let cancelled = false;
    fetch(ROUTES.apiSaved, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "merge", ids: local }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ ids: number[] }>) : null))
      .then((d) => {
        if (cancelled || !d) return;
        const merged = new Set([...local, ...d.ids]);
        write(merged);
        setSaved(merged);
      })
      .catch(() => {
        // 서버가 안 받아도 브라우저 목록은 멀쩡하다. 다음 로그인 때 다시 시도한다
        syncedFor.current = null;
      });
    return () => { cancelled = true; };
    // saved를 의존성에 넣지 않는다 — 별표를 누를 때마다 합치기를 다시 돌 이유가 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

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
      write(next);
      // 로그인했으면 서버 사본에도 적는다. 답을 기다리지 않는다 — 별표는 이미 켜졌다
      if (user) {
        void fetch(ROUTES.apiSaved, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: on ? "add" : "remove", id }),
          keepalive: true,
        }).catch(() => {});
      }
      toast(on ? "관심 공고에 담았습니다" : "관심 공고에서 뺐습니다");
      return next;
    });
    setPopped(id);
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => setPopped(null), 460);
  }, [toast, user]);

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
