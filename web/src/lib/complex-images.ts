// 단지 사진·도면(0023)을 지면에 올리기 전에 거르고 묶는 규칙. 서버 지면과 클라이언트 갤러리가 같이 쓴다.
//
// **SH주택정보는 단지에 있는 주택형을 다 준다. 공고는 그중 일부만 공급한다.** 그대로 실으면 지면이 거짓말을 한다 —
// 천왕이펜하우스 3단지는 제51차에서 84형 하나만 공급하는데 평면도 9장·실내 36장이 전부 나왔다(사용자 지적 2026-09-14).
import type { ComplexImage } from "@/types/notice";

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

/** 그림 밑에 붙일 말.
 *
 * 탭이 종류를 이미 말하므로(`실내` 탭) 캡션은 **그 안에서 서로를 가르는 것**만 진다 — 방 이름, 주택형.
 * `mixed`는 종류가 섞인 「다른 주택형」 탭용. 거기선 주택형과 종류를 다 붙여야 뭘 보는지 안다.
 */
export function caption(img: ComplexImage, mixed = false): string {
  const room = img.label ? img.label.replace(LEADING_TYPE_RE, "") : "";
  if (mixed) return [img.sply_ty, room || img.kind].filter(Boolean).join(" ");
  if (img.kind === "평면도") return img.sply_ty ? `${img.sply_ty}형` : img.kind;
  if (room && room !== img.kind) return room;
  // 전경·배치도는 한 장뿐이고 탭 이름이 곧 설명이다. 같은 말을 두 번 쓰지 않는다
  return img.sply_ty || "";
}

/** 면적 순으로 세운다 — 질의 순서(평면도 뭉치 → 실내 뭉치)대로 두면 39 다음에 114가 온다. */
export function sortedTypes(images: ComplexImage[]): string[] {
  return [...new Set(images.map((img) => img.sply_ty).filter(Boolean))]
    .sort((a, b) => Number(areaKey(a)) - Number(areaKey(b)) || a.localeCompare(b));
}

export function imageSrc(biznsCd: string, img: ComplexImage): string {
  return `/sh-house/${biznsCd}/${encodeURIComponent(img.file_name)}`;
}
