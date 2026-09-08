"""sources/http.py — 재시도·간격·호출 수. MockTransport라 네트워크 없음."""

import httpx
import pytest

from zipgonggo_pipeline.sources.http import ThrottledHttp


def _client(statuses: list[int]) -> tuple[ThrottledHttp, list[str]]:
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(str(req.url))
        return httpx.Response(statuses[len(seen) - 1], text="ok")

    http = httpx.Client(transport=httpx.MockTransport(handler))
    return ThrottledHttp(delay_sec=0, max_retries=3, http=http), seen


def test_retries_transient_then_succeeds():
    c, seen = _client([503, 200])
    r = c.get("https://x.test/a", params={"q": 1}, label="t")
    assert r.status_code == 200 and c.call_count == 2 and len(seen) == 2
    assert seen[0].endswith("?q=1")


def test_gives_up_after_max_retries():
    c, _ = _client([500, 500, 500])
    with pytest.raises(httpx.HTTPStatusError):
        c.get("https://x.test/a")
    assert c.call_count == 3


def test_non_retryable_status_raises_immediately():
    c, _ = _client([404, 200])
    with pytest.raises(httpx.HTTPStatusError):
        c.get("https://x.test/a")
    assert c.call_count == 1
