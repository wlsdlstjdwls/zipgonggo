// 단지 상세 — /notice/{공고}/{단지명}-{단지코드}. docs/url-structure.md의 호실 상세 자리를 지금 있는 최소 단위(단지)로 채운다.
// 좌표를 저장하지 않아(CLAUDE.md 하지 말 것 1) 「얇은 페이지 방지 규칙」의 "좌표 건물 단위"를 못 채운다 → noindex,
// 공고 지도의 앵커로만 노출한다(docs/url-structure.md 표). unit 테이블이 차면 호실 단위로 내려간다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "@/components/external-link";
import { NaverMap } from "@/components/naver-map";
import { Spec, SpecList } from "@/components/spec-list";
import { agencyLabels } from "@/lib/agency";
import { dateK, ddayChip, num, wonExact, wonKo } from "@/lib/format";
import { getNoticeBySlug, getNoticeComplexes } from "@/lib/queries";
import { complexSegment, noticeComplexPath, noticePath, ROUTES } from "@/lib/routes";
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
  // 이름까지 맞는 행이 정답. 이름만 바뀐 옛 링크도 코드가 같으면 살려 준다(URL을 삭제하지 않는다 — CLAUDE.md 6)
  const c = siblings.find((x) => complexSegment(x) === seg) ?? siblings.find((x) => (x.complex_code ?? String(x.id)) === seg.slice(seg.lastIndexOf("-") + 1));
  return c ? { n, c, siblings } : null;
}

