# 데이터 스키마

DDL 원본: [`../db/schema.sql`](../db/schema.sql) · 초기 마이그레이션: [`../db/migrations/0001_init.sql`](../db/migrations/0001_init.sql)

2026-09-08 마이홈포털 API 실호출 결과([`api-spec/`](api-spec/))에 맞춰 개정하고 Neon에 적용했다.
API 필드 ↔ 컬럼 대응은 각 컬럼 주석에 `(API xxx)`로 적어 뒀다.

## 테이블

| 테이블 | 역할 | 생성 단계 |
|---|---|---|
| `notice` | 입주자모집공고 1건 | S1 |
| `notice_event` | 공고 상태 변경 이력. "정정됨" 배지의 근거 | S2 |
| `notice_area` | 공고의 시군구별 공급호수. API가 쪼개 준 행의 합 | S1 |
| `raw_snapshot` | 첨부파일 메타 + 해시. 파일 자체는 로컬 | S3 |
| `unit` | 공고 안의 개별 호실. pSEO 페이지의 최소 단위 | S4 |
| `eligibility` | 자격·소득·자산 기준 | S4b |
| `complex` | 단지. 공고와 독립적으로 존재 | API |
| `complex_type` | 단지 × 형(면적 타입). 단지정보 API의 실제 행 단위 | API |
| `waitlist` | 예비입주자 대기현황 | API |
| `address_match` | 주소 → 좌표 매칭 결과 | S6 |
| `review_queue` | 검수 큐. 자동 발행 차단분 | S7 |
| `ingest_log` | 수집 이력 | 전 단계 |
| `schema_migrations` | `db/migrate.py`가 관리하는 적용 이력 | — |

## API가 준 것과 안 준 것

실호출로 확정한 사실이 스키마를 정했다.

| 사실 | 스키마 반영 |
|---|---|
| 좌표 필드 없음 (3종 전부) | `geom`은 S6 오프라인 조인 결과만. 변경 없음 |
| `pnu`(19자리) 제공 — 모집공고·단지정보 | `notice.pnu` `complex.pnu` `address_match.pnu`. 도로명 매칭 실패 시 필지 보조키 |
| 매입임대 공고는 주소·단지명·시군구가 빈 문자열 | `notice.sigungu` `address` `complex_name` 전부 nullable |
| `rentGtn` `mtRntchrg`는 공고 내 **최소값** | `notice.min_deposit` `min_rent`. 호실 금액은 `unit`에만 |
| 단지정보 API 행 = 단지 × 형(`styleNm`) | `complex`(단지 속성) + `complex_type`(형별 면적·보증금) 분리 |
| `hsmpSn`이 단지정보·대기현황 공통 키 | `complex.complex_code` = `hsmpSn`. `waitlist.complex_code`로 단지 미수집 상태에서도 적재 |
| 대기현황 `waitCo`는 대기자 **수**, 순번 아님 | `waitlist.waiting_cnt` + `vacated_cnt`(퇴거건수). 화면은 "N명 대기" |
| 모집공고 API는 현재 공고만 (2024 이전 NODATA) | `notice.source`로 `myhome_api` / `myhome_file`(15088707 백필) 공존 |
| 정정공고는 `beforePblancId`로 원 공고를 가리킴 | `notice.amends_source_key` |
| 발표일 `przwnerPresnatnDe` 제공 | `notice.announce_at`. "SH에만 있다"던 이전 가정 폐기 |

**원본 보존**: `notice` `complex` `complex_type` `waitlist`에 `raw jsonb`. 응답 1건 약 1KB, 연 수천 건 규모라 무료 티어(0.5GB)에 무의미한 크기다. 컬럼을 나중에 추가해도 재수집 없이 `raw`에서 채운다. 첨부파일 본문은 여기에도 넣지 않는다.

## 좌표 컬럼

`geography(Point, 4326)`.

`ST_DWithin`이 미터 단위로 바로 동작해 "이 지점 반경 1km" 질의가 단순하고, 국내 규모에서는 구면 계산 비용이 문제되지 않는다. 미터 정확도가 더 필요해지면 `geometry(Point, 5179)`(Korea 2000 / Unified CS)로 옮긴다.

**`geom`에는 S6의 오프라인 조인 결과만 넣는다.** 지오코딩 API 응답은 저장이 금지돼 있다 → [`data-sources.md`](data-sources.md) §4

## 열거형

| 타입 | 값 |
|---|---|
| `notice_status` | 공고중 · 접수중 · 접수마감 · 정정공고중 *(일정·정정 여부로 파이프라인이 도출. 출처 원문 값은 `notice.source_status`)* |
| `publish_state` | parsed · review · published · closed · rejected |
| `rental_sector` | 공공임대 · 민간임대 *(홈 탭 구분. 공공지원민간임대·청년안심주택은 민간)* |
| `geo_precision` | building · road · dong |
| `housing_type` | 행복주택 · 국민임대 · 매입임대 · 장기전세 · 통합공공임대 · 전세임대 · 든든전세 · 영구임대 · 공공지원민간임대 · 50년임대 · 10년임대 · 6년임대 · 5년임대 · 공공기숙사 *(마이홈 공급유형 코드표와 1:1, 든든전세만 HUG 자체)* |

## 주요 컬럼

### `notice`

