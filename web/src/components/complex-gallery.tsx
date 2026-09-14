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

// 끝에서 더 끌면 줄이 고무줄처럼 조금 따라왔다가 되돌아온다. scrollLeft는 0 밑으로 못 가서, 이게 없으면
// 맨 앞에서 오른쪽으로 끄는 순간 화면이 죽은 듯 서 있다 — 줄을 처음 잡으면 대개 그 상황이라 「항상 안 끌린다」로
// 읽힌다(사용자 지적 2026-09-14). 끈 거리에 비례해 **상한 없이** 따라온다 — fitin 주간 스트립은 44px에서
// 멈추지만 여기선 그게 「조금 가다 막힌다」로 느껴졌다(사용자 지적 2026-09-14). 놓으면 제자리로 돌아온다
const RUBBER_RATIO = 0.5;
const RUBBER_BACK = "transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)";

// 개발 화면에서만 계측 줄을 그린다
const DEV = process.env.NODE_ENV !== "production";

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
  // 넘치지 않는 줄은 끌 것이 없다. 그런 줄에까지 손바닥 커서를 주면 「끌리는데 안 먹는다」로 읽힌다
  // (사용자 지적 2026-09-14 — 실제로 끌던 줄이 4장짜리였다)
  // fits는 「재 봤더니 안 넘친다」다. over의 반대가 아니라 **재기 전에는 둘 다 false**여야 한다 —
  // 재기 전에 가운데로 모아 두면, 넘치는 줄에서 첫 칸이 왼쪽으로 밀려 나가 스크롤로도 못 돌아온다
  const [edge, setEdge] = useState({ left: false, right: false, over: false, fits: false });
  // 개발 화면 전용 계측. 끌기가 **어디서** 죽는지 사용자 브라우저에서 직접 읽으려고 둔다.
  // 프로덕션 빌드에는 한 줄도 안 들어간다(DEV로 가른다). 원인을 잡으면 지운다
  const [trace, setTrace] = useState("");
  const tally = useRef({ pm: 0, mm: 0, cancel: 0, dragstart: 0, from: 0 });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 4;
    setEdge({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      over,
      fits: !over,
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, images, active]);

  // 끌기는 **fitin-app의 useSwipeCommit과 같은 뼈대**로 받는다 — 그쪽 데스크탑 예약 화면에서
  // 실제로 굴러가는 방식이다(사용자 지시 2026-09-14). window에 capture 리스너를 달던 옛 방식은
  // 내 쪽 브라우저에서는 멀쩡한데 사용자 브라우저에서 계속 죽었다. 요점 셋:
  //  1. 이벤트는 줄(ul) 자신에게서 받는다 — 중간에 끼어들 계층이 없다
  //  2. setPointerCapture를 **움직인 뒤에** 건다. 누르자마자 걸면 click이 칸에 닿지 않아 사진 열기가 죽고,
  //     끝까지 안 걸면 커서가 줄 밖으로 나가는 순간 끌기가 끊긴다. 8px 움직여 가로로 확정된 뒤가 답이다
  //  3. 마우스는 pointerdown에서 preventDefault — 글자 선택과 그림 끌기(고스트)를 처음부터 막는다
  const drag = useRef({ id: -1, x0: 0, y0: 0, left0: 0, active: false, axis: null as null | "x" | "y" });

  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    const el = ref.current;
    const li = (e.target as HTMLElement | null)?.closest?.("li");
    pressed.current = li ? [...(el?.children ?? [])].indexOf(li) : null;
    dragged.current = false;
    if (DEV) {
      tally.current = { pm: 0, mm: 0, cancel: 0, dragstart: 0, from: el?.scrollLeft ?? 0 };
      setTrace(`down ${e.pointerType}/btn${e.button}/primary${e.isPrimary ? 1 : 0} | 줄 ${el?.scrollWidth ?? 0}/${el?.clientWidth ?? 0}`
        + (e.pointerType === "touch" ? " | 터치는 브라우저에 맡김" : "")
        + (el && el.scrollWidth <= el.clientWidth ? " | 안 넘쳐서 끌 것 없음" : ""));
    }
    // 마우스는 좌클릭만, 손가락이 여럿이면 첫 손가락만
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    // 터치는 브라우저 기본 스크롤이 낫다(관성이 붙는다). 마우스는 그게 안 돼서 직접 민다
    if (e.pointerType === "touch") return;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, left0: el.scrollLeft, active: true, axis: null };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d.active || !el || e.pointerId !== d.id) return;
    if (DEV) tally.current.pm += 1;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    // 축이 정해지기 전에는 아무것도 하지 않는다 — 세로로 그으면 지면 스크롤을 뺏지 않고 물러난다
    if (d.axis === null) {
      if (Math.abs(dx) < DRAG_SLOP_PX && Math.abs(dy) < DRAG_SLOP_PX) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "y") { d.active = false; return; }
      try { el.setPointerCapture(e.pointerId); } catch { /* 이미 뗀 포인터 — 캡처 없이도 계속 간다 */ }
      // 되돌아오는 중이던 고무줄이 있으면 그 자리에서 다시 잡는다
      el.style.transition = "";
      setDragging(true);
    }
    const max = el.scrollWidth - el.clientWidth;
    const want = d.left0 - dx;
    const next = Math.min(max, Math.max(0, want));
    el.scrollLeft = next;
    // 갈 수 없는 만큼(over)은 스크롤 대신 줄 자체를 밀어 「잡혀 있다」는 느낌을 남긴다
    const over = want - next;
    const pull = -over * RUBBER_RATIO;
    el.style.transform = pull ? `translateX(${pull}px)` : "";
    // 끌고 나서 손을 떼면 click이 따라온다. 그걸 사진 열기로 오해하지 않게 표시해 둔다
    dragged.current = true;
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (DEV && d.active) {
      const t = tally.current;
      setTrace(`끝 ${e.type} | 축 ${d.axis ?? "미정"} | pointermove ${t.pm} | dragstart ${t.dragstart} | scrollLeft ${t.from}→${el?.scrollLeft ?? 0}`);
    }
    if (!d.active) return;
    d.active = false;
    try { if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch { /* 이미 풀렸다 */ }
    // 고무줄을 놓는다 — 되돌아가는 것만 애니메이션. transition을 남겨 두면 다음 끌기가 미끄러지므로 끝나면 걷는다
    if (el && el.style.transform) {
      el.style.transition = RUBBER_BACK;
      el.style.transform = "";
      window.setTimeout(() => { if (el.style.transform === "") el.style.transition = ""; }, 300);
    }
    setDragging(false);
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
      {/* 고무줄로 밀린 줄이 레일 밖(옆 칸)까지 그려지지 않게 자르는 상자. 화살표는 이 밖에 둔다 — 레일 가장자리에 걸쳐야 해서 */}
      <div className="gal-clip">
      <ul
        className={`gal-strip${edge.over ? " over" : ""}${edge.fits ? " fits" : ""}${dragging ? " dragging" : ""}`} ref={ref} onScroll={measure}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd}
        onClick={onClick}
        // 누른 채 움직이면 크롬이 제 드래그(고스트)를 시작하고 그 순간 pointermove가 끊긴다.
        // mousedown을 막으면 그게 안 일어난다 — click은 그대로 난다(막히는 건 선택·포커스뿐)
        onMouseDown={(e) => { if (e.button === 0) e.preventDefault(); }}
        onDragStart={(e) => { tally.current.dragstart += 1; e.preventDefault(); }}
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
      </div>
      {DEV && trace && <p className="gal-trace">{trace}</p>}
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
