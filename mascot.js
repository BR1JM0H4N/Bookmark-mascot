// ==UserScript==
// @name         Draggable Mascot Overlay
// @namespace    mascot.overlay.android.v13
// @version      13.4
// @description  Floating mascot — long-press to open settings; tap placeholder on first run
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
if (window.__MASCOT_OVERLAY_LOADED__) {
    console.log("[Mascot] Singleton guard triggered — skipping reinit");
    return;
}
window.__MASCOT_OVERLAY_LOADED__ = true;

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
    debugKey:      "mascot_debug_enabled",   // ← persisted debug flag
};

/* ═══════════════════════════════════════════
   DEBUG LOGGING
   • Toggle via GM menu or:
       GM_setValue("mascot_debug_enabled", true)  → enable
       GM_setValue("mascot_debug_enabled", false) → disable
   • Logs appear as [Mascot DBG] in the browser console.
═══════════════════════════════════════════ */
let DEBUG = false;
try { DEBUG = !!GM_getValue(CFG.debugKey, false); } catch (e) {}

const dbg     = (...a) => { if (DEBUG) console.log(  "%c[Mascot DBG]", "color:#89b4fa;font-weight:600", ...a); };
const dbgWarn = (...a) => { if (DEBUG) console.warn( "%c[Mascot DBG]", "color:#f9e2af;font-weight:600", ...a); };
const dbgErr  = (...a) => { if (DEBUG) console.error("%c[Mascot DBG]", "color:#f38ba8;font-weight:600", ...a); };

dbg("Script initialising", { version: "13.4", url: location.href, DEBUG });

/* ═══════════════════════════════════════════
   REGISTER GM MENU FIRST (before anything can fail)
═══════════════════════════════════════════ */
let _openPanelRef = null;  // will be set later
try {
    GM_registerMenuCommand("⚙️ Mascot Settings", () => {
        dbg("GM menu → openPanel()");
        _openPanelRef?.();
    });
    GM_registerMenuCommand(`${DEBUG ? "🔕" : "🔍"} Debug Logging: ${DEBUG ? "ON (click to disable)" : "OFF (click to enable)"}`, () => {
        DEBUG = !DEBUG;
        try { GM_setValue(CFG.debugKey, DEBUG); } catch (e) {}
        console.log(`[Mascot] Debug logging ${DEBUG ? "ENABLED ✅" : "DISABLED ❌"} — reload page to refresh menu label`);
    });
    dbg("GM menu commands registered");
} catch (e) {
    console.warn("[Mascot] GM_registerMenuCommand failed:", e);
}

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
function loadState() {
    try {
        const s = GM_getValue(CFG.stateKey, {
            position: { left: CFG.defaultLeft, top: null },
            activeMascotKey: null
        });
        dbg("loadState()", s);
        return s;
    } catch (e) {
        dbgErr("loadState() failed — using defaults", e);
        return { position: { left: CFG.defaultLeft, top: null }, activeMascotKey: null };
    }
}
function saveState(patch) {
    try {
        const next = { ...loadState(), ...patch };
        GM_setValue(CFG.stateKey, next);
        dbg("saveState() patch=", patch, "→ saved=", next);
    } catch (e) {
        console.warn("[Mascot] saveState failed:", e);
        dbgErr("saveState() threw", e);
    }
}
const state = loadState();
dbg("Initial state loaded:", state);

/* ═══════════════════════════════════════════
   NETWORK
═══════════════════════════════════════════ */
function fetchBlob(url) {
    dbg("fetchBlob() →", url);
    return new Promise((res, rej) =>
        GM_xmlhttpRequest({
            method: "GET", url, responseType: "blob",
            onload: r => {
                if (r.status === 200) {
                    dbg("fetchBlob() ✓ status=200 size≈", r.response?.size, "bytes");
                    res(r.response);
                } else {
                    dbgErr("fetchBlob() ✗ HTTP", r.status, url);
                    rej(new Error("HTTP " + r.status));
                }
            },
            onerror: err => { dbgErr("fetchBlob() network error", err); rej(err); }
        })
    );
}
function toBase64(blob) {
    dbg("toBase64() blob size=", blob?.size);
    return new Promise(res => {
        const r = new FileReader();
        r.onloadend = () => {
            dbg("toBase64() done, dataURL length=", r.result?.length);
            res(r.result);
        };
        r.readAsDataURL(blob);
    });
}

