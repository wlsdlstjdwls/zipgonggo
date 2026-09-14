"use client";

// 행복주택 신청자격의 계층 탭 — 대학생 | 청년 | 신혼부부 | 고령자 | 주거급여수급자 중 하나만 편다.
// 다섯 계층을 다 펼치면 표 열다섯 장이 이어져 읽을 수 없었다(사용자 지적 2026-09-14: "나열식이라 보기 힘들다").
// 탭 본문은 서버가 미리 그린 노드를 받는다 — 여기서는 어느 것을 보일지만 정한다. 크롤러는 hidden 본문도 읽는다.
import { useState, type ReactNode } from "react";

type Props = { tabs: { key: string; label: string; body: ReactNode }[] };

export function ClassTabs({ tabs }: Props) {
  const [on, setOn] = useState(0);
  if (tabs.length === 0) return null;
  return (
    <div className="ctabs">
      <div className="ctabs-bar" role="tablist" aria-label="계층">
        {tabs.map((t, i) => (
          <button key={t.key} type="button" role="tab" aria-selected={i === on} className={`chip-f${i === on ? " on" : ""}`} onClick={() => setOn(i)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.key} role="tabpanel" hidden={i !== on} className="ctabs-panel">
          {t.body}
        </div>
      ))}
    </div>
  );
}
