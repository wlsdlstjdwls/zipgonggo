// 단지 상세 — /notice/{공고}/{단지명}-{단지코드}. docs/url-structure.md의 호실 상세 자리를 지금 있는 최소 단위(단지)로 채운다.
// 색인 여부는 장마다 다르다 — 「고유 필드 8개 이상 + 건물 단위 좌표」를 채운 장만 index한다(lib/queries의 COMPLEX_FIELDS).
// 전에는 좌표가 아예 없어 전량 noindex였는데, S6가 도로명주소 요약DB를 오프라인 조인해 좌표를 채우고
// 사진과 평면도, 관리비가 붙어 절반 가까이가 기준을 넘겼다(2026-09-16 실측 1,920장 중 665장).
// 기준을 못 채운 장은 그대로 noindex이고 공고 지도의 앵커로만 노출한다.
//
// 2026-09-09 개편(사용자 요청): 제원과 공급현황을 한 섹션으로 합치고, 그 위에 요약 스트립을 놓아
// "중요한 정보가 뭔지"를 먼저 보이게 했다. 값이 없는 자리는 감추지 않고 「준비 중」으로 말한다.
// 공고문 용어는 링크로 걸어 페이지 밑 「용어 설명」으로 잇는다.
//
// 2026-09-14 「한 값은 한 곳」(사용자 지적: 같은 숫자가 요약 스트립·제원 카드·공급현황 카드에 세 번 나왔다):
//   요약 스트립 = 결정에 쓰는 값(보증금·월임대료·전용면적·호수와 그 배분·입주 시작)
//   제원 카드   = 그 어디에도 없는 값(공용/계약면적·난방·구조·승강기·계약금/잔금). 공급유형이 한 줄이면 그 줄도 여기로 흡수
//   공급현황 표 = 공급유형이 두 줄 이상일 때만 — 줄마다 다른 값(호수·금액·면적)을 견주는 자리
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalcSeed } from "@/components/calc-context";
import { DetailAside } from "@/components/detail-aside";
import { DetailHeadBar } from "@/components/detail-headbar";
import { ExternalLink } from "@/components/external-link";
import { GlossaryList, Term, TermText } from "@/components/glossary";
import { NaverMap } from "@/components/naver-map";
import { NoticeFit } from "@/components/notice-fit";
import { NoticeFitMingan } from "@/components/notice-fit-mingan";
import { ConvertTable } from "@/components/convert-table";
import { Pending } from "@/components/pending";
import { PriceTable } from "@/components/price-table";
import { ShareButton } from "@/components/share-button";
import { Spec, SpecList } from "@/components/spec-list";
import { SupplyTable } from "@/components/supply-table";
import { DepositOptionsTable, optionLabels } from "@/components/deposit-options-table";
import { UnitTable } from "@/components/unit-table";
import { JsonLd } from "@/components/json-ld";
import { agencyLabels } from "@/lib/agency";
import { complexGraph } from "@/lib/jsonld";
import { NAVER_MAP_COMPLEX_ZOOM } from "@/lib/constants";
import { applyPhase, count, dateK, deadlineChip, NO_DATE, num, wonKo } from "@/lib/format";
import { areaText, classLabel, commonArea, complexPriceGroups, complexPriceRows, CONVERT_HINT, m2, moveInLabel, typeLabel, unitPriceRows } from "@/lib/notice-view";
import { getComplexImages, getComplexSupply, getComplexUnits, getEligibilityRules, getNoticeBySlug, getNoticeComplexes, getNoticeEligibility, getNoticeSupply, getPriorCompetition, getYouthHouse, isComplexIndexable } from "@/lib/queries";
import { ComplexGallery } from "@/components/complex-gallery";
import { imagesEnabled, shownImages } from "@/lib/complex-images";
import { complexSegment, noticeComplexPath, noticePath, ROUTES } from "@/lib/routes";
import { regionShort, sidoShort } from "@/lib/sido";
import type { ImageSource, Notice, NoticeComplex } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

type Params = { params: Promise<{ slug: string; complex: string }> };

type Found = { n: Notice; c: NoticeComplex; siblings: NoticeComplex[] };

async function load(params: Params["params"]): Promise<Found | null> {
  const { slug, complex } = await params;
  const n = await getNoticeBySlug(decodeURIComponent(slug));
  if (!n) return null;
  const siblings = await getNoticeComplexes(n.id);
  const seg = decodeURIComponent(complex);
  // 코드까지 맞는 행이 정답. 코드가 붙기 전에 나간 링크(이름만)도 살려 준다(URL을 삭제하지 않는다 — CLAUDE.md 6)
  const c = siblings.find((x) => complexSegment(x) === seg) ?? siblings.find((x) => x.name === seg);
  return c ? { n, c, siblings } : null;
}

