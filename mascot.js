// ==UserScript==
// @name         Draggable Mascot Overlay
// @namespace    mascot.overlay.android.v13
// @version      13.2
// @description  Floating mascot — tap placeholder to open settings on first run; single GM menu entry
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_listValues
// @connect      *
// ==/UserScript==

(() => {
"use strict";

/* ═══════════════════════════════════════════
   SINGLETON
═══════════════════════════════════════════ */
if (window.__MASCOT_OVERLAY_LOADED__) return;
window.__MASCOT_OVERLAY_LOADED__ = true;

/* ═══════════════════════════════════════════
   REGISTER GM MENU FIRST (before anything can fail)
═══════════════════════════════════════════ */
let _openPanelRef = null;  // will be set later
try {
    GM_registerMenuCommand("⚙️ Mascot Settings", () => _openPanelRef?.());
} catch (e) {
    console.warn("[Mascot] GM_registerMenuCommand failed:", e);
}

/* ═══════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════ */
const CFG = {
    defaultVw:     30,
    snapDist:      40,
    defaultLeft:   10,
    defaultBottom: 10,
    stateKey:      "mascot_overlay_state_final",
    sizeKey:       "mascot_overlay_size_vw",
    prefix:        "mascot_",
};

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
function loadState() {
    try {
        return GM_getValue(CFG.stateKey, {
            position: { left: CFG.defaultLeft, top: null },
            activeMascotKey: null
        });
    } catch (e) {
        return { position: { left: CFG.defaultLeft, top: null }, activeMascotKey: null };
    }
}
function saveState(patch) {
    try {
        GM_setValue(CFG.stateKey, { ...loadState(), ...patch });
    } catch (e) {
        console.warn("[Mascot] saveState failed:", e);
    }
}
const state = loadState();

/* ═══════════════════════════════════════════
   NETWORK
═══════════════════════════════════════════ */
function fetchBlob(url) {
    return new Promise((res, rej) =>
        GM_xmlhttpRequest({
            method: "GET", url, responseType: "blob",
            onload:  r => r.status === 200 ? res(r.response) : rej(new Error("HTTP " + r.status)),
            onerror: rej
        })
    );
}
function toBase64(blob) {
    return new Promise(res => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.readAsDataURL(blob);
    });
}

/* ═══════════════════════════════════════════
   HELPERS — safe GM_listValues usage
═══════════════════════════════════════════ */
const getKeys = () => {
    try {
        const vals = typeof GM_listValues === 'function' ? GM_listValues() : [];
        return (vals || []).filter(k => k.startsWith(CFG.prefix));
    } catch (e) {
        console.warn("[Mascot] getKeys failed:", e);
        return [];
    }
};
const getName  = k  => k ? k.slice(CFG.prefix.length) : "";
const cycleKey = (cur, dir) => {
    const k = getKeys();
    if (!k.length) return null;
    let i = k.indexOf(cur);
    i = i < 0 ? 0 : (i + dir + k.length) % k.length;
    return k[i];
};

/* ═══════════════════════════════════════════
   SHADOW DOM
═══════════════════════════════════════════ */
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible;";
const shadow = host.attachShadow({ mode: "open" });
document.documentElement.appendChild(host);

/* ── Stylesheet ── */
const styleEl = document.createElement("style");
styleEl.textContent = `

@keyframes flicker {
    0%  { opacity:.04 } 15% { opacity:1  }
    30% { opacity:.08 } 45% { opacity:1  }
    60% { opacity:.04 } 100%{ opacity:1  }
}
@keyframes glow-pulse {
    0%,100% { transform:scale(1);    }
    50%     { transform:scale(1.08); }
}
@keyframes spin { to { transform:rotate(360deg); } }
@keyframes panel-dn {
    from { opacity:0; transform:translateY(-6px) scaleY(.96); }
    to   { opacity:1; transform:translateY(0)    scaleY(1);   }
}
@keyframes panel-up {
    from { opacity:0; transform:translateY(6px)  scaleY(.96); }
    to   { opacity:1; transform:translateY(0)    scaleY(1);   }
}
@keyframes ph-pulse {
    0%,100% { opacity:.55; transform:scale(1); }
    50%     { opacity:.9;  transform:scale(1.04); }
}

#container {
    position: fixed;
    touch-action: none;
    pointer-events: none;
    cursor: default;
    overflow: visible;
}
#container.unlocked {
    pointer-events: auto;
    cursor: grab;
}
#container.panel-active {
    pointer-events: auto;
}

#mwrap {
    position: relative;
    width: 100%;
    line-height: 0;
}
#mwrap img {
    width: 100%;
    display: block;
    pointer-events: none;
    user-select: none;
    opacity: 0;
}
img.flicker-in { animation: flicker 600ms linear 1 forwards; }

.glow {
    position: absolute;
    inset: -10px;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    transition: opacity .35s ease;
    animation: glow-pulse 1.8s ease-in-out infinite;
    animation-play-state: paused;
    box-shadow:
        0 0 14px rgba(0,200,255,.6),
        0 0 32px rgba(0,160,255,.38),
        0 0 60px rgba(0,120,255,.22);
}
#container.unlocked .glow {
    opacity: 1;
    animation-play-state: running;
}

#placeholder {
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding-bottom: 100%;
    position: relative;
    cursor: pointer;
    pointer-events: auto;
    border-radius: 14px;
    border: 1.5px dashed rgba(137,180,250,0.35);
    background: rgba(137,180,250,0.05);
    box-sizing: border-box;
    animation: ph-pulse 2.2s ease-in-out infinite;
    -webkit-tap-highlight-color: transparent;
}
#placeholder.visible { display: flex; }
#placeholder .ph-inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 8px;
}
#placeholder svg { opacity: .55; }
#placeholder .ph-label {
    font: 600 10px/1.3 system-ui, sans-serif;
    color: rgba(137,180,250,0.7);
    text-align: center;
    letter-spacing: .4px;
}
#placeholder .ph-sub {
    font: 400 8px/1.3 system-ui, sans-serif;
    color: rgba(137,180,250,0.4);
    text-align: center;
}
#placeholder:active { opacity: .7; }

#panel {
    display: none;
    position: absolute;
    left: 0;
    top: 100%;
    z-index: 10;
    min-width: 195px;
    max-width: 235px;
    flex-direction: column;
    gap: 6px;
    padding: 8px 8px 10px;
    pointer-events: auto;
    background: rgba(8, 8, 14, 0.96);
    backdrop-filter: blur(20px) saturate(1.5);
    -webkit-backdrop-filter: blur(20px) saturate(1.5);
    border: 1px solid rgba(255,255,255,0.08);
    border-top: 1px solid rgba(255,255,255,0.04);
    border-radius: 0 0 14px 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.72), inset 0 1px 0 rgba(255,255,255,.04);
    box-sizing: border-box;
}
#panel.open {
    display: flex;
    animation: panel-dn .18s cubic-bezier(.22,.68,0,1.2) forwards;
}
#panel.flip {
    top: auto;
    bottom: 100%;
    border-radius: 14px 14px 0 0;
    border-top: 1px solid rgba(255,255,255,0.08);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    box-shadow: 0 -14px 44px rgba(0,0,0,.72), inset 0 -1px 0 rgba(255,255,255,.04);
}
#panel.flip.open { animation-name: panel-up; }

.pname {
    font: 500 9px/1.2 system-ui, sans-serif;
    color: rgba(140,160,200,.45);
    text-align: center;
    letter-spacing: .9px;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-bottom: 2px;
}

.welcome {
    font: 400 10px/1.5 system-ui, sans-serif;
    color: rgba(137,180,250,.6);
    text-align: center;
    padding: 2px 2px 4px;
    border-bottom: 1px solid rgba(255,255,255,.06);
}
.welcome b { color: rgba(137,180,250,.9); font-weight:600; }

.brow {
    display: flex;
    align-items: center;
    gap: 4px;
}

.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 27px;
    padding: 0;
    background: rgba(255,255,255,.055);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 8px;
    color: #8a96b0;
    cursor: pointer;
    outline: none;
    transition: background .12s, color .12s, border-color .12s, transform .1s;
    -webkit-tap-highlight-color: transparent;
    box-sizing: border-box;
}
.btn svg    { display:block; pointer-events:none; flex-shrink:0; }
.btn:hover  { background:rgba(100,150,255,.18); border-color:rgba(120,160,255,.3); color:#89b4fa; }
.btn:active { transform:scale(.88); }
.btn.lit    { background:rgba(120,160,255,.22); border-color:rgba(137,180,250,.4); color:#89b4fa; }
.btn.danger:hover { background:rgba(243,139,168,.17); border-color:rgba(243,139,168,.32); color:#f38ba8; }
.btn.spin svg { animation: spin .8s linear infinite; }

.msel {
    flex: 1;
    min-width: 0;
    height: 27px;
    background: rgba(255,255,255,.055);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 8px;
    color: #9aa5c0;
    font: 11px system-ui, sans-serif;
    padding: 0 6px;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    box-sizing: border-box;
}
.msel option { background:#12121e; color:#cdd6f4; }

.vsep {
    width: 1px;
    height: 14px;
    background: rgba(255,255,255,.1);
    flex-shrink: 0;
}

.srow {
    display: none;
    align-items: center;
    gap: 7px;
    padding: 1px 0 0;
}
.srow.open { display: flex; }
.srow input[type=range] {
    flex: 1;
    cursor: pointer;
    accent-color: #89b4fa;
    height: 4px;
    margin: 0;
    min-width: 0;
}
.rvlbl {
    font: 600 10px system-ui, sans-serif;
    color: #89b4fa;
    min-width: 34px;
    text-align: right;
    letter-spacing: .3px;
    flex-shrink: 0;
}

`;
shadow.appendChild(styleEl);

/* ── DOM ── */
const container = document.createElement("div");
container.id = "container";

const mwrap = document.createElement("div");
mwrap.id = "mwrap";

const img = document.createElement("img");
img.draggable = false;
mwrap.appendChild(img);

const glow = document.createElement("div");
glow.className = "glow";
mwrap.appendChild(glow);

const placeholder = document.createElement("div");
placeholder.id = "placeholder";
placeholder.innerHTML = `
  <div class="ph-inner">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
         stroke="rgba(137,180,250,0.6)" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4"/>
      <line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="8"  y1="12" x2="16" y2="12"/>
    </svg>
    <span class="ph-label">Tap to add mascot</span>
    <span class="ph-sub">No mascot yet</span>
  </div>
`;

const panel = document.createElement("div");
panel.id = "panel";

container.append(mwrap, placeholder, panel);
shadow.appendChild(container);

/* ── Saved position + size ── */
let savedVw = CFG.defaultVw;
try {
    savedVw = GM_getValue(CFG.sizeKey, CFG.defaultVw);
} catch (e) {
    console.warn("[Mascot] Could not load size:", e);
}
container.style.cssText = `
    width: ${savedVw}vw;
    max-width: 300px;
    left: ${state.position.left}px;
    ${state.position.top != null
        ? `top:${state.position.top}px;`
        : `bottom:${CFG.defaultBottom}px;`}
`;

/* ═══════════════════════════════════════════
   PLACEHOLDER VISIBILITY
═══════════════════════════════════════════ */
function syncPlaceholder() {
    const empty = !getKeys().length;
    placeholder.classList.toggle("visible", empty);
    placeholder.style.pointerEvents = empty ? "auto" : "none";
}

/* ═══════════════════════════════════════════
   MASCOT APPLICATION
═══════════════════════════════════════════ */
function applyMascot(key) {
    let src;
    try {
        src = GM_getValue(key);
    } catch (e) {
        console.warn("[Mascot] Could not load mascot:", e);
        return;
    }
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
    syncPlaceholder();
    refreshPanel();
}

/* ── Initial load ── */
try {
    const keys = getKeys();
    if (!keys.length) {
        syncPlaceholder();
    } else {
        if (!keys.includes(state.activeMascotKey)) {
            state.activeMascotKey = keys[0];
            saveState({ activeMascotKey: keys[0] });
        }
        applyMascot(state.activeMascotKey);
    }
} catch (e) {
    console.warn("[Mascot] Initial load error:", e);
    syncPlaceholder();
}

document.addEventListener("visibilitychange", () => {
    img.style.animationPlayState = document.hidden ? "paused" : "running";
});

/* ═══════════════════════════════════════════
   DRAG + SNAP
═══════════════════════════════════════════ */
let dragging = false, sx, sy, sl, st;

function inInteractive(node) {
    let n = node;
    while (n) {
        if (n === panel || n === placeholder) return true;
        n = n.parentElement;
    }
    return false;
}

function startDrag(x, y, target) {
    if (inInteractive(target)) return;
    dragging = true; sx = x; sy = y;
    sl = container.offsetLeft; st = container.offsetTop;
}
function moveDrag(x, y) {
    if (!dragging) return;
    container.style.left   = (sl + x - sx) + "px";
    container.style.top    = (st + y - sy) + "px";
    container.style.bottom = "auto";
}
function endDrag() {
    if (!dragging) return;
    dragging = false;
    const r = container.getBoundingClientRect();
    let l = r.left, t = r.top;
    if (l                      < CFG.snapDist) l = 0;
    if (innerWidth  - r.right  < CFG.snapDist) l = innerWidth  - r.width;
    if (t                      < CFG.snapDist) t = 0;
    if (innerHeight - r.bottom < CFG.snapDist) t = innerHeight - r.height;
    container.style.left = l + "px";
    container.style.top  = t + "px";
    saveState({ position: { left: l, top: t } });
}

container.addEventListener("mousedown",  e => startDrag(e.clientX, e.clientY, e.target));
document.addEventListener("mousemove",   e => moveDrag(e.clientX, e.clientY));
document.addEventListener("mouseup",     endDrag);

container.addEventListener("touchstart", e => {
    if (inInteractive(e.target)) return;
    e.preventDefault();
    startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target);
}, { passive: false });
document.addEventListener("touchmove", e => {
    if (!dragging) return;
    e.preventDefault();
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
document.addEventListener("touchend", endDrag);

/* ═══════════════════════════════════════════
   LOCK SYSTEM
═══════════════════════════════════════════ */
let panelOpen  = false;
let isUnlocked = false;

(function lockSystem() {
    const LOCK_DELAY = 3000;
    const LONG_PRESS = 700;
    let lockTimer, pressTimer, pressing = false;

    function lock() {
        if (panelOpen) { scheduleLock(); return; }
        isUnlocked = false;
        container.classList.remove("unlocked");
        container.classList.remove("panel-active");
        container.style.cursor = "default";
        panel.style.pointerEvents = "auto";
        placeholder.style.pointerEvents = "auto";
    }

    function unlock() {
        if (isUnlocked) return;
        isUnlocked = true;
        container.classList.add("unlocked");
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
        if (isUnlocked || !inside(x, y)) return;
        pressing = true;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { if (pressing) unlock(); }, LONG_PRESS);
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
        if (isUnlocked && pos !== lastPos) { lastPos = pos; scheduleLock(); }
    }, 300);

    lock();
})();

