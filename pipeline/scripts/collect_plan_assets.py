"""단지 도면 자산 수집 — data.go.kr 파일데이터에서 평면도·조감도·배치도를 긁는다.

공고문 첨부(PDF/HWP)에서 도면을 뜯는 길은 쓰지 않는다 — 원 설계도면의 저작권이 공고문 라이선스와
같이 풀렸다는 근거가 없다. 대신 **기관이 직접 개방한 도면 데이터셋**만 모은다.
이쪽은 데이터셋마다 이용허락범위가 붙어 있어 게시 근거가 분명하다.

실측 2026-09-14:
- LH 15037046 「주택 평면도 현황」 — 이용허락범위 제한 없음. 340MB zip, 66단지 281장.
  구조는 `{지역본부}_{단지명}_{블록}/{주택형}.json`, 단지에 따라 한 겹 더 들어간다(`…/01/{주택형}.json`).
  **같은 확장자에 내용이 두 가지다.** 225장은 `<img src='data:image/jpg;base64,…'>` 한 줄(JSON이 아니다),
  55장은 포털 설명대로 `{"image":{"mime":…,"data":…}}`. 둘 다 받아야 전량이 나온다.
  zip 항목명은 CP949 — `name.encode('cp437').decode('cp949')`로 되살린다.
- 지방 개발공사도 단지별로 따로 올린다(제주개발공사 평면도+조감도, 경북개발공사 행복주택 조감도 등).
  하나씩 손으로 찾을 게 아니라 키워드로 쓸어 담는다 → `sweep`.
- 포털 다운로드는 무로그인. 상세 페이지 HTML의 `fn_fileDataDown('{pk}','{uddi}',…)`에서 uddi를 꺼내
  `/tcs/dss/selectFileDataDownload.do`로 atchFileId를 받고 `/cmm/cmm/fileDownload.do`로 받는다.

    cd pipeline
    python scripts/collect_plan_assets.py sweep                 # 후보 목록 → data/plans/_candidates.json
    python scripts/collect_plan_assets.py fetch 15037046        # 원본 내려받기 → data/plans/raw/
    python scripts/collect_plan_assets.py extract 15037046      # 이미지로 펼치기 → data/plans/img/

산출물은 커밋하지 않는다(CLAUDE.md 커밋 규칙 — `pipeline/data/`).
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote

import httpx

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
OUT_ROOT = PIPELINE_ROOT / "data" / "plans"

PORTAL = "https://www.data.go.kr"
# 포털은 pipeline UA로도 받지만, 검색 페이지가 봇 UA에 빈 목록을 주는 일이 있어 브라우저 UA로 간다.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
DELAY_SEC = 1.0
# 검색 목록 페이지는 10건씩. 마지막을 넘기면 첫 페이지가 되돌아와 루프가 알아서 끝난다.
MAX_SEARCH_PAGES = 12

# 공공주택 도면을 부르는 말들. 「투시도」는 LH 데이터셋 키워드에만 붙어 있어 같이 넣는다.
SWEEP_KEYWORDS = ("평면도", "조감도", "배치도", "투시도", "단지배치도")
# 우리가 쓸 수 있는 기관만 남긴다. 주차장 평면도(공항공사) 같은 건 단지와 무관하다.
HOUSING_INSTT_RE = re.compile(r"(토지주택|개발공사|도시공사|주택공사|시설관리공단|주거|SH|GH)")
HOUSING_SUBJECT_RE = re.compile(r"(주택|단지|임대|분양|아파트|행복주택|스마트빌리지)")
# 「단지」가 산업단지·물류단지로도 걸린다. 같은 공사가 올린 것이라 기관명으로는 안 갈린다.
NOT_HOUSING_RE = re.compile(r"(산업단지|물류단지|첨단산업|연구개발특구|조성사업)")

DATASET_RE = re.compile(r"/data/(\d+)/fileData\.do")
TITLE_RE = re.compile(r'title="([^"]{2,120}?) (?:다운로드|미리보기)"')
UDDI_RE = re.compile(r"fn_fileDataDown\('(\d+)',\s*'(uddi:[0-9a-f-]+)'")
DATA_URI_RE = re.compile(r"data:image/(\w+);base64,([A-Za-z0-9+/=]+)")
JSON_FIELD_RE = re.compile(r'"(atchFileId|fileDetailSn)":"([^"]+)"')


@dataclass(frozen=True)
class Candidate:
    data_id: str
    title: str
    keyword: str
    license: str = ""
    instt: str = ""


def client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0), headers={"User-Agent": UA}, follow_redirects=True)


def _get(http: httpx.Client, url: str) -> httpx.Response:
    """포털 GET — 호출 간격을 지킨다(CLAUDE.md 스크래핑 규칙)."""
    time.sleep(DELAY_SEC)
    return http.get(url)


def _catalog(http: httpx.Client, data_id: str) -> dict:
    """데이터셋 메타(제목·기관·라이선스). 상세 HTML보다 이쪽이 가볍고 확실하다."""
    r = _get(http, f"{PORTAL}/catalog/{data_id}/fileData.json")
    if r.status_code != 200:
        return {}
    try:
        return r.json()
    except ValueError:
        return {}


def sweep(out: Path) -> list[Candidate]:
    """키워드로 파일데이터를 훑어 「단지 도면」 후보만 남긴다."""
    found: dict[str, Candidate] = {}
    with client() as http:
        for kw in SWEEP_KEYWORDS:
            seen: set[str] = set()
            for page in range(1, MAX_SEARCH_PAGES + 1):
                r = _get(http, f"{PORTAL}/tcs/dss/selectDataSetList.do?dType=FILE&keyword={quote(kw)}&currentPage={page}")
                r.raise_for_status()
                ids = dict.fromkeys(DATASET_RE.findall(r.text))
                if not ids or set(ids) <= seen:  # 마지막 페이지를 넘기면 같은 목록이 되돌아온다
                    break
                seen |= set(ids)
                titles = dict.fromkeys(TITLE_RE.findall(r.text))
                # 목록 HTML은 데이터셋 id와 제목을 같은 순서로 뱉는다. 짝이 어긋나면 제목을 비워 둔다.
                for data_id, title in zip(ids, titles, strict=False):
                    if data_id in found:
                        continue
                    meta = _catalog(http, data_id)
                    name = meta.get("name") or title
                    instt = (meta.get("creator") or {}).get("name", "")
                    if not (HOUSING_INSTT_RE.search(instt + name) and HOUSING_SUBJECT_RE.search(name)):
                        continue
                    if NOT_HOUSING_RE.search(name):
                        continue
                    found[data_id] = Candidate(data_id, name, kw, meta.get("license", ""), instt)
            print(f"  {kw}: {len(seen)}건 훑음, 누적 후보 {len(found)}건", file=sys.stderr)

    rows = sorted(found.values(), key=lambda c: c.data_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([asdict(c) for c in rows], ensure_ascii=False, indent=2), encoding="utf-8")
    return rows


def fetch(data_id: str, dest_dir: Path) -> Path:
    """데이터셋 원본 파일 1건을 받는다. 포털 로그인 없이 된다(실측 2026-09-14)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    with client() as http:
        page = _get(http, f"{PORTAL}/data/{data_id}/fileData.do")
        page.raise_for_status()
        m = UDDI_RE.search(page.text)
        if not m:
            raise SystemExit(f"{data_id}: 다운로드 버튼이 없다 — 「바로가기」형 데이터셋일 수 있다")
        uddi = m.group(2)

        meta = http.post(
            f"{PORTAL}/tcs/dss/selectFileDataDownload.do",
            headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{PORTAL}/data/{data_id}/fileData.do"},
            data={"publicDataPk": data_id, "publicDataDetailPk": uddi, "atchFileId": "", "fileDetailSn": "1", "publicDataTyCode": "PR0051"},
        )
        meta.raise_for_status()
        fields = dict(JSON_FIELD_RE.findall(meta.text))
        atch = fields.get("atchFileId")
        if not atch:
            raise SystemExit(f"{data_id}: atchFileId를 못 받았다 — 포털 응답 변경 의심")

        url = f"{PORTAL}/cmm/cmm/fileDownload.do?atchFileId={atch}&fileDetailSn={fields.get('fileDetailSn', '1')}&insertDataPrcus=N"
        with http.stream("GET", url) as res:
            res.raise_for_status()
            name = _disposition_name(res.headers.get("content-disposition", "")) or f"{data_id}.bin"
            path = dest_dir / f"{data_id}_{name}"
            with path.open("wb") as f:
                for chunk in res.iter_bytes(1 << 20):
                    f.write(chunk)
    print(f"{data_id} → {path} ({path.stat().st_size:,} bytes)", file=sys.stderr)
    return path


