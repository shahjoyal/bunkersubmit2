// server.js (complete)
// Requirements: dotenv, express, mongoose, cors, multer, xlsx
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();

// Middleware - apply early
app.use(cors());
app.use(express.json());

// Serve static files from project root (so /public/input.html works)
app.use(express.static(path.join(__dirname)));

// Root route returning your input.html in public/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/login.html'));
});

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI not set in .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log('✅ MongoDB connected'))
  .catch(err=>{
    console.error('MongoDB connection error:', err.message || err);
    process.exit(1);
  });

/* -------------------- Coal model -------------------- */
const CoalSchema = new mongoose.Schema({
  coal: String,
  SiO2: Number,
  Al2O3: Number,
  Fe2O3: Number,
  CaO: Number,
  MgO: Number,
  Na2O: Number,
  K2O: Number,
  TiO2: Number,
  SO3: Number,
  P2O5: Number,
  Mn3O4: Number,
  SulphurS: Number,
  gcv: Number,
  cost: Number,
  // color field so same coal shows same color across all bunkers
  color: String
}, { collection: 'coals' });

const Coal = mongoose.model('Coal', CoalSchema);

/* -------------------- Blend model (rows + computed fields + bunkers) -------------------- */
const RowSchema = new mongoose.Schema({
  // coal: either a string (single coal) OR object mapping millIndex->coalRef (id or name)
  coal: { type: mongoose.Schema.Types.Mixed },
  percentages: [Number],
  gcv: Number,
  cost: Number
}, { _id: false });

const BlendSchema = new mongoose.Schema({
  rows: [RowSchema],
  flows: [Number],
  generation: Number,

  // store independent bunker info (array length 6): each has layers
  bunkers: [{
    layers: [{
      rowIndex: Number,
      coal: String,
      percent: Number,
      gcv: Number,
      cost: Number,
      color: String,    // <- persist the colour hex (e.g. "#aabbcc")
      timer: {
    type: String,
    default: '00:00:00', // format: HH:MM:SS
  },
    }]
  }],


  // add to BlendSchema definition (after generation:)
bunkerCapacity: { type: Number, default: 0 },          // global capacity (single input)
bunkerCapacities: { type: [Number], default: [] },     // per-bunker override array (length 6 expected)


  // computed fields
  totalFlow: { type: Number, default: 0 },
  avgGCV: { type: Number, default: 0 },
  avgAFT: { type: Number, default: null },
  heatRate: { type: Number, default: null },
  costRate: { type: Number, default: 0 },
  aftPerMill: { type: [Number], default: [] },           // length = 6
  blendedGCVPerMill: { type: [Number], default: [] },    // length = 6

  createdAt: { type: Date, default: Date.now }
});

const Blend = mongoose.model('Blend', BlendSchema);

/* -------------------- Upload (Excel -> Coal collection) -------------------- */
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post('/api/upload-coal', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);

    const coalData = jsonData.map(item => ({
      coal: item['Coal'] || item['coal'] || item['Name'] || '',
      SiO2: item['SiO2'] || item['SiO₂'] || 0,
      Al2O3: item['Al2O3'] || item['Al₂O₃'] || 0,
      Fe2O3: item['Fe2O3'] || item['Fe₂O₃'] || 0,
      CaO: item['CaO'] || 0,
      MgO: item['MgO'] || 0,
      Na2O: item['Na2O'] || 0,
      K2O: item['K2O'] || 0,
      TiO2: item['TiO2'] || 0,
      SO3: item['SO3'] || 0,
      P2O5: item['P2O5'] || 0,
      Mn3O4: item['Mn3O4'] || item['MN3O4'] || 0,
      SulphurS: item['Sulphur'] || item['SulphurS'] || 0,
      gcv: item['GCV'] || item['gcv'] || 0,
      cost: item['Cost'] || item['cost'] || 0,
      color: item['Color'] || item['color'] || item['colour'] || item['hex'] || ''
    }));

    // Replace existing coals with new upload (adjust if you prefer merge)
    await Coal.deleteMany();
    await Coal.insertMany(coalData);

    return res.json({ message: 'Coal data uploaded and saved to DB successfully' });
  } catch (err) {
    console.error('Error uploading coal data:', err);
    return res.status(500).json({ error: 'Failed to process Excel file' });
  }
});

