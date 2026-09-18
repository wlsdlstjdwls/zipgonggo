// 방문 — 동시접속과 오늘·누적, 일별 추이, 인기 경로, 유입 출처.
//
// 숫자의 출처는 우리 `page_view` 표 하나다(GA도 Vercel Analytics도 안 쓴다).
// **봇은 세 겹으로 걸러서 들어온 것만 센다** — 집계가 JS 비콘이라 스크립트를 안 도는 크롤러는
// 애초에 못 들어오고, 라우트가 User-Agent를 막고, 자동화 브라우저는 제 쪽에서 안 쏜다.
// 그래서 여기 숫자는 「구글 애널리틱스보다 작게」 나오는 게 정상이다.
import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import {
  analyticsOn, ANALYTICS_START, DEFAULT_RANGE, pathKind, RANGES, rangeOf, visitorReport, ONLINE_MIN,
} from "@/lib/analytics";
import { foldChannels, UTM_HINTS, UTM_HOST, channelOf } from "@/lib/analytics";
import { ROUTES } from "@/lib/routes";
import { VisitChart } from "./visit-chart";
import { BarCell, RankBars, type BarRow } from "./rank-bars";
import { TrackToggle } from "./track-toggle";

export const dynamic = "force-dynamic";

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="adm-stat">
      <span>{label}</span>
      <b>{value.toLocaleString("ko-KR")}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

