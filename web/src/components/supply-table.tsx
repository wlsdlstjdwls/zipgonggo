// 단지 상세 「공급현황」 표 — 단지 × 공급유형 × 공급대상. 공고 성격에 맞춰 공가·예비자·월임대료 열을 접는다.
// 열이 12개까지 늘어 칸마다 줄바꿈이 나고 가로 스크롤이 길었다(사용자 지적 2026-09-09) — 8열로 줄였다:
//   우선/일반은 「공가」 칸 밑에 작게, 전용/공용/계약 면적은 「면적」 한 칸에 겹쳐 쓴다.
// 줄이 하나뿐이면 비교할 대상이 없어 가로로 긴 표가 오히려 불편하다 — 그때는 제원 카드(spec-list)로 세로로 보여준다.
import { num, wonExact, wonKo } from "@/lib/format";
import { classLabel, commonArea, m2, typeLabel } from "@/lib/notice-view";
import { Spec, SpecList } from "./spec-list";
import type { NoticeSupply } from "@/types/notice";

type Props = { supply: NoticeSupply[]; hasReserve: boolean; hasRent: boolean; hasClass: boolean };

function SupplyCard({ s, hasReserve, hasRent, hasClass }: { s: NoticeSupply } & Omit<Props, "supply">) {
  return (
    <SpecList>
      {hasClass && <Spec label="공급대상" value={classLabel(s)} />}
      <Spec label="공급유형" value={typeLabel(s)} />
      <Spec label="공급호수" value={s.units_total != null ? num(s.units_total, "호") : null} />
      {hasReserve && <Spec label="공가" value={num((s.units_priority ?? 0) + (s.units_general ?? 0), "호")} />}
      <Spec label="우선" value={s.units_priority != null ? num(s.units_priority, "호") : null} />
      <Spec label="일반" value={s.units_general != null ? num(s.units_general, "호") : null} />
      {hasReserve && <Spec label="예비자" value={s.units_reserve != null ? num(s.units_reserve, "호") : null} />}
      <Spec label={hasRent ? "임대보증금" : "전세금"} value={s.deposit != null ? <span title={wonExact(s.deposit)}>{wonKo(s.deposit)}</span> : null} />
      {hasRent && <Spec label="월임대료" value={s.rent != null ? <span title={wonExact(s.rent)}>{wonKo(s.rent)}</span> : null} />}
      <Spec label="전용면적" value={m2(s.area_exclusive)} />
      <Spec label="공용면적" value={m2(commonArea(s))} />
      <Spec label="계약면적" value={m2(s.area_total)} />
    </SpecList>
  );
}

/** 면적 한 칸 — 전용을 크게, 공용/계약을 그 밑에 작게. 세 열을 하나로 접는다 */
function AreaCell({ s }: { s: NoticeSupply }) {
  const common = commonArea(s);
  const sub = [common != null ? `공용 ${common}` : null, s.area_total != null ? `계약 ${s.area_total}` : null].filter(Boolean).join(" / ");
  return (
    <>
      <b>{m2(s.area_exclusive)}</b>
      {sub && <small>{sub}</small>}
    </>
  );
}

export function SupplyTable({ supply, hasReserve, hasRent, hasClass }: Props) {
  if (supply.length === 1) {
    return <SupplyCard s={supply[0]} hasReserve={hasReserve} hasRent={hasRent} hasClass={hasClass} />;
  }
  // 우선/일반은 자체 열을 쓰지 않고 한 칸 안에 접는다. 예비자를 모집하는 공고에서는 그 합이 「공가」다
  const hasSplit = supply.some((s) => s.units_priority != null || s.units_general != null);

  return (
    <div className="tbl wide">
      <table className="supply">
        <thead>
          <tr>
            {hasClass && <th>공급대상</th>}
            <th>공급유형</th>
            <th className="num">공급호수</th>
            {hasSplit && <th className="num">{hasReserve ? "공가" : "우선/일반"}</th>}
            {hasReserve && <th className="num">예비자</th>}
            <th className="num">{hasRent ? "임대보증금" : "전세금"}</th>
            {hasRent && <th className="num">월임대료</th>}
            <th className="num">면적</th>
          </tr>
        </thead>
        <tbody>
          {supply.map((s) => (
            <tr key={s.id}>
              {hasClass && <td className="tc-key">{classLabel(s)}</td>}
              <td className="tc-key">{typeLabel(s)}</td>
              <td className="num strong">{s.units_total != null ? num(s.units_total, "호") : "—"}</td>
              {hasSplit && (
                <td className="num stack">
                  <b>{num((s.units_priority ?? 0) + (s.units_general ?? 0), "호")}</b>
                  <small>우선 {s.units_priority ?? 0} / 일반 {s.units_general ?? 0}</small>
                </td>
              )}
              {hasReserve && <td className="num">{s.units_reserve != null ? num(s.units_reserve, "호") : "—"}</td>}
              <td className="num strong" title={s.deposit != null ? wonExact(s.deposit) : undefined}>{wonKo(s.deposit)}</td>
              {hasRent && <td className="num" title={s.rent != null ? wonExact(s.rent) : undefined}>{wonKo(s.rent)}</td>}
              <td className="num stack"><AreaCell s={s} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
