"""목록 재수집이 첨부에서 읽은 값을 지우지 않는지. 화면에 「원문 확인」이 뜨던 회귀(2026-09-10)."""

import re

from zipgonggo_pipeline.repo import UPSERT_SQL


def assign(col: str) -> str:
    m = re.search(rf"\b{col} = ([^,]+(?:\([^)]*\))?[^,]*)", UPSERT_SQL)
    assert m, f"{col} 갱신 구문이 없다"
    return m.group(1)


def test_목록에_없는_일정은_기존_값을_지키다():
    # S1(포털 목록)은 접수일을 안 준다. EXCLUDED를 그대로 쓰면 S3이 첨부에서 읽은 날짜가 매시 날아간다
    for col in ("apply_start_at", "apply_end_at", "announce_at"):
        assert assign(col).startswith(f"COALESCE(EXCLUDED.{col}")


def test_금액과_호수도_NULL로_덮지_않는다():
    for col in ("supply_count", "min_deposit", "min_rent"):
        assert assign(col).startswith(f"COALESCE(EXCLUDED.{col}")


def test_상태는_목록이_이긴다():
    # 마감 여부는 목록이 정본이다 — 여기까지 COALESCE로 막으면 마감이 영영 안 붙는다
    assert assign("status") == "EXCLUDED.status"
    assert assign("source_status") == "EXCLUDED.source_status"


def test_slug은_갱신하지_않는다():
    # URL 불변(CLAUDE.md 하지 말 것 6)
    assert " slug = " not in UPSERT_SQL
