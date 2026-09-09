"""i-sh.co.kr 모집공고 게시판(m_241) 목록 — 과거 공고 아카이브 백필용.

실측 2026-09-09:
- 서울주거포털(`sources.sh`) 목록은 2024-09 이후분만 들고 있다(81건). 그 이전 공고는 SH 자체 게시판에만 남아 있다.
- 목록은 `POST /main/brd/m_241/list.do`. GET 파라미터는 안 먹고 `mainform` POST만 받는다.
  폼 필드: `page`(1부터) · `isRecrnoti`(Y면 모집공고만, 빈값이면 일반 공지까지) · `srchFr`/`srchTo`(등록일 YYYY-MM-DD) · `srchWord`
- `isRecrnoti=Y` 기준 **45쪽 449건, 2003-11-25 ~ 현재**. 빈 쪽(0행)이 나오면 끝.
- 결과 표 컬럼: 번호 | 제목 | 담당부서 | 등록일 | 조회수. 상세 링크는 `onclick="getDetailView(<seq>)"` 안에만 있다(href는 `#none`).
- 상세는 `/main/brd/m_241/view.do?seq=N` — 여기서 첨부 미리보기를 찾아 `sources.ish`로 넘긴다.
- 구 게시판 첨부는 `/app/` 프리픽스를 쓴다(2020 행복주택 JI1901 등). `sources.ish`가 두 프리픽스를 모두 받는다.

robots.txt는 `/main/…`을 막지 않는다. 요청 간격은 ThrottledHttp가 지킨다(CLAUDE.md 「하지 말 것 7」).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from .http import ThrottledHttp

log = logging.getLogger(__name__)

BASE_URL = "https://www.i-sh.co.kr"
LIST_URL = f"{BASE_URL}/main/brd/m_241/list.do"
VIEW_URL = f"{BASE_URL}/main/brd/m_241/view.do?seq={{seq}}"
PAGE_SIZE = 10          # 사이트 고정
LAST_PAGE = 45          # 2026-09-09 실측(isRecrnoti=Y). 상한일 뿐, 실제 종료는 빈 쪽으로 판단한다
SEQ_RE = re.compile(r"getDetailView\(\s*['\"]?(\d+)")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class BoardNotice:
    no: str        # 게시판 번호(공고 차수 아님)
    title: str
    dept: str
    posted: str    # YYYY-MM-DD
    views: str
    seq: str       # view.do?seq=

    @property
    def url(self) -> str:
        return VIEW_URL.format(seq=self.seq)

    @property
    def year(self) -> int | None:
        return int(self.posted[:4]) if DATE_RE.match(self.posted) else None

    def as_dict(self) -> dict[str, Any]:
        d = self.__dict__.copy()
        d["url"] = self.url
        return d


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.text(separator=" ")).strip()


def parse_board_list(html: str) -> list[BoardNotice]:
    """목록 HTML → 공고 행. 결과 표는 getDetailView가 들어 있는 <table> 하나뿐이다."""
    tree = HTMLParser(html)
    table = next((t for t in tree.css("table") if "getDetailView" in (t.html or "")), None)
    if table is None:
        return []
    out: list[BoardNotice] = []
    for tr in table.css("tr"):
        tds = tr.css("td")
        if len(tds) < 5:
            continue  # thead 행
        m = SEQ_RE.search(tr.html or "")
        if not m:
            log.warning("i-sh 게시판: seq 없는 행 — %s", _text(tds[1])[:40])
            continue
        no, title, dept, posted, views = (_text(td) for td in tds[:5])
        out.append(BoardNotice(no=no, title=re.sub(r"^NEW\s+", "", title), dept=dept, posted=posted, views=views, seq=m.group(1)))
    return out


class IshBoardClient:
    def __init__(self, *, delay_sec: float = 1.0, timeout_sec: float = 30.0, max_retries: int = 3, http: httpx.Client | None = None):
        self._http = ThrottledHttp(delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, follow_redirects=True, http=http)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_page(self, page: int, *, recruit_only: bool = True, since: str = "", until: str = "") -> list[BoardNotice]:
        data = {
            "page": str(page),
            "isRecrnoti": "Y" if recruit_only else "",
            "srchFr": since,
            "srchTo": until,
            "srchWord": "",
        }
        resp = self._http.post(LIST_URL, data=data, label=f"i-sh 게시판 p{page}")
        return parse_board_list(resp.text)

    def iter_notices(
        self, *, recruit_only: bool = True, since: str = "", until: str = "", start_page: int = 1, max_pages: int = 200
    ) -> Iterator[BoardNotice]:
        """1쪽부터 빈 쪽이 나올 때까지. 최신순이라 백필은 끝까지 돌리고 연도로 거른다."""
        seen: set[str] = set()
        for page in range(start_page, start_page + max_pages):
            rows = self.fetch_page(page, recruit_only=recruit_only, since=since, until=until)
            if not rows:
                return
            for r in rows:
                if r.seq in seen:
                    continue  # 새 공고가 올라오면 쪽 경계가 밀려 같은 행이 두 번 온다
                seen.add(r.seq)
                yield r
