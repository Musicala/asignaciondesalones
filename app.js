// app.js
import { loginWithGoogle, logout, onUserChanged, isAdminEmail } from "./auth.js";
import { db, FIREBASE_RUNTIME } from "./firebase.js";
import { setupModalPro } from "./modalPro.js";

import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =============================================================================
  Horario Musicala · app.js (Firebase) — vPRO MAX+++ (Day Auto + Sticky Rooms + Lists)
  -----------------------------------------------------------------------------
  ✅ Tabla 30 min x 10 salones (rowSpan)
  ✅ Modo edición + Modal PRO (ahora en modalPro.js)
  ✅ Auto-text (respeta si editas manual)
  ✅ Color por docente (paleta)
  ✅ Drag&drop mover/copiar (Alt/Ctrl/Meta) con validación de solapes
  ✅ Delegation + render eficiente
  ✅ Tabs: Vivo, Salas, Docentes, Buscar, KPIs
  ✅ Estado red (cache vs server)
  ✅ GitHub Pages: fallback read-only si Auth anon falla
  ✅ Auto-selección del día real (y respeta elección solo “hoy”)
  ✅ Columna “salón” sticky para no perder visibilidad al scrollear
============================================================================= */

/* =============================================================================
   Config base (window.APP_CONFIG)
============================================================================= */
const CFG = (() => {
  const c = window.APP_CONFIG || {};
  return {
    days: c.days || ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"],
    slotMinutes: c.slotMinutes ?? 30,
    startMin: c.startMin ?? (8*60 + 0),
    endMin: c.endMin ?? (20*60),
    rooms: c.rooms || [
      "Salón 1:\nBaile",
      "Salón 2:\nArtes",
      "Salón 3:\nMusicalitos",
      "Salón 4:\nMultipropósito",
      "Salón 5:\nMúsica",
      "Salón 6:\nMultipropósito",
      "Salón 7:\nMultipropósito",
      "Salón 8:\nMusicalitos",
      "Salón 9:\nBaile",
      "Salón 10:\nMultipropósito"
    ],
    docentesPalette: c.docentesPalette || {},
    modalidades: c.modalidades || ["Sede","Virtual"]
  };
})();

const SALONES   = CFG.rooms;
const START_MIN = CFG.startMin;
const END_MIN   = CFG.endMin;
const STEP_MIN  = CFG.slotMinutes;

/* =============================================================================
   Time helpers
============================================================================= */
const clamp = (n,min,max)=>Math.max(min, Math.min(max,n));
const pad2 = (n)=>String(n).padStart(2,'0');

