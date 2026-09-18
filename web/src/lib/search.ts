// 검색 말 다듬기와 「바로 가기」 매칭. DB를 타지 않는 순수 함수라 서버·클라이언트 양쪽이 같이 쓴다.
//
// 정규화 규칙은 **db/migrations/0033의 search_norm()과 글자 하나까지 같아야 한다** — 공백을 걷고 소문자로.
// 한쪽만 바꾸면 인덱스에 든 글자와 찾는 글자가 어긋나 조용히 0건이 된다.
import { AREA_TYPE_MIN_COUNT } from "./constants";
import { areaPath, areaTypePath, typePath } from "./routes";
import { sidoShort } from "./sido";
import type { FilterOption, SearchShortcut } from "@/types/notice";

/** 이 글자 수부터 찾는다. 한 글자는 거의 모든 공고에 걸려 목록을 그대로 돌려주는 것과 같다.
 *  참고: trigram 인덱스는 세 글자부터 탄다 — 두 글자 질의는 전수 훑기로 떨어지지만 표가 작아 몇 ms다. */
export const SEARCH_MIN_LEN = 2;

/** 헤더 드롭다운이 갈래마다 보여 주는 줄 수. /search 지면은 더 많이 싣는다 */
export const SEARCH_PREVIEW_LIMIT = 5;
/** /search 지면이 갈래마다 싣는 줄 수 */
export const SEARCH_PAGE_LIMIT = 30;

/** search_norm()과 같은 규칙 — 공백 제거 + 소문자. */
export function searchNorm(q: string): string {
  return q.toLowerCase().replace(/\s+/g, "");
}

/** LIKE 특수문자를 글자 그대로 만든다. 역슬래시가 Postgres LIKE의 기본 이스케이프 문자다.
 *  이걸 빼먹으면 「%」 한 글자를 친 사람이 표 전체를 받아 간다. */
export function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

/** 찾을 말을 DB에 넘길 꼴로. 짧거나 비면 null — 부르는 쪽이 질의 자체를 건너뛴다. */
export function searchTerm(raw: string | undefined | null): string | null {
  const q = searchNorm((raw ?? "").trim());
  if (q.length < SEARCH_MIN_LEN) return null;
  return likeEscape(q);
}

export type ShortcutSource = {
  /** 시도별 공고 수 (listFilterOptions().sido) */
  sido: FilterOption[];
  /** 시군구 × 유형 (listAreaTypePairs) */
  pairs: { sido: string; sigungu: string; housing_type: string; count: number; ambiguous: boolean }[];
  /** 유형 허브 (listTypeHubs) */
  hubs: { housing_type: string; total: number }[];
};

/**
 * 착지 페이지로 바로 보내는 줄. 「강동구」·「서울」·「장기전세」처럼 **이미 발행해 둔 지면 이름**을 친 사람은
 * 공고 목록을 훑을 게 아니라 그 지면으로 가는 게 맞다.
 *
 * 얇은 페이지 기준을 넘긴 지면만 싣는다 — 미달 지면은 URL은 살아 있어도(CLAUDE.md 5) 권할 자리가 아니다.
 *
 * count의 기준이 갈래마다 다르다: 시도는 **진행 중**, 유형과 지역×유형은 **전체**다.
 * 일부러 맞추지 않았다 — 각 줄의 수는 **그 줄이 데려가는 지면이 실제로 보여 주는 수**여야 한다.
 * /area/{시도}는 기본이 진행 중 목록이고, /type과 /area/{시군구}/{유형}은 마감분까지 싣는다.
 */
export function matchShortcuts(raw: string, src: ShortcutSource, limit: number): SearchShortcut[] {
  const q = searchNorm(raw.trim());
  if (q.length < SEARCH_MIN_LEN) return [];
  const hit = (...names: string[]) => names.some((n) => searchNorm(n).includes(q));
  const starts = (...names: string[]) => names.some((n) => searchNorm(n).startsWith(q));

  const out: (SearchShortcut & { rank: number })[] = [];

  for (const o of src.sido) {
    const short = sidoShort(o.value);
    if (!hit(o.value, short)) continue;
    out.push({ key: `sido:${o.value}`, label: short, sub: "지역 전체", href: areaPath(o.value), count: o.count, rank: starts(o.value, short) ? 0 : 1 });
  }

  for (const h of src.hubs) {
    if (!hit(h.housing_type)) continue;
    out.push({ key: `type:${h.housing_type}`, label: h.housing_type, sub: "유형 안내", href: typePath(h.housing_type), count: h.total, rank: starts(h.housing_type) ? 0 : 1 });
  }

  for (const p of src.pairs) {
    if (p.count < AREA_TYPE_MIN_COUNT) continue;
    const short = sidoShort(p.sido);
    if (!hit(p.sigungu, `${short}${p.sigungu}`)) continue;
    out.push({
      key: `pair:${p.sido}|${p.sigungu}|${p.housing_type}`,
      label: `${short} ${p.sigungu} ${p.housing_type}`,
      sub: "지역과 유형",
      href: areaTypePath(p, p.housing_type),
      count: p.count,
      rank: starts(p.sigungu) ? 0 : 2,
    });
  }

  out.sort((a, b) => a.rank - b.rank || b.count - a.count || a.label.localeCompare(b.label, "ko"));
  return out.slice(0, limit).map(({ rank: _rank, ...s }) => s);
}
