"""i-sh.co.kr 모집공고 게시판(m_241) 목록 — 과거 공고 아카이브 백필용.

실측 2026-09-09:
- 서울주거포털(`sources.sh`) 목록은 2024-09 이후분만 들고 있다(81건). 그 이전 공고는 SH 자체 게시판에만 남아 있다.
- 목록은 `POST /main/brd/m_241/list.do`. GET 파라미터는 안 먹고 `mainform` POST만 받는다.
  폼 필드: `page`(1부터) · `isRecrnoti`(Y면 모집공고만, 빈값이면 일반 공지까지) · `srchFr`/`srchTo`(등록일 YYYY-MM-DD) · `srchWord`
- `isRecrnoti=Y` 기준 **45쪽 449건, 2003-11-25 ~ 현재**. 빈 쪽(0행)이 나오면 끝.
- 결과 표 컬럼: 번호 | 제목 | 담당부서 | 등록일 | 조회수. 상세 링크는 `onclick="getDetailView(<seq>)"` 안에만 있다(href는 `#none`).
- 상세는 `/main/brd/m_241/view.do?seq=N` — 여기서 첨부 미리보기를 찾아 `sources.ish`로 넘긴다.
- 구 게시판 첨부는 `/app/` 프리픽스를 쓴다(2020 행복주택 JI1901 등). `sources.ish`가 두 프리픽스를 모두 받는다.

게시판이 둘이다(실측 2026-09-10):
- `m_241` — 「모집공고」 게시판. `isRecrnoti=Y`로 모집공고만 거를 수 있다. 위 백필이 이 게시판이다.
- `m_247` — 인터넷청약시스템 「공고 및 공지 > 주택임대」 게시판(`/app/lay2/program/S48T561C563/www/brd/m_247/`).
  운영기관에 임대운영을 맡긴 물건(특화형 매입임대·사회주택 등)은 **여기에만** 올라온다 —
  포털 목록에도 m_241에도 안 나온다(사용자 지적 2026-09-10, 「[청년형] 특화형 매입임대주택(금천구)」).
  대신 채용·설문 같은 잡글까지 8천 건이 섞여 있고 모집공고 필터가 없다. 제목 규칙(parsers.ish_title)으로 거른다.
  POST 필드도 다르다: `page` · `srchTp`(0=제목) · `srchWord` · `multi_itm_seq`.

robots.txt는 `/main/…`을 막지 않는다. 요청 간격은 ThrottledHttp가 지킨다(CLAUDE.md 「하지 말 것 7」).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx
from difflib import SequenceMatcher
from selectolax.parser import HTMLParser

from .http import ThrottledHttp

log = logging.getLogger(__name__)

BASE_URL = "https://www.i-sh.co.kr"
LIST_URL = f"{BASE_URL}/main/brd/m_241/list.do"
VIEW_URL = f"{BASE_URL}/main/brd/m_241/view.do?seq={{seq}}"
M247_PATH = "/app/lay2/program/S48T561C563/www/brd/m_247"
PAGE_SIZE = 10          # 사이트 고정
LAST_PAGE = 45          # 2026-09-09 실측(isRecrnoti=Y). 상한일 뿐, 실제 종료는 빈 쪽으로 판단한다
SEQ_RE = re.compile(r"getDetailView\(\s*['\"]?(\d+)")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class Board:
    """게시판 한 곳. 목록 POST 필드와 상세 URL 모양이 게시판마다 다르다."""

    key: str            # 스테이지 --board 인자 값
    list_url: str
    view_url: str       # {seq} 포맷
    recruit_filter: bool  # isRecrnoti=Y가 먹는가

    def form(self, page: int, *, recruit_only: bool, since: str, until: str) -> dict[str, str]:
        if self.recruit_filter:
            return {"page": str(page), "isRecrnoti": "Y" if recruit_only else "",
                    "srchFr": since, "srchTo": until, "srchWord": ""}
        return {"page": str(page), "srchTp": "0", "srchWord": "", "multi_itm_seq": "0"}


BOARD_241 = Board("241", LIST_URL, VIEW_URL, recruit_filter=True)
BOARD_247 = Board("247", f"{BASE_URL}{M247_PATH}/list.do", f"{BASE_URL}{M247_PATH}/view.do?seq={{seq}}", recruit_filter=False)
BOARDS = {b.key: b for b in (BOARD_241, BOARD_247)}


@dataclass(frozen=True)
class BoardNotice:
    no: str        # 게시판 번호(공고 차수 아님)
    title: str
    dept: str
    posted: str    # YYYY-MM-DD
    views: str
    seq: str       # view.do?seq=
    view_url: str = VIEW_URL   # 게시판마다 상세 경로가 다르다

    @property
    def url(self) -> str:
        return self.view_url.format(seq=self.seq)

    @property
    def year(self) -> int | None:
        return int(self.posted[:4]) if DATE_RE.match(self.posted) else None

    def as_dict(self) -> dict[str, Any]:
        d = self.__dict__.copy()
        d["url"] = self.url
        return d


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.text(separator=" ")).strip()


def parse_board_list(html: str, board: Board = BOARD_241) -> list[BoardNotice]:
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
        out.append(BoardNotice(no=no, title=re.sub(r"^NEW\s+", "", title), dept=dept, posted=posted,
                               views=views, seq=m.group(1), view_url=board.view_url))
    return out


class IshBoardClient:
    def __init__(self, *, board: Board = BOARD_241, delay_sec: float = 1.0, timeout_sec: float = 30.0,
                 max_retries: int = 3, http: httpx.Client | None = None):
        self.board = board
        self._http = ThrottledHttp(delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, follow_redirects=True, http=http)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_page(self, page: int, *, recruit_only: bool = True, since: str = "", until: str = "") -> list[BoardNotice]:
        data = self.board.form(page, recruit_only=recruit_only, since=since, until=until)
        resp = self._http.post(self.board.list_url, data=data, label=f"i-sh m_{self.board.key} p{page}")
        return parse_board_list(resp.text, self.board)

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


# ── 어긋난 seq 되찾기 ───────────────────────────────────────────────────────────
#
# 포털(housing.seoul.go.kr) 목록이 주는 i-sh 링크는 정정공고가 나면 옛 seq에 머문다.
# i-sh는 정정본을 새 글로 올려 seq가 바뀌므로 그 링크는 「해당 데이터를 찾을 수 없습니다」가 된다.
# 제목으로 게시판 앞쪽을 뒤져 되찾는다. 날짜 검색(srchFr/srchTo)은 등록일이 아닌 다른 날짜를 보는지
# 같은 날 글도 안 걸려(실측 2026-09-10) 쓰지 않는다.

_NOISE_RE = re.compile(r"\[[^\]]*\]|\([^)]*\)|[\s.·・,]|^NEW")
_PREFIX_RE = re.compile(r"^(정정|수정|재)공고?\s*")


def title_key(title: str) -> str:
    """제목 비교용 열쇠. 괄호 안 날짜·[정정] 같은 머리표·공백을 걷어낸다."""
    t = _PREFIX_RE.sub("", title.strip())
    return _NOISE_RE.sub("", t)


def find_seq_by_title(client: "IshBoardClient", title: str, *, max_pages: int = 5, cutoff: float = 0.72) -> str | None:
    """게시판 앞쪽에서 제목이 가장 비슷한 글의 seq. 닮은 정도가 cutoff 미만이면 None."""
    want = title_key(title)
    best: tuple[float, str, str] | None = None
    for row in client.iter_notices(max_pages=max_pages):
        score = SequenceMatcher(None, want, title_key(row.title)).ratio()
        if best is None or score > best[0]:
            best = (score, row.seq, row.title)
    if best is None or best[0] < cutoff:
        log.info("i-sh 게시판에서 못 찾음(%.2f): %s", best[0] if best else 0.0, title[:50])
        return None
    log.info("i-sh seq 되찾음 %s (%.2f) — %s", best[1], best[0], best[2][:50])
    return best[1]
