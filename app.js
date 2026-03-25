// ============================================================
// FIREBASE CONFIGURATION & INITIALIZATION
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc, query, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBNEgyzigOZG9yyLUt5bPJajSAGivbdtyg",
  authDomain: "proposal-generator-154a7.firebaseapp.com",
  projectId: "proposal-generator-154a7",
  storageBucket: "proposal-generator-154a7.firebasestorage.app",
  messagingSenderId: "152677372244",
  appId: "1:152677372244:web:a1eb75b7f8583bc2f438c1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Sign in anonymously so Firestore rules (auth != null) are satisfied.
// This runs once at startup before any Firestore reads/writes.
signInAnonymously(auth).catch(function(e) {
  console.error('[Firebase Auth] Anonymous sign-in failed:', e.code, e.message);
});

// Firestore document paths
const COLLECTION = 'proposal_generator';
const CATALOG_DOC   = 'catalog';
const PLANS_DOC     = 'plans';
const PROPOSALS_COL = 'proposals'; // sub-collection, one doc per proposal
const ADMIN_DOC     = 'admin_auth'; // stores {hash, salt}

// ============================================================
// STATE
// ============================================================
var catalog = [], plans = [], selectedEquipment = [], selectedPlans = [];
var contractTerm = '24', orderType = 'new';
var MIN_MONTHLY_NEW = 199.00;
var proposalHistory = [];  // array of full proposal data objects
var isAdmin = false;
var editingRecordId = null;
var editingRecordType = null;

var DEFAULT_CATALOG = [
  {id:1,sku:'GO9-LTE',desc:'GO9 LTE/4G Model GPS Device',category:'GPS Device',price:149.00,price3yr:149.00,active:true},
  {id:2,sku:'GF-PLUS-CAM',desc:'Geotab GO Focus Plus AI-Dash Camera',category:'Dash Camera',price:399.00,price3yr:399.00,active:true},
  {id:3,sku:'DEV-HARNESS',desc:'GO Device Harness / Installation Adapter',category:'Accessory',price:50.00,price3yr:50.00,active:true},
  {id:4,sku:'DISC-3YR',desc:'Equipment Discount on 3-Year Service Contract',category:'Discount',price:-50.00,price3yr:-50.00,active:true},
  {id:5,sku:'INSTALL-STD',desc:'Standard Vehicle Installation (Per Unit)',category:'Installation',price:75.00,price3yr:75.00,active:true},
  {id:6,sku:'GO9-PLUS',desc:'GO9 Plus 4G Device with Advanced Features',category:'GPS Device',price:199.00,price3yr:179.00,active:true}
];
var DEFAULT_PLANS = [
  {id:1,name:'Geotab GO Plan',desc:'Full telematics – live tracking, engine data, reports',rate:29.99},
  {id:2,name:'Geotab GO Focus Plus Video Plan',desc:'AI dash cam plan with video streaming & events',rate:29.99},
  {id:3,name:'Geotab GO ProPlus Plan',desc:'Enhanced features + hours of service + integrations',rate:39.99},
  {id:4,name:'Asset Tracking Plan',desc:'Non-powered asset tracking (trailers, equipment)',rate:9.99}
];

// ============================================================
// CRYPTO HELPERS — Web Crypto API (SHA-256 + random salt)
// ============================================================
async function generateSalt() {
  var arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}

async function hashKey(key, salt) {
  var enc = new TextEncoder();
  var data = enc.encode(salt + key);
  var hashBuf = await crypto.subtle.digest('SHA-256', data);
  var hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}

// ============================================================
// AUTH — Admin Key System
// ============================================================
async function checkAdminSetup() {
  try {
    console.log('[checkAdminSetup] Checking doc:', COLLECTION + '/' + ADMIN_DOC);
    var snap = await getDoc(doc(db, COLLECTION, ADMIN_DOC));
    console.log('[checkAdminSetup] Doc exists:', snap.exists());
    return snap.exists();
  } catch(e) {
    console.error('[checkAdminSetup] ERROR reading admin doc:', e);
    console.error('[checkAdminSetup] Error code:', e.code, '| message:', e.message);
    return false;
  }
}

async function createAdminKey(key) {
  console.log('[createAdminKey] Starting. COLLECTION:', COLLECTION, '| ADMIN_DOC:', ADMIN_DOC);
  var salt = await generateSalt();
  console.log('[createAdminKey] Salt generated OK');
  var hash = await hashKey(key, salt);
  console.log('[createAdminKey] Hash generated OK (first 8):', hash.slice(0, 8));
  var docRef = doc(db, COLLECTION, ADMIN_DOC);
  console.log('[createAdminKey] Doc path:', docRef.path, '| Attempting setDoc...');
  await setDoc(docRef, { hash: hash, salt: salt });
  console.log('[createAdminKey] setDoc SUCCESS');
}

async function verifyAdminKey(key) {
  try {
    var snap = await getDoc(doc(db, COLLECTION, ADMIN_DOC));
    if (!snap.exists()) return false;
    var data = snap.data();
    var hash = await hashKey(key, data.salt);
    return hash === data.hash;
  } catch(e) { return false; }
}

// ============================================================
// AUTH UI
// ============================================================
async function initAuth() {
  var hasAdmin = await checkAdminSetup();
  document.getElementById('auth-loading-panel').style.display = 'none';
  if (!hasAdmin) {
    document.getElementById('auth-setup-panel').style.display = 'block';
  } else {
    document.getElementById('auth-login-panel').style.display = 'block';
  }
}

window.handleSetupKey = async function() {
  var key = document.getElementById('setup-key').value;
  var key2 = document.getElementById('setup-key2').value;
  var err = document.getElementById('setup-error');
  err.style.display = 'none';
  if (!key) { err.textContent = 'Please enter an admin key.'; err.style.display = 'block'; return; }
  if (key.length < 6) { err.textContent = 'Admin key must be at least 6 characters.'; err.style.display = 'block'; return; }
  if (key !== key2) { err.textContent = 'Keys do not match.'; err.style.display = 'block'; return; }
  try {
    console.log('[handleSetupKey] Calling createAdminKey...');
    await createAdminKey(key);
    console.log('[handleSetupKey] createAdminKey resolved, booting as admin...');
    bootAsAdmin();
  } catch(e) {
    console.error('[handleSetupKey] CAUGHT ERROR:', e);
    console.error('[handleSetupKey] Error code:', e.code);
    console.error('[handleSetupKey] Error message:', e.message);
    err.textContent = 'Error saving admin key. Check connection.'; err.style.display = 'block';
  }
};

window.handleAdminLogin = async function() {
  var key = document.getElementById('login-key').value;
  var err = document.getElementById('login-error');
  err.style.display = 'none';
  if (!key) { err.textContent = 'Please enter the admin key.'; err.style.display = 'block'; return; }
  var ok = await verifyAdminKey(key);
  if (ok) {
    bootAsAdmin();
  } else {
    err.textContent = 'Incorrect admin key.'; err.style.display = 'block';
  }
};

window.continueAsGuest = function() {
  bootAsGuest();
};

async function bootAsAdmin() {
  isAdmin = true;
  await loadData(true);
  renderPlanGrid(); updateTotals();
  hideAuthOverlay();
  updateAdminUI();
}

async function bootAsGuest() {
  isAdmin = false;
  await loadData(false);
  renderPlanGrid(); updateTotals();
  hideAuthOverlay();
  updateAdminUI();
}

function updateAdminUI() {
  // Topbar badges
  document.getElementById('admin-mode-badge').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('guest-mode-badge').style.display = !isAdmin ? 'inline-flex' : 'none';

  // Admin-gated pages
  document.getElementById('admin-only-msg').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('admin-content').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('history-admin-only-msg').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('history-content').style.display = isAdmin ? 'block' : 'none';

  // Status bar
  var statusEl = document.getElementById('mode-status-text');
  if (statusEl) {
    if (isAdmin) {
      statusEl.innerHTML = '<span class="status-dot green"></span> Admin access enabled';
    } else {
      statusEl.innerHTML = '<span class="status-dot blue"></span> Guest access';
    }
  }
}

window.handleAdminSignOut = function() {
  isAdmin = false;
  updateAdminUI();
  showPage('quote');
  toast('Signed out of admin mode');
};

window.showAdminLogin = function() {
  document.getElementById('modal-admin-key').value = '';
  document.getElementById('modal-admin-error').style.display = 'none';
  openModal('modal-admin-login');
};

window.handleModalAdminLogin = async function() {
  var key = document.getElementById('modal-admin-key').value;
  var err = document.getElementById('modal-admin-error');
  err.style.display = 'none';
  if (!key) { err.textContent = 'Enter the admin key.'; err.style.display = 'block'; return; }
  var ok = await verifyAdminKey(key);
  if (ok) {
    isAdmin = true;
    closeModal('modal-admin-login');
    await loadData(true);
    updateAdminUI();
    renderPlanGrid();
    toast('Admin mode activated');
  } else {
    err.textContent = 'Incorrect admin key.'; err.style.display = 'block';
  }
};

