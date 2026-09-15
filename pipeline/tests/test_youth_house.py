"""청년안심주택 포털 「주택찾기」 단지 상세 이미지 파서.

픽스처는 홍대입구역 맹그로브창천(homeCode 20000610) 상세 HTML 원본(2026-09-15). 통째로 둔다 —
목록 렌더링 스크립트 안에 `…fileId+ "&fileSn=` 같은 **가짜 img 템플릿**이 들어 있어서, 그걸 걸러 내는지가
이 파서의 핵심이다. 잘라 낸 픽스처로는 그 함정을 못 지킨다.
"""

from pathlib import Path

from zipgonggo_pipeline.sources.youth_house import house_from_row, parse_images

FIX = Path(__file__).parent / "fixtures" / "youth_house"


def images(name="20000610_mangrove"):
    return parse_images((FIX / f"{name}.html").read_text(encoding="utf-8"))


def test_kinds_and_counts():
    """맹그로브창천 — 평면도 3, 전경 1, 투시도 1, 편의시설 6."""
    by_kind = {}
    for im in images():
        by_kind.setdefault(im.kind, []).append(im)
    assert {k: len(v) for k, v in by_kind.items()} == {"평면도": 3, "전경": 1, "투시도": 1, "편의시설": 6}


def test_plan_images_come_first():
    """갤러리 첫 탭이 평면도여야 한다 — 청약자가 제일 먼저 찾는 그림이다."""
    assert [im.kind for im in images()][:3] == ["평면도"] * 3


def test_script_template_is_not_an_image():
    """목록 스크립트의 `src='…fileId+ "&fileSn='`은 경로가 아니다. 이걸 실으면 전 단지에 액박이 뜬다."""
    for im in images():
        assert "+" not in im.path and '"' not in im.path
        assert im.path.startswith("/") and "atchFileId=" in im.path


def test_both_download_prefixes_survive():
    """포털이 `/cohome/`과 `/coHouse/` 두 프리픽스를 섞어 쓴다. 하나로 통일하면 절반이 404가 된다."""
    prefixes = {im.path.split("/cmmn/")[0] for im in images()}
    assert prefixes == {"/cohome", "/coHouse"}


def test_plan_caption_is_empty():
    """평면도 alt는 `{주택명}_평면도_3`이라 캡션으로 쓸 말이 없다. 주택명을 캡션에 넣지 않는다."""
    assert all(im.label is None for im in images() if im.kind == "평면도")


def test_house_row_reads_maintenance_fee():
    """관리비는 포털 목록 행에 있다 — 공고문 첨부에는 없어 지면에서 비워 둔 값이다."""
    h = house_from_row({
        "homeCode": "20000610", "homeName": "홍대입구역 맹그로브창천",
        "adres": "서울 서대문구 신촌로 35 맹그로브창천", "adresGu": "서대문구",
        "fileId": "50a4d8b4807d4989a3a43e9b46dd4a81", "fileSn": 1,
        "youthMaintenanceFee": "110000", "coupleMaintenanceFee": "140000",
        "managerComp": "(주)맹그로브제1호위탁관리부동산투자회사", "movinHoman": "288",
    })
    assert h.home_code == "20000610" and h.maint_low == 110_000 and h.maint_high == 140_000
    assert h.source_url.endswith("homeCode=20000610")


def test_missing_numbers_are_none_not_zero():
    """관리비가 없는 단지가 있다. 0원으로 읽으면 지면이 「관리비 0원」이라고 거짓말한다."""
    h = house_from_row({"homeCode": "1", "youthMaintenanceFee": None, "coupleMaintenanceFee": ""})
    assert h.maint_low is None and h.maint_high is None
