// 마이홈 단지정보·대기현황(S5, 0031·0032)을 공고 지면에 싣는 섹션.
//
// **왜 있나.** 마이홈 API로 들어오는 공고(LH 328건)는 첨부 공고문을 열 수 없다 — LH robots.txt가
// 첨부 경로(`lhFile.do`)를 막는다(docs/data-sources.md 6절). 그래서 공급현황도 단지 표도 자격도 0행이고,
// 지면에 목록 필드 몇 개만 남아 구글이 「크롤링됨 — 현재 색인이 생성되지 않음」으로 밀어냈다(2026-09-17 실측).
// 공고문 대신 **개방 API가 주는 단지 쪽 사실**을 싣는 자리가 여기다.
//
// 세 가지를 지킨다.
//  1. 형·대기는 **이 공고의 공급유형 것만** 온다(queries.getComplexFacts). 한 단지에 영구임대와 50년임대가
//     같이 있는 일이 흔해, 전부 실으면 이 공고로는 신청할 수 없는 금액이 표에 섞인다.
//  2. 금액은 **단지의 기본값**이지 이번 공고의 금액이 아니다. 그렇게 적는다 — 공고 금액인 척하면 거짓말이다.
//  3. 대기 수는 **대기 순번이 아니라 기다리는 사람 수**다(API waitCo). 「내 순번」으로 읽히지 않게 적는다.
import { Term } from "@/components/glossary";
import { Spec, SpecList } from "@/components/spec-list";
import { dateK, num, wonKo } from "@/lib/format";
import type { ComplexFacts } from "@/types/notice";

/** 「51.79~51.92㎡」 — 같은 형이라도 동마다 실측 면적이 조금씩 다르다(0031). 하한과 상한이 같으면 한 값만 */
function area(lo: number | null, hi: number | null): string {
  if (lo === null || lo === undefined) return "—";
  return hi != null && hi !== lo ? `${lo}~${hi}㎡` : `${lo}㎡`;
}

export function ComplexFactsSection({ facts, housingType }: { facts: ComplexFacts; housingType: string }) {
  const waiting = facts.waitlist.reduce((a, w) => a + (w.waiting_cnt ?? 0), 0);
  const hasVacated = facts.waitlist.some((w) => (w.vacated_cnt ?? 0) > 0);
  // 형명과 추첨단위가 같은 말이면 한 열로 족하다(「36」/「36」). 갈리는 단지만 두 열로 그린다
  const splitUnit = facts.waitlist.some((w) => w.draw_unit && w.draw_unit !== w.style_name);

  return (
    <section className="dsec" id="complex">
      <h2>단지 정보 <small className="dsec-src">마이홈포털 단지정보</small></h2>
      <SpecList>
        <Spec label="단지명" value={facts.name} />
        <Spec label="공급 기관" value={facts.agency} />
        <Spec label="준공" value={facts.completed_on ? dateK(facts.completed_on) : null} />
        <Spec label="총세대수" value={facts.household_cnt != null ? num(facts.household_cnt, "세대") : null} />
        <Spec label="주차" value={facts.parking_cnt != null ? num(facts.parking_cnt, "대") : null} />
        <Spec label="구조" value={facts.building_style} />
        <Spec label="승강기" value={facts.elevator} />
        <Spec label="난방" value={facts.heating} />
        <Spec label="주소" value={facts.road_address} wide />
      </SpecList>

      {facts.types.length > 0 && (
        <div className="dsub">
          <h3>주택형별 기본 보증금과 임대료</h3>
          <div className="tbl stack list">
            <table>
              <thead>
                <tr>
                  <th>주택형</th>
                  <th className="num">전용면적</th>
                  <th className="num">공용면적</th>
                  <th className="num">보증금</th>
                  <th className="num">월임대료</th>
                  <th className="num"><Term as="전환보증금 한도">전세전환</Term></th>
                </tr>
              </thead>
              <tbody>
                {facts.types.map((t) => (
                  <tr key={`${t.style_name}-${t.base_deposit}-${t.base_rent}`}>
                    <td>{t.style_name}형</td>
                    <td className="num" data-label="전용면적">{area(t.exclusive_area, t.exclusive_area_max)}</td>
                    <td className="num" data-label="공용면적">{area(t.common_area, t.common_area_max)}</td>
                    <td className="num lead" data-label="보증금">{wonKo(t.base_deposit)}</td>
                    <td className="num" data-label="월임대료">{t.base_rent ? wonKo(t.base_rent) : "—"}</td>
                    <td className="num" data-label="전세전환">{t.conversion_deposit_limit ? wonKo(t.conversion_deposit_limit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            이 단지 {housingType}의 <b>기본 금액</b>입니다. 이번 공고로 실제 계약하는 금액은 순위와 계층, 전환 비율에 따라 달라집니다.
            같은 주택형인데 면적이 범위로 적힌 것은 동과 라인마다 실측 면적이 조금씩 다르기 때문입니다.
          </p>
        </div>
      )}

      {facts.waitlist.length > 0 && (
        <div className="dsub">
          <h3>예비 입주 대기</h3>
          <div className="tbl stack list">
            <table>
              <thead>
                <tr>
                  <th>주택형</th>
                  {splitUnit && <th>추첨 단위</th>}
                  <th className="num">대기 인원</th>
                  {hasVacated && <th className="num">퇴거</th>}
                </tr>
              </thead>
              <tbody>
                {facts.waitlist.map((w) => (
                  <tr key={`${w.style_name}-${w.draw_unit}`}>
                    <td>{w.style_name}형</td>
                    {splitUnit && <td data-label="추첨 단위">{w.draw_unit || "—"}</td>}
                    <td className="num lead" data-label="대기 인원">{w.waiting_cnt != null ? num(w.waiting_cnt, "명") : "—"}</td>
                    {hasVacated && <td className="num" data-label="퇴거">{w.vacated_cnt != null ? num(w.vacated_cnt, "건") : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            {facts.surveyed_on ? `${dateK(facts.surveyed_on)} 기준. ` : ""}
            지금 이 단지를 기다리는 사람이 모두 {num(waiting, "명")}입니다. <b>대기 순번이 아니라 인원 수</b>입니다.
            {hasVacated && " 퇴거는 예비 명부에서 빠져나간 건수라, 이 숫자가 클수록 차례가 빨리 돌아옵니다."}
          </p>
        </div>
      )}
    </section>
  );
}
