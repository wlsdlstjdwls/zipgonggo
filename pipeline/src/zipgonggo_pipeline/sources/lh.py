"""LH청약플러스 공고 상세와 첨부 파일.

마이홈 API가 준 `source_url`(selectWrtancInfo.do?panId=…)이 공고 상세다. 첨부는 상세 HTML 안에
`fileDownLoad('68775511');">파일이름.xlsx<` 꼴로 박혀 있고, 내려받기는 `lhFile.do?fileid=`다.

`robots.txt`가 `/lhapply/lhFile.do`를 막고 있다. **수집 허용은 2026-09-08 서울시 협의 때 LH도 같이 받았다**
(docs/data-sources.md 6절). 허용이 근거라고 요청 간격까지 풀린 건 아니다 — 순차로, SCRAPE_DELAY_SEC 간격으로.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from .http import ThrottledHttp

BASE = "https://apply.lh.or.kr"
FILE_URL = BASE + "/lhapply/lhFile.do?fileid={fid}"

# 상세 HTML의 첨부 링크. 스크립트 안의 템플릿 문자열(`'+list[i].cmnAhflSn+'`)은 숫자가 아니라 안 걸린다
_ATT = re.compile(r"fileDownLoad\('(\d+)'\);\"\s*>([^<]+)<")


@dataclass(frozen=True)
class LhAttachment:
    file_id: str
    name: str

    @property
    def ext(self) -> str:
        return self.name.rsplit(".", 1)[-1].lower() if "." in self.name else ""

    @property
    def is_house_list(self) -> bool:
        """「공급주택목록」·「주택목록」·「공급대상주택목록」 엑셀, 같은 칸 구성의 PDF.

        경기남부지역본부는 같은 표를 「공급대상주택내역」이라 붙인다(2026-10-02 실측 5건).
        2026년 3차 전국 공고는 목록을 PDF로만 붙였다. 「보유주택목록」 PDF는 호실이 아니라 건물별 보유 호수
        집계라 고르지 않는다. 「목록요약」 hwpx는 아직 못 읽는다.
        """
        if not any(w in self.name for w in ("목록", "리스트", "주택내역")):
            return False
        if self.ext == "pdf":
            return "보유" not in self.name
        return self.ext in ("xlsx", "xlsm")


def find_attachments(page_html: str) -> list[LhAttachment]:
    seen, out = set(), []
    for fid, name in _ATT.findall(page_html):
        if fid in seen:
            continue
        seen.add(fid)
        out.append(LhAttachment(fid, html_lib.unescape(name).strip()))
    return out


def pan_id(source_url: str) -> str | None:
    return (parse_qs(urlsplit(source_url).query).get("panId") or [None])[0]


class LhClient:
    def __init__(self, *, delay_sec: float, http: ThrottledHttp | None = None):
        self._http = http or ThrottledHttp(delay_sec=delay_sec, timeout_sec=120.0)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_detail(self, source_url: str) -> str:
        return self._http.get(source_url, label="lh detail").text

    def download(self, att: LhAttachment) -> bytes:
        return self._http.get(FILE_URL.format(fid=att.file_id), label=f"lh file {att.file_id}").content
