"""지번주소 → 표준 도로명주소. 행안부 주소 검색 API(business.juso.go.kr).

**좌표는 여기서 얻지 않는다**(CLAUDE.md 하지 말 것 1). 이 API가 돌려주는 건 주소 문자열과
도로명코드/본번/부번뿐이고, 그 네 값으로 요약DB 출입구 좌표를 오프라인 조인한다.
좌표제공 API(`addrCoordApi`)는 쓰지 않는다.

    rnMgtSn + udrtYn + buldMnnm + buldSlno  →  entrance 테이블 기본키

공고문 소재지가 지번으로만 적힌 단지(재개발 매입분·리츠분)가 전체의 4분의 1이라
이 변환이 없으면 지도에 못 찍는다. 도로명주소는 공공저작물이라 문자열 저장에 제약이 없다.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, replace

from ..sources.egress import Egress, from_env as egress_from_env

log = logging.getLogger(__name__)

API = "https://business.juso.go.kr/addrlink/addrLinkApi.do"
TIMEOUT = 20
RETRY = 3
# 연달아 이만큼 연결이 안 되면 그 판에선 더 안 부른다. 서버가 통째로 안 받는 상황인데
# 주소마다 20초씩 세 번을 기다리면 수천 건이 남은 회차가 45분 타임아웃까지 간다(2026-09-15).
GIVE_UP_AFTER = 5

# 검색어를 흐리는 꼬리표. "172번지 일대"처럼 구역을 뭉뚱그린 표기는 번지까지만 남긴다
_TAIL = re.compile(r"\s*(?:번지)?\s*(?:일대|일원|외\s*\d+\s*필지|등\s*\d+\s*필지)\s*$")
# 괄호 안 부연과 쉼표 뒤 동호수
_PAREN = re.compile(r"[(（][^)）]*[)）]")
# 지번까지 — "강동구 상일동 36-3 강동리엔파크11단지"의 앞 세 토막
_UPTO_BUNJI = re.compile(r"^(.*?\d+(?:-\d+)?)\s+\S+.*$")
# 부번 떼기 — "개봉동 199-4" → "개봉동 199". 주소가 안 붙은 필지의 이웃을 빌린다
_DROP_SUB = re.compile(r"^(.*?\d+)-\d+$")


@dataclass(frozen=True)
class JusoHit:
    """검색 API 한 건. 좌표는 없다 — 요약DB를 찾아갈 열쇠만 들었다."""

    road_addr: str      # 전체 도로명주소 (참고용)
    road_code: str      # rnMgtSn 12자리
    underground: bool   # udrtYn
    main_no: int        # buldMnnm
    sub_no: int         # buldSlno
    sido: str
    sigungu: str
    eupmyeondong: str
    building_name: str
    how: str = "addr"   # 어느 시도에서 맞았나 — addr · bunji · main · name. main은 이웃 필지라 정확도를 낮춘다


def clean_query(address: str | None) -> str:
    """검색어 다듬기. 지번 뒤 건물명은 남긴다 — 동명이지번을 가려 주는 단서다."""
    if not address:
        return ""
    text = _PAREN.sub(" ", address).split(",")[0]
    text = _TAIL.sub("", text)
    return " ".join(text.split()).strip()


class JusoSearch:
    """검색 API 클라이언트. 같은 주소를 두 번 묻지 않게 한 판 동안 답을 기억한다."""

    def __init__(self, confm_key: str, *, delay_sec: float = 0.4, egress: Egress | None = None):
        if not confm_key:
            raise RuntimeError("JUSO_SEARCH_API_KEY 가 비어 있다. pipeline/.env 를 확인할 것")
        self.confm_key = confm_key
        self.delay_sec = delay_sec
        # 서울 구멍(sources/egress.py). 안 켜져 있으면 지금까지처럼 직접 나간다
        self._egress = egress if egress is not None else egress_from_env()
        self._cache: dict[str, JusoHit | None] = {}
        self.calls = 0
        self.given_up = False   # 회로 차단 — 이번 판에선 API를 포기했다
        self._misfires = 0      # 연속 연결 실패

    def find(self, address: str | None, *, sido: str | None = None,
             name: str | None = None, sigungu: str | None = None) -> JusoHit | None:
        """주소 한 줄로 찾는다. 네 번까지 물러선다 — 원문 → 지번까지 → 부번 뗀 본번 → 단지명.

        뒤로 갈수록 헐거워지므로 어디서 맞았는지를 `how`에 남긴다. S6이 그걸 보고 정확도를 매긴다.
        """
        if self.given_up:
            return None
        query = clean_query(address)
        if len(query) < 4:
            return None
        cache_key = f"{query}|{name or ''}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        hit = self._pick(self._search(query), sido, query, "addr")

        # 1) 공고문 단지명이 공부상 건물명과 다르다 — 지번만 남겨 다시 묻는다
        if hit is None:
            m = _UPTO_BUNJI.match(query)
            if m and m.group(1) != query:
                query = m.group(1)
                hit = self._pick(self._search(query), sido, query, "bunji")

        # 2) 그 필지에 도로명주소가 아직 없다(신축·나대지) — 부번을 떼고 본번으로 이웃을 빌린다
        if hit is None:
            m = _DROP_SUB.match(query)
            if m:
                hit = self._pick(self._search(m.group(1)), sido, m.group(1), "main")

        # 3) 마지막으로 단지명. 같은 시군구에서 나온 답만 받는다
        if hit is None and name:
            cand = self._pick(self._search(_clean_name(name)), sido, name, "name")
            if cand is not None and (not sigungu or cand.sigungu == sigungu):
                hit = cand

        self._cache[cache_key] = hit
        return hit

    def _pick(self, hits: list[JusoHit], sido: str | None, query: str, how: str) -> JusoHit | None:
        if not hits:
            return None
        if sido:
            hits = [h for h in hits if h.sido == sido] or hits
        if len(hits) == 1:
            return replace(hits[0], how=how)
        # 동네가 갈리면 동명이지번이다 — 엉뚱한 데를 찍느니 비워 둔다
        if len({(h.sigungu, h.eupmyeondong) for h in hits}) > 1:
            return None
        # 한 단지의 여러 출입구다. 공고가 부른 이름과 같은 건물을 고르고,
        # 없으면 꼬리표(제1상가·제2상가)가 안 붙은 짧은 이름이 주거동이다
        tail = query.split()[-1]
        exact = [h for h in hits if h.building_name and h.building_name == tail]
        best = exact[0] if exact else min(hits, key=lambda h: (len(h.building_name), h.main_no))
        return replace(best, how=how)

    def _search(self, keyword: str) -> list[JusoHit]:
        params = urllib.parse.urlencode({
            "confmKey": self.confm_key, "currentPage": 1, "countPerPage": 10,
            "keyword": keyword, "resultType": "json",
        })
        body = self._get(f"{API}?{params}")
        if body is None:
            return []
        try:
            results = json.loads(body)["results"]
        except (ValueError, KeyError):
            log.warning("juso 응답을 못 읽었다: %s", keyword)
            return []
        common = results.get("common", {})
        if common.get("errorCode") != "0":
            log.warning("juso 오류 %s %s (%s)", common.get("errorCode"), common.get("errorMessage"), keyword)
            return []
        return [h for h in (_hit(j) for j in results.get("juso") or []) if h is not None]

    def _get(self, url: str) -> str | None:
        """한 건 호출. 연달아 실패가 쌓이면 이번 판 전체를 포기한다(given_up).

        실패를 세는 건 **연속**으로만 한다 — 중간에 한 번이라도 답이 오면 0으로 돌린다.
        API가 살아 있는데 특정 주소만 안 나오는 것과, 서버가 통째로 안 받는 것을 가른다.
        """
        if self.given_up:
            return None
        # 프록시를 탈 주소면 갈아 끼운다. juso도 해외 IP에서 연결이 안 되는 축이다
        send_url, headers = (self._egress.wrap(url) if self._egress.targets(url) else (url, {}))
        for attempt in range(1, RETRY + 1):
            try:
                time.sleep(self.delay_sec)
                self.calls += 1
                req = urllib.request.Request(send_url, headers=headers)
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    body = resp.read().decode("utf-8")
                self._misfires = 0
                return body
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt == RETRY:
                    self._misfires += 1
                    log.warning("juso 호출 실패(%d회, 연속 %d): %s", RETRY, self._misfires, exc)
                    if self._misfires >= GIVE_UP_AFTER:
                        self.given_up = True
                        log.error("juso 검색 API가 연속 %d건 안 받는다 — 이번 판은 여기서 접는다. "
                                  "지번주소 단지는 좌표가 안 채워진 채 남고 다음 회차가 다시 집는다",
                                  self._misfires)
                    return None
                time.sleep(self.delay_sec * attempt * 2)
        return None


def _hit(juso: dict) -> JusoHit | None:
    try:
        return JusoHit(
            road_addr=juso.get("roadAddr", ""),
            road_code=juso["rnMgtSn"],
            underground=juso.get("udrtYn") == "1",
            main_no=int(juso["buldMnnm"]),
            sub_no=int(juso.get("buldSlno") or 0),
            sido=juso.get("siNm", ""),
            sigungu=juso.get("sggNm", ""),
            eupmyeondong=juso.get("emdNm", ""),
            building_name=juso.get("bdNm", ""),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _clean_name(name: str) -> str:
    """단지명에서 괄호 부연과 앞머리 표시를 떼어 검색어로 만든다."""
    return " ".join(_PAREN.sub(" ", name).split()).strip()
