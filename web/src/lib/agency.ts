// 기관(출처)별 화면 문구. 상세 페이지의 원문·포털 버튼과 갱신 출처 표기가 SH/그 외로 갈린다.
// 새 기관(GH·HUG)이 붙으면 여기만 늘린다.
import type { NoticeListItem } from "@/types/notice";

export type AgencyLabels = {
  /** 원문 버튼 */
  original: string;
  /** 좁은 화면 하단 고정 바의 원문 버튼 — 값 두 개와 한 줄에 서므로 짧아야 한다 */
  originalShort: string;
  /** 원문 링크 목록 항목 */
  originalListItem: string;
  /** 포털 버튼 */
  portal: string;
  /** 포털 링크 목록 항목 */
  portalListItem: string;
  /** 접수기간 없을 때 안내에 쓰는 원문 호칭 */
  originalDoc: string;
};

const SH: AgencyLabels = {
  original: "SH 원문 공고와 첨부 보기 ↗",
  originalShort: "원문과 첨부 ↗",
  originalListItem: "SH 공고 원문 (첨부파일 포함)",
  portal: "서울주거포털 ↗",
  portalListItem: "서울주거포털 게시글",
  originalDoc: "SH 원문 공고문",
};

// 서울시 청년안심주택 게시판(민간임대). source_url은 게시글, portal_url은 임대사업자의 청약 신청 페이지
const SEOUL_YOUTH: AgencyLabels = {
  original: "서울시 청년안심주택 공고와 첨부 보기 ↗",
  originalShort: "원문과 첨부 ↗",
  originalListItem: "서울시 청년안심주택 게시글 (공고문 첨부 포함)",
  portal: "사업자 청약 신청 페이지 ↗",
  portalListItem: "임대사업자 청약 신청 페이지",
  originalDoc: "청년안심주택 원문 공고문",
};

const DEFAULT: AgencyLabels = {
  original: "기관 원문 공고 보기 ↗",
  originalShort: "원문 공고 ↗",
  originalListItem: "기관 원문 공고",
  portal: "마이홈포털 ↗",
  portalListItem: "마이홈포털 상세",
  originalDoc: "기관 원문",
};

export function agencyLabels(n: Pick<NoticeListItem, "agency">): AgencyLabels {
  if (n.agency === "SH") return SH;
  if (n.agency === "서울시") return SEOUL_YOUTH;
  return DEFAULT;
}
