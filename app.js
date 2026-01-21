import { ensureAnon } from "./auth.js";
import { db } from "./firebase.js";
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =============================================================================
  Horario Musicala · app.js (Firebase) — vPRO MAX++ (GitHub-safe Auth + Robust Drag)
  -----------------------------------------------------------------------------
  ✅ Tabla 30 min x 10 salones (rowSpan por duración)
  ✅ Modo edición (badge fijo + UI)
  ✅ Modal PRO (Grupo / Docente / Modalidad / Nota + texto final)
  ✅ Auto-text (respeta si editas a mano)
  ✅ Color por docente (paleta)
  ✅ Drag & drop: mover / copiar (Alt/Ctrl/Meta) con validación de solapes
  ✅ Drag desde TODO el bloque + NO abre modal si arrastras
  ✅ Tabs funcionales: En Vivo, Salones, Docentes, Buscar, KPIs
  ✅ Estado red: cache vs server (snapshot.metadata)
  ✅ PERFORMANCE: delegation (un solo listener) + render eficiente
  ✅ FIX: hover dropTarget sin parpadeo (track last cell)
  ✅ FIX: badge “Mover/Copiar” NO se queda pegado (pointercancel/blur/visibilitychange)
  ✅ GitHub Pages FIX: la tabla NO depende de que Auth anónimo funcione (fallback read-only)
============================================================================= */

/* ===== Config (window.APP_CONFIG) ===== */
const CFG = (() => {
  const c = window.APP_CONFIG || {};
  return {
    days: c.days || ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"],
    slotMinutes: c.slotMinutes ?? 30,
    startMin: c.startMin ?? (9*60 + 30),
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
    docentesPalette: c.docentesPalette || {}
  };
})();

const SALONES   = CFG.rooms;
const START_MIN = CFG.startMin;
const END_MIN   = CFG.endMin;
const STEP_MIN  = CFG.slotMinutes;

/* ===== Time helpers ===== */
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

/* ===== DOM ===== */
const qs = (s,root=document)=>root.querySelector(s);
const qsa = (s,root=document)=>Array.from(root.querySelectorAll(s));

const $selHoja = qs('#selHoja');
const $toggleEdit = qs('#toggleEdit');
const $btnFull = qs('#btnFull');

const $dot = qs('#dot');
const $netText = qs('#netText');
const $clock = qs('#clock');

const $miniDot = qs('#miniDot');
const $loadText = qs('#loadText');
const $statusMsg = qs('#statusMsg');

const $thead = qs('#thead');
const $tbody = qs('#tbody');

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
const $mDocente = qs('#mDocente');
const $mModalidad = qs('#mModalidad');

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

// Badges del index (opcionales)
const $editBadge = qs('#editBadge');
const $dragBadge = qs('#dragBadge');
const $dragBadgeText = qs('#dragBadgeText');

/* ===== State ===== */
let EDIT_MODE = false;
let currentHoja = $selHoja?.value || 'Lunes';

let blocks = [];
let blocksById = new Map();
let unsub = null;

let modalCtx = null;
let modalManualText = false;

// En vivo
let vivoOffset = 0;
let vivoTimer = null;

// Auth/runtime
let AUTH_OK = false;      // true cuando hay sesión anónima garantizada
let READ_ONLY = false;    // si no hay auth, bloquea edición
let LAST_ERR = null;

// Pointer Drag state
let dragState = null;
const DRAG_THRESHOLD_PX = 7;

/* ===== UI helpers ===== */
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

/* ===== Text build (PRO) ===== */
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
  const keys = Object.keys(CFG.docentesPalette || {});
  const hit = keys.find(k => t.toLowerCase().includes(k.toLowerCase()));
  return hit || '';
}

function colorForDocente(docente, text){
  const d = (docente || '').trim();
  if (d && CFG.docentesPalette[d]) return CFG.docentesPalette[d];
  const fromText = parseDocenteFromText(text);
  if (fromText && CFG.docentesPalette[fromText]) return CFG.docentesPalette[fromText];
  return '';
}

