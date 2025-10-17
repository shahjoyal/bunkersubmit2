/* input.js — supports per-cell coal selection (per-bunker per-layer) and backward-compatible server payload */
var API_BASE = window.location.origin + '/api';
var latestBlendId = null;
window.COAL_DB = window.COAL_DB || [];
window.NUM_COAL_ROWS = window.NUM_COAL_ROWS || 5; // keep synchronized with HTML

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
    if(!latestBlendId) latestBlendId = await fetchLatestBlendId();
    var url = latestBlendId ? (API_BASE + '/blend/' + latestBlendId) : (API_BASE + '/blend');
    var method = latestBlendId ? 'PUT' : 'POST';
    var res = await fetch(url, {
      method: method,
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if(!res.ok){
      var err;
      try{ err = await res.json(); }catch(e){ err = {error:'Unknown'} }
      alert('Failed to save: ' + (err.error || res.status));
      return;
    }
    var data = await res.json();
    latestBlendId = data.id || latestBlendId;
    alert('Saved (id: ' + (latestBlendId || 'unknown') + ')');
  }catch(e){ console.error(e); alert('Network/save error: ' + (e && e.message ? e.message : e)); }
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
window.addEventListener('load', function(){
  loadCoalListAndPopulate().catch(e => console.error('[coal-helper] populate error', e));
  // small delayed init to ensure main calculations are present
  setTimeout(()=>{ if(typeof calculateBlended === 'function') calculateBlended(); if(typeof updateBunkerColors === 'function') updateBunkerColors(); }, 300);
});

/* --- helper: when user picks a coal per cell (mill) call setCellCoal(row,mill,coalId) --- */
/* Example: in your UI when user picks coal for bunker 2 (mill=1) for row 3 call setCellCoal(3,1,'<coal-id>') */

/* (other UI helpers such as updateBunkerColors / calculateBlended / tooltip code live in input.html and still work with this input.js) */




