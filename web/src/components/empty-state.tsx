// 빈 상태 — 점선 박스 + 아이콘 자리 + 제목·설명 + 「필터 초기화」(목록 화면 + 필터 전부 해제).
import Link from "next/link";
import { homePath } from "@/lib/routes";
import type { HomeView } from "@/types/notice";

export function EmptyState({ title = "조건에 맞는 공고가 없습니다", lead, view }: { title?: string; lead: string; view: HomeView }) {
  return (
    <div className="state-wrap">
      <div className="empty-box" role="status">
        <span className="ico" aria-hidden="true"><i /></span>
        <h2>{title}</h2>
        <p>{lead}</p>
        <Link href={homePath({ view })} className="btn ink">필터 초기화</Link>
      </div>
    </div>
  );
}
