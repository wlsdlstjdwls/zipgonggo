"""Synap 글자 유실 되메우기 회귀. 정답지: 특화형 매입임대 309802·309807 공고문 1쪽 실측 좌표(2026-09-10)."""

import pytest

from zipgonggo_pipeline.parsers.synap_repair import HOLE, drop_positions, holes_by_x, read_number, render, repair


@pytest.mark.parametrize("truth,shown", [
    ("33", f"3{HOLE}"),                    # 계 33.86
    ("50000", f"500{HOLE}0"),              # 관리비 50,000원
    ("36750000", f"367500{HOLE}0"),        # 보증금 36,750,000원
    ("255000", f"25{HOLE}0{HOLE}0"),       # 임대료 255,000원
    ("589000", f"5890{HOLE}0"),            # 309807 임대료 589,000원
    ("2007", f"20{HOLE}7"),                # 「출생일 …~2007.09.10」
    ("11", f"1{HOLE}"),                    # 「~2026.09.11」 서류접수 마감
])
def test_render_matches_observed(truth, shown):
    assert render(truth) == shown


@pytest.mark.parametrize("truth", ["33", "50000", "36750000", "28980000", "589000", "255000", "2007", "34500", "11"])
def test_repair_roundtrip(truth):
    assert repair(render(truth)) == truth


def test_ambiguous_gives_up():
    """후보가 안 좁혀지면 값을 지어내지 않는다."""
    assert repair(HOLE) is None
    assert repair(HOLE + HOLE) is None


def test_no_hole_passes_through():
    assert repair("26290") == "26290"


DEPOSIT_309802 = [(438.0, "3"), (445.0, "6"), (453.0, ","), (457.0, "7"), (465.0, "5"),
                  (473.0, "0"), (480.0, ","), (484.0, "0"), (500.0, "0")]
RENT_309802 = [(570.0, "2"), (579.0, "5"), (594.0, ","), (597.0, "0"), (613.0, "0")]
RENT_309807 = [(571.0, "5"), (578.0, "8"), (586.0, "9"), (594.0, ","), (597.0, "0"), (613.0, "0")]
AREA_TOTAL_309802 = [(224.0, "3"), (240.0, "."), (243.0, "8"), (251.0, "6")]


def test_deposit_row():
    assert holes_by_x(DEPOSIT_309802) == f"367500{HOLE}0"
    assert read_number(DEPOSIT_309802) == 36750000


def test_rent_rows():
    assert read_number(RENT_309802) == 255000
    assert read_number(RENT_309807) == 589000


def test_area_row():
    """면적은 소수점이 다른 줄로 빠져도 자릿수는 그대로다 — 33.86."""
    assert read_number(AREA_TOTAL_309802) == 3386


def test_short_input_is_left_alone():
    assert holes_by_x([(10.0, "1"), (30.0, "2")]) == "12"