/* ═══════════════════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════════════════ */
function exportMascots() {
    const keys = getKeys();
    if (!keys.length) { alert("No mascots saved yet."); return; }
    const payload = {};
    keys.forEach(k => {
        try { payload[k] = GM_getValue(k); } catch(e) {}
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mascots_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function importMascots(afterImport) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
        const file = input.files[0];
        input.remove();
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            let count = 0;
            for (const [k, v] of Object.entries(data)) {
                if (k.startsWith(CFG.prefix) && typeof v === "string") {
                    try { GM_setValue(k, v); count++; } catch(e) {}
                }
            }
            alert(`Imported ${count} mascot(s).`);
            if (!state.activeMascotKey || !GM_getValue(state.activeMascotKey)) {
                const keys = getKeys();
                if (keys.length) applyMascot(keys[0]);
            }
            syncPlaceholder();
            afterImport?.();
        } catch {
            alert("Import failed — make sure it's a valid mascot backup JSON.");
        }
    };
    input.click();
}

/* ═══════════════════════════════════════════
   SVG ICONS
═══════════════════════════════════════════ */
const IC = {
    prev:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    next:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    resize: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 4 20 4 20 8"/><polyline points="8 20 4 20 4 16"/><line x1="14" y1="10" x2="20" y2="4"/><line x1="4" y1="20" x2="10" y2="14"/></svg>`,
    add:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    del:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>`,
    close:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    export: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    import: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    spin:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/></svg>`,
};

