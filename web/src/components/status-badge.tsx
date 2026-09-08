// 접수 상태 배지. 카드·상세 헤더·접수 일정 표가 같은 모양을 쓴다.
import type { DdayBadge } from "@/lib/format";

export function StatusBadge({ badge }: { badge: DdayBadge }) {
  return <span className={`badge ${badge.tone}`}>{badge.label}</span>;
}
