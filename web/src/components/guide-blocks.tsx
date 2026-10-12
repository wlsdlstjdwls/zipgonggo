// 안내 글(/guide/{글})의 데이터 블록. 글(lib/guides.ts)은 「아래 표」라고만 쓰고 숫자는 여기서 렌더 때 DB에서 읽는다.
// 블록마다 출처와 기준일을 캡션으로 단다 — 무엇을 어디서 셌는지 안 밝힌 숫자는 글의 신뢰를 깎는다.
// 서버 컴포넌트다. 표는 좁은 화면에서 표 안에서만 가로로 밀린다(페이지는 안 밀린다).
import Link from "next/link";
import { HubAreaBars, HubIncome } from "./hub-blocks";
import { convertRange, CONVERT_LIMIT_SHARE, CONVERT_RATE_DOWN, CONVERT_RATE_UP } from "@/lib/calc";
import { ageRuleText, carRuleText, incomeLimit, regionRuleText } from "@/lib/eligibility";
import { num, wonExact, wonKo } from "@/lib/format";
import type { GuideBlock } from "@/lib/guides";
import { housingTypeDoc } from "@/lib/housing-types";
import {
  getCompetitionStats, getEligibilityRules, getRentStats, getScheduleStats, getWaitlistStats, listTypeHubs,
} from "@/lib/queries";
import { typePath } from "@/lib/routes";
import { sidoShort } from "@/lib/sido";
import type { SupplyType } from "@/types/eligibility";

const MAN = 10_000;

export function Caption({ children }: { children: React.ReactNode }) {
  return <p className="g-cap">{children}</p>;
}

