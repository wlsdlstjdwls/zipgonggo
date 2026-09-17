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
import { ROUTES } from "@/lib/routes";
import { VisitChart } from "./visit-chart";
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
                  <td className="num">{p.visitors}</td>
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
          유입 출처
          <small>페이지를 새로 연 첫 조회만</small>
        </h2>
        <div className="adm-table">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>출처</th>
                <th className="num">방문</th>
                <th className="num">조회</th>
              </tr>
            </thead>
            <tbody>
              {report.refs.map((x, i) => (
                <tr key={x.host ?? "direct"}>
                  <td className="num">{i + 1}</td>
                  <td>{x.host ?? "직접 유입"}</td>
                  <td className="num">{x.visitors}</td>
                  <td className="num">{x.views}</td>
                </tr>
              ))}
              {report.refs.length === 0 && (
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
