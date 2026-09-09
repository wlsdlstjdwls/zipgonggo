# 브랜드 마크

**컨셉: 지붕(집) 아래 귀가 접힌 공고문 시트(공고).** 2026-09-08 A안 채택. 후보 비교는 `mark-candidates.png`.

- 단일 원천: `web/src/lib/brand.ts` — 글리프(64×64)·타일·지도 마커를 여기서만 그린다
- 색: `--acc #3d5afe` 타일 + 흰 글리프. 마커 선택 상태는 `--ink`. 새 색을 만들지 않는다
- 파생 자산(생성물, 커밋함):
  - `web/src/app/icon.svg` `favicon.ico`(16/32/48) `apple-icon.png`(180, 모서리 없음 — iOS가 둥글림) `opengraph-image.png`(1200×630) `opengraph-image.alt.txt`
  - `web/public/icons/icon-192.png` `icon-512.png` `icon-512-maskable.png`(안전영역 80%) → `web/src/app/manifest.ts`
- 다시 만들기: `node design/brand/gen-assets.mjs` — web의 `sharp`·`next/og`(satori)를 빌려 쓴다. OG 글꼴은 Pretendard 정적 OTF(Black/Bold/SemiBold)를 스크립트 옆에 내려받아 둔다
  (`https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-{Weight}.otf` — gh 경로는 저장소가 50MB를 넘어 jsDelivr가 403을 낸다). 글꼴 파일은 커밋하지 않는다
- **OG 이미지는 가운데 정사각이 잘려도 읽혀야 한다**(2026-09-09). 노션 북마크·티스토리/네이버 링크 카드는 1200×630을
  정사각에 가깝게 `object-fit: cover`로 자른다 — 가로 가운데 630px만 남는다. 그래서 마크·제목·도메인을 폭 560 카드 한 장에
  모아 가운데 두고, 좌우 여백은 잘려도 잃을 게 없는 바탕으로만 쓴다. 문구를 늘릴 때 이 폭을 넘기지 말 것
- 글리프를 바꾸면 `brand.ts`·`brand-mark.tsx`·`gen-assets.mjs` 세 곳의 path를 같이 바꾼다(React 컴포넌트는 문자열 SVG를 못 쓰므로 중복이 불가피)
