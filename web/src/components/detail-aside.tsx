// 상세 화면(공고·단지) 공용 우측 사이드바 — D-day 카드 + CTA + 제원 패널. design/README.md "우측 스티키 패널".
import type { ReactNode } from "react";
import { DetailBar } from "./detail-bar";

/** lead는 이 패널이 말하는 첫 번째 값(대개 금액) — 크게 쓰고, 좁은 화면 하단 바에도 이 줄이 올라간다 */
type SpecRow = { label: string; value: ReactNode; lead?: boolean };

type Props = {
  tone: "hot" | "warn" | "soft" | "acc" | "soon";
  ddayLabel: string;
  ddayNum: string;
  ddayNote: string;
  /** D-day 카드 안 보조 한 줄 — "오늘 접수 시작"처럼 마감과 별개인 상태 */
  ddayExtra?: ReactNode;
  /** 버튼류 — 페이지마다 CTA 구성이 다르다(원문 링크, 포털, 저장, 지도로 이동 등) */
  cta: ReactNode;
  /** 좁은 화면 하단 고정 바에 세울 단 하나의 버튼. 넓은 화면에서는 안 그린다 */
  primary?: ReactNode;
  /** 하단 바에 올릴 값 두 개. 안 주면 lead로 찍은 제원 줄에서 가져온다 —
      단지 상세처럼 금액을 위쪽 요약 스트립이 이미 세고 있는 지면은 제원을 늘리지 않고 이 값만 따로 준다 */
  brief?: SpecRow[];
  rows: SpecRow[];
  /** 제원 패널 밑에 붙는 두 번째 패널. 공고 상세의 「공고 정보」가 여기로 왔다(사용자 요청 2026-09-22) —
      본문 칸에서 격자 한 판을 차지하던 값들인데, 읽고 넘기는 값이지 본문이 아니다 */
  extra?: ReactNode;
  /** 단지 상세의 "이 페이지는 지도 앵커입니다" 같은 안내 한 줄 */
  footNote?: ReactNode;
};

/** 오른쪽 패널의 라벨·값 묶음. 「공고 제원」과 「공고 정보」가 같은 모양을 쓴다 */
export function AsideSpecs({ title, rows }: { title: string; rows: SpecRow[] }) {
  return (
    <div className="specs">
      <span className="t">{title}</span>
      {rows.map((r) => (
        <div className={`r${r.value == null ? " empty" : ""}${r.lead ? " lead" : ""}`} key={r.label}>
          <span>{r.label}</span>
          {/* 빈칸 대신 「준비 중」— 왜 비었는지 말해 주지 않는 대시는 「없다」로 읽힌다(docs/handoff.md 표기 규칙) */}
          <b>{r.value ?? "준비 중"}</b>
        </div>
      ))}
    </div>
  );
}

export function DetailAside({ tone, ddayLabel, ddayNum, ddayNote, ddayExtra, cta, primary, brief, rows, extra, footNote }: Props) {
  // 하단 바에 세울 요약 — lead로 찍은 줄(금액과 보증금)이다. 값이 없는 줄은 바에 올릴 게 못 된다
  const bar = (brief ?? rows.filter((r) => r.lead)).filter((r) => r.value != null).slice(0, 2);
  return (
    <>
      <aside className="aside">
        <div className="aside-in">
          <div className={`dcard tone-${tone}`}>
            <span>{ddayLabel}</span>
            <b>{ddayNum}</b>
            <p>{ddayNote}</p>
            {ddayExtra && <em className="dcard-x">{ddayExtra}</em>}
          </div>
          {cta}
          <AsideSpecs title="공고 제원" rows={rows} />
          {extra}
          {footNote && <p className="note" style={{ margin: "12px 0 0" }}>{footNote}</p>}
        </div>
      </aside>
      {/* 좁은 화면에서 이 패널은 본문 **아래**로 내려간다 — 4,150px짜리 지면의 2,806px 지점이라
          결정에 필요한 값(마감·금액)과 원문으로 가는 문이 사실상 안 보였다(2026-09-21 실측).
          지면을 뒤집는 대신 같은 값을 손 닿는 자리에 상시로 띄운다. 넓은 화면에서는 CSS가 감춘다 */}
      {primary && <DetailBar tone={tone} ddayNum={ddayNum} ddayLabel={ddayLabel} brief={bar} action={primary} />}
    </>
  );
}
