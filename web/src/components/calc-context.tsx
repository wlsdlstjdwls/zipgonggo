"use client";

// 계산기 상태 — 오른쪽 아래 떠 있던 버튼을 헤더 메뉴로 올렸다(사용자 요청 2026-09-09: 잘 안 보인다).
// 버튼(헤더)과 패널(body 포털)과 씨앗값(상세 페이지)이 서로 다른 트리에 있어 컨텍스트로 잇는다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { IconCalc } from "./icons";

export type CalcSeedValue = { deposit: number | null; rent: number | null; sourceLabel?: string };

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  seed: CalcSeedValue;
  setSeed: (s: CalcSeedValue) => void;
  /** 닫을 때 초점을 돌려줄 헤더 버튼 */
  buttonRef: React.RefObject<HTMLButtonElement | null>;
};

const EMPTY: CalcSeedValue = { deposit: null, rent: null };
const CalcCtx = createContext<Ctx | null>(null);

export function useCalc(): Ctx {
  const c = useContext(CalcCtx);
  if (!c) throw new Error("useCalc은 CalcProvider 안에서만 쓴다");
  return c;
}

export function CalcProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<CalcSeedValue>(EMPTY);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo<Ctx>(() => ({ open, setOpen, toggle, seed, setSeed, buttonRef }), [open, seed, toggle]);
  return <CalcCtx.Provider value={value}>{children}</CalcCtx.Provider>;
}

/** 헤더 메뉴 버튼. 자격진단 링크와 나란히 선다 */
export function CalcButton() {
  const { open, toggle, buttonRef } = useCalc();
  return (
    // 라벨은 span — 상세 머리바가 좁아지면 CSS로 감추고 아이콘만 남긴다. 이름은 aria-label이 지킨다
    <button ref={buttonRef} type="button" className={`nav-btn${open ? " on" : ""}`} onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label="계산기">
      <IconCalc />
      <span>계산기</span>
    </button>
  );
}

/** 상세 페이지가 이 공고·단지 금액을 계산기 첫 값으로 넘긴다. 그리는 건 없다 */
export function CalcSeed({ deposit, rent, sourceLabel }: CalcSeedValue) {
  const { setSeed } = useCalc();
  useEffect(() => {
    setSeed({ deposit, rent, sourceLabel });
    return () => setSeed(EMPTY);
  }, [deposit, rent, sourceLabel, setSeed]);
  return null;
}