export function Table({ head, rows, num: numCols = [] }: { head: string[]; rows: React.ReactNode[][]; num?: number[] }) {
  return (
    <div className="g-table-wrap">
      <table className="g-table">
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={numCols.includes(i) ? "n" : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={numCols.includes(j) ? "n" : undefined}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 유형 이름 — 허브 글이 있는 유형만 링크 */
function TypeName({ t }: { t: string }) {
  return housingTypeDoc(t) ? <Link href={typePath(t)}>{t}</Link> : <>{t}</>;
}

async function IncomeBlock({ pcts }: { pcts: number[] }) {
  const rules = await getEligibilityRules();
  // HubIncome은 유형 목록에서 비율을 뽑는다 — 비율만 가진 가짜 유형을 건넨다
  const types = pcts.map((p) => ({ income_pct: p }) as SupplyType);
  return (
    <>
      <HubIncome types={types} income={rules.income} year={rules.incomeYear} />
      <Caption>출처: 국토교통부가 고시한 {rules.incomeYear}년 도시근로자 가구당 월평균소득. 탭을 눌러 비율을 바꿔 본다.</Caption>
    </>
  );
}

async function WaitlistTypeBlock() {
  const { byType } = await getWaitlistStats();
  if (byType.length === 0) return null;
  const surveyed = byType.map((r) => r.surveyed_on).sort().at(-1);
  return (
    <>
      <Table
        head={["유형", "단지", "추첨 단위", "대기 인원", "퇴거", "대기 0명", "단위당 대기(중앙값)"]}
        num={[1, 2, 3, 4, 5, 6]}
        rows={byType.map((r) => [
          <TypeName key="t" t={r.housing_type} />,
          num(r.complexes, "곳"), num(r.rows, "줄"), num(r.waiting, "명"), num(r.vacated, "건"), `${r.zero_pct}%`, num(r.median, "명"),
        ])}
      />
      <Caption>출처: 국토교통부 마이홈포털 예비입주자 대기현황(공공데이터포털). 단지마다 가장 최근 조사분만 더했다. 최근 조사일 {surveyed}. 단지 다섯 곳 미만인 유형은 뺐다.</Caption>
    </>
  );
}

async function WaitlistSidoBlock() {
  const { bySido } = await getWaitlistStats();
  if (bySido.length === 0) return null;
  return (
    <>
      <Table
        head={["시도", "추첨 단위", "대기 인원", "퇴거", "퇴거 대비 대기", "대기 0명"]}
        num={[1, 2, 3, 4, 5]}
        rows={bySido.map((r) => {
          const ratio = r.vacated > 0 ? r.waiting / r.vacated : null;
          return [
            sidoShort(r.sido), num(r.rows, "줄"), num(r.waiting, "명"), num(r.vacated, "건"),
            <span key="r" className="g-ratio">
              <i style={{ width: `${ratio == null ? 100 : Math.min(100, Math.round(ratio * 50))}%` }} className={ratio != null && ratio <= 1 ? "ok" : undefined} />
              <b>{ratio == null ? "퇴거 없음" : `${ratio.toFixed(1)}배`}</b>
            </span>,
            `${r.zero_pct}%`,
          ];
        })}
      />
      <Caption>출처: 국토교통부 마이홈포털 예비입주자 대기현황. 단지마다 최근 조사분. 추첨 단위 20줄 미만 시도는 뺐다. 「퇴거 대비 대기」가 1배 이하면 대기보다 퇴거가 많다.</Caption>
    </>
  );
}

async function RentTypeBlock() {
  const rows = await getRentStats();
  if (rows.length === 0) return null;
  return (
    <>
      <Table
        head={["유형", "주택형", "전용면적", "기본 보증금", "월임대료", "㎡당 월임대료", "전환 한도"]}
        num={[1, 2, 3, 4, 5, 6]}
        rows={rows.map((r) => [
          <TypeName key="t" t={r.housing_type} />,
          num(r.types, "개"), `${r.area}㎡`,
          <span key="d" title={wonExact(r.deposit)}>{wonKo(r.deposit)}</span>,
          <span key="m" title={wonExact(r.rent)}>{wonKo(r.rent)}</span>,
          `${num(r.rent_per_m2)}원`,
          r.conv_share == null ? "—" : `보증금의 ${r.conv_share}배`,
        ])}
      />
      <Caption>출처: 국토교통부 마이홈포털 공공임대주택 단지정보. 주택형별 기본 금액의 중앙값이고 관리비는 빠져 있다. 주택형 20개 미만 유형은 뺐다.</Caption>
    </>
  );
}

async function ConvertBlock() {
  const rows = await getRentStats();
  const happy = rows.find((r) => r.housing_type === "행복주택") ?? rows[0];
  if (!happy) return null;
  const r = convertRange(happy.deposit, happy.rent);
  const line = (label: string, c: { deposit: number; rent: number }, hot?: boolean) => [
    hot ? <b key="l">{label}</b> : label,
    <span key="d" title={wonExact(c.deposit)}>{wonKo(c.deposit)}</span>,
    <span key="m" title={wonExact(c.rent)}>{wonKo(c.rent)}</span>,
    <span key="y" title={wonExact(c.rent * 12)}>{wonKo(c.rent * 12)}</span>,
  ];
  return (
    <>
      <Table
        head={["조합", "보증금", "월임대료", "한 해 임대료"]}
        num={[1, 2, 3]}
        rows={[
          line("보증금 최대(전세전환)", r.max),
          line("기본 금액", r.base, true),
          line("보증금 최소(월세전환)", r.min),
        ]}
      />
      <Caption>
        {happy.housing_type} 주택형 {num(happy.types, "개")}의 기본 금액 중앙값({happy.area}㎡)으로 계산했다. 올릴 때 연 {CONVERT_RATE_UP}%,
        내릴 때 연 {CONVERT_RATE_DOWN}%, 한도는 월임대료와 보증금의 {Math.round(CONVERT_LIMIT_SHARE * 100)}%. 월임대료는 100원 단위로 끊었다.
      </Caption>
    </>
  );
}

async function CompetitionBlock() {
  const rows = await getCompetitionStats();
  if (rows.length === 0) return null;
  return (
    <>
      <Table
        head={["공고 연도", "유형", "공고", "줄", "중앙값", "상위 10%", "가장 높은 줄"]}
        num={[0, 2, 3, 4, 5, 6]}
        rows={rows.map((r) => [
          `${r.year}년`, <TypeName key="t" t={r.housing_type} />, num(r.notices, "건"), num(r.rows, "줄"),
          `${r.median} : 1`, `${r.p90} : 1`, `${num(r.max)} : 1`,
        ])}
      />
      <Caption>출처: SH 접수 결과 공고(i-sh.co.kr). 공급호수와 신청자 수가 산술로 맞는 줄만 셌다. 30줄 미만인 묶음은 뺐다. 공고 수가 적어 서울 SH 공고 일부의 사정이다.</Caption>
    </>
  );
}

async function ScheduleBlock() {
  const rows = await getScheduleStats();
  if (rows.length === 0) return null;
  return (
    <>
      <Table
        head={["기관", "공고", "공고에서 접수 시작까지", "접수 기간", "마감에서 발표까지"]}
        num={[1, 2, 3, 4]}
        rows={rows.map((r) => [
          r.agency, num(r.notices, "건"), num(r.to_start, "일"), num(r.open_days, "일"), r.to_announce == null ? "—" : num(r.to_announce, "일"),
        ])}
      />
      <Caption>집공고가 모은 최근 2년 공고의 중앙값. 접수 시작일과 마감일이 모두 있는 공고만, 기관별 30건 이상만 셌다. 「서울시」는 서울주거포털의 민간임대와 청년안심주택 공고다.</Caption>
    </>
  );
}

const COL_HEAD: Record<string, string> = {
  age: "나이", marital: "혼인", income: "소득", asset: "총자산", car: "자동차", homeless: "무주택", region: "거주지",
};

async function SeedsBlock({ cls, cols }: { cls?: string; cols: Extract<GuideBlock, { kind: "seeds" }>["cols"] }) {
  const rules = await getEligibilityRules();
  const types = rules.types.filter((t) => !cls || t.required_class.some((c) => c.includes(cls)));
  if (types.length === 0) return null;
  const cell = (t: SupplyType, c: string): React.ReactNode => {
    switch (c) {
      case "age": return ageRuleText(t);
      case "marital": return t.marital === "미혼" ? "미혼" : t.marital === "혼인" ? (t.marital_max_yr ? `혼인 ${t.marital_max_yr}년 이내` : "혼인") : "보지 않음";
      case "income": {
        if (t.income_pct === null) return "보지 않음";
        const one = incomeLimit(rules.income, 1, t.income_pct);
        const pct = `${t.income_pct}%${t.income_pct_dual ? `(맞벌이 ${t.income_pct_dual}%)` : ""}`;
        return <span title={one != null ? `1인 가구 ${wonExact(one)}` : undefined}>{pct}{one != null && <small> 1인 월 {wonKo(one)}</small>}</span>;
      }
      case "asset": return t.asset_limit_man === null ? "보지 않음" : <span title={wonExact(t.asset_limit_man * MAN)}>{wonKo(t.asset_limit_man * MAN)}</span>;
      case "car": return carRuleText(t)?.replace("자동차가액 ", "").replace("자동차 ", "") ?? "보지 않음";
      case "homeless": return t.homeless_scope === "세대원" ? "세대 전원" : t.homeless_scope;
      case "region": return t.region_limit === "전국" ? "제한 없음" : (regionRuleText(t)?.replace(" 신청 가능", "") ?? t.region_limit);
      default: return null;
    }
  };
  return (
    <>
      <Table
        head={["공급유형", ...cols.map((c) => COL_HEAD[c])]}
        rows={types.map((t) => [
          <span key="n"><b>{t.name}</b><small> {t.category}</small></span>,
          ...cols.map((c) => cell(t, c)),
        ])}
      />
      <Caption>집공고 자격진단 규칙에서 모았다. 공고문과 대조해 고친 제도 일반 기준이고, 공고마다 세부가 다를 수 있다. 소득 금액은 {rules.incomeYear}년 기준.</Caption>
    </>
  );
}

async function OpenTypesBlock() {
  const hubs = await listTypeHubs();
  const open = hubs.filter((h) => h.open > 0 && housingTypeDoc(h.housing_type));
  if (open.length === 0) return <p>지금은 접수 중인 공고가 없다.</p>;
  return (
    <>
      <HubAreaBars items={open.map((h) => ({ href: typePath(h.housing_type), label: h.housing_type, count: h.open }))} />
      <Caption>마감 전 공고만 셌다. 한 시간마다 기관 목록을 다시 읽어 갱신한다.</Caption>
    </>
  );
}

export async function GuideBlockView({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "income": return <IncomeBlock pcts={block.pcts} />;
    case "waitlist-type": return <WaitlistTypeBlock />;
    case "waitlist-sido": return <WaitlistSidoBlock />;
    case "rent-type": return <RentTypeBlock />;
    case "convert": return <ConvertBlock />;
    case "competition": return <CompetitionBlock />;
    case "schedule": return <ScheduleBlock />;
    case "seeds": return <SeedsBlock cls={block.cls} cols={block.cols} />;
    case "open-types": return <OpenTypesBlock />;
  }
}
