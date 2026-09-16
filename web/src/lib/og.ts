// 동적 OG 이미지의 공통 조각. 공고 상세(notice/[slug])와 단지 상세가 같은 판을 쓴다.
//
// **한글 글꼴을 직접 실어야 한다.** ImageResponse(Satori)의 기본 글꼴엔 한글 글리프가 없어
// 그냥 그리면 제목 자리가 통째로 두부(□)가 된다. 저장소에 폰트 파일을 두면 몇 MB가 늘어나므로
// 구글 폰트의 `text=` 부분집합을 받아 쓴다 — 이 이미지에 실제로 그릴 글자만 담긴 수십 KB짜리다.
// 받아 온 응답은 fetch 캐시에 하루 둔다. 실패하면 null을 돌려주고, 부르는 쪽이 글자 없는 판으로 물러난다.
import { BRAND_ACC, BRAND_INK } from "./brand";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const FONT_FAMILY = "Noto Sans KR";
const FONT_CSS = "https://fonts.googleapis.com/css2";
// 폰트 한 벌은 하루면 충분하다. 글자 집합이 바뀌면 URL이 바뀌어 저절로 새로 받는다
const FONT_TTL_SEC = 86_400;

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

/** 그릴 글자만 담은 글꼴 두 벌(본문/제목). 네트워크가 막히면 빈 배열 — 부르는 쪽이 판단한다. */
export async function ogFonts(text: string): Promise<OgFont[]> {
  const chars = [...new Set(text)].join("");
  const got = await Promise.all(([400, 700] as const).map((w) => oneFont(chars, w)));
  return got.filter((f): f is OgFont => f !== null);
}

async function oneFont(chars: string, weight: 400 | 700): Promise<OgFont | null> {
  try {
    const url = `${FONT_CSS}?family=${encodeURIComponent(FONT_FAMILY)}:wght@${weight}&text=${encodeURIComponent(chars)}`;
    // 구글 폰트는 User-Agent로 포맷을 고른다. Satori는 woff2를 못 읽어 구형 UA로 ttf를 받는다
    const css = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" },
      next: { revalidate: FONT_TTL_SEC },
    }).then((r) => (r.ok ? r.text() : ""));
    const src = /src:\s*url\(([^)]+)\)/.exec(css)?.[1];
    if (!src) return null;
    const data = await fetch(src, { next: { revalidate: FONT_TTL_SEC } }).then((r) => (r.ok ? r.arrayBuffer() : null));
    return data ? { name: FONT_FAMILY, data, weight, style: "normal" } : null;
  } catch {
    return null;
  }
}

export const OG_COLORS = {
  acc: BRAND_ACC,
  ink: BRAND_INK,
  paper: "#ffffff",
  muted: "#5b6472",
  line: "#e3e7ec",
} as const;

/** 글자가 길면 잘라 말줄임. Satori에도 줄 수 제한이 있지만 애초에 짧게 넘기는 편이 판이 안 깨진다 */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