/* ═══════════════════════════════════════════
   HELPERS — safe GM_listValues usage
═══════════════════════════════════════════ */
const getKeys = () => {
    try {
        const vals = typeof GM_listValues === 'function' ? GM_listValues() : [];
        const keys = (vals || []).filter(k => k.startsWith(CFG.prefix)
                                           && k !== CFG.stateKey
                                           && k !== CFG.sizeKey
                                           && k !== CFG.debugKey);
        dbg("getKeys() →", keys);
        return keys;
    } catch (e) {
        console.warn("[Mascot] getKeys failed:", e);
        dbgErr("getKeys() threw", e);
        return [];
    }
};
const getName  = k  => k ? k.slice(CFG.prefix.length) : "";
const cycleKey = (cur, dir) => {
    const k = getKeys();
    if (!k.length) { dbgWarn("cycleKey() — no keys, returning null"); return null; }
    let i = k.indexOf(cur);
    const next = k[i < 0 ? 0 : (i + dir + k.length) % k.length];
    dbg(`cycleKey() cur="${cur}" dir=${dir} → "${next}"`);
    return next;
};

/* ═══════════════════════════════════════════
   SHADOW DOM
═══════════════════════════════════════════ */
dbg("Building Shadow DOM");
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
dbg("DOM structure built and appended to shadow root");

/* ── Saved position + size ── */
let savedVw = CFG.defaultVw;
try {
    savedVw = GM_getValue(CFG.sizeKey, CFG.defaultVw);
    dbg("Loaded saved size:", savedVw, "vw");
} catch (e) {
    console.warn("[Mascot] Could not load size:", e);
    dbgErr("Size load failed, using default:", CFG.defaultVw);
}
container.style.cssText = `
    width: ${savedVw}vw;
    max-width: 300px;
    left: ${state.position.left}px;
    ${state.position.top != null
        ? `top:${state.position.top}px;`
        : `bottom:${CFG.defaultBottom}px;`}
`;
dbg("Container initial style set:", {
    width: savedVw + "vw",
    left: state.position.left,
    top: state.position.top,
    bottom: state.position.top != null ? null : CFG.defaultBottom
});

/* ═══════════════════════════════════════════
   PLACEHOLDER VISIBILITY
═══════════════════════════════════════════ */
function syncPlaceholder() {
    const empty = !getKeys().length;
    placeholder.classList.toggle("visible", empty);
    placeholder.style.pointerEvents = empty ? "auto" : "none";
    dbg("syncPlaceholder() empty=", empty);
}

/* ═══════════════════════════════════════════
   MASCOT APPLICATION
═══════════════════════════════════════════ */
function applyMascot(key) {
    dbg("applyMascot() key=", key);
    let src;
    try {
        src = GM_getValue(key);
    } catch (e) {
        console.warn("[Mascot] Could not load mascot:", e);
        dbgErr("applyMascot() GM_getValue threw for key=", key, e);
        return;
    }
    if (!src) {
        dbgWarn("applyMascot() no data found for key=", key);
        return;
    }
    dbg("applyMascot() src length=", src.length, "chars — setting img.src");
    state.activeMascotKey = key;
    saveState({ activeMascotKey: key });
    img.style.opacity = "0";
    img.src = src;
    img.onload = () => {
        dbg("applyMascot() img.onload fired — triggering flicker-in");
        img.classList.remove("flicker-in");
        void img.offsetWidth;
        img.classList.add("flicker-in");
    };
    img.onerror = () => {
        dbgErr("applyMascot() img.onerror — dataURL may be corrupt for key=", key);
    };
    syncPlaceholder();
    refreshPanel();
}

/* ── Initial load ── */
dbg("Running initial mascot load...");
try {
    const keys = getKeys();
    dbg("Initial keys found:", keys);
    if (!keys.length) {
        dbg("No mascots stored → showing placeholder");
        syncPlaceholder();
    } else {
        if (!keys.includes(state.activeMascotKey)) {
            dbgWarn("Saved activeMascotKey not in keys — resetting to first:", keys[0]);
            state.activeMascotKey = keys[0];
            saveState({ activeMascotKey: keys[0] });
        }
        dbg("Applying active mascot on load:", state.activeMascotKey);
        applyMascot(state.activeMascotKey);
    }
} catch (e) {
    console.warn("[Mascot] Initial load error:", e);
    dbgErr("Initial load threw", e);
    syncPlaceholder();
}

