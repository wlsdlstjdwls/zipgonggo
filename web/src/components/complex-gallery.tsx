"use client";

// 단지 사진과 도면 (0023). 출처는 SH주택정보 — 공고문 PDF에는 도면이 한 장도 없다(docs/data-sources.md §2c).
//
// 한 영역, 한 줄. 종류를 세로로 쌓으니 평면도·전경·배치도·실내 네 덩이가 지면을 다 먹었다(사용자 지적 2026-09-14).
// 종류는 탭으로 가르고 한 번에 한 줄만 보인다. 「이 공고에 없는 주택형」도 맨 끝 탭으로 들어와 영역이 하나다.
// 탭이 종류를 말하므로 캡션은 그 안에서 서로를 가르는 것만 진다(`실내` 탭이면 `84A 거실`이 아니라 `거실`).
//
// 줄은 손으로 끌어 넘긴다. 터치는 브라우저 기본 스크롤이 낫고, 마우스는 그게 안 돼(끌면 글자만 선택된다)
// 포인터로 직접 scrollLeft를 민다. 누르면 전체화면 뷰어에서 확대까지 한다(photo-viewer.tsx).
//
// "use client"지만 첫 그림은 서버에서 나온다 — 크롤러가 <img>를 본다(pSEO). 클라이언트에서 사진을
// 불러오지 않는 게 핵심이지 클라이언트 컴포넌트를 안 쓰는 게 핵심이 아니다.
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoViewer } from "@/components/photo-viewer";
import { caption, groupByKind, imageSrc, sortedTypes, splitImages } from "@/lib/complex-images";
import type { ComplexImage } from "@/types/notice";

// 「이 공고에 없는 주택형」 탭의 이름. 종류 이름과 섞이지 않게 이 값 하나로 가른다
const OTHERS_TAB = "다른 주택형";

// 이만큼 움직여야 「끈 것」으로 친다. 3px은 클릭 중 손 떨림에 걸려 사진 열기를 통째로 삼켰다(사용자 지적 2026-09-14)
const DRAG_SLOP_PX = 6;