/* ===== Modal ===== */
function openModal(ctx, existing=null){
  if (READ_ONLY){
    alert('Estás en modo solo lectura (sin sesión). Para editar necesitas Auth anónimo habilitado.');
    return;
  }

  modalCtx = ctx;
  modalManualText = false;

  const salonName = salonLabel(ctx.salonIndex);
  if ($mHoja)  $mHoja.value = ctx.hoja;
  if ($mSalon) $mSalon.value = salonName;
  if ($mStart) $mStart.value = toHHMM(ctx.startMin);

  if ($mEnd){
    $mEnd.innerHTML = '';
    for (let m = ctx.startMin + STEP_MIN; m <= END_MIN; m += STEP_MIN){
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = toHHMM(m);
      $mEnd.appendChild(opt);
    }
  }

  if (existing){
    if ($modalTitle) $modalTitle.textContent = 'Editar bloque';
    if ($mText) $mText.value = existing.text || '';
    if ($mNote) $mNote.value = existing.note || '';
    if ($mGrupo) $mGrupo.value = existing.grupo || '';
    if ($mDocente) $mDocente.value = existing.docente || '';
    if ($mModalidad) $mModalidad.value = existing.modalidad || '';
    if ($mEnd) $mEnd.value = String(existing.endMin);
    if ($btnDelete) $btnDelete.hidden = false;
  }else{
    if ($modalTitle) $modalTitle.textContent = 'Crear bloque';
    if ($mNote) $mNote.value = '';
    if ($mGrupo) $mGrupo.value = '';
    if ($mDocente) $mDocente.value = '';
    if ($mModalidad) $mModalidad.value = '';
    if ($mText) $mText.value = '';
    if ($mEnd) $mEnd.value = String(ctx.startMin + STEP_MIN);
    if ($btnDelete) $btnDelete.hidden = true;
  }

  syncModalTextFromProFields();

  if ($modalBack) $modalBack.hidden = false;
  setTimeout(()=>{
    if ($mGrupo) $mGrupo.focus();
    else $mText?.focus();
  }, 0);
}

function closeModal(){
  if ($modalBack) $modalBack.hidden = true;
  modalCtx = null;
  modalManualText = false;
}

function getModalProPayload(){
  const grupo = ($mGrupo?.value || '').trim();
  const docente = ($mDocente?.value || '').trim();
  const modalidad = ($mModalidad?.value || '').trim();
  const note = ($mNote?.value || '').trim();
  const text = ($mText?.value || '').trim();
  return { grupo, docente, modalidad, note, text };
}

function syncModalTextFromProFields(){
  if (!$mGrupo || !$mDocente || !$mModalidad || !$mText || !$mNote) return;
  if (modalManualText) return;

  const grupo = ($mGrupo.value || '').trim();
  const docente = ($mDocente.value || '').trim();
  const modalidad = ($mModalidad.value || '').trim();
  const note = ($mNote.value || '').trim();

  $mText.value = buildTextFromFields({ grupo, docente, modalidad, note });
}

if ($mText){
  $mText.addEventListener('input', () => { modalManualText = true; });
}
[$mGrupo, $mDocente, $mModalidad, $mNote].filter(Boolean).forEach(el=>{
  el.addEventListener('input', ()=> syncModalTextFromProFields());
});

/* ===== Table build ===== */
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

/* ===== Validations ===== */
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

/* ===== Rendering helpers (lists/cards) ===== */
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

/* ===== Grid render ===== */
function renderGrid(){
  if (!$tbody) return;
  ensureMiniCardStylesOnce();

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
   POINTER: click vs drag (delegation) + hover limpio
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
    openModal(
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
    // misma celda, no limpies para no parpadear
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

/* ===== Delegation hooks for tbody ===== */
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

    openModal({ mode:'new', hoja:currentHoja, salonIndex, startMin:slotMin }, null);
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
}

window.addEventListener('tabchange', (e)=>{
  const tab = e?.detail?.tab || activeTab();
  if (tab === 'vivo') renderVivo();
  if (tab === 'salas') renderSalas();
  if (tab === 'docentes') renderDocentes();
  if (tab === 'buscar') renderBuscar();
  if (tab === 'kpis') renderKPIs();
});

/* ===== En vivo ===== */
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
          openModal(
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

/* ===== Salones ===== */
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
        openModal({ mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin }, b);
      });
    });
  }
}

/* ===== Docentes ===== */
function normalizeName(s){ return (s||'').trim(); }

function collectDocentes(){
  const set = new Set();
  for (const b of blocks){
    const d = normalizeName(b.docente) || normalizeName(parseDocenteFromText(b.text||''));
    if (d) set.add(d);
  }
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

    const items = list.map(b=>{
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
    }).join('');

    const pill = CFG.docentesPalette[d] ? '🎨' : '';
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
        openModal({ mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin }, b);
      });
    });
  }
}

$btnBuscarDocente?.addEventListener('click', ()=> renderDocentes($txtDocente?.value || ''));
$btnDocentesTodos?.addEventListener('click', ()=>{
  if ($txtDocente) $txtDocente.value = '';
  renderDocentes('');
});

