"""pipeline/.env 로드. 값은 절대 로그에 찍지 않는다."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PIPELINE_ROOT = Path(__file__).resolve().parents[2]  # pipeline/
load_dotenv(PIPELINE_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    data_go_kr_key: str
    database_url: str
    scrape_delay_sec: float
    attachment_dir: Path
    juso_summary_db_path: Path
    # 웹 캐시 즉시 비우기 — 둘 다 없으면 조용히 건너뛴다(로컬 개발엔 배포된 웹이 없을 수 있다)
    web_revalidate_url: str
    revalidate_secret: str


def _required(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if not value:
        raise RuntimeError(f"{key} 가 비어 있다. pipeline/.env 를 확인할 것")
    return value


def settings() -> Settings:
    return Settings(
        data_go_kr_key=_required("DATA_GO_KR_KEY"),
        database_url=_required("DATABASE_URL"),
        scrape_delay_sec=float(os.environ.get("SCRAPE_DELAY_SEC", "1.0")),
        attachment_dir=PIPELINE_ROOT / os.environ.get("ATTACHMENT_DIR", "./data/attachments/"),
        juso_summary_db_path=PIPELINE_ROOT / os.environ.get("JUSO_SUMMARY_DB_PATH", "./data/juso/"),
        web_revalidate_url=os.environ.get("WEB_REVALIDATE_URL", "").strip(),
        revalidate_secret=os.environ.get("REVALIDATE_SECRET", "").strip(),
    )