document.addEventListener("visibilitychange", () => {
    const hidden = document.hidden;
    dbg("visibilitychange — hidden=", hidden, "→ pausing/resuming animation");
    img.style.animationPlayState = hidden ? "paused" : "running";
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
    if (inInteractive(target)) {
        dbg("startDrag() blocked — target is interactive element");
        return;
    }
    dragging = true; sx = x; sy = y;
    sl = container.offsetLeft; st = container.offsetTop;
    dbg("startDrag() x=", x, "y=", y, "sl=", sl, "st=", st);
}
function moveDrag(x, y) {
    if (!dragging) return;
    const newL = sl + x - sx;
    const newT = st + y - sy;
    container.style.left   = newL + "px";
    container.style.top    = newT + "px";
    container.style.bottom = "auto";
    // only log every ~10px to avoid console flood
    if (Math.abs((x - sx) % 10) < 1) dbg("moveDrag() left=", newL, "top=", newT);
}
function endDrag() {
    if (!dragging) return;
    dragging = false;
    const r = container.getBoundingClientRect();
    let l = r.left, t = r.top;
    const snapped = { left: false, right: false, top: false, bottom: false };
    if (l                      < CFG.snapDist) { l = 0;                      snapped.left   = true; }
    if (innerWidth  - r.right  < CFG.snapDist) { l = innerWidth  - r.width;  snapped.right  = true; }
    if (t                      < CFG.snapDist) { t = 0;                      snapped.top    = true; }
    if (innerHeight - r.bottom < CFG.snapDist) { t = innerHeight - r.height; snapped.bottom = true; }
    container.style.left = l + "px";
    container.style.top  = t + "px";
    dbg("endDrag() final position l=", l, "t=", t, "snapped=", snapped);
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
        if (panelOpen) {
            dbg("lock() deferred — panel is open, rescheduling");
            scheduleLock();
            return;
        }
        dbg("lock() — locking container");
        isUnlocked = false;
        container.classList.remove("unlocked");
        container.classList.remove("panel-active");
        container.style.cursor = "default";
        panel.style.pointerEvents = "auto";
        placeholder.style.pointerEvents = "auto";
    }

    function unlock() {
        if (isUnlocked) {
            dbg("unlock() — already unlocked, skipping");
            return;
        }
        dbg("unlock() — unlocking container, opening panel, scheduling auto-lock in", LOCK_DELAY, "ms");
        isUnlocked = true;
        container.classList.add("unlocked");
        container.style.cursor = "grab";
        openPanel();
        scheduleLock();
    }

    function scheduleLock() {
        clearTimeout(lockTimer);
        lockTimer = setTimeout(lock, LOCK_DELAY);
        dbg("scheduleLock() — lock in", LOCK_DELAY, "ms");
    }

    function inside(x, y) {
        const r = container.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function startPress(x, y) {
        if (isUnlocked || !inside(x, y)) return;
        pressing = true;
        clearTimeout(pressTimer);
        dbg("startPress() — long-press timer started, fires in", LONG_PRESS, "ms");
        pressTimer = setTimeout(() => {
            if (pressing) {
                dbg("startPress() — long-press threshold reached → unlock()");
                unlock();
            }
        }, LONG_PRESS);
    }
    function cancelPress() {
        if (pressing) dbg("cancelPress() — press cancelled");
        pressing = false;
        clearTimeout(pressTimer);
    }

    document.addEventListener("touchstart", e => startPress(e.touches[0].clientX, e.touches[0].clientY), true);
    document.addEventListener("touchmove",  cancelPress, true);
    document.addEventListener("touchend",   cancelPress, true);
    document.addEventListener("mousedown",  e => startPress(e.clientX, e.clientY), true);
    document.addEventListener("mouseup",    cancelPress, true);

    let lastPos = "";
    setInterval(() => {
        const pos = container.style.left + container.style.top;
        if (isUnlocked && pos !== lastPos) {
            dbg("Position change detected while unlocked — resetting lock timer");
            lastPos = pos;
            scheduleLock();
        }
    }, 300);

    dbg("lockSystem() initialised — calling lock()");
    lock();
})();

