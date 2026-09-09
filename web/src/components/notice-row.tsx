"use client";

// 결과 행. D-day 칩 56×52 · 메타/제목/날짜 줄 · ★저장 · →.
// 금액 열은 뺐다(사용자 요청 2026-09-09) — 목록에서 읽을 값은 "언제 넣나"이고, 금액은 상세가 정확히 말한다.
// 대신 공고일·접수기간·발표일을 한 줄 더 써서 진하게 보여 준다.
import Link from "next/link";
import type { CSSProperties } from "react";
import { dateK, dateMD, ddayChip, num } from "@/lib/format";
import { noticePath } from "@/lib/routes";
import { regionShort } from "@/lib/sido";
import type { NoticeListItem } from "@/types/notice";
import { SaveButton } from "./save-button";
import { Trunc } from "./trunc";

type Props = {
  n: NoticeListItem;
  /** 등장 스태거(ms). undefined면 애니메이션 없음 */
  stagger?: number;
};

/** "09.07–09.12". 일정이 없으면 모집상태 문구. */
export function periodLabel(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "source_status">): string {
  if (n.apply_start_at || n.apply_end_at) return `${dateMD(n.apply_start_at)}–${dateMD(n.apply_end_at)}`;
  return n.source_status ? `모집 상태 ${n.source_status}` : "원문 확인";
}

/** 날짜 한 칸 — 라벨은 작게, 값은 진하게(사용자 요청 2026-09-09) */
function Dt({ k, v }: { k: string; v: string }) {
  return (
    <span className="rd">
      <i>{k}</i>
      <b>{v}</b>
    </span>
  );
}

export function NoticeRow({ n, stagger }: Props) {
  const d = ddayChip(n);
  const qty = n.supply_count != null ? num(n.supply_count, "호") : null;
  const meta = [n.agency, regionShort(n), n.housing_type, qty].filter(Boolean).join(" | ");
  const style = stagger === undefined ? undefined : ({ "--stagger": `${stagger}ms` } as CSSProperties);

  return (
    <li>
      <Link
        href={noticePath(n.slug)}
        className={`row${stagger === undefined ? " static" : ""}`}
        style={style}
        /* 카드 뷰 테두리 색의 근거 — D-day 칩과 같은 톤을 쓴다(사용자 요청 2026-09-09) */
        data-tone={d.tone}
      >
        <span className={`row-dday ${d.tone}${d.solid ? " solid" : ""}`} aria-label={`${d.num} ${d.unit}`}>
          <b>{d.num}</b>
          <span>{d.unit}</span>
        </span>
        <span className="row-body">
          {/* 접수 상태는 왼쪽 D-day 칩이 이미 말한다 — 메타 줄에 「접수 중」을 겹쳐 쓰지 않는다(사용자 지적 2026-09-09) */}
          <Trunc className="row-meta" text={`${meta}${n.amends_source_key ? " | 정정" : ""}`} />
          <Trunc className="row-title" text={n.title} />
          <span className="row-dates">
            <Dt k="공고" v={dateK(n.posted_at)} />
            <Dt k="접수" v={periodLabel(n)} />
            {n.announce_at && <Dt k="발표" v={dateMD(n.announce_at)} />}
          </span>
        </span>
        <span className="row-act">
          <SaveButton id={n.id} />
          <span className="arrow" aria-hidden="true">→</span>
        </span>
      </Link>
    </li>
  );
}
