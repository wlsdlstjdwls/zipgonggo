// 방문 화면 골격. 기간 칩을 누를 때도 이게 뜬다 — 칩은 링크라 매번 서버를 다녀온다.
import { Box } from "@/components/skeleton";

export default function AdminVisitorsLoading() {
  return (
    <div className="adm-page">
      <div className="adm-head" aria-hidden="true">
        <Box w={60} h={26} r={6} />
        <div style={{ marginTop: 8 }}>
          <Box w={280} h={14} r={5} />
        </div>
      </div>
      <div className="adm-stats" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} h={82} r={14} />
        ))}
      </div>
      <div className="adm-chips" aria-hidden="true">
        {[46, 56, 56, 56, 46].map((w, i) => (
          <Box key={i} w={w} h={26} r={999} />
        ))}
      </div>
      <div className="adm-sec">
        <Box h={148} r={14} />
      </div>
      <div className="adm-sec">
        <Box h={260} r={14} />
      </div>
    </div>
  );
}
