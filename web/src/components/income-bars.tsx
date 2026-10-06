"use client";

// 가구원수별 월평균소득 기준 — 표 대신 막대(사용자 요청 2026-10-06: 「소득기준 보여주는 표도 가시성」).
//
// 표는 가구원수 8열 × 비율 3~6행이라 내 가구 한 열을 찾아 내려 읽어야 했다. 여기서는 가구원수를 먼저 고르고
// 그 가구의 비율별 한도를 막대 길이로 견준다 — 「70%면 얼마, 100%면 얼마」가 한눈에 길이로 보인다.
// 막대 옆에 금액 글자를 그대로 둔다(정확한 원 단위는 title).
//
// 가구원수 패널은 서버에서 전부 그리고 고른 것만 보인다 — 크롤러는 hidden 패널도 읽어 표가 하던 일(전 수치 노출)을 잇는다.
// 기본 선택은 저장해 둔 내 조건의 가구원수, 없으면 1인. 프로필은 읽기만 한다.
import { useEffect, useState } from "react";
import { wonExact, wonKo } from "@/lib/format";
import { useProfile } from "./profile-context";

export type IncomeBarRow = {
  pct: number;
  /** 이 비율이 쓰이는 조건(「맞벌이」 등). 없으면 비율만 */
  note?: string | null;
  /** households와 같은 순서의 월 금액 */
  won: (number | null)[];
};

type Props = { households: number[]; rows: IncomeBarRow[] };

export function IncomeBars({ households, rows }: Props) {
  const { profile, saved, ready } = useProfile();
  const [on, setOn] = useState(0);
  // 저장해 둔 가구원수가 있으면 그 탭으로 연다 — 한 번만(그 뒤로는 사람이 고른 걸 존중한다)
  useEffect(() => {
    if (!ready || !saved) return;
    const i = households.indexOf(profile.household);
    if (i >= 0) setOn(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, saved]);

  if (households.length === 0 || rows.length === 0) return null;
  // 막대 길이의 100%는 **표 전체**에서 가장 큰 한도 — 가구 탭을 바꾸면 막대가 같이 자라 「식구가 늘면 한도도 는다」가 보인다.
  // 가구 안에서만 견주면 비율이 하나뿐인 공고(70%만)에서 막대가 늘 꽉 차 아무 말도 안 했다
  const all = rows.flatMap((r) => r.won).filter((v): v is number => v != null);
  const max = all.length ? Math.max(...all) : 0;
  return (
    <div className="ibars">
      <div className="ibars-tabs" role="tablist" aria-label="가구원수">
        {households.map((h, i) => (
          <button key={h} type="button" role="tab" aria-selected={i === on} className={`chip-f${i === on ? " on" : ""}`} onClick={() => setOn(i)}>
            {h}인
          </button>
        ))}
      </div>
      {households.map((h, i) => {
        return (
          <div key={h} role="tabpanel" hidden={i !== on} className="ibars-panel" aria-label={`${h}인 가구`}>
            <ul className="ibars-list">
              {rows.map((r) => {
                const v = r.won[i];
                const w = v != null && max > 0 ? Math.max(4, Math.round((v / max) * 100)) : 0;
                return (
                  <li key={`${r.pct}|${r.note ?? ""}`}>
                    <span className="ibars-k">
                      <b>{r.pct}%</b>
                      {r.note && <small>{r.note}</small>}
                    </span>
                    <span className="ibars-track" aria-hidden="true">
                      <i style={{ width: `${w}%` }} />
                    </span>
                    <span className="ibars-v" title={v != null ? wonExact(v) : undefined}>
                      {v != null ? `월 ${wonKo(v)}` : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
