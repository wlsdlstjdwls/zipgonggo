"""도로명주소 조회키 파서. 공고문 표기가 제각각이라 여기가 매칭률을 좌우한다."""

from zipgonggo_pipeline.geo.roadaddr import parse_dong, parse_road_address


def key(text):
    k = parse_road_address(text)
    return None if k is None else (k.sido, k.sigungu, k.road_name, k.underground, k.main_no, k.sub_no)


def test_시도부터_적힌_표기():
    assert key("서울특별시 종로구 자하문로 94") == ("서울특별시", "종로구", "자하문로", False, 94, 0)


def test_시군구부터_시작하는_공고_표기():
    # notice_complex.road_address는 시도를 떼고 저장한다
    assert key("강남구 논현로28길 12-3") == (None, "강남구", "논현로28길", False, 12, 3)


def test_건물명과_동호수는_버린다():
    assert key("서초구 반포대로 58, 101동 501호") == (None, "서초구", "반포대로", False, 58, 0)
    assert key("경기도 수원시 장안구 정조로 940 (영화동)") == ("경기도", "수원시 장안구", "정조로", False, 940, 0)


def test_도로명과_건물번호를_붙여_쓴_표기():
    # SH 공고문에 이 표기가 섞여 온다. 안 가르면 도로명을 못 찾는다
    assert key("강서구 강서로18길121-18") == (None, "강서구", "강서로18길", False, 121, 18)
    assert key("양천구 곰달래로15") == (None, "양천구", "곰달래로", False, 15, 0)


def test_도로명을_띄어_쓴_표기():
    assert key("인천 미추홀구 인하로 100번길 3") == ("인천광역시", "미추홀구", "인하로100번길", False, 3, 0)


def test_지하():
    assert key("서울특별시 종로구 자하문로 지하 94") == ("서울특별시", "종로구", "자하문로", True, 94, 0)
    assert key("강서구 공항대로 지하265") == (None, "강서구", "공항대로", True, 265, 0)


def test_시도_축약형():
    assert key("서울 중구 세종대로 110")[0] == "서울특별시"
    assert key("전북 전주시 완산구 팔달로 100")[0] == "전북특별자치도"


def test_세종은_시군구가_없다():
    assert key("세종특별자치시 한누리대로 2130") == ("세종특별자치시", None, "한누리대로", False, 2130, 0)


def test_도로명주소가_아니면_None():
    assert key("단지명만 있음") is None
    assert key("금천구 시흥동 108-3") is None
    assert key(None) is None


def test_지번주소에서_법정동만_건진다():
    assert parse_dong("금천구 시흥동 108-3") == (None, "금천구", "시흥동")
    assert parse_dong("동대문구 휘경동 172번지 일대") == (None, "동대문구", "휘경동")
    assert parse_dong("강남구 일원동 741 래미안 개포 루체하임") == (None, "강남구", "일원동")
    # 도로명주소는 여기 걸리면 안 된다
    assert parse_dong("서울특별시 종로구 자하문로 94") is None
