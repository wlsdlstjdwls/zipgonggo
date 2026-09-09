// 용어 링크와 페이지 밑 「용어 설명」 목록(사용자 요청 2026-09-09).
// 링크는 툴팁이 아니라 앵커다 — 모바일에는 호버가 없고, 크롤러도 설명 본문을 읽어야 한다.
// <Term>은 서버 컴포넌트로 둔다: 상세 페이지 대부분이 서버 렌더라 여기에 "use client"를 붙이면 경계가 번진다.
// 목록(GlossaryList)만 클라이언트다 — 접었다 펴고, 링크를 눌렀을 때 그 항목으로 내려간다.
import { glossaryId, glossaryOf } from "@/lib/glossary";

export { GlossaryList } from "./glossary-list";

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
