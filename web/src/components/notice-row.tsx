"use client";

// 결과 행. D-day 칩 56×52 · 메타/제목/날짜 줄 · ★저장 · →.
//
// **금액 줄을 뺐다(사용자 결정 2026-09-21).** 같은 날 오전에 되살렸다가 그날 저녁에 도로 뺀 자리다 —
// 「보증금」·「월세」 라벨과 값이 없는 공고의 「금액 원문 확인」까지 세 표기가 카드마다 한 줄을 먹는데,
// 목록에서 하는 일은 고르기가 아니라 훑기다. 금액은 상세에서 본다. 금액으로 거르는 길은 목록 필터(월세 상한)에 있다.
import Link from "next/link";
import type { CSSProperties } from "react";
import { photoBadgeOn } from "@/lib/complex-images";
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
  /** 흐리게. 관심 공고(/my)에서 방금 ★을 뺀 행 — 지우지 않고 남겨 둬야 잘못 누른 걸 되돌릴 수 있다 */
  muted?: boolean;
};

/** "09.07–09.12". 날짜를 못 읽은 공고는 「원문 확인」 — 기관 목록의 「모집중」을 접수 기간인 척 쓰지 않는다(사용자 지적 2026-09-09) */
export function periodLabel(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at">): string {
  if (n.apply_start_at || n.apply_end_at) return `${dateMD(n.apply_start_at)}–${dateMD(n.apply_end_at)}`;
  return NO_DATE;
}

/** 날짜 한 칸 — 라벨은 작게, 값은 진하게(사용자 요청 2026-09-09).
    hi는 접수 기간 한 칸에만 붙는다 — 셋이 같은 무게면 결정값이 안 보인다(2026-09-21) */
function Dt({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <span className={hi ? "rd hi" : "rd"}>
      <i>{k}</i>
      <b>{v}</b>
    </span>
  );
}

export function NoticeRow({ n, stagger, muted }: Props) {
  const d = ddayChip(n);
  const qty = n.supply_count != null ? num(n.supply_count, "호") : null;
  // 지역을 메타 나열에서 떼어 앞에 세운다 — 훑을 때 제일 먼저 찾는 값인데 기관 뒤에 묻혀 있었다(2026-09-21)
  const loc = regionShort(n);
  const meta = [n.housing_type, n.agency, qty].filter(Boolean).join(" | ");
  // 공공임대냐 민간임대냐가 안 보인다는 지적(2026-09-16). 메타 줄에 글자로만 섞어 두면
  // 기관·지역·유형 사이에 묻히고, 폭이 좁으면 말줄임에 제일 먼저 잘려 나간다 —
  // 그래서 줄 맨 앞에 색 있는 칩으로 떼어 둔다(잘리지 않는 자리)
  const mingan = n.sector === "민간임대";
  // 사진이 있는 공고는 열어 볼 값이 다르다(사용자 요청 2026-09-21). 공고 목록은 단지 코드를 안 들고 오므로
  // 부문으로 출처를 가른다 — 공공임대는 SH주택정보, 민간임대는 청년안심주택 포털이 그림을 준다
  const photo = n.has_photo === true && photoBadgeOn(mingan ? "youth" : "sh");
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
            {loc && <b className="row-loc">{loc}</b>}
            {photo && <b className="row-photo" title="단지 사진이 있는 공고입니다">사진</b>}
            <Trunc className="row-meta" text={`${meta}${n.amends_source_key ? " | 정정" : ""}`} />
          </span>
          <Trunc className="row-title" text={n.title} />
          <span className="row-dates">
            <Dt k="접수" v={periodLabel(n)} hi />
            {n.announce_at && <Dt k="발표" v={dateMD(n.announce_at)} />}
            <Dt k="공고" v={dateK(n.posted_at)} />
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