| 컬럼 | 의미 |
|---|---|
| `slug` | URL 식별자. `sh-2026-02-maeip` |
| `fingerprint` | sha256(기관·공고명·게시일·주택일련번호·원공고키). 소스 간 같은 공고 **후보**를 묶는 힌트. **UNIQUE 아님** — 같은 원공고의 2차 정정이 1차와 겹친다(실측). 식별자는 `source_key` |
| `source` / `source_key` | 출처와 출처 내 키. 마이홈 API는 `pblancId:houseSn` |
| `amends_source_key` | 정정공고가 대체하는 원 공고. API는 정정공고와 원공고를 **둘 다** 현재 공고로 준다(실측 23쌍). 둘 다 행으로 두고 화면에서 연결한다 |
| `housing_type` / `house_type` | 공급유형(enum) / 주택유형(아파트·다가구·오피스텔…) |
| `sector` | 공공임대 / 민간임대. S1이 공급유형에서 도출, 스크래퍼는 소스별 고정 |
| `supply_count` / `unit_count` | API가 말한 공급호수(= `notice_area` 합) / 파서가 실제로 뽑은 호실 수. 둘이 크게 다르면 검수 큐 |
| `sigungu` | 시군구가 하나면 값, 여러 시군구에 걸치면 NULL. 내역은 `notice_area` |
| `min_deposit` / `min_rent` | 공고 내 최소 보증금·월임대료. **호실 금액이 아니다** |
| `apply_end_at` | 마감일. D-day 카운터의 근거 |
| `announce_at` | 당첨자 발표일 |
| `portal_url` | 마이홈포털 상세. `source_url`은 기관 원문 |
| `publish` | 마감돼도 삭제하지 않고 `closed`로 둔다. URL을 죽이지 않는다 |

### `complex` · `complex_type`

| 컬럼 | 의미 |
|---|---|
| `complex.complex_code` | 마이홈 `hsmpSn`. 대기현황과 조인하는 키 |
| `complex.lh_code` | LH 파일데이터 15080989 단지코드. 동수(`building_cnt`)는 여기서만 온다 |
| `complex.name` | 매입임대는 `서울특별시 종로구`처럼 지역명이 온다. slug 생성 시 주의 |
| `complex_type.style_name` | 형명 `36` `39` `59A`. 같은 단지에 공급유형이 섞일 수 있어 `(complex_id, housing_type, style_name)` 유니크 |
| `complex_type.base_deposit` / `base_rent` | 형별 기본 보증금·임대료. 호실이 없어도 단지 페이지에 표를 만든다 |

### `waitlist`

| 컬럼 | 의미 |
|---|---|
| `complex_code` | `hsmpSn`. `complex_id`는 nullable — 단지정보를 시군구별로 아직 못 받았어도 대기현황은 먼저 쌓는다 |
| `style_name` / `draw_unit` | 형명 / 추첨단위 |
| `waiting_cnt` / `vacated_cnt` | 입주대기자 수 / 퇴거 건수 |
| `surveyed_on` | 수집일. API에 기준일 필드가 없다 |

### `unit`

| 컬럼 | 의미 |
|---|---|
| `unit_key` | 공고 내 호실 식별자. URL 마지막 세그먼트 |
| `deposit` / `rent` | 기본 보증금·월임대료(원) |
| `deposit_jeonse` / `deposit_wolse` | 전세전환·월세전환 보증금 |
| `field_count` | 채워진 고유 필드 수. **8 이상**이어야 색인 |
| `geo_precision` | **`building`일 때만 색인** |

`unit_publishable` 제약이 이 두 조건을 DB 레벨에서 강제한다 — 얇은 페이지가 실수로 발행되지 않는다.

### `address_match`

`normalized_addr`(도로명) 우선, 실패 시 `pnu`로 재시도. `matched_by`에 어느 키로 붙었는지 남긴다.

### `raw_snapshot`

`file_hash`가 바뀌면 정정공고다. `notice_event.attachment_replaced`를 발생시킨다.

### `review_queue`

`reject_reason`은 파서 개선 입력으로 되돌린다. 반려가 쌓이면 그 기관 파서를 손봐야 한다는 신호다.

## 인덱스

| 인덱스 | 조회 패턴 |
|---|---|
| `idx_notice_apply_end` | 마감 임박순 정렬 |
| `idx_notice_sido_type` | 지역×유형 페이지 |
| `idx_notice_pnu` / `idx_complex_pnu` / `idx_address_match_pnu` | 필지 키 조인 (부분 인덱스) |
| `idx_unit_region` | 지역 페이지 |
| `idx_unit_deposit` / `idx_unit_area` | 보증금·면적 필터 |
| `idx_unit_geom` / `idx_complex_geom` (GIST) | 지도 바운딩박스·반경 검색 |
| `idx_complex_type_complex` | 단지 페이지 형별 표 |
| `idx_waitlist_complex` | 단지별 최신 대기현황 |
| `idx_review_pending` | 미해결 검수 큐 |

발행 대상만 조회하는 인덱스는 전부 `WHERE publish = 'published'` 부분 인덱스다. `parsed`·`review` 행이 인덱스를 부풀리지 않는다.

## 적용 현황

| 환경 | 상태 |
|---|---|
| Neon `zipgonggo-db` (ap-southeast-1, PG 18.6, PostGIS 3.6) | `0001`~`0003` 적용 완료 2026-09-08. S1 첫 적재 176건 |
