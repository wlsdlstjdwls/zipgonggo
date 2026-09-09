// 단지 상세 — /notice/{공고}/{단지명}-{단지코드}. docs/url-structure.md의 호실 상세 자리를 지금 있는 최소 단위(단지)로 채운다.
// 좌표를 저장하지 않아(CLAUDE.md 하지 말 것 1) 「얇은 페이지 방지 규칙」의 "좌표 건물 단위"를 못 채운다 → noindex,
// 공고 지도의 앵커로만 노출한다(docs/url-structure.md 표). unit 테이블이 차면 호실 단위로 내려간다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DetailAside } from "@/components/detail-aside";
import { ExternalLink } from "@/components/external-link";
import { NaverMap } from "@/components/naver-map";
import { PriceTable } from "@/components/price-table";
import { Spec, SpecList } from "@/components/spec-list";
import { SupplyTable } from "@/components/supply-table";
import { agencyLabels } from "@/lib/agency";
import { count, dateK, ddayChip, num, wonExact, wonKo } from "@/lib/format";
import { areaText, commonArea, complexPriceRange, complexPriceRows, m2 } from "@/lib/notice-view";
import { getComplexSupply, getNoticeBySlug, getNoticeComplexes } from "@/lib/queries";
import { complexSegment, noticeComplexPath, noticePath } from "@/lib/routes";
import { regionShort, sidoShort } from "@/lib/sido";
import type { Notice, NoticeComplex } from "@/types/notice";

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

