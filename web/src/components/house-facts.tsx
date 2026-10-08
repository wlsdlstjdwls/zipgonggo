// 민간임대(청년안심주택) 단지 상세 「단지 정보」 — 포털 「주택찾기」 값(0027)을 시각 요소로 그린다.
//
// 라벨/값 격자로 두니 관리비 범위, 세대 구성, 입주 시점이 글자 덩어리로만 보였다(사용자 지적 2026-10-08:
// "단지정보 가시성 너무 별로"). 숫자가 비교되는 값은 막대로, 날짜는 경과로, 지하철은 노선 색 배지로 바꾼다.
// 글은 지어내지 않는다 — 포털이 준 문자열을 못 읽으면 그 문자열 그대로 적는다.
import { dateK, num, wonExact, wonKo } from "@/lib/format";
import type { YouthHouse } from "@/types/notice";

/** 서울 도시철도 노선 색(각 운영기관 공식 색). 모르는 노선은 회색 점 */
const LINE_COLORS: [RegExp, string][] = [
  [/^1호선/, "#0052A4"], [/^2호선/, "#00A84D"], [/^3호선/, "#EF7C1C"], [/^4호선/, "#00A5DE"],
  [/^5호선/, "#996CAC"], [/^6호선/, "#CD7C2F"], [/^7호선/, "#747F00"], [/^8호선/, "#E6186C"],
  [/^9호선/, "#BDB092"], [/^경의중앙/, "#77C4A3"], [/^공항/, "#0090D2"], [/^신분당/, "#D4003B"],
  [/^수인분당|^분당/, "#F5A200"], [/^우이신설/, "#B0CE18"], [/^신림/, "#6789CA"], [/^경춘/, "#0C8E72"],
  [/^GTX-?A/i, "#9A6292"], [/^서해/, "#8FC31F"], [/^김포골드/, "#AD8605"],
];
const lineColor = (name: string) => LINE_COLORS.find(([re]) => re.test(name))?.[1] ?? "var(--dim)";

/** `강변역 2호선, 경의중앙선` → 역 이름과 노선들. 꼴이 다르면 null(원문을 그대로 쓴다) */
function parseSubway(raw: string): { station: string; lines: string[] } | null {
  const m = /^(\S+역)\s+(.+)$/.exec(raw.trim());
  if (!m) return null;
  const lines = m[2].split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  return lines.length ? { station: m[1], lines } : null;
}

/** `총 98 세대 (공공임대 28 세대, 공공지원민간임대 70 세대)` → 총수와 갈래별 수. 합이 총수와 다르면 null */
function parseScale(raw: string): { total: number; parts: { label: string; n: number }[] } | null {
  const t = /총\s*([\d,]+)\s*세대/.exec(raw);
  if (!t) return null;
  const total = Number(t[1].replace(/,/g, ""));
  const parts = [...raw.matchAll(/([가-힣]+)\s*([\d,]+)\s*세대/g)]
    .filter((m) => m[1] !== "총")
    .map((m) => ({ label: m[1], n: Number(m[2].replace(/,/g, "")) }));
  if (parts.length < 2 || parts.reduce((a, p) => a + p.n, 0) !== total) return parts.length ? null : { total, parts: [] };
  return { total, parts };
}

/** 입주일 → 「입주 3년 차」/「입주까지 5개월」. 오늘 기준 */
function moveinAge(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 0) return -months <= 1 ? "곧 입주" : `입주까지 ${-months}개월`;
  if (months < 12) return months === 0 ? "이번 달 입주" : `입주 ${months}개월 차`;
  return `입주 ${Math.floor(months / 12) + 1}년 차`;
}

export function HouseFacts({ house }: { house: YouthHouse }) {
  const subway = house.subway ? parseSubway(house.subway) : null;
  const scale = house.scale ? parseScale(house.scale) : null;
  const lo = house.maint_low, hi = house.maint_high;
  const people = [
    ["운영사", house.manager], ["시행사", house.developer], ["시공사", house.builder], ["문의", house.phone],
  ].filter((r): r is [string, string] => !!r[1]);

  return (
    <div className="hf">
      {lo != null && (
        <div className="hf-card full">
          <span className="hf-k">월 관리비 <small>예상</small></span>
          {hi != null && hi !== lo ? (
            <div className="hf-bars">
              {/* 포털이 주는 두 값은 청년 기준과 신혼부부 기준이다(0027 주석). 막대 100% = 큰 쪽 */}
              {[["청년", lo], ["신혼부부", hi]].map(([who, v]) => (
                <div key={who as string} className="hf-bar">
                  <span className="who">{who}</span>
                  <span className="track" aria-hidden="true"><i style={{ width: `${((v as number) / hi) * 100}%` }} /></span>
                  <b title={wonExact(v as number)}>{wonKo(v as number)}</b>
                </div>
              ))}
            </div>
          ) : (
            <b className="hf-big" title={wonExact(lo)}>{wonKo(lo)}</b>
          )}
        </div>
      )}

      {scale && (
        <div className="hf-card full">
          <span className="hf-k">단지 규모</span>
          <b className="hf-big">{num(scale.total, "세대")}</b>
          {scale.parts.length >= 2 && (
            <>
              <span className="hf-stack" aria-hidden="true">
                {scale.parts.map((p, i) => <i key={p.label} className={i === 0 ? "a" : "b"} style={{ flexGrow: p.n }} />)}
              </span>
              <span className="hf-legend">
                {scale.parts.map((p, i) => (
                  <span key={p.label}><i className={i === 0 ? "a" : "b"} />{p.label} <b>{num(p.n, "세대")}</b></span>
                ))}
              </span>
            </>
          )}
        </div>
      )}
      {!scale && house.scale && (
        <div className="hf-card full"><span className="hf-k">단지 규모</span><b className="hf-text">{house.scale}</b></div>
      )}

      {house.movein && (
        <div className="hf-card">
          <span className="hf-k">입주 예정일</span>
          <b className="hf-big">{dateK(house.movein)}</b>
          {moveinAge(house.movein) && <span className="hf-chip">{moveinAge(house.movein)}</span>}
        </div>
      )}

      {house.subway && (
        <div className="hf-card">
          <span className="hf-k">지하철</span>
          {subway ? (
            <>
              <b className="hf-big">{subway.station}</b>
              <span className="hf-lines">
                {subway.lines.map((l) => <span key={l} className="hf-line"><i style={{ background: lineColor(l) }} />{l}</span>)}
              </span>
            </>
          ) : <b className="hf-text">{house.subway}</b>}
        </div>
      )}

      {people.length > 0 && (
        <dl className="hf-people">
          {people.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </div>
  );
}
