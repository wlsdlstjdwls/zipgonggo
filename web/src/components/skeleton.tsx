// 스켈레톤. fitin-app common_skeleton의 "일부만 출렁이게" 원칙을 가져왔다 —
// 카드 6장 중 격번으로만 shimmer를 주고 나머지는 정적 블록. 전부 출렁이면 거부감이 크다.
// 높이는 실제 NoticeCard와 맞춰 레이아웃 시프트를 만들지 않는다 (globals.css .sk-card 참조).
import type { CSSProperties } from "react";
import { SKELETON_CARD_COUNT, SKELETON_DELAY_STEP_SEC } from "@/lib/constants";

export function Box({ w, h, r = 8, shimmer = true, style }: { w?: string | number; h: number; r?: number; shimmer?: boolean; style?: CSSProperties }) {
  return <span className={`sk${shimmer ? "" : " static"}`} style={{ width: w ?? "100%", height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function SkeletonCard({ shimmer = true, delay = 0 }: { shimmer?: boolean; delay?: number }) {
  const s = { animationDelay: `${delay}s` } as CSSProperties;
  return (
    <li className="card sk-card" aria-hidden="true">
      <div className="card-hero sk-hero">
        <div className="card-hero-top">
          <Box w={84} h={22} r={999} shimmer={shimmer} style={s} />
          <Box w={44} h={22} r={999} shimmer={false} />
        </div>
        <Box w="55%" h={26} r={6} shimmer={shimmer} style={{ marginTop: 12, ...s }} />
        <Box w="70%" h={12} r={4} shimmer={false} style={{ marginTop: 8 }} />
      </div>
      <div className="card-body">
        <div className="card-chips">
          <Box w={36} h={22} r={999} shimmer={false} />
          <Box w={88} h={22} r={999} shimmer={shimmer} style={s} />
          <Box w={92} h={22} r={999} shimmer={false} />
        </div>
        <Box h={16} r={4} shimmer={shimmer} style={s} />
        <Box w="72%" h={16} r={4} shimmer={false} />
        <div className="card-actions">
          <Box h={40} r={14} shimmer={false} />
          <Box h={40} r={14} shimmer={false} />
        </div>
      </div>
    </li>
  );
}

/** 카드 N장. 격번 shimmer, 두 장씩 같은 지연. <ul> 안에서 쓴다 (NoticeFeed 로딩 꼬리·SkeletonGrid). */
export function SkeletonCards({ count = SKELETON_CARD_COUNT, keyPrefix = "sk" }: { count?: number; keyPrefix?: string }) {
  return Array.from({ length: count }, (_, i) => (
    <SkeletonCard key={`${keyPrefix}-${i}`} shimmer={i % 2 === 0} delay={(i >> 1) * SKELETON_DELAY_STEP_SEC} />
  ));
}

export function SkeletonGrid({ count = SKELETON_CARD_COUNT }: { count?: number }) {
  return (
    <ul className="card-grid" aria-busy="true" aria-label="공고를 불러오는 중">
      <SkeletonCards count={count} />
    </ul>
  );
}

/** 상세 페이지 골격: 헤더 밴드 + 섹션 3개 */
export function SkeletonDetail() {
  return (
    <article aria-busy="true" aria-label="공고를 불러오는 중">
      <div className="detail-head sk-hero">
        <div className="card-top">
          <Box w={56} h={22} r={999} />
          <Box w={90} h={22} r={999} shimmer={false} />
          <Box w={64} h={22} r={999} shimmer={false} />
        </div>
        <Box w="80%" h={26} r={6} style={{ marginTop: 12 }} />
        <Box w="45%" h={26} r={6} shimmer={false} style={{ marginTop: 8 }} />
        <div className="sk-grid" style={{ marginTop: 14 }}>
          {Array.from({ length: 6 }, (_, i) => <Box key={i} h={16} r={4} shimmer={i % 3 === 0} />)}
        </div>
        <div className="btn-row">
          <Box w={200} h={42} r={14} shimmer={false} />
          <Box w={120} h={42} r={14} shimmer={false} />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <section className="section" key={i}>
          <Box w={110} h={18} r={4} shimmer={i === 0} style={{ marginBottom: 12 }} />
          <div className="sk-grid">
            {Array.from({ length: 4 }, (_, j) => <Box key={j} h={16} r={4} shimmer={(i + j) % 4 === 0} />)}
          </div>
        </section>
      ))}
    </article>
  );
}
