// 용어 링크와 페이지 밑 「용어 설명」 목록(사용자 요청 2026-09-09).
// 링크는 툴팁이 아니라 앵커다 — 모바일에는 호버가 없고, 크롤러도 설명 본문을 읽어야 한다.
// <Term>은 서버 컴포넌트로 둔다: 상세 페이지 대부분이 서버 렌더라 여기에 "use client"를 붙이면 경계가 번진다.
// 목록(GlossaryList)만 클라이언트다 — 접었다 펴고, 링크를 눌렀을 때 그 항목으로 내려간다.
import { glossaryId, glossaryOf, splitTerms } from "@/lib/glossary";

export { GlossaryList } from "./glossary-list";

/** 문자열 안에 섞인 용어를 전부 링크로. 라벨·표 칸처럼 우리가 만든 짧은 문자열에만 쓴다 —
 *  공고 제목처럼 기관 원문 그대로 싣는 값에는 쓰지 않는다(엉뚱한 자리에 밑줄이 생긴다) */
export function TermText({ children }: { children: string }) {
  const parts = splitTerms(children);
  if (parts.length === 1 && !parts[0].term) return <>{children}</>;
  return (
    <>
      {parts.map((p, i) => (p.term ? <Term key={i}>{p.text}</Term> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** 본문 속 용어 한 마디. 사전에 없는 말은 그냥 글자로 지나간다 */
export function Term({ children, as }: { children: string; as?: string }) {
  const entry = glossaryOf(children);
  if (!entry) return <>{as ?? children}</>;
  // 앞의 물음표 아이콘은 CSS ::before가 그린다 — 눌러서 뜻을 볼 수 있다는 표시(사용자 요청 2026-09-09)
  return (
    <a className="term" href={`#${glossaryId(children)}`} title={entry.def}>
      {as ?? children}
    </a>
  );
}
