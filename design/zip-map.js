// <zip-map> — Leaflet + OpenStreetMap 타일. 집공고 리디자인 목업용.
// 자체적으로 leaflet.css/js 를 주입하고 로드 완료 후 초기화하므로 마운트 타이밍에 안전하다.
(() => {
  const CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  const JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  const CSS_HASH = "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H";
  const JS_HASH = "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH";
  let ready;

  // 핀 라벨이 곹칠 때 뒤에 깔리는 핀을 점으로 줌이고 대표 핀에 +N 을 단다
  function ensureDeclutterStyle() {
    if (document.getElementById("zip-map-declutter")) return;
    const st = document.createElement("style");
    st.id = "zip-map-declutter";
    st.textContent = `
      .zg-pin.is-dot { padding:0 !important; width:13px; height:13px; min-width:0; border-radius:50% !important;
        transform:translate(-50%,-50%) !important; box-shadow:0 2px 6px -2px rgba(0,0,0,.5) !important; }
      .zg-pin.is-dot > * { display:none !important; }
      .zg-pin.is-dot::after { display:none !important; }
      .zg-pin-more { margin-left:4px; padding:1px 5px; border-radius:999px; font:800 9.5px/1.4 system-ui,sans-serif;
        background:rgba(0,0,0,.12); }
    `;
    document.head.appendChild(st);
  }

  function load() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${CSS}"]`)) {
        const l = document.createElement("link");
        l.rel = "stylesheet"; l.href = CSS; l.integrity = CSS_HASH; l.crossOrigin = "anonymous";
        document.head.appendChild(l);
      }
      if (window.L) return resolve(window.L);
      const s = document.createElement("script");
      s.src = JS; s.integrity = JS_HASH; s.crossOrigin = "anonymous";
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error("leaflet load failed"));
      document.head.appendChild(s);
    });
    return ready;
  }

  class ZipMap extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.style.display = "block";
      this.style.position = "relative";
      if (!this.style.width) this.style.width = "100%";
      if (!this.style.height) this.style.height = "100%";
      this.style.minHeight = "100%";
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;inset:0;";
      this.appendChild(host);
      load().then((L) => {
        const lat = parseFloat(this.getAttribute("lat") || "37.5512");
        const lng = parseFloat(this.getAttribute("lng") || "126.9882");
        const zoom = parseInt(this.getAttribute("zoom") || "11", 10);
        const map = L.map(host, {
          center: [lat, lng], zoom, zoomControl: false, attributionControl: true,
          zoomSnap: 0, zoomDelta: 0.5,
          scrollWheelZoom: this.hasAttribute("wheel"),
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors", maxZoom: 19,
        }).addTo(map);
        L.control.zoom({ position: "bottomright" }).addTo(map);
        this._map = map;
        let pins = [];
        try { pins = JSON.parse(this.getAttribute("pins") || "[]"); } catch (e) { pins = []; }
        const markers = pins.map((p) => {
          const el = document.createElement("div");
          el.className = "zg-pin" + (p.hot ? " hot" : "");
          el.innerHTML = `<b>${p.label}</b>${p.sub ? `<span>${p.sub}</span>` : ""}`;
          const icon = L.divIcon({ html: el.outerHTML, className: "zg-pin-wrap", iconSize: null });
          return L.marker([p.lat, p.lng], { icon }).addTo(map);
        });
        ensureDeclutterStyle();
        const declutter = () => {
          const leaders = [];
          markers.forEach((m) => {
            const wrap = m.getElement();
            const el = wrap && wrap.firstElementChild;
            if (!el) return;
            el.classList.remove("is-dot");
            const old = el.querySelector(".zg-pin-more");
            if (old) old.remove();
            const pt = map.latLngToContainerPoint(m.getLatLng());
            const w = el.offsetWidth || 110;
            const hit = leaders.find((L2) => Math.abs(L2.pt.x - pt.x) < (L2.w + w) / 2 * 0.92 && Math.abs(L2.pt.y - pt.y) < 40);
            if (hit) {
              el.classList.add("is-dot");
              hit.n += 1;
            } else {
              leaders.push({ pt, w, el, n: 0 });
            }
          });
          leaders.forEach((L2) => {
            if (L2.n > 0) {
              const b = document.createElement("span");
              b.className = "zg-pin-more";
              b.textContent = `+${L2.n}`;
              L2.el.appendChild(b);
            }
          });
        };
        map.on("zoomend moveend", declutter);
        const bounds = pins.length ? L.latLngBounds(pins.map((p) => [p.lat, p.lng])) : null;
        const latlngs = pins.map((p) => L.latLng(p.lat, p.lng));
        // 여백은 컨테이너 크기에 비례 — 300px 높이 지도에 고정값을 쓰면 여백이 화면을 다 먹는다
        const inset = () => {
          const sz = map.getSize();
          return {
            left: Math.min(100, sz.x * 0.18), right: Math.min(100, sz.x * 0.18),
            top: Math.min(126, sz.y * 0.22), bottom: Math.min(116, sz.y * 0.2),
          };
        };
        let lastW = 0, lastH = 0, fitted = false;
        const allInside = () => {
          const s = map.getSize();
          const I = inset();
          if (s.x - I.left - I.right <= 0 || s.y - I.top - I.bottom <= 0) return true;
          return latlngs.every((ll) => {
            const pt = map.latLngToContainerPoint(ll);
            return pt.x >= I.left && pt.x <= s.x - I.right && pt.y >= I.top && pt.y <= s.y - I.bottom;
          });
        };
        const frame = () => {
          try {
            if (this._map !== map) return false; // 이 인스후스는 이밌 버려진 것
            map.invalidateSize(); // 크기 캐시를 먼저 갱신한다 — 0×0 이면 아직 준비 전
            const sz = map.getSize();
            if (!sz.x || !sz.y) return false;
            if (bounds && latlngs.length > 1) {
              const I = inset();
              map.fitBounds(bounds, { animate: false, paddingTopLeft: [I.left, I.top], paddingBottomRight: [I.right, I.bottom] });
              // fitBounds 계산이 라벨 폭을 모르므로, 전부 들어올 때까지 한 단계씩 축소한다
              for (let i = 0; i < 10 && !allInside(); i += 1) {
                const z = map.getZoom() - 0.25;
                if (z <= map.getMinZoom()) break;
                map.setView(bounds.getCenter(), z, { animate: false });
              }
            } else if (bounds) {
              map.setView(bounds.getCenter(), zoom, { animate: false });
            }
            lastW = sz.x; lastH = sz.y; fitted = true;
            declutter();
            return true;
          } catch (e) {
            console.warn("[zip-map] fit failed", e);
            return false;
          }
        };
        // 첫 핏은 한 번의 rAF로 보장되지 않는다(호스트가 아직 크기를 안 줬거나 타이머가 상태이길 수 있다)
        // — 실제로 핏하기 전까지 느린 주기로 계속 폴링하고, 화면에 들어올 때도 한 번 더 시도한다
        this._poll = setInterval(() => {
          if (this._map !== map) { clearInterval(this._poll); return; }
          if (fitted) { clearInterval(this._poll); return; }
          frame();
        }, 250);
        if (typeof IntersectionObserver !== "undefined") {
          this._io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !fitted) frame(); });
          this._io.observe(this);
        }
        requestAnimationFrame(frame);
        let t = null;
        const settle = () => { clearTimeout(t); t = setTimeout(frame, 80); };
        this._ro = new ResizeObserver((entries) => {
          const b = entries[0] && entries[0].contentRect;
          if (!b || b.width < 40 || b.height < 40) return;
          if (fitted && Math.abs(b.width - lastW) < 2 && Math.abs(b.height - lastH) < 2) return;
          settle();
        });
        this._ro.observe(this);
        settle();
      }).catch(() => {
        host.style.cssText += "display:flex;align-items:center;justify-content:center;font:600 13px system-ui;opacity:.6";
        host.textContent = "지도를 불러오지 못했습니다";
      });
    }
    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      if (this._io) { this._io.disconnect(); this._io = null; }
      clearInterval(this._poll);
      if (this._retries) { this._retries.forEach(clearTimeout); this._retries = null; }
      if (this._map) { this._map.remove(); this._map = null; }
      this._init = false;
      this.innerHTML = "";
    }
  }
  if (!customElements.get("zip-map")) customElements.define("zip-map", ZipMap);
})();