function mkBtn(icon, title, extraClass) {
    const b = document.createElement("button");
    b.className = "btn" + (extraClass ? " " + extraClass : "");
    b.innerHTML = icon;
    if (title) b.title = title;
    b.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    return b;
}
function mkSep() {
    const d = document.createElement("div");
    d.className = "vsep";
    return d;
}

/* ═══════════════════════════════════════════
   PANEL BUILDER
═══════════════════════════════════════════ */
function buildPanel() {
    panel.innerHTML = "";

    const isEmpty = !getKeys().length;

    if (isEmpty) {
        const hint = document.createElement("div");
        hint.className = "welcome";
        hint.innerHTML = `Tap <b>＋</b> to add your first mascot<br>or <b>⬇</b> to import a backup`;
        panel.appendChild(hint);
    }

    const nameEl = document.createElement("div");
    nameEl.className = "pname";
    nameEl.textContent = isEmpty ? "no mascot" : (getName(state.activeMascotKey) || "—");
    if (!isEmpty) panel.appendChild(nameEl);

    const row1 = document.createElement("div");
    row1.className = "brow";

    const bPrev = mkBtn(IC.prev, "Previous");
    bPrev.onclick = e => {
        e.stopPropagation();
        const k = cycleKey(state.activeMascotKey, -1);
        if (k) applyMascot(k);
    };

    const bNext = mkBtn(IC.next, "Next");
    bNext.onclick = e => {
        e.stopPropagation();
        const k = cycleKey(state.activeMascotKey, 1);
        if (k) applyMascot(k);
    };

    const sel = document.createElement("select");
    sel.className = "msel";
    populateSel(sel);
    sel.onchange = e => { e.stopPropagation(); if (sel.value) applyMascot(sel.value); };

    const srow = document.createElement("div");
    srow.className = "srow";
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "8"; slider.max = "85"; slider.step = "1";
    slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw);
    const rvlbl = document.createElement("span");
    rvlbl.className = "rvlbl";
    rvlbl.textContent = slider.value + "vw";
    slider.oninput = () => {
        container.style.width = slider.value + "vw";
        rvlbl.textContent = slider.value + "vw";
        try { GM_setValue(CFG.sizeKey, +slider.value); } catch(e) {}
    };
    srow.append(slider, rvlbl);

    const bResize = mkBtn(IC.resize, "Resize");
    bResize.onclick = e => {
        e.stopPropagation();
        const open = srow.classList.toggle("open");
        bResize.classList.toggle("lit", open);
        if (open) {
            slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw);
            rvlbl.textContent = slider.value + "vw";
        }
        repositionPanel();
    };

    const bClose = mkBtn(IC.close, "Close");
    bClose.onclick = e => { e.stopPropagation(); closePanel(); };

    row1.append(bPrev, bNext, sel, bResize, bClose);

    const row2 = document.createElement("div");
    row2.className = "brow";

    const bAdd = mkBtn(IC.add, "Add mascot from URL");
    bAdd.onclick = async e => {
        e.stopPropagation();
        const url = prompt("Image URL (direct link to PNG/GIF/WebP/JPG):");
        if (!url?.trim()) return;
        let name = prompt("Name for this mascot:");
        if (!name?.trim()) return;
        name = name.trim().replace(/[^\w]/g, "_");
        const key = CFG.prefix + name;
        try {
            if (GM_getValue(key)) { alert(`"${name}" already exists.`); return; }
        } catch(e) {}

        bAdd.innerHTML = IC.spin;
        bAdd.classList.add("spin");
        try {
            GM_setValue(key, await toBase64(await fetchBlob(url.trim())));
            applyMascot(key);
            buildPanel();
        } catch (err) {
            alert("Could not fetch that image. Check the URL and try again.");
            bAdd.innerHTML = IC.add;
            bAdd.classList.remove("spin");
        }
    };

    const bDel = mkBtn(IC.del, "Delete active mascot", "danger");
    bDel.onclick = e => {
        e.stopPropagation();
        const k = state.activeMascotKey;
        if (!k) { alert("No mascot is active."); return; }
        if (!confirm(`Delete "${getName(k)}"? This cannot be undone.`)) return;
        const nxt = cycleKey(k, 1);
        try { GM_deleteValue(k); } catch(e) {}
        if (nxt && nxt !== k) {
            applyMascot(nxt);
        } else {
            img.src = ""; img.style.opacity = "0";
            state.activeMascotKey = null;
            saveState({ activeMascotKey: null });
            syncPlaceholder();
            buildPanel();
        }
    };

    const bExp = mkBtn(IC.export, "Export all mascots");
    bExp.onclick = e => { e.stopPropagation(); exportMascots(); };

    const bImp = mkBtn(IC.import, "Import from JSON");
    bImp.onclick = e => {
        e.stopPropagation();
        importMascots(() => { syncPlaceholder(); buildPanel(); });
    };

    row2.append(bAdd, bDel, mkSep(), bExp, bImp);
    panel.append(row1, srow, row2);
}

