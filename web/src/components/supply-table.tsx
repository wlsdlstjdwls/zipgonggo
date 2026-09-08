// 단지 상세 「공급현황」 표 — 단지 × 공급유형 × 공급대상. 공고 성격에 맞춰 공가·예비자·월임대료 열을 접는다.
import { num, wonExact, wonKo } from "@/lib/format";
import { classLabel, commonArea, m2, typeLabel } from "@/lib/notice-view";
import type { NoticeSupply } from "@/types/notice";

type Props = { supply: NoticeSupply[]; hasReserve: boolean; hasRent: boolean; hasClass: boolean };

export function SupplyTable({ supply, hasReserve, hasRent, hasClass }: Props) {
  return (
    <div className="tbl table-scroll">
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
