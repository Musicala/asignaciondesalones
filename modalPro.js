// modalPro.js
// Horario Musicala — Modal PRO (Selects + List Admin + AutoText + GitHub-safe payload)

export function setupModalPro(opts = {}) {
  // -----------------------------
  // Required DOM refs
  // -----------------------------
  const {
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

    // in index they are INPUT (datalist). We'll convert to SELECT (same ids)
    $mDocente,     // input
    $mModalidad,   // input

    // config
    STEP_MIN,
    END_MIN,

    // state getters
    getREAD_ONLY,        // () => boolean
    getCurrentHoja,      // () => "Lunes"... (optional)
    setModalCtx,         // (ctxOrNull) => void   (optional)
    getModalCtx,         // () => ctxOrNull       (optional)

    // helpers
    salonLabel,          // (salonIndex) => "Salón 1"
    toHHMM,              // (minutes) => "09:30"
    buildTextFromFields, // ({grupo,docente,modalidad,note}) => string
    esc,                 // (s) => escaped string

    // lists state + persistence
    getDOCENTES_PALETTE, // () => ({ name: "#hex", ... })
    setDOCENTES_PALETTE, // (obj) => void
    saveDocentesPalette, // (obj) => void

    getMODALIDADES,      // () => (["Sede","Virtual",...])
    setMODALIDADES,      // (arr) => void
    saveModalidades,     // (arr) => void

    // save/delete callbacks (app.js sigue manejando Firestore)
    onSave,              // async ({ctx, payload}) => void
    onDelete             // async ({ctx}) => void
  } = opts;

  // -----------------------------
  // Internal state
  // -----------------------------
  let modalCtx = null;
  let modalManualText = false;

  // We'll store select refs when created
  let $mDocenteSelect = null;
  let $mModalidadSelect = null;

  // -----------------------------
  // Tiny utilities
  // -----------------------------
  const qs = (s, root = document) => root.querySelector(s);

  function _READ_ONLY() {
    try { return !!getREAD_ONLY?.(); } catch (_) { return false; }
  }

  function _setCtx(ctx) {
    modalCtx = ctx;
    try { setModalCtx?.(ctx); } catch (_) {}
  }

  function _getCtx() {
    try {
      const external = getModalCtx?.();
      if (external) return external;
    } catch (_) {}
    return modalCtx;
  }

  function docentesSorted() {
    const pal = getDOCENTES_PALETTE?.() || {};
    return Object.keys(pal).sort((a,b)=>a.localeCompare(b,'es'));
  }

  function fillSelectOptions(sel, items) {
    if (!sel) return;

    const keep0 = sel.querySelector('option[value=""]');
    sel.innerHTML = '';

    if (keep0) {
      sel.appendChild(keep0);
    } else {
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '—';
      sel.appendChild(opt0);
    }

    (items || []).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  }

  // -----------------------------
  // INPUT -> SELECT (keeps same id)
  // -----------------------------
  function replaceInputWithSelect(inputEl, id) {
    if (!inputEl) return null;
    if (inputEl.tagName === 'SELECT') return inputEl;

    const sel = document.createElement('select');
    sel.id = id;
    sel.className = inputEl.className || '';
    sel.style.cssText = inputEl.style?.cssText || '';
    sel.setAttribute('aria-label', inputEl.getAttribute('aria-label') || '');

    const ph = inputEl.getAttribute('placeholder') || '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = ph ? ph : '—';
    sel.appendChild(opt0);

    inputEl.replaceWith(sel);
    return sel;
  }

  // -----------------------------
  // Panel de admin de listas (Docentes/Modalidades)
  // -----------------------------
  function ensureModalListUI() {
    if (qs('#__listsPanel')) return;

    const modalBody = qs('.modalBody');
    if (!modalBody) return;

    const panel = document.createElement('div');
    panel.id = '__listsPanel';
    panel.style.marginTop = '12px';
    panel.style.paddingTop = '12px';
    panel.style.borderTop = '1px solid var(--line)';
    panel.innerHTML = `
      <details style="border:1px solid var(--line);border-radius:16px;padding:10px 12px;background:rgba(255,255,255,.75);box-shadow:var(--shadow2)">
        <summary style="cursor:pointer;font-weight:1000">Listas (Docentes / Modalidades)</summary>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;">
          <div>
            <div style="font-weight:1000;margin-bottom:6px;">Docentes</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="__docName" class="select" style="border-radius:12px;flex:1;min-width:160px" placeholder="Nombre docente" />
              <input id="__docColor" type="color" value="#C7D2FE" style="height:40px;width:56px;border:1px solid var(--line);border-radius:12px;padding:4px;background:#fff" />
              <button id="__docAdd" class="btnTop" type="button">Agregar</button>
            </div>
            <div id="__docList" style="margin-top:10px;"></div>
            <div style="color:var(--muted);font-weight:800;font-size:12px;margin-top:8px;">
              Esto se guarda en el navegador (localStorage). Si abres en otro computador, toca volver a cargar la lista.
            </div>
          </div>

          <div>
            <div style="font-weight:1000;margin-bottom:6px;">Modalidades</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="__modName" class="select" style="border-radius:12px;flex:1;min-width:160px" placeholder="Ej: Sede" />
              <button id="__modAdd" class="btnTop" type="button">Agregar</button>
            </div>
            <div id="__modList" style="margin-top:10px;"></div>
            <div style="color:var(--muted);font-weight:800;font-size:12px;margin-top:8px;">
              Recomendado: Sede / Virtual (y ya).
            </div>
          </div>
        </div>
      </details>
    `;
    modalBody.appendChild(panel);

    const $docName  = qs('#__docName');
    const $docColor = qs('#__docColor');
    const $docAdd   = qs('#__docAdd');
    const $docList  = qs('#__docList');

    const $modName = qs('#__modName');
    const $modAdd  = qs('#__modAdd');
    const $modList = qs('#__modList');

    function renderDocList() {
      const pal = getDOCENTES_PALETTE?.() || {};
      const keys = Object.keys(pal).sort((a,b)=>a.localeCompare(b,'es'));

      if (!keys.length) {
        $docList.innerHTML = `<div style="color:var(--muted);font-weight:900;">Sin docentes.</div>`;
        return;
      }

      $docList.innerHTML = keys.map(name => {
        const col = pal[name] || '#C7D2FE';
        return `
          <div class="listItem" style="align-items:center;">
            <div class="listLeft" style="display:flex;gap:10px;align-items:center;min-width:0;">
              <span style="width:18px;height:18px;border-radius:6px;background:${esc(col)};border:1px solid rgba(0,0,0,.12);flex:0 0 auto;"></span>
              <div class="listMain" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
            </div>
            <div class="listRight" style="flex-direction:row;align-items:center;">
              <input data-act="docColor" data-name="${esc(name)}" type="color" value="${esc(col)}"
                style="height:36px;width:50px;border:1px solid var(--line);border-radius:12px;padding:3px;background:#fff" />
              <button class="btnMini" data-act="docDel" data-name="${esc(name)}" type="button">Quitar</button>
            </div>
          </div>
        `;
      }).join('');

      $docList.querySelectorAll('[data-act="docDel"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name;
          if (!name) return;

          const next = { ...(getDOCENTES_PALETTE?.() || {}) };
          delete next[name];

          setDOCENTES_PALETTE?.(next);
          saveDocentesPalette?.(next);

          // Refresh selects
          refreshDocentesSelect();
          renderDocList();
        });
      });

      $docList.querySelectorAll('[data-act="docColor"]').forEach(inp => {
        inp.addEventListener('input', () => {
          const name = inp.dataset.name;
          if (!name) return;

          const next = { ...(getDOCENTES_PALETTE?.() || {}) };
          next[name] = inp.value;

          setDOCENTES_PALETTE?.(next);
          saveDocentesPalette?.(next);

          refreshDocentesSelect();
        });
      });
    }

    function renderModList() {
      let mods = (getMODALIDADES?.() || []).slice();
      if (!mods.length) mods = ["Sede","Virtual"];

      $modList.innerHTML = mods.map((m, idx) => {
        return `
          <div class="listItem" style="align-items:center;">
            <div class="listLeft">
              <div class="listMain">${esc(m)}</div>
            </div>
            <div class="listRight" style="flex-direction:row;align-items:center;">
              <button class="btnMini" data-act="modUp" data-idx="${idx}" type="button">↑</button>
              <button class="btnMini" data-act="modDown" data-idx="${idx}" type="button">↓</button>
              <button class="btnMini" data-act="modDel" data-idx="${idx}" type="button">Quitar</button>
            </div>
          </div>
        `;
      }).join('');

      $modList.querySelectorAll('[data-act="modDel"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.idx);
          if (!Number.isFinite(i)) return;

          let arr = (getMODALIDADES?.() || []).slice();
          arr.splice(i, 1);
          arr = arr.map(x=>String(x).trim()).filter(Boolean);
          if (!arr.length) arr = ["Sede","Virtual"];

          setMODALIDADES?.(arr);
          saveModalidades?.(arr);

          refreshModalidadesSelect();
          renderModList();
        });
      });

      $modList.querySelectorAll('[data-act="modUp"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.idx);
          let arr = (getMODALIDADES?.() || []).slice();
          if (i > 0) {
            const tmp = arr[i-1]; arr[i-1] = arr[i]; arr[i] = tmp;
            setMODALIDADES?.(arr);
            saveModalidades?.(arr);

            refreshModalidadesSelect();
            renderModList();
          }
        });
      });

      $modList.querySelectorAll('[data-act="modDown"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.idx);
          let arr = (getMODALIDADES?.() || []).slice();
          if (i < arr.length - 1) {
            const tmp = arr[i+1]; arr[i+1] = arr[i]; arr[i] = tmp;
            setMODALIDADES?.(arr);
            saveModalidades?.(arr);

            refreshModalidadesSelect();
            renderModList();
          }
        });
      });
    }

    $docAdd?.addEventListener('click', () => {
      const name = ($docName?.value || '').trim();
      const col  = ($docColor?.value || '#C7D2FE').trim();
      if (!name) return;

      const next = { ...(getDOCENTES_PALETTE?.() || {}) };
      next[name] = col;

      setDOCENTES_PALETTE?.(next);
      saveDocentesPalette?.(next);

      if ($docName) $docName.value = '';
      refreshDocentesSelect();
      renderDocList();
    });

    $modAdd?.addEventListener('click', () => {
      const name = ($modName?.value || '').trim();
      if (!name) return;

      let arr = (getMODALIDADES?.() || []).slice();
      if (!arr.includes(name)) arr.push(name);
      arr = arr.map(x=>String(x).trim()).filter(Boolean);

      setMODALIDADES?.(arr);
      saveModalidades?.(arr);

      if ($modName) $modName.value = '';
      refreshModalidadesSelect();
      renderModList();
    });

    renderDocList();
    renderModList();
  }

  // -----------------------------
  // Ensure selects exist + filled
  // -----------------------------
  function ensureModalSelects() {
    // Convert inputs to selects (id stays mDocente / mModalidad)
    if (!$mDocenteSelect) $mDocenteSelect = replaceInputWithSelect($mDocente, 'mDocente');
    if (!$mModalidadSelect) $mModalidadSelect = replaceInputWithSelect($mModalidad, 'mModalidad');

    refreshDocentesSelect();
    refreshModalidadesSelect();
  }

  function refreshDocentesSelect() {
    // In case DOM changed, re-grab by id (GitHub-safe)
    if (!$mDocenteSelect) $mDocenteSelect = qs('#mDocente');
    if (!$mDocenteSelect || $mDocenteSelect.tagName !== 'SELECT') return;

    const current = ($mDocenteSelect.value || '').trim();
    fillSelectOptions($mDocenteSelect, docentesSorted());
    if (current) $mDocenteSelect.value = current;
  }

  function refreshModalidadesSelect() {
    if (!$mModalidadSelect) $mModalidadSelect = qs('#mModalidad');
    if (!$mModalidadSelect || $mModalidadSelect.tagName !== 'SELECT') return;

    const current = ($mModalidadSelect.value || '').trim();
    const mods = (getMODALIDADES?.() || []).slice();
    fillSelectOptions($mModalidadSelect, mods);
    if (current) $mModalidadSelect.value = current;
  }

  // -----------------------------
  // Auto text sync
  // -----------------------------
  function syncModalTextFromProFields() {
    if (!_getCtx()) return;
    if (!$mText || !$mGrupo || !$mNote) return;
    if (modalManualText) return;

    const { grupo, docente, modalidad, note } = getModalProPayload(); // uses robust readers
    $mText.value = buildTextFromFields({ grupo, docente, modalidad, note });
  }

  // -----------------------------
  // 🔥 GitHub-safe payload reader
  // (reads from select if exists, else from input, else from DOM by id)
  // -----------------------------
  function valueFromDocenteField() {
    // Prefer select if present
    const sel = qs('#mDocente');
    if (sel && sel.tagName === 'SELECT') return (sel.value || '').trim();

    // fallback to original input if still exists somewhere
    if ($mDocente && $mDocente.tagName === 'INPUT') return ($mDocente.value || '').trim();

    // last resort: any element with id
    const any = document.getElementById('mDocente');
    return (any?.value || '').trim();
  }

  function valueFromModalidadField() {
    const sel = qs('#mModalidad');
    if (sel && sel.tagName === 'SELECT') return (sel.value || '').trim();

    if ($mModalidad && $mModalidad.tagName === 'INPUT') return ($mModalidad.value || '').trim();

    const any = document.getElementById('mModalidad');
    return (any?.value || '').trim();
  }

  function getModalProPayload() {
    const grupo = ($mGrupo?.value || '').trim();
    const docente = valueFromDocenteField();
    const modalidad = valueFromModalidadField();
    const note = ($mNote?.value || '').trim();
    const text = ($mText?.value || '').trim();

    return { grupo, docente, modalidad, note, text };
  }

  // -----------------------------
  // Modal open/close
  // -----------------------------
  function openModal(ctx, existing = null) {
    if (_READ_ONLY()) {
      alert('Estás en modo solo lectura (sin sesión). Para editar necesitas Auth anónimo habilitado.');
      return;
    }

    _setCtx(ctx);
    modalManualText = false;

    ensureModalSelects();
    ensureModalListUI();

    const salonName = salonLabel?.(ctx.salonIndex) || '';
    if ($mHoja)  $mHoja.value = ctx.hoja;
    if ($mSalon) $mSalon.value = salonName;
    if ($mStart) $mStart.value = toHHMM?.(ctx.startMin) || '';

    if ($mEnd) {
      $mEnd.innerHTML = '';
      for (let m = ctx.startMin + STEP_MIN; m <= END_MIN; m += STEP_MIN) {
        const opt = document.createElement('option');
        opt.value = String(m);
        opt.textContent = toHHMM?.(m) || String(m);
        $mEnd.appendChild(opt);
      }
    }

    if (existing) {
      if ($modalTitle) $modalTitle.textContent = 'Editar bloque';
      if ($mText) $mText.value = existing.text || '';
      if ($mNote) $mNote.value = existing.note || '';
      if ($mGrupo) $mGrupo.value = existing.grupo || '';

      refreshDocentesSelect();
      refreshModalidadesSelect();

      const docSel = qs('#mDocente');
      const modSel = qs('#mModalidad');

      if (docSel) docSel.value = existing.docente || '';
      if (modSel) modSel.value = existing.modalidad || '';

      if ($mEnd) $mEnd.value = String(existing.endMin);
      if ($btnDelete) $btnDelete.hidden = false;
    } else {
      if ($modalTitle) $modalTitle.textContent = 'Crear bloque';
      if ($mNote) $mNote.value = '';
      if ($mGrupo) $mGrupo.value = '';

      refreshDocentesSelect();
      refreshModalidadesSelect();

      const docSel = qs('#mDocente');
      const modSel = qs('#mModalidad');
      if (docSel) docSel.value = '';
      if (modSel) modSel.value = '';

      if ($mText) $mText.value = '';
      if ($mEnd) $mEnd.value = String(ctx.startMin + STEP_MIN);
      if ($btnDelete) $btnDelete.hidden = true;
    }

    syncModalTextFromProFields();

    if ($modalBack) $modalBack.hidden = false;
    setTimeout(() => {
      if ($mGrupo) $mGrupo.focus();
      else $mText?.focus();
    }, 0);
  }

  function closeModal() {
    if ($modalBack) $modalBack.hidden = true;
    _setCtx(null);
    modalManualText = false;
  }

  // -----------------------------
  // Bind modal listeners (once)
  // -----------------------------
  let bound = false;
  function bindOnce() {
    if (bound) return;
    bound = true;

    // manual text flag
    $mText?.addEventListener('input', () => { modalManualText = true; });

    // when group/note changes, update auto text
    [$mGrupo, $mNote].filter(Boolean).forEach(el => {
      el.addEventListener('input', () => syncModalTextFromProFields());
    });

    // when docente/modalidad changes (select), update auto text
    document.addEventListener('change', (e) => {
      const id = e?.target?.id;
      if (id === 'mDocente' || id === 'mModalidad') {
        syncModalTextFromProFields();
      }
    });

    // close buttons
    if ($btnCloseModal) $btnCloseModal.onclick = closeModal;
    if ($btnCancel) $btnCancel.onclick = closeModal;

    // click outside closes
    $modalBack?.addEventListener('click', (e) => {
      if (e.target === $modalBack) closeModal();
    });

    // keyboard shortcuts when open
    document.addEventListener('keydown', (e) => {
      if ($modalBack?.hidden === false) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          $btnSave?.click();
        }
      }
    });

    // Save delegates to app.js via onSave()
    $btnSave && ($btnSave.onclick = async () => {
      const ctx = _getCtx();
      if (!ctx) return;
      if (_READ_ONLY()) return;

      const endMin = Number($mEnd?.value);
      const { grupo, docente, modalidad, note, text } = getModalProPayload();
      const finalText = text || buildTextFromFields({ grupo, docente, modalidad, note });

      // app.js already validates overlaps/bounds; you can keep there.
      // But we still send full payload.
      const payload = {
        hoja: ctx.hoja ?? getCurrentHoja?.() ?? '',
        salonIndex: ctx.salonIndex,
        startMin: ctx.startMin,
        endMin,
        text: finalText,
        note,
        grupo,
        docente,
        modalidad
      };

      try {
        await onSave?.({ ctx, payload });
      } catch (err) {
        console.error(err);
        alert('No se pudo guardar. Revisa conexión/permisos.');
      }
    });

    // Delete delegates to app.js via onDelete()
    $btnDelete && ($btnDelete.onclick = async () => {
      const ctx = _getCtx();
      if (!ctx || ctx.mode !== 'edit') return;
      if (_READ_ONLY()) return;
      if (!confirm('¿Eliminar este bloque?')) return;

      try {
        await onDelete?.({ ctx });
      } catch (err) {
        console.error(err);
        alert('No se pudo borrar. Revisa conexión/permisos.');
      }
    });
  }

  // bind immediately
  bindOnce();

  // Public API
  return {
    openModal,
    closeModal,
    getModalProPayload,
    getModalCtx: _getCtx
  };
}