window.openChangeKey = function() {
  ['ck-current','ck-new','ck-new2'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('change-key-error').style.display = 'none';
  document.getElementById('change-key-success').style.display = 'none';
  openModal('modal-change-key');
};

window.handleChangeKey = async function() {
  var cur = document.getElementById('ck-current').value;
  var nw = document.getElementById('ck-new').value;
  var nw2 = document.getElementById('ck-new2').value;
  var err = document.getElementById('change-key-error');
  var suc = document.getElementById('change-key-success');
  err.style.display = 'none'; suc.style.display = 'none';
  if (!cur || !nw) { err.textContent = 'Fill in all fields.'; err.style.display = 'block'; return; }
  if (nw !== nw2) { err.textContent = 'New keys do not match.'; err.style.display = 'block'; return; }
  if (nw.length < 6) { err.textContent = 'New key must be at least 6 characters.'; err.style.display = 'block'; return; }
  var ok = await verifyAdminKey(cur);
  if (!ok) { err.textContent = 'Current admin key is incorrect.'; err.style.display = 'block'; return; }
  await createAdminKey(nw);
  suc.textContent = 'Admin key updated successfully.'; suc.style.display = 'block';
  setTimeout(function(){ closeModal('modal-change-key'); }, 1500);
};

function hideAuthOverlay() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
}

// ============================================================
// FIREBASE DATA OPERATIONS
// ============================================================
async function loadData(adminMode) {
  try {
    var catSnap = await getDoc(doc(db, COLLECTION, CATALOG_DOC));
    catalog = catSnap.exists() ? catSnap.data().items : JSON.parse(JSON.stringify(DEFAULT_CATALOG));
  } catch(e) { catalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG)); }

  try {
    var plansSnap = await getDoc(doc(db, COLLECTION, PLANS_DOC));
    plans = plansSnap.exists() ? plansSnap.data().items : JSON.parse(JSON.stringify(DEFAULT_PLANS));
  } catch(e) { plans = JSON.parse(JSON.stringify(DEFAULT_PLANS)); }

  if (adminMode) {
    await loadProposals();
  }
}

async function loadProposals() {
  try {
    var snap = await getDoc(doc(db, COLLECTION, 'proposals_list'));
    proposalHistory = snap.exists() ? (snap.data().items || []) : [];
    autoPurgeProposals();
  } catch(e) { proposalHistory = []; }
}

async function saveData() {
  try {
    await setDoc(doc(db, COLLECTION, CATALOG_DOC), { items: catalog });
    await setDoc(doc(db, COLLECTION, PLANS_DOC), { items: plans });
  } catch(e) { console.error('Error saving catalog/plans:', e); toast('Save failed — check connection', true); }
}

async function saveProposalHistory() {
  try {
    if (proposalHistory.length > 500) proposalHistory = proposalHistory.slice(0, 500);
    await setDoc(doc(db, COLLECTION, 'proposals_list'), { items: proposalHistory });
  } catch(e) { console.error('Error saving proposals:', e); toast('Save failed', true); }
}

function autoPurgeProposals() {
  var cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
  var before = proposalHistory.length;
  proposalHistory = proposalHistory.filter(function(p) { return p.timestamp > cutoff; });
  if (proposalHistory.length < before) { saveProposalHistory(); }
}

// ============================================================
// NAV
// ============================================================
function showPage(name) {
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector('[data-page=' + name + ']').classList.add('active');
  if (name === 'admin') renderAdmin();
  if (name === 'quote') renderPlanGrid();
  if (name === 'history') renderHistory();
}
window.showPage = showPage;

function openModal(id){document.getElementById(id).classList.add('show');}
function closeModal(id){document.getElementById(id).classList.remove('show');}
window.openModal = openModal;
window.closeModal = closeModal;

function toast(msg, warn) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show' + (warn ? ' warn' : '');
  setTimeout(function(){el.className='toast';}, 3000);
}
function fmt(n) {
  var v = parseFloat(n) || 0, neg = v < 0;
  var s = '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? '-' + s : s;
}

// ============================================================
// PROPOSAL HISTORY — saves full quote data (no PDF)
// ============================================================
function saveProposalRecord(docType) {
  var d = getQuoteData();
  if (!d.company) return;
  var reuseExisting = editingRecordId && editingRecordType === docType;
  var record = {
    id: reuseExisting ? editingRecordId : Date.now(),
    timestamp: Date.now(),
    date: new Date().toLocaleDateString('en-US'),
    docType: docType,
    // Full data for PDF regeneration
    company: d.company,
    contact: d.contact,
    title: d.title,
    email: d.email,
    address: d.address,
    city: d.city,
    state: d.state,
    zip: d.zip,
    phone: d.phone,
    website: d.website,
    challenge: d.challenge,
    rep: d.rep,
    metro: d.metro,
    notes: d.notes,
    paymentTerms: d.paymentTerms,
    contractTerm: d.contractTerm,
    orderType: d.orderType,
    orderLabel: d.orderLabel,
    termLabel: d.termLabel,
    equipment: d.equipment,
    plans: d.plans,
    taxRate: d.taxRate,
    taxAmt: d.taxAmt,
    equipSub: d.equipSub,
    monthly: d.monthly,
    monthlyRaw: d.monthlyRaw,
    usedMin: d.usedMin,
    deposit: d.deposit,
    total: d.total
  };
  if (reuseExisting) {
    for (var i = 0; i < proposalHistory.length; i++) {
      if (proposalHistory[i].id === editingRecordId) {
        proposalHistory[i] = record;
        break;
      }
    }
  } else {
    proposalHistory.unshift(record);
  }
  if (isAdmin) saveProposalHistory();
}

function renderHistory() {
  if (!isAdmin) return;
  var tbody = document.getElementById('history-tbody');
  var table = document.getElementById('history-table');
  var tableWrap = document.getElementById('history-table-wrap');
  var empty = document.getElementById('history-empty');
  if (!tbody || !table || !tableWrap) return;
  var search = (document.getElementById('history-search').value || '').toLowerCase().trim();
  var filtered = proposalHistory.filter(function(p) {
    if (!search) return true;
    return [
      p.company, p.contact, p.docType, p.orderLabel, p.email, p.phone, p.rep, p.date
    ].join(' ').toLowerCase().indexOf(search) >= 0;
  });
  if (filtered.length === 0) {
    tableWrap.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  tableWrap.style.display = 'block';
  empty.style.display = 'none';
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var p = filtered[i];
    var age = Math.floor((Date.now() - p.timestamp) / (24*60*60*1000));
    var dotClass = age < 30 ? 'green' : (age < 60 ? 'blue' : 'orange');
    var docBadge = p.docType === 'Proposal' ? 'badge-blue' : 'badge-orange';
    html += '<tr>';
    html += '<td><span class="status-dot '+dotClass+'"></span>'+p.date+'<br><span style="font-size:10px;color:var(--muted)">'+age+'d ago</span></td>';
    html += '<td style="font-weight:600">'+p.company+'</td>';
    html += '<td>'+p.contact+'</td>';
    html += '<td><span class="badge '+docBadge+'">'+p.docType+'</span></td>';
    html += '<td class="price-cell">'+fmt(p.total)+'</td>';
    html += '<td class="price-cell" style="color:var(--orange)">'+fmt(p.monthly)+'/mo</td>';
    html += '<td><div class="history-actions">';
    html += '<button class="btn btn-download btn-sm" onclick="downloadSavedProposal('+p.id+')">Download Proposal PDF</button>';
    html += '<button class="btn btn-download btn-sm" onclick="downloadSavedAgreement('+p.id+')">Download Agreement PDF</button>';
    html += '<button class="btn btn-outline btn-sm" onclick="editSavedRecord('+p.id+')">Edit</button>';
    html += '<button class="btn btn-outline btn-sm" onclick="previewSavedRecord('+p.id+')">Preview</button>';
    html += '<button class="btn btn-danger btn-sm" onclick="deleteProposal('+p.id+')">Delete</button>';
    html += '</div></td>';
    html += '</tr>';
  }
  document.getElementById('history-count').textContent = filtered.length + (filtered.length === 1 ? ' record' : ' records');
  table.style.display = 'table';
  tbody.innerHTML = html;
}

function findSavedRecord(id) {
  var p = null;
  for (var i = 0; i < proposalHistory.length; i++) { if (proposalHistory[i].id === id) { p = proposalHistory[i]; break; } }
  return p;
}

function setQuoteFormFromRecord(p) {
  editingRecordId = p.id;
  editingRecordType = p.docType;
  document.getElementById('q-company').value = p.company || '';
  document.getElementById('q-contact').value = p.contact || '';
  document.getElementById('q-title').value = p.title || '';
  document.getElementById('q-email').value = p.email || '';
  document.getElementById('q-address').value = p.address || '';
  document.getElementById('q-city').value = p.city || '';
  document.getElementById('q-state').value = p.state || '';
  document.getElementById('q-zip').value = p.zip || '';
  document.getElementById('q-phone').value = p.phone || '';
  document.getElementById('q-website').value = p.website || '';
  document.getElementById('q-challenge').value = p.challenge || '';
  document.getElementById('q-rep').value = p.rep || '';
  document.getElementById('q-metro').value = p.metro || '';
  document.getElementById('q-notes').value = p.notes || '';
  document.getElementById('q-payment-terms').value = p.paymentTerms || '100% Payment Due Up-Front';
  selectedEquipment = JSON.parse(JSON.stringify(p.equipment || []));
  selectedPlans = JSON.parse(JSON.stringify(p.plans || []));
  contractTerm = p.contractTerm || '24';
  orderType = p.orderType || 'new';
  document.querySelectorAll('.ot-card').forEach(function(c){c.className='ot-card';});
  var orderMap = {new:'ot-new', addon:'ot-addon', renewal:'ot-renewal'};
  var orderClassMap = {new:'selected', addon:'selected-green', renewal:'selected-orange'};
  var orderEl = document.getElementById(orderMap[orderType] || 'ot-new');
  if (orderEl) orderEl.className = 'ot-card ' + (orderClassMap[orderType] || 'selected');
  document.querySelectorAll('.contract-option').forEach(function(c){c.classList.remove('selected');});
  var contractEl = document.getElementById('contract-' + contractTerm);
  if (contractEl) contractEl.classList.add('selected');
  renderEquipmentTable();
  renderSelectedPlans();
  renderPlanGrid();
  updateTotals();
  showPage('quote');
  toast('Loaded saved ' + p.docType.toLowerCase() + ' for editing');
}