function populateSel(sel) {
    const keys = getKeys();
    sel.innerHTML = "";
    if (!keys.length) {
        const o = document.createElement("option");
        o.textContent = "—"; o.disabled = true;
        sel.appendChild(o);
        return;
    }
    keys.forEach(k => {
        const o = document.createElement("option");
        o.value = k; o.textContent = getName(k);
        if (k === state.activeMascotKey) o.selected = true;
        sel.appendChild(o);
    });
}

function refreshPanel() {
    if (!panelOpen) return;
    const nameEl = panel.querySelector(".pname");
    if (nameEl) nameEl.textContent = getName(state.activeMascotKey) || "—";
    const sel = panel.querySelector(".msel");
    if (sel) { populateSel(sel); if (state.activeMascotKey) sel.value = state.activeMascotKey; }
}

/* ═══════════════════════════════════════════
   PANEL OPEN / CLOSE / FLIP
═══════════════════════════════════════════ */
function repositionPanel() {
    const r   = container.getBoundingClientRect();
    const flip = r.bottom > innerHeight * 0.55;
    panel.classList.toggle("flip", flip);

    if (r.left + 210 > innerWidth - 8) {
        panel.style.left = "auto";
        panel.style.right = "0";
    } else {
        panel.style.left = "0";
        panel.style.right = "auto";
    }
}

function openPanel() {
    if (panelOpen) return;
    buildPanel();
    repositionPanel();
    panel.classList.add("open");
    panelOpen = true;
    container.classList.add("panel-active");
    panel.style.pointerEvents = "auto";
}

function closePanel() {
    panel.classList.remove("open");
    panelOpen = false;
    container.classList.remove("panel-active");
}

/* ═══════════════════════════════════════════
   CONNECT GM MENU TO openPanel
═══════════════════════════════════════════ */
_openPanelRef = openPanel;

/* ═══════════════════════════════════════════
   PLACEHOLDER → tap opens settings
═══════════════════════════════════════════ */
placeholder.addEventListener("click", e => {
    e.stopPropagation();
    openPanel();
});
placeholder.addEventListener("touchend", e => {
    e.stopPropagation();
    openPanel();
}, { passive: true });

})();
