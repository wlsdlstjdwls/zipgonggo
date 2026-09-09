"use client";

// 목록 위 얇은 바 — 정렬과 보기 전환만. 조건(부문·지역·유형·접수)은 왼쪽 필터 레일로 옮겼다(사용자 요청 2026-09-09):
// 칩이 늘수록 위 바가 두 줄로 넘쳐 목록이 밀렸다. 여기 남은 둘은 "무엇을 보느냐"가 아니라 "어떻게 보느냐"다.
import { NOTICE_VIEWS, type NoticeView } from "@/types/notice";
import { useListState } from "./list-state";

const VIEW_LABEL: Record<NoticeView, string> = { card: "카드", list: "목록", compact: "간략" };

export function FilterBar({ sticky }: { sticky?: boolean }) {
  const { f, set, view, setView } = useListState();

  return (
    <div className={`fbar${sticky ? " sticky" : ""}`}>
      <nav className="seg" data-on={f.sort ?? "posted"} aria-label="정렬">
        <span className="seg-ind" aria-hidden="true" />
        <button type="button" onClick={() => set({ sort: "deadline" })} className={f.sort === "deadline" ? "on" : ""} aria-pressed={f.sort === "deadline"}>마감 임박순</button>
        <button type="button" onClick={() => set({ sort: "posted" })} className={f.sort !== "deadline" ? "on" : ""} aria-pressed={f.sort !== "deadline"}>최신 공고순</button>
      </nav>

      {/* 보기 전환 — 카드/목록/간략. 조회는 그대로고 그리기만 바뀐다(사용자 요청 2026-09-09) */}
      <div className="viewsw grow" role="group" aria-label="목록 보기">
        {NOTICE_VIEWS.map((v) => (
          <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
