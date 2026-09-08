"""SH 공사 홈페이지(i-sh.co.kr) 공고 첨부 텍스트 — Synap 문서뷰어 변환 결과.

실측 2026-09-08 (memory sh-attachment-synap-path · docs/data-sources.md §3):
- 공고 원문 `…/brd/m_241/view.do?seq=N` 의 첨부 행에 「미리보기」 링크 `/main/com/util/htmlConverter.do?brd_id=GS0401&seq=N&data_tp=A&file_seq=K`
- 그 링크는 302 → `/main/skin/doc.html?fn={fn}&rs={rs}`. 뷰어(Synap)는 페이지 텍스트를
  `{rs}{fn}.files/{fn}_{page}.xml` 에서 읽는다. page는 1부터, 없는 번호는 `/error/error.html`로 302.
- XML은 글자 단위 `<text l t w h>글자</text>`. 줄·칸 복원은 좌표로 한다(page_rows).
- robots.txt: `Disallow: /upload`는 루트 경로만이다. `/main/upload/…`는 허용.
- PDF 파일 자체(existFile JS 다운로드)는 받지 않는다 — CLAUDE.md 「하지 말 것 5」. 텍스트 XML도 data/raw 캐시에만 둔다.
"""

from __future__ import annotations

import html
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from .http import ThrottledHttp

log = logging.getLogger(__name__)

BASE_URL = "https://www.i-sh.co.kr"
PREVIEW_RE = re.compile(r'href="(/main/com/util/htmlConverter\.do\?[^"]+)"')
ATTACH_ROW_RE = re.compile(
    r'<a[^>]+class="btnAttach[^"]*"[^>]*>\s*(?P<name>[^<]+?)\s*</a>.*?href="(?P<preview>/main/com/util/htmlConverter\.do\?[^"]+)"',
    re.S,
)
TEXT_RE = re.compile(r"<text l='([\d.]+)' t='([\d.]+)' w='([\d.]+)' h='([\d.]+)'\s*>(.*?)</text>", re.S)


@dataclass(frozen=True)
class Attachment:
    name: str          # 첨부 파일명 (예: 제51차 장기전세 입주자 모집공고.pdf)
    preview_url: str   # 절대 URL


@dataclass(frozen=True)
class SynapDoc:
    rs: str            # /main/upload/bbs/GS0401/2026/08/html/
    fn: str            # 20260831092652326_1b52…

    def page_url(self, page: int) -> str:
        return f"{BASE_URL}{self.rs}{self.fn}.files/{self.fn}_{page}.xml"


@dataclass(frozen=True)
class Char:
    l: float
    t: float
    w: float
    h: float
    ch: str

    @property
    def r(self) -> float:
        return self.l + self.w

    @property
    def b(self) -> float:
        return self.t + self.h


@dataclass
class Segment:
    """한 줄 안에서 큰 간격 없이 이어진 글자 묶음 = 표의 칸 하나."""

    l: float
    r: float
    text: str


def find_attachments(page_html: str) -> list[Attachment]:
    """공고 원문 HTML → 첨부 목록. 미리보기 링크가 있는 첨부만(뷰어 변환이 된 것)."""
    out: list[Attachment] = []
    page_html = re.sub(r"<!--.*?-->", "", page_html, flags=re.S)  # 주석 처리된 아이콘 샘플 마크업(.pdf .hwp …)을 먼저 걷어낸다
    for m in ATTACH_ROW_RE.finditer(page_html):
        out.append(Attachment(name=html.unescape(m.group("name")).strip(), preview_url=urljoin(BASE_URL, html.unescape(m.group("preview")))))
    if not out:  # 파일명 마크업이 달라져도 미리보기 링크만은 건진다
        out = [Attachment(name="", preview_url=urljoin(BASE_URL, html.unescape(u))) for u in PREVIEW_RE.findall(page_html)]
    return out


def parse_chars(xml: str) -> list[Char]:
    return [
        Char(float(l), float(t), float(w), float(h), html.unescape(ch))
        for l, t, w, h, ch in TEXT_RE.findall(xml)
    ]


