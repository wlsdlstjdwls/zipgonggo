// 단지 상세 — /notice/{공고}/{단지명}-{단지코드}. docs/url-structure.md의 호실 상세 자리를 지금 있는 최소 단위(단지)로 채운다.
// 좌표를 저장하지 않아(CLAUDE.md 하지 말 것 1) 「얇은 페이지 방지 규칙」의 "좌표 건물 단위"를 못 채운다 → noindex,
// 공고 지도의 앵커로만 노출한다(docs/url-structure.md 표). unit 테이블이 차면 호실 단위로 내려간다.
//
// 2026-09-09 개편(사용자 요청): 제원과 공급현황을 한 섹션으로 합치고, 그 위에 요약 스트립을 놓아
// "중요한 정보가 뭔지"를 먼저 보이게 했다. 값이 없는 자리는 감추지 않고 「준비 중」으로 말한다.
// 공고문 용어는 링크로 걸어 페이지 밑 「용어 설명」으로 잇는다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalcSeed } from "@/components/calc-context";
import { DetailAside } from "@/components/detail-aside";
import { DetailHeadBar } from "@/components/detail-headbar";
import { ExternalLink } from "@/components/external-link";
import { GlossaryList, Term, TermText } from "@/components/glossary";
import { NaverMap } from "@/components/naver-map";
import { ConvertTable } from "@/components/convert-table";
import { Pending } from "@/components/pending";
import { PriceTable } from "@/components/price-table";
import { ShareButton } from "@/components/share-button";
import { Spec, SpecList } from "@/components/spec-list";
import { SupplyTable } from "@/components/supply-table";
import { UnitTable } from "@/components/unit-table";
import { agencyLabels } from "@/lib/agency";
import { NAVER_MAP_COMPLEX_ZOOM } from "@/lib/constants";
import { applyPhase, count, dateK, deadlineChip, NO_DATE, num, wonKo } from "@/lib/format";
import { areaText, commonArea, complexPriceGroups, complexPriceRows, CONVERT_HINT, m2, moveInLabel, unitPriceRows } from "@/lib/notice-view";
import { getComplexImages, getComplexSupply, getComplexUnits, getNoticeBySlug, getNoticeComplexes } from "@/lib/queries";
import { ComplexGallery } from "@/components/complex-gallery";
import { shownImages } from "@/lib/complex-images";
import { complexSegment, noticeComplexPath, noticePath } from "@/lib/routes";
import { regionShort, sidoShort } from "@/lib/sido";
import type { Notice, NoticeComplex } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

type Params = { params: Promise<{ slug: string; complex: string }> };

type Found = { n: Notice; c: NoticeComplex };

