# 자동 수집

매시 서울주거포털 목록을 보고, **새 공고가 있을 때만** 첨부를 파싱해 DB에 넣고 웹 캐시를 턴다.
워크플로는 [`.github/workflows/collect.yml`](../.github/workflows/collect.yml).

```
매시 17분(UTC)
  │
  ├─ 감시   s1_sh --max-pages 2         경량 의존성. 신규 0건이면 여기서 끝
  │           └ 새로 들어온 slug를 stats.json의 new_slugs로 넘긴다
  │
  └─ 상세   신규 slug만
              s3_sh_complex --slug …    첨부 공고문 → 단지·호실·일정·공급현황
              s6_geocode --db …         주소 → 좌표(오프라인 조인)
              /api/revalidate           stage_main이 알아서 부른다
```

정각을 피한 건 GitHub 크론이 정각에 10~20분씩 밀리기 때문이다. 분 단위 정확도는 기대하지 않는다.

## 왜 Actions인가

Vercel Cron은 못 쓴다. **Hobby는 하루 1회가 최소**고 `0 * * * *` 같은 식은 배포 자체가 실패한다
([Vercel 문서](https://vercel.com/docs/cron-jobs/usage-and-pricing), 2026-09-10 확인).
요금제를 올려도 파이프라인이 Python이라(pyhwp·pdfplumber) 함수로 옮기는 값이 더 크다.

## 비용

private 저장소 Free는 **월 2,000분**이다. 매시 = 월 730회.

| | 도는 때 | 한 회 |
|---|---|---|
| 감시 | 매번 | ~1분 (경량 묶음 `requirements-collect.txt`) |
| 상세 | 신규 있을 때만 | 5~15분 (첨부 쪽수에 달림) |

감시만 도는 회차가 대부분이라 월 1,100분 언저리다. 넘치면 저장소를 public으로 돌리거나
크론을 업무시간(`0 22-13 * * *` UTC = KST 07~22시)으로 좁힌다.

## 준비물

### 1. Secrets

저장소 Settings → Secrets → Actions. 값은 `pipeline/.env`와 같다.

| 이름 | 비고 |
|---|---|
| `DATABASE_URL` | Neon **direct**(`DATABASE_URL_UNPOOLED`) — pooler로는 대량 적재가 안 된다 |
| `DATA_GO_KR_KEY` | `settings()`가 필수로 요구한다. S1-SH는 안 쓰지만 없으면 뜨지 않는다 |
| `JUSO_SEARCH_API_KEY` | |
| `WEB_REVALIDATE_URL` | `https://zipgonggo.com/api/revalidate` |
| `REVALIDATE_SECRET` | web 쪽 값과 같아야 한다 |

### 2. 주소 요약DB 릴리스

전국본 `entrance.sqlite`는 641만 행 1.16GB라 CI가 매번 받기엔 무겁고 커밋도 금지다.
수도권만 추리면 **173만 행 301MB(gz 48MB)** 로 떨어지는데, 실측에서 전국본과 매칭 결과가 완전히 같았다
(1,226행 중 1,060 매칭 · 미스 166 — 양쪽 동일, 2026-09-10).

```bash
cd pipeline && python scripts/make_capital_juso.py
gh release upload juso-data data/juso/entrance-capital.sqlite.gz --clobber
```

행안부가 원본을 갱신하면(월 단위) 다시 만들어 올린다. 산출물은 커밋하지 않는다.

## 손으로 돌리기

Actions 탭 → 「공고 수집」 → Run workflow.

- `force` — 신규가 없어도 상세까지 돈다
- `slugs` — 특정 공고만 (`sh-2026-310107-maeip sh-2026-310041-jaegaebal`)

## 알아 둘 것

- **스케줄이 저절로 꺼진다.** private 저장소는 60일간 커밋이 없으면 GitHub이 크론을 멈춘다.
  메일이 오면 Actions 탭에서 다시 켠다
- **크론은 밀린다.** 5~20분은 예사고 부하가 크면 회차를 통째로 건너뛴다. 매시라 다음 회차가 메운다
- **첨부를 못 읽어도 목록은 이미 들어가 있다.** 조용히 빈 상세 페이지가 생기는 게 제일 위험해서
  파싱이 실패하면 이슈를 연다. 요약(Job Summary)에 공고별 단지 수가 찍힌다
- 요청 간격은 `SCRAPE_DELAY_SEC=1.5`로 로컬(1.0)보다 넉넉히 준다. 동시 요청은 걸지 않는다
