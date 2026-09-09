"use client";

// 결과 행. design/README.md "결과 행": D-day 칩 56×52 · 메타/제목/접수기간 · 금액(우측 정렬) · ★저장 · →.
// 보증금·임대료는 감추지 않는다(CLAUDE.md 하지 말 것 3) — 금액 열이 곧 헤드라인이다.
import Link from "next/link";
import type { CSSProperties } from "react";
import { applyPhase, dateK, dateMD, ddayChip, moneyOf, num } from "@/lib/format";
import { noticePath } from "@/lib/routes";
import { regionShort } from "@/lib/sido";
import type { NoticeListItem } from "@/types/notice";
import { SaveButton } from "./save-button";

type Props = {
  n: NoticeListItem;
  /** 등장 스태거(ms). undefined면 애니메이션 없음 */
  stagger?: number;
};

/** "접수 09.07–09.12". 일정이 없으면 모집상태 문구. */
export function periodLabel(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "source_status">): string {
  if (n.apply_start_at || n.apply_end_at) return `접수 ${dateMD(n.apply_start_at)}–${dateMD(n.apply_end_at)}`;
  return n.source_status ? `모집 상태 ${n.source_status}` : "접수 일정은 원문 확인";
}

export function NoticeRow({ n, stagger }: Props) {
  const d = ddayChip(n);
  const ph = applyPhase(n);
  const m = moneyOf(n);
  const qty = n.supply_count != null ? num(n.supply_count, "호") : null;
  const meta = [n.agency, regionShort(n), n.housing_type].filter(Boolean).join(" | ");
  const dates = n.announce_at ? `${periodLabel(n)}, 발표 ${dateMD(n.announce_at)}` : periodLabel(n);
  const style = stagger === undefined ? undefined : ({ "--stagger": `${stagger}ms` } as CSSProperties);
  const moneySub = [qty, m?.label ?? null, m?.sub ?? null].filter(Boolean).join(" | ");

  return (
    <li>
      <Link
        href={noticePath(n.slug)}
        className={`row${stagger === undefined ? " static" : ""}`}
        style={style}
      >
        <span className={`row-dday ${d.tone}`} aria-label={`${d.num} ${d.unit}`}>
          <b>{d.num}</b>
          <span>{d.unit}</span>
        </span>
        <span className="row-body">
          <span className="row-meta">
            {ph.live && <b className={`live ${ph.tone}`}>{ph.live}</b>}
            {meta} | 공고 {dateK(n.posted_at)}{n.amends_source_key && " | 정정"}
          </span>
          <span className="row-title">{n.title}</span>
          <span className="row-narrow">
            <b>{m ? m.main : "금액 원문 확인"}</b>
            {qty && <span>{qty}</span>}
          </span>
          <span className="row-dates">{dates}</span>
        </span>
        <span className={`row-money${m ? "" : " none"}`}>
          <b>{m ? m.main : "금액 원문 확인"}</b>
          {moneySub && <span>{moneySub}</span>}
        </span>
        <span className="row-act">
          <SaveButton id={n.id} />
          <span className="arrow" aria-hidden="true">→</span>
        </span>
      </Link>
    </li>
  );
}