async function load(params: Params["params"]): Promise<Found | null> {
  const { slug, complex } = await params;
  const n = await getNoticeBySlug(decodeURIComponent(slug));
  if (!n) return null;
  const siblings = await getNoticeComplexes(n.id);
  const seg = decodeURIComponent(complex);
  // 코드까지 맞는 행이 정답. 코드가 붙기 전에 나간 링크(이름만)도 살려 준다(URL을 삭제하지 않는다 — CLAUDE.md 6)
  const c = siblings.find((x) => complexSegment(x) === seg) ?? siblings.find((x) => x.name === seg);
  return c ? { n, c } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const f = await load(params);
  if (!f) return { title: "단지를 찾을 수 없습니다", robots: { index: false, follow: false } };
  const { n, c } = f;
  const area = areaText(c);
  const money = c.min_rent != null
    ? `보증금 ${wonKo(c.min_deposit)} / 월 ${wonKo(c.min_rent)}`
    : c.min_deposit != null ? `보증금 ${wonKo(c.min_deposit)}` : "보증금과 임대료는 원문 표 확인";
  return {
    title: `${c.name} ${area ? `전용 ${area} ` : ""}보증금/임대료 | ${n.title}`.replace(/\s+/g, " "),
    description: `${regionShort(c)} ${c.road_address}, ${n.housing_type}. ${money}. ${c.unit_count != null ? `이번 공고 ${num(c.unit_count, "호")} 공급. ` : ""}${n.agency} ${n.title}.`,
    alternates: { canonical: noticeComplexPath(n.slug, c) },
    // 좌표가 건물 단위로 확보되기 전까지 색인하지 않는다(docs/url-structure.md 얇은 페이지 방지)
    robots: { index: false, follow: true },
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
  const { n, c } = f;
  const [supply, units, images] = await Promise.all([
    getComplexSupply(n.id, c.id, c.name),
    getComplexUnits(c.id),
    getComplexImages(c.sh_bizns_cd),
  ]);
  // 호수는 (공급유형, 공급대상)마다 한 칸이다 — 청년 소득있음/없음 두 줄이 같은 칸을 나눠 써 두 번 세면 안 된다
  const counted = new Map(supply.filter((s) => s.units_total != null).map((s) => [`${s.supply_type}|${s.tenant_class}`, s]));
  const unitTotal = [...counted.values()].reduce((a, s) => a + (s.units_total ?? 0), 0);
  const vacantTotal = [...counted.values()].reduce((a, s) => a + (s.units_priority ?? 0) + (s.units_general ?? 0), 0);
  const reserveTotal = [...counted.values()].reduce((a, s) => a + (s.units_reserve ?? 0), 0);
  const hasReserve = supply.some((s) => s.units_reserve != null);
  const hasRent = supply.some((s) => s.rent != null);          // 장기전세는 월임대료가 없다
  const showRent = hasRent || c.min_rent != null;               // 「보증금과 임대료」 제목·표의 임대료 열을 그릴지
  const hasClass = new Set(supply.map((s) => s.tenant_class)).size > 1 || supply.some((s) => s.income_option);
  // 이 공고가 이 단지에서 공급하는 주택형. 사진·도면을 이걸로 걸러 낸다 — SH주택정보는 단지에 있는 형을 다 준다
  const supplyTypes = [...new Set(supply.map((s) => s.supply_type).filter(Boolean))];
  const moveIn = moveInLabel(supply.find((s) => s.move_in_from)?.move_in_from ?? null);
  // 공급현황이 있으면 그 표가, 호실 목록만 있으면(매입임대 별첨) 호실 금액의 범위가 근거다
  const priceBreak = supply.length > 0 ? complexPriceRows(supply, c) : (unitPriceRows(units).length ? unitPriceRows(units) : complexPriceRows(supply, c));
  // 월임대료가 있는 줄은 공급대상별로 최대/기본/최소 세 줄을 만든다(사용자 요청 2026-09-09)
  const priceGroups = complexPriceGroups(supply);
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
  const downPayment = supply.find((s) => s.down_payment != null)?.down_payment ?? null;
  const balance = supply.find((s) => s.balance != null)?.balance ?? null;
  const unitCount = c.unit_count ?? (units.length || null) ?? (unitTotal || null);
  // 별첨에 동 표기가 있는 단지만 「동호수별」이다 — 다세대·빌라는 호만 실린다(사용자 지적 2026-09-09)
  const unitLabel = units.some((u) => u.building) ? "동호수별 정보" : "호실별 정보";
  const hasFacts = supply.length > 0 || units.length > 0;

  // 요약 스트립·태그 줄과 겹치지 않는 값만 남긴다. 전부 비면 표 자체를 그리지 않는다
  // [라벨, 값, 라벨을 줄여 쓴 자리의 사전 표제어]
  const specs: [string, string, string?][] = ([
    ["공용면적", supply.length ? m2(commonArea(supply[0])) : null],
    ["계약면적", supply[0]?.area_total != null ? m2(supply[0].area_total) : null],
    ["구조", layouts.length ? layouts.join(" | ") : null],
    ["승강기", elevators.length ? elevators.join(" | ") : null],
    ["난방", c.heating],
    // 공가는 우선·일반 배분이 적힌 공고에만 있다. 재공급 표에 모집호수만 있는 공고에서 「공가 0호」를 쓰면 거짓말이 된다
    ["현재 공가", hasReserve && vacantTotal > 0 ? num(vacantTotal, "호") : null, "공가"],
    ["예비자 모집", hasReserve && reserveTotal > 0 ? num(reserveTotal, "호") : null, "예비입주자"],
    ["계약금", downPayment != null ? wonKo(downPayment) : null],
    ["잔금", balance != null ? wonKo(balance) : null],
  ] as [string, string | null, string?][]).filter((r): r is [string, string, string?] => r[1] != null && r[1] !== "");

  // 화면에 실제로 쓴 말만 페이지 밑에 편다. 이건 서버 렌더용 밑그림이고, 브라우저에서는 GlossaryList가
  // 실제로 걸린 링크로 목록을 다시 맞춘다 — 손으로 맞춘 목록은 어긋나기 마련이다(사용자 지적 2026-09-09)
  const terms = [
    kind,
    n.housing_type,
    // 「공급 정보」 표는 위에서 만든 specs가 곧 라벨이다 — 두 곳을 따로 관리하지 않는다
    ...specs.map(([label, , term]) => term ?? label),
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
            <Kpi label="공급 호수" value={unitCount != null ? num(unitCount, "호") : null} sub={kind} />
            <Kpi label="입주 시작" value={moveIn} sub={moveIn ? "공고문 예정일" : null} />
          </div>

          {/* 제원과 공급현황은 한 섹션이다 — 같은 표를 세로/가로로 두 번 나눠 보여줄 이유가 없다(사용자 요청 2026-09-09) */}
          <section className="dsec">
            <h2>공급 정보{supply.length > 0 && unitTotal > 0 ? ` | ${num(unitTotal, "호")}` : ""}</h2>
            {/* 단지명·주소·지역은 머리글이, 공급 구분·유형은 태그 줄이, 호수·전용면적·입주 시작은 위 요약 스트립이
                이미 말했다 — 여기 남기는 건 그 어디에도 없는 값뿐이다(사용자 지적 2026-09-09: 겹치는 정보 없애기) */}
            {specs.length > 0 && (
              <SpecList>
                {specs.map(([label, value, term]) => <Spec key={label} label={label} value={value} term={term} />)}
              </SpecList>
            )}

            {supply.length > 0 && (
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

            {/* 주차·관리비는 SH 공고문 첨부에 없는 값이다 — 없다고 하지 않고 어디서 확인하는지 말한다 */}
            <p className="note">주차장과 관리비, 주차 요금은 공고문 첨부에 실리지 않아 아직 싣지 못합니다. 계약 전에 관리사무소나 {L.originalDoc}에서 확인하세요.</p>
            {units.length > 0 && <p className="note" style={{ marginTop: 4 }}>호실별 층, 구조, 승강기, 금액은 아래 「{unitLabel}」에 있습니다.</p>}
          </section>

          {/* 사진·도면은 공급현황 바로 뒤 — 어떤 주택형이 나왔는지 본 다음 그 형의 평면도를 본다.
              단지 코드가 안 붙은 단지(신규 미준공)와 SH가 자료를 안 올린 단지는 섹션을 감추지 않고 왜 비었는지 말한다 */}
          <section className="dsec">
            {/* 장수는 실제로 펼쳐 놓은 것만 센다 — 딴 주택형까지 세면 「47장」이라 해 놓고 12장을 보여준다 */}
            <h2>사진과 도면{images.length > 0 ? ` | ${count(shownImages(images, supplyTypes).length, "장")}` : ""}</h2>
            {images.length > 0 ? (
              <ComplexGallery images={images} biznsCd={c.sh_bizns_cd!} complexName={c.name} supplyTypes={supplyTypes} />
            ) : (
              <Pending
                title="이 단지의 사진과 도면은 아직 준비 중입니다"
                lead={c.sh_bizns_cd
                  ? <>서울주택도시공사가 이 단지의 평면도와 사진을 아직 공개하지 않았습니다. 준공 전이거나 자료 등록이 늦는 단지입니다.</>
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
                {hasRent && (
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

          <section className="dsec">
            <h2>위치</h2>
            <div className="d-map"><NaverMap address={full} title={c.name} sub={mapSub} zoom={NAVER_MAP_COMPLEX_ZOOM} /></div>
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
