"use client";

// ★/☆ 저장 토글. 행 안(34×34)과 상세 패널(큰 버튼) 두 모양.
// 행 안에서는 링크 이동을 막아야 하므로 preventDefault + stopPropagation.
import { useSave } from "./save-context";

export function SaveButton({ id, variant = "icon" }: { id: number; variant?: "icon" | "panel" }) {
  const { isSaved, toggle, popped } = useSave();
  const on = isSaved(id);
  const pop = popped === id;
  const onClick = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); toggle(id); };
  if (variant === "panel") {
    return (
      <button type="button" className={`btn lg${on ? " saved" : ""}${pop ? " pop" : ""}`} onClick={onClick} aria-pressed={on}>
        {on ? "★" : "☆"} {on ? "저장한 공고" : "공고 저장"}
      </button>
    );
  }
  return (
    <button type="button" className={`save${on ? " on" : ""}${pop ? " pop" : ""}`} onClick={onClick} aria-pressed={on} aria-label={on ? "저장 해제" : "저장"}>
      {on ? "★" : "☆"}
    </button>
  );
}
