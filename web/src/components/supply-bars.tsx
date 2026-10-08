// 단지 상세 「공급현황」 — 주택형마다 공급호수, 전용면적, 금액을 주택형끼리 견주는 가로 막대로 그린다.
//
// 표(SupplyTable)로 두니 숫자만 늘어서 어느 형이 많고 넓고 비싼지 한눈에 안 들어왔다(사용자 지적 2026-10-08:
// "공급정보 가시성 너무 별로"). 사용자가 말하는 가시성은 표/나열을 시각 요소로 바꾸는 것이다(접수 일정 → 타임라인,
// 보증금 표 → 슬라이더와 같은 갈래). 막대 길이 = 이 단지 안 최댓값 대비. 값은 늘 글자로 같이 적는다(막대만으로 읽게 하지 않는다).
import { num, wonExact, wonKo } from "@/lib/format";
import { classLabel, commonArea, m2, typeLabel } from "@/lib/notice-view";
import { Term, TermText } from "./glossary";
import type { NoticeSupply } from "@/types/notice";
import type { ReactNode } from "react";

type Props = { supply: NoticeSupply[]; hasReserve: boolean; hasRent: boolean; hasClass: boolean;
  /** 금액 막대를 뺀다 — 바로 밑 금액 목록이 같은 줄마다 같은 금액을 낼 때(같은 숫자를 두 번 쓰지 않는다) */
  noMoney?: boolean };

/** deposit·rent가 어느 비율 옵션인지 — 보증금이 가장 낮은 것(pipeline supply_rows와 같은 규칙) */
function baseOption(s: NoticeSupply) {
  const priced = (s.deposit_options ?? []).filter((o) => o.deposit != null);
  return priced.length ? priced.reduce((a, b) => (b.deposit! < a.deposit! ? b : a)) : null;
}

const maxOf = (xs: (number | null)[]) => Math.max(0, ...xs.filter((x): x is number => x != null));

export function Metric({ label, value, ratio, sub, title }: { label: ReactNode; value: ReactNode; ratio: number | null; sub?: ReactNode; title?: string }) {
  return (
    <div className="sb-m">
      <span className="k">{label}</span>
      <b className="v" title={title}>{value}</b>
      {ratio != null && (
        <span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(4, ratio * 100)}%` }} /></span>
      )}
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function SupplyBars({ supply, hasReserve, hasRent, hasClass, noMoney = false }: Props) {
  const hasSplit = supply.some((s) => s.units_priority != null || s.units_general != null);
  const maxUnits = maxOf(supply.map((s) => s.units_total));
  const maxArea = maxOf(supply.map((s) => s.area_exclusive));
  const maxDep = maxOf(supply.map((s) => s.deposit));
  const maxRent = maxOf(supply.map((s) => s.rent));
  const r = (v: number | null, max: number) => (v != null && max > 0 ? v / max : null);

  return (
    <ul className="sbars">
      {supply.map((s) => {
        const split = (s.units_priority ?? 0) + (s.units_general ?? 0);
        const unitSub = hasReserve
          ? [hasSplit ? `공가 ${num(split, "호")}` : null, s.units_reserve != null ? `예비 ${num(s.units_reserve, "호")}` : null].filter(Boolean).join(" | ")
          : hasSplit ? <><Term as="우선">우선공급</Term> {s.units_priority ?? 0} / <Term as="일반">일반공급</Term> {s.units_general ?? 0}</> : null;
        const common = commonArea(s);
        const areaSub = [common != null ? `공용 ${common}` : null, s.area_total != null ? `계약 ${s.area_total}` : null].filter(Boolean).join(" / ");
        const opt = s.deposit_options && s.deposit_options.length > 1 ? baseOption(s) : null;
        return (
          <li key={s.id} className="sb-row">
            <div className="sb-title">
              {hasClass && classLabel(s) && <span className="tc-tag"><TermText>{classLabel(s)}</TermText></span>}
              <TermText>{typeLabel(s)}</TermText>
            </div>
            <div className="sb-metrics">
              <Metric label="공급호수" value={s.units_total != null ? num(s.units_total, "호") : "—"} ratio={r(s.units_total, maxUnits)} sub={unitSub || null} />
              <Metric label="전용면적" value={m2(s.area_exclusive) ?? "—"} ratio={r(s.area_exclusive, maxArea)} sub={areaSub || null} />
              {!noMoney && (
                <Metric
                  label={hasRent ? "임대보증금" : "전세금"}
                  value={wonKo(s.deposit)}
                  title={s.deposit != null ? wonExact(s.deposit) : undefined}
                  ratio={r(s.deposit, maxDep)}
                  sub={opt ? `보증금 ${opt.label} 기준` : null}
                />
              )}
              {!noMoney && hasRent && (
                <Metric label="월임대료" value={wonKo(s.rent)} title={s.rent != null ? wonExact(s.rent) : undefined} ratio={r(s.rent, maxRent)} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
