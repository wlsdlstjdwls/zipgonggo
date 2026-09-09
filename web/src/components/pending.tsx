// 「아직 못 읽은 값」 자리 — 빈 섹션을 그냥 감추면 사용자는 우리가 뭘 못 채웠는지 모른다(사용자 요청 2026-09-09).
// 404·빈 목록과 같은 점선 박스 톤을 쓰되, 「없음」이 아니라 「준비 중」이라고 말한다:
// 공고문에는 있는데 우리가 아직 못 읽은 값이라 원문에 가면 있다.
import type { ReactNode } from "react";

export function Pending({ title = "아직 준비 중입니다", lead, action }: { title?: string; lead: ReactNode; action?: ReactNode }) {
  return (
    <div className="pending" role="status">
      <span className="ico" aria-hidden="true"><i /></span>
      <div>
        <b>{title}</b>
        <p>{lead}</p>
      </div>
      {action}
    </div>
  );
}
