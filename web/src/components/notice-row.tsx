"use client";

// 결과 행. D-day 칩 56×52 · 메타/제목/날짜 줄 · ★저장 · →.
// 금액 열은 뺐다(사용자 요청 2026-09-09) — 목록에서 읽을 값은 "언제 넣나"이고, 금액은 상세가 정확히 말한다.
// 대신 공고일·접수기간·발표일을 한 줄 더 써서 진하게 보여 준다.
import Link from "next/link";
import type { CSSProperties } from "react";
import { dateK, dateMD, ddayChip, NO_DATE, num } from "@/lib/format";
import { noticePath } from "@/lib/routes";
import { regionShort } from "@/lib/sido";
import type { NoticeListItem } from "@/types/notice";
import { SaveButton } from "./save-button";
import { Trunc } from "./trunc";

type Props = {
  n: NoticeListItem;
  /** 등장 스태거(ms). undefined면 애니메이션 없음 */
  stagger?: number;
  /** 흐리게. 저장 목록(/my)에서 방금 저장을 푼 행 — 지우지 않고 남겨 둬야 잘못 누른 ★을 다시 켤 수 있다 */
  muted?: boolean;
};

/** "09.07–09.12". 날짜를 못 읽은 공고는 「원문 확인」 — 기관 목록의 「모집중」을 접수 기간인 척 쓰지 않는다(사용자 지적 2026-09-09) */
export function periodLabel(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at">): string {
  if (n.apply_start_at || n.apply_end_at) return `${dateMD(n.apply_start_at)}–${dateMD(n.apply_end_at)}`;
  return NO_DATE;
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

export function NoticeRow({ n, stagger, muted }: Props) {
  const d = ddayChip(n);
  const qty = n.supply_count != null ? num(n.supply_count, "호") : null;
  const meta = [n.agency, regionShort(n), n.housing_type, qty].filter(Boolean).join(" | ");
  // 공공임대냐 민간임대냐가 안 보인다는 지적(2026-09-16). 메타 줄에 글자로만 섞어 두면
  // 기관·지역·유형 사이에 묻히고, 폭이 좁으면 말줄임에 제일 먼저 잘려 나간다 —
  // 그래서 줄 맨 앞에 색 있는 칩으로 떼어 둔다(잘리지 않는 자리)
  const mingan = n.sector === "민간임대";
  const style = stagger === undefined ? undefined : ({ "--stagger": `${stagger}ms` } as CSSProperties);

  return (
    <li className={muted ? "muted" : undefined}>
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
          <span className="row-metaline">
            <b className={`sect ${mingan ? "priv" : "pub"}`}>{n.sector}</b>
            <Trunc className="row-meta" text={`${meta}${n.amends_source_key ? " | 정정" : ""}`} />
          </span>
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
