// 상세 화면(공고·단지) 공용 우측 사이드바 — D-day 카드 + CTA + 제원 패널. design/README.md "우측 스티키 패널".
import type { ReactNode } from "react";

type SpecRow = { label: string; value: ReactNode };

type Props = {
  tone: "hot" | "warn" | "soft" | "acc";
  ddayLabel: string;
  ddayNum: string;
  ddayNote: string;
  /** 버튼류 — 페이지마다 CTA 구성이 다르다(원문 링크, 포털, 저장, 지도로 이동 등) */
  cta: ReactNode;
  rows: SpecRow[];
  updatedNote: string;
  /** 단지 상세의 "이 페이지는 지도 앵커입니다" 같은 안내 한 줄 */
  footNote?: ReactNode;
};

export function DetailAside({ tone, ddayLabel, ddayNum, ddayNote, cta, rows, updatedNote, footNote }: Props) {
  return (
    <aside className="aside">
      <div className="aside-in">
        <div className={`dcard tone-${tone}`}>
          <span>{ddayLabel}</span>
          <b>{ddayNum}</b>
          <p>{ddayNote}</p>
        </div>
        {cta}
        <div className="specs">
          <span className="t">공고 제원</span>
          {rows.map((r) => (
            <div className="r" key={r.label}>
              <span>{r.label}</span>
              <b>{r.value ?? "—"}</b>
            </div>
          ))}
          <span className="u">{updatedNote}</span>
        </div>
        {footNote && <p className="note" style={{ margin: "12px 0 0" }}>{footNote}</p>}
      </div>
    </aside>
  );
}
