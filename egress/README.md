# egress — 한국에서 나가는 구멍

`api/index.js` 하나가 전부다. 받은 URL로 GET/POST 하고 바이트를 그대로 돌려준다.
**파싱하지 않는다. DB를 만지지 않는다.**

## 왜 따로 사는가

한국 정부·서울시 사이트가 GitHub Actions 러너(Azure 미국) IP의 TCP 연결을 간헐로 안 받는다.
`apis.data.go.kr` · `business.juso.go.kr` · `housing.seoul.go.kr` 셋 다 ConnectTimeout으로 끝나고,
같은 시각 한국 회선에선 전부 0.04초에 붙는다(2026-09-16 실측).

처음엔 `web`에 라우트로 뒀는데 `preferredRegion = "icn1"`이 **안 먹었다** — `zipgonggo` 프로젝트는
Fluid Compute가 켜져 있고(`functionDefaultRegions: ["iad1"]`), Fluid는 함수별 리전 지정을 무시하고
프로젝트 기본 리전에서 전부 돌린다. 200은 오는데 `x-egress-region`이 `iad1`이었다.
web의 Fluid를 끄면 사용자 화면이 느려지니 **리전만 다른 별도 프로젝트**로 뗐다.

덤 — CLAUDE.md의 「web과 pipeline은 DB 스키마로만 통신한다」 경계를 안 뚫어도 됐다.

## 배포

```
cd egress
npx vercel link            # 프로젝트 zipgonggo-egress
npx vercel env add EGRESS_SECRET production
npx vercel deploy --prod --yes
```

리전은 `vercel.json`의 `regions`가 정한다. **배포 뒤 반드시 확인한다** —

```
curl -sD- -o/dev/null -H "x-egress-secret: <키>" \
  "https://<배포주소>/api?url=https%3A%2F%2Fhousing.seoul.go.kr%2F" | grep -i x-egress-region
```

`icn1`이 아니면 우회가 통째로 무의미하다. 그 상태로 켜면 지연만 늘고 같은 차단을 맞는다.

## 부르는 쪽

`pipeline/src/zipgonggo_pipeline/sources/egress.py`. 환경변수 둘이 다 있어야 켜진다 —
`EGRESS_PROXY_URL` · `EGRESS_SECRET`(web/Vercel의 값과 같아야 한다, **ASCII로**).
비우면 지금까지처럼 직접 나간다. 로컬(한국)은 비워 두는 게 맞다.

허용 호스트 목록은 **여기가 문지기다.** `ALLOWED_HOSTS`(이 파일)와 `PROXIED_HOSTS`(파이썬 쪽)를
같이 고친다 — 한쪽만 늘리면 403이 돌아온다.
