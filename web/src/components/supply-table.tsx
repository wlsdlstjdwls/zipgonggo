// 단지 상세 「공급현황」 표 — 단지 × 공급유형 × 공급대상. 공고 성격에 맞춰 공가·예비자·월임대료 열을 접는다.
// 열이 12개까지 늘어 칸마다 줄바꿈이 나고 가로 스크롤이 길었다(사용자 지적 2026-09-09) — 8열로 줄였다:
//   우선/일반은 「공가」 칸 밑에 작게, 전용/공용/계약 면적은 「면적」 한 칸에 겹쳐 쓴다.
// 줄이 하나뿐이면 비교할 대상이 없다 — 그때는 이 표를 그리지 않고 페이지의 제원 카드가 그 한 줄을 흡수한다
// (사용자 지적 2026-09-14: 같은 값이 요약 스트립·제원 카드·공급현황 카드에 세 번 나왔다).
import { num, wonExact, wonKo } from "@/lib/format";
import { classLabel, commonArea, m2, typeLabel } from "@/lib/notice-view";
import { Term, TermText } from "./glossary";
import type { NoticeSupply } from "@/types/notice";

type Props = { supply: NoticeSupply[]; hasReserve: boolean; hasRent: boolean; hasClass: boolean };

/** deposit·rent가 어느 비율 옵션인지 — 보증금이 가장 낮은 것(pipeline supply_rows와 같은 규칙) */
function baseOption(s: NoticeSupply) {
  const priced = (s.deposit_options ?? []).filter((o) => o.deposit != null);
  return priced.length ? priced.reduce((a, b) => (b.deposit! < a.deposit! ? b : a)) : null;
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
  // 우선/일반은 자체 열을 쓰지 않고 한 칸 안에 접는다. 예비자를 모집하는 공고에서는 그 합이 「공가」다
  const hasSplit = supply.some((s) => s.units_priority != null || s.units_general != null);

  return (
    <div className="tbl wide">
      <table className="supply">
        <thead>
          <tr>
            {/* 공급대상·공급유형이 각자 열이면 스크롤할 때 유형 열이 먼저 사라진다(사용자 요청
                2026-09-09: "불편한 표는 전부 개선") — 첫 열 하나에 묶어 sticky 하나로 둘 다 딸려온다 */}
            <th>{hasClass ? "공급대상/공급유형" : "공급유형"}</th>
            <th className="num">공급호수</th>
            {hasSplit && (
              <th className="num">
                {hasReserve ? <Term>공가</Term> : <><Term as="우선">우선공급</Term>/<Term as="일반">일반공급</Term></>}
              </th>
            )}
            {hasReserve && <th className="num"><Term as="예비자">예비입주자</Term></th>}
            <th className="num">{hasRent ? "임대보증금" : "전세금"}</th>
            {hasRent && <th className="num">월임대료</th>}
            <th className="num">면적</th>
          </tr>
        </thead>
        <tbody>
          {supply.map((s) => (
            <tr key={s.id}>
              <td className="tc-key">
                {hasClass && classLabel(s) && <span className="tc-tag"><TermText>{classLabel(s)}</TermText></span>}
                <TermText>{typeLabel(s)}</TermText>
              </td>
              <td className="num strong">{s.units_total != null ? num(s.units_total, "호") : "—"}</td>
              {hasSplit && (
                <td className="num stack">
                  <b>{num((s.units_priority ?? 0) + (s.units_general ?? 0), "호")}</b>
                  <small><Term as="우선">우선공급</Term> {s.units_priority ?? 0} / <Term as="일반">일반공급</Term> {s.units_general ?? 0}</small>
                </td>
              )}
              {hasReserve && <td className="num">{s.units_reserve != null ? num(s.units_reserve, "호") : "—"}</td>}
              <td className={s.deposit_options && s.deposit_options.length > 1 ? "num stack" : "num strong"} title={s.deposit != null ? wonExact(s.deposit) : undefined}>
                {s.deposit_options && s.deposit_options.length > 1
                  ? <><b>{wonKo(s.deposit)}</b><small>보증금 {baseOption(s)?.label} 기준</small></>
                  : wonKo(s.deposit)}
              </td>
              {hasRent && <td className="num" title={s.rent != null ? wonExact(s.rent) : undefined}>{wonKo(s.rent)}</td>}
              <td className="num stack"><AreaCell s={s} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
