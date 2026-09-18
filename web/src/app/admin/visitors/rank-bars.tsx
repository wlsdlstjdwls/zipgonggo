// 순위를 막대로. 숫자만 세로로 쌓으면 「1등이 2등의 두 배인가 스무 배인가」가 안 읽힌다.
//
// 세로 막대(일별 추이)와 달리 **가로 막대**다 — 항목 이름이 「네이버 블로그」처럼 길어서
// 세로로 세우면 라벨을 90도 눕혀야 하고, 개수가 20개면 이름이 서로 겹친다.
//
// 값은 언제나 **막대 옆에 숫자로도** 적는다. 막대는 비율을 보여줄 뿐 값을 대신하지 않는다.
import type { ChannelKind } from "@/lib/analytics";

/** 표 칸에 들어가는 작은 막대. 「방문」 숫자 왼쪽에 붙어 같은 값을 폭으로 한 번 더 말한다 */
export function BarCell({ value, max, views }: { value: number; max: number; views?: number }) {
  const w = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return (
    <span className="adm-bar" title={views === undefined ? undefined : `방문 ${value}명 | 조회 ${views}뷰`}>
      <span className="adm-bar-track">
        <i style={{ width: `${w}%` }} />
      </span>
      <b>{value.toLocaleString("ko-KR")}</b>
    </span>
  );
}

/** 막대 한 줄이 들고 있는 값 */
export type BarRow = {
  key: string;
  label: string;
  kind?: ChannelKind;
  visitors: number;
  views: number;
  /** 접어 둘 상세(채널 아래의 실제 도메인들) */
  detail?: string[];
};

const KIND_LABEL: Record<ChannelKind, string> = {
  sns: "SNS",
  search: "검색",
  direct: "직접",
  etc: "기타",
};

/**
 * 가로 막대 목록.
 *
 * 비율(share)의 분모는 **부르는 쪽이 정한다** — 「전체 유입 중 몇 %」와 「SNS 중 몇 %」는
 * 같은 화면에 나란히 서는 다른 질문이라, 여기서 합계를 멋대로 구하면 둘 중 하나가 거짓이 된다.
 */
export function RankBars({ rows, total, empty }: { rows: BarRow[]; total: number; empty?: string }) {
  if (rows.length === 0) return <p className="adm-note">{empty ?? "아직 기록이 없다."}</p>;

  const max = Math.max(...rows.map((r) => r.visitors), 1);

  return (
    <ul className="rz">
      {rows.map((r) => {
        const w = Math.max((r.visitors / max) * 100, r.visitors > 0 ? 2 : 0);
        const share = total > 0 ? Math.round((r.visitors / total) * 100) : 0;
        return (
          <li key={r.key} className={`rz-row k-${r.kind ?? "etc"}`}>
            <span className="rz-name">
              {r.kind && <em className={`rz-kind k-${r.kind}`}>{KIND_LABEL[r.kind]}</em>}
              <b>{r.label}</b>
              {r.detail && r.detail.length > 0 && (
                <i title={r.detail.join(" | ")}>
                  {r.detail.length === 1 ? r.detail[0] : `${r.detail[0]} 외 ${r.detail.length - 1}`}
                </i>
              )}
            </span>
            <span className="rz-val">
              {r.visitors.toLocaleString("ko-KR")}
              <small>
                {share}% | {r.views.toLocaleString("ko-KR")}뷰
              </small>
            </span>
            <span className="rz-track">
              <i style={{ width: `${w}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
