"use client";

// 「내 조건」 한 벌을 앱 전체가 같이 쓰는 자리(lib/profile.ts가 값의 모양을 정한다).
//
// 순서가 전부다.
//   1) 서버 HTML은 **언제나 기본값** — 하이드레이션이 어긋날 자리를 만들지 않는다
//   2) 마운트 뒤 localStorage를 읽어 즉시 채운다(로그인 여부와 무관, 여기까지는 예전과 같은 약속)
//   3) 로그인했고 **계정 저장을 켰으면** /api/profile을 한 번 묻고, 서버 쪽이 더 최신일 때만 갈아끼운다
//   4) 사람이 이미 손을 댔으면(dirty) 서버 답이 늦게 와도 **덮지 않는다** — 입력 중에 값이 튀는 게 제일 나쁘다
//
// 쓰기는 디바운스한다. 숫자 칸은 키 하나에 한 번씩 바뀌어서 관심 공고(★)처럼 즉시 쏘면 커넥션이 폭주한다.
// 서버 쓰기가 실패해도 화면은 그대로 간다 — 사본이 늦는 편이 입력이 끊기는 것보다 낫다.
//
// **계정 저장의 단일 원천은 DB에 행이 있느냐다.** 켜기는 PUT, 끄기는 DELETE. 브라우저에 따로 깃발을
// 두지 않는다 — 두면 기기마다 다른 답을 들고 서로를 덮는다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FIT_MINGAN_STORAGE_KEY, FIT_STORAGE_KEY, PROFILE_SAVE_DEBOUNCE_MS, PROFILE_STORAGE_KEY } from "@/lib/constants";
import {
  DEFAULT_PROFILE, mergeFromServer, sanitizeProfile, stripSensitive,
  type StoredProfile, type UserProfile,
} from "@/lib/profile";
import { useAuth } from "./auth-context";
import { useSave } from "./save-context";

type Ctx = {
  profile: UserProfile;
  /** localStorage를 한 번 읽고 난 뒤 true. 화면은 이때 제 폼에 값을 얹는다 */
  ready: boolean;
  /** 사람이 넣은 값이 있다(브라우저나 계정에 저장분이 있거나 이번에 고쳤다). false면 profile은 기본값일 뿐이라
   *  남의 조건처럼 판정을 매기면 안 된다 — 공고 신청자격 카드의 판정이 이걸 본다(2026-10-06) */
  saved: boolean;
  /** 계정 저장이 켜져 있다(서버에 행이 있다). 로그아웃이면 언제나 false */
  sync: boolean;
  /** 아직 서버에 물어보는 중 */
  syncLoading: boolean;
  patch: (part: Partial<UserProfile>) => void;
  setSync: (on: boolean) => Promise<void>;
};

const ProfileCtx = createContext<Ctx | null>(null);

function readLocal(): StoredProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { p?: unknown; updatedAt?: unknown };
    return { p: sanitizeProfile(v?.p), updatedAt: typeof v?.updatedAt === "string" ? v.updatedAt : "" };
  } catch {
    return null;
  }
}

function writeLocal(v: StoredProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // 사생활 모드 등 — 메모리에만 둔다
  }
}

/**
 * 옛 키에 남아 있던 값을 한 벌로 옮긴다. **한 번만**, 새 키가 비어 있을 때만.
 * 옛 키는 지우지 않는다 — 이 기능을 되돌려야 할 때 돌아갈 자리가 있어야 한다.
 * 거주지의 자가진단 어휘(region)는 여기서 못 채운다(시군구 목록이 없다). 화면이 reconcileRegion으로 채운다.
 */
