// ==UserScript==
// @name         Draggable Mascot
// @namespace    mascot.overlay.android.v15
// @version      14.0
// @description  Floating mascot — long-press to open settings; playlists with per-item duration
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
    playlistPrefix:"mascot_playlist_",
    debugKey:      "mascot_debug_enabled",
};

/* ═══════════════════════════════════════════
   DEBUG LOGGING
═══════════════════════════════════════════ */
let DEBUG = false;
try { DEBUG = !!GM_getValue(CFG.debugKey, false); } catch (e) {}

const dbg     = (...a) => { if (DEBUG) console.log(  "%c[Mascot DBG]", "color:#89b4fa;font-weight:600", ...a); };
const dbgWarn = (...a) => { if (DEBUG) console.warn( "%c[Mascot DBG]", "color:#f9e2af;font-weight:600", ...a); };
const dbgErr  = (...a) => { if (DEBUG) console.error("%c[Mascot DBG]", "color:#f38ba8;font-weight:600", ...a); };

dbg("Script initialising", { version: "14.0", url: location.href, DEBUG });

/* ═══════════════════════════════════════════
   REGISTER GM MENU
═══════════════════════════════════════════ */
let _openPanelRef = null;
try {
    GM_registerMenuCommand("⚙️ Mascot Settings", () => { _openPanelRef?.(); });
    GM_registerMenuCommand(`${DEBUG ? "🔕" : "🔍"} Debug Logging: ${DEBUG ? "ON (click to disable)" : "OFF (click to enable)"}`, () => {
        DEBUG = !DEBUG;
        try { GM_setValue(CFG.debugKey, DEBUG); } catch (e) {}
        console.log(`[Mascot] Debug logging ${DEBUG ? "ENABLED ✅" : "DISABLED ❌"} — reload page to refresh menu label`);
    });
} catch (e) { console.warn("[Mascot] GM_registerMenuCommand failed:", e); }

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
    try { GM_setValue(CFG.stateKey, { ...loadState(), ...patch }); } catch (e) { console.warn("[Mascot] saveState failed:", e); }
}
const state = loadState();

/* ═══════════════════════════════════════════
   PLAYLIST STATE
═══════════════════════════════════════════ */
/*
  Playlist object (stored as JSON string under mascot_playlist_<name>):
  {
    name: string,
    items: [ { key: "mascot_xxx", duration: 5 }, ... ],   // duration in seconds
    order: "sequence" | "random"
  }
*/
function loadPlaylists() {
    const out = {};
    try {
        const all = typeof GM_listValues === 'function' ? (GM_listValues() || []) : [];
        all.filter(k => k.startsWith(CFG.playlistPrefix)).forEach(k => {
            try {
                const pl = JSON.parse(GM_getValue(k, "null"));
                if (pl && pl.name && Array.isArray(pl.items)) out[k] = pl;
            } catch(e) {}
        });
    } catch(e) {}
    return out;
}
function savePlaylist(pl) {
    // pl.name must be slug-safe
    const key = CFG.playlistPrefix + pl.name;
    try { GM_setValue(key, JSON.stringify(pl)); } catch(e) { console.warn("[Mascot] savePlaylist failed", e); }
    return key;
}
function deletePlaylist(key) {
    try { GM_deleteValue(key); } catch(e) {}
}

/* ═══════════════════════════════════════════
   PLAYLIST RUNTIME
═══════════════════════════════════════════ */
const playlistRuntime = {
    active: false,
    playlist: null,
    idx: 0,
    timer: null,
    usedIndices: [],

    start(pl) {
        this.stop();
        if (!pl || !pl.items.length) return;
        this.active   = true;
        this.playlist = pl;
        this.idx      = 0;
        this.usedIndices = [];
        saveState({ activePlaylistKey: CFG.playlistPrefix + pl.name });
        dbg("playlist.start()", pl.name, "order=", pl.order, "items=", pl.items.length);
        this._playNext();
    },

    _playNext() {
        if (!this.active || !this.playlist) return;
        const items = this.playlist.items;
        let idx;

        if (this.playlist.order === "random") {
            // Fisher-Yates-style: exhaust all indices before repeating
            if (this.usedIndices.length >= items.length) this.usedIndices = [];
            const remaining = items.map((_,i) => i).filter(i => !this.usedIndices.includes(i));
            idx = remaining[Math.floor(Math.random() * remaining.length)];
            this.usedIndices.push(idx);
        } else {
            idx = this.idx % items.length;
            this.idx++;
        }

        const item = items[idx];
        const durMs = Math.max(500, Number(item.duration) * 1000) || 5000;
        dbg("playlist._playNext() idx=", idx, "key=", item.key, "duration=", item.duration, "s → durMs=", durMs);
        applyMascot(item.key, true /* suppress playlist stop */);
        updatePlaylistProgressUI(idx, durMs);

        this.timer = setTimeout(() => this._playNext(), durMs);
    },

    stop() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.active   = false;
        this.playlist = null;
        this.idx      = 0;
        this.usedIndices = [];
        saveState({ activePlaylistKey: null });
        dbg("playlist.stop()");
        updatePlaylistProgressUI(-1);
    },

    isActive() { return this.active; }
};