/* ═══════════════════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════════════════ */
function exportMascots() {
    const keys = getKeys();
    dbg("exportMascots() keys=", keys);
    if (!keys.length) { alert("No mascots saved yet."); return; }
    const payload = {};
    keys.forEach(k => {
        try {
            payload[k] = GM_getValue(k);
            dbg("exportMascots() included key=", k, "dataURL length=", payload[k]?.length);
        } catch(e) {
            dbgErr("exportMascots() failed to read key=", k, e);
        }
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
    dbg("exportMascots() download triggered, filename=", a.download);
}

function importMascots(afterImport) {
    dbg("importMascots() — opening file picker");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
        const file = input.files[0];
        input.remove();
        if (!file) { dbgWarn("importMascots() — no file selected"); return; }
        dbg("importMascots() file selected:", file.name, "size=", file.size, "bytes");
        try {
            const data = JSON.parse(await file.text());
            dbg("importMascots() parsed JSON keys:", Object.keys(data));
            let count = 0;
            for (const [k, v] of Object.entries(data)) {
                if (k.startsWith(CFG.prefix) && typeof v === "string") {
                    try {
                        GM_setValue(k, v);
                        dbg("importMascots() stored key=", k, "dataURL length=", v.length);
                        count++;
                    } catch(e) {
                        dbgErr("importMascots() GM_setValue failed for key=", k, e);
                    }
                } else {
                    dbgWarn("importMascots() skipped invalid entry key=", k, "type=", typeof v);
                }
            }
            dbg("importMascots() done — imported", count, "mascot(s)");
            alert(`Imported ${count} mascot(s).`);
            if (!state.activeMascotKey || !GM_getValue(state.activeMascotKey)) {
                const keys = getKeys();
                if (keys.length) {
                    dbg("importMascots() auto-applying first key:", keys[0]);
                    applyMascot(keys[0]);
                }
            }
            syncPlaceholder();
            afterImport?.();
        } catch (err) {
            dbgErr("importMascots() parse/process error:", err);
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
    dbg("buildPanel() — rebuilding panel UI");
    panel.innerHTML = "";

    const isEmpty = !getKeys().length;
    dbg("buildPanel() isEmpty=", isEmpty, "activeMascotKey=", state.activeMascotKey);

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
        dbg("bPrev clicked — cycleKey(-1) from", state.activeMascotKey);
        const k = cycleKey(state.activeMascotKey, -1);
        if (k) applyMascot(k);
    };

    const bNext = mkBtn(IC.next, "Next");
    bNext.onclick = e => {
        e.stopPropagation();
        dbg("bNext clicked — cycleKey(+1) from", state.activeMascotKey);
        const k = cycleKey(state.activeMascotKey, 1);
        if (k) applyMascot(k);
    };

    const sel = document.createElement("select");
    sel.className = "msel";
    populateSel(sel);
    sel.onchange = e => {
        e.stopPropagation();
        dbg("select changed → applyMascot(", sel.value, ")");
        if (sel.value) applyMascot(sel.value);
    };

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
        dbg("slider oninput →", slider.value, "vw");
        try { GM_setValue(CFG.sizeKey, +slider.value); } catch(e) {}
    };
    srow.append(slider, rvlbl);

    const bResize = mkBtn(IC.resize, "Resize");
    bResize.onclick = e => {
        e.stopPropagation();
        const open = srow.classList.toggle("open");
        bResize.classList.toggle("lit", open);
        dbg("bResize clicked — srow open=", open);
        if (open) {
            slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw);
            rvlbl.textContent = slider.value + "vw";
        }
        repositionPanel();
    };

    const bClose = mkBtn(IC.close, "Close");
    bClose.onclick = e => {
        e.stopPropagation();
        dbg("bClose clicked → closePanel()");
        closePanel();
    };

    row1.append(bPrev, bNext, sel, bResize, bClose);

    const row2 = document.createElement("div");
    row2.className = "brow";

    const bAdd = mkBtn(IC.add, "Add mascot from URL");
    bAdd.onclick = async e => {
        e.stopPropagation();
        const url = prompt("Image URL (direct link to PNG/GIF/WebP/JPG):");
        if (!url?.trim()) { dbgWarn("bAdd — no URL entered"); return; }
        let name = prompt("Name for this mascot:");
        if (!name?.trim()) { dbgWarn("bAdd — no name entered"); return; }
        name = name.trim().replace(/[^\w]/g, "_");
        const key = CFG.prefix + name;
        dbg("bAdd — url=", url.trim(), "name=", name, "key=", key);
        try {
            if (GM_getValue(key)) {
                dbgWarn("bAdd — key already exists:", key);
                alert(`"${name}" already exists.`);
                return;
            }
        } catch(e) {}

        bAdd.innerHTML = IC.spin;
        bAdd.classList.add("spin");
        try {
            dbg("bAdd — fetching blob...");
            const blob = await fetchBlob(url.trim());
            dbg("bAdd — converting to base64...");
            const b64 = await toBase64(blob);
            GM_setValue(key, b64);
            dbg("bAdd — saved, applying mascot key=", key);
            applyMascot(key);
            buildPanel();
        } catch (err) {
            dbgErr("bAdd — fetch/save failed:", err);
            alert("Could not fetch that image. Check the URL and try again.");
            bAdd.innerHTML = IC.add;
            bAdd.classList.remove("spin");
        }
    };

    const bDel = mkBtn(IC.del, "Delete active mascot", "danger");
    bDel.onclick = e => {
        e.stopPropagation();
        const k = state.activeMascotKey;
        dbg("bDel clicked — activeMascotKey=", k);
        if (!k) { alert("No mascot is active."); return; }
        if (!confirm(`Delete "${getName(k)}"? This cannot be undone.`)) {
            dbg("bDel — user cancelled delete");
            return;
        }
        const nxt = cycleKey(k, 1);
        dbg("bDel — deleting key=", k, "next would be=", nxt);
        try { GM_deleteValue(k); } catch(e) { dbgErr("bDel — GM_deleteValue failed:", e); }
        if (nxt && nxt !== k) {
            dbg("bDel — applying next mascot:", nxt);
            applyMascot(nxt);
        } else {
            dbg("bDel — no remaining mascots — clearing img and state");
            img.src = ""; img.style.opacity = "0";
            state.activeMascotKey = null;
            saveState({ activeMascotKey: null });
            syncPlaceholder();
            buildPanel();
        }
    };

    const bExp = mkBtn(IC.export, "Export all mascots");
    bExp.onclick = e => {
        e.stopPropagation();
        dbg("bExp clicked → exportMascots()");
        exportMascots();
    };

    const bImp = mkBtn(IC.import, "Import from JSON");
    bImp.onclick = e => {
        e.stopPropagation();
        dbg("bImp clicked → importMascots()");
        importMascots(() => { syncPlaceholder(); buildPanel(); });
    };

    row2.append(bAdd, bDel, mkSep(), bExp, bImp);
    panel.append(row1, srow, row2);
    dbg("buildPanel() complete");
}

