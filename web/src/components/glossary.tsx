// 용어 링크와 페이지 밑 「용어 설명」 목록(사용자 요청 2026-09-09).
// 링크는 툴팁이 아니라 앵커다 — 모바일에는 호버가 없고, 크롤러도 설명 본문을 읽어야 한다.
// <Term>은 서버 컴포넌트로 둔다: 상세 페이지 대부분이 서버 렌더라 여기에 "use client"를 붙이면 경계가 번진다.
import { glossaryFor, glossaryId, glossaryOf } from "@/lib/glossary";

/** 본문 속 용어 한 마디. 사전에 없는 말은 그냥 글자로 지나간다 */
export function Term({ children, as }: { children: string; as?: string }) {
  const entry = glossaryOf(children);
  if (!entry) return <>{as ?? children}</>;
  return (
    <a className="term" href={`#${glossaryId(children)}`} title={entry.def}>
      {as ?? children}
    </a>
  );
}

/** 페이지 밑 설명 묶음. terms에 없는 말은 그리지 않는다 */
export function GlossaryList({ terms }: { terms: readonly string[] }) {
  const items = glossaryFor(terms);
  if (items.length === 0) return null;
  return (
    <section className="dsec gloss">
      <h2>용어 설명</h2>
      <dl className="gloss-l">
        {items.map((g) => (
          <div key={g.term} id={glossaryId(g.term)}>
            <dt>{g.term}</dt>
            <dd>{g.def}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
