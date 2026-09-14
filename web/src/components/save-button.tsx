"use client";

// ★/☆ 저장 토글. 행 안(34×34)과 상세 패널(큰 버튼) 두 모양.
// 행 안에서는 링크 이동을 막아야 하므로 preventDefault + stopPropagation.
//
// 하이드레이션 함정(2026-09-14): SaveProvider는 layout에 있고 상세 페이지는 loading.tsx(Suspense) 안에 있다.
// layout이 먼저 하이드레이션돼 effect로 localStorage를 읽어 saved가 차면, 뒤늦게 스트리밍된 페이지 조각은
// ★ 상태로 하이드레이션돼 서버 HTML(☆)과 어긋난다. useSyncExternalStore의 서버 스냅샷(false)은 하이드레이션 중엔
// 항상 그 값을 쓰므로 첫 렌더가 서버와 같고, 끝나면 곧바로 진짜 값으로 다시 그린다.
import { useSyncExternalStore } from "react";
import { useSave } from "./save-context";

const subscribeNoop = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export function SaveButton({ id, variant = "icon" }: { id: number; variant?: "icon" | "panel" }) {
  const { isSaved, toggle, popped } = useSave();
  const hydrated = useHydrated();
  const on = hydrated && isSaved(id);
  const pop = hydrated && popped === id;
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
