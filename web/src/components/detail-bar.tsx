"use client";

// 좁은 화면 하단 고정 바 — 상세의 결정값(마감 D-day와 금액)과 원문으로 가는 문을 상시로 띄운다.
// 넓은 화면에서는 오른쪽 스티키 패널이 같은 일을 하므로 CSS가 감춘다(.dbar, @media max-width 900px).
//
// **body로 포털하는 이유**: .shell에 container-type: inline-size가 걸려 있다. container-type은
// contain: layout을 함께 켜므로 그 안에서는 position: fixed가 화면이 아니라 .shell을 기준으로 잡힌다 —
// 포털 없이 두면 바가 화면 아래가 아니라 **문서 맨 밑**(y=3,784px)에 가라앉는다(2026-09-21 실측).
// 머리바(.dhb)가 같은 이유로 포털을 쓴다.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Brief = { label: string; value: ReactNode };

type Props = {
  tone: string;
  ddayNum: string;
  ddayLabel: string;
  brief: Brief[];
  action: ReactNode;
};

export function DetailBar({ tone, ddayNum, ddayLabel, brief, action }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // 바가 지면 끝을 가린다 — 바가 **있는 지면에서만** 푸터 밑을 그만큼 띄운다.
  // 미디어 쿼리만으로 처리하면 바가 없는 목록·검색 지면에도 빈 띠가 생긴다
  useEffect(() => {
    document.body.dataset.dbar = "1";
    return () => { delete document.body.dataset.dbar; };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="dbar" role="complementary" aria-label="이 지면 요약과 바로 가기">
      <div className="dbar-in">
        <span className={`dbar-d tone-${tone}`}>
          <b>{ddayNum}</b>
          <i>{ddayLabel}</i>
        </span>
        {brief.length > 0 && (
          <span className="dbar-v">
            {brief.map((r) => (
              <span key={r.label}>
                <i>{r.label}</i>
                <b>{r.value}</b>
              </span>
            ))}
          </span>
        )}
        <span className="dbar-a">{action}</span>
      </div>
    </div>,
    document.body,
  );
}
