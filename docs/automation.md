# 자동 수집

워크플로가 둘이다.

| 워크플로 | 주기 | 보는 곳 |
|---|---|---|
| [`collect.yml`](../.github/workflows/collect.yml) 「공고 수집」 | 매시 :17 (UTC) | 서울주거포털 목록 → 신규만 첨부 파싱 |
| [`patrol.yml`](../.github/workflows/patrol.yml) 「게시판 순찰」 | 하루 1회 21:40 (UTC) | i-sh 게시판 m_247/m_241, 경쟁률 결과 글, 마이홈 API |

크론이 회차를 통째로 건너뛰는 게 실측돼서, 시각을 지키는 일은 **바깥 방아쇠**(`/api/cron/{잡}`)가
겹쳐서 맡는다 — 아래 「크론이 회차를 건너뛴다」 참고.

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

## 크론이 회차를 건너뛴다 — 바깥 방아쇠

**GitHub 스케줄은 이 저장소에서 한 번도 발화하지 않았다.** 2026-09-10 08:43 UTC 기준
`event=schedule` 실행 **0건**이다. 워크플로가 main에 올라간 05:37 UTC 이후 지나간 `:17` 슬롯 세 개
(06:17 · 07:17 · 08:17)가 전부 비었다.

### 배제한 원인 (전부 증거 있음)

| 의심 | 확인 | 결과 |
|---|---|---|
| push 안 됨 | `git ls-tree origin/main`, Contents API blob sha | 파일 둘 다 있음, sha 일치 |
| 워크플로 비활성 | `actions/workflows` | 둘 다 `state: active` |
| Actions 꺼짐 | `actions/permissions` | `enabled: true` |
| fork / 비기본브랜치 | `repo view` | fork 아님, 기본 `main` |
| 분 소진 | 08:34 UTC dispatch가 success | 분 남아 있음. 없으면 dispatch도 못 돈다 |
| 앞 회차 적체 | `status=queued/pending/waiting` | 전부 0건 |
| YAML · BOM · 크론 문법 | 원바이트 확인 (`name`으로 시작, `on:` 블록에 `^M` 없음) | 정상 |
| GitHub 장애 | status API components + incidents | Actions `operational`, 당일 사건 0건 |
| **`on:` 미등록** | **dispatch 5/5 성공** | **파싱됐다 (아래)** |

마지막 줄이 결정적이다. GitHub은 `on:` 블록에 `workflow_dispatch`가 없으면 dispatch API를 422로
거절한다. 우리 dispatch는 다섯 번 다 실행을 만들었다 — 즉 `on:` 블록은 정상 파싱됐고, **같은 블록 안의
`schedule: - cron: "17 * * * *"`도 함께 등록됐다.** 등록은 됐는데 배송만 안 온다.

### 우리만의 문제가 아니다

같은 증상 — **새 private 저장소, `workflow_dispatch`는 되는데 `schedule`만 절대 안 옴** — 신고가
GitHub 커뮤니티에 쌓여 있고, 확인한 것 전부 **GitHub 직원 답변 없이 미해결**이다.

