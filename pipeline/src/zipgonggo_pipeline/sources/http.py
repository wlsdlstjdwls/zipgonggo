"""소스 공통 HTTP 클라이언트 — 요청 간격 준수 + 재시도.

CLAUDE.md 「하지 말 것 7」: 순차 호출, 요청 간격(SCRAPE_DELAY_SEC), 동시 요청 없음.
마이홈 API·SH 스크래퍼가 같은 throttle/backoff 루프를 각자 들고 있어 여기로 뽑았다.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)
# httpx가 INFO로 요청 URL(serviceKey 포함)을 찍는다. 키 유출 방지.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

USER_AGENT = "Mozilla/5.0 (compatible; zipgonggo-pipeline/0.1; +https://zipgonggo.com)"
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
# 연결이 안 되는 건 대개 서버가 잠깐 막아 둔 것이다. 오래 기다리지 말고 끊고 다시 건다.
CONNECT_TIMEOUT_SEC = 10.0
# 첫 재시도 대기. 이후 3배씩 늘린다(5 → 15 → 45초). i-sh가 1~2분 안 받는 일이 있어
# 1초부터 2배씩으로는 세 번 두드려도 10초 안에 끝나 버렸다.
BACKOFF_START_SEC = 5.0
BACKOFF_FACTOR = 3.0


class ThrottledHttp:
    """GET 전용. 호출 간 delay_sec 보장, 일시 오류는 지수 백오프로 max_retries 회.

    connect는 timeout_sec을 따로 쓰지 않고 CONNECT_TIMEOUT_SEC을 쓴다. 기관 서버가 가끔
    몇십 초씩 SYN을 안 받는데, 그걸 30초씩 기다려 봐야 답이 오지 않는다. 빨리 포기하고
    대신 백오프를 길게 잡아 여러 번 나눠 두드리는 쪽이 같은 시간에 성공 확률이 높다.
    """

    def __init__(
        self,
        *,
        delay_sec: float = 1.0,
        timeout_sec: float = 30.0,
        max_retries: int = 4,
        follow_redirects: bool = False,
        http: httpx.Client | None = None,
    ):
        self.delay_sec = delay_sec
        self.max_retries = max_retries
        self._http = http or httpx.Client(
            timeout=httpx.Timeout(timeout_sec, connect=CONNECT_TIMEOUT_SEC),
            follow_redirects=follow_redirects,
            headers={"User-Agent": USER_AGENT},
        )
        self.call_count = 0
        self._last_call_at = 0.0

    def _throttle(self) -> None:
        wait = self.delay_sec - (time.monotonic() - self._last_call_at)
        if wait > 0:
            time.sleep(wait)

    def post(self, url: str, *, data: dict[str, Any], label: str = "") -> httpx.Response:
        """POST 폼 전송. i-sh 게시판 목록이 GET 파라미터를 안 받고 mainform POST만 받는다."""
        return self._request("POST", url, data=data, label=label)

    def get(
        self, url: str, *, params: dict[str, Any] | None = None, label: str = "", accept_redirect: bool = False
    ) -> httpx.Response:
        """성공 응답(2xx)만 돌려준다. 재시도 소진 시 마지막 예외를 그대로 올린다.

        accept_redirect=True면 3xx도 그대로 돌려준다(Location을 읽어야 할 때. 클라이언트가 follow_redirects=False일 것).
        """
        return self._request("GET", url, params=params, label=label, accept_redirect=accept_redirect)

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        label: str = "",
        accept_redirect: bool = False,
    ) -> httpx.Response:
        backoff = BACKOFF_START_SEC
        for attempt in range(1, self.max_retries + 1):
            self._throttle()
            self._last_call_at = time.monotonic()
            self.call_count += 1
            try:
                resp = self._http.request(method, url, params=params, data=data)
                if resp.status_code in RETRYABLE_STATUS:
                    raise httpx.HTTPStatusError(f"HTTP {resp.status_code}", request=resp.request, response=resp)
                if accept_redirect and resp.is_redirect:
                    return resp
                resp.raise_for_status()
                return resp
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                # 4xx(404·403 등)는 다시 불러도 같다. 일시 오류·전송 오류만 재시도.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code not in RETRYABLE_STATUS:
                    raise
                if attempt == self.max_retries:
                    raise
                # 지터 — 크론이 정각에 몰려 같은 초에 다시 두드리는 일을 흩는다
                wait = backoff * random.uniform(0.8, 1.3)
                log.warning("%s 재시도 %d/%d (%.0f초 뒤): %s", label or url, attempt, self.max_retries, wait, exc)
                time.sleep(wait)
                backoff *= BACKOFF_FACTOR
        raise AssertionError("unreachable")
