# 자동 수집

워크플로가 둘이다.

| 워크플로 | 주기 | 보는 곳 |
|---|---|---|
| [`collect.yml`](../.github/workflows/collect.yml) 「공고 수집」 | 매시 :17 (UTC) | 서울주거포털 목록 → 신규만 첨부 파싱 |
| [`patrol.yml`](../.github/workflows/patrol.yml) 「게시판 순찰」 | 하루 1회 21:40 (UTC) | i-sh 게시판 m_247/m_241, 경쟁률 결과 글, 마이홈 API |

## 매시 — 공고 수집

서울주거포털 목록을 보고, **새 공고가 있을 때만** 첨부를 파싱해 DB에 넣고 웹 캐시를 턴다.

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

## 하루 1회 — 게시판 순찰

포털 목록(`s1_sh`)이 전부가 아니다. 운영기관 위탁분(특화형 매입임대·사회주택)은 **인터넷청약시스템
게시판(m_247)에만** 뜨고, 모집공고 게시판(m_241)에도 포털이 놓친 게 섞인다.

```
매일 21:40(UTC) = KST 06:40
  │
  ├─ 순찰   s1_ish_board --board 247            앞 3쪽 (기본값)
  │         s1_ish_board --board 241 --max-pages 3
  │         s1_collect                          마이홈 API — LH 전국분
  │           └ 게시판이 주운 new_slugs를 아래로 넘긴다
  │
  ├─ 경쟁률 s3_ish_results --max-pages 3 --limit 20   결과 글. 첨부를 읽으니 하루치 상한을 둔다
  │
  └─ 상세   gh workflow run collect.yml -f force=true -f slugs=…
              └ 상세 파싱 로직을 두 벌 두지 않는다. 「공고 수집」을 불러 맡긴다
```

`--since-year`는 비우면 올해(KST)다. 오래된 글은 목록에서 걸러져 요청을 더 쓰지 않는다.

**매시가 아닌 이유는 요청 간격이다.** m_247은 잡글이 8천 건 섞인 게시판이라 한 회차에 수십 번을 두드린다
(CLAUDE.md 「하지 말 것」 7). 결과 글 파싱은 첨부까지 받으므로 `--limit 20`으로 하루치를 묶고,
밀린 건 다음 회차가 이어 받는다.

### 왜 dispatch로 넘기나

`GITHUB_TOKEN`이 일으킨 이벤트는 보통 새 워크플로를 띄우지 못하는데, **`workflow_dispatch`와
`repository_dispatch`는 예외다**([GitHub 문서](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)).
그래서 `permissions: actions: write`만 주면 순찰이 「공고 수집」을 부를 수 있다.

`force=true`를 켜는 건 불려 간 쪽의 「감시」가 포털 목록에서 신규 0건을 보기 때문이다 —
안 켜면 상세 잡이 통째로 건너뛰어진다.

### 게시판분은 source가 다르다

| source | 어디서 | S3 무더기 파싱 대상 |
|---|---|---|
| `sh_scrape` | 서울주거포털 | ○ |
| `ish_247` | m_247 게시판 | ○ |
| `ish_board` | m_241 게시판 (2003년까지 백필 449건) | **✕** |

백필분까지 자동으로 파싱하면 남의 서버를 며칠 두드린다. 그래서 `s3_sh_complex`는 무더기로 훑을 때
`ish_board`를 뺀다. **다만 `--slug`으로 콕 집으면 source를 가리지 않는다**(2026-09-10 추가) —
순찰이 m_241에서 주워 온 신규분이 이 경로로 들어온다. 단지 0건 공고 백필도 이 경로다.

## 왜 Actions인가

Vercel Cron은 못 쓴다. **Hobby는 하루 1회가 최소**고 `0 * * * *` 같은 식은 배포 자체가 실패한다
([Vercel 문서](https://vercel.com/docs/cron-jobs/usage-and-pricing), 2026-09-10 확인).
요금제를 올려도 파이프라인이 Python이라(pyhwp·pdfplumber) 함수로 옮기는 값이 더 크다.

## 비용

private 저장소 Free는 **월 2,000분**이다. 매시 = 월 730회.

| | 도는 때 | 한 회 |
|---|---|---|
| 감시 (collect) | 매시 | ~1분 (경량 묶음 `requirements-collect.txt`) |
| 상세 (collect) | 신규 있을 때만 | 5~15분 (첨부 쪽수에 달림) |
| 순찰 (patrol) | 하루 1회 | ~3분 (경량 묶음. 마이홈 API는 1.7초로 끝난다) |
| 경쟁률 (patrol) | 하루 1회 | ~8분 (무거운 묶음 설치가 절반) |

감시만 도는 회차가 대부분이라 월 1,100분 언저리, 순찰이 30회 × 11분 = **+330분**. 합 1,400분대다.
넘치면 저장소를 public으로 돌리거나, 크론을 업무시간(`0 22-13 * * *` UTC = KST 07~22시)으로 좁히거나,
순찰의 경쟁률 잡을 이틀에 한 번(`40 21 */2 * *`)으로 늘린다.

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

Actions 탭 → 워크플로 고르기 → Run workflow.

「공고 수집」
- `force` — 신규가 없어도 상세까지 돈다
- `slugs` — 특정 공고만 (`sh-2026-310107-maeip sh-2026-310041-jaegaebal`)

「게시판 순찰」
- `since_year` — 이 해부터만 본다. 비우면 올해(KST). 백필하려면 `2015` 같은 값을 준다
- `skip_results` — 경쟁률 결과 글 파싱을 건너뛴다 (게시판만 급히 볼 때)

## 알아 둘 것

- **스케줄이 저절로 꺼진다.** private 저장소는 60일간 커밋이 없으면 GitHub이 크론을 멈춘다.
  메일이 오면 Actions 탭에서 다시 켠다
- **크론은 밀린다.** 5~20분은 예사고 부하가 크면 회차를 통째로 건너뛴다. 매시라 다음 회차가 메운다
- **첨부를 못 읽어도 목록은 이미 들어가 있다.** 조용히 빈 상세 페이지가 생기는 게 제일 위험해서
  파싱이 실패하면 이슈를 연다. 요약(Job Summary)에 공고별 단지 수가 찍힌다
- 요청 간격은 `SCRAPE_DELAY_SEC=1.5`로 로컬(1.0)보다 넉넉히 준다. 동시 요청은 걸지 않는다