/* ═══════════════════════════════════════════
   NETWORK
═══════════════════════════════════════════ */
function fetchBlob(url) {
    return new Promise((res, rej) =>
        GM_xmlhttpRequest({
            method: "GET", url, responseType: "blob",
            onload:  r  => r.status === 200 ? res(r.response) : rej(new Error("HTTP " + r.status)),
            onerror: err => rej(err)
        })
    );
}
function toBase64(blob) {
    return new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
const getKeys = () => {
    try {
        const vals = typeof GM_listValues === 'function' ? GM_listValues() : [];
        return (vals || []).filter(k => k.startsWith(CFG.prefix)
                                     && !k.startsWith(CFG.playlistPrefix)
                                     && k !== CFG.stateKey
                                     && k !== CFG.sizeKey
                                     && k !== CFG.debugKey);
    } catch (e) { return []; }
};
const getName  = k  => k ? k.slice(CFG.prefix.length) : "";
const cycleKey = (cur, dir) => {
    const k = getKeys();
    if (!k.length) return null;
    let i = k.indexOf(cur);
    return k[i < 0 ? 0 : (i + dir + k.length) % k.length];
};
const slugify  = s => s.trim().replace(/[^\w]/g, "_").slice(0, 40);

/* ═══════════════════════════════════════════
   SHADOW DOM
═══════════════════════════════════════════ */
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible;";
const shadow = host.attachShadow({ mode: "open" });
document.documentElement.appendChild(host);

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
@keyframes pl-bar {
    from { width: 0%; }
    to   { width: 100%; }
}

/* ── Layout ── */
#container {
    position: fixed;
    touch-action: none;
    pointer-events: none;
    cursor: default;
    overflow: visible;
}
#container.unlocked   { pointer-events: auto; cursor: grab; }
#container.panel-active { pointer-events: auto; }

#mwrap { position: relative; width: 100%; line-height: 0; }
#mwrap img {
    width: 100%;
    display: block;
    pointer-events: none;
    user-select: none;
    opacity: 0;
}
img.flicker-in { animation: flicker 600ms linear 1 forwards; }

/* ── Placeholder ── */
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
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 5px; padding: 8px;
}
#placeholder svg { opacity: .55; }
#placeholder .ph-label { font: 600 10px/1.3 system-ui,sans-serif; color: rgba(137,180,250,0.7); text-align:center; letter-spacing:.4px; }
#placeholder .ph-sub   { font: 400  8px/1.3 system-ui,sans-serif; color: rgba(137,180,250,0.4); text-align:center; }
#placeholder:active    { opacity:.7; }

/* ── Panel shell ── */
#panel {
    display: none;
    position: absolute;
    left: 0; top: 100%;
    z-index: 10;
    min-width: 210px;
    max-width: 260px;
    flex-direction: column;
    gap: 5px;
    padding: 8px 8px 10px;
    pointer-events: auto;
    background: rgba(8,8,14,0.96);
    backdrop-filter: blur(20px) saturate(1.5);
    -webkit-backdrop-filter: blur(20px) saturate(1.5);
    border: 1px solid rgba(255,255,255,.08);
    border-top: 1px solid rgba(255,255,255,.04);
    border-radius: 0 0 14px 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.72), inset 0 1px 0 rgba(255,255,255,.04);
    box-sizing: border-box;
}
#panel.open {
    display: flex;
    animation: panel-dn .18s cubic-bezier(.22,.68,0,1.2) forwards;
}
#panel.flip {
    top: auto; bottom: 100%;
    border-radius: 14px 14px 0 0;
    border-top: 1px solid rgba(255,255,255,.08);
    border-bottom: 1px solid rgba(255,255,255,.04);
    box-shadow: 0 -14px 44px rgba(0,0,0,.72), inset 0 -1px 0 rgba(255,255,255,.04);
}
#panel.flip.open { animation-name: panel-up; }

/* ── Section divider ── */
.sec-div {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 1px;
}
.sec-div span {
    font: 600 8px/1 system-ui,sans-serif;
    letter-spacing: 1.1px;
    text-transform: uppercase;
    color: rgba(137,180,250,.35);
    white-space: nowrap;
}
.sec-div::before, .sec-div::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,.07);
}

/* ── Common text ── */
.pname {
    font: 500 9px/1.2 system-ui,sans-serif;
    color: rgba(140,160,200,.45);
    text-align: center;
    letter-spacing: .9px;
    text-transform: uppercase;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding-bottom: 2px;
}
.welcome {
    font: 400 10px/1.5 system-ui,sans-serif;
    color: rgba(137,180,250,.6);
    text-align: center;
    padding: 2px 2px 4px;
    border-bottom: 1px solid rgba(255,255,255,.06);
}
.welcome b { color: rgba(137,180,250,.9); font-weight:600; }

