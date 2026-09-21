"use client";

// 정책 문서(약관·방침) 머리의 뒤로 가기.
//
// 예전엔 **무조건 홈으로 가는 링크**였다 — 로그인 화면에서 약관을 열고 뒤로 눌렀는데 목록으로
// 떨어졌다(사용자 제보 2026-09-21). 읽던 자리로 돌아가는 게 당연하다.
//
// 온 길이 있으면 history.back(), 없으면(검색에서 바로 들어왔거나 새 탭) 홈으로 보낸다.
// **글자도 같이 바꾼다** — 홈으로 가면서 「뒤로」라고 적으면 그것도 거짓말이다.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ROUTES } from "@/lib/routes";

export function BackLink() {
  const router = useRouter();
  // 서버 HTML은 언제나 「목록」이다. 히스토리는 브라우저만 아는 사실이라 마운트 뒤에 갈아끼운다
  const [canBack, setCanBack] = useState(false);

  useEffect(() => {
    // 같은 사이트 안에서 넘어온 경우에만 뒤로가 뜻이 선다 —
    // 다른 사이트에서 들어왔는데 back()을 부르면 우리 사이트를 떠나 버린다.
    //
    // **document.referrer로는 못 가린다**(2026-09-21 실측): 앱 안에서 Link로 옮겨 다니면
    // referrer가 처음 들어온 값 그대로 멈춰 있어, 로그인 화면에서 약관으로 넘어와도 「온 길 없음」으로 읽혔다.
    // Navigation API의 canGoBack은 **같은 오리진 히스토리**만 세므로 바로 이 판정에 맞는다.
    // 없는 브라우저(사파리 등)는 referrer로 물러선다 — 틀려도 「목록」으로 가는 쪽이라 안전하다
    try {
      const nav = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
      if (typeof nav?.canGoBack === "boolean") {
        setCanBack(nav.canGoBack);
        return;
      }
      const from = document.referrer;
      setCanBack(window.history.length > 1 && !!from && new URL(from).origin === window.location.origin);
    } catch {
      setCanBack(false);
    }
  }, []);

  if (!canBack) {
    return (
      <Link href={ROUTES.home} className="back">
        ← 목록
      </Link>
    );
  }
  return (
    <button type="button" className="back" onClick={() => router.back()}>
      ← 뒤로
    </button>
  );
}
