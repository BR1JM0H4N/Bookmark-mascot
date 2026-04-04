// ==UserScript==
// @name         Draggable Mascot Overlay
// @namespace    mascot.overlay.final.android
// @version      11.0
// @description  CSP-safe floating mascot with GM cache, drag+snap, flicker, beautiful in-page settings panel
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
"use strict";

/* ─── SINGLETON ─── */
if (window.__MASCOT_OVERLAY_LOADED__) return;
window.__MASCOT_OVERLAY_LOADED__ = true;

/* ─── CONFIG ─── */
const CFG = {
    defaultVw:     30,
    snapDist:      40,
    defaultLeft:   10,
    defaultBottom: 10,
    stateKey:      "mascot_overlay_state_final",
    sizeKey:       "mascot_overlay_size_vw",
    prefix:        "mascot_",
};

/* ─── STATE ─── */
function loadState() {
    return GM_getValue(CFG.stateKey, {
        position: { left: CFG.defaultLeft, top: null },
        activeMascotKey: null
    });
}
function saveState(patch) {
    GM_setValue(CFG.stateKey, { ...loadState(), ...patch });
}
const state = loadState();

/* ─── FETCH / CACHE ─── */
function fetchBlob(url) {
    return new Promise((res, rej) => {
        GM_xmlhttpRequest({
            method: "GET", url, responseType: "blob",
            onload:  r => r.status === 200 ? res(r.response) : rej(new Error("HTTP " + r.status)),
            onerror: rej
        });
    });
}
function toBase64(blob) {
    return new Promise(res => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.readAsDataURL(blob);
    });
}

/* ─── MASCOT HELPERS ─── */
const getKeys  = () => GM_listValues().filter(k => k.startsWith(CFG.prefix));
const getName  = key => key ? key.replace(CFG.prefix, "") : "";
const cycleKey = (cur, dir) => {
    const k = getKeys();
    if (!k.length) return null;
    let i = k.indexOf(cur);
    i = i < 0 ? 0 : (i + dir + k.length) % k.length;
    return k[i];
};

/* ─── SHADOW HOST ─── */
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
const shadow = host.attachShadow({ mode: "open" });
document.documentElement.appendChild(host);

/* ─── SHADOW STYLES ─── */
const styleEl = document.createElement("style");
styleEl.textContent = `

/* ── Flicker animation ── */
@keyframes flicker {
    0%  { opacity: .04 } 15% { opacity: 1  }
    30% { opacity: .08 } 45% { opacity: 1  }
    60% { opacity: .04 } 100%{ opacity: 1  }
}
img.flicker-in { animation: flicker 600ms linear 1 forwards; }

/* ── Glow pulse ── */
@keyframes glow-pulse {
    0%,100% { transform: scale(1);    opacity: .55 }
    50%     { transform: scale(1.07); opacity: 1   }
}

/* ── Settings slide-in ── */
@keyframes panel-in {
    from { opacity: 0; transform: translateY(-5px) scaleY(.97); }
    to   { opacity: 1; transform: translateY(0)    scaleY(1);   }
}

/* ── Container ── */
#container {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    touch-action: none;
    pointer-events: auto;
    cursor: grab;
}

/* ── Mascot wrapper (glow scope) ── */
#mwrap { position: relative; width: 100%; }

/* ── Mascot image ── */
#mwrap img {
    width: 100%;
    display: block;
    pointer-events: none;
    user-select: none;
    opacity: 0;
}

/* ── Glow ring ── */
.glow {
    position: absolute;
    inset: -8px;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    transition: opacity .3s ease;
    animation: glow-pulse 1.8s ease-in-out infinite;
    box-shadow:
        0 0 14px rgba(0,200,255,.55),
        0 0 30px rgba(0,170,255,.35),
        0 0 56px rgba(0,140,255,.2);
}
.glow.visible { opacity: 1; }

/* ── Settings panel ── */
#panel {
    display: none;
    flex-direction: column;
    gap: 6px;
    background: rgba(9, 9, 15, 0.94);
    backdrop-filter: blur(18px) saturate(1.4);
    -webkit-backdrop-filter: blur(18px) saturate(1.4);
    border: 1px solid rgba(255,255,255,0.07);
    border-top: 1px solid rgba(255,255,255,0.04);
    border-radius: 0 0 14px 14px;
    padding: 8px 7px 10px;
    pointer-events: auto !important;
    box-shadow:
        0 12px 40px rgba(0,0,0,0.65),
        inset 0 1px 0 rgba(255,255,255,0.04);
}
#panel.open {
    display: flex;
    animation: panel-in 0.18s cubic-bezier(.22,.68,0,1.2) forwards;
}

/* ── Name label ── */
.pname {
    font: 500 9px/1 system-ui, sans-serif;
    color: rgba(160,175,210,0.4);
    text-align: center;
    letter-spacing: .8px;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ── Button row ── */
.brow {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* ── Icon buttons ── */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    flex-shrink: 0;
    padding: 0;
    background: rgba(255,255,255,0.055);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    color: #9aa5c0;
    cursor: pointer;
    transition: background .12s, color .12s, border-color .12s, transform .1s;
    -webkit-tap-highlight-color: transparent;
    outline: none;
}
.btn svg { display: block; pointer-events: none; }
.btn:hover  {
    background: rgba(100,150,255,.16);
    border-color: rgba(120,160,255,.28);
    color: #89b4fa;
}
.btn:active { transform: scale(.91); }
.btn.lit {
    background: rgba(120,160,255,.22);
    border-color: rgba(137,180,250,.38);
    color: #89b4fa;
}
.btn.red:hover {
    background: rgba(243,139,168,.16);
    border-color: rgba(243,139,168,.3);
    color: #f38ba8;
}

/* ── Dropdown ── */
.msel {
    flex: 1;
    min-width: 0;
    height: 26px;
    background: rgba(255,255,255,0.055);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    color: #9aa5c0;
    font: 11px system-ui, sans-serif;
    padding: 0 6px;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
}
.msel option { background: #12121e; color: #cdd6f4; }

/* ── Resize row ── */
.rrow {
    display: none;
    align-items: center;
    gap: 7px;
    padding: 1px 1px 0;
}
.rrow.open { display: flex; }
.rrow input[type=range] {
    flex: 1;
    cursor: pointer;
    accent-color: #89b4fa;
    height: 3px;
}
.rvlabel {
    font: 500 10px system-ui, sans-serif;
    color: #89b4fa;
    min-width: 30px;
    text-align: right;
    letter-spacing: .3px;
}

/* ── Divider ── */
.sep {
    width: 1px;
    height: 16px;
    background: rgba(255,255,255,0.09);
    flex-shrink: 0;
}

`;
shadow.appendChild(styleEl);

