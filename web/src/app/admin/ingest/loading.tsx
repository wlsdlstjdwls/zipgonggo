// 수집 이력 골격. 필터 칩을 누를 때도 이게 뜬다 — 칩은 링크라 매번 서버를 다녀온다.
import { Box } from "@/components/skeleton";

export default function AdminIngestLoading() {
  return (
    <div className="adm-page">
      <div className="adm-head" aria-hidden="true">
        <Box w={112} h={26} r={6} />
        <div style={{ marginTop: 8 }}>
          <Box w={150} h={14} r={5} />
        </div>
      </div>
      <div className="adm-chips" aria-hidden="true">
        {[56, 62, 40, 40, 40, 40, 40].map((w, i) => (
          <Box key={i} w={w} h={26} r={999} />
        ))}
      </div>
      <Box h={420} r={14} />
    </div>
  );
}