/** meta description과 JSON-LD가 같은 문장을 쓴다 */
function complexDescription(n: Notice, c: NoticeComplex): string {
  const money = c.min_rent != null
    ? `보증금 ${wonKo(c.min_deposit)} / 월 ${wonKo(c.min_rent)}`
    : c.min_deposit != null ? `보증금 ${wonKo(c.min_deposit)}` : "보증금과 임대료는 원문 표 확인";
  return `${regionShort(c)} ${c.road_address}, ${n.housing_type}. ${money}. ${c.unit_count != null ? `이번 공고 ${num(c.unit_count, "호")} 공급. ` : ""}${n.agency} ${n.title}.`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const f = await load(params);
  if (!f) return { title: "단지를 찾을 수 없습니다", robots: { index: false, follow: false } };
  const { n, c } = f;
  const area = areaText(c);
  // 얇은 페이지 방지(docs/url-structure.md) — 기준을 못 채운 장은 색인하지 않고 링크만 따라가게 둔다
  const indexable = await isComplexIndexable(c.id);
  return {
    title: `${c.name} ${area ? `전용 ${area} ` : ""}보증금/임대료 | ${n.title}`.replace(/\s+/g, " "),
    description: complexDescription(n, c),
    alternates: { canonical: noticeComplexPath(n.slug, c) },
    robots: { index: indexable, follow: true },
  };
}

/** 요약 스트립 한 칸. 값이 없으면 「준비 중」이라고 쓴다 — 칸을 비워 두면 왜 없는지 알 수 없다 */
function Kpi({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div className={`kpi-i${value ? "" : " off"}`}>
      {/* 라벨이 사전에 있는 말이면 스스로 용어 링크가 된다 */}
      <span><TermText>{label}</TermText></span>
      <b>{value ?? "준비 중"}</b>
      {value && sub && <em>{sub}</em>}
    </div>
  );
}

