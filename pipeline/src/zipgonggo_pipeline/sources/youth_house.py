"""서울시 청년안심주택 포털 「주택찾기」 — 민간임대 축의 단지 이미지 소스(SH주택정보의 민간판).

왜 이 길인가 (2026-09-15 실측):
- 민간임대 공고문 첨부 PDF 452건을 전수로 떴다. 그림이 한 장이라도 든 건 121건, 평면도 크기(200x150pt 초과)
  그림이 든 건 50건뿐이고 대개 한 장이다. 그 한 장을 까 보면 **위치 약도·시행사 로고·표를 통째로 앉힌 그림·
  A4 스캔쪽**이다. 주택형 평면도를 실은 공고는 사실상 없다 — 공고문에서 뽑을 도면이 없다.
- 대신 같은 사이트의 「주택찾기」가 단지 단위로 전경·투시도·평면도·편의시설 사진을 준다.

경로:
- 목록은 AJAX — `POST /youth/pgm/home/yohome/yoHomeListJson.json`.
  폼: pageNum · rowCount · searchPresale · searchTheme · searchMovinHoman · searchHouseType · searchHouseForm ·
  searchAdresGu · searchSil · searchWrd. **rowCount를 크게 주면 한 번에 다 온다**(96곳, 요청 1회).
  빈 폼으로 부르면 `{"exception":"Please contact the manager!"}` — 키를 다 채워야 한다.
- 행: homeCode(단지코드) · homeName · adres · adresGu · fileId+fileSn(대표 사진) · 보증금/월세/관리비 범위 ·
  subwayLineCd · managerComp · movinHoman. **관리비가 여기 있다** — 공고문 첨부에 없어 지면에서 비워 둔 값이다.
- 상세는 `GET /youth/pgm/home/yohome/view.do?menuNo=400002&homeCode={코드}` (화면은 POST로 가지만 GET도 받는다).
- 이미지는 `/{cohome|coHouse}/cmmn/file/fileDown.do?atchFileId=…&fileSn=N`.
  **프리픽스가 두 가지**다(`cohome` 소문자 / `coHouse` 대소문자 섞임) — 상세 HTML에 적힌 그대로 쓴다.
  응답은 `Content-Disposition: attachment; filename="평면도_26.png"` + `Content-Type: image/png`.

상세 조판:
- `<article id="detail1">` 상세소개 — 대표 사진(alt `{주택명}_상세소개`)과 투시도(alt `투시도…`),
  그리고 **편의시설 사진**(alt 빈 문자열). 편의시설은 `<li class="textbox">`(제목+설명)과 `<li><img>`가
  석조(masonry) 격자로 섞여 1:1로 짝이 안 맞는다 — 캡션을 짝지으려 들지 않는다. label은 비운다.
- `<article id="detail4">` 평면도 — alt `{주택명}_평면도_N`. **주택형을 안 밝힌다**(그림 안에 「26Type」으로 적혀 있다).
- 나머지 article(입주현황·위치·사업자)에는 우리가 쓸 이미지가 없다.

robots.txt 없음(404), 푸터 © Seoul Metropolitan Government — 서울시 공공저작물 정책 준용.
단, **평면도 그림은 시행사 홈페이지 캡처인 단지가 있다**(맹그로브창천 실측). 서울시 저작물로 단정할 수 없다.
지면 발행 전에 확인이 필요하다 — 0026 주석과 `docs/data-sources.md` 참조.
요청 간격은 ThrottledHttp가 지킨다(CLAUDE.md 「하지 말 것 6」).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from html import unescape
from typing import Any

from .http import ThrottledHttp

log = logging.getLogger(__name__)

BASE_URL = "https://soco.seoul.go.kr"
LIST_JSON_URL = f"{BASE_URL}/youth/pgm/home/yohome/yoHomeListJson.json"
DETAIL_URL = f"{BASE_URL}/youth/pgm/home/yohome/view.do?menuNo=400002&homeCode={{code}}"

# 목록 폼. 검색 키를 하나라도 빼면 서버가 예외를 돌려준다(빈 값으로라도 다 보낸다).
LIST_FORM_KEYS = (
    "searchPresale", "searchTheme", "searchMovinHoman", "searchHouseType",
    "searchHouseForm", "searchAdresGu", "searchSil", "searchWrd",
)

# 지면에 쓸 종류. 순서가 곧 갤러리 탭 순서다 — 평면도를 먼저 보여준다(청약자가 제일 먼저 찾는 그림)
KIND_ORDER = ("평면도", "전경", "투시도", "편의시설")


@dataclass(frozen=True)
class YouthHouse:
    """포털 「주택찾기」 한 행. 단지 하나."""

    home_code: str
    name: str
    address: str
    gu: str
    file_id: str            # 대표 사진 atchFileId
    file_sn: str
    manager: str            # 운영사
    households: str         # movinHoman 총 세대수
    maint_low: int | None   # 관리비 하한(원)
    maint_high: int | None
    raw: dict[str, Any]

    @property
    def source_url(self) -> str:
        return DETAIL_URL.format(code=self.home_code)


@dataclass(frozen=True)
class HouseImage:
    """상세에서 캔 그림 한 장. 아직 내려받기 전이라 bytes는 모른다."""

    kind: str
    sply_ty: str
    label: str | None
    path: str               # 사이트 경로(/cohome/… 또는 /coHouse/…)

    @property
    def url(self) -> str:
        return f"{BASE_URL}{self.path}"


def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _i(v: Any) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def house_from_row(row: dict[str, Any]) -> YouthHouse:
    return YouthHouse(
        home_code=_s(row.get("homeCode")),
        name=_s(row.get("homeName")),
        address=_s(row.get("adres")),
        gu=_s(row.get("adresGu")),
        file_id=_s(row.get("fileId")),
        file_sn=_s(row.get("fileSn")),
        manager=_s(row.get("managerComp")),
        households=_s(row.get("movinHoman")),
        maint_low=_i(row.get("youthMaintenanceFee")),
        maint_high=_i(row.get("coupleMaintenanceFee")),
        raw=row,
    )


# `<article id="detailN">`로 구역을 가른다. 같은 fileDown 경로라도 어느 구역에 있느냐로 종류가 갈린다
ARTICLE_RE = re.compile(r'<article\s+id="(detail\d)"', re.I)
IMG_RE = re.compile(r'<img\b[^>]*>', re.I)
SRC_RE = re.compile(r'src="([^"]*fileDown\.do[^"]*)"', re.I)
ALT_RE = re.compile(r'alt="([^"]*)"', re.I)
# alt 꼬리의 일련번호(`…_평면도_3`)는 종류를 가른 뒤엔 쓸모없다
PLAN_ALT_RE = re.compile(r"평면도(?:_(\d+))?\s*$")


def _sections(html: str) -> list[tuple[str, str]]:
    """(article id, 그 구역 HTML). 첫 article 앞의 머리 부분은 `head`로 둔다 — 투시도가 거기 있다."""
    marks = [(m.group(1), m.start()) for m in ARTICLE_RE.finditer(html)]
    if not marks:
        return [("head", html)]
    out = [("head", html[: marks[0][1]])]
    for idx, (name, start) in enumerate(marks):
        end = marks[idx + 1][1] if idx + 1 < len(marks) else len(html)
        out.append((name, html[start:end]))
    return out


def _kind_of(section: str, alt: str) -> str | None:
    """이 그림을 지면에 어떤 이름으로 올릴까. 모르면 None — 싣지 않는다.

    alt가 먼저다(포털이 직접 붙인 이름). alt가 비면 구역으로 가른다.
    """
    if "평면도" in alt:
        return "평면도"
    if "투시도" in alt:
        return "투시도"
    if "상세소개" in alt:
        return "전경"
    if section == "detail4":
        return "평면도"
    # 상세소개 구역의 alt 없는 그림은 커뮤니티·편의시설 사진이다
    if section in ("head", "detail1", "detail2"):
        return "편의시설"
    return None


def parse_images(html: str) -> list[HouseImage]:
    """상세 HTML에서 지면에 쓸 그림을 캔다. 같은 경로가 두 번 나오면 한 번만 싣는다."""
    out: list[HouseImage] = []
    seen: set[str] = set()
    for section, body in _sections(html):
        for tag in IMG_RE.finditer(body):
            src = SRC_RE.search(tag.group(0))
            if not src:
                continue
            path = unescape(src.group(1))
            # 목록 렌더링 스크립트 안의 템플릿 문자열(`…fileId+ "&fileSn=`)은 진짜 경로가 아니다
            if '"' in path or "+" in path or "atchFileId=" not in path:
                continue
            alt = unescape(ALT_RE.search(tag.group(0)).group(1)).strip() if ALT_RE.search(tag.group(0)) else ""
            kind = _kind_of(section, alt)
            if not kind or path in seen:
                continue
            seen.add(path)
            label = None
            if kind == "평면도":
                # `홍대입구역 맹그로브창천_평면도_3` — 주택명과 일련번호를 털면 남는 게 없다. 캡션은 비운다
                label = None if PLAN_ALT_RE.search(alt) else (alt or None)
            elif alt and kind not in ("전경", "투시도"):
                label = alt
            out.append(HouseImage(kind=kind, sply_ty="", label=label, path=path))
    out.sort(key=lambda im: (KIND_ORDER.index(im.kind) if im.kind in KIND_ORDER else 99,))
    return out


class YouthHouseClient:
    """포털 「주택찾기」 목록·상세. GET/POST 간격은 ThrottledHttp가 지킨다."""

    def __init__(self, *, delay_sec: float = 1.0, http: ThrottledHttp | None = None):
        self._http = http or ThrottledHttp(delay_sec=delay_sec)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def houses(self, *, row_count: int = 500) -> list[YouthHouse]:
        """단지 전체. 96곳이라 한 번에 받는다(rowCount를 넉넉히)."""
        form: dict[str, Any] = {"pageNum": 1, "rowCount": row_count}
        form.update({k: "" for k in LIST_FORM_KEYS})
        data = self._http.post(LIST_JSON_URL, data=form, label="youth house list").json()
        rows = data.get("resultList") or []
        total = data.get("listCnt")
        if total is not None and len(rows) < int(total):
            log.warning("단지 목록이 잘렸다: %d/%s — rowCount를 키워라", len(rows), total)
        return [house_from_row(r) for r in rows]

    def detail_html(self, home_code: str) -> str:
        resp = self._http.get(DETAIL_URL.format(code=home_code), label=f"youth house {home_code}")
        return resp.text

    def images(self, home_code: str) -> list[HouseImage]:
        return parse_images(self.detail_html(home_code))
