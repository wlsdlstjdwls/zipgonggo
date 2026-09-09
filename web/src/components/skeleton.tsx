// 스켈레톤. design/README.md 상태 화면: 목록 행 골격 3개(D-day 56×52 · 제목 70% · 메타 150px · 금액 96px), 시머 1.5s.
// 높이는 실제 NoticeRow와 맞춰 레이아웃 시프트를 만들지 않는다.
import type { CSSProperties } from "react";
import { SKELETON_ROW_COUNT } from "@/lib/constants";

export function Box({ w, h, r = 7, style }: { w?: string | number; h: number; r?: number; style?: CSSProperties }) {
  return <span className="sk" style={{ width: w ?? "100%", height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function SkeletonRow() {
  return (
    <div className="sk-row" aria-hidden="true">
      <Box w={56} h={52} r={14} />
      <span>
        <Box w={150} h={10} />
        <Box w="70%" h={15} style={{ marginTop: 9 }} />
        <Box w={130} h={10} style={{ marginTop: 11 }} />
      </span>
      <span>
        <Box w={96} h={18} style={{ marginLeft: "auto" }} />
        <Box w={52} h={10} style={{ margin: "8px 0 0 auto" }} />
      </span>
    </div>
  );
}

/** 행 N개. 목록 꼬리(더 불러오는 중)와 스트리밍 폴백이 같이 쓴다. */
export function SkeletonRows({ count = SKELETON_ROW_COUNT, boxed }: { count?: number; boxed?: boolean }) {
  const rows = Array.from({ length: count }, (_, i) => <SkeletonRow key={i} />);
  return boxed ? <div className="sk-box" aria-busy="true" aria-label="공고를 불러오는 중">{rows}</div> : <div aria-busy="true" aria-label="공고를 불러오는 중">{rows}</div>;
}

/** 상세 골격: 브레드크럼 + 좌 본문(태그·제목·점보·일정 카드·표) + 우 패널 */
export function SkeletonDetail() {
  return (
    <article aria-busy="true" aria-label="공고를 불러오는 중">
      <div className="crumb"><Box w={64} h={30} r={9} /><Box w={220} h={12} /></div>
      <div className="detail">
        <div className="detail-main">
          <div className="d-head">
            <div className="d-tags"><Box w={72} h={28} r={9} /><Box w={90} h={28} r={9} /><Box w={120} h={28} r={9} /></div>
            <Box w="78%" h={34} style={{ marginBottom: 10 }} />
            <Box w="46%" h={34} style={{ marginBottom: 24 }} />
            <Box w={60} h={10} style={{ marginBottom: 12 }} />
            <Box w={260} h={52} />
          </div>
          <div className="dsec">
            <Box w={80} h={10} style={{ marginBottom: 16 }} />
            <div className="steps">{[0, 1, 2, 3].map((i) => <Box key={i} h={70} r={14} />)}</div>
          </div>
          <div className="dsec">
            <Box w={100} h={10} style={{ marginBottom: 14 }} />
            <Box h={132} r={14} />
          </div>
        </div>
        <aside className="aside">
          <div className="aside-in">
            <Box h={118} r={16} />
            <Box h={48} r={13} />
            <Box h={48} r={13} />
            <Box h={230} r={16} />
          </div>
        </aside>
      </div>
    </article>
  );
}

/** 약관·방침 골격: 좁은 본문 한 단. 이동 즉시 뼈대를 깔아 "아무것도 안 나온다"를 막는다(사용자 지적 2026-09-09) */
export function SkeletonLegal() {
  return (
    <article className="legal" aria-busy="true" aria-label="문서를 불러오는 중">
      <div className="crumb"><Box w={64} h={30} r={9} /></div>
      <div className="legal-in">
        <Box w={180} h={30} />
        <Box w={220} h={11} style={{ marginTop: 12 }} />
        <div className="legal-body">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Box w={150} h={14} style={{ marginBottom: 12 }} />
              <Box h={11} style={{ marginBottom: 8 }} />
              <Box h={11} style={{ marginBottom: 8 }} />
              <Box w="72%" h={11} />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