/* ── Buttons ── */
.brow { display:flex; align-items:center; gap:4px; }
.btn {
    display: inline-flex;
    align-items: center; justify-content: center;
    flex-shrink: 0;
    width: 28px; height: 27px;
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
.btn.accent { background:rgba(166,227,161,.13); border-color:rgba(166,227,161,.3); color:#a6e3a1; }
.btn.accent:hover { background:rgba(166,227,161,.22); border-color:rgba(166,227,161,.5); }
.btn.warn   { background:rgba(249,226,175,.13); border-color:rgba(249,226,175,.3); color:#f9e2af; }
.btn.warn:hover   { background:rgba(249,226,175,.22); }

/* ── Select ── */
.msel {
    flex: 1; min-width: 0; height: 27px;
    background: rgba(255,255,255,.055);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 8px;
    color: #9aa5c0;
    font: 11px system-ui,sans-serif;
    padding: 0 6px;
    cursor: pointer; outline: none;
    appearance: none; -webkit-appearance: none;
    box-sizing: border-box;
}
.msel option { background:#12121e; color:#cdd6f4; }

/* ── Separator ── */
.vsep { width:1px; height:14px; background:rgba(255,255,255,.1); flex-shrink:0; }

/* ── Resize slider ── */
.srow { display:none; align-items:center; gap:7px; padding:1px 0 0; }
.srow.open { display:flex; }
.srow input[type=range] {
    flex: 1; cursor: pointer; accent-color:#89b4fa; height:4px; margin:0; min-width:0;
}
.rvlbl { font:600 10px system-ui,sans-serif; color:#89b4fa; min-width:34px; text-align:right; letter-spacing:.3px; flex-shrink:0; }

/* ════════════════════════════════
   PLAYLIST UI
════════════════════════════════ */

/* Playlist select row */
.pl-selrow { display:flex; align-items:center; gap:4px; }
.pl-selrow .msel { font-size:10px; }

/* Now-playing bar */
.pl-playing {
    display: none;
    align-items: center;
    gap: 5px;
    padding: 4px 5px;
    border-radius: 7px;
    background: rgba(166,227,161,.07);
    border: 1px solid rgba(166,227,161,.18);
}
.pl-playing.visible { display:flex; }
.pl-now-name {
    flex:1; min-width:0;
    font: 500 9px/1.2 system-ui,sans-serif;
    color: rgba(166,227,161,.8);
    overflow: hidden; text-overflow: ellipsis; white-space:nowrap;
}
.pl-now-idx {
    font: 400 8px/1 system-ui,sans-serif;
    color: rgba(166,227,161,.45);
    flex-shrink:0;
}
.pl-bar-wrap {
    height: 2px; border-radius:2px;
    background: rgba(166,227,161,.15);
    overflow: hidden;
    margin-top:2px;
}
.pl-bar-fill {
    height: 100%; border-radius:2px;
    background: rgba(166,227,161,.7);
    width: 0%;
    transition: none;
}

/* Playlist editor overlay */
.pl-editor {
    display: none;
    flex-direction: column;
    gap: 5px;
}
.pl-editor.open { display:flex; }
.pl-editor-title {
    font: 600 9px/1.2 system-ui,sans-serif;
    letter-spacing:.8px; text-transform:uppercase;
    color: rgba(249,226,175,.6);
    text-align:center; padding-bottom:3px;
}
.pl-item-list {
    display: flex; flex-direction:column; gap:3px;
    max-height:160px; overflow-y:auto;
    padding-right:2px;
}
.pl-item-list::-webkit-scrollbar { width:3px; }
.pl-item-list::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:2px; }

.pl-item {
    display: flex; align-items:center; gap:4px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 6px;
    padding: 3px 4px;
}
.pl-item.pl-active-item {
    border-color: rgba(166,227,161,.35);
    background: rgba(166,227,161,.06);
}
.pl-item-name {
    flex:1; min-width:0;
    font: 400 10px/1.3 system-ui,sans-serif;
    color: #9aa5c0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.pl-item-dur {
    font: 600 10px/1 system-ui,sans-serif;
    color: rgba(137,180,250,.7);
    min-width:28px; text-align:right; flex-shrink:0;
}
.pl-item-del {
    width:18px; height:18px;
    display:inline-flex; align-items:center; justify-content:center;
    background:none; border:none; cursor:pointer; padding:0;
    color:rgba(243,139,168,.4); border-radius:4px;
    -webkit-tap-highlight-color:transparent;
    flex-shrink:0;
}
.pl-item-del:hover { color:#f38ba8; background:rgba(243,139,168,.1); }
.pl-item-del svg { display:block; }

/* Add-item subrow */
.pl-addrow {
    display:flex; align-items:center; gap:4px;
    padding: 3px 0 0;
    border-top: 1px solid rgba(255,255,255,.06);
}
.pl-addrow .msel { font-size:10px; }
.pl-dur-input {
    width: 46px; height:25px;
    background: rgba(255,255,255,.055);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 7px;
    color: #9aa5c0; font: 11px system-ui,sans-serif;
    padding: 0 5px; outline:none; box-sizing:border-box;
    text-align:center; flex-shrink:0;
}
.pl-dur-input:focus { border-color:rgba(137,180,250,.4); }

/* Order toggle */
.pl-order-row { display:flex; align-items:center; gap:5px; margin-top:1px; }
.pl-order-lbl { font:400 9px system-ui,sans-serif; color:rgba(140,160,200,.5); flex:1; }
.pl-order-toggle {
    display:flex; border-radius:7px; overflow:hidden;
    border: 1px solid rgba(255,255,255,.09);
}
.pl-order-toggle button {
    background:none; border:none; cursor:pointer; padding:3px 7px;
    font:600 8px system-ui,sans-serif; letter-spacing:.5px; text-transform:uppercase;
    color:rgba(140,160,200,.4);
    -webkit-tap-highlight-color:transparent;
    transition:background .12s, color .12s;
}
.pl-order-toggle button.active {
    background:rgba(137,180,250,.18);
    color:#89b4fa;
}

/* Save row */
.pl-save-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:1px; }
.pl-name-input {
    flex:1; min-width:80px; height:25px;
    background: rgba(255,255,255,.055);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 7px;
    color: #9aa5c0; font: 11px system-ui,sans-serif;
    padding: 0 6px; outline:none; box-sizing:border-box;
}
.pl-name-input:focus { border-color:rgba(137,180,250,.4); }
.pl-save-btn {
    height:25px; padding:0 8px;
    background: rgba(166,227,161,.13);
    border: 1px solid rgba(166,227,161,.3);
    border-radius: 7px;
    color: #a6e3a1; font:600 10px system-ui,sans-serif;
    cursor:pointer; flex-shrink:0; white-space:nowrap;
    -webkit-tap-highlight-color:transparent;
}
.pl-save-btn:hover { background:rgba(166,227,161,.22); }
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

/* ── Saved position + size ── */
let savedVw = CFG.defaultVw;
try { savedVw = GM_getValue(CFG.sizeKey, CFG.defaultVw); } catch (e) {}
container.style.cssText = `
    width: ${savedVw}vw;
    max-width: 300px;
    left: ${state.position.left}px;
    ${state.position.top != null ? `top:${state.position.top}px;` : `bottom:${CFG.defaultBottom}px;`}
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
function applyMascot(key, fromPlaylist = false) {
    // If a playlist is running and this call is NOT from the playlist, stop the playlist
    if (!fromPlaylist && playlistRuntime.isActive()) {
        playlistRuntime.stop();
        refreshPlaylistUI();
    }
    let src;
    try { src = GM_getValue(key); } catch (e) { return; }
    if (!src) return;
    state.activeMascotKey = key;
    saveState({ activeMascotKey: key });
    img.style.opacity = "0";
    img.src = src;
    img.onload = () => { img.classList.remove("flicker-in"); void img.offsetWidth; img.classList.add("flicker-in"); };
    syncPlaceholder();
    refreshPanel();
}

/* ── Initial load ── */
function doInitialLoad() {
    try {
        const keys = getKeys();
        if (!keys.length) { syncPlaceholder(); return; }

        // Fresh read from storage (not the cached `state` snapshot) so we always
        // see whatever was last written — even if `state` was loaded before start() ran.
        const freshState  = loadState();
        const savedPlKey  = freshState.activePlaylistKey;
        console.log("[Mascot] init — savedPlKey=", savedPlKey);

        if (savedPlKey) {
            // loadPlaylists() is the same path used by the panel UI — known to work
            const allPl = loadPlaylists();
            const pl    = allPl[savedPlKey];
            console.log("[Mascot] init — playlist found=", !!pl, pl ? pl.name : "");

            if (pl && Array.isArray(pl.items) && pl.items.length) {
                const validKeys = new Set(keys);
                pl.items = pl.items.filter(item => validKeys.has(item.key));
                if (pl.items.length) {
                    console.log("[Mascot] Auto-resuming playlist:", pl.name);
                    playlistRuntime.start(pl);
                    return;
                }
            }
            // Playlist missing or all items invalid — clear flag, fall through
            saveState({ activePlaylistKey: null });
        }

        // Normal single-mascot load
        const activeMascotKey = freshState.activeMascotKey;
        if (!keys.includes(activeMascotKey)) {
            state.activeMascotKey = keys[0];
            saveState({ activeMascotKey: keys[0] });
        } else {
            state.activeMascotKey = activeMascotKey;
        }
        applyMascot(state.activeMascotKey);
    } catch (e) {
        console.warn("[Mascot] doInitialLoad error:", e);
        syncPlaceholder();
    }
}
setTimeout(doInitialLoad, 0);

document.addEventListener("visibilitychange", () => {
    img.style.animationPlayState = document.hidden ? "paused" : "running";
});

/* ═══════════════════════════════════════════
   DRAG + SNAP
═══════════════════════════════════════════ */
let dragging = false, sx, sy, sl, st;
function inInteractive(node) {
    let n = node;
    while (n) { if (n === panel || n === placeholder) return true; n = n.parentElement; }
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
    if (l                     < CFG.snapDist) l = 0;
    if (innerWidth  - r.right < CFG.snapDist) l = innerWidth  - r.width;
    if (t                     < CFG.snapDist) t = 0;
    if (innerHeight - r.bottom< CFG.snapDist) t = innerHeight - r.height;
    container.style.left = l + "px";
    container.style.top  = t + "px";
    saveState({ position: { left: l, top: t } });
}
container.addEventListener("mousedown",  e => startDrag(e.clientX, e.clientY, e.target));
document.addEventListener("mousemove",   e => moveDrag(e.clientX, e.clientY));
document.addEventListener("mouseup",     endDrag);
container.addEventListener("touchstart", e => { if (inInteractive(e.target)) return; e.preventDefault(); startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target); }, { passive: false });
document.addEventListener("touchmove",   e => { if (!dragging) return; e.preventDefault(); moveDrag(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
document.addEventListener("touchend",    endDrag);

/* ═══════════════════════════════════════════
   LOCK SYSTEM
═══════════════════════════════════════════ */
let panelOpen  = false;
let isUnlocked = false;
(function lockSystem() {
    const LOCK_DELAY = 3000, LONG_PRESS = 700;
    let lockTimer, pressTimer, pressing = false;
    function lock() {
        if (panelOpen) { scheduleLock(); return; }
        isUnlocked = false;
        container.classList.remove("unlocked", "panel-active");
        container.style.cursor = "default";
        panel.style.pointerEvents = "auto";
        placeholder.style.pointerEvents = "auto";
    }
    function unlock() {
        if (isUnlocked) return;
        isUnlocked = true;
        container.classList.add("unlocked");
        container.style.cursor = "grab";
        openPanel();
        scheduleLock();
    }
    function scheduleLock() { clearTimeout(lockTimer); lockTimer = setTimeout(lock, LOCK_DELAY); }
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
   EXPORT / IMPORT  (playlists included automatically)
═══════════════════════════════════════════ */
function exportMascots() {
    const keys = getKeys();
    if (!keys.length) { alert("No mascots saved yet."); return; }

    const payload = {};
    // mascot images
    keys.forEach(k => { try { payload[k] = GM_getValue(k); } catch(e) {} });
    // playlists
    try {
        const all = typeof GM_listValues === 'function' ? (GM_listValues() || []) : [];
        all.filter(k => k.startsWith(CFG.playlistPrefix)).forEach(k => {
            try { payload[k] = GM_getValue(k); } catch(e) {}
        });
    } catch(e) {}

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "mascots_" + new Date().toISOString().slice(0,10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function importMascots(afterImport) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
        const file = input.files[0]; input.remove();
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            let count = 0, plCount = 0;
            for (const [k, v] of Object.entries(data)) {
                if (k.startsWith(CFG.playlistPrefix) && typeof v === "string") {
                    try { GM_setValue(k, v); plCount++; } catch(e) {}
                } else if (k.startsWith(CFG.prefix) && typeof v === "string") {
                    try { GM_setValue(k, v); count++; } catch(e) {}
                }
            }
            alert(`Imported ${count} mascot(s) and ${plCount} playlist(s).`);
            if (!state.activeMascotKey || !GM_getValue(state.activeMascotKey)) {
                const keys = getKeys();
                if (keys.length) applyMascot(keys[0]);
            }
            syncPlaceholder();
            afterImport?.();
        } catch (err) { alert("Import failed — make sure it's a valid mascot backup JSON."); }
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
    play:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    stop:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
    edit:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    list:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    plus:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    x:      `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};
function mkBtn(icon, title, extraClass) {
    const b = document.createElement("button");
    b.className = "btn" + (extraClass ? " " + extraClass : "");
    b.innerHTML = icon;
    if (title) b.title = title;
    b.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    return b;
}
function mkSep() { const d = document.createElement("div"); d.className = "vsep"; return d; }
function mkSecDiv(label) {
    const d = document.createElement("div"); d.className = "sec-div";
    const s = document.createElement("span"); s.textContent = label;
    d.appendChild(s); return d;
}

/* ═══════════════════════════════════════════
   PLAYLIST PROGRESS UI (live update)
═══════════════════════════════════════════ */
let _plProgressEl = null;  // the .pl-playing div in the current panel build
let _plBarFill    = null;
let _plNowName    = null;
let _plNowIdx     = null;
let _plBarAnim    = null;  // running CSS animation cancel fn

function updatePlaylistProgressUI(activeIdx, durMs) {
    if (!_plProgressEl) return;
    const pl = playlistRuntime.playlist;
    if (!pl || activeIdx < 0) {
        _plProgressEl.classList.remove("visible");
        if (_plBarFill) _plBarFill.style.width = "0%";
        return;
    }
    _plProgressEl.classList.add("visible");
    const item = pl.items[activeIdx];
    if (_plNowName)  _plNowName.textContent  = getName(item.key);
    if (_plNowIdx)   _plNowIdx.textContent   = `${activeIdx + 1}/${pl.items.length}`;
    if (_plBarFill) {
        const animDur = (durMs != null ? durMs : Math.max(500, Number(item.duration) * 1000)) / 1000;
        _plBarFill.style.animation = "none";
        void _plBarFill.offsetWidth;
        _plBarFill.style.animation = `pl-bar ${animDur}s linear forwards`;
    }
    // highlight active item in editor if open
    const editorItems = panel.querySelectorAll(".pl-item");
    editorItems.forEach((el, i) => el.classList.toggle("pl-active-item", i === activeIdx));
}

function refreshPlaylistUI() {
    // Update play/stop button state and progress bar visibility in current panel
    if (!panelOpen) return;
    const bStop = panel.querySelector("#pl-stop-btn");
    const bPlay = panel.querySelector("#pl-play-btn");
    if (playlistRuntime.isActive()) {
        bStop?.style && (bStop.style.display = "");
        bPlay?.style && (bPlay.style.display = "none");
    } else {
        bStop?.style && (bStop.style.display = "none");
        bPlay?.style && (bPlay.style.display = "");
        if (_plProgressEl) _plProgressEl.classList.remove("visible");
    }
}

/* ═══════════════════════════════════════════
   PLAYLIST EDITOR STATE (ephemeral, within panel session)
═══════════════════════════════════════════ */
let editorState = {
    open: false,
    editingKey: null,    // null = new playlist
    items: [],           // [{key, duration}]
    order: "sequence"
};

/* ═══════════════════════════════════════════
   PANEL BUILDER
═══════════════════════════════════════════ */
function buildPanel() {
    panel.innerHTML = "";
    _plProgressEl = null; _plBarFill = null; _plNowName = null; _plNowIdx = null;

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

    /* ── Row 1: prev/next/select/resize/close ── */
    const row1 = document.createElement("div");
    row1.className = "brow";
    const bPrev = mkBtn(IC.prev, "Previous");
    bPrev.onclick = e => { e.stopPropagation(); const k = cycleKey(state.activeMascotKey, -1); if (k) applyMascot(k); };
    const bNext = mkBtn(IC.next, "Next");
    bNext.onclick = e => { e.stopPropagation(); const k = cycleKey(state.activeMascotKey, 1); if (k) applyMascot(k); };
    const sel = document.createElement("select"); sel.className = "msel";
    populateSel(sel);
    sel.onchange = e => { e.stopPropagation(); if (sel.value) applyMascot(sel.value); };

    const srow = document.createElement("div"); srow.className = "srow";
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "8"; slider.max = "85"; slider.step = "1";
    slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw);
    const rvlbl = document.createElement("span"); rvlbl.className = "rvlbl";
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
        if (open) { slider.value = Math.round(parseFloat(container.style.width) || CFG.defaultVw); rvlbl.textContent = slider.value + "vw"; }
        repositionPanel();
    };
    const bClose = mkBtn(IC.close, "Close");
    bClose.onclick = e => { e.stopPropagation(); closePanel(); };
    row1.append(bPrev, bNext, sel, bResize, bClose);

    /* ── Row 2: add/del/export/import ── */
    const row2 = document.createElement("div"); row2.className = "brow";
    const bAdd = mkBtn(IC.add, "Add mascot from URL");
    bAdd.onclick = async e => {
        e.stopPropagation();
        const url = prompt("Image URL (direct link to PNG/GIF/WebP/JPG):");
        if (!url?.trim()) return;
        let name = prompt("Name for this mascot:");
        if (!name?.trim()) return;
        name = slugify(name);
        const key = CFG.prefix + name;
        try { if (GM_getValue(key)) { alert(`"${name}" already exists.`); return; } } catch(e) {}
        bAdd.innerHTML = IC.spin; bAdd.classList.add("spin");
        try {
            const blob = await fetchBlob(url.trim());
            const b64  = await toBase64(blob);
            GM_setValue(key, b64);
            applyMascot(key);
            buildPanel();
        } catch (err) {
            alert("Could not fetch that image. Check the URL and try again.");
            bAdd.innerHTML = IC.add; bAdd.classList.remove("spin");
        }
    };
    const bDel = mkBtn(IC.del, "Delete active mascot", "danger");
    bDel.onclick = e => {
        e.stopPropagation();
        const k = state.activeMascotKey;
        if (!k) { alert("No mascot is active."); return; }
        if (!confirm(`Delete "${getName(k)}"?\n\nNote: any playlists containing this mascot will keep the slot (it will skip gracefully).`)) return;
        const nxt = cycleKey(k, 1);
        try { GM_deleteValue(k); } catch(e) {}
        if (nxt && nxt !== k) { applyMascot(nxt); } else {
            img.src = ""; img.style.opacity = "0";
            state.activeMascotKey = null;
            saveState({ activeMascotKey: null });
            syncPlaceholder(); buildPanel();
        }
    };
    const bExp = mkBtn(IC.export, "Export all mascots + playlists");
    bExp.onclick = e => { e.stopPropagation(); exportMascots(); };
    const bImp = mkBtn(IC.import, "Import from JSON");
    bImp.onclick = e => { e.stopPropagation(); importMascots(() => { syncPlaceholder(); buildPanel(); }); };
    row2.append(bAdd, bDel, mkSep(), bExp, bImp);

    panel.append(row1, srow, row2);

    /* ══════════════════════════════
       PLAYLIST SECTION
    ══════════════════════════════ */
    panel.appendChild(mkSecDiv("Playlists"));

    /* Now-playing bar */
    const plPlaying = document.createElement("div");
    plPlaying.className = "pl-playing";
    plPlaying.innerHTML = `
        <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:4px;">
                <span class="pl-now-name">—</span>
                <span class="pl-now-idx"></span>
            </div>
            <div class="pl-bar-wrap"><div class="pl-bar-fill"></div></div>
        </div>
    `;
    _plProgressEl = plPlaying;
    _plNowName    = plPlaying.querySelector(".pl-now-name");
    _plNowIdx     = plPlaying.querySelector(".pl-now-idx");
    _plBarFill    = plPlaying.querySelector(".pl-bar-fill");
    panel.appendChild(plPlaying);

    /* Playlist select + play/stop/edit/new row */
    const plSelRow = document.createElement("div");
    plSelRow.className = "pl-selrow brow";

    const plSel = document.createElement("select");
    plSel.className = "msel";
    plSel.style.fontSize = "10px";
    populatePlSel(plSel);
    plSel.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });

    const bPlay = mkBtn(IC.play, "Play playlist", "accent");
    bPlay.id = "pl-play-btn";
    bPlay.onclick = e => {
        e.stopPropagation();
        const key = plSel.value;
        if (!key) { alert("Select a playlist first."); return; }
        try {
            const pl = JSON.parse(GM_getValue(key, "null"));
            if (!pl) { alert("Playlist not found."); return; }
            // Filter out any items whose mascot key no longer exists
            const validKeys = new Set(getKeys());
            pl.items = pl.items.filter(item => validKeys.has(item.key));
            if (!pl.items.length) { alert("This playlist has no valid mascots. Please edit it."); return; }
            playlistRuntime.start(pl);
            refreshPlaylistUI();
        } catch(err) { alert("Could not start playlist."); }
    };

    const bStop = mkBtn(IC.stop, "Stop playlist", "warn");
    bStop.id = "pl-stop-btn";
    bStop.style.display = "none";
    bStop.onclick = e => {
        e.stopPropagation();
        playlistRuntime.stop();
        refreshPlaylistUI();
    };

    const bEdit = mkBtn(IC.edit, "Edit selected playlist");
    bEdit.onclick = e => {
        e.stopPropagation();
        const key = plSel.value;
        if (!key) { openNewPlaylistEditor(); return; }
        try {
            const pl = JSON.parse(GM_getValue(key, "null"));
            if (pl) openEditPlaylistEditor(key, pl);
        } catch(err) {}
    };

    const bNewPl = mkBtn(IC.plus, "New playlist");
    bNewPl.onclick = e => { e.stopPropagation(); openNewPlaylistEditor(); };

    const bDelPl = mkBtn(IC.del, "Delete selected playlist", "danger");
    bDelPl.onclick = e => {
        e.stopPropagation();
        const key = plSel.value;
        if (!key) { alert("Select a playlist to delete."); return; }
        const plName = key.slice(CFG.playlistPrefix.length);
        if (!confirm(`Delete playlist "${plName}"?`)) return;
        if (playlistRuntime.isActive() && playlistRuntime.playlist?.name === plName) {
            playlistRuntime.stop();
        }
        deletePlaylist(key);
        buildPanel();
    };

    plSelRow.append(plSel, bPlay, bStop, bEdit, bNewPl, bDelPl);
    panel.appendChild(plSelRow);

    /* If playlist is already active when panel opens, restore progress display */
    if (playlistRuntime.isActive()) {
        bStop.style.display = "";
        bPlay.style.display = "none";
        plPlaying.classList.add("visible");
        const pl = playlistRuntime.playlist;
        if (pl && _plNowName) {
            const curIdx = playlistRuntime.order === "random"
                ? (playlistRuntime.usedIndices.at(-1) ?? 0)
                : ((playlistRuntime.idx - 1 + pl.items.length) % pl.items.length);
            _plNowName.textContent = getName(pl.items[curIdx]?.key || "");
            _plNowIdx.textContent  = `${curIdx+1}/${pl.items.length}`;
        }
    }

    /* ── Playlist Editor (inline, toggleable) ── */
    const plEditor = document.createElement("div");
    plEditor.className = "pl-editor";
    if (editorState.open) plEditor.classList.add("open");
    buildPlaylistEditorContent(plEditor);
    panel.appendChild(plEditor);

    repositionPanel();
}