/* ─── DOM STRUCTURE ─── */
const container = document.createElement("div");
container.id = "container";

const mwrap = document.createElement("div");
mwrap.id = "mwrap";

const img = document.createElement("img");
img.draggable = false;

mwrap.appendChild(img);
container.appendChild(mwrap);

const panel = document.createElement("div");
panel.id = "panel";
container.appendChild(panel);

shadow.appendChild(container);

/* ─── APPLY SAVED SIZE + POSITION ─── */
const savedVw = GM_getValue(CFG.sizeKey, CFG.defaultVw);
container.style.cssText += `
    width: ${savedVw}vw;
    max-width: 300px;
    left: ${state.position.left}px;
    ${state.position.top != null
        ? `top:${state.position.top}px;`
        : `bottom:${CFG.defaultBottom}px;`}
`;

/* ─── APPLY MASCOT ─── */
function applyMascot(key) {
    const src = GM_getValue(key);
    if (!src) return;
    state.activeMascotKey = key;
    saveState({ activeMascotKey: key });
    img.style.opacity = "0";
    img.src = src;
    img.onload = () => {
        img.classList.remove("flicker-in");
        void img.offsetWidth;
        img.classList.add("flicker-in");
    };
    syncPanelState();
}

function syncPanelState() {
    const nameEl = panel.querySelector(".pname");
    if (nameEl) nameEl.textContent = getName(state.activeMascotKey) || "—";
    const sel = panel.querySelector(".msel");
    if (sel) {
        populateSelect(sel);
        if (state.activeMascotKey) sel.value = state.activeMascotKey;
    }
}

function populateSelect(sel) {
    const keys = getKeys();
    sel.innerHTML = "";
    if (!keys.length) {
        const o = document.createElement("option");
        o.textContent = "No mascots";
        o.disabled = true;
        sel.appendChild(o);
        return;
    }
    keys.forEach(k => {
        const o = document.createElement("option");
        o.value = k;
        o.textContent = getName(k);
        if (k === state.activeMascotKey) o.selected = true;
        sel.appendChild(o);
    });
}

/* ─── INITIAL LOAD ─── */
(() => {
    const keys = getKeys();
    if (!keys.length) return;
    if (!keys.includes(state.activeMascotKey)) {
        state.activeMascotKey = keys[0];
        saveState({ activeMascotKey: keys[0] });
    }
    applyMascot(state.activeMascotKey);
})();