/** 단지 한 곳의 면적 표기. 하나뿐이면 값 하나, 범위면 "24~38㎡" */
function areaText(c: NoticeComplex): string | null {
  if (c.area_min == null && c.area_max == null) return null;
  const lo = c.area_min ?? c.area_max;
  const hi = c.area_max ?? c.area_min;
  if (lo == null || hi == null) return null;
  return lo === hi ? `${lo}㎡` : `${lo}~${hi}㎡`;
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
  const d = ddayChip(n);
  const L = agencyLabels(n);
  const area = areaText(c);
  const full = c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
  const i = siblings.findIndex((x) => x.id === c.id);
  const prev = i > 0 ? siblings[i - 1] : null;
  const next = i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null;
  const hasMoney = c.min_deposit != null || c.min_rent != null;

  return (
    <article className="stage">
      <div className="crumb">
        <Link href={noticePath(n.slug)} className="back">← 공고</Link>
        <span>단지 | {regionShort(c)} | {n.housing_type}</span>
      </div>

      <div className="detail">
        <div className="detail-main">
          <header className="d-head">
            <div className="d-tags">
              <span className={`tag ${d.tone}`}>{d.num} {d.unit}</span>
              <span className="tag type">{n.housing_type}</span>
              <span className="tag">{regionShort(c)}</span>
              {c.is_new && <span className="tag acc">신규 공급</span>}
            </div>
            <h1 className="d-title">{c.name}</h1>
            <p className="d-sub">{full}</p>
            {hasMoney ? (
              <>
                <span className="jumbo-label">{c.min_rent != null ? "월 임대료" : "임대보증금"}</span>
                <b className="jumbo" title={wonExact(c.min_rent ?? c.min_deposit)}>{wonKo(c.min_rent ?? c.min_deposit)}</b>
                <span className="jumbo-from">부터</span>
                {c.min_rent != null && c.min_deposit != null && (
                  <span className="jumbo-sub" title={wonExact(c.min_deposit)}>보증금 {wonKo(c.min_deposit)} 부터, 이 단지 최소값</span>
                )}
              </>
            ) : (
              <>
                <span className="jumbo-label">보증금과 임대료</span>
                <span className="jumbo-sub" style={{ marginTop: 0 }}>이 표에는 금액이 없습니다. {L.originalDoc}의 표를 확인하세요.</span>
              </>
            )}
          </header>

          <section className="dsec">
            <h2>단지 제원</h2>
            <SpecList>
              <Spec label="단지명" value={c.name} />
              <Spec label="공급 호실" value={c.unit_count != null ? num(c.unit_count, "호") : null} />
              <Spec label="전용면적" value={area} />
              <Spec label="임대보증금" value={c.min_deposit != null ? <span title={wonExact(c.min_deposit)}>{wonKo(c.min_deposit)} 부터</span> : null} />
              <Spec label="월 임대료" value={c.min_rent != null ? <span title={wonExact(c.min_rent)}>{wonKo(c.min_rent)} 부터</span> : null} />
              <Spec label="지역" value={`${sidoShort(c.sido)} ${c.sigungu}`} />
              <Spec label="단지 코드" value={c.complex_code} />
              <Spec label="주소" value={full} wide />
            </SpecList>
            <p className="note">
              {c.unit_count != null
                ? "첨부 공고문 별첨 「주택목록」의 이 단지 행을 묶은 값입니다. 금액은 단지 안 최소값이고, 호별 금액과 층·동호는 원문 표를 확인하세요."
                : "첨부 공고문 「주택 위치 안내」 표에서 읽은 값입니다. 면적과 호수, 금액은 원문 표를 확인하세요."}
              {c.source_page != null && ` 원문 ${c.source_page}쪽.`}
            </p>
          </section>

          <section className="dsec">
            <h2>위치</h2>
            <div className="d-map"><NaverMap address={full} title={c.name} /></div>
            <p className="note">지도 위치는 도로명주소 기준 근사치입니다. {full}</p>
          </section>

          <section className="dsec">
            <h2>이 단지가 속한 공고</h2>
            <ul className="amend-list">
              <li>
                <Link href={noticePath(n.slug)}>
                  <span className="chip amend">{n.agency}</span> {n.title} <small>{dateK(n.posted_at)}</small>
                </Link>
              </li>
            </ul>
            <ul className="link-list" style={{ marginTop: 10 }}>
              <li><ExternalLink href={n.source_url}>{L.originalListItem} ↗</ExternalLink></li>
              {n.portal_url && <li><ExternalLink href={n.portal_url}>{L.portalListItem} ↗</ExternalLink></li>}
            </ul>
            <div className="notice-bar" style={{ margin: "16px 0 0" }}>
              <span className="i">i</span>
              <span>본 자료는 참고용입니다. 정확한 내용과 최종 조건은 {n.agency}의 공식 공고문을 반드시 확인하세요.</span>
            </div>
          </section>

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

        <aside className="aside">
          <div className="aside-in">
            <div className={`dcard tone-${d.tone}`}>
              <span>{d.days === null || d.days < 0 ? "접수" : `${d.unit}까지`}</span>
              <b>{d.num}</b>
              <p>{n.apply_end_at ? `${dateK(n.apply_end_at, true)} ${d.days !== null && d.days < 0 ? "마감됨" : "마감"}` : (n.source_status ?? "일정 미정")}</p>
            </div>
            <Link className="btn acc lg" href={noticePath(n.slug)}>공고 전체 단지 지도</Link>
            <ExternalLink className="btn lg" href={n.source_url}>{L.original}</ExternalLink>
            <div className="specs">
              <span className="t">공고 제원</span>
              <div className="r"><span>공급기관</span><b>{n.agency}</b></div>
              <div className="r"><span>공급유형</span><b>{n.housing_type}</b></div>
              <div className="r"><span>공고일</span><b>{dateK(n.posted_at)}</b></div>
              <div className="r"><span>접수 마감</span><b>{n.apply_end_at ? dateK(n.apply_end_at) : "—"}</b></div>
              <div className="r"><span>문의처</span><b>{n.contact ?? "—"}</b></div>
              <span className="u">갱신 {n.updated_at} | {L.updatedVia}</span>
            </div>
            <p className="note" style={{ margin: "12px 0 0" }}>이 페이지는 공고 지도에서 들어오는 앵커입니다. 검색 색인은 하지 않습니다.</p>
          </div>
        </aside>
      </div>
    </article>
  );
}