/* ═══════════════════════════════════════════
   PLAYLIST EDITOR CONTENT
═══════════════════════════════════════════ */
function openNewPlaylistEditor() {
    editorState.open = true;
    editorState.editingKey = null;
    editorState.items = [];
    editorState.order = "sequence";
    buildPanel();
    repositionPanel();
}
function openEditPlaylistEditor(key, pl) {
    editorState.open = true;
    editorState.editingKey = key;
    editorState.items = pl.items.map(i => ({ ...i }));
    editorState.order = pl.order || "sequence";
    buildPanel();
    repositionPanel();
}

function buildPlaylistEditorContent(editorEl) {
    editorEl.innerHTML = "";

    const title = document.createElement("div");
    title.className = "pl-editor-title";
    title.textContent = editorState.editingKey
        ? `Edit: ${editorState.editingKey.slice(CFG.playlistPrefix.length)}`
        : "New Playlist";
    editorEl.appendChild(title);

    /* Item list */
    const listEl = document.createElement("div");
    listEl.className = "pl-item-list";
    renderEditorItems(listEl);
    editorEl.appendChild(listEl);

    /* Add-item row */
    const addRow = document.createElement("div");
    addRow.className = "pl-addrow";

    const addSel = document.createElement("select");
    addSel.className = "msel";
    addSel.style.fontSize = "10px";
    getKeys().forEach(k => {
        const o = document.createElement("option");
        o.value = k; o.textContent = getName(k);
        addSel.appendChild(o);
    });
    if (!getKeys().length) {
        const o = document.createElement("option"); o.textContent = "—"; o.disabled = true;
        addSel.appendChild(o);
    }

    const durInput = document.createElement("input");
    durInput.type = "number"; durInput.className = "pl-dur-input";
    durInput.min = "1"; durInput.max = "3600"; durInput.step = "1"; durInput.value = "5";
    durInput.placeholder = "sec";
    durInput.title = "Duration in seconds";

    const bAddItem = document.createElement("button");
    bAddItem.className = "pl-save-btn";
    bAddItem.style.cssText = "height:25px;padding:0 8px;font-size:10px;";
    bAddItem.textContent = "+ Add";
    bAddItem.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    bAddItem.onclick = e => {
        e.stopPropagation();
        const k   = addSel.value;
        const dur = parseInt(durInput.value, 10);
        if (!k) { alert("No mascots available."); return; }
        if (!dur || dur < 1) { alert("Enter a duration ≥ 1 second."); return; }
        editorState.items.push({ key: k, duration: dur });
        renderEditorItems(listEl);
        repositionPanel();
    };

    addRow.append(addSel, durInput, bAddItem);
    editorEl.appendChild(addRow);

    /* Order toggle */
    const orderRow = document.createElement("div");
    orderRow.className = "pl-order-row";
    const orderLbl = document.createElement("span");
    orderLbl.className = "pl-order-lbl";
    orderLbl.textContent = "Play order:";
    const orderToggle = document.createElement("div");
    orderToggle.className = "pl-order-toggle";
    const bSeq = document.createElement("button"); bSeq.textContent = "Sequence";
    const bRnd = document.createElement("button"); bRnd.textContent = "Random";
    bSeq.classList.toggle("active", editorState.order === "sequence");
    bRnd.classList.toggle("active", editorState.order === "random");
    bSeq.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    bRnd.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    bSeq.onclick = e => { e.stopPropagation(); editorState.order = "sequence"; bSeq.classList.add("active"); bRnd.classList.remove("active"); };
    bRnd.onclick = e => { e.stopPropagation(); editorState.order = "random";   bRnd.classList.add("active"); bSeq.classList.remove("active"); };
    orderToggle.append(bSeq, bRnd);
    orderRow.append(orderLbl, orderToggle);
    editorEl.appendChild(orderRow);

    /* Save row */
    const saveRow = document.createElement("div");
    saveRow.className = "pl-save-row";
    const nameInput = document.createElement("input");
    nameInput.type = "text"; nameInput.className = "pl-name-input";
    nameInput.placeholder = "Playlist name…";
    nameInput.maxLength = 40;
    if (editorState.editingKey) nameInput.value = editorState.editingKey.slice(CFG.playlistPrefix.length);
    nameInput.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });

    const bCancel = document.createElement("button");
    bCancel.className = "pl-save-btn";
    bCancel.style.cssText = "background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#6c7386;height:25px;padding:0 8px;font-size:10px;";
    bCancel.textContent = "Cancel";
    bCancel.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    bCancel.onclick = e => { e.stopPropagation(); editorState.open = false; buildPanel(); };

    const bSave = document.createElement("button");
    bSave.className = "pl-save-btn";
    bSave.style.cssText = "height:25px;padding:0 10px;font-size:10px;";
    bSave.textContent = "Save";
    bSave.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
    bSave.onclick = e => {
        e.stopPropagation();
        const rawName = nameInput.value.trim();
        if (!rawName) { alert("Give the playlist a name."); return; }
        if (!editorState.items.length) { alert("Add at least one mascot to the playlist."); return; }
        const name    = slugify(rawName);
        const newKey  = CFG.playlistPrefix + name;

        // If renaming, delete the old key
        if (editorState.editingKey && editorState.editingKey !== newKey) {
            deletePlaylist(editorState.editingKey);
        }
        savePlaylist({ name, items: editorState.items.map(it => ({ key: it.key, duration: Math.max(1, Number(it.duration) || 5) })), order: editorState.order });
        editorState.open = false;
        buildPanel();
        // Select the newly saved playlist in the selector
        setTimeout(() => {
            const s = panel.querySelector(".pl-selrow .msel");
            if (s) s.value = newKey;
        }, 50);
    };

    saveRow.append(nameInput, bCancel, bSave);
    editorEl.appendChild(saveRow);
}

