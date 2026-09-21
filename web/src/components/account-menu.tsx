"use client";

// 헤더 오른쪽 계정 자리. 상태가 셋이라 그리는 것도 셋이다.
//   1) 아직 모른다(loading) — **아무것도 안 그린다.** 「로그인」이 떴다가 이름으로 바뀌는 깜빡임을 피한다
//   2) 로그인 안 함 — 「로그인」 한 칸. 지금 보던 자리로 돌아오도록 next를 들려 보낸다
//   3) 로그인함 — 프로필 사진과 별명. 눌러 열면 관심 공고 / 내 계정 / 로그아웃
//
// 카카오 키가 없는 배포에서는(enabled=false) 이 자리 자체가 없다 — 눌러도 안 되는 문을 그리지 않는다.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/my/actions";
import { loginPath, ROUTES } from "@/lib/routes";
import { useAuth } from "./auth-context";

function initial(nickname: string | null): string {
  const t = nickname?.trim();
  return t ? t.slice(0, 1) : "회";
}

export function AccountMenu() {
  const { user, loading, enabled } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc를 누르면 닫는다
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

  if (!enabled || loading) return <span className="acct-hold" aria-hidden="true" />;

  if (!user) {
    return (
      <Link className="nav-btn acct-in" href={loginPath(pathname)}>
        로그인
      </Link>
    );
  }

  const name = user.nickname?.trim() || "회원";
  return (
    <div className="acct" ref={box}>
      <button
        type="button"
        className="acct-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {user.profileImage ? (
          // 카카오 CDN 이미지다. next/image를 쓰면 도메인 허용 목록을 들고 다녀야 해서 그냥 img로 건다
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.profileImage} alt="" width={26} height={26} referrerPolicy="no-referrer" />
        ) : (
          <i aria-hidden="true">{initial(user.nickname)}</i>
        )}
        <span>{name}</span>
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <Link href={ROUTES.my} role="menuitem">관심 공고</Link>
          <Link href={ROUTES.myAccount} role="menuitem">내 계정</Link>
          <form action={signOut}>
            <button type="submit" role="menuitem">로그아웃</button>
          </form>
        </div>
      )}
    </div>
  );
}
