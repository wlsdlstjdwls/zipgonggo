"use client";

// 단지 상세 「보증금과 임대료」 — 보증금과 월임대료를 서로 바꿔 보는 슬라이더(사용자 결정 2026-09-22).
//
// 전에는 최대/기본/최소 세 줄짜리 표(ConvertTable)였다. "상호전환으로 조절할 수 있고 화면에 다 있는데
// 보기가 힘들다 — 바로 왼쪽 오른쪽 움직이면 오른쪽이 최대 보증금, 왼쪽일수록 최소 보증금"이 그대로 이 모양이 됐다.
//
// 지면을 먹지 않게 깎은 자리(사용자 지적 2026-09-22: "디자인적으로 너무 많은 영역을 차지하네"):
//  - 양 끝 금액을 카드 두 장으로 세웠다가 트랙 밑 두 줄짜리 글자로 내렸다. 눌러서 그 끝으로 가는 건 그대로다.
//  - 「목돈 적게 / 월세 적게」 같은 설명 라벨, 「기준으로」 버튼, 전환 비율·이율 배지는 전부 뺐다.
//  - 기준 위치는 글자 대신 가운데 눈금 색과 채움이 뻗어 나가는 방향으로만 말한다.
//
// 한 칸(ConvertGroup)이 공급대상 하나 또는 금액이 같은 호실 한 묶음이다. 칸이 여럿이면 탭으로 가르고,
// 탭이 줄바꿈될 만큼 많으면(엘클루 170호 = 금액 조합 69개) 셀렉트로 바꾼다 — UnitTable이 같은 문제에 낸 답과 같다.

import { useId, useMemo, useState } from "react";
import { wonExact, wonKo } from "@/lib/format";
import type { ConvertGroup } from "@/lib/notice-view";
import { Select, type SelectOption } from "./select";

/** 한쪽을 몇 칸으로 나눌지. 공고가 비율 단위로만 전환을 허용하므로 연속으로 두지 않는다 */
const NOTCH = 10;
/** 이 수를 넘으면 탭 대신 셀렉트 */
const TAB_MAX = 6;

/**
 * 연이율(%). 두 끝이 직선을 정의하므로 공고문 숫자에서 그대로 나온다 — calc.ts 상수를 다시 쓰지 않는다.
 * 실측(해가온 0203호): 공고문 세 점에서 역산하면 연 6.7%라 calc.ts 기본값 6.0%와 다르다.
 * 끝의 `* 100`을 빠뜨리면 이율이 100배 작아져 보증금만 오르고 월임대료가 안 내려간다.
 */
function rateOf(g: ConvertGroup, up: boolean): number {
  const [bd, br] = g.base;
  if (up) return g.max[0] === bd ? 0 : (((br - g.max[1]) * 12) / (g.max[0] - bd)) * 100;
  return bd === g.min[0] ? 0 : (((g.min[1] - br) * 12) / (bd - g.min[0])) * 100;
}

/**
 * 칸 인덱스(-NOTCH…0…+NOTCH) → 그 칸의 보증금과 월임대료.
 * 보증금은 만 원 단위로 떨어뜨리고, 월임대료는 그 보증금에서 이율로 되계산한다.
 * 양 끝은 공고문 숫자 그대로 떨어진다 — 세 점이 다 만 원 단위라 반올림이 끝을 흔들지 않는다.
 */
function at(g: ConvertGroup, i: number): { deposit: number; rent: number } {
  const [bd, br] = g.base;
  if (i === 0) return { deposit: bd, rent: br };
  const end = i > 0 ? g.max : g.min;
  const t = Math.abs(i) / NOTCH;
  const deposit = Math.round((bd + (end[0] - bd) * t) / 10_000) * 10_000;
  const moved = (Math.abs(deposit - bd) * rateOf(g, i > 0)) / 100 / 12;
  // 공고문은 월임대료를 100원 단위로 절사한다 — 별표1 예시(535,167 → 535,100)
  return { deposit, rent: Math.max(0, Math.floor((i > 0 ? br - moved : br + moved) / 100) * 100) };
}

