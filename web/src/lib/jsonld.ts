// JSON-LD(구조화 데이터) 조립. docs/url-structure.md가 페이지 타입마다 정해 둔 스키마를 여기 한 군데서 만든다.
//
// 왜 필요한가 — 검색 엔진이 "이 페이지는 임대 공고이고, 접수가 언제부터 언제까지이고, 어느 단지가 딸렸는지"를
// 본문 파싱이 아니라 선언으로 읽는다. 네이버 서치어드바이저는 특히 이 신호 비중이 크다.
//
// 규칙 셋:
// 1. **화면에 없는 사실을 쓰지 않는다.** 구조화 데이터와 지면이 어긋나면 스팸으로 판정된다.
// 2. 값이 없으면 키를 뺀다. `null`·빈 문자열을 넣으면 파서가 오류로 읽는다.
// 3. 한 페이지의 조각들은 `@graph`로 묶고 `@id`(URL#조각)로 서로를 가리킨다 — 같은 것을 두 번 말하지 않는다.
import { SITE_DESCRIPTION, SITE_NAME } from "./constants";
import { absoluteUrl, SITE_URL } from "./site-url";
import type { Notice, NoticeComplex } from "@/types/notice";

/** ItemList에 싣는 단지 수 상한. 지면이 늘 그렇듯 목록이 길어도 HTML을 무한정 불리지 않는다 */
const ITEMLIST_MAX = 100;

type Json = Record<string, unknown>;

/** 사이트 전역 식별자. 페이지 조각들이 isPartOf/publisher로 이걸 가리킨다 */
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const ORG_ID = `${SITE_URL}/#organization`;

/** 값이 있는 키만 남긴다 — 규칙 2 */
function compact(o: Json): Json {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

/** 홈에만 한 번. 사이트 자체가 무엇인지 — 검색 결과의 사이트명에 쓰인다 */
export function siteGraph(): Json[] {
  return [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      logo: absoluteUrl("/icons/icon-512.png"),
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      name: SITE_NAME,
      url: SITE_URL,
      inLanguage: "ko-KR",
      publisher: { "@id": ORG_ID },
    },
  ];
}

/** 빵부스러기. 화면의 경로 표시와 **같은 순서·같은 링크**여야 한다 */
export function breadcrumb(id: string, items: { name: string; path: string }[]): Json {
  return {
    "@type": "BreadcrumbList",
    "@id": id,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  };
}

function postalAddress(c: Pick<NoticeComplex, "sido" | "sigungu" | "road_address">): Json {
  return compact({
    "@type": "PostalAddress",
    addressCountry: "KR",
    addressRegion: c.sido,
    addressLocality: c.sigungu,
    streetAddress: c.road_address,
  });
}

/**
 * 공고 상세 `/notice/{공고}` — docs/url-structure.md: `ItemList` + `Event`.
 * 페이지 자체는 `RealEstateListing`(WebPage 하위)으로 선언한다 — 임대 공고 지면에 딱 맞는 타입이다.
 *
 * @param path  이 페이지의 canonical 경로(정본이 따로 있으면 정본 경로) — @id가 canonical과 어긋나면 안 된다
 * @param crumbs 화면 경로 표시와 같은 항목
 */
