"""서울주거포털 SH 공공임대 공고 목록 스크래퍼.

실측 2026-09-08 (docs/data-sources.md §3):
- URL: https://housing.seoul.go.kr/site/main/sh/publicLease/02/list
- GET 파라미터: cp(페이지, 1부터) · sc · startDate · endDate · splyCd(청약유형 코드, 빈값=전체) · recrnotiState(now|suc|빈값) · sv
  기본 화면은 splyCd=02(국민공공임대)만 보여 8건이다. 전체는 splyCd= 빈값으로 호출해야 한다(81건, 10/페이지, 9페이지).
- 정적 HTML. <table> 한 개, thead 8열: 번호 · 청약유형 · 공고명 · 공고게시일 · 발표일 · 모집상태 · 담당부서 · 링크
- 공고명 셀의 포털 상세 링크(/site/main/sh/publicLease/view?seq=N)는 **주석 처리**돼 있어 주석에서 추출. 링크 셀에 i-sh.co.kr 원문(view.do?seq=NNNNNN)
- 포털 상세는 공고 본문 텍스트만 있고 첨부 없음("sh공사 바로가기를 통해 첨부파일을 확인"). 접수기간은 본문 자유서술이라 구조화 안 됨.
- robots.txt: User-agent: * / Allow: /
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

BASE_URL = "https://housing.seoul.go.kr"
LIST_PATH = "/site/main/sh/publicLease/02/list"
PAGE_SIZE = 10  # 사이트 고정

# 청약유형 select의 코드 (참고용)
SPLY_CODES = {
    "02": "국민공공임대주택", "13": "도시형생활주택", "11": "두레주택", "04": "매입임대주택",
    "21": "상가임대", "14": "수요자맞춤형", "08": "용지분양", "05": "장기안심주택",
    "03": "장기전세주택", "23": "재개발임대주택", "20": "전세임대", "10": "청년안심주택",
    "07": "행복주택", "06": "희망하우징",
}


@dataclass
class SHRow:
    no: str
    type_name: str
    title: str
    posted: str          # YYYY-MM-DD
    announce: str        # YYYY-MM-DD 또는 ''
    state: str           # 모집중 · 모집마감
    dept: str
    portal_url: str      # housing.seoul.go.kr 상세
    portal_seq: str
    source_url: str      # i-sh.co.kr 원문 (없으면 portal_url)
    ish_seq: str         # i-sh view.do?seq=  (없으면 '')

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.text(separator=" ")).replace("-->", "").strip()


def parse_list(html: str) -> list[SHRow]:
    """목록 HTML → 행. thead 8열 구조가 아니면 빈 목록(구조 변경 감지용 로그)."""
    tree = HTMLParser(html)
    table = tree.css_first("table")
    if table is None:
        log.warning("SH 목록: <table> 없음")
        return []
    heads = [_text(th) for th in table.css("thead th")] or [_text(th) for th in table.css("th")]
    if len(heads) < 8 or heads[1] != "청약유형":
        log.warning("SH 목록: 컬럼 구조 변경 감지 %s", heads)
        return []
    rows: list[SHRow] = []
    for tr in table.css("tbody tr") or table.css("tr")[1:]:
        tds = tr.css("td")
        if len(tds) < 8:
            continue
        links = [a.attributes.get("href", "") for a in tr.css("a")]
        # 포털 상세 링크는 <a>가 주석 처리돼 있다(<!-- <a href="/site/main/sh/publicLease/view?seq=1&cp=1..."> -->). 주석에서 건진다.
        portal = next((h for h in links if "/publicLease/view" in h), "")
        if not portal:
            m = re.search(r'href="(/site/main/sh/publicLease/view\?[^"]+)"', tr.html or "")
            portal = m.group(1) if m else ""
        ish = next((h for h in links if "i-sh.co.kr" in h), "")
        portal_url = (BASE_URL + portal.replace("&amp;", "&")) if portal.startswith("/") else portal
        rows.append(
            SHRow(
                no=_text(tds[0]),
                type_name=_text(tds[1]),
                title=_text(tds[2]),
                posted=_text(tds[3]),
                announce=_text(tds[4]),
                state=_text(tds[5]),
                dept=_text(tds[6]),
                portal_url=portal_url,
                portal_seq=(re.search(r"[?&]seq=(\d+)", portal) or [None, ""])[1],
                source_url=ish or portal_url,
                ish_seq=(re.search(r"[?&]seq=(\d+)", ish) or [None, ""])[1],
            )
        )
    return rows


def last_page(html: str) -> int:
    """페이지네이션의 최대 cp. 없으면 1."""
    cps = [int(x) for x in re.findall(r"[?&]cp=(\d+)", html)]
    return max(cps) if cps else 1


class SHClient:
    def __init__(self, *, delay_sec: float = 1.0, timeout_sec: float = 30.0, max_retries: int = 3, http: httpx.Client | None = None):
        self._http = ThrottledHttp(
            delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, follow_redirects=True, http=http
        )

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_list_page(self, cp: int, *, sply_cd: str = "", state: str = "") -> str:
        params = {"cp": cp, "sc": "", "startDate": "", "endDate": "", "splyCd": sply_cd, "recrnotiState": state, "sv": ""}
        return self._http.get(BASE_URL + LIST_PATH, params=params, label=f"SH 목록 cp={cp}").text

    def iter_rows(self, *, max_pages: int | None = None) -> Iterator[SHRow]:
        cp = 1
        last = 1
        while True:
            html = self.fetch_list_page(cp)
            rows = parse_list(html)
            if cp == 1:
                last = last_page(html)
                log.info("SH 목록: 총 %d페이지 예상", last)
            if not rows:
                return
            yield from rows
            if cp >= last or (max_pages is not None and cp >= max_pages):
                return
            cp += 1
