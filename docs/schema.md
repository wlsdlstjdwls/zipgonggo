# 데이터 스키마

DDL 원본: [`../db/schema.sql`](../db/schema.sql) · 초기 마이그레이션: [`../db/migrations/0001_init.sql`](../db/migrations/0001_init.sql)

## 테이블

| 테이블 | 역할 | 생성 단계 |
|---|---|---|
| `notice` | 입주자모집공고 1건 | S1 |
| `notice_event` | 공고 상태 변경 이력. "정정됨" 배지의 근거 | S2 |
| `raw_snapshot` | 첨부파일 메타 + 해시. 파일 자체는 로컬 | S3 |
| `unit` | 공고 안의 개별 호실. pSEO 페이지의 최소 단위 | S4 |
| `eligibility` | 자격·소득·자산 기준 | S4b |
| `complex` | 단지. 공고와 독립적으로 존재 | API |
| `waitlist` | 예비입주자 대기현황 | API |
| `address_match` | 주소 → 좌표 매칭 결과 | S6 |
| `review_queue` | 검수 큐. 자동 발행 차단분 | S7 |
| `ingest_log` | 수집 이력 | 전 단계 |

## 좌표 컬럼

`geography(Point, 4326)`.

`ST_DWithin`이 미터 단위로 바로 동작해 "이 지점 반경 1km" 질의가 단순하고, 국내 규모에서는 구면 계산 비용이 문제되지 않는다. 미터 정확도가 더 필요해지면 `geometry(Point, 5179)`(Korea 2000 / Unified CS)로 옮긴다.

**`geom`에는 S6의 오프라인 조인 결과만 넣는다.** 지오코딩 API 응답은 저장이 금지돼 있다 → [`data-sources.md`](data-sources.md) §4

## 열거형

| 타입 | 값 |
|---|---|
| `notice_status` | 공고중 · 접수중 · 접수마감 · 정정공고중 *(LH청약플러스 표기 그대로)* |
| `publish_state` | parsed · review · published · closed · rejected |
| `geo_precision` | building · road · dong |
| `housing_type` | 행복주택 · 국민임대 · 매입임대 · 장기전세 · 통합공공임대 · 전세임대 · 든든전세 · 영구임대 · 공공지원민간임대 |

## 주요 컬럼

### `notice`

| 컬럼 | 의미 |
|---|---|
| `slug` | URL 식별자. `sh-2026-02-maeip` |
| `fingerprint` | 기관+공고명+게시일 해시. 여러 소스에서 같은 공고를 받아도 한 행으로 모은다 |
| `apply_end_at` | 마감일. D-day 카운터의 근거 |
| `announce_at` | 발표일. **서울주거포털 SH 목록에만 있고 LH 목록에는 없다** |
| `publish` | 마감돼도 삭제하지 않고 `closed`로 둔다. URL을 죽이지 않는다 |

### `unit`

| 컬럼 | 의미 |
|---|---|
| `unit_key` | 공고 내 호실 식별자. URL 마지막 세그먼트 |
| `deposit` / `rent` | 기본 보증금·월임대료(원) |
| `deposit_jeonse` / `deposit_wolse` | 전세전환·월세전환 보증금 |
| `field_count` | 채워진 고유 필드 수. **8 이상**이어야 색인 |
| `geo_precision` | **`building`일 때만 색인** |

`unit_publishable` 제약이 이 두 조건을 DB 레벨에서 강제한다 — 얇은 페이지가 실수로 발행되지 않는다.

### `raw_snapshot`

`file_hash`가 바뀌면 정정공고다. `notice_event.attachment_replaced`를 발생시킨다.

### `review_queue`

`reject_reason`은 파서 개선 입력으로 되돌린다. 반려가 쌓이면 그 기관 파서를 손봐야 한다는 신호다.

## 인덱스

| 인덱스 | 조회 패턴 |
|---|---|
| `idx_notice_apply_end` | 마감 임박순 정렬 |
| `idx_notice_sido_type` | 지역×유형 페이지 |
| `idx_unit_region` | 지역 페이지 |
| `idx_unit_deposit` / `idx_unit_area` | 보증금·면적 필터 |
| `idx_unit_geom` / `idx_complex_geom` (GIST) | 지도 바운딩박스·반경 검색 |
| `idx_review_pending` | 미해결 검수 큐 |

발행 대상만 조회하는 인덱스는 전부 `WHERE publish = 'published'` 부분 인덱스다. `parsed`·`review` 행이 인덱스를 부풀리지 않는다.
