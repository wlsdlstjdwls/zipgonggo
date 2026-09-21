"use client";

// 결과 행. D-day 칩 56×52 · 메타/제목/금액/날짜 줄 · ★저장 · →.
//
// **금액을 되살렸다(2026-09-21).** 09-09에 「목록에서 읽을 값은 언제 넣나」라는 이유로 뺐는데,
// 임대 목록에서 보증금과 월세가 안 보이면 상세를 열기 전엔 내 예산인지조차 못 가른다 —
// 수십 건을 하나씩 열어 보게 만드는 값이라 목록에 있어야 한다. 전체의 83%에 값이 있고,
// 없는 공고는 「원문 확인」으로 적는다(없는 금액을 지어내지 않는다).
// 최솟값이라는 점은 「부터」로 말한다 — 같은 공고 안에서도 주택형마다 다르다.
import Link from "next/link";
import type { CSSProperties } from "react";
import { dateK, dateMD, ddayChip, NO_DATE, num, wonExact, wonKo } from "@/lib/format";
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

/** 목록의 금액 한 줄. 보증금과 월세를 나란히 — 둘 다 없으면 「원문 확인」 한 마디.
    정확한 원 단위는 title 속성으로만 둔다(CLAUDE.md 표기 규칙) */
function Money({ n }: { n: Pick<NoticeListItem, "min_deposit" | "min_rent"> }) {
  const dep = n.min_deposit;
  const rent = n.min_rent;
  if (dep == null && rent == null) return <span className="row-money none">금액 원문 확인</span>;
  return (
    <span className="row-money">
      {dep != null && (
        <b title={`보증금 ${wonExact(dep)}부터`}>
          <i>보증금</i> {wonKo(dep)}
        </b>
      )}
      {/* 월세 0원은 전세형이다 — 「0원」이라고 적으면 공짜로 읽힌다 */}
      {rent != null && (
        <b title={rent === 0 ? "월임대료 없음(전세형)" : `월임대료 ${wonExact(rent)}부터`}>
          <i>월세</i> {rent === 0 ? "없음" : wonKo(rent)}
        </b>
      )}
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
            <Trunc className="row-meta" text={`${meta}${n.amends_source_key ? " | 정정" : ""}`} />
          </span>
          <Trunc className="row-title" text={n.title} />
          <Money n={n} />
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