def _disposition_name(header: str) -> str:
    """Content-Disposition 파일명. 포털은 latin1로 실어 보낸다."""
    m = re.search(r'filename="?([^";]+)"?', header)
    if not m:
        return ""
    raw = m.group(1)
    try:
        raw = raw.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return re.sub(r'[\\/:*?"<>|]', "_", raw).strip()


def _zip_name(name: str) -> str:
    """zip 항목명 CP949 복원. 이미 UTF-8로 들어온 항목은 그대로 둔다."""
    try:
        return name.encode("cp437").decode("cp949")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name


IMAGE_MAGIC = ((b"\x89PNG", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF8", "gif"), (b"BM", "bmp"))


def _decode_image(raw: bytes, leaf: str = "") -> tuple[str, bytes] | None:
    """도면 파일 1건 → (확장자, 이미지 바이트). 세 가지 담는 방식을 모두 받는다."""
    for magic, ext in IMAGE_MAGIC:  # 이미지가 통째로 들어 있는 zip(제주개발공사)
        if raw.startswith(magic):
            return leaf.rsplit(".", 1)[-1].lower() if "." in leaf else ext, raw
    text = raw.decode("utf-8", "replace")
    m = DATA_URI_RE.search(text)
    if m:
        return m.group(1), base64.b64decode(m.group(2))
    try:
        image = json.loads(text).get("image") or {}
    except ValueError:
        return None
    data = image.get("data")
    if not data:
        return None
    mime = (image.get("mime") or "image/jpeg").rsplit("/", 1)[-1]
    return mime, base64.b64decode(data)


def extract(archive: Path, dest_dir: Path) -> int:
    """도면 zip → `{단지}/{주택형}.jpg` + index.json.

    기관마다 담는 방식이 다르다. LH는 이미지를 base64로 싸서 `.json` 확장자로 넣고,
    제주개발공사는 png/jpg를 그대로 넣는다. 둘 다 `{단지}/{주택형}` 두 겹 구조라 같이 받는다.
    단지명은 공고 API의 `hsmpNm`과 표기가 달라(괄호 주석·블록 표기) 그대로는 못 붙는다 —
    붙이는 건 다음 단계 일이고, 여기서는 원본 표기를 보존한다.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    index: list[dict] = []
    with zipfile.ZipFile(archive) as z:
        for item in z.namelist():
            if item.endswith("/"):
                continue
            name = _zip_name(item)
            complex_dir, _, leaf = name.partition("/")
            if not leaf:
                continue
            decoded = _decode_image(z.read(item), leaf)
            if not decoded:
                print(f"  건너뜀(이미지 없음): {name}", file=sys.stderr)
                continue
            mime, blob = decoded
            ext = "jpg" if mime in ("jpg", "jpeg") else mime
            # 중간 디렉터리(`01/`)는 주택형 이름에 접어 넣는다. 층·타입 구분이라 버리면 파일이 덮인다.
            style = re.sub(r"^평면_", "", leaf.rsplit(".", 1)[0]).replace("/", " ")
            style = re.sub(r"_?평면$", "", style).strip()
            path = dest_dir / complex_dir / f"{style}.{ext}"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)

            bits = complex_dir.split("_")
            index.append({
                "본부": bits[0],
                "단지": bits[1] if len(bits) > 1 else "",
                "블록": bits[2] if len(bits) > 2 else "",
                "원본표기": complex_dir,
                "주택형": style,
                "파일": str(path.relative_to(dest_dir)).replace("\\", "/"),
                "바이트": len(blob),
            })

    (dest_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    complexes = len({r["원본표기"] for r in index})
    print(f"{archive.name} → {dest_dir}: {complexes}개 단지 {len(index)}장", file=sys.stderr)
    return len(index)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sweep", help="도면 데이터셋 후보 목록을 만든다")
    p_fetch = sub.add_parser("fetch", help="데이터셋 원본을 받는다")
    p_fetch.add_argument("data_id")
    p_ext = sub.add_parser("extract", help="받은 zip을 단지/주택형 이미지로 펼친다")
    p_ext.add_argument("data_id")

    args = ap.parse_args()
    if args.cmd == "sweep":
        rows = sweep(OUT_ROOT / "_candidates.json")
        for c in rows:
            print(f"{c.data_id}  {c.license or '라이선스 미표기':<16}  {c.title}")
        print(f"\n후보 {len(rows)}건 → {OUT_ROOT / '_candidates.json'}", file=sys.stderr)
        return

    if args.cmd == "fetch":
        fetch(args.data_id, OUT_ROOT / "raw")
        return

    hits = sorted((OUT_ROOT / "raw").glob(f"{args.data_id}_*"))
    if not hits:
        raise SystemExit(f"받아 둔 원본이 없다 — 먼저 fetch {args.data_id}")
    extract(hits[-1], OUT_ROOT / "img" / args.data_id)


if __name__ == "__main__":
    main()
