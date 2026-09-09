// 라벨·값 정의 목록(<dl class="spec">). 값이 비면 행을 그리지 않는다.
// 상세 페이지 3곳이 쓰고, 단지·지역 페이지도 같은 표를 쓸 예정.
//
// 라벨이 사전에 있는 말이면 스스로 용어 링크가 된다(사용자 지적 2026-09-09: "용어 설명에는 있는데 링크가 없다").
// 라벨을 줄여 쓴 자리(「현재 공가」→공가, 「예비자」→예비입주자)는 term으로 어느 말인지 알려 준다.
import type { CSSProperties, ReactNode } from "react";
import { Term, TermText } from "./glossary";

export type SpecValue = ReactNode | null | undefined;

export function Spec({ label, value, wide, term }: { label: string; value: SpecValue; wide?: boolean; term?: string }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{term ? <Term as={label}>{term}</Term> : <TermText>{label}</TermText>}</dt>
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