export default async function ComplexPage({ params }: Params) {
  const f = await load(params);
  if (!f) notFound();
  const { n, c, siblings } = f;
  // 민간임대(청년안심주택)는 공고문 자격 묶음이 없고 제도 고정 규칙으로 판정한다(lib/mingan-fit.ts) — 시드 규칙만 있으면 된다
  const isMingan = n.housing_type === "공공지원민간임대";
  // 이 단지의 사진을 누가 주는가. 한 단지가 두 출처에 다 붙지는 않는다(SH 공고 단지 / 청년안심주택 포털 단지)
  const imgSource: ImageSource | null = c.sh_bizns_cd ? "sh" : c.youth_home_code ? "youth" : null;
  const [supply, units, images, noticeElig, minganRules, house] = await Promise.all([
    getComplexSupply(n.id, c.id, c.name),
    getComplexUnits(c.id),
    // 파일 자리가 안 정해진 배포에서는 질의도 하지 않는다 — 행만 있으면 액박이 된다(lib/complex-images 머리글)
    imgSource && imagesEnabled(imgSource) ? getComplexImages(c.sh_bizns_cd, c.youth_home_code) : Promise.resolve([]),
    getNoticeEligibility(n.id),
    isMingan ? getEligibilityRules() : Promise.resolve(null),
    // 포털 단지 사실(0027) — 관리비가 여기 있다. 이미지와 달리 파일이 없어 배포 스위치와 무관하게 늘 읽는다
    getYouthHouse(c.youth_home_code),
  ]);
  // 「내 조건에 맞는 단지」를 단지 상세에도(사용자 요청 2026-09-14) — 공고 상세와 같은 자격 묶음·공급현황으로 판정하고
  // 이 단지가 드는지 먼저 말한다. 자격 묶음이 있는 공고만 질의한다
  const [noticeSupply, eligRules, prior] = noticeElig ? await Promise.all([getNoticeSupply(n.id), getEligibilityRules(), getPriorCompetition(n)]) : [[], null, null];
  // 호수는 (공급유형, 공급대상)마다 한 칸이다 — 청년 소득있음/없음 두 줄이 같은 칸을 나눠 써 두 번 세면 안 된다
  const counted = new Map(supply.filter((s) => s.units_total != null).map((s) => [`${s.supply_type}|${s.tenant_class}`, s]));
  const unitTotal = [...counted.values()].reduce((a, s) => a + (s.units_total ?? 0), 0);
  const vacantTotal = [...counted.values()].reduce((a, s) => a + (s.units_priority ?? 0) + (s.units_general ?? 0), 0);
  const reserveTotal = [...counted.values()].reduce((a, s) => a + (s.units_reserve ?? 0), 0);
  const hasReserve = supply.some((s) => s.units_reserve != null);
  const hasRent = supply.some((s) => s.rent != null);          // 장기전세는 월임대료가 없다
  const showRent = hasRent || c.min_rent != null;               // 「보증금과 임대료」 제목·표의 임대료 열을 그릴지
  const hasClass = new Set(supply.map((s) => s.tenant_class)).size > 1 || supply.some((s) => s.income_option);
  // 민간임대 공고문의 보증금 비율 옵션(0025). 서로 다른 비율이 둘 이상일 때만 비율별 표를 따로 그린다 —
  // 비율이 하나뿐인 공고(호실별 「보증금 40%」 하나)는 위 금액 표가 이미 그 값을 말한다
  const hasOptions = optionLabels(supply).length > 1;
  // 이 공고가 이 단지에서 공급하는 주택형. 사진·도면을 이걸로 걸러 낸다 — SH주택정보는 단지에 있는 형을 다 준다
  const supplyTypes = [...new Set(supply.map((s) => s.supply_type).filter(Boolean))];
  const moveIn = moveInLabel(supply.find((s) => s.move_in_from)?.move_in_from ?? null);
  // 공급현황이 있으면 그 표가, 호실 목록만 있으면(매입임대 별첨) 호실 금액의 범위가 근거다
  const priceBreak = supply.length > 0 ? complexPriceRows(supply, c) : (unitPriceRows(units).length ? unitPriceRows(units) : complexPriceRows(supply, c));
  // 월임대료가 있는 줄은 공급대상별로 최대/기본/최소 세 줄을 만든다(사용자 요청 2026-09-09)
  // 민간임대는 공고가 비율별 금액을 직접 준다 — SH 규칙(연 이율)로 계산한 전세/월세전환 표를 내면 공고와 다른 숫자가 된다
  const priceGroups = hasOptions ? [] : complexPriceGroups(supply);
  // 오른쪽 카드는 언제나 "마감"을 센다 — 접수 시작 D-day를 섞으면 「접수 시작까지 / 오늘 / 09.11 마감」처럼 어긋난다
  const dl = deadlineChip(n);
  const ph = applyPhase(n);
  const L = agencyLabels(n);
  const area = areaText(c);
  const full = c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
  // 지도 말풍선 보조 글자 — 금액이 있으면 금액, 없으면 면적, 그것도 없으면 자치구
  const mapSub = c.min_rent != null ? `월 ${wonKo(c.min_rent)}`
    : c.min_deposit != null ? `보증금 ${wonKo(c.min_deposit)}`
    : area ?? `${sidoShort(c.sido)} ${c.sigungu}`;

  // 공급 구분 — 공급현황이 있으면 그 표가, 없으면 단지 표의 [신규] 표시가 근거다
  const isNew = supply.length ? supply.some((s) => s.is_new) : c.is_new;
  const kind = isNew ? "신규 공급" : "재공급";
  // 호실 표에서만 나오는 값(승강기·구조). 별첨이 있는 매입임대 공고만 채워진다
  const layouts = [...new Set(units.map((u) => u.room_layout).filter(Boolean))] as string[];
  const elevators = [...new Set(units.map((u) => u.elevator).filter(Boolean))] as string[];
  // 계약금·잔금은 주택형마다 다르다. 첫 줄 값만 적으면 4개 유형 단지에서 29㎡형 계약금이 단지 값처럼 보인다 —
  // 서로 다르면 「최소~최대」로 적는다. 정확한 줄별 값은 공고문 표에 있다
  const moneyRange = (vals: (number | null)[]): string | null => {
    const xs = [...new Set(vals.filter((v): v is number => v != null))];
    if (!xs.length) return null;
    return xs.length === 1 ? wonKo(xs[0]) : `${wonKo(Math.min(...xs))}~${wonKo(Math.max(...xs))}`;
  };
  const downPayment = moneyRange(supply.map((s) => s.down_payment));
  const balance = moneyRange(supply.map((s) => s.balance));
  const unitCount = c.unit_count ?? (units.length || null) ?? (unitTotal || null);
  // 호수 밑줄 — 공가와 예비자 배분. 공급/재공급은 태그 줄이 이미 말하므로 여기 또 쓰지 않는다
  const unitSub = hasReserve && (vacantTotal > 0 || reserveTotal > 0)
    ? [vacantTotal > 0 ? `공가 ${num(vacantTotal, "호")}` : null, reserveTotal > 0 ? `예비 ${num(reserveTotal, "호")}` : null].filter(Boolean).join(" | ")
    : null;
  // 공급유형이 한 줄이면 「공급현황」 카드를 따로 두지 않고 제원 카드가 그 줄을 흡수한다
  const one = supply.length === 1 ? supply[0] : null;
  const oneSplit = one != null && (one.units_priority != null || one.units_general != null);
  // 장기전세처럼 월임대료가 없는 공고는 아래 금액 표(PriceTable)가 계약금·잔금 줄을 따로 그린다 — 그때는 여기서 뺀다
  const payInPriceTable = priceGroups.length === 0 && priceBreak.some((r) => r.group === "pay");
  // 별첨에 동 표기가 있는 단지만 「동호수별」이다 — 다세대·빌라는 호만 실린다(사용자 지적 2026-09-09)
  const unitLabel = units.some((u) => u.building) ? "동호수별 정보" : "호실별 정보";
  const hasFacts = supply.length > 0 || units.length > 0;

  // 요약 스트립·태그 줄·공급현황 표와 겹치지 않는 값만 남긴다. 전부 비면 표 자체를 그리지 않는다
  // [라벨, 값, 라벨을 줄여 쓴 자리의 사전 표제어]
  const specs: [string, string, string?][] = ([
    // 한 줄짜리 공급은 그 줄의 대상·유형을 여기서 말한다. 유형은 전용면적 칸과 거의 같은 말이라 주거약자용일 때만
    ["공급대상", one && hasClass ? classLabel(one) : null],
    ["공급유형", one?.accessible ? typeLabel(one) : null],
    // 공용·계약면적은 주택형마다 다르다 — 여러 줄이면 공급현황 표의 면적 칸이 줄마다 적는다
    ["공용면적", one ? m2(commonArea(one)) : null],
    ["계약면적", one?.area_total != null ? m2(one.area_total) : null],
    ["구조", layouts.length ? layouts.join(" | ") : null],
    ["승강기", elevators.length ? elevators.join(" | ") : null],
    ["난방", c.heating],
    ["계약금", !payInPriceTable ? downPayment : null],
    ["잔금", !payInPriceTable ? balance : null],
  ] as [string, string | null, string?][]).filter((r): r is [string, string, string?] => r[1] != null && r[1] !== "");

  // 청년안심주택 포털이 주는 값(0027). 공고문 첨부에는 하나도 없는 것들이라 위 specs와 겹치지 않는다.
  // 관리비는 단지 전체 범위다 — 주택형마다 달라 한 값으로 못 적는다(맹그로브창천 11만~14만)
  const maint = house && house.maint_low != null
    ? house.maint_high != null && house.maint_high !== house.maint_low
      ? `${wonKo(house.maint_low)} ~ ${wonKo(house.maint_high)}`
      : wonKo(house.maint_low)
    : null;
  const houseSpecs: [string, string, string?][] = ([
    ["월 관리비", maint],
    ["입주 예정일", house?.movein ? dateK(house.movein) : null],
    ["지하철", house?.subway ?? null],
    ["단지 규모", house?.scale ?? null],
    ["운영사", house?.manager ?? null],
    ["시행사", house?.developer ?? null],
    ["시공사", house?.builder ?? null],
    ["문의", house?.phone ?? null],
  ] as [string, string | null, string?][]).filter((r): r is [string, string, string?] => r[1] != null && r[1] !== "");

  // 화면에 실제로 쓴 말만 페이지 밑에 편다. 이건 서버 렌더용 밑그림이고, 브라우저에서는 GlossaryList가
  // 실제로 걸린 링크로 목록을 다시 맞춘다 — 손으로 맞춘 목록은 어긋나기 마련이다(사용자 지적 2026-09-09)
  const terms = [
    kind,
    n.housing_type,
    // 「공급 정보」 표는 위에서 만든 specs가 곧 라벨이다 — 두 곳을 따로 관리하지 않는다
    ...specs.map(([label, , term]) => term ?? label),
    ...houseSpecs.map(([label, , term]) => term ?? label),
    // 공가·예비자 칸은 공급현황 표가 그린다 — 「현재 공가」 제원 줄이 0호라 빠져도 표에는 남는다
    ...(hasReserve ? ["공가"] : []),
    ...(supply.length === 1 ? (supply[0].units_reserve != null ? ["예비입주자"] : []) : hasReserve ? ["예비입주자"] : []),
    // 우선/일반은 공급현황 표가 그린다. 줄이 하나면 값이 있는 쪽만, 여러 줄이면 「우선 n / 일반 n」이 둘 다 나온다
    ...(supply.length === 1
      ? [...(supply[0].units_priority != null ? ["우선공급"] : []), ...(supply[0].units_general != null ? ["일반공급"] : [])]
      : supply.some((x) => x.units_priority != null || x.units_general != null) ? ["우선공급", "일반공급"] : []),
    ...(supply.some((s) => s.income_option) ? ["소득있음", "소득없음"] : []),
    ...(supply.some((s) => s.accessible) ? ["주거약자용"] : []),
    // 전용면적·입주 시작은 요약 스트립 라벨이라 값이 없어도 늘 링크가 걸린다
    "전용면적",
    "입주 시작",
    ...(priceGroups.length || units.some((u) => u.deposit_jeonse != null) ? ["전세전환", "월세전환"] : []),
  ];

  return (
    <article className="stage">
      {/* 색인은 막혀 있지만(좌표 미확보) 구조는 같은 규격으로 낸다 — 좌표가 차서 색인을 열 때 바로 쓰인다 */}
      <JsonLd
        graph={complexGraph(n, c, noticeComplexPath(n.slug, c), [
          { name: "공고 목록", path: ROUTES.home },
          { name: n.title, path: noticePath(n.slug) },
          { name: c.name, path: noticeComplexPath(n.slug, c) },
        ], complexDescription(n, c))}
      />
      <DetailHeadBar
        title={c.name}
        sub={n.title}
        state={{ label: ph.label, tone: ph.tone }}
        back={{ href: noticePath(n.slug), label: "← 공고" }}
        action={<ExternalLink className="btn" href={n.source_url}>{L.original}</ExternalLink>}
      />
      <div className="detail">
        <div className="detail-main">
          <header className="d-head">
            <div className="d-tags">
              {/* 뒤로가기는 이 줄 맨 앞에 — 혼자 한 행을 쓰지 않는다(사용자 요청 2026-09-09) */}
              <Link href={noticePath(n.slug)} className="d-back">← 공고</Link>
              {/* D-day는 오른쪽 카드가 크게 센다 — 여기서 또 세지 않는다 */}
              <span className="tag type"><Term>{n.housing_type}</Term></span>
              <span className="tag">{regionShort(c)}</span>
              {/* 공급/재공급은 태그 줄에서 바로 읽혀야 한다(사용자 요청 2026-09-09) */}
              <span className={`tag${isNew ? " acc" : ""}`}><Term>{kind}</Term></span>
            </div>
            <h1 className="d-title">{c.name}</h1>
            <p className="d-sub">{full}</p>
          </header>

          {/* 핵심 값 먼저 — 어떤 표를 읽어야 할지 정하기 전에 이 다섯 칸이 답을 준다(사용자 요청 2026-09-09) */}
          <div className="kpi">
            <Kpi
              label={showRent ? "보증금" : "전세금"}
              value={c.min_deposit != null ? wonKo(c.min_deposit) : null}
              sub={c.min_deposit != null ? "최소" : null}
            />
            <Kpi label="월임대료" value={c.min_rent != null ? wonKo(c.min_rent) : hasFacts && !hasRent ? "없음" : null} sub={c.min_rent != null ? "최소" : "전세형"} />
            <Kpi label="전용면적" value={area} />
            <Kpi label="공급 호수" value={unitCount != null ? num(unitCount, "호") : null} sub={unitSub} />
            <Kpi label="입주 시작" value={moveIn} sub={moveIn ? "공고문 예정일" : null} />
          </div>

          {/* 제원과 공급현황은 한 섹션이다 — 같은 표를 세로/가로로 두 번 나눠 보여줄 이유가 없다(사용자 요청 2026-09-09) */}
          <section className="dsec">
            <h2>공급 정보</h2>
            {/* 단지명·주소·지역은 머리글이, 공급 구분·유형은 태그 줄이, 호수와 배분·금액·전용면적·입주 시작은 위 요약
                스트립이 이미 말했다 — 여기 남기는 건 그 어디에도 없는 값뿐이다(사용자 지적 2026-09-09·09-14: 겹치는 정보 없애기) */}
            {(specs.length > 0 || oneSplit) && (
              <SpecList>
                {/* 한 줄짜리 공급의 우선/일반 배분. 요약 스트립은 합(공가)만 말한다 */}
                {one && oneSplit && (
                  <Spec
                    label="공가 배분"
                    term="공가"
                    value={<><Term as="우선">우선공급</Term> {num(one.units_priority ?? 0, "호")} / <Term as="일반">일반공급</Term> {num(one.units_general ?? 0, "호")}</>}
                  />
                )}
                {specs.map(([label, value, term]) => <Spec key={label} label={label} value={value} term={term} />)}
              </SpecList>
            )}

            {/* 공급유형이 둘 이상일 때만 표 — 줄마다 다른 호수·금액·면적을 견준다. 한 줄이면 위 카드가 전부다 */}
            {supply.length > 1 && (
              <div className="dsub">
                <h3>공급현황 {count(supply.length, "건")}</h3>
                <SupplyTable supply={supply} hasReserve={hasReserve} hasRent={hasRent} hasClass={hasClass} />
              </div>
            )}
            {/* 계층별 배분 표도 호실 목록도 없는 단지 — 아래 「보증금과 임대료」까지 다 빈다. 왜 비었는지 여기서 한 번만 말한다 */}
            {supply.length === 0 && units.length === 0 && (
              <div className="dsub">
                <Pending
                  title="이 단지의 공급현황은 아직 준비 중입니다"
                  lead={<>공고문 첨부의 재공급 표는 단지명이 지구 단위로 묶여 있어 아직 단지별로 갈라 읽지 못합니다. 호수와 금액은 {L.originalDoc}의 표에 있습니다.</>}
                  action={<ExternalLink className="btn" href={n.source_url}>{L.original}</ExternalLink>}
                />
              </div>
            )}

            {/* 공고문 첨부에 없는 값은 청년안심주택 포털이 준다(0027) — 관리비가 그것이다.
                포털 자료가 있는 단지에는 그 값을 싣고, 없는 단지에만 「어디서 확인하라」고 말한다.
                「싣지 못합니다」를 값이 있는 단지에까지 적으면 지면이 거짓말한다(사용자 지적 2026-09-15) */}
            {houseSpecs.length > 0 && (
              <div className="dsub">
                <h3>단지 정보</h3>
                <SpecList>
                  {houseSpecs.map(([label, value, term]) => <Spec key={label} label={label} value={value} term={term} />)}
                </SpecList>
                <p className="note">
                  {maint && <>관리비는 단지가 밝힌 <b>예상</b> 금액이라 실제 청구액과 다를 수 있고, 주택형과 사용량에 따라 달라집니다. </>}
                  서울시 청년안심주택 「주택찾기」의 단지 자료입니다.
                  {house?.homepage && <> 단지 홈페이지는 <ExternalLink href={house.homepage}>여기</ExternalLink>에 있습니다.</>}
                </p>
              </div>
            )}
            {!maint && (
              <p className="note">주차장과 관리비, 주차 요금은 공고문 첨부에 실리지 않아 아직 싣지 못합니다. 계약 전에 관리사무소나 {L.originalDoc}에서 확인하세요.</p>
            )}
            {units.length > 0 && <p className="note" style={{ marginTop: 4 }}>호실별 층, 구조, 승강기, 금액은 아래 「{unitLabel}」에 있습니다.</p>}
          </section>

          {/* 사진·도면은 공급현황 바로 뒤 — 어떤 주택형이 나왔는지 본 다음 그 형의 평면도를 본다.
              단지 코드가 안 붙은 단지와 기관이 자료를 안 올린 단지는 섹션을 감추지 않고 왜 비었는지 말한다.
              자료를 주는 기관이 공공/민간에 따라 갈리므로(SH주택정보 / 청년안심주택 포털) 문구도 갈린다 —
              민간임대에 「준공 전이라 SH주택정보에 없다」고 적으면 사실과 다르다(사용자 지적 2026-09-15) */}
          <section className="dsec">
            {/* 장수는 실제로 펼쳐 놓은 것만 센다 — 딴 주택형까지 세면 「47장」이라 해 놓고 12장을 보여준다 */}
            <h2>사진과 도면{images.length > 0 ? ` | ${count(shownImages(images, supplyTypes).length, "장")}` : ""}</h2>
            {images.length > 0 ? (
              <ComplexGallery images={images} complexName={c.name} supplyTypes={supplyTypes} />
            ) : (
              <Pending
                title={imgSource && imagesEnabled(imgSource)
                  ? "이 단지의 사진과 도면은 아직 준비 중입니다"
                  /* 매입임대는 주소로 붙인다 — 못 붙은 집은 기다린다고 생기지 않는다(「준비 중」이 아니다) */
                  : !imgSource && !isMingan && n.housing_type === "매입임대"
                  ? "이 집의 사진은 찾지 못했습니다"
                  : "사진과 도면은 공개 준비 중입니다"}
                lead={imgSource && !imagesEnabled(imgSource)
                  ? <>{imgSource === "youth" ? "서울시 청년안심주택 포털" : "서울주택도시공사 SH주택정보"}의 평면도와 사진을 지면에 싣기 위한 확인 절차가 끝나면 보여 드립니다. 그때까지는 {L.originalDoc}의 안내를 따라 확인하세요.</>
                  : imgSource === "youth"
                  ? <>서울시 청년안심주택 포털이 이 단지의 평면도와 사진을 아직 올리지 않았습니다.</>
                  : imgSource === "sh"
                  ? <>SH주택정보에 있는 단지지만 평면도와 사진을 아직 모아 오지 못했습니다. 그때까지는 {L.originalDoc}의 전자팸플릿에서 확인하세요.</>
                  : isMingan
                  ? <>이 단지는 청년안심주택 포털 「주택찾기」에 올라 있지 않습니다. 모집이 끝나 내려갔거나 아직 등록 전입니다. 평면도는 {L.originalDoc}과 사업자 홈페이지에서 확인하세요.</>
                  /* 매입임대는 빌라나 다가구주택 한 호실이라 SH주택정보(아파트 793단지)에 단지가 아예 없다.
                     여기에 「준공 전이라 없다」고 적으면 사실과 다르다(2026-09-21) */
                  : n.housing_type === "매입임대"
                  ? <>매입임대는 빌라나 다가구주택 한 호실이라 SH주택정보에서 주소로 찾습니다. 이 주소는 아직 찾지 못했습니다. 집의 모습은 {L.originalDoc}과 현장 방문으로 확인하세요.</>
                  : <>준공 전 신규 공급 단지라 SH주택정보에 단지 자료가 아직 없습니다. 전자팸플릿은 {L.originalDoc}의 안내를 따라 확인하세요.</>}
                action={<ExternalLink className="btn" href={n.source_url}>{L.original}</ExternalLink>}
              />
            )}
          </section>

          {/* 보증금과 임대료는 공급현황 아래 — 어떤 유형이 있는지 먼저 보고 그 금액을 읽는 순서다(사용자 요청 2026-09-09) */}
          <section className="dsec">
            <h2>{showRent ? "보증금과 임대료" : "전세금"}</h2>
            {priceGroups.length > 0 ? (
              <>
                <ConvertTable groups={priceGroups} />
                <p className="note">
                  기본은 공고 기준값입니다. 계약 때 월임대료의 {CONVERT_HINT.share}%까지 보증금으로 올리거나(<Term>전세전환</Term>, 연 {CONVERT_HINT.up}%),
                  보증금의 {CONVERT_HINT.share}%까지 월임대료로 내릴 수 있습니다(<Term>월세전환</Term>, 연 {CONVERT_HINT.down}%).
                  전환 한도와 이율은 공고마다 다르므로 {L.originalDoc}에서 확인하세요.
                </p>
              </>
            ) : priceBreak.length > 0 ? (
              <>
                <PriceTable rows={priceBreak} depositHead={showRent ? "보증금" : "전세금"} showRent={showRent} />
                {hasOptions ? (
                  <>
                    <p className="note">위 표는 보증금 비율이 가장 낮은 기준값입니다. 비율을 올리면 월임대료가 내려갑니다. 비율별 금액은 아래 표에서 확인하세요.</p>
                    <h3>보증금 비율별 임대조건</h3>
                    <DepositOptionsTable supply={supply} hasClass={hasClass} />
                    <p className="note">계약 때 공고에 적힌 비율 단위로 전환할 수 있고, 계약 뒤에는 바꿀 수 없는 공고가 많습니다. 조건은 {L.originalDoc}에서 확인하세요.</p>
                  </>
                ) : hasRent && (
                  <p className="note">
                    공고문 기준값입니다. 계약 때 정해진 비율 안에서 보증금과 월임대료를 서로 전환할 수 있습니다. 전환 한도와 이율은 {L.originalDoc}에서 확인하세요.
                  </p>
                )}
              </>
            ) : (
              <Pending
                title="이 단지의 금액은 아직 준비 중입니다"
                lead={<>공고문 첨부의 금액 표를 이 단지에 아직 이어 붙이지 못했습니다. {L.originalDoc}의 표에서 확인하세요.</>}
                action={<ExternalLink className="btn" href={n.source_url}>{L.original}</ExternalLink>}
              />
            )}
          </section>

          {/* 별첨 주택목록이 있는 공고만 — 동호수별로 갈라 본다(사용자 요청 2026-09-09) */}
          {units.length > 0 && (
            <section className="dsec">
              <h2>{unitLabel} | {num(units.length, "호")}</h2>
              <UnitTable units={units} />
            </section>
          )}

          {minganRules && !noticeElig && supply.length > 0 && (
            <section className="dsec lead" id="fit">
              <h2>내 조건에 맞는 주택형</h2>
              <p className="note" style={{ margin: "0 0 12px" }}>
                청년안심주택 민간임대의 소득과 자산, 순위 기준에 내 조건을 대 보고 넣을 수 있는 주택형을 추립니다. 값은 어디로도 보내지 않습니다.
              </p>
              <NoticeFitMingan
                supply={supply} types={minganRules.types} income={minganRules.income} tiers={minganRules.tiers}
                complexGu={c.sigungu ?? null} incomeYear={minganRules.incomeYear}
                noticeYear={n.posted_at ? new Date(n.posted_at).getFullYear() : null}
              />
            </section>
          )}

          {noticeElig && eligRules && (
            <section className="dsec lead" id="fit">
              <h2>내 조건에 맞는 단지</h2>
              <p className="note" style={{ margin: "0 0 12px" }}>
                이 공고문의 소득과 자산, 순위 기준에 내 조건을 대 보고 이 단지가 드는지, 같은 공고의 다른 단지는 어디가 맞는지 추립니다. 값은 어디로도 보내지 않습니다.
              </p>
              <NoticeFit data={noticeElig.data} complexes={siblings} supply={noticeSupply} income={eligRules.income} tiers={eligRules.tiers} noticeSlug={n.slug} currentId={c.id} prior={prior} />
            </section>
          )}

          <section className="dsec">
            <h2>위치</h2>
            <div className="d-map"><NaverMap address={full} title={c.name} sub={mapSub} zoom={NAVER_MAP_COMPLEX_ZOOM} coord={c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : undefined} /></div>
          </section>

          <GlossaryList terms={terms} />
        </div>

        <DetailAside
          tone={dl.tone}
          ddayLabel={dl.unit}
          ddayNum={dl.num}
          ddayNote={n.apply_end_at ? `${dateK(n.apply_end_at, true)}${n.apply_end_tm ? ` ${n.apply_end_tm}` : ""} ${dl.days !== null && dl.days < 0 ? "마감됨" : "마감"}` : NO_DATE}
          cta={
            <>
              <Link className="btn acc lg" href={noticePath(n.slug)}>공고 전체 단지 지도</Link>
              <ExternalLink className="btn lg" href={n.source_url}>{L.original}</ExternalLink>
              <ShareButton title={c.name} text={n.title} />
            </>
          }
          /* 좁은 화면 하단 바에 세울 단 하나의 문 — 이 단지가 속한 공고로 돌아가는 길이다 */
          primary={<Link className="btn acc" href={noticePath(n.slug)}>공고 보기</Link>}
          /* 하단 바에만 올리는 값 — 제원 표에 다시 적지 않는다(위 요약 스트립이 이미 센다).
             폰에서는 바가 화면에 고정이라 스크롤을 어디까지 내렸든 금액이 따라온다 */
          brief={[
            { label: "보증금", value: c.min_deposit != null ? wonKo(c.min_deposit) : null },
            { label: "월임대료", value: c.min_rent != null ? wonKo(c.min_rent) : null },
          ]}
          /* 공급 구분은 태그 줄이, 입주 시작은 요약 스트립이 이미 센다 — 여기서 또 쓰지 않는다 */
          rows={[
            { label: "공급기관", value: n.agency },
            { label: "공고일", value: dateK(n.posted_at) },
            { label: "접수 마감", value: n.apply_end_at ? `${dateK(n.apply_end_at)}${n.apply_end_tm ? ` ${n.apply_end_tm}` : ""}` : NO_DATE },
            { label: "문의처", value: n.contact },
          ]}
        />
      </div>

      {/* 공고와 원문 링크는 오른쪽 카드가 이미 준다 — 고지 한 줄만, 그리고 푸터 바로 위에.
          왼쪽 칸 안에 두면 오른쪽 카드 길이만큼 푸터와 벌어진다(사용자 지적 2026-09-09) */}
      <div className="notice-bar foot">
        <span className="i">i</span>
        <span>본 자료는 참고용입니다. 정확한 내용과 최종 조건은 {n.agency}의 공식 공고문을 반드시 확인하세요.</span>
      </div>

      {/* 계산기는 헤더 버튼이 연다 — 이 단지 금액을 첫 값으로 넘긴다(사용자 제안 2026-09-09) */}
      <CalcSeed deposit={c.min_deposit} rent={c.min_rent} sourceLabel={L.originalDoc} />
    </article>
  );
}
