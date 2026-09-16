// 탭을 누른 순간 뜨는 골격. 콘솔은 force-dynamic이라 누를 때마다 서버를 다녀오는데,
// 이 파일이 없으면 다녀오는 동안 화면이 **옛 화면 그대로 멈춰** 있어 「눌렸나?」 싶어진다.
// 이게 있으면 Next가 링크를 미리 받아 두었다가 누르는 즉시 이 골격으로 바꾼다.
import { Box } from "@/components/skeleton";

function Cards({ count, h }: { count: number; h: number }) {
  return (
    <div className="adm-stats" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <Box key={i} h={h} r={14} />
      ))}
    </div>
  );
}

export default function AdminLoading() {
  return (
    <div className="adm-page">
      <div className="adm-head" aria-hidden="true">
        <Box w={132} h={26} r={6} />
        <div style={{ marginTop: 8 }}>
          <Box w={230} h={14} r={5} />
        </div>
      </div>
      <div className="adm-sec">
        <Box w={70} h={13} r={4} />
        <div style={{ marginTop: 10 }}>
          <Cards count={6} h={78} />
        </div>
      </div>
      <div className="adm-sec">
        <Box w={44} h={13} r={4} />
        <div style={{ marginTop: 10 }}>
          <Cards count={4} h={82} />
        </div>
      </div>
      <div className="adm-sec">
        <Box h={200} r={14} />
      </div>
    </div>
  );
}
