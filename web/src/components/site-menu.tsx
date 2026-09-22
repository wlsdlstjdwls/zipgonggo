"use client";

// 폰 헤더의 접힌 메뉴(☰). 한 줄 60px에 로고·검색칸·메뉴 넷이 다 서지 못해 서로 밀어냈다
// (사용자 지적 2026-09-22). **줄을 늘리지 않는다** — 상세의 스크롤 머리바(.dhb)가 60px 고정이라
// 헤더가 커지면 그걸 못 덮는다(globals.css 640px 분기 머리글).
//
// 그래서 넓은 화면의 메뉴(자격진단·관심공고·계산기·계정)를 폰에서는 이 한 칸으로 접는다.
// **여는 문은 그대로다** — 계산기는 CalcProvider의 toggle을 그대로 부르고(패널은 body 포털),
// 로그인은 헤더 계정 자리와 같은 loginPath로 간다. 여기서 새 상태를 만들지 않는다.
//
// 관심공고 건수는 localStorage에서 온다 — 0일 때 배지를 아예 안 그리는 게 하이드레이션 안전장치다
// (saved-link.tsx 머리글과 같은 이유).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/my/actions";
import { loginPath, ROUTES } from "@/lib/routes";
import { useAuth } from "./auth-context";
import { useCalc } from "./calc-context";
import { useSave } from "./save-context";
import { IconMenu } from "./icons";

export function SiteMenu() {
  const { user, admin, loading, enabled } = useAuth();
  const { saved } = useSave();
  const { toggle: toggleCalc } = useCalc();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc를 누르면 닫는다 — 계정 메뉴와 같은 규칙(account-menu.tsx)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 지면을 옮기면 열린 메뉴는 닫는다
  useEffect(() => setOpen(false), [pathname]);

  const n = saved.size;
  return (
    <div className="smenu" ref={box}>
      <button
        type="button"
        className={`nav-btn smenu-btn${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="메뉴"
      >
        <IconMenu />
        {/* 접힌 메뉴 안에 담아 둔 공고가 있다는 건 닫힌 채로도 보여야 한다 */}
        {n > 0 && <em className="nav-badge smenu-dot">{n}</em>}
      </button>

      {open && (
        <div className="acct-menu smenu-panel" role="menu">
          {/* 아직 안 연 메뉴는 운영자에게만 — AdminOnly와 같은 값(admin)을 본다 */}
          {admin && <Link href={ROUTES.eligibility} role="menuitem">자격진단</Link>}
          <Link href={ROUTES.my} role="menuitem">
            관심공고
            {n > 0 && <em className="nav-badge">{n}</em>}
          </Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); toggleCalc(); }}>
            계산기
          </button>
          {/* 계정 줄은 한 칸 띄워 가른다. 답을 받기 전(loading)에는 안 그린다 —
              「로그인」이 떴다 이름으로 바뀌는 깜빡임을 피한다(account-menu.tsx와 같은 규칙) */}
          {enabled && !loading && (
            <div className="smenu-acct">
              {user ? (
                <>
                  <Link href={ROUTES.myAccount} role="menuitem">내 계정</Link>
                  <form action={signOut}><button type="submit" role="menuitem">로그아웃</button></form>
                </>
              ) : (
                <Link href={loginPath(pathname)} role="menuitem">로그인</Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
