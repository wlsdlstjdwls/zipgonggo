"""SH 공사 홈페이지(i-sh.co.kr) 공고 첨부 텍스트 — Synap 문서뷰어 변환 결과.

실측 2026-09-08 (memory sh-attachment-synap-path · docs/data-sources.md §3):
- 공고 원문 `…/brd/m_241/view.do?seq=N` 의 첨부 행에 「미리보기」 링크 `/main/com/util/htmlConverter.do?brd_id=GS0401&seq=N&data_tp=A&file_seq=K`
- 그 링크는 302 → `/main/skin/doc.html?fn={fn}&rs={rs}`. 뷰어(Synap)는 페이지 텍스트를
  `{rs}{fn}.files/{fn}_{page}.xml` 에서 읽는다. page는 1부터, 없는 번호는 `/error/error.html`로 302.
- XML은 글자 단위 `<text l t w h>글자</text>`. 줄·칸 복원은 좌표로 한다(page_rows).
- 경로 프리픽스가 둘이다: 최근 게시판은 `/main/…`, 구 게시판(2020년 등)은 `/app/…`. rs·미리보기 링크 모두 해당.
- robots.txt: `Disallow: /upload`는 루트 경로만이다. `/main/upload/…`·`/app/upload/…`는 허용.
- User-Agent가 문자열 `curl/…`이면 307 → /error/error.html. 그 외(기본 UA 포함)는 정상. 조사 때 curl로 죽었다고 오판하지 말 것.
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
PREVIEW_RE = re.compile(r'href="(/(?:main|app)/com/util/htmlConverter\.do\?[^"]+)"')
ATTACH_ROW_RE = re.compile(
    r'<a[^>]+class="btnAttach[^"]*"[^>]*>\s*(?P<name>[^<]+?)\s*</a>.*?href="(?P<preview>/(?:main|app)/com/util/htmlConverter\.do\?[^"]+)"',
    re.S,
)
TEXT_RE = re.compile(r"<text l='([\d.]+)' t='([\d.]+)' w='([\d.]+)' h='([\d.]+)'\s*>(.*?)</text>", re.S)

# 상세 URL이 두 모양으로 돌아다닌다.
#   짧은 것  /main/brd/m_241/view.do?seq=N
#   긴 것    /main/lay2/program/S1T294C295/www/brd/m_241/view.do?seq=N   ← 포털 목록이 주는 모양
# 둘 다 같은 문서를 주지만 **없는 seq일 때 응답이 다르다**(실측 2026-09-10).
# 긴 쪽은 게시판 목록 페이지(166KB)를 조용히 돌려줘 「첨부 0건」과 구별되지 않는다.
# 짧은 쪽은 alert('해당 데이터를 찾을 수 없습니다') 197바이트라 판정이 분명하다. 그래서 짧은 쪽으로 통일한다.
VIEW_URL_RE = re.compile(r"^(https?://[^/]+)/(main|app)/(?:.*/)?brd/(m_\d+)/view\.do")
MISSING_RE = re.compile(r"찾을 수 없습니다")



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


def short_view_url(url: str) -> str:
    """긴 lay2 경로를 짧은 게시판 경로로 줄인다. 모양이 다르면 그대로 돌려준다."""
    m = VIEW_URL_RE.match(url)
    if not m:
        return url
    host, prefix, board = m.groups()
    query = url.split("?", 1)[1] if "?" in url else ""
    return f"{host}/{prefix}/brd/{board}/view.do" + (f"?{query}" if query else "")


def is_missing_page(page_html: str) -> bool:
    """그 seq의 글이 게시판에 없다. 첨부가 0건인 것과 다르다 — 다른 seq를 찾아야 한다는 뜻이다.

    포털 목록의 i-sh 링크는 **정정공고가 나면 어긋난다**(실측 2026-09-10):
    i-sh는 정정본을 새 seq로 다시 올리는데 포털은 옛 seq를 그대로 들고 있다
    (「2026년 2차 장기미임대」 포털 310046 → 실제 310107).
    """
    return len(page_html) < 2000 and bool(MISSING_RE.search(page_html))


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


def group_rows(chars: list[Char], slack: float = 0.0) -> list[list[Char]]:
    """글자 세로 중심이 줄의 첫 글자 상자 안에 들면 같은 줄.

    줄 상자를 늘리지 않는다 — 늘리면 세로 병합 칸(자치구 한 글자씩 세로 배치)이 다음 줄과 겹쳐
    표의 여러 행이 한 줄로 이어 붙는다. 하이픈·괄호처럼 baseline이 어긋난 글자는 중심이 줄 안에 들어 붙는다.
    slack(상자 높이 비율)은 회전 표처럼 구두점이 상자 밖으로 벗어나는 쪽에만 준다 — 정방향 표는 줄 간격이 좁아 0.
    """
    rows: list[list[Char]] = []
    boxes: list[tuple[float, float]] = []
    for c in sorted(chars, key=lambda c: (c.t, c.l)):
        if c.w <= 0 and c.h <= 0:
            continue  # 크기 0 빈 글자(변환기 잔여물)
        mid = c.t + c.h / 2
        if rows:
            top, bottom = boxes[-1]
            # 여유는 구두점(하이픈·소수점·쉼표)에만. 글자·숫자까지 주면 이웃 행 글자를 훔쳐 온다('강서구'→'강서')
            is_punct = bool(c.ch.strip()) and not c.ch.strip().isalnum()  # 공백은 제 줄 폭을 갖고 있어 여유 없이 판정
            pad = (bottom - top) * slack if is_punct else 0.0
            if top - pad <= mid < bottom + pad:
                rows[-1].append(c)
                continue
        rows.append([c])
        boxes.append((c.t, c.b))
    return rows


ROTATED_SLACK = 0.3  # 회전 표: 하이픈·소수점·쉼표 상자가 글자 상자에서 30%까지 벗어난다(51차·2차 매입 실측)


def transpose(chars: list[Char], page_h: float | None = None) -> list[Char]:
    """90° 회전된 쪽(가로표를 세로로 눕힌 별첨)을 정방향 좌표로. x축이 줄이 되고 줄 안 순서는 위→아래(원본 y 내림)."""
    H = page_h if page_h is not None else max((c.b for c in chars), default=0.0)
    return [Char(l=H - c.b, t=c.l, w=c.h, h=c.w, ch=c.ch) for c in chars if c.w > 0 or c.h > 0]


def is_rotated(chars: list[Char]) -> bool:
    """글자 상자가 세로보다 가로로 긴 게 다수면 회전된 쪽. 정방향 한글은 h>w (13×15), 회전하면 w>h (10.7×6)."""
    boxed = [c for c in chars if c.w > 0 and c.h > 0 and c.ch.strip()]
    if len(boxed) < 20:
        return False
    wide = sum(1 for c in boxed if c.w > c.h * 1.15)
    return wide > len(boxed) * 0.6


def columns_by_x(row: list[Char], bounds: list[float]) -> list[str]:
    """줄의 글자를 x 경계로 칸에 배정한다(칸 사이 간격이 좁아 gap 분할이 안 되는 표용). bounds는 오름차순 경계, 칸 수 = len(bounds)+1."""
    cells: list[list[Char]] = [[] for _ in range(len(bounds) + 1)]
    for c in row:
        x = c.l + c.w / 2
        i = 0
        while i < len(bounds) and x >= bounds[i]:
            i += 1
        cells[i].append(c)
    return [re.sub(r"\s+", " ", "".join(ch.ch for ch in sorted(cell, key=lambda ch: ch.l))).strip() for cell in cells]


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


def row_center_y(row: list[Char]) -> float:
    """줄의 세로 중심. 세로 병합 칸은 자기 블록의 정중앙에 놓이므로 병합 복원에 이 값이 필요하다."""
    boxed = [c for c in row if c.h > 0]
    return sum(c.t + c.h / 2 for c in boxed) / len(boxed) if boxed else 0.0


def page_rows_y(xml: str) -> list[tuple[float, list[Segment]]]:
    """page_rows에 줄의 세로 중심을 붙인 것."""
    return [(row_center_y(r), row_segments(r)) for r in group_rows(parse_chars(xml))]


class IshClient:
    def __init__(self, *, delay_sec: float = 1.0, timeout_sec: float = 30.0, max_retries: int = 3, http: httpx.Client | None = None):
        # 302 Location을 직접 읽어야 하므로 리다이렉트를 따라가지 않는다
        self._http = ThrottledHttp(delay_sec=delay_sec, timeout_sec=timeout_sec, max_retries=max_retries, follow_redirects=False, http=http)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_notice_html(self, url: str) -> str:
        return self._http.get(short_view_url(url), label="i-sh 공고", accept_redirect=False).text

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