/** 셀렉트 한 줄에 들어가는 이름. 탭은 이름과 보조 글자를 굵기로 가르지만 셀렉트는 한 줄이라 막대로 가른다 */
const groupName = (g: ConvertGroup) => [g.label, g.note].filter(Boolean).join(" | ");

export function ConvertSlider({ groups }: { groups: ConvertGroup[] }) {
  const id = useId();
  const [gid, setGid] = useState(groups[0]?.id ?? "");
  const [idx, setIdx] = useState(0);

  const g = groups.find((x) => x.id === gid) ?? groups[0];
  const options = useMemo<SelectOption[]>(() => groups.map((x) => ({ value: x.id, label: groupName(x) })), [groups]);

  if (!g) return null;

  const v = at(g, idx);
  // 기준에서 얼마나 밀었는지만 색으로 남긴다. 양쪽이 같은 색이다 —
  // 방향은 손잡이 자리와 양 끝 글자가 이미 말한다. 색을 갈라 두면 한쪽이 「경고」로 읽힌다
  const p = ((idx + NOTCH) / (NOTCH * 2)) * 100;
  const pick = (next: number) => setIdx(idx === next ? 0 : next);
  const choose = (next: string) => { setGid(next); setIdx(0); };

  return (
    <div className="cslide">
      {groups.length > 1 && (groups.length > TAB_MAX ? (
        <div className="cs-pick">
          <Select
            value={g.id}
            options={options}
            onChange={choose}
            placeholder={groupName(g)}
            ariaLabel="금액을 볼 호실"
            allowAll={false}
          />
        </div>
      ) : (
        <div className="cs-tabs" role="group" aria-label="공급대상">
          {groups.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === g.id} onClick={() => choose(x.id)}>
              {x.label}
              {x.note && <em>{x.note}</em>}
            </button>
          ))}
        </div>
      ))}

      <div className="cs-now" role="status" aria-live="polite">
        <span className="col">
          <span className="cap">보증금</span>
          <b className="v" title={wonExact(v.deposit)}>{wonKo(v.deposit)}</b>
        </span>
        <span className="col r">
          <span className="cap">월임대료</span>
          <b className="v" title={wonExact(v.rent)}>월 {wonKo(v.rent)}</b>
        </span>
      </div>

      <div className="cs-track">
        <div className="cs-ticks" aria-hidden="true">
          {Array.from({ length: NOTCH * 2 + 1 }, (_, k) => (
            <i key={k} className={k === NOTCH ? "mid" : undefined} style={{ left: `${(k / (NOTCH * 2)) * 100}%` }} />
          ))}
        </div>
        <div className="cs-rail">
          <span className="cs-fill" aria-hidden="true" style={{ left: `${Math.min(50, p)}%`, width: `${Math.abs(p - 50)}%`, opacity: idx === 0 ? 0 : 0.9 }} />
          <input
            id={`${id}-rng`}
            type="range"
            min={-NOTCH}
            max={NOTCH}
            step={1}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            aria-label="보증금과 월임대료 전환"
            aria-valuetext={`보증금 ${wonKo(v.deposit)}, 월임대료 ${wonKo(v.rent)}`}
          />
        </div>
        <div className="cs-ends">
          <button type="button" className="cs-end" aria-pressed={idx === -NOTCH} onClick={() => pick(-NOTCH)}>
            <span className="k">보증금 최소</span>
            <span className="n">{wonKo(g.min[0])}</span>
          </button>
          <button type="button" className="cs-end hi" aria-pressed={idx === NOTCH} onClick={() => pick(NOTCH)}>
            <span className="k">보증금 최대</span>
            <span className="n">{wonKo(g.max[0])}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
