"use client";

// 방문 한 줄을 서버로 보낸다. 화면에는 아무것도 안 그린다.
//
// 봇 거르기 셋째 겹이 여기 있다 — navigator.webdriver인 자동화 브라우저는 안 쏜다.
// 첫째 겹은 구조(스크립트를 안 도는 크롤러는 애초에 안 들어온다), 둘째 겹은 라우트의 UA 확인.
//
// 식별자는 **브라우저가 만든 난수 UUID**다. 서버가 심는 게 아니라서 사이트 데이터를 지우면
// 다음 방문은 남남이 된다. 이름·이메일·IP 같은 건 보내지 않는다(개인정보처리방침 2항).
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import { VISITOR_STORAGE_KEY, VISIT_OPT_OUT_KEY } from "@/lib/constants";

/** 같은 경로를 이 시간 안에 다시 쏘지 않는다. 되돌아가기·개발 모드의 두 번 렌더를 흡수한다 */
const DEDUPE_MS = 30_000;
const sentAt = new Map<string, number>();

/** 이 페이지를 연 뒤 첫 조회인가. 클라이언트 라우팅으로 옮겨 다니면 referrer가 안 바뀐다 —
 *  첫 조회에만 유입 출처를 실어야 출처 집계가 부풀지 않는다 */
let firstView = true;

function visitorId(): string | null {
  try {
    let id = localStorage.getItem(VISITOR_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_STORAGE_KEY, id);
    }
    return id;
  } catch {
    // 사생활 보호 모드 등 저장이 막힌 브라우저. 집계를 포기한다(쿠키로 우회하지 않는다)
    return null;
  }
}

function optedOut(): boolean {
  try {
    // 운영자가 제 사이트를 돌아다닌 것은 통계가 아니다. 관리자 콘솔에 들어오면 이 표식이 켜진다
    return localStorage.getItem(VISIT_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith(ROUTES.admin)) return;
    // 자동화 브라우저(크롤러 도구·테스트 러너)는 세지 않는다
    if (navigator.webdriver) return;
    if (optedOut()) return;

    const id = visitorId();
    if (!id) return;

    const now = Date.now();
    const last = sentAt.get(pathname);
    if (last && now - last < DEDUPE_MS) return;
    sentAt.set(pathname, now);

    const entry = firstView;
    firstView = false;

    let referrerHost: string | null = null;
    if (entry && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname.toLowerCase();
        // 우리 사이트 안에서 온 것은 유입이 아니다
        if (host !== location.hostname) referrerHost = host;
      } catch {
        referrerHost = null;
      }
    }

    // 링크에 직접 붙인 표식. **카카오톡과 인스타그램 인앱 브라우저는 referrer를 안 보내서**
    // 이것이 없으면 SNS에서 온 사람이 전부 「직접 유입」으로 뭉친다.
    // 서버는 아는 값만 도메인으로 바꿔 적고 나머지는 버린다(lib/analytics.ts UTM_HOST).
    let utm: string | null = null;
    if (entry) {
      try {
        utm = new URLSearchParams(location.search).get("utm_source");
      } catch {
        utm = null;
      }
    }

    const payload = JSON.stringify({ visitorId: id, path: pathname, referrerHost, entry, utm });
    try {
      // sendBeacon은 페이지를 떠나도 끝까지 간다. 막혀 있으면 keepalive fetch로 물러선다
      const sent = navigator.sendBeacon?.(ROUTES.apiTrack, new Blob([payload], { type: "application/json" }));
      if (!sent) void fetch(ROUTES.apiTrack, { method: "POST", body: payload, keepalive: true });
    } catch {
      // 집계 실패는 화면에 아무 영향이 없어야 한다
    }
  }, [pathname]);

  return null;
}