/* -------------------- Coal GET endpoints (client expects these) -------------------- */
app.get('/api/coal', async (req, res) => {
  try {
    const items = await Coal.find().lean();
    return res.json(items);
  } catch (err) {
    console.error('GET /api/coal error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});
app.get('/api/coals', async (req, res) => {
  try {
    const items = await Coal.find().lean();
    return res.json(items);
  } catch (err) {
    console.error('GET /api/coals error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});
app.get('/api/coal/list', async (req, res) => {
  try {
    const items = await Coal.find().lean();
    return res.json(items);
  } catch (err) {
    console.error('GET /api/coal/list error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});
app.get('/api/coalnames', async (req, res) => {
  try {
    // minimal payload: _id and coal name
    const items = await Coal.find({}, { coal: 1 }).lean();
    return res.json(items);
  } catch (err) {
    console.error('GET /api/coalnames error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* -------------------- Server-side AFT formula -------------------- */
function calcAFT(ox) {
  // ox: { SiO2, Al2O3, Fe2O3, CaO, MgO, Na2O, K2O, SO3, TiO2 }
  const total = Object.keys(ox || {}).reduce((s, k) => s + (Number(ox[k]) || 0), 0);
  if (total === 0) return 0;
  const SiO2 = Number(ox.SiO2) || 0;
  const Al2O3 = Number(ox.Al2O3) || 0;
  const Fe2O3 = Number(ox.Fe2O3) || 0;
  const CaO = Number(ox.CaO) || 0;
  const MgO = Number(ox.MgO) || 0;
  const Na2O = Number(ox.Na2O) || 0;
  const K2O = Number(ox.K2O) || 0;
  const SO3 = Number(ox.SO3) || 0;
  const TiO2 = Number(ox.TiO2) || 0;

  const sum = SiO2 + Al2O3;
  let aft = 0;
  if (sum < 55) {
    aft = 1245 + (1.1 * SiO2) + (0.95 * Al2O3) - (2.5 * Fe2O3) - (2.98 * CaO) - (4.5 * MgO)
      - (7.89 * (Na2O + K2O)) - (1.7 * SO3) - (0.63 * TiO2);
  } else if (sum < 75) {
    aft = 1323 + (1.45 * SiO2) + (0.683 * Al2O3) - (2.39 * Fe2O3) - (3.1 * CaO) - (4.5 * MgO)
      - (7.49 * (Na2O + K2O)) - (2.1 * SO3) - (0.63 * TiO2);
  } else {
    aft = 1395 + (1.2 * SiO2) + (0.9 * Al2O3) - (2.5 * Fe2O3) - (3.1 * CaO) - (4.5 * MgO)
      - (7.2 * (Na2O + K2O)) - (1.7 * SO3) - (0.63 * TiO2);
  }
  return Number(aft);
}

/* -------------------- compute blend metrics (per-mill aware) -------------------- */
// async function computeBlendMetrics(rows, flows, generation, coalColorMap = {}) {
//   // rows: array (each row may have: coal (string or object), percentages[], gcv, cost)
//   const oxKeys = ["SiO2","Al2O3","Fe2O3","CaO","MgO","Na2O","K2O","SO3","TiO2"];

//   // Load all coal docs once
//   const allCoals = await Coal.find().lean();
//   const byId = {};
//   const byNameLower = {};
//   allCoals.forEach(c => {
//     if (c._id) byId[String(c._id)] = c;
//     if (c.coal) byNameLower[String(c.coal).toLowerCase()] = c;
//   });

//   function findCoalRef(ref) {
//     if (!ref) return null;
//     if (byId[String(ref)]) return byId[String(ref)];
//     const lower = String(ref).toLowerCase();
//     if (byNameLower[lower]) return byNameLower[lower];
//     return null;
//   }

//   // helper to get per-mill coalRef from row (row.coal may be string or object)
//   function coalRefForRowAndMill(row, mill) {
//     if (!row) return null;
//     if (row.coal && typeof row.coal === 'object' && row.coal !== null) {
//       return row.coal[String(mill)] || '';
//     }
//     return row.coal || '';
//   }

//   const blendedGCVPerMill = [];
//   const aftPerMill = [];

//   for (let m = 0; m < 8; m++) {
//     let blendedGCV = 0;
//     const ox = {};
//     oxKeys.forEach(k => ox[k] = 0);

//     for (let i = 0; i < (rows ? rows.length : 0); i++) {
//       const row = rows[i] || {};
//       const perc = (Array.isArray(row.percentages) && row.percentages[m]) ? Number(row.percentages[m]) : 0;
//       const weight = perc / 100;

//       // resolve per-mill coalRef if supplied
//       const coalRef = coalRefForRowAndMill(row, m);
//       const coalDoc = findCoalRef(coalRef);

//       // gcv: prefer explicit row.gcv (global) else coalDoc.gcv
//       const gcvVal = (row.gcv !== undefined && row.gcv !== null && row.gcv !== '') ? Number(row.gcv) : (coalDoc ? (Number(coalDoc.gcv) || 0) : 0);
//       blendedGCV += gcvVal * weight;

//       // accumulate oxides from coalDoc if present (or from row(if provided))
//       if (coalDoc) {
//         oxKeys.forEach(k => {
//           ox[k] += (Number(coalDoc[k]) || 0) * weight;
//         });
//       } else {
//         oxKeys.forEach(k => {
//           if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
//             ox[k] += (Number(row[k]) || 0) * weight;
//           }
//         });
//       }
//     } // rows loop

//     blendedGCVPerMill.push(Number(blendedGCV));
//     const oxTotal = Object.values(ox).reduce((s, v) => s + (Number(v) || 0), 0);
//     const aftVal = (oxTotal === 0) ? null : Number(calcAFT(ox));
//     aftPerMill.push(aftVal);
//   } // mills loop

//   // totals & weighted averages using flows
//   let totalFlow = 0;
//   let weightedGCV = 0;
//   let weightedAFT = 0;
//   let contributedAFTFlow = 0;

//   for (let m = 0; m < 8; m++) {
//     const flow = (Array.isArray(flows) && flows[m]) ? Number(flows[m]) : 0;
//     totalFlow += flow;
//     weightedGCV += flow * (blendedGCVPerMill[m] || 0);

//     const aftVal = aftPerMill[m];
//     if (aftVal !== null && !isNaN(aftVal)) {
//       weightedAFT += flow * aftVal;
//       contributedAFTFlow += flow;
//     }
//   }

//   const avgGCV = totalFlow > 0 ? (weightedGCV / totalFlow) : 0;
//   const avgAFT = contributedAFTFlow > 0 ? (weightedAFT / contributedAFTFlow) : null;
//   const heatRate = (generation && generation > 0 && totalFlow > 0) ? ((totalFlow * avgGCV) / generation) : null;

//   // compute cost rate (weighted by sum of percentages per row)
//   function rowQtySum(row) {
//     if (!row || !Array.isArray(row.percentages)) return 0;
//     return row.percentages.reduce((s, v) => s + (Number(v) || 0), 0);
//   }
//   const qtyPerRow = (rows || []).map(rowQtySum);
//   const costPerRow = (rows || []).map((r, idx) => {
//     if (r && r.cost !== undefined && r.cost !== null && r.cost !== '') return Number(r.cost) || 0;
//     const cdoc = findCoalRef((r || {}).coal);
//     return cdoc ? (Number(cdoc.cost) || 0) : 0;
//   });

//   let totalCost = 0, totalQty = 0;
//   for (let i = 0; i < qtyPerRow.length; i++) {
//     totalCost += (qtyPerRow[i] || 0) * (costPerRow[i] || 0);
//     totalQty += (qtyPerRow[i] || 0);
//   }
//   const costRate = totalQty > 0 ? (totalCost / totalQty) : 0;

//   // Build per-bunker structure (independent storage)
//   const bunkers = [];
//   for (let m = 0; m < 8; m++) {
//     const layers = [];
//     for (let rIdx = 0; rIdx < (rows || []).length; rIdx++) {
//       const row = rows[rIdx];
//       const pct = (Array.isArray(row.percentages) && row.percentages[m]) ? Number(row.percentages[m]) : 0;
//       if (!pct || pct <= 0) continue;
//       const coalRef = coalRefForRowAndMill(row, m);
//       const coalDoc = findCoalRef(coalRef);
//       layers.push({
//         rowIndex: rIdx + 1,
//         coal: coalDoc ? coalDoc.coal : (coalRef || ''),
//         percent: Number(pct),
//         gcv: coalDoc ? (Number(coalDoc.gcv) || Number(row.gcv || 0)) : Number(row.gcv || 0),
//         cost: coalDoc ? (Number(coalDoc.cost) || Number(row.cost || 0)) : Number(row.cost || 0)
//       });
//     }
//     bunkers.push({ layers });
//   }

//   return {
//     totalFlow: Number(totalFlow),
//     avgGCV: Number(avgGCV),
//     avgAFT: (avgAFT === null ? null : Number(avgAFT)),
//     heatRate: (heatRate === null ? null : Number(heatRate)),
//     costRate: Number(costRate),
//     aftPerMill: aftPerMill.map(v => (v === null ? null : Number(v))),
//     blendedGCVPerMill: blendedGCVPerMill.map(v => Number(v)),
//     bunkers
//   };
// }
async function computeBlendMetrics(rows, flows, generation, coalColorMap = {}) {
  // rows: array (each row may have: coal (string or object), percentages[], gcv, cost)
  const oxKeys = ["SiO2","Al2O3","Fe2O3","CaO","MgO","Na2O","K2O","SO3","TiO2"];

  // Load all coal docs once
  const allCoals = await Coal.find().lean();
  const byId = {};
  const byNameLower = {};
  allCoals.forEach(c => {
    if (c._id) byId[String(c._id)] = c;
    if (c.coal) byNameLower[String(c.coal).toLowerCase()] = c;
  });

  function findCoalRef(ref) {
    if (!ref) return null;
    if (byId[String(ref)]) return byId[String(ref)];
    const lower = String(ref).toLowerCase();
    if (byNameLower[lower]) return byNameLower[lower];
    return null;
  }

  // helper to get per-mill coalRef from row (row.coal may be string or object)
  function coalRefForRowAndMill(row, mill) {
    if (!row) return null;
    if (row.coal && typeof row.coal === 'object' && row.coal !== null) {
      return row.coal[String(mill)] || '';
    }
    return row.coal || '';
  }

  // Helper to resolve a colour for a coal reference / coalDoc
  function resolveColorForCoal(coalRef, coalDoc) {
    // 1) prefer DB coalDoc.color
    if (coalDoc && coalDoc.color) {
      return String(coalDoc.color).trim();
    }

    // Normalize helpers
    const tryKeys = k => {
      if (!k && k !== 0) return null;
      if (coalColorMap == null) return null;
      if (coalColorMap[k]) return coalColorMap[k];
      return null;
    };

    // 2) try keys related to the coalDoc._id
    if (coalDoc && coalDoc._id) {
      const idStr = String(coalDoc._id);
      // common client maps may store "id:<id>" or raw id
      const v1 = tryKeys(`id:${idStr}`) || tryKeys(idStr);
      if (v1) return String(v1).trim();
    }

    // 3) try keys related to the coalRef value (name or id)
    if (coalRef) {
      const refStr = String(coalRef);
      const v2 = tryKeys(`name:${refStr}`) || tryKeys(refStr);
      if (v2) return String(v2).trim();

      const lowerRef = refStr.toLowerCase();
      const v3 = tryKeys(lowerRef);
      if (v3) return String(v3).trim();
    }

    // 4) try byNameLower lookup value's color (if earlier lookups didn't have color)
    if (coalRef) {
      const byNameEntry = byNameLower[String(coalRef).toLowerCase()];
      if (byNameEntry && byNameEntry.color) return String(byNameEntry.color).trim();
    }

    // no color found
    return '';
  }

  const blendedGCVPerMill = [];
  const aftPerMill = [];

  for (let m = 0; m < 8; m++) {
    let blendedGCV = 0;
    const ox = {};
    oxKeys.forEach(k => ox[k] = 0);

    for (let i = 0; i < (rows ? rows.length : 0); i++) {
      const row = rows[i] || {};
      const perc = (Array.isArray(row.percentages) && row.percentages[m]) ? Number(row.percentages[m]) : 0;
      const weight = perc / 100;

      // resolve per-mill coalRef if supplied
      const coalRef = coalRefForRowAndMill(row, m);
      const coalDoc = findCoalRef(coalRef);

      // gcv: prefer explicit row.gcv (global) else coalDoc.gcv
      const gcvVal = (row.gcv !== undefined && row.gcv !== null && row.gcv !== '') ? Number(row.gcv) : (coalDoc ? (Number(coalDoc.gcv) || 0) : 0);
      blendedGCV += gcvVal * weight;

      // accumulate oxides from coalDoc if present (or from row(if provided))
      if (coalDoc) {
        oxKeys.forEach(k => {
          ox[k] += (Number(coalDoc[k]) || 0) * weight;
        });
      } else {
        oxKeys.forEach(k => {
          if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
            ox[k] += (Number(row[k]) || 0) * weight;
          }
        });
      }
    } // rows loop

    blendedGCVPerMill.push(Number(blendedGCV));
    const oxTotal = Object.values(ox).reduce((s, v) => s + (Number(v) || 0), 0);
    const aftVal = (oxTotal === 0) ? null : Number(calcAFT(ox));
    aftPerMill.push(aftVal);
  } // mills loop

  // totals & weighted averages using flows
  let totalFlow = 0;
  let weightedGCV = 0;
  let weightedAFT = 0;
  let contributedAFTFlow = 0;

  for (let m = 0; m < 8; m++) {
    const flow = (Array.isArray(flows) && flows[m]) ? Number(flows[m]) : 0;
    totalFlow += flow;
    weightedGCV += flow * (blendedGCVPerMill[m] || 0);

    const aftVal = aftPerMill[m];
    if (aftVal !== null && !isNaN(aftVal)) {
      weightedAFT += flow * aftVal;
      contributedAFTFlow += flow;
    }
  }

  const avgGCV = totalFlow > 0 ? (weightedGCV / totalFlow) : 0;
  const avgAFT = contributedAFTFlow > 0 ? (weightedAFT / contributedAFTFlow) : null;
  const heatRate = (generation && generation > 0 && totalFlow > 0) ? ((totalFlow * avgGCV) / generation) : null;

  // compute cost rate (weighted by sum of percentages per row)
  function rowQtySum(row) {
    if (!row || !Array.isArray(row.percentages)) return 0;
    return row.percentages.reduce((s, v) => s + (Number(v) || 0), 0);
  }
  const qtyPerRow = (rows || []).map(rowQtySum);
  const costPerRow = (rows || []).map((r, idx) => {
    if (r && r.cost !== undefined && r.cost !== null && r.cost !== '') return Number(r.cost) || 0;
    const cdoc = findCoalRef((r || {}).coal);
    return cdoc ? (Number(cdoc.cost) || 0) : 0;
  });

  let totalCost = 0, totalQty = 0;
  for (let i = 0; i < qtyPerRow.length; i++) {
    totalCost += (qtyPerRow[i] || 0) * (costPerRow[i] || 0);
    totalQty += (qtyPerRow[i] || 0);
  }
  const costRate = totalQty > 0 ? (totalCost / totalQty) : 0;

  // Build per-bunker structure (independent storage) and include colors
  const bunkers = [];
  for (let m = 0; m < 8; m++) {
    const layers = [];
    for (let rIdx = 0; rIdx < (rows || []).length; rIdx++) {
      const row = rows[rIdx];
      const pct = (Array.isArray(row.percentages) && row.percentages[m]) ? Number(row.percentages[m]) : 0;
      if (!pct || pct <= 0) continue;
      const coalRef = coalRefForRowAndMill(row, m);
      const coalDoc = findCoalRef(coalRef);

      // Resolve color using helper
      const layerColor = resolveColorForCoal(coalRef, coalDoc);

      layers.push({
        rowIndex: rIdx + 1,
        coal: coalDoc ? coalDoc.coal : (coalRef || ''),
        percent: Number(pct),
        gcv: coalDoc ? (Number(coalDoc.gcv) || Number(row.gcv || 0)) : Number(row.gcv || 0),
        cost: coalDoc ? (Number(coalDoc.cost) || Number(row.cost || 0)) : Number(row.cost || 0),
        color: layerColor || ''
      });
    }
    bunkers.push({ layers });
  }

  return {
    totalFlow: Number(totalFlow),
    avgGCV: Number(avgGCV),
    avgAFT: (avgAFT === null ? null : Number(avgAFT)),
    heatRate: (heatRate === null ? null : Number(heatRate)),
    costRate: Number(costRate),
    aftPerMill: aftPerMill.map(v => (v === null ? null : Number(v))),
    blendedGCVPerMill: blendedGCVPerMill.map(v => Number(v)),
    bunkers
  };
}

/* -------------------- Blend endpoints (create / update / latest) -------------------- */
/**
 * Create a new Blend document; compute metrics server-side and store them.
 * Body: { rows: [.], flows: [.], generation: number }
 */
app.post('/api/blend', async (req, res) => {
  try {
    const { rows, flows, generation, bunkerCapacity, bunkerCapacities } = req.body;

    if (!Array.isArray(rows) || !Array.isArray(flows)) {
      return res.status(400).json({ error: 'Invalid payload: rows[] and flows[] required' });
    }

    // load coal docs once and build lookup maps
    const allCoals = await Coal.find().lean();
    const byId = {};
    const byNameLower = {};
    allCoals.forEach(c => {
      if (c._id) byId[String(c._id)] = c;
      if (c.coal) byNameLower[String(c.coal).toLowerCase()] = c;
    });

    // helper to resolve row.coal entries (handle string or object mapping -> resolved names if possible)
    function resolveRowCoalField(row) {
      if (!row) return row;
      const copy = Object.assign({}, row);
      if (copy.coal && typeof copy.coal === 'object') {
        const newMap = {};
        Object.keys(copy.coal).forEach(k => {
          const ref = copy.coal[k];
          if (ref && byId[ref]) newMap[k] = byId[ref].coal;
          else if (ref && byNameLower[String(ref).toLowerCase()]) newMap[k] = byNameLower[String(ref).toLowerCase()].coal;
          else newMap[k] = ref || '';
        });
        copy.coal = newMap;
      } else {
        const ref = copy.coal ? String(copy.coal) : '';
        if (ref) {
          if (byId[ref]) copy.coal = byId[ref].coal;
          else if (byNameLower[ref.toLowerCase()]) copy.coal = byNameLower[ref.toLowerCase()].coal;
        }
      }
      // sanitize percentages, gcv, cost
      if (Array.isArray(copy.percentages)) copy.percentages = copy.percentages.map(v => Number(v) || 0);
      else copy.percentages = [0,0,0,0,0,0];
      copy.gcv = (copy.gcv !== undefined && copy.gcv !== null) ? Number(copy.gcv) : 0;
      copy.cost = (copy.cost !== undefined && copy.cost !== null) ? Number(copy.cost) : 0;
      return copy;
    }

    const rowsToSave = (rows || []).map(row => resolveRowCoalField(row));

    // compute metrics including bunkers
    // compute metrics including bunkers (pass client-sent coalColorMap)
// const metrics = await computeBlendMetrics(rowsToSave, flows, generation, (req.body && req.body.coalColorMap) ? req.body.coalColorMap : {});
// --- merge client-sent timers into computed metrics.bunkers (if provided) ---
function mergeClientTimersIntoMetrics(metricsBunkers, clientBunkers) {
  if (!Array.isArray(metricsBunkers) || !Array.isArray(clientBunkers)) return;
  for (let bi = 0; bi < Math.min(metricsBunkers.length, clientBunkers.length); bi++) {
    const mB = metricsBunkers[bi];
    const cB = clientBunkers[bi];
    if (!mB || !Array.isArray(mB.layers) || !cB || !Array.isArray(cB.layers)) continue;
    // build map by rowIndex for client layers
    const clientMap = {};
    cB.layers.forEach(l => {
      if (l && l.rowIndex !== undefined) clientMap[Number(l.rowIndex)] = l;
    });
    // apply timers to metric layers by matching rowIndex
    mB.layers.forEach(layer => {
      if (!layer || layer.rowIndex === undefined) return;
      const key = Number(layer.rowIndex);
      if (clientMap[key] && clientMap[key].timer) {
        layer.timer = clientMap[key].timer;
      }
      // optionally accept rawSeconds too if client sent it
      else if (clientMap[key] && clientMap[key].rawSeconds != null && isFinite(clientMap[key].rawSeconds)) {
        const s = Math.max(0, Math.round(clientMap[key].rawSeconds));
        const hh = String(Math.floor(s/3600)).padStart(2,'0');
        const mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
        const ss = String(s % 60).padStart(2,'0');
        layer.timer = `${hh}:${mm}:${ss}`;
      }
    });
  }
}
const metrics = await computeBlendMetrics(rowsToSave, flows, generation, (req.body && req.body.coalColorMap) ? req.body.coalColorMap : {});

// merge timers if client posted them
if (req.body && Array.isArray(req.body.clientBunkers)) {
  mergeClientTimersIntoMetrics(metrics.bunkers, req.body.clientBunkers);
}


    // create and save blend - include bunkers from metrics
const doc = new Blend(Object.assign({}, {
  rows: rowsToSave,
  flows,
  generation,
  bunkerCapacity: Number(bunkerCapacity) || 0,
  bunkerCapacities: Array.isArray(bunkerCapacities) ? bunkerCapacities.map(v => Number(v||0)) : [],
  bunkers: metrics.bunkers || []
}, metrics));

    await doc.save();
    return res.status(201).json({ message: 'Saved', id: doc._id });
  } catch (err) {
    console.error('POST /api/blend error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * Update existing Blend by ID; recompute metrics and save
 */
app.put('/api/blend/:id', async (req, res) => {
  try {
const { id } = req.params;
const { rows, flows, generation, bunkerCapacity, bunkerCapacities } = req.body;
    if (!Array.isArray(rows) || !Array.isArray(flows)) {
      return res.status(400).json({ error: 'Invalid payload: rows[] and flows[] required' });
    }

    // load coal docs once and build lookup maps
    const allCoals = await Coal.find().lean();
    const byId = {};
    const byNameLower = {};
    allCoals.forEach(c => {
      if (c._id) byId[String(c._id)] = c;
      if (c.coal) byNameLower[String(c.coal).toLowerCase()] = c;
    });

    // same resolve function as POST
    function resolveRowCoalField(row) {
      if (!row) return row;
      const copy = Object.assign({}, row);
      if (copy.coal && typeof copy.coal === 'object') {
        const newMap = {};
        Object.keys(copy.coal).forEach(k => {
          const ref = copy.coal[k];
          if (ref && byId[ref]) newMap[k] = byId[ref].coal;
          else if (ref && byNameLower[String(ref).toLowerCase()]) newMap[k] = byNameLower[String(ref).toLowerCase()].coal;
          else newMap[k] = ref || '';
        });
        copy.coal = newMap;
      } else {
        const ref = copy.coal ? String(copy.coal) : '';
        if (ref) {
          if (byId[ref]) copy.coal = byId[ref].coal;
          else if (byNameLower[ref.toLowerCase()]) copy.coal = byNameLower[ref.toLowerCase()].coal;
        }
      }
      if (Array.isArray(copy.percentages)) copy.percentages = copy.percentages.map(v => Number(v) || 0);
      else copy.percentages = [0,0,0,0,0,0];
      copy.gcv = (copy.gcv !== undefined && copy.gcv !== null) ? Number(copy.gcv) : 0;
      copy.cost = (copy.cost !== undefined && copy.cost !== null) ? Number(copy.cost) : 0;
      return copy;
    }

    const rowsToSave = (rows || []).map(row => resolveRowCoalField(row));
    // const metrics = await computeBlendMetrics(rowsToSave, flows, generation, (req.body && req.body.coalColorMap) ? req.body.coalColorMap : {});
// --- merge client-sent timers into computed metrics.bunkers (if provided) ---
function mergeClientTimersIntoMetrics(metricsBunkers, clientBunkers) {
  if (!Array.isArray(metricsBunkers) || !Array.isArray(clientBunkers)) return;
  for (let bi = 0; bi < Math.min(metricsBunkers.length, clientBunkers.length); bi++) {
    const mB = metricsBunkers[bi];
    const cB = clientBunkers[bi];
    if (!mB || !Array.isArray(mB.layers) || !cB || !Array.isArray(cB.layers)) continue;
    // build map by rowIndex for client layers
    const clientMap = {};
    cB.layers.forEach(l => {
      if (l && l.rowIndex !== undefined) clientMap[Number(l.rowIndex)] = l;
    });
    // apply timers to metric layers by matching rowIndex
    mB.layers.forEach(layer => {
      if (!layer || layer.rowIndex === undefined) return;
      const key = Number(layer.rowIndex);
      if (clientMap[key] && clientMap[key].timer) {
        layer.timer = clientMap[key].timer;
      }
      // optionally accept rawSeconds too if client sent it
      else if (clientMap[key] && clientMap[key].rawSeconds != null && isFinite(clientMap[key].rawSeconds)) {
        const s = Math.max(0, Math.round(clientMap[key].rawSeconds));
        const hh = String(Math.floor(s/3600)).padStart(2,'0');
        const mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
        const ss = String(s % 60).padStart(2,'0');
        layer.timer = `${hh}:${mm}:${ss}`;
      }
    });
  }
}
const metrics = await computeBlendMetrics(rowsToSave, flows, generation, (req.body && req.body.coalColorMap) ? req.body.coalColorMap : {});

// merge timers if client posted them
if (req.body && Array.isArray(req.body.clientBunkers)) {
  mergeClientTimersIntoMetrics(metrics.bunkers, req.body.clientBunkers);
}


const updated = await Blend.findByIdAndUpdate(
  id,
  Object.assign({}, {
    rows: rowsToSave,
    flows,
    generation,
    bunkerCapacity: Number(bunkerCapacity) || 0,
    bunkerCapacities: Array.isArray(bunkerCapacities) ? bunkerCapacities.map(v => Number(v||0)) : [],
    bunkers: metrics.bunkers || []
  }, metrics),
  { new: true }
);

    if (!updated) return res.status(404).json({ error: 'Blend not found' });

    return res.json({ message: 'Updated', id: updated._id });
  } catch (err) {
    console.error('PUT /api/blend/:id error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * Return the latest Blend document (most recent createdAt)
 */
app.get('/api/blend/latest', async (req, res) => {
  try {
    const latest = await Blend.findOne().sort({ createdAt: -1 }).lean();
    if (!latest) return res.status(404).json({ error: 'No blends found' });
    return res.json(latest);
  } catch (err) {
    console.error('GET /api/blend/latest error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* -------------------- Optional helper endpoints for debugging -------------------- */
app.get('/api/coal/count', async (req, res) => {
  try {
    const c = await Coal.countDocuments();
    return res.json({ count: c });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
//the file that i have shared are basically 3 files these are the files for my website in this website i am already 
//impkementing the logic of submitting data to the database now similarly for a specific coal that i am submiting i want that 
//the specific coal colour should also get submitted to the database so that