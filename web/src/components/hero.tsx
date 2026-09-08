// 홈 히어로 밴드. 본문(page.tsx)과 스트리밍 폴백(loading.tsx)이 같은 문구·구조를 그린다.
// stats는 라벨 순서가 HERO_STAT_LABELS와 같아야 한다 — 폴백은 숫자 자리만 스켈레톤으로 바꾼다.
import type { ReactNode } from "react";
import { HERO_LEAD, HERO_STAT_LABELS, HERO_TITLE } from "@/lib/constants";

export function Hero({ stats, skeleton }: { stats: ReactNode[]; skeleton?: boolean }) {
  return (
    <div className={`hero${skeleton ? " sk-hero" : ""}`}>
      <h1>{HERO_TITLE}</h1>
      <p>{HERO_LEAD}</p>
      <div className="stat">
        {HERO_STAT_LABELS.map((label, i) => (
          <div key={label}>
            <span>{label}</span>
            {stats[i]}
          </div>
        ))}
      </div>
    </div>
  );
}