window.editSavedRecord = function(id) {
  var p = findSavedRecord(id);
  if (!p) return;
  setQuoteFormFromRecord(p);
};

window.previewSavedRecord = function(id) {
  var p = findSavedRecord(id);
  if (!p) return;
  // Show a mini preview with both download buttons
  var er = '';
  for (var i=0;i<p.equipment.length;i++){var e=p.equipment[i];er+='<tr><td style="padding:6px 10px;text-align:center">'+e.qty+'</td><td style="padding:6px 10px">'+e.desc+'</td><td style="padding:6px 10px;text-align:right">'+fmt(e.unitPrice)+'</td><td style="padding:6px 10px;text-align:right;font-weight:600">'+fmt(e.unitPrice*e.qty)+'</td></tr>';}
  var pr = '';
  for (var j=0;j<p.plans.length;j++){var pl=p.plans[j];pr+='<tr><td style="padding:6px 10px;text-align:center">'+pl.qty+'</td><td style="padding:6px 10px">'+pl.name+'</td><td style="padding:6px 10px;text-align:right">'+fmt(pl.rate)+'</td><td style="padding:6px 10px;text-align:right;font-weight:600">'+fmt(pl.rate*pl.qty)+'</td></tr>';}
  document.getElementById('redownload-content').innerHTML =
    '<div style="background:linear-gradient(135deg,var(--dark),#0d2040);color:white;border-radius:10px;padding:16px;margin-bottom:14px">'+
    '<div style="font-size:17px;font-weight:700">'+p.company+'</div>'+
    '<div style="opacity:0.6;font-size:13px;margin-top:2px">'+p.contact+(p.title?', '+p.title:'')+'</div>'+
    '<div style="margin-top:8px;font-size:12px;opacity:0.5">'+p.date+' · '+p.termLabel+' · '+p.orderLabel+'</div></div>'+
    (p.equipment.length?'<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px"><thead style="background:var(--dark);color:white"><tr><th style="padding:6px 10px">Qty</th><th style="padding:6px 10px">Equipment</th><th style="padding:6px 10px;text-align:right">Unit</th><th style="padding:6px 10px;text-align:right">Ext.</th></tr></thead><tbody>'+er+'</tbody></table>':'')+
    (p.plans.length?'<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px"><thead style="background:#1a3a6a;color:white"><tr><th style="padding:6px 10px">Qty</th><th style="padding:6px 10px">Plan</th><th style="padding:6px 10px;text-align:right">Rate</th><th style="padding:6px 10px;text-align:right">Total</th></tr></thead><tbody>'+pr+'</tbody></table>':'')+
    '<div style="background:#f4f8ff;border-radius:8px;padding:14px;font-size:13px">'+
    '<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:var(--muted)">Equipment Subtotal</span><strong>'+fmt(p.equipSub)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:var(--muted)">Tax</span><strong>'+fmt(p.taxAmt)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:var(--muted)">Deposit (2 mo.)</span><strong>'+fmt(p.deposit)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #dde8f5;margin-top:6px;font-size:16px"><span style="font-weight:700">Total Due</span><strong style="color:var(--blue-mid)">'+fmt(p.total)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;color:var(--orange);font-weight:700;font-size:14px"><span>Monthly</span><span>'+fmt(p.monthly)+'/mo</span></div></div>';

  document.getElementById('redownload-proposal-btn').onclick = function() { generateProposalFromData(p); closeModal('modal-redownload'); };
  document.getElementById('redownload-agreement-btn').onclick = function() { generateAgreementFromData(p); closeModal('modal-redownload'); };
  openModal('modal-redownload');
};

window.downloadSavedProposal = function(id) {
  var p = findSavedRecord(id);
  if (p) generateProposalFromData(p);
};

window.downloadSavedAgreement = function(id) {
  var p = findSavedRecord(id);
  if (p) generateAgreementFromData(p);
};

window.deleteProposal = async function(id) {
  proposalHistory = proposalHistory.filter(function(p){return p.id!==id;});
  await saveProposalHistory();
  renderHistory();
  toast('Proposal removed');
};
window.purgeOldProposals = async function() {
  autoPurgeProposals();
  renderHistory();
  toast('Purged proposals older than 90 days');
};
window.clearAllProposals = async function() {
  if (!confirm('Delete ALL saved proposals? This cannot be undone.')) return;
  proposalHistory = [];
  await saveProposalHistory();
  renderHistory();
  toast('All proposals cleared');
};

// ============================================================
// ORDER TYPE
// ============================================================
function selectOrderType(type, el, selClass) {
  orderType = type;
  document.querySelectorAll('.ot-card').forEach(function(c){c.className='ot-card';});
  el.className = 'ot-card ' + selClass;
  document.getElementById('t-order-type-line').textContent = 'Order Type: ' + ({new:'New',addon:'Add-On',renewal:'Renewal'}[type]||'New');
  updateTotals();
}
window.selectOrderType = selectOrderType;

// ============================================================
// TAX
// ============================================================
var TAX_STATES = ['SC','FL'];
function isTaxable() {
  var state = (document.getElementById('q-state').value || '').toUpperCase().trim();
  var metro = (document.getElementById('q-metro').value || '').toUpperCase();
  for (var i = 0; i < TAX_STATES.length; i++) {
    if (state === TAX_STATES[i]) return true;
    if (metro.indexOf(TAX_STATES[i]) >= 0) return true;
  }
  return false;
}
function getTaxRate() {
  if (!isTaxable()) return 0;
  return parseFloat(document.getElementById('tax-rate-input').value) || 0;
}
function updateTaxUI() {
  var taxable = isTaxable();
  var lbl = document.getElementById('tax-state-lbl');
  var inp = document.getElementById('tax-rate-input');
  var row = document.getElementById('tax-row');
  if (taxable) {
    var st = (document.getElementById('q-state').value || '').toUpperCase().trim();
    lbl.textContent = '(' + st + ')';
    inp.disabled = false; inp.style.opacity = '1';
    row.style.opacity = '1';
  } else {
    lbl.textContent = '(N/A — not taxable)';
    inp.value = '0'; inp.disabled = true;
    inp.style.opacity = '0.35'; row.style.opacity = '0.55';
  }
}

// ============================================================
// EFFECTIVE MONTHLY
// ============================================================
function getEffectiveMonthly() {
  var raw = 0;
  for (var i = 0; i < selectedPlans.length; i++) raw += selectedPlans[i].rate * selectedPlans[i].qty;
  var applyMin = (orderType === 'new') && (selectedPlans.length > 0) && (raw < MIN_MONTHLY_NEW);
  var effective = applyMin ? MIN_MONTHLY_NEW : raw;
  return { raw: raw, effective: effective, usedMin: applyMin };
}

// ============================================================
// TOTALS
// ============================================================
function updateTotals() {
  updateTaxUI();
  var equipSub = 0;
  for (var i = 0; i < selectedEquipment.length; i++) equipSub += selectedEquipment[i].unitPrice * selectedEquipment[i].qty;
  var taxRate = getTaxRate();
  var taxAmt = equipSub * (taxRate / 100);
  var m = getEffectiveMonthly();
  var deposit = m.effective * 2;
  var total = equipSub + taxAmt + deposit;
  document.getElementById('t-equip').textContent = fmt(equipSub);
  document.getElementById('t-tax').textContent = fmt(taxAmt);
  document.getElementById('t-deposit').textContent = fmt(deposit);
  document.getElementById('t-total').textContent = fmt(total);
  document.getElementById('t-monthly').textContent = fmt(m.effective) + '/mo';
  var minBadge = document.getElementById('min-monthly-badge');
  var minText = document.getElementById('min-monthly-text');
  var minNote = document.getElementById('t-min-note');
  if (m.usedMin) {
    minBadge.style.display = 'inline-flex';
    minText.textContent = 'Safety Platform Fee applied (plan total: ' + fmt(m.raw) + ')';
    minNote.textContent = '* Safety Platform Fee applied';
  } else {
    minBadge.style.display = 'none';
    minNote.textContent = '';
  }
}
window.updateTotals = updateTotals;

