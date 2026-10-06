"use client";

// 공고 상세 「신청자격」의 제도 일반 기준 카드(page.tsx가 시드 supply_type으로 만든다).
//
// 카드 모양은 서버가 정하고, 여기서는 **브라우저에 저장된 내 조건**으로 유형마다 판정을 얹는다(사용자 요청 2026-10-06).
// 판정은 /eligibility와 같은 diagnose()를 쓴다 — 기준을 두 벌 두지 않는다.
//
// - 저장분이 없으면(saved=false) 아무것도 얹지 않는다. 기본 프로필(30세 미혼 청년…)로 남의 판정을 매기면 거짓말이다
// - 서버 HTML은 언제나 판정 없는 카드다 — 하이드레이션이 어긋날 자리를 만들지 않고, 지면은 ISR 그대로다
// - 프로필은 여기서 읽기만 한다. 어디로도 보내지 않는다
// - 「확인 필요」는 엔진이 unsure로 돌려준 항목이다(세대주 여부, 부모 소득, 6세 이하 자녀, 거주지 미입력) — lib/eligibility
import { diagnose, type Check } from "@/lib/eligibility";
import { toElig } from "@/lib/profile";
import type { IncomeStandard, RegionTier, SupplyType } from "@/types/eligibility";
import { useProfile } from "./profile-context";

export type RuleLine = { label: string; text: string; off: boolean };
export type RuleCardView = {
  key: string;
  title: string;
  sub: string;
  right: string | null;
  lines: RuleLine[];
  note: string | null;
  /** 판정할 사양. 민간임대 카드처럼 한 제도를 측면별로 쪼갠 카드는 없다 — 판정을 안 단다 */
  type?: SupplyType;
};
export type RuleBlock = { cards: RuleCardView[]; align: boolean; anyNote: boolean; rows: number };

type State = "ok" | "check" | "no";
const STATE_TEXT: Record<State, string> = { ok: "지원 가능", check: "확인 필요", no: "지원 어려움" };

/** 화면 줄과 판정 항목을 잇는 칸 이름 — 「혼인기간」과 「혼인」은 한 칸이다 */
const slotOf = (label: string) => (label === "혼인기간" ? "혼인" : label);

type Judged = { state: State; byslot: Map<string, { check: Check; state: State }> };

function judge(t: SupplyType, income: IncomeStandard[], tiers: RegionTier[], p: ReturnType<typeof toElig>): Judged {
  const v = diagnose(t, p, { types: [t], income, tiers, incomeYear: 0 });
  const byslot = new Map<string, { check: Check; state: State }>();
  for (const c of v.checks) {
    const state: State = c.unsure ? "check" : c.ok ? "ok" : "no";
    byslot.set(slotOf(c.label), { check: c, state });
  }
  const states = [...byslot.values()].map((x) => x.state);
  const state: State = states.includes("no") ? "no" : states.includes("check") ? "check" : "ok";
  return { state, byslot };
}

export function EligRuleCards({ block, income, tiers }: { block: RuleBlock; income: IncomeStandard[]; tiers: RegionTier[] }) {
  const { profile, saved } = useProfile();
  const p = saved ? toElig(profile) : null;
  const judged = block.cards.map((c) => (p && c.type ? judge(c.type, income, tiers, p) : null));
  const any = judged.some(Boolean);

  return (
    <>
      {any && (
        <p className="elig-verdict-lead">
          브라우저에 저장된 <b>내 조건</b>으로 맞춰 본 결과입니다. 제도 일반 기준이라 실제 자격은 공고문과 기관 심사가 정합니다.
        </p>
      )}
      {/* 표(가로 스크롤)는 좁은 화면에서 유형 열이 밀려나 안 보인다는 지적(2026-09-09) — 자가진단
          카드(elig-card/elig-why)와 같은 모양으로 유형 하나당 카드 하나씩 쌓는다 */}
      <ul className={`elig-list${block.align ? " elig-align" : ""}`} style={block.align ? ({ "--rows": block.rows } as React.CSSProperties) : undefined}>
        {block.cards.map((c, i) => {
          const j = judged[i];
          return (
            <li key={c.key} className={`elig-card${j ? ` v-${j.state}` : ""}`}>
              <div className="elig-card-h">
                <b>{c.title}</b>
                <span>{c.sub}</span>
                {(c.right || j) && (
                  <span className="elig-card-r">
                    {j && <em className={`elig-badge v-${j.state}`}>{STATE_TEXT[j.state]}</em>}
                    {c.right && <small>{c.right}</small>}
                  </span>
                )}
              </div>
              <ul className="elig-why">
                {c.lines.map((l) => {
                  const hit = j?.byslot.get(slotOf(l.label));
                  const cls = l.off ? "off" : hit ? (hit.state === "ok" ? "y" : hit.state === "no" ? "n" : "q") : undefined;
                  return (
                    <li key={l.label} className={cls}>
                      <span>{l.label}</span>
                      <p>
                        {l.text}
                        {/* 통과한 줄은 기준만으로 충분하다 — 걸린 줄과 물어볼 줄만 내 값을 붙인다 */}
                        {hit && hit.state !== "ok" && <small className="elig-mine">{hit.check.detail}</small>}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {/* 메모가 있는 카드가 하나라도 있으면 없는 카드도 자리를 비워 둔다 — 안 그러면 칸 맞춤이 한 줄씩 어긋난다 */}
              {block.anyNote && (c.note ? <p className="elig-memo">{c.note}</p> : <p className="elig-memo" aria-hidden="true" />)}
            </li>
          );
        })}
      </ul>
    </>
  );
}
