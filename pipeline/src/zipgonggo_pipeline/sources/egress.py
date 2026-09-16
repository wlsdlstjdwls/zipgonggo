"""한국에서 나가는 구멍 — web의 `/api/egress`(icn1)를 거쳐 요청을 보낸다.

**왜 있나**: 한국 정부·서울시 사이트가 GitHub Actions 러너(Azure 미국) IP의 연결을 간헐로 안 받는다.
`apis.data.go.kr` · `business.juso.go.kr` · `housing.seoul.go.kr` 셋 다 TCP ConnectTimeout으로 끝나고,
같은 시각 한국 회선에선 전부 0.04초에 붙는다(2026-09-16 실측). 응답이 아니라 **연결**이 안 되는 거라
키·파라미터를 고쳐서 될 일이 아니다. Vercel Pro라 라우트별 리전을 고를 수 있어 `/api/egress`만
서울(icn1)에 두고, 파이프라인이 그 구멍으로 나간다.

**안 켜면 아무 일도 안 일어난다.** 환경변수 둘이 다 있어야 켜진다 —
    EGRESS_PROXY_URL=https://zipgonggo.com/api/egress
    EGRESS_SECRET=<web의 EGRESS_SECRET과 같은 값>
로컬(한국)에서는 안 켜는 게 맞다. 직접 붙는 게 더 빠르고, 한 단계를 덜 탄다.

프록시를 타는 건 **아래 목록에 적힌 호스트뿐이다.** 나머지는 그대로 직접 나간다 —
IndexNow(빙)나 우리 웹훅까지 서울을 거칠 이유가 없다.
"""

from __future__ import annotations

import logging
import os
import urllib.parse

from ..config import PIPELINE_ROOT  # noqa: F401 — import 부수효과로 .env 를 읽는다

log = logging.getLogger(__name__)

# web/src/app/api/egress/route.ts 의 ALLOWED_HOSTS 와 같아야 한다.
# 한쪽만 늘리면 403이 돌아온다 — 그쪽이 문지기라 여기서 늘려 봐야 안 열린다
PROXIED_HOSTS = frozenset({
    "apis.data.go.kr",
    "business.juso.go.kr",
    "housing.seoul.go.kr",
    "www.i-sh.co.kr",
    "i-sh.co.kr",
    "soco.seoul.go.kr",
})


class Egress:
    """켜졌는지, 이 URL이 프록시를 타야 하는지를 판단하고 요청을 감싼다."""

    def __init__(self, proxy_url: str = "", secret: str = ""):
        self.proxy_url = proxy_url.strip()
        self.secret = secret.strip()

    @property
    def enabled(self) -> bool:
        return bool(self.proxy_url and self.secret)

    def targets(self, url: str) -> bool:
        if not self.enabled:
            return False
        return urllib.parse.urlsplit(url).hostname in PROXIED_HOSTS

    def wrap(self, url: str, headers: dict[str, str] | None = None) -> tuple[str, dict[str, str]]:
        """(프록시 URL, 덧붙일 헤더). 원래 URL은 통째로 `url` 파라미터에 넣는다.

        쿼리스트링째 인코딩한다 — serviceKey처럼 값에 `+`·`=`가 든 게 있어서
        그냥 이어 붙이면 상대 서버가 다른 값으로 읽는다.
        """
        q = urllib.parse.urlencode({"url": url})
        out = {"x-egress-secret": self.secret}
        # 프록시가 상류에 실어 줄 헤더. 이름을 바꿔 보내는 건 프록시 자신에게 가는 것과 구분하기 위해서다
        for name, header in (("user-agent", "x-egress-user-agent"),
                             ("referer", "x-egress-referer"),
                             ("accept", "x-egress-accept")):
            value = (headers or {}).get(name)
            if value:
                out[header] = value
        return f"{self.proxy_url}?{q}", out


def from_env() -> Egress:
    return Egress(os.environ.get("EGRESS_PROXY_URL", ""), os.environ.get("EGRESS_SECRET", ""))