function Strip({
  images, biznsCd, complexName, mixed, active, onOpen,
}: {
  images: ComplexImage[]; biznsCd: string; complexName: string; mixed: boolean;
  /** 숨은 탭은 폭이 0이라 끝을 잴 수 없다. 보이게 된 뒤에 다시 재려고 받는다 */
  active: boolean;
  onOpen: (i: number) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  // 끄는 동안은 scroll-snap을 끈다. 켜 둔 채 scrollLeft를 조금씩 밀면 브라우저가 매번 스냅점으로
  // 되돌려 한 칸 폭을 한 번에 넘지 않는 한 제자리다 — 실측 8·16·24px 모두 0으로 복귀(사용자 지적 2026-09-14)
  const [dragging, setDragging] = useState(false);
  // 누르기 시작한 칸. click의 target으로는 못 찾는다 — 아래 onClick 주석 참고
  const pressed = useRef<number | null>(null);
  // 끌고 나서 손을 떼면 click이 따라온다. 그걸 사진 열기로 오해하지 않으려는 표시
  const dragged = useRef(false);
  // 줄 양끝에 더 있는지. 끌 수 있다는 걸 눈으로 알려 주지 않으면 「안 끌린다」로 읽힌다(사용자 지적 2026-09-14)
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, images, active]);

  // 끌기는 window에서 받되 **pointerdown 안에서 곧장 붙인다.** useEffect로 달면 안 된다 —
  // effect는 비동기라 등록되기 전에 pointermove가 지나가고, 그러면 줄이 한 방향으로 간 뒤 안 돌아온다
  // (실측: 왼쪽 490px은 먹고 오른쪽 500px은 통째로 유실 = 「맨 끝에서 고정」).
  //
  // 줄에 setPointerCapture는 걸지 않는다. 크롬이 그 뒤의 마우스 이벤트를 잡은 요소로 돌려서
  // click이 칸의 <button>에 닿지 않는다. 캡처 없이 window로 받으면 커서가 줄 밖으로 나가도 끌린다.
  const drag = useRef<(() => void) | null>(null);
  useEffect(() => () => drag.current?.(), []);

  const beginDrag = (x0: number, left0: number) => {
    drag.current?.();
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const before = el.scrollLeft;
      el.scrollLeft = left0 - dx;
      // 문턱을 포인터 이동만으로 잡으면 더 갈 데가 없는 끝에서 헛손질까지 「끈 것」이 된다.
      // 실제로 줄이 움직였을 때만 클릭을 삼킨다
      if (Math.abs(dx) > DRAG_SLOP_PX && el.scrollLeft !== before) dragged.current = true;
    };
    const end = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    drag.current = end;
    setDragging(true);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    const li = (e.target as HTMLElement | null)?.closest?.("li");
    pressed.current = li ? [...(ref.current?.children ?? [])].indexOf(li) : null;
    dragged.current = false;
    // 터치는 브라우저 기본 스크롤이 낫다(관성이 있다). 마우스는 그게 안 돼서 직접 민다
    if (e.pointerType === "touch") return;
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    beginDrag(e.clientX, el.scrollLeft);
  };

  // 열기는 칸의 <button>이 아니라 **줄**에서 받는다. 캡처를 걷어냈어도 click의 target은 브라우저와
  // 입력 방식에 따라 흔들린다(끌다 놓으면 공통 조상으로 간다). 누른 칸을 pointerdown에서 적어 두면
  // target이 어디로 가든 무엇을 열지 안다. 키보드 Enter는 pointerdown이 없으니 target으로 찾는다
  const onClick = (e: React.MouseEvent<HTMLUListElement>) => {
    if (dragged.current) { dragged.current = false; return; }
    const li = (e.target as HTMLElement | null)?.closest?.("li");
    const i = li ? [...(ref.current?.children ?? [])].indexOf(li) : pressed.current;
    if (i !== null && i >= 0) onOpen(i);
  };

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="gal-rail">
      <ul
        className={`gal-strip${dragging ? " dragging" : ""}`} ref={ref} onScroll={measure}
        onPointerDown={onPointerDown} onClick={onClick}
      >
        {images.map((img, i) => {
          const text = caption(img, mixed);
          return (
            <li key={img.file_name}>
              <button type="button">
                {/* 원본 크기를 저장하지 않아 next/image를 못 쓴다. 지연 로딩만 걸어 둔다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageSrc(biznsCd, img)}
                  alt={`${complexName} ${text || img.kind} ${img.kind}`}
                  loading="lazy" decoding="async" draggable={false}
                />
                {text && <span>{text}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {(edge.left || edge.right) && (
        <>
          <button type="button" className="gal-arrow prev" onClick={() => nudge(-1)} disabled={!edge.left} aria-label="왼쪽으로">‹</button>
          <button type="button" className="gal-arrow next" onClick={() => nudge(1)} disabled={!edge.right} aria-label="오른쪽으로">›</button>
        </>
      )}
    </div>
  );
}

export function ComplexGallery({
  images, biznsCd, complexName, supplyTypes,
}: {
  images: ComplexImage[]; biznsCd: string; complexName: string;
  /** 이 공고가 이 단지에서 공급하는 주택형(`84`·`84S`). 비어 있으면 가를 근거가 없으니 전부 보인다 */
  supplyTypes: string[];
}) {
  const { primary, others } = splitImages(images, supplyTypes);
  const groups = groupByKind(primary);
  const tabs: [string, ComplexImage[]][] = others.length
    ? [...groups, [OTHERS_TAB, groupByKind(others).flatMap(([, l]) => l)]]
    : groups;

  const [tab, setTab] = useState(tabs[0]?.[0] ?? "");
  const [open, setOpen] = useState<number | null>(null);

  const current = tabs.find(([kind]) => kind === tab) ?? tabs[0];
  if (!current) return null;
  const [kind, list] = current;
  const mixed = kind === OTHERS_TAB;
  // 뷰어는 지금 탭 안에서만 넘긴다 — 탭을 갈라 놓고 넘기기로 넘나들면 가른 뜻이 없어진다.
  // 뷰어에는 탭 이름이 없으니 종류를 라벨에 넣어 준다(「다른 주택형」 탭은 캡션이 이미 종류를 지고 있다)
  const slides = list.map((img) => ({
    src: imageSrc(biznsCd, img),
    label: mixed ? caption(img, true) : [img.kind, caption(img)].filter(Boolean).join(" "),
  }));

  return (
    <div className="gal">
      <div className="gal-tabs" role="tablist">
        {tabs.map(([name, imgs]) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={name === kind}
            className={`gal-tab${name === kind ? " on" : ""}${name === OTHERS_TAB ? " alt" : ""}`}
            onClick={() => { setTab(name); setOpen(null); }}
          >
            {name} <span className="gal-n">{imgs.length}</span>
          </button>
        ))}
      </div>

      {/* 안 고른 탭도 그려 두고 숨기기만 한다 — DOM에서 빼면 크롤러가 그 사진들을 못 본다(pSEO) */}
      {tabs.map(([name, imgs]) => (
        <div key={name} hidden={name !== kind}>
          <Strip
            images={imgs} biznsCd={biznsCd} complexName={complexName}
            mixed={name === OTHERS_TAB} active={name === kind} onOpen={setOpen}
          />
        </div>
      ))}

      {mixed ? (
        <p className="note">
          같은 단지의 다른 주택형입니다({sortedTypes(others).join(", ")}). 공고는 단지마다 일부 형만 공급하는데
          SH주택정보는 단지에 있는 형을 모두 주기 때문에 남는 것들입니다. 이 공고로 신청할 수 있는 형이 아닙니다.
        </p>
      ) : (
        <p className="note">
          서울주택도시공사 SH주택정보에 공개된 자료입니다. 도면과 조감도는 이해를 돕기 위한 것으로 실제와 다를 수 있고,
          동·호수에 따라 평면이 좌우 대칭으로 적용될 수 있습니다(공고문 「단지별 유의사항」).
        </p>
      )}

      {open !== null && (
        <PhotoViewer slides={slides} index={open} onIndex={setOpen} onClose={() => setOpen(null)} title={complexName} />
      )}
    </div>
  );
}
