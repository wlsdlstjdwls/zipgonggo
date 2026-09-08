"""소스 공통 HTTP 클라이언트 — 요청 간격 준수 + 재시도.

CLAUDE.md 「하지 말 것 7」: 순차 호출, 요청 간격(SCRAPE_DELAY_SEC), 동시 요청 없음.
마이홈 API·SH 스크래퍼가 같은 throttle/backoff 루프를 각자 들고 있어 여기로 뽑았다.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)
# httpx가 INFO로 요청 URL(serviceKey 포함)을 찍는다. 키 유출 방지.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

USER_AGENT = "Mozilla/5.0 (compatible; zipgonggo-pipeline/0.1; +https://zipgonggo.com)"
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class ThrottledHttp:
    """GET 전용. 호출 간 delay_sec 보장, 일시 오류는 지수 백오프로 max_retries 회."""

    def __init__(
        self,
        *,
        delay_sec: float = 1.0,
        timeout_sec: float = 30.0,
        max_retries: int = 3,
        follow_redirects: bool = False,
        http: httpx.Client | None = None,
    ):
        self.delay_sec = delay_sec
        self.max_retries = max_retries
        self._http = http or httpx.Client(
            timeout=timeout_sec, follow_redirects=follow_redirects, headers={"User-Agent": USER_AGENT}
        )
        self.call_count = 0
        self._last_call_at = 0.0

    def _throttle(self) -> None:
        wait = self.delay_sec - (time.monotonic() - self._last_call_at)
        if wait > 0:
            time.sleep(wait)

    def get(self, url: str, *, params: dict[str, Any] | None = None, label: str = "") -> httpx.Response:
        """성공 응답(2xx)만 돌려준다. 재시도 소진 시 마지막 예외를 그대로 올린다."""
        backoff = 1.0
        for attempt in range(1, self.max_retries + 1):
            self._throttle()
            self._last_call_at = time.monotonic()
            self.call_count += 1
            try:
                resp = self._http.get(url, params=params)
                if resp.status_code in RETRYABLE_STATUS:
                    raise httpx.HTTPStatusError(f"HTTP {resp.status_code}", request=resp.request, response=resp)
                resp.raise_for_status()
                return resp
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                # 4xx(404·403 등)는 다시 불러도 같다. 일시 오류·전송 오류만 재시도.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code not in RETRYABLE_STATUS:
                    raise
                if attempt == self.max_retries:
                    raise
                log.warning("%s 재시도 %d/%d: %s", label or url, attempt, self.max_retries, exc)
                time.sleep(backoff)
                backoff *= 2
        raise AssertionError("unreachable")