def group_rows(chars: list[Char]) -> list[list[Char]]:
    """글자 세로 중심이 줄의 첫 글자 상자 안에 들면 같은 줄.

    줄 상자를 늘리지 않는다 — 늘리면 세로 병합 칸(자치구 한 글자씩 세로 배치)이 다음 줄과 겹쳐
    표의 여러 행이 한 줄로 이어 붙는다. 하이픈·괄호처럼 baseline이 어긋난 글자는 중심이 줄 안에 들어 붙는다.
    """
    rows: list[list[Char]] = []
    boxes: list[tuple[float, float]] = []
    for c in sorted(chars, key=lambda c: (c.t, c.l)):
        mid = c.t + c.h / 2
        if rows and boxes[-1][0] <= mid < boxes[-1][1]:
            rows[-1].append(c)
        else:
            rows.append([c])
            boxes.append((c.t, c.b))
    return rows


def row_segments(row: list[Char], gap: float = 14.0) -> list[Segment]:
    """줄 안의 글자를 x순으로 이어 붙이고, gap 이상 벌어지면 칸을 나눈다. 공백은 XML에 글자로 온다."""
    segs: list[Segment] = []
    cur: Segment | None = None
    prev_r = None
    for c in sorted(row, key=lambda c: c.l):
        if cur is None or (prev_r is not None and c.l - prev_r > gap):
            if not c.ch.strip():
                continue
            cur = Segment(c.l, c.r, c.ch)
            segs.append(cur)
        else:
            cur.text += c.ch
            cur.r = c.r
        prev_r = c.r
    for s in segs:
        s.text = re.sub(r"\s+", " ", s.text).strip()
    return [s for s in segs if s.text]


def page_rows(xml: str) -> list[list[Segment]]:
    return [row_segments(r) for r in group_rows(parse_chars(xml))]


class IshClient:
    def __init__(self, *, delay_sec: float = 1.0, timeout_sec: float = 30.0, max_retries: int = 3, http: httpx.Client | None = None):
        # 302 Location을 직접 읽어야 하므로 리다이렉트를 따라가지 않는다
        self._http = ThrottledHttp(delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, follow_redirects=False, http=http)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_notice_html(self, url: str) -> str:
        return self._http.get(url, label="i-sh 공고", accept_redirect=False).text

    def resolve_preview(self, preview_url: str) -> SynapDoc | None:
        """미리보기 링크 → 뷰어 302 Location에서 rs·fn. 변환이 안 된 첨부면 None."""
        resp = self._http.get(preview_url, label="i-sh 미리보기", accept_redirect=True)
        loc = resp.headers.get("location", "")
        q = parse_qs(urlparse(loc).query)
        fn, rs = (q.get("fn") or [""])[0], (q.get("rs") or [""])[0]
        if not fn or not rs:
            log.warning("미리보기 해석 실패: %s → %s", preview_url, loc[:120])
            return None
        return SynapDoc(rs=rs, fn=fn)

    def iter_pages(self, doc: SynapDoc, *, cache_dir: Path | None = None, max_pages: int = 300) -> Iterator[tuple[int, str]]:
        """1쪽부터 없는 쪽이 나올 때까지. cache_dir이 있으면 받은 XML을 그대로 둔다(재실행 시 네트워크 없음)."""
        for page in range(1, max_pages + 1):
            cached = cache_dir / f"{doc.fn}_{page}.xml" if cache_dir else None
            if cached and cached.exists():
                yield page, cached.read_text(encoding="utf-8")
                continue
            if cache_dir and (cache_dir / f"{doc.fn}_{page}.missing").exists():
                return
            resp = self._http.get(doc.page_url(page), label=f"i-sh xml p{page}", accept_redirect=True)
            if resp.status_code != 200:
                if cache_dir:
                    cache_dir.mkdir(parents=True, exist_ok=True)
                    (cache_dir / f"{doc.fn}_{page}.missing").write_text("", encoding="utf-8")
                return
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(resp.text, encoding="utf-8")
            yield page, resp.text