/* ─── BATTERY SAVE ─── */
document.addEventListener("visibilitychange", () => {
    img.style.animationPlayState = document.hidden ? "paused" : "running";
});

/* ─── DRAG + EDGE SNAP ─── */
let dragging = false, sx, sy, sl, st;

function inPanel(el) {
    let n = el;
    while (n) { if (n === panel) return true; n = n.parentElement; }
    return false;
}

function startDrag(x, y, target) {
    if (inPanel(target)) return;
    dragging = true;
    sx = x; sy = y;
    sl = container.offsetLeft;
    st = container.offsetTop;
}
function moveDrag(x, y) {
    if (!dragging) return;
    container.style.left   = sl + (x - sx) + "px";
    container.style.top    = st + (y - sy) + "px";
    container.style.bottom = "auto";
}
function endDrag() {
    if (!dragging) return;
    dragging = false;
    const r = container.getBoundingClientRect();
    let l = r.left, t = r.top;
    if (r.left                   < CFG.snapDist) l = 0;
    if (innerWidth  - r.right    < CFG.snapDist) l = innerWidth  - r.width;
    if (r.top                    < CFG.snapDist) t = 0;
    if (innerHeight - r.bottom   < CFG.snapDist) t = innerHeight - r.height;
    container.style.left = l + "px";
    container.style.top  = t + "px";
    saveState({ position: { left: l, top: t } });
}

container.addEventListener("mousedown",  e => startDrag(e.clientX, e.clientY, e.target));
document.addEventListener("mousemove",   e => moveDrag(e.clientX, e.clientY));
document.addEventListener("mouseup",     endDrag);

container.addEventListener("touchstart", e => {
    if (inPanel(e.target)) return;
    e.preventDefault();
    startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target);
}, { passive: false });

document.addEventListener("touchmove", e => {
    if (!dragging) return;
    e.preventDefault();
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

document.addEventListener("touchend", endDrag);

/* ─── SETTINGS PANEL ─── */
let panelOpen = false;

// SVG icon set (14×14, stroke-only)
const IC = {
    prev:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    next:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    resize: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="17 8 21 12 17 16"/></svg>`,
    add:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    del:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    close:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    spin:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-9-9"/></svg>`,
};

function mkBtn(extraClass, icon, title) {
    const b = document.createElement("button");
    b.className = "btn" + (extraClass ? " " + extraClass : "");
    b.innerHTML = icon;
    if (title) b.title = title;
    return b;
}

function buildPanel() {
    panel.innerHTML = "";

    /* ── Name label ── */
    const nameEl = document.createElement("div");
    nameEl.className = "pname";
    nameEl.textContent = getName(state.activeMascotKey) || "—";

    /* ── Button row ── */
    const brow = document.createElement("div");
    brow.className = "brow";

    /* Prev */
    const bPrev = mkBtn("", IC.prev, "Previous mascot");
    bPrev.onclick = e => {
        e.stopPropagation();
        const k = cycleKey(state.activeMascotKey, -1);
        if (k) applyMascot(k);
    };

    /* Next */
    const bNext = mkBtn("", IC.next, "Next mascot");
    bNext.onclick = e => {
        e.stopPropagation();
        const k = cycleKey(state.activeMascotKey, 1);
        if (k) applyMascot(k);
    };

    /* Dropdown */
    const sel = document.createElement("select");
    sel.className = "msel";
    populateSelect(sel);
    sel.onchange = e => {
        e.stopPropagation();
        if (sel.value) applyMascot(sel.value);
    };

    /* Resize row (hidden by default) */
    const rrow = document.createElement("div");
    rrow.className = "rrow";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "8"; slider.max = "85"; slider.step = "1";
    slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw);

    const rvlabel = document.createElement("span");
    rvlabel.className = "rvlabel";
    rvlabel.textContent = slider.value + "vw";

    slider.oninput = () => {
        container.style.width = slider.value + "vw";
        rvlabel.textContent   = slider.value + "vw";
        GM_setValue(CFG.sizeKey, +slider.value);
    };

    rrow.append(slider, rvlabel);

    /* Resize toggle btn */
    const bResize = mkBtn("", IC.resize, "Resize mascot");
    bResize.onclick = e => {
        e.stopPropagation();
        const opening = !rrow.classList.contains("open");
        rrow.classList.toggle("open", opening);
        bResize.classList.toggle("lit", opening);
        if (opening) {
            slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw);
            rvlabel.textContent = slider.value + "vw";
        }
    };

    /* Separator */
    const sep = document.createElement("div");
    sep.className = "sep";

    /* Add New */
    const bAdd = mkBtn("", IC.add, "Add mascot from URL");
    bAdd.onclick = async e => {
        e.stopPropagation();
        const url = prompt("Image URL (direct link):");
        if (!url?.trim()) return;
        let name = prompt("Mascot name:");
        if (!name?.trim()) return;
        name = name.trim().replace(/[^\w]/g, "_");
        const key = CFG.prefix + name;
        if (GM_getValue(key)) { alert("A mascot with that name already exists."); return; }

        const origIcon = bAdd.innerHTML;
        bAdd.innerHTML = IC.spin;
        bAdd.style.animation = "spin 1s linear infinite";

        try {
            const base64 = await toBase64(await fetchBlob(url.trim()));
            GM_setValue(key, base64);
            applyMascot(key);
        } catch {
            alert("Failed to fetch image. Check the URL and try again.");
        } finally {
            bAdd.innerHTML = origIcon;
            bAdd.style.animation = "";
        }
    };

    /* Delete */
    const bDel = mkBtn("red", IC.del, "Delete current mascot");
    bDel.onclick = e => {
        e.stopPropagation();
        const k = state.activeMascotKey;
        if (!k) return;
        if (!confirm(`Delete mascot "${getName(k)}"?\nThis cannot be undone.`)) return;
        GM_deleteValue(k);
        const next = cycleKey(k, 1); // getMascotKeys() will no longer include k
        if (next) {
            applyMascot(next);
        } else {
            img.src = "";
            img.style.opacity = "0";
            state.activeMascotKey = null;
            saveState({ activeMascotKey: null });
            syncPanelState();
        }
    };

    /* Close */
    const bClose = mkBtn("", IC.close, "Close settings");
    bClose.onclick = e => {
        e.stopPropagation();
        closePanel();
    };

    brow.append(bPrev, bNext, sel, bResize, sep, bAdd, bDel, bClose);
    panel.append(nameEl, brow, rrow);
}

