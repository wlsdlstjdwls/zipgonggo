# 마이그레이션

## 네이밍

```
NNNN_설명.sql        0001_init.sql · 0002_add_waitlist_index.sql
```

- `NNNN` 4자리 일련번호, 1부터
- 설명은 영문 snake_case
- **한 파일은 한 번만 적용된다.** 이미 적용된 파일은 수정하지 않고 새 파일을 만든다.
  `db/migrate.py --status`가 적용 후 바뀐 파일을 `DRIFT`로 잡는다

## 적용

```powershell
python db\migrate.py            # 미적용 파일 순차 적용
python db\migrate.py --status   # 적용 현황
```

- 접속 문자열: 환경변수 `DATABASE_URL` 또는 `pipeline/.env`의 값. **direct(unpooled)** 문자열을 쓴다
- 이력은 `schema_migrations` 테이블(파일명·sha256·적용시각)
- 한 파일 = 한 트랜잭션. 중간에 실패하면 그 파일 전체가 롤백된다
- psql이 있으면 `psql $env:DATABASE_URL -f .\db\migrations\0001_init.sql`도 되지만 이력이 안 남는다

## `schema.sql`과의 관계

`db/schema.sql`은 **현재 스키마의 전체 모습**이다. 마이그레이션을 새로 추가하면 `schema.sql`도 같이 갱신한다.
신규 환경 구축은 `schema.sql` 한 번, 기존 환경 갱신은 마이그레이션 순차 적용.
`0001_init.sql`은 `schema.sql`과 바이트 단위로 같다.

## 목록