export function noticeGraph(
  n: Notice,
  complexes: NoticeComplex[],
  path: string,
  crumbs: { name: string; path: string }[],
  description: string,
): Json[] {
  const url = absoluteUrl(path);
  const pageId = `${url}#page`;
  const eventId = `${url}#apply`;
  const listId = `${url}#complexes`;
  const crumbId = `${url}#breadcrumb`;
  const graph: Json[] = [];

  graph.push(
    compact({
      "@type": "RealEstateListing",
      "@id": pageId,
      url,
      name: n.title,
      description,
      // posted_at은 "YYYY-MM-DD" 문자열이다(lib/format의 날짜 함수들이 그 전제로 돌아간다)
      datePosted: n.posted_at,
      inLanguage: "ko-KR",
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORG_ID },
      breadcrumb: { "@id": crumbId },
      ...(complexes.length > 0 ? { mainEntity: { "@id": listId } } : {}),
    }),
  );

  // 접수 기간. Event는 startDate가 필수라 접수 시작일이 없으면 아예 만들지 않는다 —
  // 공고일로 메우면 지면에 없는 사실을 말하는 게 된다(규칙 1)
  if (n.apply_start_at) {
    graph.push(
      compact({
        "@type": "Event",
        "@id": eventId,
        name: `${n.title} 접수`,
        startDate: n.apply_start_at,
        endDate: n.apply_end_at ?? n.apply_start_at,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
        organizer: { "@type": "Organization", name: n.agency },
        location: { "@type": "VirtualLocation", url: n.portal_url ?? url },
        about: { "@id": pageId },
        url,
      }),
    );
  }

  if (complexes.length > 0) {
    graph.push({
      "@type": "ItemList",
      "@id": listId,
      name: `${n.title} 공급 단지`,
      numberOfItems: complexes.length,
      itemListElement: complexes.slice(0, ITEMLIST_MAX).map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: compact({
          "@type": "ApartmentComplex",
          name: c.name,
          address: postalAddress(c),
          // 좌표는 행안부 요약DB 오프라인 조인 결과만 — 지오코딩 API 값은 저장도 발행도 하지 않는다(CLAUDE.md 하지 말 것 1)
          ...(c.lat != null && c.lng != null
            ? { geo: { "@type": "GeoCoordinates", latitude: c.lat, longitude: c.lng } }
            : {}),
          ...(c.unit_count != null
            ? { numberOfAvailableAccommodationUnits: { "@type": "QuantitativeValue", value: c.unit_count } }
            : {}),
        }),
      })),
    });
  }

  graph.push(breadcrumb(crumbId, crumbs));
  return graph;
}

/** 지역 착지 `/area/{시도}` — docs/url-structure.md: `CollectionPage` */
export function areaGraph(
  sido: string,
  total: number,
  path: string,
  crumbs: { name: string; path: string }[],
  description: string,
): Json[] {
  const url = absoluteUrl(path);
  const crumbId = `${url}#breadcrumb`;
  return [
    {
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      url,
      name: `${sido} 입주자모집공고`,
      description,
      inLanguage: "ko-KR",
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORG_ID },
      breadcrumb: { "@id": crumbId },
      mainEntity: { "@type": "ItemList", name: `${sido} 입주자모집공고`, numberOfItems: total },
    },
    breadcrumb(crumbId, crumbs),
  ];
}

/** 단지 상세 — 색인은 막혀 있지만(좌표 확보 전) 구조는 같은 규격으로 낸다 */
export function complexGraph(
  n: Notice,
  c: NoticeComplex,
  path: string,
  crumbs: { name: string; path: string }[],
  description: string,
): Json[] {
  const url = absoluteUrl(path);
  const crumbId = `${url}#breadcrumb`;
  return [
    compact({
      "@type": "ApartmentComplex",
      "@id": `${url}#complex`,
      name: c.name,
      url,
      description,
      address: postalAddress(c),
      ...(c.lat != null && c.lng != null
        ? { geo: { "@type": "GeoCoordinates", latitude: c.lat, longitude: c.lng } }
        : {}),
      ...(c.unit_count != null
        ? { numberOfAvailableAccommodationUnits: { "@type": "QuantitativeValue", value: c.unit_count } }
        : {}),
      ...(n.heating || c.heating ? { amenityFeature: { "@type": "LocationFeatureSpecification", name: "난방", value: c.heating ?? n.heating } } : {}),
    }),
    breadcrumb(crumbId, crumbs),
  ];
}

/** `@graph` 한 덩이로 감싼 최종 문자열. `</script>`가 본문에 섞여 스크립트가 끊기지 않게 `<`를 이스케이프한다 */
export function jsonLdString(graph: Json[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}