// ============================================================
// PLAN GRID
// ============================================================
function renderPlanGrid() {
  var grid = document.getElementById('plan-grid');
  if (!grid) return;
  var html = '';
  for (var i = 0; i < plans.length; i++) {
    var p = plans[i];
    var sel = selectedPlans.some(function(sp){return sp.planId === p.id;});
    html += '<div class="plan-card' + (sel ? ' selected' : '') + '" id="plan-card-' + p.id + '" onclick="togglePlan(' + p.id + ')">';
    html += '<div class="plan-name">' + p.name + '</div>';
    html += '<div class="plan-price">' + fmt(p.rate) + '<span>/mo per unit</span></div>';
    html += '<div class="plan-desc">' + p.desc + '</div></div>';
  }
  grid.innerHTML = html;
  renderSelectedPlans();
}
function togglePlan(id) {
  var idx = -1;
  for (var i = 0; i < selectedPlans.length; i++) { if (selectedPlans[i].planId === id) { idx = i; break; } }
  if (idx === -1) {
    for (var j = 0; j < plans.length; j++) {
      if (plans[j].id === id) { selectedPlans.push({planId:id,name:plans[j].name,rate:plans[j].rate,qty:1}); break; }
    }
    var c = document.getElementById('plan-card-' + id); if (c) c.classList.add('selected');
  } else {
    selectedPlans.splice(idx, 1);
    var c2 = document.getElementById('plan-card-' + id); if (c2) c2.classList.remove('selected');
  }
  renderSelectedPlans(); updateTotals();
}
window.togglePlan = togglePlan;

function renderSelectedPlans() {
  var tbody = document.getElementById('plans-tbody');
  var area = document.getElementById('selected-plans-area');
  if (!tbody || !area) return;
  if (selectedPlans.length === 0) { area.style.display = 'none'; return; }
  area.style.display = 'block';
  var html = '';
  for (var i = 0; i < selectedPlans.length; i++) {
    var sp = selectedPlans[i];
    html += '<tr><td><input class="qty-input" type="number" min="1" value="' + sp.qty + '" onchange="updatePlanQty(' + i + ',this.value)"></td>';
    html += '<td>' + sp.name + '</td><td class="price-cell">' + fmt(sp.rate) + '</td>';
    html += '<td class="price-cell">' + fmt(sp.rate * sp.qty) + '</td>';
    html += '<td><button class="remove-btn" onclick="removePlan(' + i + ')">✕</button></td></tr>';
  }
  tbody.innerHTML = html;
}
window.updatePlanQty = function(i, v) { selectedPlans[i].qty = parseInt(v) || 1; renderSelectedPlans(); updateTotals(); };
window.removePlan = function(i) {
  var pid = selectedPlans[i].planId; selectedPlans.splice(i, 1);
  var c = document.getElementById('plan-card-' + pid); if (c) c.classList.remove('selected');
  renderSelectedPlans(); updateTotals();
};

// ============================================================
// CONTRACT
// ============================================================
function selectContract(val, el) {
  contractTerm = val;
  document.querySelectorAll('.contract-option').forEach(function(e){e.classList.remove('selected');});
  el.classList.add('selected');
  document.getElementById('t-contract-term').textContent = 'Contract: ' + (val === 'mtm' ? 'Month-to-Month' : val + ' Months');
  updateTotals();
}
window.selectContract = selectContract;

// ============================================================
// EQUIPMENT
// ============================================================
function openAddProduct() {
  var sel = document.getElementById('modal-product-select'), html = '';
  for (var i = 0; i < catalog.length; i++) {
    var p = catalog[i];
    if (p.active) html += '<option value="' + p.id + '">' + p.desc + ' — ' + fmt(p.price) + '</option>';
  }
  sel.innerHTML = html;
  document.getElementById('modal-qty').value = 1;
  document.getElementById('modal-price').value = '';
  openModal('modal-add-product');
}
window.openAddProduct = openAddProduct;

function addProductToQuote() {
  var id = parseInt(document.getElementById('modal-product-select').value);
  var product = null;
  for (var i = 0; i < catalog.length; i++) { if (catalog[i].id === id) { product = catalog[i]; break; } }
  if (!product) return;
  var qty = parseInt(document.getElementById('modal-qty').value) || 1;
  var cp = document.getElementById('modal-price').value;
  var price = cp ? parseFloat(cp) : (contractTerm === '36' ? product.price3yr : product.price);
  selectedEquipment.push({productId:id, desc:product.desc, unitPrice:price, qty:qty, category:product.category});
  closeModal('modal-add-product');
  renderEquipmentTable(); updateTotals();
  toast('Product added to quote');
}
window.addProductToQuote = addProductToQuote;

function renderEquipmentTable() {
  var tbody = document.getElementById('equipment-tbody');
  var table = document.getElementById('equipment-table');
  var empty = document.getElementById('equipment-empty');
  if (selectedEquipment.length === 0) { table.style.display = 'none'; empty.style.display = 'block'; return; }
  table.style.display = 'table'; empty.style.display = 'none';
  var html = '';
  for (var i = 0; i < selectedEquipment.length; i++) {
    var e = selectedEquipment[i];
    html += '<tr><td><input class="qty-input" type="number" min="1" value="' + e.qty + '" onchange="updateEquipQty(' + i + ',this.value)"></td>';
    html += '<td><span class="badge badge-blue">' + e.category + '</span>&nbsp; ' + e.desc + '</td>';
    html += '<td class="price-cell">' + fmt(e.unitPrice) + '</td>';
    html += '<td class="price-cell">' + fmt(e.unitPrice * e.qty) + '</td>';
    html += '<td><button class="remove-btn" onclick="removeEquip(' + i + ')">✕</button></td></tr>';
  }
  tbody.innerHTML = html;
}
window.updateEquipQty = function(i, v) { selectedEquipment[i].qty = parseInt(v) || 1; renderEquipmentTable(); updateTotals(); };
window.removeEquip = function(i) { selectedEquipment.splice(i, 1); renderEquipmentTable(); updateTotals(); };