function openPanel() {
    if (panelOpen) return;
    buildPanel();
    panel.classList.add("open");
    panelOpen = true;
    /* Ensure container is interactive while panel is open */
    container.style.pointerEvents = "auto";
}

function closePanel() {
    panel.classList.remove("open");
    panelOpen = false;
}

/* ─── CLICK-THROUGH LOCK SYSTEM ─── */
(function lockSystem() {
    if (container.__mascotLock__) return;
    container.__mascotLock__ = true;

    const LOCK_DELAY = 3000;
    const LONG_PRESS = 700;
    let unlocked = true;
    let lockTimer, pressTimer, pressing = false;

    function lock() {
        /* Defer if settings panel is open */
        if (panelOpen) { scheduleLock(); return; }
        unlocked = false;
        container.style.pointerEvents = "none";
        container.style.cursor = "default";
        /* Always keep the panel itself tappable */
        panel.style.pointerEvents = "auto";
    }

    function unlock() {
        if (unlocked) return;
        unlocked = true;
        container.style.pointerEvents = "auto";
        container.style.cursor = "grab";
        scheduleLock();
    }

    function scheduleLock() {
        clearTimeout(lockTimer);
        lockTimer = setTimeout(lock, LOCK_DELAY);
    }

    function inside(x, y) {
        const r = container.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function startPress(x, y) {
        if (unlocked || !inside(x, y)) return;
        pressing = true;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => pressing && unlock(), LONG_PRESS);
    }

    function cancelPress() { pressing = false; clearTimeout(pressTimer); }

    document.addEventListener("touchstart", e => startPress(e.touches[0].clientX, e.touches[0].clientY), true);
    document.addEventListener("touchmove",  cancelPress, true);
    document.addEventListener("touchend",   cancelPress, true);
    document.addEventListener("mousedown",  e => startPress(e.clientX, e.clientY), true);
    document.addEventListener("mouseup",    cancelPress, true);

    let lastPos = "";
    setInterval(() => {
        const pos = container.style.left + container.style.top;
        if (unlocked && pos !== lastPos) { lastPos = pos; scheduleLock(); }
    }, 300);

    scheduleLock();
})();

/* ─── GLOW SYSTEM ─── */
(function glowSystem() {
    if (mwrap.__mascotGlow__) return;
    mwrap.__mascotGlow__ = true;

    const glow = document.createElement("div");
    glow.className = "glow";
    mwrap.appendChild(glow);

    new MutationObserver(() => {
        const locked = container.style.pointerEvents === "none";
        glow.classList.toggle("visible", !locked);
    }).observe(container, { attributes: true, attributeFilter: ["style"] });
})();

/* ─── SINGLE GM MENU ENTRY ─── */
GM_registerMenuCommand("⚙️ Mascot Settings", openPanel);

})();
