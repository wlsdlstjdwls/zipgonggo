"""마이홈포털 OpenAPI 클라이언트 (data.go.kr, 서비스 prefix 1613000).

스펙: docs/api-spec/*.swagger.json · 실측: docs/api-spec/samples/
- 응답 래핑: {"response": {"header": {resultCode, resultMsg}, "body": {totalCount, numOfRows, pageNo, item}}}
- resultCode "00" 정상. 결과 없음은 header만 오고 resultMsg "NODATA_ERROR". 필수 파라미터 누락은 "11".
- numOfRows 상한: 1000까지 통과 확인(2026-09-08). 개발계정 일 1,000건이라 페이지를 크게 잡는다.
- 순차 호출 + 요청 간격은 sources/http.py ThrottledHttp.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

import httpx

from .http import ThrottledHttp

log = logging.getLogger(__name__)

BASE_URL = "https://apis.data.go.kr/1613000"

# 서비스 / 오퍼레이션
NOTICE_LIST = ("HWSPR02", "rsdtRcritNtcList")  # 공공주택 모집공고 (임대)
SALE_NOTICE_LIST = ("HWSPR02", "ltRsdtRcritNtcList")  # 공공분양 공고 — 범위 밖, 참고용
WAITLIST = ("HWSPR03", "moveWaitStsList")  # 예비입주자 대기현황. brtcCode 필수
COMPLEX_LIST = ("HWSPR04", "rentalHouseGwList")  # 단지정보. brtcCode·signguCode·numOfRows·pageNo 필수


class MyHomeApiError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"마이홈 API 오류 {code}: {message}")
        self.code = code
        self.message = message


class MyHomeClient:
    def __init__(
        self,
        service_key: str,
        *,
        delay_sec: float = 1.0,
        timeout_sec: float = 30.0,
        max_retries: int = 3,
        page_size: int = 1000,
        http: httpx.Client | None = None,
    ):
        self._key = service_key
        self.page_size = page_size
        self._http = ThrottledHttp(delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, http=http)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    # ── 저수준 ────────────────────────────────────────────────
    def fetch_page(self, service: str, operation: str, page_no: int, **params: Any) -> dict[str, Any]:
        """한 페이지의 body를 돌려준다. 결과 없음이면 item=[]·totalCount=0."""
        query = {
            "serviceKey": self._key,  # httpx가 urlencode 한다 (디코딩 키를 넣을 것)
            "numOfRows": self.page_size,
            "pageNo": page_no,
            "_type": "json",
            **{k: v for k, v in params.items() if v is not None},
        }
        resp = self._http.get(f"{BASE_URL}/{service}/{operation}", params=query, label=f"{service}/{operation} p{page_no}")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise MyHomeApiError("BAD_JSON", str(exc)) from exc
        return _unwrap(payload)

    def iter_pages(
        self, service: str, operation: str, *, max_pages: int | None = None, **params: Any
    ) -> Iterator[tuple[int, dict[str, Any]]]:
        page_no = 1
        while True:
            body = self.fetch_page(service, operation, page_no, **params)
            yield page_no, body
            total = int(body.get("totalCount") or 0)
            if page_no * self.page_size >= total or not body["item"]:
                return
            if max_pages is not None and page_no >= max_pages:
                return
            page_no += 1

    # ── 고수준 ────────────────────────────────────────────────
    def iter_notices(self, *, max_pages: int | None = None, **filters: Any) -> Iterator[dict[str, Any]]:
        """임대 모집공고 전량. 시군구별로 쪼개진 행이 그대로 온다 — 합치는 건 S1 몫."""
        for _, body in self.iter_pages(*NOTICE_LIST, max_pages=max_pages, **filters):
            yield from body["item"]

    def expected_calls(self, service: str, operation: str, **params: Any) -> int:
        """호출 횟수 예측용. 1페이지를 실제로 받는다."""
        body = self.fetch_page(service, operation, 1, **params)
        total = int(body.get("totalCount") or 0)
        return max(1, -(-total // self.page_size))


def _unwrap(payload: dict[str, Any]) -> dict[str, Any]:
    response = payload.get("response") or {}
    header = response.get("header") or {}
    code = str(header.get("resultCode", ""))
    msg = str(header.get("resultMsg", ""))
    body = response.get("body") or {}
    if code == "00":
        items = body.get("item") or []
        if isinstance(items, dict):  # 1건이면 객체로 오는 data.go.kr 관행 방어
            items = [items]
        return {**body, "item": items}
    if "NODATA" in msg.upper():
        return {"totalCount": "0", "numOfRows": "0", "pageNo": "1", "item": []}
    raise MyHomeApiError(code, msg)
