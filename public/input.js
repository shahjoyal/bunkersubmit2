/* input.js — supports per-cell coal selection (per-bunker per-layer) and backward-compatible server payload */
var API_BASE = window.location.origin + '/api';
var latestBlendId = null;
window.COAL_DB = window.COAL_DB || [];
window.NUM_COAL_ROWS = window.NUM_COAL_ROWS || 5; // keep synchronized with HTML


// ---------- Unit / per-unit blend-id mapping (persisted) ----------
const BLEND_IDS_KEY = '__blendIdsByUnit_v1';

// default current unit (1..3)
window.currentUnit = Number(localStorage.getItem('currentUnit') || 1);

function readBlendIds(){
  try { return JSON.parse(localStorage.getItem(BLEND_IDS_KEY) || '{}'); }
  catch(e){ return {}; }
}
function writeBlendIds(obj){
  try { localStorage.setItem(BLEND_IDS_KEY, JSON.stringify(obj)); }
  catch(e){ /* ignore storage errors */ }
}

function setCurrentUnit(u){
  u = Number(u) || 1;
  if (u < 1) u = 1;
  if (u > 3) u = 3; // restrict to 1..3
  window.currentUnit = u;
  localStorage.setItem('currentUnit', String(u));

  // UI: mark active button + aria
  document.querySelectorAll('.unit-btn').forEach(btn => {
    const unit = Number(btn.dataset.unit || (Array.from(document.querySelectorAll('.unit-btn')).indexOf(btn) + 1));
    const active = (unit === u);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  // adjust Save button text so user knows which unit they're saving to
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = `Submit (Unit ${u})`;
}

// ---------- Server-backed unit mapping helpers (new) ----------
window.serverUnitMap = {}; // in-memory server mapping

async function fetchServerUnitMap(){
  try {
    const res = await fetch(API_BASE + '/units');
    if (!res.ok) {
      console.warn('fetchServerUnitMap failed', res.status);
      return {};
    }
    const map = await res.json();
    try { writeBlendIds(map); } catch(e){} // persist fallback
    window.serverUnitMap = map || {};
    return map || {};
  } catch(e) {
    console.warn('fetchServerUnitMap error', e);
    return {};
  }
}

async function ensureServerUnitMapping(){
  // first try fetch
  const map = await fetchServerUnitMap();
  const have3 = map && map['1'] && map['2'] && map['3'];
  if (have3) return map;
  // try to init server mapping (idempotent)
  try {
    const res = await fetch(API_BASE + '/units/init', { method: 'POST' });
    if (!res.ok) {
      console.warn('units/init failed', res.status);
      return await fetchServerUnitMap();
    }
    const data = await res.json();
    const createdMap = data.map || (data && data.map) || {};
    window.serverUnitMap = createdMap;
    try { writeBlendIds(createdMap); } catch(e){}
    return createdMap;
  } catch (e) {
    console.warn('ensureServerUnitMapping error', e);
    return {};
  }
}

async function getBlendIdForUnit(unit){
  unit = Number(unit || window.currentUnit || 1);
  if (!unit) return null;
  // prefer server in-memory map
  if (window.serverUnitMap && window.serverUnitMap[String(unit)]) return window.serverUnitMap[String(unit)];
  // fetch server map
  await fetchServerUnitMap();
  if (window.serverUnitMap && window.serverUnitMap[String(unit)]) return window.serverUnitMap[String(unit)];
  // fallback to localStorage mapping
  const local = readBlendIds();
  return local && local[unit] ? local[unit] : null;
}

// ---------- per-unit payload cache (client-side) ----------
const PAYLOAD_CACHE_KEY = '__blendPayloadByUnit_v1';

function readPayloadCache(){
  try { return JSON.parse(localStorage.getItem(PAYLOAD_CACHE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function writePayloadCache(obj){
  try { localStorage.setItem(PAYLOAD_CACHE_KEY, JSON.stringify(obj)); }
  catch(e){ /* ignore storage errors */ }
}

function initUnitButtons(){
  const btns = Array.from(document.querySelectorAll('.unit-btn'));
  btns.forEach((b, idx) => {
    const unit = idx + 1;
    b.dataset.unit = String(unit);
    b.addEventListener('click', () => setCurrentUnit(unit));
  });
  // ensure initial state set
  setCurrentUnit(window.currentUnit || 1);
}

// ---------- Performance improvements: in-memory cache, background fetch, deferred storage ----------

// In-memory cache (super fast reads/writes)
const inMemoryPayloadCache = {};

// Hydrate in-memory cache from localStorage on startup (non-blocking)
try {
  const persisted = readPayloadCache ? readPayloadCache() : null;
  if (persisted) Object.assign(inMemoryPayloadCache, persisted);
} catch(e){ console.warn('hydrate cache failed', e); }

// Deferred writes to localStorage (batching)
let _deferredPayloadWriteTimer = null;
function schedulePersistPayloadCache() {
  if (_deferredPayloadWriteTimer) return;
  // write after small delay so multiple rapid edits are batched
  _deferredPayloadWriteTimer = setTimeout(() => {
    try {
      writePayloadCache(inMemoryPayloadCache);
    } catch(e) { console.warn('persist payload cache failed', e); }
    _deferredPayloadWriteTimer = null;
  }, 300); // 300ms batch window
}

// Autosave debounce (reduced) and immediate in-memory save
const AUTOSAVE_DEBOUNCE_MS = 180; // reduced from 450 -> more responsive
function debounce(fn, wait){
  let t = null;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}
function saveTransientToMemory(){
  try {
    if (typeof collectFormData !== 'function') return;
    const unit = Number(window.currentUnit || localStorage.getItem('currentUnit') || 1);
    const payload = collectFormData();
    inMemoryPayloadCache[unit] = payload;       // instant
    schedulePersistPayloadCache();              // schedule async localStorage write
    // console.debug('[mem-cache] saved for unit', unit);
  } catch(e) { console.warn('saveTransientToMemory error', e); }
}
const debouncedTransientSave = debounce(saveTransientToMemory, AUTOSAVE_DEBOUNCE_MS);

// Attach autosave listeners once (event delegation would be even lighter if you prefer)
function attachAutosaveListenersOnce(){
  if (attachAutosaveListenersOnce._done) return;
  attachAutosaveListenersOnce._done = true;
  const root = document; // or a form container selector if you have one
  // listen for input/change on the form container and debounce saving
  root.addEventListener('input', debouncedTransientSave, { passive: true });
  root.addEventListener('change', debouncedTransientSave, { passive: true });
}
document.addEventListener('DOMContentLoaded', attachAutosaveListenersOnce);

// Fast, non-blocking unit switch: populate from in-memory cache immediately, fetch server in background
function setCurrentUnitFast(u){
  try {
    // Save current transient to memory first (synchronous)
    try { saveTransientToMemory(); } catch(e){}

    // normalize and persist selector
    u = Number(u) || 1;
    if (u < 1) u = 1; if (u > 3) u = 3;
    window.currentUnit = u;
    localStorage.setItem('currentUnit', String(u));
    document.querySelectorAll('.unit-btn').forEach(btn=>{
      const unit = Number(btn.dataset.unit || (Array.from(document.querySelectorAll('.unit-btn')).indexOf(btn) + 1));
      const active = (unit === u);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const saveBtn = document.getElementById('saveBtn'); if (saveBtn) saveBtn.textContent = `Submit (Unit ${u})`;

    // Instant render: read from in-memory cache (no JSON.parse, no blocking)
    if (inMemoryPayloadCache[u]) {
      populateFormFromPayload(inMemoryPayloadCache[u]);
    } else {
      // if nothing in mem cache, try reading localStorage quick (fallback) but don't block UI
      const ls = localStorage.getItem('__blendPayloadByUnit_v1');
      if (ls) {
        try {
          const parsed = JSON.parse(ls);
          if (parsed && parsed[u]) {
            inMemoryPayloadCache[u] = parsed[u];
            populateFormFromPayload(parsed[u]);
          } else {
            clearFormForUnitUI(); // nothing
          }
        } catch(e) {
          clearFormForUnitUI();
        }
      } else {
        clearFormForUnitUI();
      }
    }

    // Background: fetch authoritative payload from server if an id exists.
    // DO NOT await it here; let it update UI when available.
    (async function backgroundFetch(){
      try {
        const id = await getBlendIdForUnit(u);
        if (!id) return;
        const res = await fetch(API_BASE + '/blend/' + id);
        if (!res.ok) return;
        const data = await res.json();
        const payload = data.payload || data.data || data;
        // If server payload differs from mem cache, update UI and mem cache.
        // Quick shallow compare: stringify sizes (cheap)
        try {
          const oldStr = JSON.stringify(inMemoryPayloadCache[u] || {});
          const newStr = JSON.stringify(payload || {});
          if (oldStr !== newStr) {
            inMemoryPayloadCache[u] = payload;
            populateFormFromPayload(payload);
            schedulePersistPayloadCache(); // persist new authoritative payload
          }
        } catch(e){}
      } catch(e){ /* background fetch failed - ignore */ }
    })();

    // Prefetch other units in background (non-blocking)
    prefetchOtherUnits(u);

    // reattach autosave listeners if DOM changed (cheap)
    setTimeout(attachAutosaveListenersOnce, 120);
  } catch(e){ console.error('setCurrentUnitFast error', e); }
}
window.setCurrentUnit = setCurrentUnitFast;

// Prefetch other units' payloads (start after small delay so initial load isn't blocked)
function prefetchOtherUnits(current){
  setTimeout(async ()=>{
    try {
      // get mapping from server if present
      await fetchServerUnitMap();
      for (let u = 1; u <= 3; u++) {
        if (u === current) continue;
        if (inMemoryPayloadCache[u]) continue; // already cached
        const id = (window.serverUnitMap && window.serverUnitMap[String(u)]) ? window.serverUnitMap[String(u)] : (readBlendIds()[u] || null);
        if (!id) continue;
        fetch(API_BASE + '/blend/' + id)
          .then(r => { if(!r.ok) throw r; return r.json(); })
          .then(d => {
            const p = d.payload || d.data || d;
            inMemoryPayloadCache[u] = p;
            schedulePersistPayloadCache();
          })
          .catch(()=>{ /* ignore prefetch errors */ });
      }
    } catch(e){ /* ignore */ }
  }, 240); // small delay so user experience is prioritized
}


/* helpers */
function _getEl(id){ return document.getElementById(id) || null; }
function _getElVal(id){ var e=_getEl(id); return e ? (e.value||'') : ''; }
function _parseFloatSafe(v){ var n=parseFloat(v); return isNaN(n)?0:n; }

/* --- per-cell storage helpers (create hidden inputs to store per-bunker selections) --- */
function cellCoalInputId(row, mill){ return `coal_cell_r${row}_m${mill}`; }
function cellGcvInputId(row, mill){ return `gcv_cell_r${row}_m${mill}`; }
function cellCostInputId(row, mill){ return `cost_cell_r${row}_m${mill}`; }

function ensureHiddenInput(id){
  var el = document.getElementById(id);
  if(!el){
    el = document.createElement('input');
    el.type = 'hidden';
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

function setCellCoal(row, mill, coalId){
  if(!row || typeof mill === 'undefined') return;
  ensureHiddenInput(cellCoalInputId(row,mill)).value = coalId || '';
  // also set hidden gcv/cost from DB if available
  var coalObj = findCoalInDB(coalId);
  if(coalObj){
    ensureHiddenInput(cellGcvInputId(row,mill)).value = coalObj.gcv || '';
    ensureHiddenInput(cellCostInputId(row,mill)).value = coalObj.cost || '';
  } else {
    // clear if no coalObj
    ensureHiddenInput(cellGcvInputId(row,mill)).value = '';
    ensureHiddenInput(cellCostInputId(row,mill)).value = '';
  }
}

// ---------- Unit data loader / form population (client-side) ----------
// Requires: readBlendIds(), writeBlendIds(), API_BASE, populateHiddenDropdownsAndPopup()
// and functions: updateBunkerColors(), calculateBlended(), validateMillPercentages(), updateBunkerTotalsUI()

/**
 * Clear the entire form (so switching to an empty unit shows a blank form)
 */
function clearFormForUnitUI() {
  const N = getNumRows ? getNumRows() : (window.NUM_COAL_ROWS || 5);

  // clear row global selects
  for (let r = 1; r <= N; r++) {
    const sel = document.getElementById('coalName' + r);
    if (sel) sel.value = '';
    const gcv = document.getElementById('gcvBox' + r);
    if (gcv) gcv.value = '';
    const cost = document.getElementById('costBox' + r);
    if (cost) cost.value = '';
    // clear per-cell hidden inputs for each mill
    for (let m = 0; m < 8; m++) {
      const pct = document.querySelector(`.percentage-input[data-row="${r}"][data-mill="${m}"]`);
      if (pct) { pct.value = ''; pct.dispatchEvent(new Event('input', { bubbles: true })); }
      const hidCoal = document.getElementById(`coal_cell_r${r}_m${m}`);
      if (hidCoal) hidCoal.value = '';
      const hidG = document.getElementById(`gcv_cell_r${r}_m${m}`);
      if (hidG) hidG.value = '';
      const hidC = document.getElementById(`cost_cell_r${r}_m${m}`);
      if (hidC) hidC.value = '';
      const hidSeq = document.getElementById(`seq_cell_r${r}_m${m}`);
      if (hidSeq) hidSeq.value = '';
    }
  }

  // clear flows
  document.querySelectorAll('.flow-input[data-mill]').forEach(fi => {
    if (!fi.classList.contains('total-inputs') && !fi.classList.contains('timers-input')) {
      fi.value = '';
      fi.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // clear generation / bunkerCapacity
  const gen = document.getElementById('generation'); if (gen) gen.value = '';
  const cap = document.getElementById('bunkerCapacity'); if (cap) cap.value = '';

  // clear totals / timers
  document.querySelectorAll('.total-inputs').forEach(t => { t.value = ''; });
  document.querySelectorAll('.timers-input').forEach(t => { t.value = '--'; t.dataset.seconds = '0'; });

  // clear color map for UI (keep persisted map if present)
  try {
    // don't erase local saved map — just refresh UI color setting
  } catch(e){}

  // run updates
  if (typeof updateBunkerColors === 'function') updateBunkerColors();
  if (typeof calculateBlended === 'function') calculateBlended();
  if (typeof validateMillPercentages === 'function') validateMillPercentages();
  if (typeof updateBunkerTotalsUI === 'function') updateBunkerTotalsUI();
}

/**
 * Populate DOM from payload object returned by server (payload shape matches collectFormData())
 * This does best-effort mapping and calls compute/update hooks at the end.
 */
function populateFormFromPayload(payload) {
  try {
    if (!payload) { clearFormForUnitUI(); return; }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const N = Math.max(getNumRows ? getNumRows() : (window.NUM_COAL_ROWS || 5), rows.length || 0);

    // make sure dropdown/options exist
    if (typeof populateHiddenDropdownsAndPopup === 'function') {
      // ensure popup & row selects populated so setting .value works
      // it's async and preserves previous values; wait for it
      // NOTE: caller usually awaited this function; if not present we continue
      try { populateHiddenDropdownsAndPopup(); } catch (e) { /* ignore */ }
    }

    // Rows: set global selects or per-cell inputs + gcv/cost
    for (let r = 1; r <= N; r++) {
      const rowObj = rows[r - 1] || { coal: '', percentages: Array(8).fill(0), gcv: '', cost: '' };
      const coalVal = rowObj.coal;
      // if coalVal is an object mapping (per mill) set per-cell hidden; else if string set global select
      if (coalVal && typeof coalVal === 'object' && !Array.isArray(coalVal)) {
        // per-mill mapping
        for (let m = 0; m < 8; m++) {
          const id = coalVal[String(m)] || '';
          const hid = ensureHiddenInput(`coal_cell_r${r}_m${m}`) || document.getElementById(`coal_cell_r${r}_m${m}`);
          if (hid) hid.value = id;
        }
        // set global select to '' (can't represent mapping)
        const gsel = document.getElementById('coalName' + r); if (gsel) gsel.value = '';
      } else {
        // string or empty - set global select and clear per-cell storages
        const gsel = document.getElementById('coalName' + r);
        if (gsel) gsel.value = coalVal || '';
        for (let m = 0; m < 8; m++) {
          const hid = document.getElementById(`coal_cell_r${r}_m${m}`);
          if (hid) hid.value = '';
        }
      }

      // set gcv/cost (row-level)
      const gcvEl = document.getElementById('gcvBox' + r);
      if (gcvEl) gcvEl.value = (rowObj.gcv !== undefined && rowObj.gcv !== null) ? String(rowObj.gcv) : '';
      const costEl = document.getElementById('costBox' + r);
      if (costEl) costEl.value = (rowObj.cost !== undefined && rowObj.cost !== null) ? String(rowObj.cost) : '';

      // percentages array
      const pArr = Array.isArray(rowObj.percentages) ? rowObj.percentages : (rowObj.percent || Array(8).fill(0));
      for (let m = 0; m < 8; m++) {
        const pctEl = document.querySelector(`.percentage-input[data-row="${r}"][data-mill="${m}"]`);
        if (pctEl) {
          const v = (pArr[m] === undefined || pArr[m] === null) ? '' : String(Number(pArr[m]) || 0);
          pctEl.value = (v === '0' ? '' : v); // keep 0 empty for nicer UI; compute functions will treat '' as 0
          pctEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }

    // Flows
    if (Array.isArray(payload.flows)) {
      for (let m = 0; m < payload.flows.length && m < 8; m++) {
        const fEl = document.querySelector(`.flow-input[data-mill="${m}"]`);
        if (fEl && !fEl.classList.contains('total-inputs') && !fEl.classList.contains('timers-input')) {
          fEl.value = (payload.flows[m] === undefined || payload.flows[m] === null) ? '' : String(payload.flows[m]);
          fEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }

    // generation / bunkerCapacity
    if (payload.generation !== undefined && document.getElementById('generation')) document.getElementById('generation').value = String(payload.generation);
    if (payload.bunkerCapacity !== undefined && document.getElementById('bunkerCapacity')) document.getElementById('bunkerCapacity').value = String(payload.bunkerCapacity);

    // per-bunker capacities (array)
    if (Array.isArray(payload.bunkerCapacities)) {
      for (let bi = 0; bi < Math.min(8, payload.bunkerCapacities.length); bi++) {
        const el = document.querySelector(`.bunker-capacity[data-mill="${bi}"]`) || document.getElementById('bunkerCapacity' + bi);
        if (el) el.value = String(payload.bunkerCapacities[bi] || '');
      }
    }

    // coalColorMap persistence (optional)
    if (payload.coalColorMap && typeof payload.coalColorMap === 'object') {
      try {
        const existing = JSON.parse(localStorage.getItem('__coalColorMap_v2') || '{}');
        const merged = Object.assign({}, existing, payload.coalColorMap);
        localStorage.setItem('__coalColorMap_v2', JSON.stringify(merged));
      } catch(e){}
    }

    // run the UI updates
    if (typeof updateBunkerColors === 'function') updateBunkerColors();
    if (typeof calculateBlended === 'function') calculateBlended();
    if (typeof validateMillPercentages === 'function') validateMillPercentages();
    if (typeof updateBunkerTotalsUI === 'function') updateBunkerTotalsUI();

  } catch (err) {
    console.error('populateFormFromPayload error', err);
  }
}

/**
 * Load a unit's saved payload (if any) and populate UI.
 * - uses server mapping (getBlendIdForUnit)
 * - if id found -> GET /api/blend/:id and populate
 * - if no id -> clears the UI for an empty unit (or uses local cache)
 */
async function loadUnitData(unit) {
  try {
    unit = Number(unit) || window.currentUnit || 1;

    // 1) If we have a cached payload for this unit, populate immediately (instant UI)
    try {
      const cache = readPayloadCache();
      if (cache && cache[unit]) {
        console.info('[loadUnitData] populating from cache for unit', unit);
        populateFormFromPayload(cache[unit]);
      }
    } catch (e) { console.warn('payload cache read failed', e); }

    // 2) Now try to fetch server copy if we have an id; if server returns new payload, update UI & cache
    const id = await getBlendIdForUnit(unit);

    if (!id) {
      // no saved id -> if cache existed we already populated; if not, clear UI
      const cache = readPayloadCache();
      if (!cache || !cache[unit]) {
        console.info('[loadUnitData] no id and no cache for unit', unit, '-> clearing UI');
        clearFormForUnitUI();
      } else {
        console.info('[loadUnitData] no id but cache present for unit', unit);
      }
      return null;
    }

    // fetch server payload
    const res = await fetch(API_BASE + '/blend/' + id);
    if (!res.ok) {
      console.warn('[loadUnitData] failed to fetch unit payload from server:', res.status);
      // If fetch fails but cache exists we already showed cache; otherwise clear UI
      const cache = readPayloadCache();
      if (!cache || !cache[unit]) {
        clearFormForUnitUI();
      }
      return null;
    }

    const data = await res.json();
    const payload = (data && (data.rows || data.flows || data.clientBunkers)) ? data : (data && data.data ? data.data : data);

    // Ensure dropdowns / popup options exist before populating
    if (typeof populateHiddenDropdownsAndPopup === 'function') {
      try { await populateHiddenDropdownsAndPopup(); } catch(e){ /* ignore */ }
    }

    // Populate UI with server payload (and replace cache)
    populateFormFromPayload(payload);
    try {
      const cache = readPayloadCache();
      cache[unit] = payload;
      writePayloadCache(cache);
      inMemoryPayloadCache[unit] = payload; // also update fast memory
    } catch(e){ console.warn('failed to write server payload to cache', e); }

    console.info('[loadUnitData] loaded unit', unit, 'id', id);
    return payload;
  } catch (err) {
    console.error('[loadUnitData] error', err);
    // fall back to cache if available; else clear
    const cache = readPayloadCache();
    if (cache && cache[unit]) {
      populateFormFromPayload(cache[unit]);
      return cache[unit];
    }
    clearFormForUnitUI();
    return null;
  }
}


// Hook into unit switching: ensure setCurrentUnit triggers load
(function(){
  const origSet = window.setCurrentUnit;
  window.setCurrentUnit = function(u){
    // call existing (if previously defined) to keep UI button active text etc
    try { if (typeof origSet === 'function') origSet(u); else { /* call local if available */ } } catch(e){}
    // now load unit data (use server mapping under the hood)
    try { loadUnitData(u); } catch(e) { console.warn('loadUnitData failed for', u, e); }
  };
})();


function getCellCoalId(row, mill){
  var hid = document.getElementById(cellCoalInputId(row,mill));
  if(hid && hid.value) return hid.value;
  // fallback to global row select (backwards compat)
  var g = document.getElementById('coalName' + row);
  if(g && g.value) return g.value;
  return '';
}

function getCellGcv(row, mill){
  var hid = document.getElementById(cellGcvInputId(row,mill));
  if(hid && hid.value) return _parseFloatSafe(hid.value);
  // fallback to global gcv input
  var ge = _getEl('gcvBox' + row);
  if(ge && ge.value.trim()!=='') return _parseFloatSafe(ge.value);
  // fallback to DB if coal selected
  var id = getCellCoalId(row,mill);
  var co = findCoalInDB(id);
  return co ? (_parseFloatSafe(co.gcv) || 0) : 0;
}

function getCellCost(row, mill){
  var hid = document.getElementById(cellCostInputId(row,mill));
  if(hid && hid.value) return _parseFloatSafe(hid.value);
  var ce = _getEl('costBox' + row);
  if(ce && ce.value.trim()!=='') return _parseFloatSafe(ce.value);
  var id = getCellCoalId(row,mill);
  var co = findCoalInDB(id);
  return co ? (_parseFloatSafe(co.cost) || 0) : 0;
}

function findCoalInDB(idOrName){
  if(!idOrName) return null;
  var db = window.COAL_DB || [];
  for(var i=0;i<db.length;i++){
    if(String(db[i]._id) === String(idOrName) || String(db[i].id) === String(idOrName)) return db[i];
  }
  for(var j=0;j<db.length;j++){
    if(String((db[j].coal||'')).toLowerCase() === String(idOrName).toLowerCase()) return db[j];
  }
  return null;
}

/* --- data collection: builds rows[], flows[], generation --- 
     rows[].coal: if all mills for that row share same coal id -> store string
                   else store object { "0": "id0", "1": "id1", . } (mill index keys)
*/
// REPLACE existing collectFormData() with this version
// put this in input.js replacing the old collectFormData() (keeps same returned shape + clientBunkers)
function secondsToHHMMSS(secondsRaw) {
  if (!isFinite(secondsRaw) || secondsRaw === null) return '00:00:00';
  const s = Math.max(0, Math.round(secondsRaw));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function collectFormData(){
  var rows = [];
  var N = window.NUM_COAL_ROWS || 5;
  for(var r=1;r<=N;r++){
    var coalGlobal = _getEl('coalName' + r) ? _getEl('coalName' + r).value : '';
    var perCellMap = {};
    var anyPerCell = false;
    for(var m=0;m<8;m++){
      var cid = getCellCoalId(r,m) || '';
      if(cid && cid !== coalGlobal){
        anyPerCell = true;
      }
      if(cid) perCellMap[String(m)] = cid;
    }
    var coalField = anyPerCell ? perCellMap : (coalGlobal || '');
    var percentages = [];
    for(var mm=0; mm<8; mm++){
      var p = document.querySelector(`.percentage-input[data-row="${r}"][data-mill="${mm}"]`);
      percentages.push(p ? _parseFloatSafe(p.value) : 0);
    }
    var gcv = _parseFloatSafe(_getElVal('gcvBox'+r));
    var cost = _parseFloatSafe(_getElVal('costBox'+r));
    rows.push({ coal: coalField, percentages: percentages, gcv: gcv, cost: cost });
  }

  var flows = [];
  var flowEls = document.querySelectorAll('.flow-input');
  for(var i=0;i<flowEls.length;i++) flows.push(_parseFloatSafe(flowEls[i].value));

  var generation = _parseFloatSafe(_getElVal('generation'));
  var bunkerCapacity = _parseFloatSafe(_getElVal('bunkerCapacity'));

  var bunkerCapacities = [];
  for(var bi=0; bi<8; bi++){
    var capEl = document.querySelector(`.bunker-capacity[data-mill="${bi}"]`) || document.getElementById('bunkerCapacity' + bi);
    if(capEl){
      var v = (capEl.value !== undefined) ? capEl.value : (capEl.dataset && capEl.dataset.value ? capEl.dataset.value : capEl.textContent);
      bunkerCapacities.push(_parseFloatSafe(v));
    } else {
      bunkerCapacities.push(0);
    }
  }

  var coalColorMap = {};
  try {
    var rawMap = localStorage.getItem('__coalColorMap_v2');
    if (rawMap) coalColorMap = JSON.parse(rawMap);
  } catch (e) { coalColorMap = {}; }

  // --- NEW: build client-side bunker representation including timers ---
  var clientBunkers = [];
  for(var bi=0; bi<8; bi++){
    // computeLayerSeconds returns bottom->top seconds per your code
    var layerSeconds = (typeof computeLayerSeconds === 'function') ? (computeLayerSeconds(bi) || []) : [];
    var layers = [];
    for(var li=0; li<layerSeconds.length; li++){
      var seconds = layerSeconds[li];
      // determine the rowIndex that corresponds to this bottom->top element:
      // rowIndex (DOM row) = NUM_COAL_ROWS - li
      var rowIndex = (window.NUM_COAL_ROWS || 5) - li;
      // percent for that layer (bottom->top)
      var percent = parseFloat(document.querySelector(`.percentage-input[data-row="${rowIndex}"][data-mill="${bi}"]`)?.value) || 0;

      // try to fetch cell-level coal/gcv/cost/color if present
      var coalId = getCellCoalId(rowIndex, bi) || (document.getElementById('coalName' + rowIndex)?.value || '');
      var coalObj = findCoalInDB(coalId);
      var coalName = coalObj ? (coalObj.coal || coalObj.name || '') : (coalId || '');
      var gcv = getCellGcv(rowIndex, bi) || undefined;
      var cost = getCellCost(rowIndex, bi) || undefined;
      var color = (coalObj && coalObj.color) ? coalObj.color : ( (coalColorMap && coalColorMap[coalId]) ? coalColorMap[coalId] : undefined );

      layers.push({
        rowIndex: Number(rowIndex),
        coal: coalName,
        percent: Number(percent || 0),
        gcv: (gcv === 0 ? 0 : (gcv || undefined)),
        cost: (cost === 0 ? 0 : (cost || undefined)),
        color: color || undefined,
        timer: secondsToHHMMSS(seconds),
        rawSeconds: (isFinite(seconds) ? Math.round(seconds) : null)
      });
    }
    clientBunkers.push({ layers: layers });
  }

  return {
    rows: rows,
    flows: flows,
    generation: generation,
    ts: Date.now(),
    bunkerCapacity: bunkerCapacity,
    bunkerCapacities: bunkerCapacities,
    coalColorMap: coalColorMap,
    clientBunkers: clientBunkers   // <-- NEW
  };
}



/* fetch latest blend id and save/put (same as before) */
async function fetchLatestBlendId(){
  try{
    var res = await fetch(API_BASE + '/blend/latest');
    if(!res.ok) return null;
    var data = await res.json();
    return data._id || null;
  }catch(e){ return null; }
}

async function saveToServer(){
  try{
    console.log('[saveToServer] collecting payload.');
    var payload = collectFormData();
    console.log('[saveToServer] payload', payload);

    // read stored ids per unit (fallback), prefer server mapping
    var ids = readBlendIds();
    var unit = window.currentUnit || 1;
    var idForUnit = await getBlendIdForUnit(unit);

    // choose endpoint & method
    var url, method;
    if(idForUnit){
      url = API_BASE + '/blend/' + idForUnit;
      method = 'PUT';
    } else {
      url = API_BASE + '/blend';
      method = 'POST';
    }

    var res = await fetch(url, {
      method: method,
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if(!res.ok){
      var text;
      try{ text = await res.text(); }catch(e){ text = res.status; }
      alert('Failed to save: ' + text);
      return;
    }

    var data = await res.json();

    // server returns created/updated id (try common fields)
    var returnedId = data.id || data._id || null;

    // if we POSTed (no previous id), record the returned id for this unit
    if(!idForUnit && returnedId){
      // update local fallback mapping
      ids[unit] = returnedId;
      writeBlendIds(ids);
      // update server mapping so all clients will use same id going forward
      try {
        await fetch(API_BASE + '/units/' + unit, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blendId: returnedId })
        });
        // refresh server map after successful PUT
        await fetchServerUnitMap();
      } catch (e) {
        console.warn('Failed to update server unit mapping (PUT /api/units/:unit)', e);
      }
    }

    // Save payload to local cache for immediate restore on unit switch
    try {
      const cache = readPayloadCache();
      // Prefer server-normalized payload if server returned payload body (e.g. data.payload or data)
      const serverPayload = data.payload || data.data || null;
      cache[unit] = serverPayload || payload;
      writePayloadCache(cache);
      inMemoryPayloadCache[unit] = cache[unit];
    } catch(e){
      console.warn('failed to write payload cache', e);
    }

    // show user which unit / id saved
    var shownId = (window.serverUnitMap && window.serverUnitMap[unit]) || ids[unit] || returnedId || 'unknown';
    alert('Saved (unit: ' + unit + ' — id: ' + shownId + ')');
    console.log('[saveToServer] stored ids:', ids);

  }catch(e){
    console.error(e);
    alert('Network/save error: ' + (e && e.message ? e.message : e));
  }
}



/* --- load coal list and populate row global selects + popup --- */
async function tryFetchCoalEndpoints(){
  var endpoints = [API_BASE + '/coal', API_BASE + '/coals', API_BASE + '/coal/list', API_BASE + '/coalnames'];
  for(var i=0;i<endpoints.length;i++){
    try{
      var res = await fetch(endpoints[i]);
      if(!res.ok) continue;
      var data = await res.json();
      if(Array.isArray(data)) return data;
      if(Array.isArray(data.coals)) return data.coals;
      if(Array.isArray(data.data)) return data.data;
      if(Array.isArray(data.items)) return data.items;
      if(typeof data === 'object' && data !== null){
        var nested = data.docs || data.rows || data.list;
        if(Array.isArray(nested)) return nested;
      }
    }catch(e){ continue; }
  }
  return [];
}

async function loadCoalListAndPopulate(){
  var coals = await tryFetchCoalEndpoints();
  if(!coals || coals.length === 0){ console.warn('No coals fetched'); window.COAL_DB = []; return; }
  window.COAL_DB = coals;

  // populate global row selects (if present)
  for(var r=1;r<= (window.NUM_COAL_ROWS || 5); r++){
    var sel = document.getElementById('coalName' + r);
    if(!sel) continue;
    // clear existing
    sel.innerHTML = '<option value="">--select--</option>';
    coals.forEach(c => {
      var opt = document.createElement('option');
      opt.value = c._id || c.id || c.coal || '';
      opt.textContent = c.coal || (c.name || 'Unnamed');
      sel.appendChild(opt);
    });
  }
  // initial UI updates (colors/tooltips etc)
  if(typeof updateBunkerColors === 'function') updateBunkerColors();
  if(typeof calculateBlended === 'function') calculateBlended();
}




/* wire up onload */
window.addEventListener('load', async function(){
  // Ensure server has canonical 3 unit mappings (creates if missing)
  try { await ensureServerUnitMapping(); } catch(e){ console.warn('ensureServerUnitMapping failed', e); }

  loadCoalListAndPopulate().catch(e => console.error('[coal-helper] populate error', e));
  // small delayed init to ensure main calculations are present
  setTimeout(()=>{ if(typeof calculateBlended === 'function') calculateBlended(); if(typeof updateBunkerColors === 'function') updateBunkerColors(); }, 300);

  try { initUnitButtons(); } catch(e) { console.warn('initUnitButtons error', e); }
  try { setCurrentUnit(window.currentUnit || 1); } catch(e) { console.warn('setCurrentUnit error', e); }
});

/* --- helper: when user picks a coal per cell (mill) call setCellCoal(row,mill,coalId) --- */
/* Example: in your UI when user picks coal for bunker 2 (mill=1) for row 3 call setCellCoal(3,1,'<coal-id>') */

/* (other UI helpers such as updateBunkerColors / calculateBlended / tooltip code live in input.html and still work with this input.js) */