- [community#202034](https://github.com/orgs/community/discussions/202034) — private 저장소 2곳, 최소 재현 케이스까지 만들었는데 schedule만 안 옴
- [community#201436](https://github.com/orgs/community/discussions/201436) — 새 private 저장소, dispatch 2회 성공했는데도 10시간 · 슬롯 8개 전부 유실
- [community#203822](https://github.com/orgs/community/discussions/203822) · [#199267](https://github.com/orgs/community/discussions/199267) · [#185355](https://github.com/orgs/community/discussions/185355) — 같은 패턴

공통 보고는 「새 저장소는 스케줄 큐에서 후순위로 밀리고 첫 발화까지 12~48시간, 영영 안 오기도 한다」이고
유일한 해법은 GitHub Support 티켓이다. 공식 문서도 보증하지 않는다 —
[events-that-trigger-workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)는
*"부하가 충분히 높으면 큐에 든 잡 일부가 버려질 수 있다"*고만 적는다. SLA 없고, 첫 발화 시점 명시 없고,
**버려진 사실은 어디에도 안 남는다.** API에 뜨는 건 실제로 만들어진 실행뿐이라 밖에서 캘 방법이 없다.

우리 저장소는 09-04 생성 · 워크플로 첫 push 09-10으로 신고 사례의 조건과 겹친다
(계정은 2019년생이라 계정 나이 탓은 아니다).

**결론: GitHub 스케줄을 방아쇠로 쓰지 않는다.** 지금 안 오는 것도, 나중에 붙었다가 조용히 끊기는 것도
우리가 관측할 수 없다. 워크플로의 `schedule:`은 지우지 않고 그대로 둔다 — 어쩌다 돌면 그것대로 이득이다.

그래서 시각을 지키는 일을 GitHub 밖으로 뺐다.

```
아무나 GET /api/cron/collect?secret=…      ← 횟수 제한 없음. 그냥 함수다
    │
    ├─ ingest_log 최신 (S1, sh_scrape) 조회      55분 안 지났으면 → skipped: fresh
    ├─ GitHub 실행 목록 queued/in_progress       도는 중이면    → skipped: running
    └─ 아니면 workflow_dispatch                                 → 202 dispatched
```

핵심은 **부를지 말지를 라우트가 판단한다**는 것이다. 그래서 때리는 쪽 정밀도가 필요 없다 —
무료 uptime 모니터(5분 간격), 실제 사용자 트래픽, Vercel Hobby 크론(하루 1회) 아무거나 되고,
**셋을 겹쳐 놔도 안전하다.** GitHub 크론도 그대로 둔다. 어쩌다 돌면 그것대로 이득이다.

잡은 둘. 순찰도 같은 이유로 못 믿기 때문이다.

| 경로 | 워크플로 | 판정 기준(ingest_log) | 최소 간격 |
|---|---|---|---|
| `/api/cron/collect` | `collect.yml` | `S1` / `sh_scrape` | 55분 |
| `/api/cron/patrol` | `patrol.yml` | `S1` / `ish_board` | 20시간 |

### 상태를 따로 안 적는 이유

판단 근거 둘 다 **읽기**다. web은 DB를 읽기만 한다(CLAUDE.md 디렉터리 경계). 「마지막 실행 시각」
테이블을 새로 두면 그걸 갱신할 책임이 생기고, 워크플로가 죽거나 손으로 돌렸을 때 실제와 어긋난다.
`ingest_log`는 파이프라인이 회차마다 이미 남기고 있고, 「지금 도는 중인가」는 GitHub 자신의 상태다.

### 준비 — 끝난 것

Vercel env 셋(`CRON_TRIGGER_SECRET` · `GITHUB_DISPATCH_TOKEN` · `GITHUB_REPO`)은 production·preview·
development 전부 들어갔다(2026-09-10). 셋 중 하나라도 없으면 라우트가 501로 답하고 아무 일도 안 한다.

**env는 빌드 시점에 박힌다.** 값을 넣거나 고친 뒤엔 재배포해야 붙는다 —
`vercel redeploy <배포 URL>`이면 소스 업로드 없이 된다. 처음에 이걸 안 해서 501이 계속 나왔다.

> `vercel deploy`를 CLI로 직접 돌리지 마라. Root Directory가 `web`이라 저장소 루트에서 올려야 하는데,
> 그러면 `pipeline/data/`까지 1.8GB를 올리다 100MB 제한에 걸린다. **배포는 git push(Git 연동)로 한다.**

**푸시 자동 배포는 꺼 두었다(2026-09-14, 사용자 결정).** `web/vercel.json`의 `git.deploymentEnabled.main: false`.
커밋·푸시마다 빌드가 도는 게 낭비라서다. 배포하고 싶을 때만 **Deploy Hook**을 때린다 —
Vercel 대시보드 → Settings → Git → Deploy Hooks에서 `main` 브랜치용으로 하나 만들어 두고
`curl -X POST <hook URL>`. 이 URL은 아는 사람이 곧 배포할 수 있는 토큰이니 저장소에 두지 않는다.
대시보드 Deployments → Redeploy로도 된다. Deploy Hook은 `github.enabled=false`일 때만 막히고
`git.deploymentEnabled`엔 영향받지 않는다(공식 문서 2026-09-14 확인).

### 방아쇠 둘 — 겹쳐 둔다

**① Cloudflare Worker (주 방아쇠, PC 무관).** `worker/`. 10분마다 `collect`와 `patrol`을 차례로 때린다.
시크릿은 Worker secret에 두고 **`x-cron-secret` 헤더로** 보낸다 — URL 쿼리로 안 넘기는 건 남의 로그에
평문으로 남지 않게 하기 위해서다.

```bash
cd worker
npx wrangler secret put CRON_TRIGGER_SECRET   # Vercel env와 같은 값
npx wrangler deploy
npx wrangler tail                              # 실행 로그를 실시간으로
```

배포한 Worker에는 손으로 확인할 구멍도 있다(같은 헤더로 잠가 둔다):

```bash
curl -H "x-cron-secret: <시크릿>" https://zipgonggo-cron.<계정>.workers.dev/
```

무료 플랜으로 충분하다 — 크론 트리거는 횟수 제한이 없고 하루 144회는 요청 한도(10만/일)에 한참 못 미친다.

**배포 전에 로컬로 발화시켜 볼 수 있다.** Cloudflare 로그인 없이 된다:

```bash
cd worker
printf 'CRON_TRIGGER_SECRET=<시크릿>
' > .dev.vars   # 저장소 밖으로 새지 않게 gitignore돼 있다
npx wrangler dev --test-scheduled                      # 8787로 뜬다
curl "http://127.0.0.1:8787/__scheduled?cron=*/10+*+*+*+*"   # 크론과 같은 경로로 발화
curl -H "x-cron-secret: <시크릿>" http://127.0.0.1:8787/     # 응답 본문까지 본다
```

> **함정: `scheduled()`에서 `ctx.waitUntil()`로 던지면 안 된다.** 핸들러가 먼저 끝나면서 작업이
> 통째로 버려진다. 2026-09-10 로컬 발화에서 응답이 **34ms에 끝나고 로그가 0줄**로 잡혔다.
> `await runAll(env)`로 붙들자 1380ms에 두 잡 다 200이 돌아왔다. 크론은 조용히 실패하면
> 아무도 모르니, 배포 전에 이 테스트를 꼭 한 번 돌린다.

**② Windows 예약 작업 `zipgonggo-cron` (보조).** 같은 PC에서 10분마다 당긴다.
스크립트는 `~/.zipgonggo/cron-trigger.ps1`(시크릿이 들어 있어 저장소 밖에 둔다), 로그는 같은 폴더의
`cron-trigger.log`. **PC가 켜져 있을 때만 도는 게 약점**이라 Worker를 주 방아쇠로 올렸다.
Worker가 붙은 뒤엔 지워도 되지만, 겹쳐도 안전하니 그냥 둔다.

```powershell
schtasks /Query /TN "zipgonggo-cron" /FO LIST     # 다음 회차 확인
schtasks /Run   /TN "zipgonggo-cron"              # 지금 한 번
Get-Content "$HOME\.zipgonggo\cron-trigger.log" -Tail 10
```

겹쳐도 안전한 근거는 라우트의 가드 넷이다 — 시크릿, 람다 인메모리 최근호출, `ingest_log` 나이,
GitHub 실행 상태. 다 뚫려도 워크플로의 `concurrency` 그룹이 줄을 세우고 파이프라인은 upsert다.
남는 좁은 창은 dispatch 직후 GitHub이 회차를 `queued`로 만들기까지 몇 초뿐이고,
그때 겹쳐 봐야 손해는 Actions 분 몇 개다.

**PAT는 Vercel env에만 둔다.** 외부 크론 서비스에 토큰을 넘기는 방식(`repository_dispatch`)을 안 고른
이유가 이거다 — 남의 서비스에 저장소 쓰기 권한을 맡기지 않는다.

### 실측 (2026-09-10)

| 확인 | 결과 |
|---|---|
| 잘못된 시크릿 | 401 |
| 모르는 잡 | 404 |
| `collect` 첫 호출 | **202** `dispatched: collect.yml`, `ageMin: 126` |
| 실제 워크플로 | 같은 초에 회차 생성 → `completed success` (run 34455885407) |
| 연타 3회 | 200 `skipped: fresh` — 감시 잡이 곧바로 `ingest_log`를 남겨 1분 안에 차단이 걸린다 |
| `patrol` | 200 `skipped: fresh`, `ageMin: 128 / needMin: 1200` |
| **`x-cron-secret` 헤더** | **`collect` 200 · `patrol` 200** — Worker가 쓸 경로. 헤더 없음 401, 틀린 값 401, 모르는 잡 404 |

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
- **크론은 밀리고, 아예 안 오기도 한다.** 5~20분 지연은 예사고 회차가 통째로 버려진다(2026-09-10 두 회차 연속 실측).
  다음 회차가 메우긴 하지만 그 다음도 온다는 보장이 없어 위 「바깥 방아쇠」를 뒀다
- **첨부를 못 읽어도 목록은 이미 들어가 있다.** 조용히 빈 상세 페이지가 생기는 게 제일 위험해서
  파싱이 실패하면 이슈를 연다. 요약(Job Summary)에 공고별 단지 수가 찍힌다
- 요청 간격은 `SCRAPE_DELAY_SEC=1.5`로 로컬(1.0)보다 넉넉히 준다. 동시 요청은 걸지 않는다
