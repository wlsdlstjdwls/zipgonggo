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
