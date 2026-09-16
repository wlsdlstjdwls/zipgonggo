// 공고별 OG 이미지. 전까지는 app/opengraph-image.png 한 장을 3만 페이지가 같이 썼다 —
// 공유 카드가 전부 똑같아 어느 공고를 받았는지 링크를 열기 전엔 알 수 없었다(53차가 남긴 것 1-a).
//
// 판에 싣는 것은 「링크를 열지 말지 정하는 값」 넷 — 공고 제목, 기관과 유형, 지역, 보증금과 마감.
// 금액은 wonKo 한글 단위(CLAUDE.md 표기 규칙), 나열 구분은 가운뎃점이 아니라 ` | `.
import { ImageResponse } from "next/og";
import { ddayChip, wonKo } from "@/lib/format";
import { clip, OG_COLORS, OG_CONTENT_TYPE, OG_SIZE, ogFonts } from "@/lib/og";
import { getNoticeBySlug } from "@/lib/queries";
import { regionShort } from "@/lib/sido";
import { SITE_NAME } from "@/lib/constants";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "공고 요약 카드";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const n = await getNoticeBySlug(decodeURIComponent(slug));

  const title = clip(n?.title ?? SITE_NAME, 58);
  const meta = n ? [n.agency, n.housing_type, regionShort(n)].filter(Boolean).join(" | ") : "공공임대 모집공고";
  const dday = n ? ddayChip(n) : null;
  const badge = dday ? `${dday.num} ${dday.unit}` : "";
  const money = n?.min_deposit != null
    ? `보증금 ${wonKo(n.min_deposit)}${n.min_rent ? ` / 월 ${wonKo(n.min_rent)}` : ""}`
    : "보증금과 임대료는 원문 표 확인";

  const fonts = await ogFonts(`${title}${meta}${badge}${money}${SITE_NAME}0123456789`);

  return new ImageResponse(
    (
      <div style={{ ...frame }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ ...tile }}>
            {/* lib/brand의 마크를 Satori가 읽는 형태로 옮긴 것 — 색과 좌표계(64×64)는 같다 */}
            <svg width="44" height="44" viewBox="0 0 64 64">
              <path d="M13 33L32 15L51 33" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 31H38.5L45 37.5V50.5A3.5 3.5 0 0 1 41.5 54H23.5A3.5 3.5 0 0 1 20 50.5Z" fill="#fff" />
              <path d="M26 42H39M26 47.5H35" stroke={OG_COLORS.acc} strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: OG_COLORS.ink }}>{SITE_NAME}</div>
          {badge && <div style={{ ...chip }}>{badge}</div>}
        </div>

        <div style={{ display: "flex", fontSize: 58, fontWeight: 700, lineHeight: 1.25, color: OG_COLORS.ink }}>{title}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 30, color: OG_COLORS.muted }}>{meta}</div>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: OG_COLORS.acc }}>{money}</div>
        </div>
      </div>
    ),
    // 글꼴을 못 받았으면 fonts를 넘기지 않는다 — 기본 글꼴로라도 판은 나온다(한글은 비지만 이미지 자체가 깨지진 않는다)
    { ...OG_SIZE, ...(fonts.length ? { fonts } : {}) },
  );
}

const frame: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  padding: "64px 72px",
  background: OG_COLORS.paper,
  borderBottom: `16px solid ${OG_COLORS.acc}`,
};

const tile: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 64,
  height: 64,
  borderRadius: 16,
  background: OG_COLORS.acc,
};

const chip: React.CSSProperties = {
  display: "flex",
  marginLeft: "auto",
  padding: "10px 22px",
  borderRadius: 999,
  border: `2px solid ${OG_COLORS.line}`,
  fontSize: 28,
  fontWeight: 700,
  color: OG_COLORS.muted,
};
