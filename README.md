# 집공고 (zipgonggo)

공공임대주택 입주자모집공고를 **호실 단위로 분해해 지도와 개별 페이지로 재구성**하는 프로그래매틱 SEO 서비스.

- 서비스명: 집공고
- 도메인: `zipgonggo.kr` *(미확보 — 가용 확인 필요)*
- 설계서: [`docs/PLAN.html`](docs/PLAN.html)

## 왜 만드나

LH·SH 공고문은 표만 수백 페이지라 "우리 동네에 나온 게 있나"를 3초 안에 판단할 수 없다.
공고문을 파싱해 호실 단위로 지도에 뿌리고, 각 호실·단지·지역마다 개별 페이지를 만든다.

벤치마크([아영이네 행복주택](https://www.ayounghome.com)) 대비 차별점:

| 항목 | 벤치마크 | 집공고 |
|---|---|---|
| 마감일·발표일 | 없음 | D-day 카운터 |
| 예비입주자 대기현황 | 없음 | 단지별 대기 번호 |
| 커버리지 | 서울·수도권 | 전국 17개 시도 |
| 수집 | 수동 (27건) | 6시간 주기 자동 |
| 자격요건·소득기준 | 없음 | 공고별 요약 |

## 구조

```
zipgonggo/
├── docs/           설계서·데이터소스·URL규칙·파이프라인·로드맵
├── db/             스키마 (Neon Postgres + PostGIS)
├── web/            Next.js 15 App Router
└── pipeline/       Python 수집·파싱·좌표매칭
```

## 스택

| 영역 | 선택 | 근거 |
|---|---|---|
| 프론트 | Next.js 15 App Router + ISR | 호실 3만 페이지를 전량 SSG하면 배포마다 수십 분 |
| 지도 | 네이버 Web Dynamic Map | 대표계정 무료 이용량 · 지도 최신성 우위 · `naver.maps.Panorama` 거리뷰 |
| DB | Neon Postgres + PostGIS | 무료 프로젝트 100개 · 반경 조회 |
| 파이프라인 | Python | PDF/HWP 파싱 생태계가 Python에만 있음 |
| 배포 | Vercel | — |

## 시작하기

```bash
# 웹
cd web && npm install && npm run dev

# 파이프라인
cd pipeline && python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
```

`.env.example`을 `.env`로 복사하고 키를 채운다. 필요한 키는 [`docs/data-sources.md`](docs/data-sources.md) 참조.

## 현재 상태

**Phase 0 — 실사·신청 단계.** 아직 구현 코드 없음. 뼈대와 문서만 있다.

착수 전 해소해야 할 것은 [`docs/roadmap.md`](docs/roadmap.md)의 "선행 조건" 참조.
