// 일별 방문자 막대. **한 계열뿐이라 범례를 두지 않는다**(제목이 곧 계열 이름이다).
// 조회수는 같은 막대의 tooltip에 같이 싣는다 — 축을 둘로 나누면 안 되고(dual axis),
// 계열을 둘로 그리면 「방문 20명, 조회 105」처럼 자릿수가 달라 작은 쪽이 바닥에 깔린다.
//
// SVG가 아니라 평범한 div다. 365일까지 가로로 늘어나는데, SVG viewBox로 줄이면 막대가
// 실뭉치가 되고 stroke까지 같이 줄어든다. div는 최소 너비를 주고 가로 스크롤로 넘긴다.
import type { DayPoint } from "@/lib/analytics";

/** 「09.16」. 축 라벨은 연도를 빼고 짧게 */
function md(day: string): string {
  const [, m, d] = day.split("-");
  return `${m}.${d}`;
}

export function VisitChart({ days }: { days: DayPoint[] }) {
  if (days.length === 0) return <p className="adm-note">아직 기록이 없다.</p>;

  const max = Math.max(...days.map((d) => d.visitors), 1);
  const peak = days.reduce((a, b) => (b.visitors > a.visitors ? b : a));
  // 값이 전부 0이면 막대가 하나도 안 보인다 — 바닥선만 그려 「기록은 도는데 방문이 없다」를 말한다
  const empty = days.every((d) => d.visitors === 0);

  return (
    <figure className="vz">
      <div className="vz-plot" role="img" aria-label={`최근 ${days.length}일 일별 방문자. 최대 ${max}명`}>
        {days.map((d) => {
          const h = (d.visitors / max) * 100;
          return (
            <div key={d.day} className="vz-col" title={`${d.day} 방문 ${d.visitors}명 | 조회 ${d.views}뷰`}>
              {d.day === peak.day && !empty && <b className="vz-peak">{d.visitors}</b>}
              <span className="vz-bar" style={{ height: `${Math.max(h, d.visitors > 0 ? 3 : 0)}%` }} />
            </div>
          );
        })}
      </div>
      <figcaption className="vz-axis">
        <span>{md(days[0].day)}</span>
        {/* 눈금을 촘촘히 깔면 서로 겹친다. 양끝과 최대값 날짜만 말한다 */}
        {!empty && <span className="vz-mid">최대 {md(peak.day)}</span>}
        <span>{md(days[days.length - 1].day)}</span>
      </figcaption>
      {/* 표 보기 — 색과 높이만으로 못 읽는 사람을 위한 같은 값의 다른 길 */}
      <details className="adm-err vz-table">
        <summary>표로 보기</summary>
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th className="num">방문</th>
              <th className="num">조회</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td className="num">{d.visitors}</td>
                <td className="num">{d.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