// ============================================================
// ADMIN
// ============================================================
function renderAdmin() {
  if (!isAdmin) return;
  var catalogSearch = (document.getElementById('catalog-search').value || '').toLowerCase().trim();
  var plansSearch = (document.getElementById('plans-search').value || '').toLowerCase().trim();
  var tb = document.getElementById('catalog-tbody'), html = '';
  for (var i = 0; i < catalog.length; i++) {
    var p = catalog[i];
    if (catalogSearch && [p.sku, p.desc, p.category, p.active ? 'active' : 'hidden'].join(' ').toLowerCase().indexOf(catalogSearch) === -1) continue;
    html += '<tr><td><span class="badge badge-blue">' + p.sku + '</span></td><td>' + p.desc + '</td>';
    html += '<td><span class="badge badge-orange">' + p.category + '</span></td>';
    html += '<td class="price-cell">' + fmt(p.price) + '</td><td class="price-cell">' + fmt(p.price3yr) + '</td>';
    html += '<td><span class="badge ' + (p.active ? 'badge-green' : 'badge-red') + '">' + (p.active ? 'Active' : 'Hidden') + '</span></td>';
    html += '<td><button class="btn btn-outline btn-sm" onclick="editProduct(' + p.id + ')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deleteProduct(' + p.id + ')">Delete</button></td></tr>';
  }
  document.getElementById('catalog-tbody').innerHTML = html;
  var pt = document.getElementById('plans-catalog-tbody'), ph = '';
  for (var j = 0; j < plans.length; j++) {
    var pl = plans[j];
    if (plansSearch && [pl.name, pl.desc, String(pl.rate)].join(' ').toLowerCase().indexOf(plansSearch) === -1) continue;
    ph += '<tr><td style="font-weight:600">' + pl.name + '</td><td style="color:var(--muted)">' + pl.desc + '</td>';
    ph += '<td class="price-cell">' + fmt(pl.rate) + '/mo</td>';
    ph += '<td><button class="btn btn-outline btn-sm" onclick="editPlan(' + pl.id + ')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deletePlan(' + pl.id + ')">Delete</button></td></tr>';
  }
  document.getElementById('plans-catalog-tbody').innerHTML = ph;
}
window.openNewProduct = function() {
  document.getElementById('modal-np-title').textContent = 'Add New Product';
  ['np-id','np-sku','np-desc','np-price','np-price-3yr'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('np-active').value = 'true';
  openModal('modal-new-product');
};
window.editProduct = function(id) {
  var p = null; for (var i=0;i<catalog.length;i++){if(catalog[i].id===id){p=catalog[i];break;}}
  if (!p) return;
  document.getElementById('modal-np-title').textContent = 'Edit Product';
  document.getElementById('np-id').value = p.id;
  document.getElementById('np-sku').value = p.sku;
  document.getElementById('np-desc').value = p.desc;
  document.getElementById('np-category').value = p.category;
  document.getElementById('np-price').value = p.price;
  document.getElementById('np-price-3yr').value = p.price3yr;
  document.getElementById('np-active').value = p.active ? 'true' : 'false';
  openModal('modal-new-product');
};
window.saveProduct = async function() {
  var id = document.getElementById('np-id').value;
  var data = {
    id: id ? parseInt(id) : Date.now(),
    sku: document.getElementById('np-sku').value,
    desc: document.getElementById('np-desc').value,
    category: document.getElementById('np-category').value,
    price: parseFloat(document.getElementById('np-price').value) || 0,
    price3yr: parseFloat(document.getElementById('np-price-3yr').value) || parseFloat(document.getElementById('np-price').value) || 0,
    active: document.getElementById('np-active').value === 'true'
  };
  if (id) { for (var i=0;i<catalog.length;i++){if(catalog[i].id===parseInt(id)){catalog[i]=data;break;}}}
  else { catalog.push(data); }
  await saveData(); closeModal('modal-new-product'); renderAdmin(); toast('Product saved');
};
window.deleteProduct = async function(id) {
  if (!confirm('Delete this product from the catalog?')) return;
  catalog = catalog.filter(function(p){return p.id!==id;}); await saveData(); renderAdmin(); toast('Deleted');
};
window.openNewPlan = function() {
  document.getElementById('modal-np2-title').textContent = 'Add Monthly Plan';
  ['np2-id','np2-name','np2-desc','np2-rate'].forEach(function(id){document.getElementById(id).value='';});
  openModal('modal-new-plan');
};
window.editPlan = function(id) {
  var p = null; for (var i=0;i<plans.length;i++){if(plans[i].id===id){p=plans[i];break;}}
  if (!p) return;
  document.getElementById('modal-np2-title').textContent = 'Edit Plan';
  document.getElementById('np2-id').value = p.id;
  document.getElementById('np2-name').value = p.name;
  document.getElementById('np2-desc').value = p.desc;
  document.getElementById('np2-rate').value = p.rate;
  openModal('modal-new-plan');
};
window.savePlan = async function() {
  var id = document.getElementById('np2-id').value;
  var data = {id:id?parseInt(id):Date.now(),name:document.getElementById('np2-name').value,desc:document.getElementById('np2-desc').value,rate:parseFloat(document.getElementById('np2-rate').value)||0};
  if (id) { for (var i=0;i<plans.length;i++){if(plans[i].id===parseInt(id)){plans[i]=data;break;}}}
  else { plans.push(data); }
  await saveData(); closeModal('modal-new-plan'); renderAdmin(); renderPlanGrid(); toast('Plan saved');
};
window.deletePlan = async function(id) {
  if (!confirm('Delete this plan?')) return;
  plans = plans.filter(function(p){return p.id!==id;}); await saveData(); renderAdmin(); renderPlanGrid(); toast('Deleted');
};

// ============================================================
// QUOTE DATA HELPER
// ============================================================
function getQuoteData() {
  var m = getEffectiveMonthly();
  var taxRate = getTaxRate();
  var equipSub = 0;
  for (var i=0;i<selectedEquipment.length;i++) equipSub += selectedEquipment[i].unitPrice * selectedEquipment[i].qty;
  var taxAmt = equipSub * (taxRate / 100);
  var deposit = m.effective * 2;
  return {
    company: document.getElementById('q-company').value || '',
    contact: document.getElementById('q-contact').value || '',
    title: document.getElementById('q-title').value || '',
    email: document.getElementById('q-email').value || '',
    address: document.getElementById('q-address').value || '',
    city: document.getElementById('q-city').value || '',
    state: document.getElementById('q-state').value || '',
    zip: document.getElementById('q-zip').value || '',
    phone: document.getElementById('q-phone').value || '',
    website: document.getElementById('q-website').value || '',
    challenge: document.getElementById('q-challenge').value || '',
    rep: document.getElementById('q-rep').value || '',
    metro: document.getElementById('q-metro').value || '',
    notes: document.getElementById('q-notes').value || '',
    paymentTerms: document.getElementById('q-payment-terms').value,
    contractTerm: contractTerm,
    orderType: orderType,
    equipment: selectedEquipment,
    plans: selectedPlans,
    taxRate: taxRate,
    taxAmt: taxAmt,
    equipSub: equipSub,
    monthly: m.effective,
    monthlyRaw: m.raw,
    usedMin: m.usedMin,
    deposit: deposit,
    total: equipSub + taxAmt + deposit,
    orderLabel: {new:'NEW ORDER',addon:'ADD-ON ORDER',renewal:'RENEWAL'}[orderType] || 'NEW ORDER',
    termLabel: contractTerm === 'mtm' ? 'Month-to-Month' : contractTerm + '-Month Term'
  };
}

// ============================================================
// PREVIEW
// ============================================================
window.previewQuote = function() {
  var d = getQuoteData();
  var otColors = {new:'var(--blue)',addon:'#16a34a',renewal:'var(--orange)'};
  var otColor = otColors[d.orderType] || 'var(--blue)';
  var er = '';
  for (var i=0;i<d.equipment.length;i++){var e=d.equipment[i];er+='<tr><td style="padding:8px 10px;text-align:center">'+e.qty+'</td><td style="padding:8px 10px">'+e.desc+'</td><td style="padding:8px 10px;text-align:right">'+fmt(e.unitPrice)+'</td><td style="padding:8px 10px;text-align:right;font-weight:600">'+fmt(e.unitPrice*e.qty)+'</td></tr>';}
  var pr = '';
  for (var j=0;j<d.plans.length;j++){var pl=d.plans[j];pr+='<tr><td style="padding:8px 10px;text-align:center">'+pl.qty+'</td><td style="padding:8px 10px">'+pl.name+'</td><td style="padding:8px 10px;text-align:right">'+fmt(pl.rate)+'</td><td style="padding:8px 10px;text-align:right;font-weight:600">'+fmt(pl.rate*pl.qty)+'</td></tr>';}
  document.getElementById('preview-content').innerHTML =
    '<div style="background:linear-gradient(135deg,var(--dark),#0d2040);color:white;border-radius:10px;padding:18px;margin-bottom:16px">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
    '<div><div style="font-size:19px;font-weight:700">'+d.company+'</div><div style="opacity:0.6;font-size:13px;margin-top:2px">'+d.contact+(d.title?', '+d.title:'')+'</div></div>'+
    '<div style="text-align:right"><span style="background:'+otColor+';color:white;padding:3px 11px;border-radius:5px;font-size:11.5px;font-weight:700">'+d.orderLabel+'</span><div style="margin-top:6px;font-size:11px;opacity:0.5">'+d.termLabel+'</div></div></div></div>'+
    (d.equipment.length ? '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px"><thead style="background:var(--dark);color:white"><tr><th style="padding:8px 10px;text-align:center;width:40px">Qty</th><th style="padding:8px 10px;text-align:left">Equipment</th><th style="padding:8px 10px;text-align:right">Unit</th><th style="padding:8px 10px;text-align:right">Ext.</th></tr></thead><tbody>'+er+'</tbody></table>' : '') +
    (d.plans.length ? '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px"><thead style="background:#1a3a6a;color:white"><tr><th style="padding:8px 10px;text-align:center;width:40px">Qty</th><th style="padding:8px 10px;text-align:left">Plan</th><th style="padding:8px 10px;text-align:right">Rate</th><th style="padding:8px 10px;text-align:right">Total</th></tr></thead><tbody>'+pr+'</tbody></table>' : '') +
    '<div style="background:#f4f8ff;border-radius:9px;padding:16px;font-size:13.5px">'+
    '<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--muted)">Equipment Subtotal</span><strong>'+fmt(d.equipSub)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--muted)">Tax'+(d.taxRate>0?' ('+d.taxRate+'%)':' (N/A)')+'</span><strong>'+fmt(d.taxAmt)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--muted)">Access Plan Deposit (2 mo.)</span><strong>'+fmt(d.deposit)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #dde8f5;margin-top:8px;font-size:17px"><span style="font-weight:700">Total Amount Due</span><strong style="color:var(--blue-mid)">'+fmt(d.total)+'</strong></div>'+
    '<div style="display:flex;justify-content:space-between;color:var(--orange);font-weight:700;font-size:15px"><span>Monthly Total'+(d.usedMin?' <small style=\'font-size:10px;opacity:0.7\'>(min applied)</small>':'')+'</span><span>'+fmt(d.monthly)+'/mo</span></div></div>';
  openModal('modal-preview');
};

// ============================================================
// PDF HELPERS
// ============================================================
var C = {
  dark:   [5, 16, 34],
  mid:    [12, 40, 83],
  blue:   [26, 74, 138],
  orange: [255, 120, 1],
  light:  [240, 246, 255],
  white:  [255, 255, 255],
  muted:  [120, 135, 158],
  text:   [25, 38, 58]
};
var PDF_LOGO_LIGHT_URL = 'https://cdn.baseline.is/static/content/logos/VpXJH6gs4Xy6HhRNbzgkmM-lala.svg';
var PDF_LOGO_DARK_URL = 'https://cdn.baseline.is/static/content/logos/mDtvptChQ3XwBLuxuu5hip-lala.svg';
var pdfLogoCache = {};
function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setStroke(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
function setTxt(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function loadImageAsDataUrl(url) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch(e) {
        resolve(null);
      }
    };
    img.onerror = function() { resolve(null); };
    img.src = url;
  });
}

async function getPdfLogoData(mode) {
  var key = mode === 'light' ? 'light' : 'dark';
  if (pdfLogoCache[key] !== undefined) return pdfLogoCache[key];
  var url = key === 'light' ? PDF_LOGO_LIGHT_URL : PDF_LOGO_DARK_URL;
  pdfLogoCache[key] = await loadImageAsDataUrl(url);
  return pdfLogoCache[key];
}

