// 인라인 아이콘 — 라벨 없이 뜻이 서는 자리에만 쓴다(보기 전환처럼 글자를 지워도 모양으로 읽히는 것).
// 외부 아이콘 패키지를 들이지 않는다: 3개 때문에 번들을 늘릴 이유가 없고, 선 굵기를 브랜드에 맞춰야 한다.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...p }: P & { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
      {children}
    </svg>
  );
}

/** 카드 — 큰 칸 하나에 제목·본문 줄. 한 건을 넓게 본다 */
export function IconCard(p: P) {
  return (
    <Svg {...p}>
      <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="2.2" />
      <path d="M5 6.4h6M5 9.4h3.6" />
    </Svg>
  );
}

/** 목록 — 왼쪽 표식 + 두 줄. 한 줄에 한 건 */
export function IconList(p: P) {
  return (
    <Svg {...p}>
      <path d="M2.6 4.4h2.2M2.6 11.6h2.2" />
      <path d="M7.4 3.4h6M7.4 6.2h4M7.4 10.6h6M7.4 13.4h4" />
    </Svg>
  );
}

/** 간략 — 촘촘한 줄만. 많이 훑는다 */
export function IconCompact(p: P) {
  return (
    <Svg {...p}>
      <path d="M2.6 4h10.8M2.6 6.9h10.8M2.6 9.8h10.8M2.6 12.7h7.2" />
    </Svg>
  );
}

/** 계산기 — 헤더 메뉴의 상호전환/대출이자 버튼 */
export function IconCalc(p: P) {
  return (
    <Svg {...p}>
      <rect x="3.2" y="1.8" width="9.6" height="12.4" rx="2" />
      <path d="M5.6 4.8h4.8" />
      <path d="M6 8.2h.01M8 8.2h.01M10 8.2h.01M6 11.2h.01M8 11.2h.01M10 11.2h.01" strokeWidth="2.1" />
    </Svg>
  );
}

/** 기기 둘 — 휴대폰에서 담고 데스크탑에서 본다 */
export function IconDevices(p: P) {
  return (
    <Svg viewBox="0 0 24 24" width="24" height="24" strokeWidth="1.5" {...p}>
      <rect x="1.6" y="4" width="13.4" height="9.6" rx="1.6" />
      <path d="M5.4 17.2h5.6M8.2 13.6v3.6" />
      <rect x="16.4" y="8.6" width="6" height="11.4" rx="1.6" />
      <path d="M18.6 17.6h1.6" />
    </Svg>
  );
}

/** 별 — 관심 공고 담기(목록의 ★와 같은 뜻) */
export function IconStar(p: P) {
  return (
    <Svg viewBox="0 0 24 24" width="24" height="24" strokeWidth="1.5" {...p}>
      <path d="M12 3.4l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.92l-5.3 2.79 1.01-5.9L3.42 9.63l5.93-.86z" />
    </Svg>
  );
}

/** 달력 — 접수 마감과 신청 일정 */
export function IconCalendar(p: P) {
  return (
    <Svg viewBox="0 0 24 24" width="24" height="24" strokeWidth="1.5" {...p}>
      <rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.4" />
      <path d="M3.4 10h17.2M8.2 3.4v3.6M15.8 3.4v3.6" />
      <path d="M8 14.2h2.2M8 17.4h2.2M14 14.2h2.2" />
    </Svg>
  );
}

/** 방패 — 받아 가는 게 적다 */
export function IconShield(p: P) {
  return (
    <Svg viewBox="0 0 24 24" width="24" height="24" strokeWidth="1.5" {...p}>
      <path d="M12 2.8 4.6 5.8v6c0 4.4 3.1 8.1 7.4 9.4 4.3-1.3 7.4-5 7.4-9.4v-6z" />
      <path d="M8.9 12.1l2.2 2.2 4-4.3" />
    </Svg>
  );
}

/** 사진 — 카메라. 그림이 붙은 공고와 단지 배지에 쓴다(사용자 요청 2026-09-21: 글자만으로는 안 보인다) */
export function IconPhoto(p: P) {
  return (
    <Svg {...p}>
      <rect x="2.2" y="4.6" width="11.6" height="8.6" rx="2.2" />
      <path d="M6 4.6l0.9-1.8h2.2l0.9 1.8" />
      <circle cx="8" cy="8.9" r="2.4" />
    </Svg>
  );
}