/* ===== Buscar ===== */
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
        openModal({ mode:'edit', id:b.id, hoja:currentHoja, salonIndex:b.salonIndex, startMin:b.startMin }, b);
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

/* ===== KPIs ===== */
function renderKPIs(){
  if (!$kpisWrap) return;
  ensureMiniCardStylesOnce();

  const totalSlots = SLOTS.length * SALONES.length;
  let usedSlots = 0;
  const blocksCount = blocks.length;

  const usedBySalon = Array.from({length:SALONES.length}, ()=>0);
  const blocksBySalon = Array.from({length:SALONES.length}, ()=>0);

  for (const b of blocks){
    const span = Math.max(1, Math.round((b.endMin - b.startMin)/STEP_MIN));
    const s = Number(b.salonIndex);
    if (Number.isFinite(s) && s>=0 && s<SALONES.length){
      usedBySalon[s] += span;
      blocksBySalon[s] += 1;
      usedSlots += span;
    }
  }

  const occ = totalSlots ? (usedSlots/totalSlots) : 0;
  const totalHours = (usedSlots * STEP_MIN)/60;

  let topSalonIdx = 0;
  let topSalonOcc = 0;
  for (let i=0;i<SALONES.length;i++){
    const occSalon = usedBySalon[i] / SLOTS.length;
    if (occSalon > topSalonOcc){
      topSalonOcc = occSalon;
      topSalonIdx = i;
    }
  }

  const docCount = collectDocentes().length;

  const kpiHTML = `
    <div class="kpiGrid">
      <div class="kpiBox">
        <div class="kpiLabel">Ocupación total</div>
        <div class="kpiValue">${Math.round(occ*100)}%</div>
        <div class="kpiHint">${usedSlots} / ${totalSlots} slots</div>
      </div>
      <div class="kpiBox">
        <div class="kpiLabel">Horas programadas</div>
        <div class="kpiValue">${totalHours.toFixed(1)}</div>
        <div class="kpiHint">(${STEP_MIN} min por slot)</div>
      </div>
      <div class="kpiBox">
        <div class="kpiLabel">Bloques</div>
        <div class="kpiValue">${blocksCount}</div>
        <div class="kpiHint">En el día: ${esc(currentHoja)}</div>
      </div>
      <div class="kpiBox">
        <div class="kpiLabel">Docentes</div>
        <div class="kpiValue">${docCount}</div>
        <div class="kpiHint">Detectados en datos</div>
      </div>
    </div>

    <div style="margin-top:14px;"></div>

    ${makeMiniCard({
      title: "Detalle por salón",
      subtitle: "Ocupación y bloques",
      rightPill: `Top: ${salonLabel(topSalonIdx)}`,
      contentHtml: SALONES.map((_,i)=>{
        const o = usedBySalon[i]/SLOTS.length;
        return `
          <div class="listItem">
            <div class="listLeft">
              <div class="listMain">${esc(salonLabel(i))}</div>
              <div class="listMeta">${blocksBySalon[i]} bloque(s) · ${usedBySalon[i]} slot(s)</div>
            </div>
            <div class="listRight">
              <div class="pillTime">${Math.round(o*100)}%</div>
            </div>
          </div>
        `;
      }).join('')
    })}
  `;

  $kpisWrap.innerHTML = kpiHTML;
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

    if (READ_ONLY){
      setNet(true, fromCache ? 'solo lectura (cache)' : 'solo lectura (server)');
    }else{
      setNet(true, fromCache ? 'conectado (cache)' : 'conectado (server)');
    }

    blocks = snap.docs.map(d => sanitizeBlock({ id:d.id, ...d.data() }));
    reindexBlocks();

    setLoad(true, 'Listo', fromCache ? 'Mostrando datos cacheados' : 'Sincronizado');
    refreshAllViews();
  }, (err) => {
    console.error(err);
    setNet(false, 'error');
    setLoad(false, 'Error', humanFirestoreError(err));
  });
}