| 파일 | 내용 | 적용 |
|---|---|---|
| `0001_init.sql` | 초기 스키마 — notice · notice_event · raw_snapshot · complex · complex_type · unit · eligibility · waitlist · address_match · review_queue · ingest_log. 마이홈 API 실호출 필드 반영본 | Neon 2026-09-08 |
| `0002_notice_area.sql` | `notice_area` — 공고의 시군구별 공급호수. API가 매입·전세임대 공고를 시군구별 행으로 쪼개 줌 | Neon 2026-09-08 |
| `0003_fingerprint_comment.sql` | fingerprint 정의에 원공고키 포함 (주석) | Neon 2026-09-08 |
| `0004_sector.sql` | `rental_sector` enum + `notice.sector` — 공공/민간 구분 | Neon 2026-09-08 |
| `0005_fingerprint_not_unique.sql` | fingerprint UNIQUE 해제 — 2차 정정공고가 1차와 지문이 같음 | Neon 2026-09-08 |
| `0006_housing_type_sh.sql` | `housing_type`에 재개발임대·청년안심주택 추가 (SH 청약유형) | Neon 2026-09-08 |
| `0007_notice_complex.sql` | `notice_complex` — 공고별 공급 단지(단지명·자치구·도로명주소·신규). SH 첨부 공고문 표를 S3가 적재. 좌표 없음 | Neon 2026-09-08 |
| `0008_notice_complex_units.sql` | `notice_complex`에 complex_code·unit_count·min_deposit·min_rent·area_min·area_max — SH 매입임대 별첨 주택목록(호실 단위) 집계 | Neon 2026-09-08 |
| `0009_notice_deposit_range.sql` | `notice`에 max_deposit·max_rent — 하한만 있던 금액을 범위로. 화면은 "2.6억~11.7억" | Neon 2026-09-08 |
| `0010_notice_source_rank.sql` | `notice.source_rank` — 기관 목록에서의 순번. 같은 공고일 안 정렬용 | Neon 2026-09-08 |
| `0011_notice_supply.sql` | `notice_supply` — 공급현황 표 한 줄(단지 × 공급유형 × 계층 × 소득옵션). 공가·예비·우선/일반·계층별 금액 | Neon 2026-09-08 |
| `0012_notice_complex_heating.sql` | `notice_complex.heating` — 「단지별 주소」 표의 난방방식 열 | Neon 2026-09-08 |
| `0013_notice_index_drop_dead_predicate.sql` | 죽어 있던 부분 인덱스 되살리기 — publish='published' 조건이 한 행도 안 맞았다 | Neon 2026-09-09 |
| `0014_notice_result.sql` | `result_post` · `notice_result` — i-sh 결과 글(경쟁률 게시·당첨자 발표) 원장과 결과 표 줄. 과거 경쟁률·합격선의 원천 | 미적용 |
| `0015_notice_result_supply_kind.sql` | `notice_result.supply_kind` + UNIQUE 재정의 — 재공급/신규공급이 키에 없어 줄이 사라졌다 | 미적용 |
| `0016_notice_result_row_identity.sql` | `notice_result`에 address·row_no, UNIQUE를 (게시글, 줄 번호)로 — 이름이 같은 건물 때문에 자연키로는 줄이 사라졌다 | 미적용 |
| `0017_notice_schedule_steps.sql` | `notice.schedule_steps` — 일정 흐름도의 서류심사·서류제출·계약 단계 | Neon 2026-09-09 |
| `0018_notice_apply_time.sql` | `notice`에 접수 시작·마감 시각 — 흐름도에 시각까지 적혀 있다 | Neon 2026-09-09 |
| `0019_notice_complex_geom.sql` | `notice_complex`에 geom·geo_precision·geo_matched_by·geo_matched_at, `complex`에 매칭 출처 2칸 — S6 오프라인 주소-좌표 조인 결과 자리 | Neon 2026-09-09 |
| `0020_eligibility_rules.sql` | `supply_type` · `income_standard` · `region_tier` — 공고와 무관한 제도 규칙(32개 공급유형 자격·배점, 도시근로자 소득기준, 지역등급). `/eligibility` 자격진단의 원천 | Neon 2026-09-09 |
| `0023_sh_house_image.sql` | `sh_house_image` + `notice_complex.sh_bizns_cd` — SH주택정보 단지 이미지(평면도·전경·배치도·실내). 공고가 아니라 단지에 붙는다 | Neon 2026-09-14 |
| `0021_unit_from_attachment.sql` | 첨부 「[별첨] 주택목록」의 호실을 `unit`에 적재 — 공고 첨부가 원천인 호실 자리 | Neon 2026-09-10 |
| `0022_notice_canonical.sql` | `notice.canonical_id` — 같은 공고가 기관 seq 탓에 세 URL로 갈라지던 걸 정본 하나로 모은다 | Neon 2026-09-10 |
| `0024_notice_eligibility.sql` | `notice_eligibility` — 공고문에서 읽은 신청자격 묶음(소득 매트릭스·선정순서·배점표) jsonb. 공고당 1행 | Neon 2026-09-14 |
| `0025_notice_supply_deposit_options.sql` | `notice_supply.deposit_options` jsonb — 민간임대 공고문의 보증금 비율별 (보증금, 월임대료) 옵션 | Neon 2026-09-15 |
| `0026_youth_house_image.sql` | `youth_house_image` + `notice_complex.youth_home_code` — 청년안심주택 포털 단지 이미지 | Neon 2026-09-15 |
| `0027_youth_house.sql` | `youth_house` — 포털 단지 사실(관리비·운영사·입주예정일). 공고문 첨부에 없는 값 | Neon 2026-09-15 |
| `0028_notice_indexnow.sql` | `notice.indexnow_at` · `indexnow_hash` — 공고 URL의 IndexNow 제출 이력. updated_at 대신 내용 해시를 신호로 | Neon 2026-09-16 |
| `0029_page_view.sql` | `page_view` — 방문 집계. web이 직접 쓰는 유일한 표(`/api/track`) | Neon 2026-09-16 |
| `0030_indexnow_url.sql` | `indexnow_url` — 공고 아닌 발행 URL(단지/유형/지역)의 IndexNow 제출 이력. 대상은 배포된 sitemap.xml에서 읽는다 | Neon 2026-09-16 |