function renderEditorItems(listEl) {
    listEl.innerHTML = "";
    if (!editorState.items.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "font:400 9px system-ui,sans-serif;color:rgba(140,160,200,.35);text-align:center;padding:8px 0;";
        empty.textContent = "No items yet — add mascots below";
        listEl.appendChild(empty);
        return;
    }
    editorState.items.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "pl-item";

        // Drag handle reorder up/down (compact: just ↑↓ text buttons)
        const bUp = document.createElement("button");
        bUp.className = "pl-item-del"; bUp.title = "Move up";
        bUp.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
        bUp.style.color = "rgba(137,180,250,.5)";
        bUp.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
        bUp.onclick = e => {
            e.stopPropagation();
            if (i === 0) return;
            [editorState.items[i-1], editorState.items[i]] = [editorState.items[i], editorState.items[i-1]];
            renderEditorItems(listEl); repositionPanel();
        };

        const bDn = document.createElement("button");
        bDn.className = "pl-item-del"; bDn.title = "Move down";
        bDn.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        bDn.style.color = "rgba(137,180,250,.5)";
        bDn.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
        bDn.onclick = e => {
            e.stopPropagation();
            if (i >= editorState.items.length - 1) return;
            [editorState.items[i+1], editorState.items[i]] = [editorState.items[i], editorState.items[i+1]];
            renderEditorItems(listEl); repositionPanel();
        };

        const nameSpan = document.createElement("span");
        nameSpan.className = "pl-item-name";
        nameSpan.textContent = getName(item.key);

        // Editable duration
        const durInput = document.createElement("input");
        durInput.type = "number"; durInput.min = "1"; durInput.max = "3600"; durInput.step = "1";
        durInput.value = item.duration;
        durInput.style.cssText = "width:40px;height:20px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);border-radius:5px;color:#89b4fa;font:600 10px system-ui,sans-serif;padding:0 4px;text-align:center;outline:none;box-sizing:border-box;";
        durInput.title = "Duration (seconds)";
        durInput.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
        durInput.oninput = () => { const v = parseInt(durInput.value, 10); if (v >= 1) { editorState.items[i].duration = v; } };

        const durLbl = document.createElement("span");
        durLbl.style.cssText = "font:400 8px system-ui,sans-serif;color:rgba(140,160,200,.4);flex-shrink:0;";
        durLbl.textContent = "s";

        const bDel = document.createElement("button");
        bDel.className = "pl-item-del"; bDel.title = "Remove";
        bDel.innerHTML = IC.x;
        bDel.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
        bDel.onclick = e => {
            e.stopPropagation();
            editorState.items.splice(i, 1);
            renderEditorItems(listEl); repositionPanel();
        };

        row.append(bUp, bDn, nameSpan, durInput, durLbl, bDel);
        listEl.appendChild(row);
    });
}

