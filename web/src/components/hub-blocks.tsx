// 유형 허브(/type/{유형})와 사업 허브(/program/{사업})가 같이 쓰는 덩이들.
//
// 두 지면이 글만 이어져 읽기 어렵다는 지적(사용자 2026-10-06: 「글만 있으니 읽기 어렵네」)에 따라,
// **글은 한 자도 안 바꾸고** 담는 그릇만 바꿨다 — 숫자는 큰 타일로, 자격 줄은 기준마다 타일로,
// 지역 목록은 건수 막대로, 자주 묻는 것은 접기로. 문단은 첫 문장을 굵게 세워 훑을 수 있게 한다.
import Link from "next/link";
import type { ReactNode } from "react";
import { ClassTabs } from "./class-tabs";
import { IncomeBars } from "./income-bars";
import { ageRuleText, assetRuleText, carRuleText, classRuleText, HOUSEHOLD_MAX, incomeLimit, incomeRuleText, maritalRuleText } from "@/lib/eligibility";
import { num, wonExact, wonKo } from "@/lib/format";
import type { IncomeStandard, SupplyType } from "@/types/eligibility";

const MAN = 10_000;

/** 지면 머리 숫자 타일 — 「전국 234건 | 진행 중 27건 | 12개 시도」를 한 줄 글자에서 타일로 */
export function HubStats({ items }: { items: { label: string; value: string; hot?: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="hub-stats">
      {items.map((s) => (
        <li key={s.label} className={s.hot ? "hot" : undefined}>
          <b>{s.value}</b>
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** 한 줄 정의 — 지면이 무엇에 대한 것인지 맨 먼저 말하는 자리라 판으로 띄운다 */
export function HubLede({ children }: { children: ReactNode }) {
  return <p className="hub-lede">{children}</p>;
}

/** 첫 문장과 나머지. 마침표 뒤 공백에서 한 번만 자른다 — 못 자르면 통째로 첫 문장 */
function splitFirst(para: string): [string, string] {
  const i = para.indexOf("다. ");
  return i < 0 ? [para, ""] : [para.slice(0, i + 2), para.slice(i + 3)];
}

/** 제도 설명 문단 — 문단마다 첫 문장을 굵게. 문장은 그대로다 */
export function HubParas({ paras }: { paras: string[] }) {
  return (
    <div className="hub-paras">
      {paras.map((p) => {
        const [first, rest] = splitFirst(p);
        return (
          <p key={p.slice(0, 20)}>
            <strong>{first}</strong>
            {rest && <> {rest}</>}
          </p>
        );
      })}
    </div>
  );
}

/** 괄호 앞을 큰 글씨, 괄호 안을 작은 글씨로 */
function splitParen(text: string): [string, string | null] {
  const i = text.indexOf(" (");
  return i < 0 ? [text, null] : [text.slice(0, i), text.slice(i + 2).replace(/\)$/, "")];
}

type Tile = { k: string; big: string; small?: string | null; gauge?: number; title?: string };

function tilesOf(t: SupplyType, income: IncomeStandard[]): Tile[] {
  const tiles: Tile[] = [];
  const [age, ageNote] = splitParen(ageRuleText(t));
  tiles.push({ k: "나이", big: age, small: ageNote });
  const marital = maritalRuleText(t);
  if (marital) {
    const [m, mNote] = splitParen(marital);
    tiles.push({ k: "혼인", big: m, small: mNote });
  }
  const cls = classRuleText(t);
  if (cls) tiles.push({ k: "계층", big: cls });
  tiles.push({ k: "무주택", big: "무주택", small: `${t.homeless_scope} 기준` });
  if (t.income_pct !== null) {
    const one = incomeLimit(income, 1, t.income_pct);
    tiles.push({
      k: "소득",
      big: `${t.income_pct}% 이하`,
      small: [incomeRuleText(t), one != null ? `1인 가구 월 ${wonKo(one)}` : null].filter(Boolean).join(". "),
      // 게이지 눈금 끝은 150% — 공공임대 소득 기준이 거의 다 그 안이다. 넘으면 꽉 찬다
      gauge: Math.min(100, Math.round((t.income_pct / 150) * 100)),
      title: one != null ? wonExact(one) : undefined,
    });
  }
  const asset = assetRuleText(t);
  if (asset && t.asset_limit_man !== null) tiles.push({ k: "자산", big: wonKo(t.asset_limit_man * MAN), small: `${t.asset_scope} 총자산 이하`, title: wonExact(t.asset_limit_man * MAN) });
  const car = carRuleText(t);
  if (car && t.car_limit_man !== null) tiles.push({ k: "자동차", big: t.car_limit_man === 0 ? "소유 불가" : wonKo(t.car_limit_man * MAN), small: t.car_limit_man === 0 ? null : "자동차가액 이하", title: t.car_limit_man ? wonExact(t.car_limit_man * MAN) : undefined });
  return tiles;
}

/** 공급유형 여럿이면 탭으로 하나씩 — 행복주택처럼 계층 다섯이 타일 서른 장으로 이어지면 폰에서 끝이 안 보였다.
 *  탭 본문은 서버가 다 그려 둔다(크롤러는 hidden 패널도 읽는다) */
export function RuleTileGroup({ types, income }: { types: SupplyType[]; income: IncomeStandard[] }) {
  if (types.length === 1) return <RuleTiles t={types[0]} income={income} />;
  return (
    <div className="hub-rule-tabs">
      <ClassTabs tabs={types.map((t) => ({ key: t.code, label: t.name, body: <RuleTiles t={t} income={income} hideTitle /> }))} />
    </div>
  );
}

/** 공급유형 하나의 자격을 기준별 타일로 */
export function RuleTiles({ t, income, hideTitle }: { t: SupplyType; income: IncomeStandard[]; hideTitle?: boolean }) {
  return (
    <section className="hub-rule">
      <h3 className={hideTitle ? "sr-only" : undefined}>{t.name}</h3>
      <ul className="hub-tiles">
        {tilesOf(t, income).map((x) => (
          <li key={x.k}>
            <span className="hub-tile-k">{x.k}</span>
            <b title={x.title}>{x.big}</b>
            {x.gauge != null && (
              <span className="hub-gauge" aria-hidden="true">
                <i style={{ width: `${x.gauge}%` }} />
                {/* 100% 눈금 — 「평균 소득의 몇 %」를 길이로 읽게 */}
                <u style={{ left: `${Math.round((100 / 150) * 100)}%` }} />
              </span>
            )}
            {x.small && <small>{x.small}</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 유형들이 쓰는 소득 비율로 가구원수별 막대. 비율이 없으면 안 그린다 */
export function HubIncome({ types, income, year }: { types: SupplyType[]; income: IncomeStandard[]; year: number }) {
  const pcts = [...new Set(types.map((t) => t.income_pct).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  if (pcts.length === 0) return null;
  const households = Array.from({ length: HOUSEHOLD_MAX }, (_, i) => i + 1);
  const rows = pcts.map((pct) => ({ pct, won: households.map((h) => incomeLimit(income, h, pct)) }));
  if (rows.every((r) => r.won.every((v) => v == null))) return null;
  return (
    <div className="hub-income">
      <h3>가구원수별 소득 한도 <small>{year}년 도시근로자 월평균소득 기준</small></h3>
      <IncomeBars households={households} rows={rows} />
    </div>
  );
}

/** 지역 바로가기 — 건수 막대. 가장 많은 곳을 100으로 */
export function HubAreaBars({ items }: { items: { href: string; label: string; count: number }[] }) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="hub-bars">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href}>
            <span className="hub-bars-l">{i.label}</span>
            <span className="hub-bars-t" aria-hidden="true"><i style={{ width: `${Math.max(6, Math.round((i.count / max) * 100))}%` }} /></span>
            <span className="hub-bars-v">{num(i.count, "건")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 다른 유형, 다른 사업 — 건수 붙은 칩 */
export function HubChips({ items }: { items: { href: string; label: string; count?: number | null }[] }) {
  return (
    <ul className="hub-chips">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href}>
            {i.label}
            {i.count != null && <small>{num(i.count, "건")}</small>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 자주 묻는 것 — 접기. 답은 HTML에 그대로 있어 크롤러와 FAQ 구조화 데이터가 그대로 읽는다 */
export function HubFaq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="hub-faq">
      {items.map((f, i) => (
        <details key={f.q} open={i === 0}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