export default async function AdminVisitors({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  if (!(await isAdmin())) return null;

  const { r } = await searchParams;
  const range = rangeOf(r);
  const report = await visitorReport(range.days);

  // 도메인을 채널로 접는다. `l.instagram.com`과 `instagram.com`은 같은 인스타그램이다
  const channels = foldChannels(report.refs);
  const refTotal = channels.reduce((n, c) => n + c.visitors, 0);
  const sns = channels.filter((c) => c.kind === "sns");
  const snsTotal = sns.reduce((n, c) => n + c.visitors, 0);
  const direct = channels.find((c) => c.kind === "direct");
  const pathMax = Math.max(...report.paths.map((p) => p.visitors), 1);

  const toRow = (c: (typeof channels)[number]): BarRow => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    visitors: c.visitors,
    views: c.views,
    detail: c.hosts.map((h) => h.host).filter((h): h is string => Boolean(h)),
  });

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1>방문</h1>
        <p className="adm-sub">
          봇과 운영자는 빼고 센다. 최근 {ONLINE_MIN}분 안에 움직인 사람을 동시접속으로 본다
        </p>
        {/* 집계 시작일 전에는 라우트가 204만 돌려주고 한 줄도 안 적는다. 그 사실을 화면에 안 적어 두면
            「숫자가 0이다」와 「집계가 꺼져 있다」를 구분할 길이 없다(2026-09-17에 한 번 겪었다) */}
        {!analyticsOn() && (
          <p className="adm-sub">
            <strong>집계가 아직 안 켜졌다.</strong> {ANALYTICS_START}부터 적는다 — 그때까지는 무엇을
            해도 0이다(env ANALYTICS_START로 당길 수 있고, 개인정보처리방침 시행일도 같이 옮겨야 한다)
          </p>
        )}
      </header>

      <div className="adm-stats">
        <Stat label="동시접속" value={report.online} note={`최근 ${ONLINE_MIN}분`} />
        <Stat
          label="오늘 방문"
          value={report.todayVisitors}
          note={`${report.todayViews.toLocaleString("ko-KR")}뷰`}
        />
        <Stat
          label="누적 방문"
          value={report.totalVisitors}
          note={`${report.totalViews.toLocaleString("ko-KR")}뷰`}
        />
        {/* 기본 기간(1일)에서는 이 칸이 「오늘 방문」과 글자까지 같은 값이 된다. 같은 숫자를 두 번 놓지 않는다 */}
        {range.days > 1 && (
          <Stat
            label={`${range.label} 방문`}
            value={report.rangeVisitors}
            note={`${report.rangeViews.toLocaleString("ko-KR")}뷰`}
          />
        )}
      </div>

      <div className="adm-chips" role="group" aria-label="기간">
        {RANGES.map((x) => (
          <Link
            key={x.key}
            href={x.key === DEFAULT_RANGE.key ? ROUTES.adminVisitors : `${ROUTES.adminVisitors}?r=${x.key}`}
            className={x.key === range.key ? "on" : ""}
          >
            {x.label}
          </Link>
        ))}
      </div>

      <section className="adm-sec">
        <h2>일별 방문자</h2>
        <VisitChart days={report.days} />
      </section>

      <section className="adm-sec">
        <h2>
          인기 경로
          <small>{range.label} 기준 {report.pathTotal}개 중 상위 {report.paths.length}개</small>
        </h2>
        <div className="adm-table">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>경로</th>
                <th className="num">방문</th>
                <th className="num">조회</th>
              </tr>
            </thead>
            <tbody>
              {report.paths.map((p, i) => (
                <tr key={p.path}>
                  <td className="num">{i + 1}</td>
                  <td>
                    {/* 경로만 있으면 「/notice/sh-2026-…」이라 무슨 지면인지 안 읽힌다 */}
                    <b>{pathKind(p.path)}</b>{" "}
                    <a href={p.path} target="_blank" rel="noreferrer" className="adm-path">
                      {decodeURIComponent(p.path)}
                    </a>
                  </td>
                  <td className="num">
                    <BarCell value={p.visitors} max={pathMax} views={p.views} />
                  </td>
                  <td className="num">{p.views}</td>
                </tr>
              ))}
              {report.paths.length === 0 && (
                <tr>
                  <td colSpan={4}>아직 기록이 없다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="adm-sec">
        <h2>
          유입 채널
          <small>페이지를 새로 연 첫 조회만 | {range.label} 기준</small>
        </h2>
        <RankBars rows={channels.map(toRow)} total={refTotal} />
        {/* 채널로 접으면 「인스타그램 12」는 보이지만 그게 l.instagram.com인지 ig.me인지는 사라진다.
            묶는 규칙이 맞는지 의심될 때 열어 보는 자리 */}
        {report.refs.length > 0 && (
          <details className="adm-err vz-table">
            <summary>도메인 그대로 보기</summary>
            <table>
              <thead>
                <tr>
                  <th>도메인</th>
                  <th>채널</th>
                  <th className="num">방문</th>
                  <th className="num">조회</th>
                </tr>
              </thead>
              <tbody>
                {report.refs.map((x) => (
                  <tr key={x.host ?? "direct"}>
                    <td>{x.host ?? "(없음)"}</td>
                    <td>{channelOf(x.host).label}</td>
                    <td className="num">{x.visitors}</td>
                    <td className="num">{x.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <section className="adm-sec">
        <h2>
          SNS 유입
          <small>
            {snsTotal.toLocaleString("ko-KR")}명 | 전체 유입의{" "}
            {refTotal > 0 ? Math.round((snsTotal / refTotal) * 100) : 0}%
          </small>
        </h2>
        {/* 분모가 SNS 합계다. 「올린 글 가운데 어디가 먹혔나」를 보는 자리라 검색·직접은 빼고 센다 */}
        <RankBars
          rows={sns.map(toRow)}
          total={snsTotal}
          empty="SNS에서 들어온 기록이 아직 없다. 아래 표식을 붙인 주소로 올리면 여기 쌓인다."
        />
        <p className="adm-note">
          <strong>카카오톡과 인스타그램의 인앱 브라우저는 들어온 곳을 안 알려 준다.</strong> 그대로 두면
          SNS에서 온 사람이 전부 「직접 유입」으로 뭉친다
          {direct && direct.visitors > 0 && <> — 지금 {direct.visitors.toLocaleString("ko-KR")}명이 그 칸에 있다</>}.
          글을 올릴 때 주소 뒤에 <code>?utm_source=</code>를 붙이면 그 값으로 갈라 볼 수 있다. 붙일 수 있는 값은
          아래뿐이고, 모르는 값은 기록하지 않는다. 주소에 물음표가 이미 있으면 <code>&amp;</code>로 잇는다.
        </p>
        <div className="adm-chips adm-utm">
          {UTM_HINTS.map((k) => (
            <span key={k}>
              ?utm_source={k}
              <i>{channelOf(UTM_HOST[k]).label}</i>
            </span>
          ))}
        </div>
      </section>

      <section className="adm-sec">
        <h2>
          이 브라우저
          <small>표식은 브라우저마다 따로 둔다</small>
        </h2>
        <TrackToggle />
        <p className="adm-note">
          콘솔에 처음 들어온 브라우저는 집계에서 빠진다 — 운영자가 제 사이트를 돌아다닌 것까지 세면
          초기 숫자가 통째로 거짓이 된다. 집계가 도는지 직접 확인할 때만 잠깐 켜고, 확인이 끝나면 다시 뺀다.
        </p>
      </section>
    </div>
  );
}
