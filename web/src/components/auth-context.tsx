"use client";

// 로그인 상태를 앱 전체가 한 번만 묻게 하는 자리.
//
// **서버 레이아웃에서 세션을 읽지 않는다.** 루트 레이아웃이 쿠키를 건드리면 전 지면이 동적으로
// 떨어져 ISR이 죽는다(공고 3만 지면). 그래서 브라우저가 마운트 뒤에 /api/auth/me를 한 번 묻고,
// 그 답을 헤더·관심 공고·내 계정이 같이 구독한다.
//
// 그 대가로 첫 프레임에는 로그인 여부를 모른다(loading). 이 시간에는 헤더의 계정 자리를
// **비워 둔다** — 「로그인」을 먼저 그렸다가 이름으로 바뀌면 그 깜빡임이 더 나쁘다.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  nickname: string | null;
  profileImage: string | null;
  createdAt: string;
};

type AuthState = {
  user: AuthUser | null;
  /** 아직 /api/auth/me 답을 못 받았다 */
  loading: boolean;
  /** env에 카카오 키가 없는 배포 — 로그인 문을 아예 그리지 않는다 */
  enabled: boolean;
  /** 운영자 쿠키(zg_admin)로 들어와 있다. 아직 안 연 메뉴를 이 사람에게만 보인다(components/admin-only.tsx) */
  admin: boolean;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { enabled: boolean; admin?: boolean; user: AuthUser | null };
      setEnabled(d.enabled);
      setAdmin(d.admin === true);
      setUser(d.user ?? null);
    } catch {
      // 물어보지 못했으면 로그아웃으로 친다. 화면이 하나도 안 그려지는 것보다는 낫다
      setUser(null);
      setAdmin(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({ user, loading, enabled, admin, refresh }), [user, loading, enabled, admin, refresh]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("AuthProvider 밖에서 useAuth를 불렀다");
  return c;
}
