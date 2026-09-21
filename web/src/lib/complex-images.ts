// 단지 사진·도면(0023)을 지면에 올리기 전에 거르고 묶는 규칙. 서버 지면과 클라이언트 갤러리가 같이 쓴다.
//
// **SH주택정보는 단지에 있는 주택형을 다 준다. 공고는 그중 일부만 공급한다.** 그대로 실으면 지면이 거짓말을 한다 —
// 천왕이펜하우스 3단지는 제51차에서 84형 하나만 공급하는데 평면도 9장·실내 36장이 전부 나왔다(사용자 지적 2026-09-14).
import type { ComplexImage, ImageSource } from "@/types/notice";

// 공고의 공급유형(`84`·`84S`)과 SH 표기(`84`·`84S`·`84A`)를 잇는 건 앞머리 숫자다.
// 글자 꼬리(S·A·B1)는 같은 면적의 변형이라 한 묶음으로 본다 — 84형을 뽑은 사람에게 84A 실내는 볼 값이 있다.
const AREA_RE = /^(\d{2,3})/;

export function areaKey(splyTy: string): string {
  return AREA_RE.exec(splyTy)?.[1] ?? "";
}

/** 이 공고와 상관있는 이미지만. 섹션 제목의 장수가 접힌 것까지 세면 「47장」이라 해 놓고 12장을 보여주게 된다. */
export function shownImages(images: ComplexImage[], supplyTypes: string[]): ComplexImage[] {
  const keys = new Set(supplyTypes.map(areaKey).filter(Boolean));
  // 주택형이 없는 이미지(전경·배치도)는 단지 전체 것이라 언제나 앞줄이다
  return images.filter((img) => !img.sply_ty || keys.size === 0 || keys.has(areaKey(img.sply_ty)));
}

/** 이 공고 것 / 그 밖의 주택형으로 가른다. 뒤엣것은 감추지 않고 접어 둔다. */
export function splitImages(images: ComplexImage[], supplyTypes: string[]): { primary: ComplexImage[]; others: ComplexImage[] } {
  const primary = shownImages(images, supplyTypes);
  const shown = new Set(primary);
  return { primary, others: images.filter((img) => !shown.has(img)) };
}

/** 종류별로 묶되 순서는 질의가 정한 그대로 둔다(평면도 → 전경 → 배치도 → 실내). */
export function groupByKind(images: ComplexImage[]): [string, ComplexImage[]][] {
  const out = new Map<string, ComplexImage[]>();
  for (const img of images) {
    const list = out.get(img.kind);
    if (list) list.push(img);
    else out.set(img.kind, [img]);
  }
  return [...out];
}

// 실내 사진 이름 앞머리의 주택형(`84A 안방` → `안방`). 탭이 종류를 말하고 있으면 이건 겹치는 말이다.
const LEADING_TYPE_RE = /^\d{2,3}[A-Za-z]?\d?\s+/;
// 매입임대 전경 사진은 이름이 찍은 날짜다(`20230303`, `20230217광채`). 캡션으로 쓸 말이 아니다
const SHOT_DATE_RE = /^(19|20)\d{6}/;

/** 그림 밑에 붙일 말.
 *
 * 탭이 종류를 이미 말하므로(`실내` 탭) 캡션은 **그 안에서 서로를 가르는 것**만 진다 — 방 이름, 주택형.
 * `mixed`는 종류가 섞인 「다른 주택형」 탭용. 거기선 주택형과 종류를 다 붙여야 뭘 보는지 안다.
 */
export function caption(img: ComplexImage, mixed = false): string {
  const room = img.label ? img.label.replace(LEADING_TYPE_RE, "") : "";
  if (mixed) return [img.sply_ty, room || img.kind].filter(Boolean).join(" ");
  if (img.kind === "평면도") return img.sply_ty ? `${img.sply_ty}형` : img.kind;
  if (SHOT_DATE_RE.test(room)) return "";
  if (room && room !== img.kind) return room;
  // 전경·배치도는 한 장뿐이고 탭 이름이 곧 설명이다. 같은 말을 두 번 쓰지 않는다
  return img.sply_ty || "";
}

/** 면적 순으로 세운다 — 질의 순서(평면도 뭉치 → 실내 뭉치)대로 두면 39 다음에 114가 온다. */
export function sortedTypes(images: ComplexImage[]): string[] {
  return [...new Set(images.map((img) => img.sply_ty).filter(Boolean))]
    .sort((a, b) => Number(areaKey(a)) - Number(areaKey(b)) || a.localeCompare(b));
}

// 이미지 파일이 놓인 자리. 로컬은 `web/public/{sh-house,youth-house}`(gitignore — 배포에 안 올라간다)라
// 개발에서만 기본값을 준다. 배포에서는 스토리지 주소를 환경변수로 받는다. 비어 있으면 **갤러리를 그리지 않는다** —
// DB에 행만 있고 파일이 없어 사진이 전부 액박으로 나갔다(사용자 지적 2026-09-14). 스토리지에 올리고 값을 넣으면 켜진다.
//
// 출처가 둘인 이유는 자료를 주는 기관이 둘이기 때문이다 — 공공임대는 SH주택정보, 민간임대는 청년안심주택 포털.
// 한쪽만 켤 수 있게 따로 둔다(저작권 확인이 기관별로 따로 끝난다).
const devBase = (path: string) => (process.env.NODE_ENV === "production" ? null : path);

export const SH_HOUSE_BASE: string | null =
  process.env.NEXT_PUBLIC_SH_HOUSE_BASE?.replace(/\/+$/, "") || devBase("/sh-house");
export const YOUTH_HOUSE_BASE: string | null =
  process.env.NEXT_PUBLIC_YOUTH_HOUSE_BASE?.replace(/\/+$/, "") || devBase("/youth-house");

const BASES: Record<ImageSource, string | null> = { sh: SH_HOUSE_BASE, youth: YOUTH_HOUSE_BASE };

/** 이 출처의 사진을 지면에 실을 수 있는가. 서버 페이지는 이걸로 질의 자체를 건너뛴다 */
export function imagesEnabled(source: ImageSource): boolean {
  return BASES[source] != null;
}

/** 두 출처 다 꺼져 있으면 갤러리 자리에 「준비 중」을 그린다 */
export const anyImagesEnabled = SH_HOUSE_BASE != null || YOUTH_HOUSE_BASE != null;

export function imageSrc(img: ComplexImage): string {
  const base = BASES[img.source] ?? `/${img.source === "sh" ? "sh-house" : "youth-house"}`;
  return `${base}/${img.code}/${encodeURIComponent(img.file_name)}`;
}