const toHHMM = (m) => {
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${pad2(h)}:${pad2(mm)}`;
};

function formatRange(startMin, endMin){
  return `${toHHMM(startMin)} a ${toHHMM(endMin)}`;
}

function labelRangeHTML(slotStart){
  const a = toHHMM(slotStart);
  const b = toHHMM(slotStart + STEP_MIN);
  return `<span class="timeStack"><span>${a}</span><span>${b}</span></span>`;
}

function nowMinutes(){
  const d = new Date();
  return d.getHours()*60 + d.getMinutes();
}

function slotStartForMinutes(mins){
  const t = clamp(mins, START_MIN, END_MIN-STEP_MIN);
  const offset = t - START_MIN;
  const snap = Math.floor(offset / STEP_MIN) * STEP_MIN;
  return START_MIN + snap;
}

const SLOTS = [];
for (let m=START_MIN; m<END_MIN; m+=STEP_MIN) SLOTS.push(m);

/* =============================================================================
   LocalStorage safe + Día real + listas (docentes/modalidades)
============================================================================= */
const LS_KEYS = {
  lastHoja: 'horario_lastHoja',
  lastDate: 'horario_lastHojaDate',
  docentes: 'horario_docentes_palette_v1',
  modalidades: 'horario_modalidades_v1'
};

function safeGetLS(key){
  try{ return localStorage.getItem(key); }catch(_){ return null; }
}
function safeSetLS(key,val){
  try{ localStorage.setItem(key, val); }catch(_){}
}

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function getTodayHoja(){
  const map = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const d = new Date();
  return map[d.getDay()] || 'Lunes';
}

function pickInitialHoja(){
  const today = getTodayHoja();
  const iso = todayISO();

  const savedDay = safeGetLS(LS_KEYS.lastHoja);
  const savedDate = safeGetLS(LS_KEYS.lastDate);

  if (savedDay && savedDate === iso && CFG.days.includes(savedDay)) return savedDay;
  if (CFG.days.includes(today)) return today;
  return 'Lunes';
}

/* ===== Docentes palette persistente (LS) ===== */
function loadDocentesPalette(){
  const raw = safeGetLS(LS_KEYS.docentes);
  if (raw){
    try{
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    }catch(_){}
  }
  return { ...(CFG.docentesPalette || {}) };
}
function saveDocentesPalette(pal){
  safeSetLS(LS_KEYS.docentes, JSON.stringify(pal || {}));
}

/* ===== Modalidades persistentes (LS) ===== */
function loadModalidades(){
  const raw = safeGetLS(LS_KEYS.modalidades);
  if (raw){
    try{
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(x=>String(x).trim()).filter(Boolean);
    }catch(_){}
  }
  return Array.isArray(CFG.modalidades) && CFG.modalidades.length ? CFG.modalidades.slice() : ["Sede","Virtual"];
}
function saveModalidades(mods){
  safeSetLS(LS_KEYS.modalidades, JSON.stringify(mods || []));
}

let DOCENTES_PALETTE = loadDocentesPalette();
let MODALIDADES = loadModalidades();

/* =============================================================================
   DOM
============================================================================= */
const qs = (s,root=document)=>root.querySelector(s);
const qsa = (s,root=document)=>Array.from(root.querySelectorAll(s));

const $selHoja = qs('#selHoja');
const $toggleEdit = qs('#toggleEdit');
const $btnFull = qs('#btnFull');
const $editControl = qs('#editControl');
const $authBadge = qs('#authBadge');
const $authText = qs('#authText');
const $btnLoginGoogle = qs('#btnLoginGoogle');
const $btnLogout = qs('#btnLogout');
const $tablaHelp = qs('#tablaHelp');

const $dot = qs('#dot');
const $netText = qs('#netText');
const $clock = qs('#clock');

const $miniDot = qs('#miniDot');
const $loadText = qs('#loadText');
const $statusMsg = qs('#statusMsg');

const $thead = qs('#thead');
const $tbody = qs('#tbody');
const $tableWrap = qs('.tableWrap');

// Modal DOM (los maneja modalPro.js)
const $modalBack = qs('#modalBack');
const $btnCloseModal = qs('#btnCloseModal');
const $btnCancel = qs('#btnCancel');
const $btnSave = qs('#btnSave');
const $btnDelete = qs('#btnDelete');

const $mHoja = qs('#mHoja');
const $mSalon = qs('#mSalon');
const $mStart = qs('#mStart');
const $mEnd = qs('#mEnd');

const $mText = qs('#mText');
const $mNote = qs('#mNote');
const $modalTitle = qs('#modalTitle');

const $mGrupo = qs('#mGrupo');
const $mDocente = qs('#mDocente');     // input en tu index (modalPro lo convierte a select)
const $mModalidad = qs('#mModalidad'); // idem

// Tabs views
const $salasWrap = qs('#salasWrap');
const $docentesWrap = qs('#docentesWrap');
const $buscarWrap = qs('#buscarWrap');
const $kpisWrap = qs('#kpisWrap');

// Docentes tab controls
const $txtDocente = qs('#txtDocente');
const $btnBuscarDocente = qs('#btnBuscarDocente');
const $btnDocentesTodos = qs('#btnDocentesTodos');

// Buscar tab controls
const $txtQuery = qs('#txtQuery');
const $btnBuscar = qs('#btnBuscar');
const $btnBuscarClear = qs('#btnBuscarClear');

// KPIs
const $btnKpisRefresh = qs('#btnKpisRefresh');

// En vivo
const $btnVivoPrev = qs('#btnVivoPrev');
const $btnVivoNow  = qs('#btnVivoNow');
const $btnVivoNext = qs('#btnVivoNext');

const $vivoSlotLabel = qs('#vivoSlotLabel');
const $vivoPrevTime = qs('#vivoPrevTime');
const $vivoNowTime = qs('#vivoNowTime');
const $vivoNextTime = qs('#vivoNextTime');

const $vivoPrevWrap = qs('#vivoPrevWrap');
const $vivoNowWrap = qs('#vivoNowWrap');
const $vivoNextWrap = qs('#vivoNextWrap');

// Badges opcionales
const $editBadge = qs('#editBadge');
const $dragBadge = qs('#dragBadge');
const $dragBadgeText = qs('#dragBadgeText');

/* =============================================================================
   State
============================================================================= */
let EDIT_MODE = false;
let currentHoja = $selHoja?.value || 'Lunes';

let blocks = [];
let blocksById = new Map();
let unsub = null;

// En vivo
let vivoOffset = 0;
let vivoTimer = null;

// Auth/runtime
let AUTH_OK = false;
let IS_ADMIN = false;
let CURRENT_USER = null;
let READ_ONLY = true;
let LAST_ERR = null;
let LAST_SNAPSHOT_FROM_CACHE = null;
let LAST_BLOCKS_COUNT = 0;

// Pointer Drag state
let dragState = null;
const DRAG_THRESHOLD_PX = 7;

// Modal API (modalPro.js)
let modalAPI = null;

/* =============================================================================
   UI helpers
============================================================================= */
function setNet(ok, text){
  if ($dot){
    $dot.style.background = ok ? 'var(--ok)' : 'var(--warn)';
    $dot.style.boxShadow  = ok ? '0 0 0 4px rgba(22,163,74,.22)' : '0 0 0 4px rgba(245,158,11,.22)';
  }
  if ($netText) $netText.textContent = text;
}

function setLoad(ok, text, msg){
  if ($miniDot){
    $miniDot.style.background = ok ? 'var(--ok)' : 'var(--warn)';
    $miniDot.style.boxShadow  = ok ? '0 0 0 4px rgba(22,163,74,.18)' : '0 0 0 4px rgba(245,158,11,.18)';
  }
  if ($loadText) $loadText.textContent = text;
  if ($statusMsg) $statusMsg.textContent = msg || '';
}

function isDevMode(){
  return window.APP_CONFIG?.showDebugPanel === true;
}

function renderDiagnostics(){
  if (!isDevMode()){
    qs('#devDiagnostics')?.remove();
    return;
  }

  let panel = qs('#devDiagnostics');
  if (!panel){
    panel = document.createElement('aside');
    panel.id = 'devDiagnostics';
    panel.className = 'devDiagnostics';
    panel.setAttribute('aria-label', 'Diagnostico de desarrollo');
    document.body.appendChild(panel);
  }

  const source = FIREBASE_RUNTIME.useEmulators ? 'Emulador' : 'Firestore real';
  const cache = LAST_SNAPSHOT_FROM_CACHE === null ? 'sin snapshot' : (LAST_SNAPSHOT_FROM_CACHE ? 'cache' : 'server');
  const auth = IS_ADMIN ? 'admin activo' : (CURRENT_USER ? 'sin permisos' : 'publico');

  panel.innerHTML = `
    <div class="devDiagTitle">Diagnostico local</div>
    <div><strong>Dia:</strong> ${esc(currentHoja)}</div>
    <div><strong>Bloques:</strong> ${LAST_BLOCKS_COUNT}</div>
    <div><strong>Origen:</strong> ${esc(cache)}</div>
    <div><strong>Firebase:</strong> ${esc(source)}</div>
    <div><strong>Auth:</strong> ${esc(auth)}</div>
  `;
}

function isAdminTab(tab){
  return ['salas','docentes','buscar','kpis'].includes(tab);
}

function setActiveTabSafe(tab){
  const next = (!IS_ADMIN && isAdminTab(tab)) ? 'tabla' : (tab || 'tabla');
  if (typeof window.setActiveTab === 'function') window.setActiveTab(next);
  else window.__ACTIVE_TAB__ = next;
}

function applyAccessUI(){
  READ_ONLY = !IS_ADMIN;
  if (!IS_ADMIN){
    EDIT_MODE = false;
    if ($toggleEdit) $toggleEdit.checked = false;
    cancelDrag();
  }

  document.body.classList.toggle('isAdmin', IS_ADMIN);
  document.body.classList.toggle('isPublic', !IS_ADMIN);
  qsa('.adminOnly').forEach(el => { el.hidden = !IS_ADMIN; });

  if ($editControl) $editControl.hidden = !IS_ADMIN;
  if ($tablaHelp){
    $tablaHelp.innerHTML = IS_ADMIN
      ? 'Tip: activa <strong>Editar</strong> para crear/modificar bloques.<br />Drag & drop: arrastra para mover. Mantén <strong>Alt/Ctrl</strong> para copiar.'
      : 'Vista de consulta del horario Musicala.';
  }

  if ($btnLoginGoogle){
    $btnLoginGoogle.hidden = !!CURRENT_USER && IS_ADMIN;
    $btnLoginGoogle.textContent = CURRENT_USER && !IS_ADMIN ? 'Cambiar cuenta' : 'Acceso admin';
  }
  if ($btnLogout) $btnLogout.hidden = !CURRENT_USER;

  if ($authBadge){
    $authBadge.textContent = IS_ADMIN ? 'Admin' : 'Consulta';
    $authBadge.classList.toggle('admin', IS_ADMIN);
  }

  if ($authText){
    if (IS_ADMIN){
      $authText.textContent = CURRENT_USER?.email || 'Admin Musicala';
    }else if (CURRENT_USER){
      $authText.textContent = 'Sesión iniciada sin permisos de edición';
    }else{
      $authText.textContent = 'Vista de consulta del horario Musicala';
    }
  }

  if (!IS_ADMIN && isAdminTab(activeTab())) setActiveTabSafe('tabla');
  showEditBadge(IS_ADMIN && EDIT_MODE);
  showDragBadge(false);
  renderDiagnostics();
  refreshAllViews();
}

function esc(s){
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}

function salonLabel(i){
  return (SALONES[i] || '').split('\n')[0].replace(':','').trim() || `Salón ${i+1}`;
}

/* ===== Badges helpers ===== */
function showEditBadge(on){
  if (!$editBadge) return;
  $editBadge.classList.toggle('show', !!on);
}
function showDragBadge(on, text){
  if (!$dragBadge) return;
  if ($dragBadgeText && typeof text === 'string') $dragBadgeText.textContent = text;
  $dragBadge.classList.toggle('show', !!on);
}

/* =============================================================================
   Text build (PRO)
============================================================================= */
function buildTextFromFields({grupo, docente, modalidad, note}){
  const parts = [];
  if (grupo) parts.push(grupo.trim());
  if (docente) parts.push(docente.trim());
  if (modalidad) parts.push(modalidad.trim());
  if (note) parts.push(note.trim());
  return parts.filter(Boolean).join(' · ');
}

function parseDocenteFromText(text=''){
  const t = (text || '').trim();
  if (!t) return '';
  const parts = t.split('·').map(x=>x.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  const keys = Object.keys(DOCENTES_PALETTE || {});
  const hit = keys.find(k => t.toLowerCase().includes(k.toLowerCase()));
  return hit || '';
}

function colorForDocente(docente, text){
  const d = (docente || '').trim();
  if (d && DOCENTES_PALETTE[d]) return DOCENTES_PALETTE[d];
  const fromText = parseDocenteFromText(text);
  if (fromText && DOCENTES_PALETTE[fromText]) return DOCENTES_PALETTE[fromText];
  return '';
}

/* =============================================================================
   Sticky column: “salón” siempre visible al scrollear horizontal/vertical
============================================================================= */
function ensureStickyRoomsCSS(){
  if (qs('#__stickyRoomsCSS')) return;
  const st = document.createElement('style');
  st.id = '__stickyRoomsCSS';
  st.textContent = `
    table.grid thead th:first-child,
    table.grid tbody th:first-child{
      position: sticky;
      left: 0;
      z-index: 9;
      background: rgba(255,255,255,.94);
      backdrop-filter: blur(8px);
    }
    table.grid thead th{
      position: sticky;
      top: 0;
      z-index: 8;
      background: rgba(255,255,255,.94);
      backdrop-filter: blur(8px);
    }
    @media (max-width: 560px){
      table.grid tbody th:first-child,
      table.grid tbody td{
        position: static;
        left: auto;
        z-index: auto;
        box-shadow: none;
        backdrop-filter: none;
      }
      table.grid thead{
        position: sticky;
        top: 0;
        z-index: 20;
      }
      table.grid thead th{
        position: sticky;
        top: 0;
        z-index: 21;
        background: rgba(255,255,255,.96);
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 18px rgba(15,23,42,.08);
      }
      table.grid thead th:first-child{
        left: auto;
        z-index: 22;
      }
    }
  `;
  document.head.appendChild(st);
}

/* =============================================================================
   Table build
============================================================================= */
function buildHeader(){
  if (!$thead) return;
  const tr = document.createElement('tr');
  const thHora = document.createElement('th');
  thHora.textContent = 'Hora';
  tr.appendChild(thHora);

  SALONES.forEach((s) => {
    const th = document.createElement('th');
    th.innerHTML = esc(s).replaceAll('\n','<br>');
    tr.appendChild(th);
  });

  $thead.innerHTML = '';
  $thead.appendChild(tr);
}

function ensureMobileSalonHeader(){
  if (!$tableWrap || qs('#mobileSalonHeader')) return;

  const header = document.createElement('div');
  header.id = 'mobileSalonHeader';
  header.className = 'mobileSalonHeader';
  header.setAttribute('aria-hidden', 'true');

  header.innerHTML = `
    <div class="mobileSalonHeaderInner">
      <div class="mobileSalonTime">Hora</div>
      ${SALONES.map((s, i) => `
        <div class="mobileSalonName">${esc(salonLabel(i))}</div>
      `).join('')}
    </div>
  `;

  document.body.appendChild(header);

  const update = () => {
    const isMobile = window.matchMedia('(max-width: 560px)').matches;
    const active = activeTab() === 'tabla';
    if (!isMobile || !active){
      header.classList.remove('show');
      return;
    }

    const rect = $tableWrap.getBoundingClientRect();
    const shouldShow = rect.top < 0 && rect.bottom > 54;
    header.classList.toggle('show', shouldShow);
    if (!shouldShow) return;

    header.style.left = `${Math.max(0, rect.left)}px`;
    header.style.width = `${Math.min(window.innerWidth, rect.width)}px`;
    header.querySelector('.mobileSalonHeaderInner').style.transform = `translateX(${-($tableWrap.scrollLeft || 0)}px)`;
  };

  window.addEventListener('scroll', update, { passive:true });
  window.addEventListener('resize', update);
  $tableWrap.addEventListener('scroll', update, { passive:true });
  window.addEventListener('tabchange', update);
  update();
}

function reindexBlocks(){
  blocksById = new Map();
  for (const b of blocks) blocksById.set(b.id, b);
}

function indexBlocksForGrid(){
  const map = new Map();
  for (const b of blocks){
    map.set(`${b.startMin}|${b.salonIndex}`, b);
  }
  return map;
}

/* =============================================================================
   Validations
============================================================================= */
function isWithinBounds(startMin, endMin){
  return Number.isFinite(startMin) && Number.isFinite(endMin)
    && startMin >= START_MIN
    && endMin <= END_MIN
    && endMin > startMin
    && ((startMin - START_MIN) % STEP_MIN === 0)
    && ((endMin - START_MIN) % STEP_MIN === 0);
}

function hasOverlap({ignoreId=null, salonIndex, startMin, endMin}){
  return blocks.some(b => {
    if (ignoreId && b.id === ignoreId) return false;
    if (b.salonIndex !== salonIndex) return false;
    const a0 = startMin, a1 = endMin;
    const b0 = b.startMin, b1 = b.endMin;
    return Math.max(a0,b0) < Math.min(a1,b1);
  });
}

/* =============================================================================
   Rendering helpers (lists/cards)
============================================================================= */
function blockDisplayText(b){
  const t = (b.text || '').trim();
  if (t) return t;
  const built = buildTextFromFields({
    grupo: b.grupo || '',
    docente: b.docente || '',
    modalidad: b.modalidad || '',
    note: b.note || ''
  });
  return built || '(sin texto)';
}

function blockMetaLine(b){
  const parts = [];
  if (b.docente) parts.push(b.docente);
  if (b.modalidad) parts.push(b.modalidad);
  if (b.note) parts.push(`📝 ${b.note}`);
  return parts.join(' · ');
}

function makeMiniCard({title, subtitle, rightPill, contentHtml}){
  return `
    <div class="miniCard">
      <div class="miniHead">
        <div>
          <div class="miniTitle">${esc(title)}</div>
          ${subtitle ? `<div class="miniSub">${esc(subtitle)}</div>` : ``}
        </div>
        ${rightPill ? `<div class="miniPill">${esc(rightPill)}</div>` : ``}
      </div>
      <div class="miniBody">${contentHtml || ''}</div>
    </div>
  `;
}

function ensureMiniCardStylesOnce(){
  if (qs('#__miniCardStyles')) return;
  const st = document.createElement('style');
  st.id = '__miniCardStyles';
  st.textContent = `
    .miniCard{
      background: rgba(255,255,255,.92);
      border:1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow2);
      overflow:hidden;
      margin-bottom:12px;
    }
    .miniHead{
      display:flex;
      justify-content:space-between;
      align-items:flex-start;
      gap:12px;
      padding: 12px 14px;
      border-bottom:1px solid var(--line);
      background:
        radial-gradient(520px 180px at 12% 0%, rgba(12,65,196,.10), transparent 60%),
        radial-gradient(520px 180px at 88% 0%, rgba(206,0,113,.10), transparent 60%),
        rgba(255,255,255,.70);
    }
    .miniTitle{ font-weight:1000; font-size:16px; letter-spacing:-.2px; }
    .miniSub{ margin-top:4px; color:var(--muted); font-weight:800; font-size:12px; }
    .miniPill{
      white-space:nowrap;
      border:1px solid var(--line);
      border-radius:999px;
      padding:8px 10px;
      font-weight:950;
      background:rgba(255,255,255,.85);
      box-shadow: 0 8px 18px rgba(15,23,42,.08);
    }
    .miniBody{ padding: 12px 14px; }
    .listItem{
      border:1px solid rgba(12,65,196,.16);
      background: rgba(255,255,255,.94);
      border-radius: 14px;
      padding: 10px 12px;
      display:flex;
      justify-content:space-between;
      gap:12px;
      margin-bottom:10px;
    }
    .listLeft{ min-width:0; }
    .listMain{ font-weight:1000; color: var(--ink); line-height:1.15; }
    .listMeta{ margin-top:6px; color: var(--muted); font-weight:800; font-size:12px; }
    .listRight{
      display:flex;
      flex-direction:column;
      align-items:flex-end;
      gap:6px;
      flex:0 0 auto;
    }
    .pillTime{
      border-radius:999px;
      padding: 6px 10px;
      font-weight:950;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.85);
      white-space:nowrap;
    }
    .pillRoom{
      border-radius:999px;
      padding: 6px 10px;
      font-weight:950;
      border: 1px solid rgba(0,0,0,.08);
      background: rgba(255,255,255,.75);
      white-space:nowrap;
    }
    .btnMini{
      border:1px solid rgba(0,0,0,.10);
      background: rgba(255,255,255,.92);
      border-radius: 12px;
      padding: 7px 10px;
      font-weight: 950;
      cursor:pointer;
    }
    .btnMini:hover{ filter: brightness(.98); }
    .kpiGrid{
      display:grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap: 12px;
    }
    @media (max-width: 1100px){
      .kpiGrid{ grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
    @media (max-width: 560px){
      .kpiGrid{ grid-template-columns: 1fr; }
    }
    .kpiBox{
      background: rgba(255,255,255,.92);
      border:1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      box-shadow: var(--shadow2);
    }
    .kpiLabel{ color: var(--muted); font-weight: 900; font-size: 12px; text-transform: uppercase; letter-spacing:.25px; }
    .kpiValue{ margin-top:6px; font-weight: 1100; font-size: 22px; letter-spacing:-.3px; }
    .kpiHint{ margin-top:6px; color: var(--muted); font-weight: 800; font-size: 12px; }

    .dropTarget{ outline: 2px dashed rgba(12,65,196,.35); outline-offset: -4px; }
    .dropInvalid{ outline-color: rgba(239,68,68,.55) !important; background: rgba(239,68,68,.06) !important; }

    .timeStack{
      display:flex;
      flex-direction:column;
      gap:2px;
      line-height:1.05;
      font-size:12px;
      font-weight:1000;
      letter-spacing:-.2px;
    }
    .timeStack span:last-child{
      opacity:.75;
      font-weight:950;
    }
  `;
  document.head.appendChild(st);
}

/* =============================================================================
   Grid render
============================================================================= */
function renderGrid(){
  if (!$tbody) return;
  ensureMiniCardStylesOnce();
  ensureStickyRoomsCSS();

  const map = indexBlocksForGrid();
  const skip = new Set();

  const frag = document.createDocumentFragment();

  for (const slotMin of SLOTS){
    const tr = document.createElement('tr');

    const th = document.createElement('th');
    th.innerHTML = labelRangeHTML(slotMin);
    tr.appendChild(th);

    for (let salonIndex=0; salonIndex<SALONES.length; salonIndex++){
      const key = `${slotMin}|${salonIndex}`;
      if (skip.has(key)) continue;

      const td = document.createElement('td');
      td.dataset.slot = String(slotMin);
      td.dataset.salon = String(salonIndex);

      const b = map.get(key);

      if (b){
        const span = Math.max(1, Math.round((b.endMin - b.startMin)/STEP_MIN));
        td.rowSpan = span;

        for (let k=1; k<span; k++){
          skip.add(`${slotMin + k*STEP_MIN}|${salonIndex}`);
        }

        const docenteColor = colorForDocente(b.docente, b.text);
        if (docenteColor){
          td.style.background = docenteColor;
          td.style.borderColor = 'rgba(0,0,0,.12)';
        }else{
          td.style.background = '';
        }

        const noteHtml = b.note ? `<div class="note">📝 ${esc(b.note)}</div>` : ``;
        const main = esc(blockDisplayText(b));

        td.innerHTML = `
          <div class="cell block"
               data-block-id="${esc(b.id)}"
               data-start="${esc(b.startMin)}"
               data-end="${esc(b.endMin)}"
               data-salon="${esc(b.salonIndex)}"
               title="${esc(blockDisplayText(b))}">
            <div class="mainText">${main}</div>
            ${noteHtml}
          </div>
        `;

        td.style.cursor = (EDIT_MODE && !READ_ONLY) ? 'grab' : 'default';
      }else{
        if (EDIT_MODE && !READ_ONLY){
          td.classList.add('tdCenter');
          td.innerHTML = `<button class="pillEdit" type="button">EDIT</button>`;
        }else{
          td.innerHTML = '';
        }
      }

      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(frag);
}

/* =============================================================================
   POINTER: click vs drag (delegation)
============================================================================= */
function bindDragSafetyListeners(){
  document.addEventListener('pointermove', onPointerMove, { passive:false });
  document.addEventListener('pointerup', onPointerUp, { passive:false });
  document.addEventListener('pointercancel', onPointerCancel, { passive:false });
  window.addEventListener('blur', onWindowBlur, { passive:true });
  document.addEventListener('visibilitychange', onVisibilityChange, { passive:true });
  document.addEventListener('keydown', onDragKey);
}
function unbindDragSafetyListeners(){
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  window.removeEventListener('blur', onWindowBlur);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('keydown', onDragKey);
}

function armPointer(ev, block){
  if (!EDIT_MODE || READ_ONLY) return;
  if (ev.button !== 0) return;
  if ($modalBack && $modalBack.hidden === false) return;

  ev.preventDefault();

  const copy = ev.altKey || ev.ctrlKey || ev.metaKey;
  const dur = (block.endMin - block.startMin);

  dragState = {
    phase: 'armed',
    pointerId: ev.pointerId,
    sourceEl: ev.currentTarget || null,
    downX: ev.clientX,
    downY: ev.clientY,
    block,
    copy,
    dur,
    ghostEl: null,
    started: false,
    didDrag: false,
    rafPending: false,
    lastHoverTd: null
  };

  showDragBadge(true, copy ? 'Copiar' : 'Mover');

  try{ ev.currentTarget?.setPointerCapture?.(ev.pointerId); }catch(_){}

  unbindDragSafetyListeners();
  bindDragSafetyListeners();
}

function onPointerMove(ev){
  if (!dragState) return;
  if (ev.pointerId !== dragState.pointerId) return;

  ev.preventDefault();

  const copyNow = ev.altKey || ev.ctrlKey || ev.metaKey;
  if (copyNow !== dragState.copy){
    dragState.copy = copyNow;
    showDragBadge(true, copyNow ? 'Copiar' : 'Mover');
    if (dragState.ghostEl){
      dragState.ghostEl.textContent = `${dragState.copy ? 'COPIAR' : 'MOVER'} · ${blockDisplayText(dragState.block)}`;
    }
  }

  const dx = ev.clientX - dragState.downX;
  const dy = ev.clientY - dragState.downY;
  const dist = Math.hypot(dx, dy);

  if (!dragState.started && dist >= DRAG_THRESHOLD_PX){
    dragState.started = true;
    dragState.didDrag = true;
    dragState.phase = 'dragging';
    createGhost(ev, dragState);
  }

  if (!dragState.started) return;

  if (dragState.rafPending) {
    moveGhost(ev, dragState);
    return;
  }
  dragState.rafPending = true;

  const x = ev.clientX, y = ev.clientY;
  moveGhost(ev, dragState);

  requestAnimationFrame(()=>{
    dragState.rafPending = false;
    onDragHoverXY(x, y);
  });
}

function onPointerUp(ev){
  if (!dragState) return;
  if (ev.pointerId !== dragState.pointerId) return;

  ev.preventDefault();

  const wasDrag = dragState.didDrag;
  const block = dragState.block;

  unbindDragSafetyListeners();

  try{
    dragState.sourceEl?.releasePointerCapture?.(dragState.pointerId);
  }catch(_){}

  if (!wasDrag){
    modalAPI?.openModal?.(
      { mode:'edit', id:block.id, hoja:currentHoja, salonIndex:block.salonIndex, startMin:block.startMin },
      block
    );
    cleanupDragUI();
    dragState = null;
    return;
  }

  finalizeDrag(ev).finally(()=>{
    cleanupDragUI();
    dragState = null;
  });
}

function onPointerCancel(ev){
  if (!dragState) return;
  if (ev.pointerId && dragState.pointerId && ev.pointerId !== dragState.pointerId) return;
  cancelDrag();
}

function onWindowBlur(){
  if (dragState) cancelDrag();
}

function onVisibilityChange(){
  if (document.hidden && dragState) cancelDrag();
}

function onDragKey(ev){
  if (!dragState) return;
  if (ev.key === 'Escape'){
    ev.preventDefault();
    cancelDrag();
  }
}

function cancelDrag(){
  unbindDragSafetyListeners();
  cleanupDragUI();
  dragState = null;
}

function cleanupDragUI(){
  cleanupGhost();
  clearDropTargets(true);
  showDragBadge(false);
}

function createGhost(ev, st){
  const ghost = document.createElement('div');
  ghost.style.position = 'fixed';
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  ghost.style.zIndex = '9999';
  ghost.style.pointerEvents = 'none';
  ghost.style.padding = '10px 12px';
  ghost.style.borderRadius = '14px';
  ghost.style.boxShadow = '0 10px 26px rgba(0,0,0,.18)';
  ghost.style.background = 'rgba(255,255,255,.92)';
  ghost.style.border = '1px solid rgba(0,0,0,.10)';
  ghost.style.fontWeight = '1000';
  ghost.style.maxWidth = '320px';
  ghost.textContent = `${st.copy ? 'COPIAR' : 'MOVER'} · ${blockDisplayText(st.block)}`;
  document.body.appendChild(ghost);
  st.ghostEl = ghost;
  moveGhost(ev, st);
}

function moveGhost(ev, st){
  if (!st?.ghostEl) return;
  st.ghostEl.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
}

function cleanupGhost(){
  if (dragState?.ghostEl){
    dragState.ghostEl.remove();
    dragState.ghostEl = null;
  }
}

function getCellUnderXY(x, y){
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const td = el.closest?.('td');
  if (!td) return null;
  if (!td.dataset) return null;
  if (!('slot' in td.dataset) || !('salon' in td.dataset)) return null;
  return td;
}

function clearDropTargets(forceAll=false){
  if (!$tbody) return;

  if (forceAll){
    $tbody.querySelectorAll('.dropTarget,.dropInvalid').forEach(el=>{
      el.classList.remove('dropTarget','dropInvalid');
    });
    if (dragState) dragState.lastHoverTd = null;
    return;
  }

  const last = dragState?.lastHoverTd;
  if (last){
    last.classList.remove('dropTarget','dropInvalid');
  }
}

function onDragHoverXY(x, y){
  if (!dragState) return;

  const td = getCellUnderXY(x, y);

  if (td && dragState.lastHoverTd === td){
    // no-op
  } else {
    clearDropTargets(false);
  }

  if (!td){
    dragState.lastHoverTd = null;
    return;
  }

  td.classList.add('dropTarget');
  dragState.lastHoverTd = td;

  const targetSlot  = Number(td.dataset.slot);
  const targetSalon = Number(td.dataset.salon);
  const startMin = targetSlot;
  const endMin = startMin + dragState.dur;

  const invalid = !isWithinBounds(startMin, endMin)
    || hasOverlap({
      ignoreId: dragState.copy ? null : dragState.block.id,
      salonIndex: targetSalon,
      startMin,
      endMin
    });

  td.classList.toggle('dropInvalid', invalid);
}

async function finalizeDrag(ev){
  if (!dragState) return;

  const td = getCellUnderXY(ev.clientX, ev.clientY);
  if (!td) return;

  const targetSlot  = Number(td.dataset.slot);
  const targetSalon = Number(td.dataset.salon);

  const startMin = targetSlot;
  const endMin = startMin + dragState.dur;

  const invalid = !isWithinBounds(startMin, endMin)
    || hasOverlap({
      ignoreId: dragState.copy ? null : dragState.block.id,
      salonIndex: targetSalon,
      startMin,
      endMin
    });

  if (invalid) return;

  if (!dragState.copy && startMin === dragState.block.startMin && targetSalon === dragState.block.salonIndex){
    return;
  }

  const base = {
    hoja: currentHoja,
    salonIndex: targetSalon,
    startMin,
    endMin,
    text: dragState.block.text || '',
    note: dragState.block.note || '',
    grupo: dragState.block.grupo || '',
    docente: dragState.block.docente || '',
    modalidad: dragState.block.modalidad || '',
    updatedAt: serverTimestamp()
  };

  try{
    if (dragState.copy){
      base.createdAt = serverTimestamp();
      await addDoc(collection(db, 'blocks'), base);
    }else{
      await updateDoc(doc(db, 'blocks', dragState.block.id), base);
    }
  }catch(err){
    console.error(err);
    alert('No se pudo mover/copiar. Revisa conexión o permisos.');
  }
}

/* =============================================================================
   Delegation hooks for tbody
============================================================================= */
function bindGridDelegationOnce(){
  if (!$tbody || $tbody.__bound) return;
  $tbody.__bound = true;

  $tbody.addEventListener('click', (ev)=>{
    const btn = ev.target?.closest?.('button.pillEdit');
    if (!btn) return;
    if (!EDIT_MODE || READ_ONLY) return;

    const td = btn.closest('td');
    if (!td) return;

    const slotMin = Number(td.dataset.slot);
    const salonIndex = Number(td.dataset.salon);

    modalAPI?.openModal?.({ mode:'new', hoja:currentHoja, salonIndex, startMin:slotMin }, null);
  });

  $tbody.addEventListener('pointerdown', (ev)=>{
    if (!EDIT_MODE || READ_ONLY) return;

    const blockEl = ev.target?.closest?.('.block[data-block-id]');
    if (!blockEl) return;

    const id = blockEl.dataset.blockId;
    const b = blocksById.get(id);
    if (!b) return;

    armPointer(ev, b);
  }, { passive:false });
}

/* =============================================================================
   TABS
============================================================================= */
function activeTab(){
  return window.__ACTIVE_TAB__ || 'tabla';
}

function refreshAllViews(){
  renderGrid();

  const tab = activeTab();
  if (tab === 'vivo') renderVivo();
  if (tab === 'salas') renderSalas();
  if (tab === 'docentes') renderDocentes();
  if (tab === 'buscar') renderBuscar();
  if (tab === 'kpis') renderKPIs();
  renderDiagnostics();
}

window.addEventListener('tabchange', (e)=>{
  const tab = e?.detail?.tab || activeTab();
  if (!IS_ADMIN && isAdminTab(tab)){
    setActiveTabSafe('tabla');
    return;
  }
  if (tab === 'vivo') renderVivo();
  if (tab === 'salas') renderSalas();
  if (tab === 'docentes') renderDocentes();
  if (tab === 'buscar') renderBuscar();
  if (tab === 'kpis') renderKPIs();
});

/* =============================================================================
   En vivo
============================================================================= */
function slotTriplet(baseSlot){
  const prev = clamp(baseSlot - STEP_MIN, START_MIN, END_MIN-STEP_MIN);
  const now  = clamp(baseSlot,            START_MIN, END_MIN-STEP_MIN);
  const next = clamp(baseSlot + STEP_MIN, START_MIN, END_MIN-STEP_MIN);
  return { prev, now, next };
}

function findBlockAt(hoja, salonIndex, slotStart){
  const slotEnd = slotStart + STEP_MIN;
  return blocks.find(b =>
    b.hoja === hoja &&
    b.salonIndex === salonIndex &&
    Math.max(b.startMin, slotStart) < Math.min(b.endMin, slotEnd)
  ) || null;
}

function renderVivo(){
  if (!$vivoPrevWrap || !$vivoNowWrap || !$vivoNextWrap) return;

  const baseSlot = clamp(slotStartForMinutes(nowMinutes()) + vivoOffset*STEP_MIN, START_MIN, END_MIN-STEP_MIN);
  const { prev, now, next } = slotTriplet(baseSlot);

  if ($vivoSlotLabel) $vivoSlotLabel.textContent = formatRange(now, now+STEP_MIN);
  if ($vivoPrevTime)  $vivoPrevTime.textContent  = formatRange(prev, prev+STEP_MIN);
  if ($vivoNowTime)   $vivoNowTime.textContent   = formatRange(now, now+STEP_MIN);
  if ($vivoNextTime)  $vivoNextTime.textContent  = formatRange(next, next+STEP_MIN);

  const buildRooms = (slotStart) => {
    const frag = document.createDocumentFragment();
    for (let i=0;i<SALONES.length;i++){
      const b = findBlockAt(currentHoja, i, slotStart);
      const label = salonLabel(i).toUpperCase();
      const value = b ? blockDisplayText(b) : '—';
      const meta  = b ? blockMetaLine(b) : '';

      const div = document.createElement('div');
      div.className = 'vivoRoom';
      div.innerHTML = `
        <div class="label">${esc(label)}</div>
        <div class="value">${esc(value)}</div>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : `<div class="meta">&nbsp;</div>`}
      `;

      if (!READ_ONLY && EDIT_MODE && b){
        div.style.cursor = 'pointer';
        div.addEventListener('click', ()=>{
          modalAPI?.openModal?.(
            { mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin },
            b
          );
        }, { once:true });
      }

      frag.appendChild(div);
    }
    return frag;
  };

  $vivoPrevWrap.innerHTML = '';
  $vivoNowWrap.innerHTML = '';
  $vivoNextWrap.innerHTML = '';

  $vivoPrevWrap.appendChild(buildRooms(prev));
  $vivoNowWrap.appendChild(buildRooms(now));
  $vivoNextWrap.appendChild(buildRooms(next));
}

function startVivoAutoRefresh(){
  if (vivoTimer) clearInterval(vivoTimer);
  vivoTimer = setInterval(()=>{
    if (activeTab() === 'vivo') renderVivo();
  }, 30_000);
}

$btnVivoPrev?.addEventListener('click', ()=>{ vivoOffset -= 1; renderVivo(); });
$btnVivoNow?.addEventListener('click',  ()=>{ vivoOffset = 0;  renderVivo(); });
$btnVivoNext?.addEventListener('click', ()=>{ vivoOffset += 1; renderVivo(); });

/* =============================================================================
   Salones tab
============================================================================= */
function renderSalas(){
  if (!$salasWrap) return;
  ensureMiniCardStylesOnce();

  const bySalon = Array.from({length: SALONES.length}, ()=>[]);
  for (const b of blocks){
    if (b.hoja !== currentHoja) continue;
    const idx = Number(b.salonIndex);
    if (Number.isFinite(idx) && idx>=0 && idx<SALONES.length) bySalon[idx].push(b);
  }
  bySalon.forEach(arr => arr.sort((a,b)=>a.startMin-b.startMin));

  let html = '';
  for (let i=0;i<SALONES.length;i++){
    const list = bySalon[i];
    const subtitle = list.length ? `${list.length} bloque(s)` : `sin bloques`;
    const items = list.length ? list.map(b=>{
      const time = formatRange(b.startMin, b.endMin);
      const txt = blockDisplayText(b);
      const meta = blockMetaLine(b);
      return `
        <div class="listItem" data-id="${esc(b.id)}">
          <div class="listLeft">
            <div class="listMain">${esc(txt)}</div>
            ${meta ? `<div class="listMeta">${esc(meta)}</div>` : ``}
          </div>
          <div class="listRight">
            <div class="pillTime">${esc(time)}</div>
            ${(!READ_ONLY && EDIT_MODE) ? `<button class="btnMini" data-act="edit" data-id="${esc(b.id)}">Editar</button>` : ``}
          </div>
        </div>
      `;
    }).join('') : `<div style="color:var(--muted);font-weight:900;">—</div>`;

    html += makeMiniCard({
      title: salonLabel(i),
      subtitle,
      rightPill: '',
      contentHtml: items
    });
  }

  $salasWrap.innerHTML = html;

  if (!READ_ONLY && EDIT_MODE){
    $salasWrap.querySelectorAll('[data-act="edit"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.id;
        const b = blocksById.get(id);
        if (!b) return;
        modalAPI?.openModal?.({ mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin }, b);
      });
    });
  }
}

/* =============================================================================
   Docentes tab
============================================================================= */
function normalizeName(s){ return (s||'').trim(); }

function collectDocentes(){
  const set = new Set();
  for (const b of blocks){
    const d = normalizeName(b.docente) || normalizeName(parseDocenteFromText(b.text||''));
    if (d) set.add(d);
  }
  Object.keys(DOCENTES_PALETTE || {}).forEach(d=>set.add(d));
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'es'));
}

function renderDocentes(filterText = ''){
  if (!$docentesWrap) return;
  ensureMiniCardStylesOnce();

  const filtro = (filterText || $txtDocente?.value || '').trim().toLowerCase();

  const docentes = collectDocentes()
    .filter(d => !filtro || d.toLowerCase().includes(filtro));

  if (!docentes.length){
    $docentesWrap.innerHTML = `<div style="color:var(--muted);font-weight:900;">No hay docentes que coincidan.</div>`;
    return;
  }

  let html = '';
  for (const d of docentes){
    const list = blocks
      .filter(b => {
        const name = normalizeName(b.docente) || normalizeName(parseDocenteFromText(b.text||''));
        return name === d;
      })
      .sort((a,b)=> (a.hoja===b.hoja ? a.startMin-b.startMin : (a.hoja||'').localeCompare(b.hoja||'','es')));

    const items = list.length ? list.map(b=>{
      const time = `${b.hoja} · ${formatRange(b.startMin,b.endMin)}`;
      const room = salonLabel(b.salonIndex);
      const txt = blockDisplayText(b);
      const meta = b.modalidad ? b.modalidad : '';
      return `
        <div class="listItem" data-id="${esc(b.id)}">
          <div class="listLeft">
            <div class="listMain">${esc(txt)}</div>
            <div class="listMeta">${esc(time)} · ${esc(room)}${meta ? ` · ${esc(meta)}` : ``}</div>
          </div>
          <div class="listRight">
            <div class="pillRoom">${esc(room)}</div>
            ${(!READ_ONLY && EDIT_MODE) ? `<button class="btnMini" data-act="edit" data-id="${esc(b.id)}">Editar</button>` : ``}
          </div>
        </div>
      `;
    }).join('') : `<div style="color:var(--muted);font-weight:900;">Sin bloques para este docente.</div>`;

    const pill = DOCENTES_PALETTE[d] ? '🎨' : '';
    html += makeMiniCard({
      title: d,
      subtitle: `${list.length} bloque(s)`,
      rightPill: pill,
      contentHtml: items
    });
  }

  $docentesWrap.innerHTML = html;

  if (!READ_ONLY && EDIT_MODE){
    $docentesWrap.querySelectorAll('[data-act="edit"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.id;
        const b = blocksById.get(id);
        if (!b) return;
        modalAPI?.openModal?.({ mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin }, b);
      });
    });
  }
}

$btnBuscarDocente?.addEventListener('click', ()=> renderDocentes($txtDocente?.value || ''));
$btnDocentesTodos?.addEventListener('click', ()=>{
  if ($txtDocente) $txtDocente.value = '';
  renderDocentes('');
});

/* =============================================================================
   Buscar tab
============================================================================= */
function renderBuscar(){
  if (!$buscarWrap) return;
  ensureMiniCardStylesOnce();

  const q = ($txtQuery?.value || '').trim().toLowerCase();

  if (!q){
    $buscarWrap.innerHTML = `<div style="color:var(--muted);font-weight:900;">Escribe algo para buscar (grupo, docente, modalidad, nota).</div>`;
    return;
  }

  const hits = blocks.filter(b=>{
    const hay = [
      b.text, b.grupo, b.docente, b.modalidad, b.note, b.hoja,
      salonLabel(b.salonIndex)
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=> (a.hoja===b.hoja ? a.startMin-b.startMin : (a.hoja||'').localeCompare(b.hoja||'','es')));

  if (!hits.length){
    $buscarWrap.innerHTML = `<div style="color:var(--muted);font-weight:900;">No hay resultados.</div>`;
    return;
  }

  const items = hits.map(b=>{
    const time = `${b.hoja} · ${formatRange(b.startMin,b.endMin)}`;
    const room = salonLabel(b.salonIndex);
    const txt = blockDisplayText(b);
    const meta = blockMetaLine(b);
    return `
      <div class="listItem" data-id="${esc(b.id)}">
        <div class="listLeft">
          <div class="listMain">${esc(txt)}</div>
          <div class="listMeta">${esc(time)} · ${esc(room)}${meta ? ` · ${esc(meta)}` : ``}</div>
        </div>
        <div class="listRight">
          <div class="pillRoom">${esc(room)}</div>
          ${(!READ_ONLY && EDIT_MODE) ? `<button class="btnMini" data-act="edit" data-id="${esc(b.id)}">Editar</button>` : ``}
        </div>
      </div>
    `;
  }).join('');

  $buscarWrap.innerHTML = makeMiniCard({
    title: `Resultados: ${hits.length}`,
    subtitle: `Buscando: “${q}”`,
    rightPill: '',
    contentHtml: items
  });

  if (!READ_ONLY && EDIT_MODE){
    $buscarWrap.querySelectorAll('[data-act="edit"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.id;
        const b = blocksById.get(id);
        if (!b) return;
        modalAPI?.openModal?.({ mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin }, b);
      });
    });
  }
}

$btnBuscar?.addEventListener('click', renderBuscar);
$btnBuscarClear?.addEventListener('click', ()=>{
  if ($txtQuery) $txtQuery.value = '';
  renderBuscar();
});
$txtQuery?.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') renderBuscar();
});

$btnLoginGoogle?.addEventListener('click', async () => {
  try{
    setLoad(false, 'Ingresando...', 'Abriendo Google para acceso admin');
    await loginWithGoogle();
  }catch(err){
    console.warn(err);
    setLoad(true, 'Listo', err?.message || 'No se pudo iniciar sesion');
  }
});

$btnLogout?.addEventListener('click', async () => {
  try{
    await logout();
  }catch(err){
    console.warn(err);
    setLoad(true, 'Listo', err?.message || 'No se pudo cerrar sesion');
  }
});

/* =============================================================================
   KPIs tab
============================================================================= */
function renderKPIs(){
  if (!$kpisWrap) return;
  ensureMiniCardStylesOnce();

  const totalSlots = SLOTS.length * SALONES.length;
  const dayBlocks = blocks.filter(b => (b.hoja || currentHoja) === currentHoja);

  if (!dayBlocks.length){
    $kpisWrap.innerHTML = `
      <div class="kpiEmpty">
        <div class="kpiEmptyTitle">No hay bloques para ${esc(currentHoja)}</div>
        <div class="kpiEmptyText">Cuando se creen clases para este dia, las estadisticas apareceran automaticamente aqui.</div>
      </div>
    `;
    return;
  }

  const usedBySalon = Array.from({length:SALONES.length}, ()=>0);
  const blocksBySalon = Array.from({length:SALONES.length}, ()=>0);
  const docStats = new Map();
  const modalityStats = new Map();
  const slotDistribution = new Map();
  const incomplete = [];
  let usedSlots = 0;

  const addStats = (map, key, slots) => {
    const cleanKey = (key || 'Sin dato').trim() || 'Sin dato';
    const prev = map.get(cleanKey) || { blocks:0, slots:0 };
    prev.blocks += 1;
    prev.slots += slots;
    map.set(cleanKey, prev);
  };

  for (const b of dayBlocks){
    const span = Math.max(1, Math.round((Number(b.endMin) - Number(b.startMin))/STEP_MIN));
    const s = Number(b.salonIndex);
    const docente = normalizeName(b.docente) || normalizeName(parseDocenteFromText(b.text || ''));
    const modalidad = normalizeName(b.modalidad);
    const grupo = normalizeName(b.grupo);

    if (Number.isFinite(s) && s>=0 && s<SALONES.length){
      usedBySalon[s] += span;
      blocksBySalon[s] += 1;
      usedSlots += span;
    }

    if (docente) addStats(docStats, docente, span);
    addStats(modalityStats, modalidad || 'Sin modalidad', span);
    addStats(slotDistribution, formatRange(b.startMin, b.endMin), span);

    const missing = [];
    if (!docente) missing.push('docente');
    if (!grupo && !normalizeName(blockDisplayText(b))) missing.push('grupo');
    if (!modalidad) missing.push('modalidad');
    if (!Number.isFinite(s) || s<0 || s>=SALONES.length) missing.push('salon');
    if (!isWithinBounds(Number(b.startMin), Number(b.endMin))) missing.push('hora');
    if (missing.length) incomplete.push({ block:b, missing });
  }

  const occ = totalSlots ? (usedSlots/totalSlots) : 0;
  const totalHours = (usedSlots * STEP_MIN)/60;
  const emptyRooms = SALONES.map((_,i)=>i).filter(i => blocksBySalon[i] === 0);
  const topSalonIdx = usedBySalon.reduce((best, slots, idx) => slots > usedBySalon[best] ? idx : best, 0);

  const sortStats = (map) => Array.from(map.entries())
    .map(([name, data]) => ({ name, ...data, hours:(data.slots * STEP_MIN)/60 }))
    .sort((a,b)=> b.slots - a.slots || a.name.localeCompare(b.name,'es'));

  const salonRanking = SALONES.map((_,i)=>({
    index:i,
    name: salonLabel(i),
    blocks: blocksBySalon[i],
    slots: usedBySalon[i],
    hours: (usedBySalon[i] * STEP_MIN)/60,
    pct: SLOTS.length ? usedBySalon[i]/SLOTS.length : 0
  })).sort((a,b)=> b.slots - a.slots || a.index - b.index);

  const docRanking = sortStats(docStats);
  const modalityRanking = sortStats(modalityStats);
  const slotRanking = sortStats(slotDistribution).slice(0, 8);
  const hoursLabel = (n) => `${Number(n).toFixed(Number.isInteger(n) ? 0 : 1)} h`;
  const bar = (pct) => `<div class="kpiBar" aria-hidden="true"><span style="width:${clamp(Math.round(pct*100),0,100)}%"></span></div>`;

  $kpisWrap.innerHTML = `
    <div class="kpiToolbar">
      <div>
        <div class="kpiPageTitle">Indicadores de ${esc(currentHoja)}</div>
        <div class="kpiPageSub">${esc(FIREBASE_RUNTIME.useEmulators ? 'Firestore emulador' : 'Firestore real')} - ${LAST_SNAPSHOT_FROM_CACHE ? 'cache' : 'server'}</div>
      </div>
      <button id="btnKpisRefreshInline" class="btnTop" type="button">Actualizar</button>
    </div>

    <div class="kpiGrid">
      <div class="kpiBox kpiBoxHero">
        <div class="kpiLabel">Ocupacion total</div>
        <div class="kpiValue">${Math.round(occ*100)}%</div>
        <div class="kpiHint">${usedSlots} / ${totalSlots} slots del dia</div>
      </div>
      <div class="kpiBox">
        <div class="kpiLabel">Horas programadas</div>
        <div class="kpiValue">${hoursLabel(totalHours)}</div>
        <div class="kpiHint">${STEP_MIN} min por slot</div>
      </div>
      <div class="kpiBox">
        <div class="kpiLabel">Bloques</div>
        <div class="kpiValue">${dayBlocks.length}</div>
        <div class="kpiHint">Registros cargados del dia</div>
      </div>
      <div class="kpiBox">
        <div class="kpiLabel">Docentes reales</div>
        <div class="kpiValue">${docStats.size}</div>
        <div class="kpiHint">Solo bloques del dia, sin palette</div>
      </div>
    </div>

    <div class="kpiPanels">
      ${makeMiniCard({
        title: "Ocupacion por salon",
        subtitle: `Mas ocupado: ${usedBySalon[topSalonIdx] ? salonLabel(topSalonIdx) : 'sin ocupacion'}`,
        rightPill: `${emptyRooms.length} vacio(s)`,
        contentHtml: salonRanking.map(item => `
          <div class="kpiRankItem">
            <div class="kpiRankTop">
              <div>
                <div class="listMain">${esc(item.name)}</div>
                <div class="listMeta">${item.blocks} bloque(s) - ${hoursLabel(item.hours)}</div>
              </div>
              <div class="pillTime">${Math.round(item.pct*100)}%</div>
            </div>
            ${bar(item.pct)}
          </div>
        `).join('')
      })}

      ${makeMiniCard({
        title: "Docentes con mas horas",
        subtitle: "Horas y bloques reales del dia",
        rightPill: `${docRanking.length} docente(s)`,
        contentHtml: docRanking.length ? docRanking.slice(0, 10).map(item => `
          <div class="listItem">
            <div class="listLeft">
              <div class="listMain">${esc(item.name)}</div>
              <div class="listMeta">${item.blocks} bloque(s)</div>
            </div>
            <div class="listRight"><div class="pillTime">${hoursLabel(item.hours)}</div></div>
          </div>
        `).join('') : `<div class="kpiSoftAlert">No hay docentes identificados en los bloques.</div>`
      })}

      ${makeMiniCard({
        title: "Modalidades usadas",
        subtitle: "Sede, Virtual u otras",
        rightPill: `${modalityRanking.length} tipo(s)`,
        contentHtml: modalityRanking.map(item => `
          <div class="listItem">
            <div class="listLeft">
              <div class="listMain">${esc(item.name)}</div>
              <div class="listMeta">${item.blocks} bloque(s)</div>
            </div>
            <div class="listRight"><div class="pillTime">${hoursLabel(item.hours)}</div></div>
          </div>
        `).join('')
      })}

      ${makeMiniCard({
        title: "Franjas horarias",
        subtitle: "Distribucion por bloques",
        rightPill: `${slotDistribution.size} franja(s)`,
        contentHtml: slotRanking.map(item => `
          <div class="listItem">
            <div class="listLeft">
              <div class="listMain">${esc(item.name)}</div>
              <div class="listMeta">${item.blocks} bloque(s)</div>
            </div>
            <div class="listRight"><div class="pillTime">${hoursLabel(item.hours)}</div></div>
          </div>
        `).join('')
      })}
    </div>

    ${makeMiniCard({
      title: "Calidad de datos",
      subtitle: "Bloques incompletos o con datos faltantes",
      rightPill: `${incomplete.length} alerta(s)`,
      contentHtml: incomplete.length ? incomplete.slice(0, 12).map(item => `
        <div class="kpiAlertItem">
          <div>
            <div class="listMain">${esc(blockDisplayText(item.block))}</div>
            <div class="listMeta">${esc(formatRange(item.block.startMin, item.block.endMin))} - ${esc(salonLabel(item.block.salonIndex))}</div>
          </div>
          <div class="kpiMissing">${esc(item.missing.join(', '))}</div>
        </div>
      `).join('') : `<div class="kpiOk">Todos los bloques del dia tienen docente, grupo/modalidad basica y horario valido.</div>`
    })}
  `;

  qs('#btnKpisRefreshInline')?.addEventListener('click', renderKPIs);
}
$btnKpisRefresh?.addEventListener('click', renderKPIs);

/* =============================================================================
   Firestore
============================================================================= */
function sanitizeBlock(raw){
  const startMin = Number(raw.startMin);
  const endMin = Number(raw.endMin);
  const salonIndex = Number(raw.salonIndex);

  return {
    ...raw,
    startMin: Number.isFinite(startMin) ? startMin : START_MIN,
    endMin: Number.isFinite(endMin) ? endMin : (START_MIN + STEP_MIN),
    salonIndex: Number.isFinite(salonIndex) ? salonIndex : 0,
    hoja: (raw.hoja || currentHoja || 'Lunes'),
    text: raw.text || '',
    note: raw.note || '',
    grupo: raw.grupo || '',
    docente: raw.docente || '',
    modalidad: raw.modalidad || ''
  };
}

function humanFirestoreError(err){
  const code = err?.code || '';
  if (code === 'permission-denied'){
    return 'Permiso denegado (permission-denied). Tus rules están bloqueando lectura/edición.';
  }
  if (code === 'unauthenticated'){
    return 'No autenticado (unauthenticated). Auth anónimo no quedó listo.';
  }
  return err?.message || 'Error leyendo Firestore';
}

function listenHoja(hoja){
  if (unsub) { try{ unsub(); }catch(e){} unsub = null; }

  setLoad(false, 'Cargando…', 'Leyendo bloques…');

  const col = collection(db, 'blocks');
  const qy = query(
    col,
    where('hoja', '==', hoja),
    orderBy('salonIndex', 'asc'),
    orderBy('startMin', 'asc')
  );

  unsub = onSnapshot(qy, (snap) => {
    const fromCache = snap.metadata?.fromCache;
    LAST_SNAPSHOT_FROM_CACHE = !!fromCache;

    if (READ_ONLY){
      setNet(true, fromCache ? 'solo lectura (cache)' : 'solo lectura (server)');
    }else{
      setNet(true, fromCache ? 'conectado (cache)' : 'conectado (server)');
    }

    blocks = snap.docs.map(d => sanitizeBlock({ id:d.id, ...d.data() }));
    LAST_BLOCKS_COUNT = blocks.length;
    reindexBlocks();

    setLoad(true, 'Listo', fromCache ? 'Mostrando datos cacheados' : 'Sincronizado');
    refreshAllViews();
  }, (err) => {
    console.error(err);
    LAST_ERR = err;
    setNet(false, 'error');
    setLoad(false, 'Error', humanFirestoreError(err));
    renderDiagnostics();
  });
}

/* =============================================================================
   Actions
============================================================================= */
$toggleEdit?.addEventListener('change', () => {
  if ($toggleEdit.checked && READ_ONLY){
    $toggleEdit.checked = false;
    EDIT_MODE = false;
    showEditBadge(false);
    showDragBadge(false);
    cancelDrag();
    setLoad(true, 'Listo', 'Edición disponible solo para admins de Musicala.');
    refreshAllViews();
    return;
  }

  EDIT_MODE = $toggleEdit.checked;
  showEditBadge(EDIT_MODE);
  showDragBadge(false);
  cancelDrag();
  refreshAllViews();
});

$selHoja?.addEventListener('change', () => {
  currentHoja = $selHoja.value;

  safeSetLS(LS_KEYS.lastHoja, currentHoja);
  safeSetLS(LS_KEYS.lastDate, todayISO());

  vivoOffset = 0;
  cancelDrag();
  listenHoja(currentHoja);
});

$btnFull?.addEventListener('click', async () => {
  try{
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }catch(e){}
});

/* =============================================================================
   ModalPro: wiring (app.js guarda/borrar, modalPro maneja UI)
============================================================================= */
function initModalPro(){
  modalAPI = setupModalPro({
    // modal shell
    $modalBack,
    $btnCloseModal,
    $btnCancel,
    $btnSave,
    $btnDelete,
    $modalTitle,

    // fields
    $mHoja,
    $mSalon,
    $mStart,
    $mEnd,
    $mText,
    $mNote,
    $mGrupo,
    $mDocente,
    $mModalidad,

    // config
    STEP_MIN,
    END_MIN,

    // state getters
    getREAD_ONLY: () => READ_ONLY,
    getCurrentHoja: () => currentHoja,

    // helpers
    salonLabel,
    toHHMM,
    buildTextFromFields,
    esc,

    // lists state + persistence
    getDOCENTES_PALETTE: () => DOCENTES_PALETTE,
    setDOCENTES_PALETTE: (obj) => { DOCENTES_PALETTE = obj || {}; },
    saveDocentesPalette: (obj) => saveDocentesPalette(obj),

    getMODALIDADES: () => MODALIDADES,
    setMODALIDADES: (arr) => { MODALIDADES = Array.isArray(arr) ? arr : []; },
    saveModalidades: (arr) => saveModalidades(arr),

    // Firestore callbacks
    onSave: async ({ ctx, payload }) => {
      if (!ctx) return;
      if (READ_ONLY) return;

      const endMin = Number(payload.endMin);
      const salonIndex = Number(payload.salonIndex);
      const startMin = Number(payload.startMin);

      if (!payload.text){
        alert('Ponle algo al bloque (Grupo/Docente o Texto final).');
        return;
      }
      if (!isWithinBounds(startMin, endMin)){
        alert('Hora fin inválida o fuera de rango.');
        return;
      }

      const overlaps = hasOverlap({
        ignoreId: ctx.mode === 'edit' ? ctx.id : null,
        salonIndex,
        startMin,
        endMin
      });
      if (overlaps){
        alert('Ese bloque se cruza con otro en el mismo salón.');
        return;
      }

      const finalPayload = {
        hoja: payload.hoja || ctx.hoja || currentHoja,
        salonIndex,
        startMin,
        endMin,
        text: payload.text,
        note: payload.note || '',
        grupo: payload.grupo || '',
        docente: payload.docente || '',
        modalidad: payload.modalidad || '',
        updatedAt: serverTimestamp()
      };

      try{
        if (ctx.mode === 'new'){
          finalPayload.createdAt = serverTimestamp();
          await addDoc(collection(db, 'blocks'), finalPayload);
        }else{
          await updateDoc(doc(db, 'blocks', ctx.id), finalPayload);
        }
        modalAPI?.closeModal?.();
      }catch(err){
        console.error(err);
        alert('No se pudo guardar. Revisa conexión/permisos.');
      }
    },

    onDelete: async ({ ctx }) => {
      if (!ctx || ctx.mode !== 'edit') return;
      if (READ_ONLY) return;

      try{
        await deleteDoc(doc(db, 'blocks', ctx.id));
        modalAPI?.closeModal?.();
      }catch(err){
        console.error(err);
        alert('No se pudo borrar. Revisa conexión/permisos.');
      }
    }
  });
}

/* =============================================================================
   Clock
============================================================================= */
function tick(){
  const d = new Date();
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  if ($clock) $clock.textContent = `${hh}:${mm}:${ss}`;
  if (activeTab() === 'vivo') renderVivo();
}
setInterval(tick, 1000);
tick();

/* =============================================================================
   Init (GitHub-safe)
============================================================================= */
buildHeader();
ensureMobileSalonHeader();
ensureMiniCardStylesOnce();
ensureStickyRoomsCSS();
bindGridDelegationOnce();
initModalPro();

setNet(false, 'conectando');
setLoad(false, 'Cargando…', 'Inicializando…');
showEditBadge(false);

(async function init(){
  // Auto día real
  currentHoja = pickInitialHoja();
  if ($selHoja) $selHoja.value = currentHoja;

  // 1) Escuchar Firestore igual (para que render no dependa de auth)
  listenHoja(currentHoja);
  startVivoAutoRefresh();

  onUserChanged((user) => {
    CURRENT_USER = user;
    AUTH_OK = !!user;
    IS_ADMIN = isAdminEmail(user?.email);
    READ_ONLY = !IS_ADMIN;
    LAST_ERR = null;

    if (IS_ADMIN){
      setLoad(true, 'Listo', 'Sesión admin lista (edición disponible)');
    }else if (user){
      setLoad(true, 'Listo', 'Sesión iniciada sin permisos de edición');
    }else{
      setLoad(true, 'Listo', 'Vista pública de consulta');
    }

    applyAccessUI();
  });

  applyAccessUI();
  refreshAllViews();
})();

