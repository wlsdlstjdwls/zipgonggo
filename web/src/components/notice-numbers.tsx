// 공고 상세 「지난 경쟁률과 공급」 — 이 공고를 같은 유형의 지난 회차, 계층, 다른 기관 옆에 그래프로 놓는다
// (사용자 요청 2026-10-12: 메뉴 대신 공고 상세에서, 그래프로).
//
// 서버 컴포넌트, 차트 라이브러리 없이 HTML 막대로 그린다. 계열은 늘 하나라 범례가 없고 색은 강조색 한 가지다 —
// 이 공고(또는 이 공고 기관)만 진하게, 나머지는 흐리게. 값은 막대 끝 글자와 마우스를 올리면 뜨는 말풍선(data-tip)으로 읽고,
// 회차 그래프는 숫자를 다 찍지 않는다(가장 높은 회차와 가장 최근 회차만). 대신 「표로 보기」에 전부 있다.
import Link from "next/link";
import { dateK, num } from "@/lib/format";
import type { SupplyGroup, TypeCompetition } from "@/lib/queries";
import { noticePath, statsTypePath, ROUTES } from "@/lib/routes";

type Props = {
  housingType: string;
  agency: string;
  slug: string;
  supplyCount: number | null;
  windowDays: number;
  /** 같은 유형의 기관별 공급(최근 windowDays일) */
  supply: SupplyGroup[];
  /** 같은 유형 결과 공고. 경쟁률 지면이 서는 유형만 */
  comp: TypeCompetition | null;
};

const ratioText = (r: number | null | undefined) => (r == null ? "—" : `${r} : 1`);
/** 표 줄 5분의 1 넘게 깨진 회차 — 읽은 단지만 센 값이다(/stats/{유형}과 같은 기준) */
const partial = (r: { rows_all: number; rows_bad: number }) => r.rows_all > 0 && r.rows_bad / r.rows_all > 0.2;

export function NoticeNumbers({ housingType, agency, slug, supplyCount, windowDays, supply, comp }: Props) {
  // 회차는 옛것부터 왼쪽으로. 많아야 열 남짓이라 다 싣는다
  const rounds = comp ? [...comp.rounds].reverse() : [];
  const maxRatio = Math.max(1, ...rounds.map((r) => r.ratio));
  // 가장 높은 회차 라벨은 온전히 읽힌 회차에서만 — 일부만 읽힌 회차의 값을 대표값처럼 세우지 않는다
  const peak = rounds.reduce<number>((best, r, i) => (!partial(r) && (best < 0 || r.ratio > rounds[best].ratio) ? i : best), -1);
  const classes = comp
    ? comp.byClass.filter((r) => r.bracket === "소계").sort((a, b) => b.ratio - a.ratio)
    : [];
  const maxClass = Math.max(1, ...classes.map((c) => c.ratio));
  const agencies = supply.filter((g) => g.units > 0);
  const maxUnits = Math.max(1, ...agencies.map((g) => g.units));
  const typeUnits = agencies.reduce((s, g) => s + g.units, 0);

  if (rounds.length < 2 && classes.length === 0 && agencies.length === 0) return null;

  return (
    <section className="dsec" id="numbers">
      <h2>지난 경쟁률과 공급</h2>

      {rounds.length >= 2 && comp && (
        <figure className="nn-fig">
          <figcaption>
            <b>{comp.agency} {housingType} 회차별 경쟁률</b>
            <small>신청자 합계 ÷ 모집 호수. 막대를 누르면 그 공고로 간다</small>
          </figcaption>
          <ol className="nn-cols" aria-label={`${housingType} 회차별 경쟁률`}>
            {rounds.map((r, i) => {
              const me = r.slug === slug;
              const label = i === peak || i === rounds.length - 1 || me;
              const tip = `${dateK(r.posted_at)} 공고 | 단지 ${num(r.complexes, "곳")}, 모집 ${num(r.units, "호")}, 신청 ${num(r.applicants, "명")} | ${ratioText(r.ratio)}${partial(r) ? " | 일부 단지만 읽힘" : ""}`;
              return (
                <li key={r.slug} className={`${me ? "me" : ""}${partial(r) ? " part" : ""}`}>
                  <Link href={noticePath(r.slug)} data-tip={tip} aria-label={tip}>
                    <span className="nn-col-v">{label ? ratioText(r.ratio) : ""}</span>
                    <span className="nn-col-t"><i style={{ height: `${Math.max(3, Math.round((r.ratio / maxRatio) * 100))}%` }} /></span>
                    <span className="nn-col-x">{r.posted_at.slice(2, 7).replace("-", ".")}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {rounds.some(partial) && <p className="nn-note">흐린 막대는 결과 표 글자가 깨져 일부 단지만 읽힌 회차다.</p>}
          <details className="nn-table">
            <summary>표로 보기</summary>
            <table>
              <thead><tr><th>공고일</th><th className="n">단지</th><th className="n">모집</th><th className="n">신청</th><th className="n">경쟁률</th></tr></thead>
              <tbody>
                {comp.rounds.map((r) => (
                  <tr key={r.slug}>
                    <td><Link href={noticePath(r.slug)}>{dateK(r.posted_at)}</Link>{partial(r) && " (일부)"}</td>
                    <td className="n">{num(r.complexes, "곳")}</td><td className="n">{num(r.units, "호")}</td>
                    <td className="n">{num(r.applicants, "명")}</td><td className="n">{ratioText(r.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      )}

      {classes.length > 0 && (
        <figure className="nn-fig">
          <figcaption>
            <b>{classes.some((c) => /청년|신혼|고령|대학생/.test(c.key)) ? "계층별" : "구분별"} 경쟁률</b>
            <small>지난 {num(rounds.length, "회차")}를 합쳐서</small>
          </figcaption>
          <ul className="nn-bars solid">
            {classes.map((c) => (
              <li key={c.key} data-tip={`${c.key} | 모집 ${num(c.units, "호")}, 신청 ${num(c.applicants, "명")}`}>
                <span className="nn-bar-l">{c.key}</span>
                <span className="nn-bar-t"><i style={{ width: `${Math.max(2, Math.round((c.ratio / maxClass) * 100))}%` }} /></span>
                <span className="nn-bar-v">{ratioText(c.ratio)}</span>
              </li>
            ))}
          </ul>
        </figure>
      )}

      {agencies.length > 0 && (
        <figure className="nn-fig">
          <figcaption>
            <b>최근 {windowDays}일 {housingType} 공급, 기관별</b>
            <small>
              모두 {num(typeUnits, "호")}
              {supplyCount != null && supplyCount > 0 && <> | 이 공고 {num(supplyCount, "호")}</>}
            </small>
          </figcaption>
          <ul className="nn-bars">
            {agencies.slice(0, 8).map((g) => (
              <li key={g.key} className={g.key === agency ? "me" : undefined} data-tip={`${g.key} | 공고 ${num(g.notices, "건")}, 공급 ${num(g.units, "호")}`}>
                <span className="nn-bar-l">{g.key}{g.key === agency && <small>이 공고</small>}</span>
                <span className="nn-bar-t"><i style={{ width: `${Math.max(2, Math.round((g.units / maxUnits) * 100))}%` }} /></span>
                <span className="nn-bar-v">{num(g.units, "호")}</span>
              </li>
            ))}
          </ul>
        </figure>
      )}

      <p className="num-links">
        {comp && <Link href={statsTypePath(housingType)}>자치구별, 단지별 경쟁률까지 보기 →</Link>}
        <Link href={ROUTES.stats}>다른 유형과 지역 공급 보기 →</Link>
      </p>
    </section>
  );
}
