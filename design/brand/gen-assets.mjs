// 브랜드 자산 생성기(1회성). web/src/lib/brand.ts의 글리프로 파비콘·앱 아이콘·OG 이미지를 만든다.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
const WEB = "C:/Users/cware/project/zipgonggo/web";
const req = createRequire(WEB + "/package.json");
const sharp = req("sharp");
const { ImageResponse } = req("next/dist/compiled/@vercel/og/index.node.js");
const S = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

const ACC = "#3d5afe", INK = "#0f1216", MUT = "#4f5661", DIM = "#5f6672", LINE = "#e9ebef", SUB = "#f7f8fa";
const glyph = (p, c) => `<path d="M13 33L32 15L51 33" fill="none" stroke="${p}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 31H38.5L45 37.5V50.5A3.5 3.5 0 0 1 41.5 54H23.5A3.5 3.5 0 0 1 20 50.5Z" fill="${p}"/><path d="M38.5 31V37.5H45Z" fill="${p}" fill-opacity="0.5"/><path d="M26 42H39M26 47.5H35" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
const tile = (size, r = 16) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" rx="${r}" fill="${ACC}"/>${glyph("#fff", ACC)}</svg>`;
// maskable: 안전 영역(중앙 80%)에 글리프가 들어가게 여백을 두고 모서리 없이
const maskable = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" fill="${ACC}"/><g transform="translate(8 8) scale(0.75)">${glyph("#fff", ACC)}</g></svg>`;

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();

// ICO: PNG 엔트리 3개(16/32/48)
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const entries = []; let off = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(off, 12);
    entries.push(e); off += buf.length;
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.buf)]);
}

mkdirSync(WEB + "/public/icons", { recursive: true });
writeFileSync(WEB + "/src/app/icon.svg", tile(64) + "\n");
writeFileSync(WEB + "/src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (s) => ({ size: s, buf: await png(tile(64), s) })))));
writeFileSync(WEB + "/src/app/apple-icon.png", await png(tile(64, 0), 180)); // iOS가 스스로 둥글리므로 모서리 없이
writeFileSync(WEB + "/public/icons/icon-192.png", await png(tile(64), 192));
writeFileSync(WEB + "/public/icons/icon-512.png", await png(tile(64), 512));
writeFileSync(WEB + "/public/icons/icon-512-maskable.png", await png(maskable(64), 512));

// OG 1200×630 — satori. 마크는 PNG data URI로 넣는다(SVG 중첩보다 안전)
const font = (w) => readFileSync(`${S}/Pretendard-${w}.otf`);
const markUri = "data:image/png;base64," + (await png(tile(64), 320)).toString("base64");
const h = (type, props, ...children) => ({ type, props: { ...props, style: type === "div" ? { display: "flex", ...(props.style || {}) } : props.style, children: children.length === 1 ? children[0] : children } });
const el = h("div", { style: { width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fff", padding: "64px 72px", fontFamily: "Pretendard", position: "relative" } },
  h("div", { style: { display: "flex", alignItems: "center", gap: 18 } },
    h("img", { src: markUri, width: 56, height: 56 }),
    h("div", { style: { fontSize: 40, fontWeight: 900, color: INK, letterSpacing: "-0.05em" } }, "집공고"),
  ),
  h("div", { style: { display: "flex", flexDirection: "column", gap: 26, maxWidth: 760 } },
    h("div", { style: { display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 900, color: INK, letterSpacing: "-0.055em", lineHeight: 1.12 } },
      h("div", {}, "공공임대 모집공고,"),
      h("div", { style: { display: "flex" } }, h("span", { style: { color: ACC } }, "호실 단위"), h("span", {}, "로 지도에.")),
    ),
    h("div", { style: { fontSize: 27, fontWeight: 600, color: MUT, lineHeight: 1.5, letterSpacing: "-0.01em" } }, "LH, SH, 지방공사 입주자모집공고를 지역별 단지별 보증금과 임대료, 마감일로 다시 정리합니다."),
  ),
  h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 22, fontWeight: 700, color: DIM, letterSpacing: "0.02em" } },
    h("div", {}, "zipgonggo.com"),
    h("div", { style: { display: "flex", gap: 10 } },
      ...["공공임대", "공공지원민간임대", "장기전세"].map((t) => h("div", { style: { padding: "8px 14px", borderRadius: 12, background: SUB, border: `1px solid ${LINE}`, color: MUT, fontSize: 18 } }, t)),
    ),
  ),
  h("img", { src: markUri, width: 300, height: 300, style: { position: "absolute", right: 72, top: 165, opacity: 1 } }),
  h("div", { style: { position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: ACC } }),
);
const res = new ImageResponse(el, { width: 1200, height: 630, fonts: [
  { name: "Pretendard", data: font("Black"), weight: 900, style: "normal" },
  { name: "Pretendard", data: font("Bold"), weight: 700, style: "normal" },
  { name: "Pretendard", data: font("SemiBold"), weight: 600, style: "normal" },
] });
writeFileSync(WEB + "/src/app/opengraph-image.png", Buffer.from(await res.arrayBuffer()));
writeFileSync(WEB + "/src/app/opengraph-image.alt.txt", "집공고 — 공공임대 모집공고, 호실 단위로 지도에.\n");
console.log("assets written");
