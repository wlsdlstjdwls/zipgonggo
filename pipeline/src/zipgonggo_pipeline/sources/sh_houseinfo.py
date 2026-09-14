"""SH주택정보(i-sh.co.kr/houseinfo) 단지 이미지 — 평면도·전경·배치도·실내.

공고문에는 도면이 없다. 제51차 장기전세 공고문(seq=309467) 64쪽을 전수로 훑어도 도면 이미지는
0장이고, 12·19·49·56쪽이 한결같이 **「전자팸플릿·SH주택정보를 참조하라」**고 넘긴다. 그 참조처가 여기다.

실측 2026-09-14:
- 진입은 `/houseinfo` → 넷퍼널 대기열 스크립트 → `/houseinfo/main/mainPage.do`. 대기열은 화면 쪽이고
  아래 API는 로그인·대기열 없이 POST로 바로 받는다. 세션 쿠키(JEUSSID_HOUSE)는 mainPage 한 번으로 붙는다.
- 목록 `POST /houseinfo/map/selectHouseRentWithFilter.do` — `pageNum`·`sigCd`(시군구 5자리)·`chkRentTy`(10 아파트).
  한 쪽에 5건, `totalCnt`로 끝을 안다. 서울 25개 구 전수 = 아파트 793단지(2026-09-14).
- 단지 이미지 `POST …/selectImgList.do` — `biznsCd` + `imgTy`. 코드는 01 전경, 02 정문, 03 배치도,
  04 단지, 05 주차장, 06 편의시설, 07 **실내 각 방**, 08 기타. 09 이상은 빈 배열.
- 평면도는 주택형별로 따로 있다. `selectSplyTyInfo.do`(biznsCd)로 주택형을 받고
  `selectSplyTyImgInfo.do`(biznsCd + splyTy)로 그 형의 도면을 받는다. SH 도장 찍힌 실측 도면이다.
- 파일은 `https://www.i-sh.co.kr/houseinfo{imgPath}{imgNewFileNm}` 무인증 GET. 평면도 1장 ≈ 400KB, 1783×1256.

**robots: 이 경로는 「긁지 말라」는 표시가 붙어 있다.** 호스트 루트 robots.txt(규범상 유일하게 유효한 것)는
`/houseinfo`를 막지 않지만, `/houseinfo/robots.txt`에 앱이 자체로 `Disallow:/houseinfo/`를 올려 뒀다
(실측: 그 경로만 200, 옆 경로는 404 — 진짜 파일이다). 규범상 구속력은 없어도 운영자 의사 표시다.
**PoC 한정으로 쓴다. 공개 발행 전에 SH에 이용 허락을 받는다.** 요청 간격은 CLAUDE.md 규칙대로 지킨다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .http import ThrottledHttp

BASE = "https://www.i-sh.co.kr/houseinfo"
ENTRY = f"{BASE}/main/mainPage.do"
# 서울 25개 자치구 법정동코드 앞 5자리. 목록 API가 시군구 단위로만 끊어 준다.
SEOUL_SIG = (
    "11110", "11140", "11170", "11200", "11215", "11230", "11260", "11290", "11305",
    "11320", "11350", "11380", "11410", "11440", "11470", "11500", "11530", "11545",
    "11560", "11590", "11620", "11650", "11710", "11680", "11740",
)
PAGE_SIZE = 5  # 서버 고정. pageNum만 받는다
APARTMENT = "10"  # chkRentTy: 10 아파트 등, 20 매입다가구, 30 매입원룸
# selectImgList.do의 imgTy. 09 이상은 빈 배열이다(01~12 전수 확인).
IMG_TYPES = {"01": "전경", "02": "정문", "03": "배치도", "04": "단지", "05": "주차장", "06": "편의시설", "07": "실내", "08": "기타"}


@dataclass(frozen=True)
class House:
    bizns_cd: str
    name: str
    address: str
    lat: float | None
    lng: float | None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> House:
        # posX가 위도, posY가 경도다. 이름과 반대로 실려 온다(실측: posX 37.46, posY 127.10).
        return cls(
            bizns_cd=row["biznsCd"],
            name=(row.get("bizns1Nm") or "").strip(),
            address=(row.get("addr") or "").strip(),
            lat=_float(row.get("posX")),
            lng=_float(row.get("posY")),
        )


@dataclass(frozen=True)
class Image:
    bizns_cd: str
    kind: str          # "평면도" 또는 IMG_TYPES의 값
    sply_ty: str       # 주택형(평면도만). 나머지는 ""
    name: str          # 화면 표기 이름(없을 수 있다)
    url: str
    orig_name: str
    bytes: int


def _float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _image_url(row: dict[str, Any]) -> str:
    # imgPath가 "/upload//houseinfo/" 처럼 슬래시가 겹쳐 오지만 서버가 그대로 받는다. 손대지 않는다.
    return f"{BASE}{row['imgPath']}{row['imgNewFileNm']}"


class HouseInfoClient:
    """SH주택정보 조회. 첫 호출 때 mainPage로 세션을 튼다."""

    def __init__(self, *, delay_sec: float = 1.0, timeout_sec: float = 30.0, max_retries: int = 4):
        # 이미지 바이너리를 받으려면 리다이렉트를 따라가야 한다(게시판 쪽과 반대).
        self._http = ThrottledHttp(delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, follow_redirects=True)
        self._opened = False

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def _open(self) -> None:
        if not self._opened:
            self._http.get(ENTRY, label="SH주택정보 진입")
            self._opened = True

    def _post(self, endpoint: str, **data: Any) -> list[dict[str, Any]]:
        self._open()
        resp = self._http.post(f"{BASE}/map/{endpoint}.do", data=data, label=f"houseinfo {endpoint}")
        return resp.json().get("result") or []

    def houses(self, sig_cd: str, *, rent_ty: str = APARTMENT) -> list[House]:
        """한 자치구의 단지 목록. 5건씩 끊어 오는 걸 끝까지 이어 붙인다."""
        out: list[House] = []
        page = 1
        while True:
            self._open()
            resp = self._http.post(
                f"{BASE}/map/selectHouseRentWithFilter.do",
                data={"pageNum": page, "sigCd": sig_cd, "emdCd": "", "chkRentTy": rent_ty, "sortGubun": ""},
                label=f"houseinfo 목록 {sig_cd} p{page}",
            )
            body = resp.json()
            rows = body.get("result") or []
            out.extend(House.from_row(r) for r in rows)
            total = int(body.get("totalCnt") or 0)
            if not rows or page * PAGE_SIZE >= total:
                return out
            page += 1

    def supply_types(self, bizns_cd: str) -> list[str]:
        return [r["splyTy"] for r in self._post("selectSplyTyInfo", biznsCd=bizns_cd) if r.get("splyTy")]

    def images(self, bizns_cd: str, img_ty: str) -> list[Image]:
        return [
            Image(
                bizns_cd=bizns_cd,
                kind=IMG_TYPES.get(img_ty, img_ty),
                sply_ty="",
                name=(r.get("imgNm") or "").strip(),
                url=_image_url(r),
                orig_name=r.get("imgOriFileNm") or "",
                bytes=int(r.get("imgFileSize") or 0),
            )
            for r in self._post("selectImgList", biznsCd=bizns_cd, imgTy=img_ty)
        ]

    def plans(self, bizns_cd: str, sply_ty: str) -> list[Image]:
        """주택형 하나의 평면도. mainBiznsCd가 단지, biznsCd는 주택형 쪽 코드라 우리 쪽 키로 쓰지 않는다."""
        return [
            Image(
                bizns_cd=bizns_cd,
                kind="평면도",
                sply_ty=sply_ty,
                name=(r.get("imgNm") or "").strip(),
                url=_image_url(r),
                orig_name=r.get("imgOriFileNm") or "",
                bytes=int(r.get("imgFileSize") or 0),
            )
            for r in self._post("selectSplyTyImgInfo", biznsCd=bizns_cd, splyTy=sply_ty)
        ]

    def download(self, image: Image) -> bytes:
        self._open()
        return self._http.get(image.url, label="houseinfo 이미지").content
