"use client";

// 빈 상태 — 점선 박스 + 아이콘 자리 + 제목·설명 + 「필터 초기화」.
// 필터가 URL이 아니라 클라이언트 상태라 초기화도 이동이 아니라 콜백이다(2026-09-09).
export function EmptyState({ title = "조건에 맞는 공고가 없습니다", lead, onReset }: { title?: string; lead: string; onReset?: () => void }) {
  return (
    <div className="state-wrap">
      <div className="empty-box" role="status">
        <span className="ico" aria-hidden="true"><i /></span>
        <h2>{title}</h2>
        <p>{lead}</p>
        {onReset && <button type="button" className="btn ink" onClick={onReset}>필터 초기화</button>}
      </div>
    </div>
  );
}
