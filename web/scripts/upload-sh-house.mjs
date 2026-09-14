// SH 단지 사진·도면을 Vercel Blob(공개 스토어)에 올린다 — public/sh-house/{biznsCd}/{file_name} 그대로.
//
// 왜 여기냐: public/sh-house는 gitignore라 Vercel에 안 올라간다(408MB, 1,381장). 웹은 NEXT_PUBLIC_SH_HOUSE_BASE가
// 있으면 그 URL을 이미지 베이스로 쓴다(lib/complex-images.ts). 이 스크립트가 올리고 그 베이스 URL을 마지막에 찍는다.
// 경로를 DB file_name과 똑같이 두는 게 핵심 — 웹은 `${base}/${biznsCd}/${encodeURIComponent(file_name)}`로 찾는다.
//
// 전송량을 아끼려고 올리기 전에 긴 변 1,600px로 줄인다(원본 평면도 1,783×1,256 400KB, 전경 사진은 더 크다).
// 형식(jpg/png)은 그대로 둔다 — 확장자를 바꾸면 DB file_name과 어긋난다.
//
//   cd web
//   node --env-file=.env.local scripts/upload-sh-house.mjs            # 새 파일만 올린다(이미 있는 경로는 건너뜀)
//   node --env-file=.env.local scripts/upload-sh-house.mjs --only 70464
//
// 필요한 키: BLOB_READ_WRITE_TOKEN (Vercel 대시보드 Storage → Blob 스토어 → .env.local 탭. `vercel env pull`로도 받는다)

import { list, put } from "@vercel/blob";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..", "public", "sh-house");
const MAX_EDGE = 1600;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN이 없다 — node --env-file=.env.local 로 띄우거나 .env.local에 넣는다");
  process.exit(1);
}

// 이미 올라간 경로 — 한 번 훑어 두고 건너뛴다(put은 유료 Advanced Operation, list도 마찬가지지만 1,000개 단위라 싸다)
const have = new Set();
let cursor;
do {
  const page = await list({ cursor, limit: 1000 });
  for (const b of page.blobs) have.add(b.pathname);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);
console.error(`스토어에 ${have.size}개 있음`);

let base = null;
let uploaded = 0, skipped = 0, bytesIn = 0, bytesOut = 0;

const dirs = (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory() && (!only || d.name === only));
for (const d of dirs) {
  const files = await readdir(path.join(ROOT, d.name));
  for (const f of files) {
    const pathname = `${d.name}/${f}`;
    if (have.has(pathname)) { skipped += 1; continue; }
    const src = path.join(ROOT, d.name, f);
    const raw = await readFile(src);
    bytesIn += raw.length;
    const ext = path.extname(f).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : "image/jpeg";
    // 긴 변이 1,600px을 넘는 것만 줄인다. 작은 그림은 **원본 바이트 그대로** — 이미 최적화된 8비트 PNG를 다시 인코딩하면
    // 103KB가 1MB로 불었다(실측). 줄일 때 PNG는 팔레트로 양자화, JPG는 q82. 회전 메타는 굽는다
    const meta = await sharp(raw).metadata();
    const big = Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_EDGE;
    let body = raw;
    if (big) {
      const img = sharp(raw).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside" });
      body = await (ext === ".png" ? img.png({ compressionLevel: 9, palette: true }) : img.jpeg({ quality: 82, mozjpeg: true })).toBuffer();
      if (body.length >= raw.length) body = raw; // 줄였는데 더 커지면 원본
    }
    bytesOut += body.length;
    const blob = await put(pathname, body, {
      access: "public",
      addRandomSuffix: false,
      contentType,
      cacheControlMaxAge: 60 * 60 * 24 * 365, // SH가 파일을 갈면 URL(원본명)이 바뀌어 새 행이 된다(0023) — 1년 캐시
    });
    if (!base) base = blob.url.slice(0, blob.url.indexOf(`/${d.name}/`));
    uploaded += 1;
    if (uploaded % 50 === 0) console.error(`  ${uploaded}장 올림 (${(bytesOut / 1e6).toFixed(0)}MB)`);
  }
}

const mb = (n) => `${(n / 1e6).toFixed(1)}MB`;
console.error(`올림 ${uploaded}장 (${mb(bytesIn)} → ${mb(bytesOut)}), 건너뜀 ${skipped}장`);
if (base) {
  console.log(`\nNEXT_PUBLIC_SH_HOUSE_BASE=${base}`);
  console.log(`→ Vercel env(production·preview)에 위 값을 넣고 재배포하면 갤러리가 켜진다`);
} else if (skipped > 0) {
  const sample = [...have][0];
  console.log(`새로 올린 게 없다. 베이스 URL은 스토어 대시보드의 아무 파일 URL에서 /{biznsCd}/ 앞까지 (예: ${sample})`);
}
