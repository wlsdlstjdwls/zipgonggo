import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <p>페이지를 찾을 수 없습니다.</p>
      <Link href="/" className="back">← 공고 목록</Link>
    </div>
  );
}