/* ═══════════════════════════════════════════
   PANEL HELPERS
═══════════════════════════════════════════ */
function populateSel(sel) {
    const keys = getKeys();
    sel.innerHTML = "";
    if (!keys.length) {
        const o = document.createElement("option"); o.textContent = "—"; o.disabled = true; sel.appendChild(o); return;
    }
    keys.forEach(k => {
        const o = document.createElement("option");
        o.value = k; o.textContent = getName(k);
        if (k === state.activeMascotKey) o.selected = true;
        sel.appendChild(o);
    });
}

function populatePlSel(sel) {
    const pls = loadPlaylists();
    sel.innerHTML = "";
    const keys = Object.keys(pls);
    if (!keys.length) {
        const o = document.createElement("option"); o.textContent = "No playlists"; o.disabled = true; sel.appendChild(o); return;
    }
    keys.forEach(k => {
        const o = document.createElement("option");
        o.value = k; o.textContent = pls[k].name + ` (${pls[k].items.length})`;
        sel.appendChild(o);
    });
}

function refreshPanel() {
    if (!panelOpen) return;
    const nameEl = panel.querySelector(".pname");
    if (nameEl) nameEl.textContent = getName(state.activeMascotKey) || "—";
    const sel = panel.querySelector("select.msel");
    if (sel) { populateSel(sel); if (state.activeMascotKey) sel.value = state.activeMascotKey; }
}

/* ═══════════════════════════════════════════
   PANEL OPEN / CLOSE / FLIP
═══════════════════════════════════════════ */
function repositionPanel() {
    const r = container.getBoundingClientRect();
    const flip = r.bottom > innerHeight * 0.55;
    panel.classList.toggle("flip", flip);
    const rightOverflow = r.left + 220 > innerWidth - 8;
    panel.style.left  = rightOverflow ? "auto" : "0";
    panel.style.right = rightOverflow ? "0"    : "auto";
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
    editorState.open = false;
}

_openPanelRef = openPanel;

placeholder.addEventListener("click",    e => { e.stopPropagation(); openPanel(); });
placeholder.addEventListener("touchend", e => { e.stopPropagation(); openPanel(); }, { passive: true });

dbg("✅ Mascot Overlay v14.0 fully initialised — playlists enabled");

})();
