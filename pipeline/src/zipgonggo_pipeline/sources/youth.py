"""서울시 청년안심주택 모집공고 게시판(soco.seoul.go.kr) — 민간임대 축의 주 소스.

실측 2026-09-15:
- 화면 `https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008`은 표를 AJAX로 채운다.
  목록은 `POST /youth/pgm/home/yohome/bbsListJson.json` (폼: bbsId=BMSR00015 · pageIndex · searchAdresGu ·
  searchCondition · searchKeyword · optn2 · optn5). 쪽당 10행, `pagingInfo.totPage`가 끝. 486건 49쪽, 2019-10 ~ 현재.
- 행마다 **본문 HTML(`content`)이 통째로 실려 온다** — 상세 페이지를 따로 열 필요가 없다.
  optn1=공고게시일 · optn4=청약신청일 · optn3=담당부서/사업자 · optn2=1 공공/2 민간 · optn5=1 최초/2 추가 · atchFileId.
- 상세는 `/youth/bbs/BMSR00015/view.do?boardId=N&menuNo=400008`, 첨부는
  `/coHouse/cmmn/file/fileDown.do?atchFileId=…&fileSn=1` (PDF 공고문 1개가 보통).
- 본문은 운영자가 손으로 쓴 안내문이라 조판이 조금씩 다르지만 「■단지명 / ■주택위치 / ■공급호수 / ■사업주체 /
  ■청약신청 : ‘26. 09. 10. (목) 17:00 ~ 09. 14. (월) 23:00」 꼴이 466건 중 460건 이상이다. 라벨 앵커로 읽는다.
- 「[공공임대]」 글 19건은 SH 청년안심주택(공공임대) 공고의 안내문 — 원본은 i-sh 게시판이고 `s1_ish_board`가 이미
  적재하므로 여기서는 건너뛴다(같은 공고가 두 번 뜨면 안 된다).
- robots.txt 없음(404). 푸터 © Seoul Metropolitan Government. 서울시 공공저작물 정책 준용 — 원문 복제 없이 사실만 재구성.
  요청 간격은 ThrottledHttp가 지킨다(CLAUDE.md 「하지 말 것 6」).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, time
from html import unescape
from typing import Any

from .http import ThrottledHttp

log = logging.getLogger(__name__)

BASE_URL = "https://soco.seoul.go.kr"
LIST_JSON_URL = f"{BASE_URL}/youth/pgm/home/yohome/bbsListJson.json"
VIEW_URL = f"{BASE_URL}/youth/bbs/BMSR00015/view.do?boardId={{board_id}}&menuNo=400008"
FILE_URL = f"{BASE_URL}/coHouse/cmmn/file/fileDown.do?atchFileId={{atch}}&fileSn=1"
BBS_ID = "BMSR00015"
PAGE_SIZE = 10  # 사이트 고정


@dataclass(frozen=True)
class YouthPost:
    board_id: str
    title: str
    posted: str            # optn1 YYYY-MM-DD
    apply_date: str        # optn4 YYYY-MM-DD(청약신청일, 시작일)
    operator: str          # optn3 담당부서/사업자
    sector_code: str       # optn2: 1 공공 · 2 민간
    round_code: str        # optn5: 1 최초 · 2 추가 · '' 미표기
    atch_file_id: str
    content_html: str
    raw: dict[str, Any] = field(repr=False, default_factory=dict)

    @property
    def is_private(self) -> bool:
        return self.sector_code == "2"

    @property
    def source_url(self) -> str:
        return VIEW_URL.format(board_id=self.board_id)

    @property
    def file_url(self) -> str | None:
        return FILE_URL.format(atch=self.atch_file_id) if self.atch_file_id else None

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.raw.items() if k != "content"}


def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def post_from_row(row: dict[str, Any]) -> YouthPost:
    return YouthPost(
        board_id=_s(row.get("boardId")),
        title=_s(row.get("nttSj")),
        posted=_s(row.get("optn1")),
        apply_date=_s(row.get("optn4")),
        operator=_s(row.get("optn3")),
        sector_code=_s(row.get("optn2")),
        round_code=_s(row.get("optn5")),
        atch_file_id=_s(row.get("atchFileId")),
        content_html=row.get("content") or "",
        raw=row,
    )


class YouthClient:
    def __init__(self, *, delay_sec: float = 1.0, http: ThrottledHttp | None = None):
        self._http = http or ThrottledHttp(delay_sec=delay_sec)

    @property
    def call_count(self) -> int:
        return self._http.call_count

    def fetch_page(self, page: int) -> dict[str, Any]:
        form = {"bbsId": BBS_ID, "pageIndex": str(page), "searchAdresGu": "", "searchCondition": "",
                "searchKeyword": "", "optn2": "", "optn5": ""}
        resp = self._http.post(LIST_JSON_URL, data=form, label=f"youth list p{page}")
        return resp.json()

    def iter_posts(self, *, max_pages: int | None = None) -> Iterator[YouthPost]:
        """1쪽(최신)부터. 끝은 pagingInfo.totPage."""
        page = 1
        while True:
            data = self.fetch_page(page)
            rows = data.get("resultList") or []
            for r in rows:
                yield post_from_row(r)
            tot = int((data.get("pagingInfo") or {}).get("totPage") or 0)
            log.debug("youth p%d/%d %d행", page, tot, len(rows))
            if not rows or page >= tot or (max_pages and page >= max_pages):
                return
            page += 1


# ---------------------------------------------------------------- 본문 파싱

_BLOCK_END = re.compile(r"<br\s*/?>|</p>|</h\d>|</li>|</tr>|</td>|</div>", re.I)
_TAG = re.compile(r"<[^>]+>")
_BULLET = re.compile(r"^[\s■□○●▶◦•\-–·※▣]+")
# 라벨 「단 지 명」처럼 글자 사이에 공백을 끼우는 글이 있어 공백을 빼고 비교한다
_LABEL = re.compile(r"^([가-힣A-Za-z /()·]{2,20}?)\s*[:：]\s*(.*)$")


def html_lines(html: str) -> list[str]:
    t = _BLOCK_END.sub("\n", html or "")
    t = _TAG.sub("", t)
    t = unescape(t).replace("\xa0", " ")
    return [ln.strip() for ln in t.splitlines() if ln.strip()]


def labeled(lines: list[str]) -> dict[str, str]:
    """「■라벨 : 값」 줄을 {라벨(공백 제거): 값}으로. 같은 라벨은 첫 것만."""
    out: dict[str, str] = {}
    for ln in lines:
        m = _LABEL.match(_BULLET.sub("", ln))
        if not m:
            continue
        key = re.sub(r"\s+", "", m.group(1))
        out.setdefault(key, m.group(2).strip())
    return out


def _pick(d: dict[str, str], *keys: str) -> str | None:
    for k in keys:
        if k in d and d[k]:
            return d[k]
    for k in keys:  # 부분 일치(「청약신청기간」「청약신청접수」)
        for dk, v in d.items():
            if k in dk and v:
                return v
    return None


_NUM = r"([\d,]+)\s*(?:세대|호|실)"


def parse_supply(s: str | None) -> tuple[int | None, int | None]:
    """공급호수 문구 → (총 세대수, 이번 공급 호수).

    「총 254세대 중 금회 추가모집 공공지원민간임대 3세대 (특별공급 2세대, 일반공급 1세대)」 → (254, 3)
    「총 254세대 중 금회 추가모집 공공지원민간임대 예비자 모집」 → (254, None)
    「67호 (특별공급 14호, 일반공급 53호)」 → (None, 67)
    """
    if not s:
        return None, None
    text = s.replace(" ", "")
    total = None
    m = re.search(r"총" + _NUM, text)
    if m:
        total = int(m.group(1).replace(",", ""))
    m = re.search(r"민간임대" + _NUM, text)
    if m:
        return total, int(m.group(1).replace(",", ""))
    if total is None:
        m = re.match(_NUM, text)
        if m:
            return None, int(m.group(1).replace(",", ""))
        # 「33B (1세대)」 「30형 청년형, 일반(9세대)」 「특별공급 1세대/예비자 10세대」 — 타입별 낱개를 더한다(예비자 제외)
        picked = [int(n.replace(",", "")) for word, n in re.findall(r"([가-힣A-Za-z]*)\(?" + _NUM, text) if "예비" not in word]
        if picked:
            return None, sum(picked)
    return total, None


_PAREN = re.compile(r"\s*[(（][^)）]*[)）]\s*$")
# 「서울특별시 성북구」「서울시 강남구」「서울 강남구」「강남구 삼성동」 — 시도 표기가 제각각이라 구 이름만 잡는다
_SIGUNGU = re.compile(r"(?:^|\s)([가-힣]{1,4}구)(?=\s|$)")
_SIDO_PREFIX = re.compile(r"^(?:서울특별시|서울시|서울)\s*")


def parse_location(s: str | None) -> tuple[str | None, str | None]:
    """「서울특별시 성북구 월계로 38 (4호선 미아사거리역 2번 출구)」 → ('서울특별시 성북구 월계로 38', '성북구').
    시도 표기는 「서울특별시」로 통일한다(S6 요약DB 조인은 sido 칸을 따로 본다)."""
    if not s:
        return None, None
    addr = _PAREN.sub("", s).strip()
    addr = re.sub(r"\s+", " ", addr)
    if not addr:
        return None, None
    addr = "서울특별시 " + _SIDO_PREFIX.sub("", addr)
    m = _SIGUNGU.search(addr)
    return addr, (m.group(1) if m else None)


# ‘26. 09. 10. (목) 17:00 ~ 09. 14. (월) 23:00 / 2022.11.21.(월)~2022.11.23.(수) / ‘26. 09. 10. (월) 10:00 ~ 17:00
_WEEKDAY = re.compile(r"[(（]\s*[월화수목금토일]\s*[)）]")
# 「17:00」 「10시」 「9시 30분」
_TIME = re.compile(r"(\d{1,2})\s*(?::\s*(\d{2})|시\s*(?:(\d{1,2})\s*분)?)")
_NUMS = re.compile(r"\d+")
_SPLIT = re.compile(r"\s*[~∼～]\s*|\s+[-–]\s+|(?<=\d\.)\s*[-–]\s*(?=\d)")


def _date_from_nums(nums: list[int], base: date | int | None) -> date | None:
    """[26, 9, 10] · [2022, 11, 21] · [9, 14] · [17] → date. 「09. 14.」를 연도로 읽지 않도록 숫자 개수로 가른다.
    base가 date면(시작일) 연도·월을 거기서 빌린다 — 「1월 16일 9시 ~ 17일 18시」."""
    base_year = base.year if isinstance(base, date) else base
    if len(nums) >= 3:
        y, m, d = nums[-3], nums[-2], nums[-1]
        y = y + 2000 if y < 100 else y
    elif len(nums) == 2 and base_year:
        y, m, d = base_year, nums[0], nums[1]
    elif len(nums) == 1 and isinstance(base, date):
        y, m, d = base.year, base.month, nums[0]
    else:
        return None
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _time_of(m: re.Match | None) -> time | None:
    if not m:
        return None
    h = int(m.group(1)) % 24  # 「24:00」은 자정 — time()이 24를 안 받는다
    mi = int(m.group(2) or m.group(3) or 0)
    return time(h, mi) if mi < 60 else time(h, 0)


def parse_period(s: str | None, *, base_year: int | None = None) -> tuple[date | None, date | None, time | None, time | None]:
    """접수 기간 문구 → (시작일, 마감일, 시작시각, 마감시각). 둘째 날짜가 없으면 당일, 둘째 연도가 없으면 시작 연도."""
    if not s:
        return None, None, None, None
    s = s.replace("‘", "").replace("’", "").replace("'", "")
    s = _WEEKDAY.sub(" ", s)
    s = re.split(r"\s*[\[\(]\s*\d+\s*일간", s)[0]  # 「[3일간]」 꼬리
    parts = _SPLIT.split(s, maxsplit=1)
    dates: list[date] = []
    times: list[time | None] = []
    for i, part in enumerate(parts[:2]):
        part = re.sub(r"(\d)\s*년", r"\1.", part)
        part = re.sub(r"(\d)\s*월", r"\1.", part)
        part = re.sub(r"(\d)\s*일(?!간)", r"\1.", part)
        tm = _TIME.search(part)
        date_part = part[: tm.start()] if tm else part
        nums = [int(x) for x in _NUMS.findall(date_part)]
        d = _date_from_nums(nums, dates[0] if dates else base_year)
        if d is not None:
            if dates and d < dates[0] and len(nums) == 2:  # 연도 없이 해가 바뀐 마감일
                d = d.replace(year=d.year + 1)
            dates.append(d)
        elif i == 1 and dates and tm:
            dates.append(dates[0])  # 「10:00 ~ 17:00」 당일
        times.append(_time_of(tm))
    if not dates:
        return None, None, None, None
    start = dates[0]
    end = dates[1] if len(dates) > 1 else start
    t0 = times[0] if times else None
    t1 = times[1] if len(times) > 1 else None
    return start, end, t0, t1


def parse_first_date(s: str | None, *, base_year: int | None = None) -> date | None:
    start, _, _, _ = parse_period(s, base_year=base_year)
    return start


_URL = re.compile(r"https?://[^\s<>\"']+")
_PHONE = re.compile(r"0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}")


@dataclass
class YouthFacts:
    complex_name: str | None = None
    address: str | None = None
    sigungu: str | None = None
    total_household: int | None = None
    supply_count: int | None = None
    developer: str | None = None
    apply_start: date | None = None
    apply_end: date | None = None
    apply_start_tm: time | None = None
    apply_end_tm: time | None = None
    announce: date | None = None
    apply_url: str | None = None
    phone: str | None = None
    labels: dict[str, str] = field(default_factory=dict)


def parse_facts(html: str, *, base_year: int | None = None) -> YouthFacts:
    lines = html_lines(html)
    d = labeled(lines)
    f = YouthFacts(labels=d)
    f.complex_name = _pick(d, "단지명")
    f.address, f.sigungu = parse_location(_pick(d, "주택위치", "주택소재지", "위치"))
    f.total_household, f.supply_count = parse_supply(_pick(d, "공급호수", "공급세대"))
    f.developer = _pick(d, "사업주체", "시행사(임대사업자)", "임대사업자", "시행사")
    period = _pick(d, "청약신청", "청약신청기간", "청약신청접수", "신청기간", "청약접수일", "청약접수", "접수기간")
    f.apply_start, f.apply_end, f.apply_start_tm, f.apply_end_tm = parse_period(period, base_year=base_year)
    f.announce = parse_first_date(_pick(d, "당첨자발표", "당첨자발표일"), base_year=base_year)
    url_line = _pick(d, "청약신청페이지", "홈페이지접수", "단지홈페이지", "홈페이지", "청약페이지")
    m = _URL.search(url_line or "") or _URL.search(html or "")
    f.apply_url = m.group(0).rstrip(".,)") if m else None
    m = _PHONE.search(_pick(d, "문의전화", "문의", "연락처") or "")
    f.phone = m.group(0) if m else None
    return f