function drawPdfLogo(doc, x, y, scale) {
  scale = scale || 1;
  setFill(doc, C.orange);
  doc.circle(x+12*scale, y+12*scale, 8*scale, 'F');
  setFill(doc, C.dark);
  doc.circle(x+12*scale, y+12*scale, 4.2*scale, 'F');
  setFill(doc, C.orange);
  doc.circle(x+12*scale, y+12*scale, 1.6*scale, 'F');
  setStroke(doc, [255, 200, 138]);
  doc.setLineWidth(1.1*scale);
  doc.line(x+1*scale, y+12*scale, x+23*scale, y+12*scale);
  doc.line(x+12*scale, y+1*scale, x+12*scale, y+23*scale);
  doc.setFont('helvetica','bold');
  doc.setFontSize(18*scale);
  setTxt(doc, C.white);
  doc.text('TRAXXIS', x+28*scale, y+14*scale);
  setTxt(doc, C.orange);
  doc.text('GPS', x+100*scale, y+14*scale);
  doc.setFont('helvetica','normal');
  doc.setFontSize(6*scale);
  setTxt(doc, [140, 160, 190]);
  doc.text('FLEET TRACKING SOLUTIONS', x+28*scale, y+22*scale);
}
function addPdfFooter(doc, W, H, M) {
  var n = doc.internal.getNumberOfPages();
  for (var i = 1; i <= n; i++) {
    doc.setPage(i);
    var fh = H - 28;
    setFill(doc, C.dark); doc.rect(0, fh, W, 28, 'F');
    setFill(doc, C.orange); doc.rect(0, fh, W, 3, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(7);
    setTxt(doc, [120, 140, 170]);
    doc.text('Traxxis GPS Solutions, Inc. | 114 E. Main St., Suite 201, Rock Hill, SC 29730 | 888.447.7059 | www.traxxisgps.com', W/2, H-12, {align:'center'});
    setTxt(doc, [100, 130, 180]);
    doc.text('Page ' + i + ' of ' + n, W-M, H-12, {align:'right'});
    setTxt(doc, [80, 100, 130]);
    doc.text('CONFIDENTIAL', M, H-12);
  }
}
function checkPageBreak(doc, y, needed, H, M) {
  if (y + needed > H - 46) { doc.addPage(); return 54; }
  return y;
}
async function addPdfPageHeader(doc, opts) {
  var W = opts.W, title = opts.title, subtitle = opts.subtitle || '', rightLines = opts.rightLines || [], M = opts.M || 42;
  setFill(doc, C.dark); doc.rect(0, 0, W, 80, 'F');
  setFill(doc, C.orange); doc.rect(0, 80, W, 4, 'F');
  setFill(doc, C.blue); doc.rect(0, 84, W, 26, 'F');
  var logoData = await getPdfLogoData('dark');
  if (logoData) {
    doc.addImage(logoData, 'PNG', M, 22, 164, 32);
  } else {
    drawPdfLogo(doc, M, 22, 1.08);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); setTxt(doc, [198, 210, 228]);
  if (subtitle) doc.text(subtitle, W - M, 26, {align:'right'});
  for (var i = 0; i < rightLines.length; i++) {
    doc.text(rightLines[i], W - M, 40 + (i * 10), {align:'right'});
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setTxt(doc, C.white);
  doc.text(title, W/2, 100, {align:'center'});
}
function addPdfInfoGrid(doc, startY, leftItems, rightItems, layout) {
  var y = startY;
  var leftX = layout.leftX, rightX = layout.rightX, colWidth = layout.colWidth;
  function item(label, value, x, yy) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); setTxt(doc, C.muted);
    doc.text(label, x, yy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setTxt(doc, value ? C.text : [190, 198, 210]);
    var lines = doc.splitTextToSize(value || '-', colWidth);
    doc.text(lines, x, yy + 15);
    return Math.max(26, lines.length * 12 + 14);
  }
  for (var i = 0; i < Math.max(leftItems.length, rightItems.length); i++) {
    var leftH = leftItems[i] ? item(leftItems[i].label, leftItems[i].value, leftX, y) : 18;
    var rightH = rightItems[i] ? item(rightItems[i].label, rightItems[i].value, rightX, y) : 18;
    y += Math.max(leftH, rightH);
  }
  return y;
}
function addPdfCustomerTable(doc, startY, rows, width, margin) {
  doc.autoTable({
    startY: startY,
    margin: {left: margin, right: margin},
    body: rows,
    theme: 'grid',
    styles: {fontSize:8.8, textColor:C.text, cellPadding:{top:7,bottom:7,left:8,right:8}, lineColor:[220,228,240], lineWidth:0.5, overflow:'linebreak', valign:'middle'},
    columnStyles: {
      0: {cellWidth: 92, fontStyle:'bold', textColor:C.muted, fillColor:[248,250,253]},
      1: {cellWidth: width, textColor:C.text},
      2: {cellWidth: 92, fontStyle:'bold', textColor:C.muted, fillColor:[248,250,253]},
      3: {cellWidth: width, textColor:C.text}
    }
  });
  return doc.lastAutoTable.finalY + 12;
}
function addPdfSummaryCard(doc, d, opts) {
  var x = opts.x, y = opts.y, w = opts.w;
  setFill(doc, [246, 249, 253]); doc.roundedRect(x, y, w, 126, 8, 8, 'F');
  setFill(doc, C.orange); doc.roundedRect(x, y, 5, 126, 3, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, C.mid);
  doc.text('PRICING SUMMARY', x + 16, y + 18);
  function row(label, value, yy, color, bold) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10 : 8.5);
    setTxt(doc, [86, 102, 126]);
    doc.text(label, x + 16, yy);
    doc.setTextColor.apply(doc, color || C.text);
    doc.text(value, x + w - 14, yy, {align:'right'});
  }
  row('Equipment Subtotal', fmt(d.equipSub), y + 38);
  row('Tax' + (d.taxRate > 0 ? ' (' + d.taxRate + '%)' : ' (N/A)'), d.taxRate > 0 ? fmt(d.taxAmt) : '$0.00', y + 54);
  row('Deposit (2 months)', fmt(d.deposit), y + 70);
  setStroke(doc, [50, 72, 108]); doc.setLineWidth(0.5); doc.line(x + 16, y + 78, x + w - 14, y + 78);
  row('TOTAL DUE', fmt(d.total), y + 94, C.orange, true);
  row('Monthly Total', fmt(d.monthly) + '/mo', y + 110, C.blue, true);
  return y + 138;
}
// ============================================================
// PROPOSAL PDF - works from either live form data or saved record
// ============================================================
async function generateProposalFromData(d) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({orientation:'portrait', unit:'pt', format:'letter'});
  var W = 612, H = 792, M = 42;
  var today = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  await addPdfPageHeader(doc, {
    W: W,
    M: M,
    title: 'COMMERCIAL SALES AND SERVICE PROPOSAL',
    subtitle: d.orderLabel,
    rightLines: [today, '888.447.7059', 'www.traxxisgps.com']
  });
  var y = 132;
  function secHdr(text, accent) {
    y = checkPageBreak(doc, y, 40, H, M);
    accent = accent || C.orange;
    setFill(doc, [244, 248, 255]); doc.rect(M, y, W-2*M, 18, 'F');
    setFill(doc, accent); doc.rect(M, y, 4, 18, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); setTxt(doc, C.mid);
    doc.text(text, M+11, y+12);
    y += 22;
  }
  secHdr('CUSTOMER INFORMATION');
  y = addPdfCustomerTable(doc, y, [
    ['COMPANY / BILL TO', d.company || '-', 'ATTENTION', (d.contact || '-') + (d.title ? ', ' + d.title : '')],
    ['ADDRESS', d.address || '-', 'CITY, STATE, ZIP', [d.city,d.state,d.zip].filter(Boolean).join(', ') || '-'],
    ['TELEPHONE', d.phone || '-', 'EMAIL', d.email || '-'],
    ['WEBSITE', d.website || '-', 'TRAXXIS REP', d.rep || '-']
  ], 163, M);
  if (d.challenge) {
    doc.setFont('helvetica','bold'); doc.setFontSize(6.5); setTxt(doc, C.muted);
    doc.text('CUSTOMER CHALLENGE / NEED', M + 4, y);
    y += 14;
    doc.setFont('helvetica','italic'); doc.setFontSize(9); setTxt(doc, [85,100,120]);
    doc.text(doc.splitTextToSize(d.challenge, W-2*M-10), M + 4, y);
    y += doc.splitTextToSize(d.challenge, W-2*M-10).length * 12 + 10;
  }
  setStroke(doc, [220,228,240]); doc.setLineWidth(0.5); doc.line(M, y+2, W-M, y+2); y+=10;
  if (d.equipment.length > 0) {
    secHdr('EQUIPMENT DETAILS');
    doc.autoTable({
      startY: y, margin: {left:M, right:M},
      head: [['QTY','DESCRIPTION','UNIT PRICE','EXT. PRICE']],
      body: d.equipment.map(function(e){return[e.qty, e.desc, fmt(e.unitPrice), fmt(e.unitPrice*e.qty)];}),
      headStyles: {fillColor:C.mid, textColor:[255,255,255], fontSize:7.5, fontStyle:'bold', cellPadding:{top:6,bottom:6,left:8,right:8}},
      bodyStyles: {fontSize:9, cellPadding:{top:6,bottom:6,left:8,right:8}, textColor:C.text, valign:'middle'},
      columnStyles: {0:{cellWidth:36,halign:'center'}, 2:{cellWidth:80,halign:'right'}, 3:{cellWidth:82,halign:'right'}},
      alternateRowStyles: {fillColor:[249,252,255]},
      styles: {lineColor:[220,228,240], lineWidth:0.5, overflow:'linebreak'}
    });
    y = doc.lastAutoTable.finalY + 8;
    setFill(doc, [236,242,252]); doc.rect(W-M-210, y, 210, 22, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt(doc, [90,110,140]);
    doc.text('TERMS: '+d.paymentTerms, M, y+14);
    doc.setFont('helvetica','bold'); setTxt(doc, C.mid);
    doc.text('EQUIPMENT SUBTOTAL', W-M-200, y+14);
    setTxt(doc, C.orange); doc.text(fmt(d.equipSub), W-M-8, y+14, {align:'right'});
    y += 32;
  }
  if (d.plans.length > 0) {
    y = checkPageBreak(doc, y, 120, H, M);
    secHdr('MONTHLY ACCESS PLAN DETAILS', C.blue);
    doc.autoTable({
      startY: y, margin: {left:M, right:M},
      head: [['QTY','PLAN NAME','MONTHLY RATE','TOTAL/MO']],
      body: d.plans.map(function(p){return[p.qty, p.name, fmt(p.rate), fmt(p.rate*p.qty)];}),
      headStyles: {fillColor:C.mid, textColor:[255,255,255], fontSize:7.5, fontStyle:'bold', cellPadding:{top:6,bottom:6,left:8,right:8}},
      bodyStyles: {fontSize:9, cellPadding:{top:6,bottom:6,left:8,right:8}, textColor:C.text, valign:'middle'},
      columnStyles: {0:{cellWidth:36,halign:'center'}, 2:{cellWidth:90,halign:'right'}, 3:{cellWidth:90,halign:'right'}},
      alternateRowStyles: {fillColor:[249,252,255]},
      styles: {lineColor:[220,228,240], lineWidth:0.5, overflow:'linebreak'}
    });
    y = doc.lastAutoTable.finalY + 8;
    setFill(doc, [236,242,252]); doc.rect(W-M-210, y, 210, 22, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt(doc, [90,110,140]);
    doc.text('COMMITMENT: '+d.termLabel.toUpperCase(), M, y+14);
    doc.setFont('helvetica','bold'); setTxt(doc, C.mid);
    doc.text('MONTHLY TOTAL', W-M-200, y+14);
    setTxt(doc, C.orange); doc.text(fmt(d.monthly)+'/mo', W-M-8, y+14, {align:'right'});
    if (d.usedMin) {
      doc.setFont('helvetica','italic'); doc.setFontSize(7); setTxt(doc, [160,100,50]);
      doc.text('* Safety Platform Fee applied', W-M-8, y+30, {align:'right'});
    }
    y += d.usedMin ? 40 : 32;
  }
  y = checkPageBreak(doc, y, d.notes ? 210 : 160, H, M);
  if (d.notes) {
    secHdr('NOTES / INTERNAL DETAILS', C.blue);
    setFill(doc, [248, 250, 253]); doc.roundedRect(M, y, W - (M * 2), 86, 8, 8, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt(doc, [85,100,120]);
    doc.text(doc.splitTextToSize(d.notes, W - (M * 2) - 22), M + 10, y + 18);
    y += 98;
  }
  y = checkPageBreak(doc, y, 150, H, M);
  addPdfSummaryCard(doc, d, {x: M, y: y, w: W - (M * 2)});
  doc.setFont('helvetica','normal'); doc.setFontSize(7.2); setTxt(doc, [60,80,115]);
  doc.text('Contract: ' + d.termLabel + ' | ' + d.orderLabel, M + 16, y + 152);
  addPdfFooter(doc, W, H, M);
  doc.save((d.company||'Proposal').replace(/[^a-z0-9]/gi,'_')+'_Proposal.pdf');
  toast('Proposal PDF downloaded!');
}
window.generateProposal = function() {
  generateProposalFromData(getQuoteData());
};
// ============================================================
// AGREEMENT PDF - works from either live form data or saved record
// ============================================================
async function generateAgreementFromData(d) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({orientation:'portrait', unit:'pt', format:'letter'});
  var W = 612, H = 792, M = 38;
  var today = new Date().toLocaleDateString('en-US');
  await addPdfPageHeader(doc, {
    W: W,
    M: M,
    title: 'COMMERCIAL SALES AND SERVICE AGREEMENT',
    subtitle: d.orderLabel,
    rightLines: [today, '888.447.7059', 'www.traxxisgps.com']
  });
  var y = 132;
  function aSecHdr(text, accentColor) {
    y = checkPageBreak(doc, y, 38, H, M);
    accentColor = accentColor || C.orange;
    setFill(doc, [241,246,255]); doc.rect(M, y, W-2*M, 16, 'F');
    setFill(doc, accentColor); doc.rect(M, y, 4, 16, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt(doc, C.mid);
    doc.text(text, M+10, y+11);
    y += 19;
  }
  aSecHdr('CUSTOMER DETAILS');
  y = addPdfCustomerTable(doc, y, [
    ['ORDER DATE', today, 'TYPE', ({new:'NEW',addon:'ADD-ON',renewal:'RENEWAL'})[d.orderType]||'NEW'],
    ['BILL TO', d.company || '-', 'SHIP TO', d.company || '-'],
    ['ATTENTION', d.contact || '-', 'TITLE', d.title || '-'],
    ['ADDRESS', d.address || '-', 'CITY, STATE, ZIP', [d.city,d.state,d.zip].filter(Boolean).join(', ') || '-'],
    ['TELEPHONE', d.phone || '-', 'EMAIL', d.email || '-']
  ], 160, M);
  setStroke(doc, [218,228,245]); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 7;
  aSecHdr('EQUIPMENT DETAILS');
  doc.setFont('helvetica','normal'); doc.setFontSize(7); setTxt(doc, [110,128,155]);
  doc.text('Billed by:', W/2-26, y+6);
  doc.setFontSize(8.5); setTxt(doc, C.orange);
  doc.text('TRAXXIS GPS SOLUTIONS, INC.', W/2+10, y+6);
  y += 14;
  doc.autoTable({
    startY: y,
    margin: {left:M, right:M},
    head: [['QTY','DESCRIPTION','UNIT PRICE','EXT. PRICE']],
    body: d.equipment.map(function(e){ return [e.qty, e.desc, fmt(e.unitPrice), fmt(e.unitPrice * e.qty)]; }),
    headStyles: {fillColor:C.mid, textColor:[255,255,255], fontSize:7.5, fontStyle:'bold', cellPadding:{top:6,bottom:6,left:8,right:8}},
    bodyStyles: {fontSize:8.8, cellPadding:{top:6,bottom:6,left:8,right:8}, textColor:C.text, valign:'middle'},
    columnStyles: {0:{cellWidth:40, halign:'center'}, 2:{cellWidth:92, halign:'right'}, 3:{cellWidth:92, halign:'right'}},
    alternateRowStyles: {fillColor:[249,252,255]},
    styles: {lineColor:[220,228,240], lineWidth:0.5, overflow:'linebreak'}
  });
  y = doc.lastAutoTable.finalY + 8;
  setFill(doc, [236,244,255]); doc.rect(W-M-176, y, 176, 20, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt(doc, C.mid);
  doc.text('TERMS: ' + d.paymentTerms.toUpperCase(), M+4, y+13);
  doc.text('SUBTOTAL', W-M-166, y+13);
  setTxt(doc, C.orange); doc.text(fmt(d.equipSub), W-M-8, y+13, {align:'right'});
  y += 28;
  doc.line(M, y, W-M, y); y += 7;
  aSecHdr('MONTHLY ACCESS PLAN DETAILS', C.blue);
  doc.setFont('helvetica','normal'); doc.setFontSize(7); setTxt(doc, [110,128,155]);
  doc.text('Monthly billing commences at activation or 30 days from signing, whichever comes first.', M+4, y+6);
  y += 14;
  doc.autoTable({
    startY: y,
    margin: {left:M, right:M},
    head: [['QTY','PLAN NAME','MONTHLY RATE','TOTAL / MO']],
    body: d.plans.map(function(p){ return [p.qty, p.name, fmt(p.rate), fmt(p.rate * p.qty)]; }),
    headStyles: {fillColor:C.mid, textColor:[255,255,255], fontSize:7.5, fontStyle:'bold', cellPadding:{top:6,bottom:6,left:8,right:8}},
    bodyStyles: {fontSize:8.8, cellPadding:{top:6,bottom:6,left:8,right:8}, textColor:C.text},
    columnStyles: {0:{cellWidth:40, halign:'center'}, 2:{cellWidth:92, halign:'right'}, 3:{cellWidth:92, halign:'right'}},
    alternateRowStyles: {fillColor:[249,252,255]},
    styles: {lineColor:[220,228,240], lineWidth:0.5, overflow:'linebreak'}
  });
  y = doc.lastAutoTable.finalY + 8;
  doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt(doc, C.mid);
  doc.text('MINIMUM SERVICE COMMITMENT: ' + d.termLabel.toUpperCase(), M+4, y+13);
  setFill(doc, [236,244,255]); doc.rect(W-M-175, y, 175, 20, 'F');
  doc.text('MONTHLY TOTAL', W-M-165, y+13);
  setTxt(doc, C.orange); doc.text(fmt(d.monthly)+'/mo', W-M-8, y+13, {align:'right'});
  if (d.usedMin) {
    doc.setFont('helvetica','italic'); doc.setFontSize(6.5); setTxt(doc,[160,100,50]);
    doc.text('* Safety Platform Fee applied', W-M-8, y+29, {align:'right'});
    y += 8;
  }
  y += 30;
  doc.line(M, y, W-M, y); y += 7;
  aSecHdr('AGREEMENT DETAILS / NOTES');
  if (d.notes) {
    setFill(doc, [248, 250, 253]); doc.roundedRect(M, y + 4, W - (M * 2), 80, 8, 8, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); setTxt(doc, [85,100,120]);
    doc.text(doc.splitTextToSize(d.notes, W - (M * 2) - 20), M+10, y+22);
    y += 92;
  }
  y = checkPageBreak(doc, y, 190, H, M);
  var ttx = M, ttw = W - (M * 2);
  function agTotRow(lbl, val, big, vc) {
    setFill(doc, big ? [236,244,255] : [244,249,255]); doc.rect(ttx, y, ttw, 18, 'F');
    setStroke(doc, [215,226,242]); doc.line(ttx, y+18, ttx+ttw, y+18);
    doc.setFont('helvetica', big ? 'bold' : 'normal'); doc.setFontSize(big ? 9 : 8);
    doc.setTextColor.apply(doc, vc || C.text);
    doc.text(lbl, ttx+6, y+12);
    doc.text(val, ttx+ttw-6, y+12, {align:'right'});
    y += 18;
  }
  agTotRow('EQUIPMENT SUBTOTAL', fmt(d.equipSub));
  agTotRow('TAX'+(d.taxRate>0?' ('+d.taxRate+'%)':' (N/A)'), d.taxRate>0?fmt(d.taxAmt):'$0.00');
  agTotRow('DEPOSIT (2 MO. ACCESS PLAN)', fmt(d.deposit));
  agTotRow('TOTAL AMOUNT DUE', fmt(d.total), true, [10,60,140]);
  agTotRow('DOWN PAYMENT', '$0.00');
  agTotRow('BALANCE DUE', fmt(d.total), true, C.text);
  y += 10;
  y = checkPageBreak(doc, y, 205, H, M);
  setFill(doc, [255,252,242]); doc.rect(M, y, W-2*M, 17, 'F');
  setFill(doc, C.orange); doc.rect(M, y, 3, 17, 'F');
  doc.setFont('helvetica','italic'); doc.setFontSize(6.5); setTxt(doc, [120,100,70]);
  doc.text('Use of Geotab products is conditioned upon acceptance of the Geotab End User Agreement attached hereto.', M+8, y+11);
  y += 20;
  setFill(doc, [243,247,255]); doc.rect(M, y, W-2*M, 16, 'F');
  doc.setFont('helvetica','normal'); doc.setFontSize(6.2); setTxt(doc, [60,75,100]);
  doc.text('BY SIGNING, CUSTOMER ACCEPTS THIS AGREEMENT AND ALL PAYMENT TERMS. RIGHTS AND OBLIGATIONS ARE GOVERNED BY THE TRAXXIS GPS SOLUTIONS', M+4, y+7);
  doc.text('COMMERCIAL SALES AND SERVICE AGREEMENT TERMS AND CONDITIONS.', M+4, y+13);
  y += 20;
  function sigLine(lbl, val, x, yy, w) {
    setStroke(doc, [180,195,220]); doc.setLineWidth(0.5); doc.line(x, yy+15, x+w, yy+15);
    doc.setFont('helvetica','bold'); doc.setFontSize(5.8); setTxt(doc, [110,130,160]);
    doc.text(lbl+':', x, yy);
    if (val) { doc.setFont('helvetica','normal'); doc.setFontSize(8.5); setTxt(doc, C.text); doc.text(val, x, yy+11); }
  }
  var hw = (W-2*M)/2-10;
  var s1 = y + 6;
  sigLine('CUSTOMER', d.company, M, s1, hw);
  sigLine('TRAXXIS REP', d.rep, M+hw+20, s1, hw);
  var s2 = s1+28;
  sigLine('ACCEPTED BY (SIGNATURE)', '', M, s2, hw);
  sigLine('REP (SIGNATURE)', '', M+hw+20, s2, hw);
  var s3 = s2+28;
  sigLine('NAME (PRINT)', d.contact, M, s3, hw);
  sigLine('TITLE', d.title, M+hw+20, s3, hw);
  var s4 = s3+28;
  sigLine('DATE', '', M, s4, hw);
  sigLine('DATE', today, M+hw+20, s4, hw);
  doc.addPage();
  await addPdfPageHeader(doc, {
    W: W,
    M: M,
    title: 'COMMERCIAL SALES AND SERVICE AGREEMENT',
    subtitle: 'TERMS AND CONDITIONS',
    rightLines: ['Traxxis GPS Solutions', 'Terms and conditions']
  });
  var terms = [
    {h:true,t:'1. TERMS AND CONDITIONS'},
    {h:false,t:'These Terms and Conditions are incorporated into the Traxxis GPS Solutions, Inc. Commercial Sales and Service Agreement. Traxxis GPS retains title to all Products until paid in full. Customer may cancel within 30 days of signing, subject to a 30% restocking fee.'},
    {h:true,t:'2. DELIVERY, RISK OF LOSS, TITLE AND SECURITY INTEREST'},
    {h:false,t:'Deliveries are FCA/FOB Traxxis GPS warehouse. Customer assumes risk of loss upon delivery. Customer grants Traxxis GPS a security interest in Products to secure payment.'},
    {h:true,t:'3. PAYMENT TERMS'},
    {h:false,t:'Customer agrees to pay all invoices within 30 days. Late payments bear interest at 1.5% per month. Traxxis GPS may suspend services for non-payment and increase monthly fees upon 60 days notice.'},
    {h:true,t:'4. SERVICE INTERRUPTIONS'},
    {h:false,t:'Services may be temporarily unavailable due to maintenance or causes beyond control including acts of God, topographic conditions, or governmental actions. GPS coverage may not be available in all areas.'},
    {h:true,t:'5. EQUIPMENT WARRANTY'},
    {h:false,t:'Products are warranted free from defects for one (1) year under normal use. This warranty does not apply to cosmetic damage, accident, misuse, or unauthorized modifications. WARRANTIES ARE EXCLUSIVE AND IN LIEU OF ALL OTHER WARRANTIES.'},
    {h:true,t:'6. LIMITATION OF LIABILITY'},
    {h:false,t:'IN NO EVENT SHALL TRAXXIS GPS BE LIABLE FOR ANY INCIDENTAL, SPECIAL, INDIRECT, OR CONSEQUENTIAL DAMAGES. TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID DURING THE SIX (6) MONTHS PRECEDING THE CLAIM.'},
    {h:true,t:'7. INDEMNIFICATION AND DATA PRIVACY'},
    {h:false,t:'Customer shall indemnify Traxxis GPS from claims arising from use of Products or failure to comply with applicable laws. Customer is solely responsible for compliance with all privacy, electronic communications, and biometric data laws.'},
    {h:true,t:'8. TERM AND TERMINATION'},
    {h:false,t:'The initial term is as specified. Agreement auto-renews for successive one (1) year periods unless 30 days written notice is provided. Early termination results in a fee equal to remaining monthly service fees.'},
    {h:true,t:'9. MISCELLANEOUS'},
    {h:false,t:'This Agreement is governed by South Carolina law. Disputes shall be resolved in courts in Greenville County, SC. This constitutes the entire understanding between the parties. Confidential Information shall not be disclosed for five (5) years.'},
    {h:true,t:'CONTACT'},
    {h:false,t:'Phone: 888.447.7059 | Email: support@traxxisgps.com | 114 East Main Street, Suite 201, Rock Hill, SC 29730'}
  ];
  var ty = 108;
  for (var t=0; t<terms.length; t++) {
    if (ty > H-48) { doc.addPage(); ty = 42; }
    var item = terms[t];
    if (item.h) {
      ty += 4;
      doc.setFont('helvetica','bold'); doc.setFontSize(8); setTxt(doc, [20,70,140]);
    } else {
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); setTxt(doc, [50,65,85]);
    }
    var wlines = doc.splitTextToSize(item.t, W-2*M);
    for (var wi=0; wi<wlines.length; wi++) {
      if (ty > H-48) { doc.addPage(); ty = 42; }
      doc.text(wlines[wi], M, ty);
      ty += item.h ? 11 : 10;
    }
    if (!item.h) ty += 3;
  }
  addPdfFooter(doc, W, H, M);
  doc.save((d.company||'Agreement').replace(/[^a-z0-9]/gi,'_')+'_Agreement.pdf');
  toast('Agreement PDF downloaded!');
}

window.generateAgreement = function() {
  generateAgreementFromData(getQuoteData());
};

window.saveProposalOnly = async function() {
  if (!isAdmin) { toast('Admin sign-in required to save documents', true); return; }
  saveProposalRecord('Proposal');
  await saveProposalHistory();
  toast(editingRecordType === 'Proposal' ? 'Proposal updated' : 'Proposal saved');
};

window.saveAgreementOnly = async function() {
  if (!isAdmin) { toast('Admin sign-in required to save documents', true); return; }
  saveProposalRecord('Agreement');
  await saveProposalHistory();
  toast(editingRecordType === 'Agreement' ? 'Agreement updated' : 'Agreement saved');
};

// ============================================================
// MODAL CLOSE ON BACKDROP
// ============================================================
document.querySelectorAll('.modal-overlay').forEach(function(o){
  o.addEventListener('click', function(e){ if(e.target===this) closeModal(this.id); });
});

// ============================================================
// BOOT
// ============================================================
initAuth();









