// 단지 상세 「공급현황」 표 — 단지 × 공급유형 × 공급대상. 공고 성격에 맞춰 공가·예비자·월임대료 열을 접는다.
// 줄이 하나뿐이면 비교할 대상이 없어 가로로 긴 표가 오히려 불편하다(모바일 가로 스크롤) — 그때는 제원 카드(spec-list)로 세로로 보여준다.
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

export function SupplyTable({ supply, hasReserve, hasRent, hasClass }: Props) {
  if (supply.length === 1) {
    return <SupplyCard s={supply[0]} hasReserve={hasReserve} hasRent={hasRent} hasClass={hasClass} />;
  }

  return (
    <div className="tbl wide">
      <table className="supply">
        <thead>
          <tr>
            {hasClass && <th>공급대상</th>}
            <th>공급유형</th>
            <th className="num">공급호수</th>
            {hasReserve && <th className="num">공가</th>}
            <th className="num">우선</th>
            <th className="num">일반</th>
            {hasReserve && <th className="num">예비자</th>}
            <th className="num">{hasRent ? "임대보증금" : "전세금"}</th>
            {hasRent && <th className="num">월임대료</th>}
            <th className="num">전용면적</th>
            <th className="num">공용면적</th>
            <th className="num">계약면적</th>
          </tr>
        </thead>
        <tbody>
          {supply.map((s) => (
            <tr key={s.id}>
              {hasClass && <td>{classLabel(s)}</td>}
              <td>{typeLabel(s)}</td>
              <td className="num">{s.units_total != null ? num(s.units_total, "호") : "—"}</td>
              {hasReserve && <td className="num">{num((s.units_priority ?? 0) + (s.units_general ?? 0), "호")}</td>}
              <td className="num">{s.units_priority ?? "—"}</td>
              <td className="num">{s.units_general ?? "—"}</td>
              {hasReserve && <td className="num">{s.units_reserve ?? "—"}</td>}
              <td className="num" title={s.deposit != null ? wonExact(s.deposit) : undefined}>{wonKo(s.deposit)}</td>
              {hasRent && <td className="num" title={s.rent != null ? wonExact(s.rent) : undefined}>{wonKo(s.rent)}</td>}
              <td className="num">{m2(s.area_exclusive)}</td>
              <td className="num">{m2(commonArea(s))}</td>
              <td className="num">{m2(s.area_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
