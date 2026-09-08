"""마이홈포털 OpenAPI 클라이언트 (data.go.kr, 서비스 prefix 1613000).

스펙: docs/api-spec/*.swagger.json · 실측: docs/api-spec/samples/
- 응답 래핑: {"response": {"header": {resultCode, resultMsg}, "body": {totalCount, numOfRows, pageNo, item}}}
- resultCode "00" 정상. 결과 없음은 header만 오고 resultMsg "NODATA_ERROR". 필수 파라미터 누락은 "11".
- numOfRows 상한: 1000까지 통과 확인(2026-09-08). 개발계정 일 1,000건이라 페이지를 크게 잡는다.
- 순차 호출 + 요청 간격(SCRAPE_DELAY_SEC). 동시 요청 없음.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

import httpx

log = logging.getLogger(__name__)
# httpx가 INFO로 요청 URL(serviceKey 포함)을 찍는다. 키 유출 방지.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

BASE_URL = "https://apis.data.go.kr/1613000"

# 서비스 / 오퍼레이션
NOTICE_LIST = ("HWSPR02", "rsdtRcritNtcList")  # 공공주택 모집공고 (임대)
SALE_NOTICE_LIST = ("HWSPR02", "ltRsdtRcritNtcList")  # 공공분양 공고 — 범위 밖, 참고용
WAITLIST = ("HWSPR03", "moveWaitStsList")  # 예비입주자 대기현황. brtcCode 필수
COMPLEX_LIST = ("HWSPR04", "rentalHouseGwList")  # 단지정보. brtcCode·signguCode·numOfRows·pageNo 필수

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


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
        self.delay_sec = delay_sec
        self.max_retries = max_retries
        self.page_size = page_size
        self._http = http or httpx.Client(timeout=timeout_sec, headers={"User-Agent": "zipgonggo-pipeline/0.1"})
        self.call_count = 0
        self._last_call_at = 0.0

    # ── 저수준 ────────────────────────────────────────────────
    def _throttle(self) -> None:
        wait = self.delay_sec - (time.monotonic() - self._last_call_at)
        if wait > 0:
            time.sleep(wait)

    def fetch_page(self, service: str, operation: str, page_no: int, **params: Any) -> dict[str, Any]:
        """한 페이지의 body를 돌려준다. 결과 없음이면 item=[]·totalCount=0."""
        url = f"{BASE_URL}/{service}/{operation}"
        query = {
            "serviceKey": self._key,  # httpx가 urlencode 한다 (디코딩 키를 넣을 것)
            "numOfRows": self.page_size,
            "pageNo": page_no,
            "_type": "json",
            **{k: v for k, v in params.items() if v is not None},
        }
        backoff = 1.0
        for attempt in range(1, self.max_retries + 1):
            self._throttle()
            self._last_call_at = time.monotonic()
            self.call_count += 1
            try:
                resp = self._http.get(url, params=query)
                if resp.status_code in RETRYABLE_STATUS:
                    raise httpx.HTTPStatusError(f"HTTP {resp.status_code}", request=resp.request, response=resp)
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.TransportError, httpx.HTTPStatusError, ValueError) as exc:
                if attempt == self.max_retries:
                    raise
                log.warning("%s/%s p%s 재시도 %d/%d: %s", service, operation, page_no, attempt, self.max_retries, exc)
                time.sleep(backoff)
                backoff *= 2
                continue
            return _unwrap(payload)
        raise AssertionError("unreachable")

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
