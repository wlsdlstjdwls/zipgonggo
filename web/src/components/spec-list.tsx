// 라벨·값 정의 목록(<dl class="spec">). 값이 비면 행을 그리지 않는다.
// 상세 페이지 3곳이 쓰고, 단지·지역 페이지도 같은 표를 쓸 예정.
import type { CSSProperties, ReactNode } from "react";

export type SpecValue = ReactNode | null | undefined;

export function Spec({ label, value, wide }: { label: string; value: SpecValue; wide?: boolean }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SpecList({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <dl className="spec" style={style}>
      {children}
    </dl>
  );
}
