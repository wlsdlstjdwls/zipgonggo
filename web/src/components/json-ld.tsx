import { jsonLdString } from "@/lib/jsonld";

/** 구조화 데이터 한 덩이. 페이지마다 `@graph` 하나만 그린다 — 조각을 여러 <script>로 나누면
 *  파서가 서로를 못 잇는다(@id 참조가 끊긴다). 서버 컴포넌트 전용. */
export function JsonLd({ graph }: { graph: Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(graph) }} />;
}