export default async function ComplexPage({ params }: Params) {
  const f = await load(params);
  if (!f) notFound();
  const { n, c, siblings } = f;
  const supply = await getComplexSupply(n.id, c.id, c.name);
  // 호수는 (공급유형, 공급대상)마다 한 칸이다 — 청년 소득있음/없음 두 줄이 같은 칸을 나눠 써 두 번 세면 안 된다
  const counted = new Map(supply.filter((s) => s.units_total != null).map((s) => [`${s.supply_type}|${s.tenant_class}`, s]));
  const unitTotal = [...counted.values()].reduce((a, s) => a + (s.units_total ?? 0), 0);
  const vacantTotal = [...counted.values()].reduce((a, s) => a + (s.units_priority ?? 0) + (s.units_general ?? 0), 0);
  const reserveTotal = [...counted.values()].reduce((a, s) => a + (s.units_reserve ?? 0), 0);
  const hasReserve = supply.some((s) => s.units_reserve != null);
  const hasRent = supply.some((s) => s.rent != null);          // 장기전세는 월임대료가 없다
  const hasClass = new Set(supply.map((s) => s.tenant_class)).size > 1 || supply.some((s) => s.income_option);
  const moveIn = supply.find((s) => s.move_in_from)?.move_in_from ?? null;
  const priceBreak = complexPriceRows(supply);
  const d = ddayChip(n);
  const L = agencyLabels(n);
  const area = areaText(c);
  const full = c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
  const i = siblings.findIndex((x) => x.id === c.id);
  const prev = i > 0 ? siblings[i - 1] : null;
  const next = i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null;
  const hasMoney = c.min_deposit != null || c.min_rent != null;
  const priceMax = complexPriceRange(c, supply);
  // 지도 말풍선 보조 글자 — 금액이 있으면 금액, 없으면 면적, 그것도 없으면 자치구
  const mapSub = c.min_rent != null ? `월 ${wonKo(c.min_rent)}`
    : c.min_deposit != null ? `보증금 ${wonKo(c.min_deposit)}`
    : area ?? `${sidoShort(c.sido)} ${c.sigungu}`;

  return (
    <article className="stage">
      {/* 뒤로가기 한 개만 — 「단지 | 지역 | 유형」 줄은 아래 태그와 겹쳐 뺐다(사용자 요청 2026-09-09) */}
      <div className="crumb">
        <Link href={noticePath(n.slug)} className="back">← 공고</Link>
      </div>

      <div className="detail">
        <div className="detail-main">
          <header className="d-head">
            <div className="d-tags">
              {/* D-day는 오른쪽 카드가 크게 센다 — 여기서 또 세지 않는다 */}
              <span className="tag type">{n.housing_type}</span>
              <span className="tag">{regionShort(c)}</span>
              {c.is_new && <span className="tag acc">신규 공급</span>}
            </div>
            <h1 className="d-title">{c.name}</h1>
            <p className="d-sub">{full}</p>
            {hasMoney ? (
              <>
                <span className="jumbo-label">{c.min_rent != null ? "월 임대료" : hasRent ? "임대보증금" : "전세금"}</span>
                <b className="jumbo" title={wonExact(c.min_rent ?? c.min_deposit)}>
                  {priceMax != null ? `${wonKo(c.min_rent ?? c.min_deposit)}~${wonKo(priceMax)}` : wonKo(c.min_rent ?? c.min_deposit)}
                </b>
                {priceMax == null && <span className="jumbo-from">부터</span>}
                {c.min_rent != null && c.min_deposit != null && (
                  <span className="jumbo-sub" title={wonExact(c.min_deposit)}>보증금 {wonKo(c.min_deposit)} 부터</span>
                )}
              </>
            ) : (
              <>
                <span className="jumbo-label">보증금과 임대료</span>
                <span className="jumbo-sub" style={{ marginTop: 0 }}>이 표에는 금액이 없습니다. {L.originalDoc}의 표를 확인하세요.</span>
              </>
            )}
          </header>

          {priceBreak.length > 0 && (
            <section className="dsec">
              <h2>보증금과 임대료</h2>
              <PriceTable rows={priceBreak} />
              {hasRent && (
                <p className="note">
                  공고문 기준값입니다. 계약 때 정해진 비율 안에서 보증금과 월임대료를 서로 전환할 수 있습니다. 전환 한도와 이율은 {L.originalDoc}에서 확인하세요.
                </p>
              )}
            </section>
          )}

          <section className="dsec">
            <h2>단지 제원</h2>
            {/* 단지명·주소·지역·금액은 머리글이 이미 말했다 — 여기선 겹치지 않는 값만(사용자 요청 2026-09-09) */}
            <SpecList>
              <Spec label="공급 호실" value={c.unit_count != null ? num(c.unit_count, "호") : null} />
              <Spec label="전용면적" value={area} />
              <Spec label="공용면적" value={supply.length ? m2(commonArea(supply[0])) : null} />
              <Spec label="계약면적" value={supply[0]?.area_total != null ? m2(supply[0].area_total) : null} />
              <Spec label="난방" value={c.heating} />
              {hasReserve && <Spec label="현재 공가" value={`${num(vacantTotal, "호")}`} />}
              {hasReserve && <Spec label="예비자 모집" value={`${num(reserveTotal, "호")}`} />}
              <Spec label="입주 시작" value={moveIn} />
              <Spec label="주택 유형" value={supply.length ? (supply.some((s) => s.is_new) ? "신규 공급" : "재공급") : null} />
            </SpecList>
            {c.source_page != null && <p className="note">원문 {c.source_page}쪽.</p>}
          </section>

          {supply.length > 0 && (
            <section className="dsec">
              <h2>공급 {count(supply.length, "건")}{unitTotal > 0 && ` | ${num(unitTotal, "호")}`}</h2>
              <SupplyTable supply={supply} hasReserve={hasReserve} hasRent={hasRent} hasClass={hasClass} />
              <p className="note">
                {hasReserve && "공급호수는 공가(우선과 일반)와 예비입주자 모집분을 더한 값입니다."}
                {supply[0]?.source_page != null && ` 원문 ${supply[0].source_page}쪽.`}
              </p>
            </section>
          )}

          <section className="dsec">
            <h2>위치</h2>
            <div className="d-map"><NaverMap address={full} title={c.name} sub={mapSub} /></div>
            <p className="note">지도 위치는 도로명주소 기준 근사치입니다. 핀이나 로드뷰 버튼을 누르면 거리뷰가 열립니다.</p>
          </section>

          {/* 공고와 원문 링크는 오른쪽 카드가 이미 준다 — 고지 한 줄만 남긴다 */}
          <div className="notice-bar">
            <span className="i">i</span>
            <span>본 자료는 참고용입니다. 정확한 내용과 최종 조건은 {n.agency}의 공식 공고문을 반드시 확인하세요.</span>
          </div>

          {(prev || next) && (
            <nav className="pager" aria-label="같은 공고의 다른 단지">
              {prev ? (
                <Link href={noticeComplexPath(n.slug, prev)} className="pager-a">
                  <span>이전 단지</span><b>{prev.name}</b>
                </Link>
              ) : <span />}
              {next && (
                <Link href={noticeComplexPath(n.slug, next)} className="pager-a next">
                  <span>다음 단지</span><b>{next.name}</b>
                </Link>
              )}
            </nav>
          )}
        </div>

        <DetailAside
          tone={d.tone}
          ddayLabel={d.days === null || d.days < 0 ? "접수" : `${d.unit}까지`}
          ddayNum={d.num}
          ddayNote={n.apply_end_at ? `${dateK(n.apply_end_at, true)} ${d.days !== null && d.days < 0 ? "마감됨" : "마감"}` : (n.source_status ?? "일정 미정")}
          cta={
            <>
              <Link className="btn acc lg" href={noticePath(n.slug)}>공고 전체 단지 지도</Link>
              <ExternalLink className="btn lg" href={n.source_url}>{L.original}</ExternalLink>
            </>
          }
          rows={[
            { label: "공급기관", value: n.agency },
            { label: "공고일", value: dateK(n.posted_at) },
            { label: "접수 마감", value: n.apply_end_at ? dateK(n.apply_end_at) : null },
            { label: "문의처", value: n.contact },
          ]}
          updatedNote={`갱신 ${n.updated_at} | ${L.updatedVia}`}
        />
      </div>
    </article>
  );
}
