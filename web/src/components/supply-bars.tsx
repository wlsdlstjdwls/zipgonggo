// 단지 상세 「공급현황」 — 주택형 한 줄에 공급호수, 전용면적, 금액을 「라벨 위 / 값 아래」 칸으로 늘어놓는다.
//
// 표(SupplyTable)는 가로로 길고 폰에서 읽기 어려웠다(사용자 지적 2026-10-08). 한때 칸마다 최댓값 대비 막대를 달았는데
// 18.03㎡와 22.01㎡처럼 차이가 작거나 길이로 견줄 뜻이 없는 값까지 막대가 꽉 차 「쓸데없는 바」였다(같은 날) — 걷었다.
// 시각 요소는 값의 뜻이 있을 때만 쓴다(세대 구성 쌓은 막대, 노선 색, 경과 칩).
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

export function Metric({ label, value, sub, title }: { label: ReactNode; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div className="sb-m">
      <span className="k">{label}</span>
      <b className="v" title={title}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function SupplyBars({ supply, hasReserve, hasRent, hasClass, noMoney = false }: Props) {
  const hasSplit = supply.some((s) => s.units_priority != null || s.units_general != null);

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
              <Metric label="공급호수" value={s.units_total != null ? num(s.units_total, "호") : "—"} sub={unitSub || null} />
              <Metric label="전용면적" value={m2(s.area_exclusive) ?? "—"} sub={areaSub || null} />
              {!noMoney && (
                <Metric
                  label={hasRent ? "임대보증금" : "전세금"}
                  value={wonKo(s.deposit)}
                  title={s.deposit != null ? wonExact(s.deposit) : undefined}
                  sub={opt ? `보증금 ${opt.label} 기준` : null}
                />
              )}
              {!noMoney && hasRent && (
                <Metric label="월임대료" value={wonKo(s.rent)} title={s.rent != null ? wonExact(s.rent) : undefined} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
