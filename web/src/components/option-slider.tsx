"use client";

// 민간임대(청년안심주택) 「보증금과 임대료」 — 공고문의 보증금 비율 옵션(40% | 45% | 50% …)을 칸으로 멈추는 슬라이더.
//
// 전에는 비율별 표(DepositOptionsTable)였다. SH 단지의 ConvertSlider는 세 점 사이를 이율로 메워 연속으로 움직이는데,
// 민간임대는 공고가 비율마다 금액을 직접 적고 그 비율 말고는 고를 수 없다. 그래서 칸은 공고에 나온 비율뿐이고,
// 어느 칸에 서든 숫자는 공고문 그대로다 — 사이 값을 지어내지 않는다(사용자 요청 2026-10-08: "표가 아니라 스와이프 막대로").
// 생김새와 CSS는 ConvertSlider(.cslide / .cs-*)를 같이 쓴다.

import { useId, useMemo, useState } from "react";
import { wonExact, wonKo } from "@/lib/format";
import { optionGroups, type OptionGroup } from "@/lib/notice-view";
import type { NoticeSupply } from "@/types/notice";
import { Select, type SelectOption } from "./select";

/** 이 수를 넘으면 탭 대신 셀렉트 — ConvertSlider와 같은 기준 */
const TAB_MAX = 6;

const groupName = (g: OptionGroup) => [g.label, g.note].filter(Boolean).join(" | ");

export function OptionSlider({ supply, hasClass }: { supply: NoticeSupply[]; hasClass: boolean }) {
  const id = useId();
  const groups = useMemo(() => optionGroups(supply, hasClass), [supply, hasClass]);
  const [gid, setGid] = useState(groups[0]?.id ?? "");
  // 탭을 바꿔도 같은 비율에 서 있게 라벨로 기억한다(45%를 보다가 다른 주택형으로 가면 그 형의 45%)
  const [pickLabel, setPickLabel] = useState<string | null>(null);
  const options = useMemo<SelectOption[]>(() => groups.map((x) => ({ value: x.id, label: groupName(x) })), [groups]);

  const g = groups.find((x) => x.id === gid) ?? groups[0];
  if (!g) return null;

  const last = g.opts.length - 1;
  const found = pickLabel == null ? -1 : g.opts.findIndex((o) => o.label === pickLabel);
  const idx = found < 0 ? 0 : found;
  const o = g.opts[idx];
  const p = last > 0 ? (idx / last) * 100 : 0;
  const set = (i: number) => setPickLabel(g.opts[i]?.label ?? null);

  return (
    <div className="cslide">
      {groups.length > 1 && (groups.length > TAB_MAX ? (
        <div className="cs-pick">
          <Select className="plain" value={g.id} options={options} onChange={setGid}
            placeholder={groupName(g)} ariaLabel="금액을 볼 주택형" allowAll={false} />
        </div>
      ) : (
        <div className="cs-tabs" role="group" aria-label="주택형">
          {groups.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === g.id} onClick={() => setGid(x.id)}>
              {x.label}
              {x.note && <em>{x.note}</em>}
            </button>
          ))}
        </div>
      ))}

      <div className="cs-now" role="status" aria-live="polite">
        <span className="col">
          <span className="cap">보증금 {o.label}</span>
          <b className="v" title={wonExact(o.deposit)}>{wonKo(o.deposit)}</b>
        </span>
        <span className="col r">
          <span className="cap">월임대료</span>
          <b className="v" title={o.rent != null ? wonExact(o.rent) : undefined}>{o.rent != null ? `월 ${wonKo(o.rent)}` : "미표기"}</b>
        </span>
      </div>

      <div className="cs-track">
        <div className="cs-ticks" aria-hidden="true">
          {g.opts.map((x, k) => (
            <i key={x.label} className={k === idx ? "mid" : undefined} style={{ left: `${last > 0 ? (k / last) * 100 : 0}%` }} />
          ))}
        </div>
        <div className="cs-rail">
          <span className="cs-fill" aria-hidden="true" style={{ left: 0, width: `${p}%`, opacity: idx === 0 ? 0 : 0.9 }} />
          <input
            id={`${id}-rng`}
            type="range"
            min={0}
            max={last}
            step={1}
            value={idx}
            onChange={(e) => set(Number(e.target.value))}
            aria-label="보증금 비율"
            aria-valuetext={`보증금 ${o.label} ${wonKo(o.deposit)}, 월임대료 ${o.rent != null ? wonKo(o.rent) : "미표기"}`}
          />
        </div>
        {/* 칸 이름은 눌러도 그 칸으로 간다. 양 끝은 안쪽으로 붙여 글자가 카드 밖으로 안 나가게 */}
        <div className="cs-stops">
          {g.opts.map((x, k) => (
            <button
              key={x.label}
              type="button"
              aria-pressed={k === idx}
              className={k === 0 ? "first" : k === last ? "last" : undefined}
              style={{ left: `${last > 0 ? (k / last) * 100 : 0}%` }}
              onClick={() => set(k)}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <p className="cs-rule">
        공고문이 정한 비율 중에서만 고를 수 있습니다. 계약 때 정하고, 계약 뒤에는 바꿀 수 없는 공고가 많습니다.
      </p>
    </div>
  );
}