/* =============================================================================
   Actions
============================================================================= */
$toggleEdit?.addEventListener('change', () => {
  // Si no hay auth, no dejamos activar edición
  if ($toggleEdit.checked && READ_ONLY){
    $toggleEdit.checked = false;
    EDIT_MODE = false;
    showEditBadge(false);
    showDragBadge(false);
    cancelDrag();
    alert('Edición bloqueada: no hay sesión (Auth anónimo). La tabla sí carga, pero no se puede editar.');
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

/* ===== Modal events ===== */
$btnCloseModal && ($btnCloseModal.onclick = closeModal);
$btnCancel && ($btnCancel.onclick = closeModal);

$modalBack?.addEventListener('click', (e) => {
  if (e.target === $modalBack) closeModal();
});

document.addEventListener('keydown', (e) => {
  if ($modalBack?.hidden === false){
    if (e.key === 'Escape'){
      e.preventDefault();
      closeModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
      e.preventDefault();
      $btnSave?.click();
    }
  }
});

$btnSave && ($btnSave.onclick = async () => {
  if (!modalCtx) return;
  if (READ_ONLY) return;

  const endMin = Number($mEnd?.value);
  const salonIndex = modalCtx.salonIndex;
  const startMin = modalCtx.startMin;

  const { grupo, docente, modalidad, note, text } = getModalProPayload();
  const finalText = text || buildTextFromFields({ grupo, docente, modalidad, note });

  if (!finalText){
    alert('Ponle algo al bloque (Grupo/Docente o Texto final).');
    return;
  }
  if (!isWithinBounds(startMin, endMin)){
    alert('Hora fin inválida o fuera de rango.');
    return;
  }

  const overlaps = hasOverlap({
    ignoreId: modalCtx.mode === 'edit' ? modalCtx.id : null,
    salonIndex,
    startMin,
    endMin
  });
  if (overlaps){
    alert('Ese bloque se cruza con otro en el mismo salón.');
    return;
  }

  const payload = {
    hoja: modalCtx.hoja,
    salonIndex,
    startMin,
    endMin,
    text: finalText,
    note,
    grupo,
    docente,
    modalidad,
    updatedAt: serverTimestamp()
  };

  try{
    if (modalCtx.mode === 'new'){
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, 'blocks'), payload);
    }else{
      await updateDoc(doc(db, 'blocks', modalCtx.id), payload);
    }
    closeModal();
  }catch(err){
    console.error(err);
    alert('No se pudo guardar. Revisa conexión/permisos.');
  }
});

$btnDelete && ($btnDelete.onclick = async () => {
  if (!modalCtx || modalCtx.mode !== 'edit') return;
  if (READ_ONLY) return;
  if (!confirm('¿Eliminar este bloque?')) return;

  try{
    await deleteDoc(doc(db, 'blocks', modalCtx.id));
    closeModal();
  }catch(err){
    console.error(err);
    alert('No se pudo borrar. Revisa conexión/permisos.');
  }
});

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
ensureMiniCardStylesOnce();
bindGridDelegationOnce();

setNet(false, 'conectando');
setLoad(false, 'Cargando…', 'Inicializando…');
showEditBadge(!!$toggleEdit?.checked);

// Helper: timeout para no quedarnos colgados esperando auth
function withTimeout(promise, ms, label='timeout'){
  let t;
  const timeout = new Promise((_, rej)=>{
    t = setTimeout(()=>rej(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(()=>clearTimeout(t));
}

(async function init(){
  currentHoja = $selHoja?.value || 'Lunes';

  // 1) Arrancamos escuchando Firestore IGUAL (así auth no bloquee la tabla)
  //    Si las rules requieren auth, aquí se verá permission-denied y listo.
  listenHoja(currentHoja);
  startVivoAutoRefresh();

  // 2) Intento de Auth anónimo para habilitar edición (sin frenar render)
  try{
    // si tarda mucho, no bloquea todo
    await withTimeout(ensureAnon(), 4500, 'Auth tardó demasiado');
    AUTH_OK = true;
    READ_ONLY = false;
    LAST_ERR = null;

    setNet(true, 'conectado');
    setLoad(true, 'Listo', 'Sesión lista (edición disponible)');

    // Si el usuario tenía el toggle prendido, lo respetamos
    EDIT_MODE = !!$toggleEdit?.checked;
    showEditBadge(EDIT_MODE);

  }catch(e){
    // Auth falló: modo lectura
    AUTH_OK = false;
    READ_ONLY = true;
    LAST_ERR = e;

    // Si estaba en edit, lo apagamos
    if ($toggleEdit){
      $toggleEdit.checked = false;
    }
    EDIT_MODE = false;
    showEditBadge(false);
    showDragBadge(false);
    cancelDrag();

    // Importante: NO matamos la tabla, solo avisamos
    setNet(true, 'solo lectura');
    setLoad(true, 'Listo', 'Modo solo lectura (Auth anónimo no quedó listo)');

    console.warn('Auth anon no disponible. Continuando en solo lectura.', e);
    // No alert aquí porque en GitHub a veces el navegador se pone slow y sería spam.
    // Si de verdad necesitas el alert, lo activas:
    // alert(e?.message || 'Error de autenticación');
  }

  // 3) Render por si hubo cambios de flags
  refreshAllViews();
})();