function populateSel(sel) {
    const keys = getKeys();
    dbg("populateSel() keys=", keys, "active=", state.activeMascotKey);
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
    if (!panelOpen) {
        dbg("refreshPanel() — panel not open, skipping");
        return;
    }
    dbg("refreshPanel() — updating name label and select");
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
    const rightOverflow = r.left + 210 > innerWidth - 8;
    if (rightOverflow) {
        panel.style.left = "auto";
        panel.style.right = "0";
    } else {
        panel.style.left = "0";
        panel.style.right = "auto";
    }
    dbg("repositionPanel() flip=", flip, "rightOverflow=", rightOverflow,
        "containerRect:", { left: Math.round(r.left), bottom: Math.round(r.bottom) });
}

function openPanel() {
    if (panelOpen) {
        dbg("openPanel() — already open, skipping");
        return;
    }
    dbg("openPanel() — building and showing panel");
    buildPanel();
    repositionPanel();
    panel.classList.add("open");
    panelOpen = true;
    container.classList.add("panel-active");
    panel.style.pointerEvents = "auto";
}

function closePanel() {
    dbg("closePanel()");
    panel.classList.remove("open");
    panelOpen = false;
    container.classList.remove("panel-active");
}

/* ═══════════════════════════════════════════
   CONNECT GM MENU TO openPanel
═══════════════════════════════════════════ */
_openPanelRef = openPanel;
dbg("_openPanelRef wired to openPanel()");

/* ═══════════════════════════════════════════
   PLACEHOLDER → tap opens settings
═══════════════════════════════════════════ */
placeholder.addEventListener("click", e => {
    e.stopPropagation();
    dbg("placeholder click → openPanel()");
    openPanel();
});
placeholder.addEventListener("touchend", e => {
    e.stopPropagation();
    dbg("placeholder touchend → openPanel()");
    openPanel();
}, { passive: true });

dbg("✅ Mascot Overlay fully initialised");

})();
