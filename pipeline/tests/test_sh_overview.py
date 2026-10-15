"""「모집개요」 라벨 줄 파서 — 구청 수요자 맞춤형 공고(311087, 311549, 311349)의 실제 글줄."""

from datetime import date

from zipgonggo_pipeline.parsers.sh_overview import parse_overview_lines


def test_dojeonsuk_seongbuk():
    sch, count = parse_overview_lines([
        "▢공고기간 : 2026. 10. 14. ~ 10. 28.",
        "▢접수기간 : 2026. 10. 21. ~ 10. 28.",
        "▢당첨자발표 : 2026. 12. 23.(수) 예정",
        "▢공급호수 : 총 41세대",
    ], date(2026, 10, 14))
    assert (sch.apply_start, sch.apply_end, sch.announce) == (date(2026, 10, 21), date(2026, 10, 28), date(2026, 12, 23))
    assert count == 41


def test_synap_dropped_digit_repaired_by_weekday():
    # 원문 「10. 22.(목) 15:00」 — Synap이 잇단 2, 0 하나씩을 떨어뜨렸다. 10월 2일은 금요일이라 요일로 22일을 고른다
    sch, count = parse_overview_lines([
        "m 접수기간: 2026. 10. 8.(목) ~ 10. 2.(목) 15:0 《15:0 이후 도착분은 접수 불가》",
        "m 공급호수: 총 7개소 37호실",
        "m 신청기간: 2026. 10. 8.(목) ~ 10. 2.(목) 15:0 | m 발표일시: 2026 12 30(수) ※ 강동구청 홈페이지 게시",
    ], date(2026, 10, 8))
    assert (sch.apply_start, sch.apply_end, sch.announce) == (date(2026, 10, 8), date(2026, 10, 22), date(2026, 12, 30))
    assert count == 37


def test_no_weekday_does_not_guess():
    # 요일이 없으면 겹친 후보를 지어내지 않는다 — 마감이 시작보다 앞서면 버린다
    sch, _ = parse_overview_lines(["접수기간 : 2026. 10. 8. ~ 10. 2."], date(2026, 10, 8))
    assert (sch.apply_start, sch.apply_end) == (date(2026, 10, 8), None)


def test_hwpx_lines_eunbit():
    sch, count = parse_overview_lines([
        "은평구는 … 잔여 세대(2세대)의 입주자 및 예비입주자를 추가 모집합니다.",
        "접수일시 : 2026. 10. 26.(월) ~ 11. 6.(금) [09:00 ∼ 18:00]",
        "당첨자 발표 : 2026. 11. 19.(목) 10:00 (※입주자선정 심의 일정에 따라 변경될 수 있음)",
    ], date(2026, 10, 12))
    assert (sch.apply_start, sch.apply_end, sch.announce) == (date(2026, 10, 26), date(2026, 11, 6), date(2026, 11, 19))
    assert count == 2


def test_date_before_posting_is_dropped():
    sch, _ = parse_overview_lines(["접수기간 : 2025. 3. 2.(일) ~ 3. 9.(일)"], date(2026, 10, 8))
    assert sch is None or sch.apply_start is None
