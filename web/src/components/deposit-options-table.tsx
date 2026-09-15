// 보증금 비율별 임대조건 — 민간임대(청년안심주택) 공고문의 「보증금 30% | 50% | 70%」 표를 그대로 옮긴다.
// notice_supply.deposit_options(0025). 공급현황 표와 금액 표는 보증금이 가장 낮은 옵션(기준값)만 적으므로,
// 비율을 올리면 월임대료가 얼마나 내려가는지는 여기서만 보인다. 열은 공고에 나온 비율의 합집합, 없는 칸은 「—」.
import { wonExact, wonKo } from "@/lib/format";
import { classLabel, typeLabel } from "@/lib/notice-view";
import { TermText } from "./glossary";
import type { DepositOption, NoticeSupply } from "@/types/notice";

type Props = { supply: NoticeSupply[]; hasClass: boolean };

/** 공고에 나온 옵션 라벨을 비율 오름차순으로. 고정액(「9000만원」)은 맨 뒤 */
export function optionLabels(supply: NoticeSupply[]): string[] {
  const seen = new Map<string, DepositOption>();
  for (const s of supply) for (const o of s.deposit_options ?? []) if (!seen.has(o.label)) seen.set(o.label, o);
  return [...seen.values()]
    .sort((a, b) => (a.ratio ?? 1e9) - (b.ratio ?? 1e9) || a.label.localeCompare(b.label, "ko"))
    .map((o) => o.label);
}

export function DepositOptionsTable({ supply, hasClass }: Props) {
  const labels = optionLabels(supply);
  const rows = supply.filter((s) => (s.deposit_options?.length ?? 0) > 0);
  if (labels.length < 2 || rows.length === 0) return null;
  return (
    <div className="tbl wide">
      <table className="supply options">
        <thead>
          <tr>
            <th>{hasClass ? "공급대상/공급유형" : "공급유형"}</th>
            {labels.map((l) => <th key={l} className="num">보증금 {l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const byLabel = new Map((s.deposit_options ?? []).map((o) => [o.label, o]));
            return (
              <tr key={s.id}>
                <td className="tc-key">
                  {hasClass && classLabel(s) && <span className="tc-tag"><TermText>{classLabel(s)}</TermText></span>}
                  <TermText>{typeLabel(s)}</TermText>
                </td>
                {labels.map((l) => {
                  const o = byLabel.get(l);
                  if (!o || (o.deposit == null && o.rent == null)) return <td key={l} className="num">—</td>;
                  return (
                    <td key={l} className="num stack">
                      <b title={o.deposit != null ? wonExact(o.deposit) : undefined}>{wonKo(o.deposit)}</b>
                      <small title={o.rent != null ? wonExact(o.rent) : undefined}>{o.rent != null ? `월 ${wonKo(o.rent)}` : "월임대료 미표기"}</small>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
