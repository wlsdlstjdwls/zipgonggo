// 시도 표기. notice.sido는 정식 명칭("서울특별시")이고 카드·제목엔 통칭("서울")을 쓴다.
// smokespot lib/sido.ts 패턴. 목록에 없는 시도(전국 등)는 그대로.
import type { NoticeListItem } from "@/types/notice";

export type Sido = { name: string; short: string };

export const SIDOS: readonly Sido[] = [
  { name: "서울특별시", short: "서울" },
  { name: "부산광역시", short: "부산" },
  { name: "대구광역시", short: "대구" },
  { name: "인천광역시", short: "인천" },
  { name: "광주광역시", short: "광주" },
  { name: "대전광역시", short: "대전" },
  { name: "울산광역시", short: "울산" },
  { name: "세종특별자치시", short: "세종" },
  { name: "경기도", short: "경기" },
  { name: "강원특별자치도", short: "강원" },
  { name: "강원도", short: "강원" },
  { name: "충청북도", short: "충북" },
  { name: "충청남도", short: "충남" },
  { name: "전북특별자치도", short: "전북" },
  { name: "전라북도", short: "전북" },
  { name: "전라남도", short: "전남" },
  { name: "경상북도", short: "경북" },
  { name: "경상남도", short: "경남" },
  { name: "제주특별자치도", short: "제주" },
];

const SHORT_BY_NAME = new Map(SIDOS.map((s) => [s.name, s.short]));

/** 정식 명칭 → 통칭. 표에 없으면 접미사만 떼어 본다(신설 자치도 대비). */
export function sidoShort(name: string): string {
  const known = SHORT_BY_NAME.get(name);
  if (known) return known;
  return name.replace(/(특별자치시|특별자치도|특별시|광역시|통합특별시)$/u, "").replace(/도$/u, "") || name;
}

/** "경기도 광명시" 꼴 지역 문자열. 시군구 없으면 시도만. */
export function regionLabel(n: Pick<NoticeListItem, "sido" | "sigungu">): string {
  return [n.sido, n.sigungu].filter(Boolean).join(" ");
}

/** 카드 지역 배지용 "서울 강남구". */
export function regionShort(n: Pick<NoticeListItem, "sido" | "sigungu">): string {
  return [sidoShort(n.sido), n.sigungu].filter(Boolean).join(" ");
}
