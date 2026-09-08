import Link from "next/link";
import { homePath } from "@/lib/routes";

// 404. "마감된 공고도 삭제하지 않습니다" 문구 유지 — CLAUDE.md 하지 말 것 6(URL을 삭제하지 않는다)
export default function NotFound() {
  return (
    <div className="nf stage" role="status">
      <b className="code" aria-hidden="true">404</b>
      <h1>공고를 찾을 수 없습니다</h1>
      <p>마감된 공고도 삭제하지 않습니다. 주소가 바뀌었거나 아직 발행되지 않은 페이지일 수 있습니다.</p>
      <Link href={homePath({ view: "list" })} className="btn">공고 목록으로</Link>
    </div>
  );
}