function migrateLegacy(): UserProfile | null {
  const pick = (key: string, unwrap: boolean): Record<string, unknown> | null => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const v = JSON.parse(raw) as Record<string, unknown>;
      const body = unwrap ? (v?.p as Record<string, unknown> | undefined) : v;
      return body && typeof body === "object" ? body : null;
    } catch {
      return null;
    }
  };
  const fit = pick(FIT_STORAGE_KEY, true);
  const mg = pick(FIT_MINGAN_STORAGE_KEY, false);
  if (!fit && !mg) return null;
  const src = fit ?? mg!;
  // 옛 타입의 칸 이름을 새 이름으로 옮긴다. 없으면 sanitizeProfile이 기본값을 넣는다
  return sanitizeProfile({
    ...DEFAULT_PROFILE,
    ...src,
    incomeHouseholdWon: typeof src.incomeWon === "number" ? src.incomeWon : DEFAULT_PROFILE.incomeHouseholdWon,
    incomeSelfWon: typeof src.selfIncomeWon === "number" ? src.selfIncomeWon : DEFAULT_PROFILE.incomeSelfWon,
    classes: typeof src.cls === "string" ? [src.cls] : DEFAULT_PROFILE.classes,
    gu: typeof src.gu === "string" ? src.gu : "",
  });
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useSave();
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sync, setSyncState] = useState(false);
  const [syncLoading, setSyncLoading] = useState(true);

  const updatedAt = useRef<string>("");
  /** 이 세션에서 사람이 값을 고쳤다. 고친 뒤엔 서버 답으로 덮지 않는다 */
  const dirty = useRef(false);
  /** 서버에 한 번 물어보기 전에는 서버로 쓰지 않는다 — 기본값이 남의 저장분을 덮는다 */
  const serverAsked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<UserProfile | null>(null);

  // 1) 브라우저에 있던 값
  useEffect(() => {
    const local = readLocal();
    if (local) {
      setProfile(local.p);
      setSaved(true);
      updatedAt.current = local.updatedAt;
    } else {
      const moved = migrateLegacy();
      if (moved) {
        setProfile(moved);
        setSaved(true);
        updatedAt.current = new Date().toISOString();
        writeLocal({ p: moved, updatedAt: updatedAt.current });
      }
    }
    setReady(true);
  }, []);

  const putServer = useCallback(async (p: UserProfile) => {
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: stripSensitive(p) }),
      });
      if (!res.ok) return;
      const d = (await res.json()) as { updatedAt?: string };
      if (typeof d.updatedAt === "string") updatedAt.current = d.updatedAt;
    } catch {
      // 사본이 하루 늦는 게 입력이 끊기는 것보다 낫다
    }
  }, []);

  // 2) 서버 사본. 로그인했을 때만 묻는다. 로그아웃이면 계정 저장은 꺼진 것으로 친다
  useEffect(() => {
    if (authLoading || !ready) return;
    if (!user) {
      setSyncState(false);
      setSyncLoading(false);
      serverAsked.current = false;
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/profile", { headers: { accept: "application/json" }, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as { sync?: boolean; profile?: unknown; updatedAt?: string | null };
        if (!alive) return;
        setSyncState(d.sync === true);
        // 사람이 이미 손을 댔으면 덮지 않는다. 서버 쪽이 더 최신일 때만 갈아끼운다
        if (d.sync && d.profile && !dirty.current && (d.updatedAt ?? "") > updatedAt.current) {
          setProfile((prev) => {
            const merged = mergeFromServer(prev, sanitizeProfile(d.profile, false));
            writeLocal({ p: merged, updatedAt: d.updatedAt ?? "" });
            return merged;
          });
          updatedAt.current = d.updatedAt ?? "";
          setSaved(true);
          toast("계정에 저장해 둔 조건을 불러왔습니다");
        }
      } catch {
        if (alive) setSyncState(false);
      } finally {
        if (alive) {
          serverAsked.current = true;
          setSyncLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [user, authLoading, ready, toast]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    if (sync && serverAsked.current) void putServer(p);
  }, [sync, putServer]);

  // 탭을 떠날 때 못 보낸 게 있으면 마저 보낸다
  useEffect(() => {
    const onLeave = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onLeave);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onLeave);
    };
  }, [flush]);

  const patch = useCallback((part: Partial<UserProfile>) => {
    dirty.current = true;
    setSaved(true);
    setProfile((prev) => {
      const next = sanitizeProfile({ ...prev, ...part });
      const at = new Date().toISOString();
      updatedAt.current = at;
      writeLocal({ p: next, updatedAt: at });
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const q = pending.current;
        pending.current = null;
        if (q && sync && serverAsked.current) void putServer(q);
      }, PROFILE_SAVE_DEBOUNCE_MS);
      return next;
    });
  }, [sync, putServer]);

  const setSync = useCallback(async (on: boolean) => {
    if (!user) return;
    if (on) {
      setSyncState(true);
      await putServer(profile);
      toast("이제 이 계정에 조건을 저장합니다");
    } else {
      setSyncState(false);
      try {
        await fetch("/api/profile", { method: "DELETE" });
        toast("계정에 저장된 조건을 지웠습니다");
      } catch {
        // 못 지웠으면 다음 시도에 다시 누를 수 있다
      }
    }
  }, [user, profile, putServer, toast]);

  const value = useMemo<Ctx>(
    () => ({ profile, ready, saved, sync, syncLoading, patch, setSync }),
    [profile, ready, saved, sync, syncLoading, patch, setSync],
  );
  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>;
}

export function useProfile(): Ctx {
  const c = useContext(ProfileCtx);
  if (!c) throw new Error("ProfileProvider 밖에서 useProfile을 불렀다");
  return c;
}
