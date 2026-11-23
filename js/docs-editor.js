/* ===== VOID DOCUMENTS — редактор =====
   Редактор на contenteditable. Содержимое проходит через docs-core.js (белый список тегов),
   поэтому произвольный код из документа выполниться не может.

   - Форматирование: document.execCommand для выделенного фрагмента.
   - Undo/Redo: собственная история снимков (системная отключена), в память до ~100 шагов.
   - Тема документа (white/gray/black) действует только внутри листа и не связана с темами VOID.
   - Автосохранение: hooks.save() через 0,9 с после правки, при сворачивании, перед блокировкой и выходом.
   - Расширения (этап D2: таблицы, картинки): VOID.docsEditor.use({ tools:[{id,text|icon,title,run(api,btn)}], afterRender(api) }).
     Расширения подключаются до первого открытия редактора.

   Открытие: VOID.docsEditor.open({id,title,tags,html,theme,updatedAt,isNew}, hooks)
   hooks: save(snapshot) -> Promise<'saved'|'empty'>, remove() -> Promise, onTheme(theme), onClosed(). */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  const core = VOID.docsCore;
  if (!ui || !core) { console.error('VOID DOCUMENTS: не загружены ui.js или docs-core.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';

  const HIST_MAX = 100;
  const HIST_CHARS = 12000000;
  const REC_DELAY = 600;
  const SAVE_DELAY = 900;
  const SENTINEL = 'rgb(1, 2, 3)'; // «метка» для сброса цвета и выделения

  const THEME_NAMES = { white: 'White', gray: 'Gray', black: 'Black' };
  const THEME_SWATCH = { white: '#FFFFFF', gray: '#D6D8DB', black: '#000000' };
  const COLORS = [['Красный', '#E5484D'], ['Оранжевый', '#F76B15'], ['Жёлтый', '#E0A800'], ['Зелёный', '#2FA84F'],
    ['Синий', '#3B82F6'], ['Фиолетовый', '#8B5CF6'], ['Розовый', '#E255A1'], ['Серый', '#8A8F98'],
    ['Чёрный', '#000000'], ['Белый', '#FFFFFF']];
  const HILITES = [['Жёлтый', 'rgba(255,214,10,0.38)'], ['Зелёный', 'rgba(48,209,88,0.32)'],
    ['Голубой', 'rgba(64,156,255,0.32)'], ['Розовый', 'rgba(255,105,180,0.32)'],
    ['Оранжевый', 'rgba(255,159,10,0.34)'], ['Серый', 'rgba(150,150,160,0.35)']];
  const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
  const ROOT_OK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'BLOCKQUOTE', 'HR', 'TABLE']);
  const TAIL_OK = ['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'BLOCKQUOTE'];

  const ICONS = {
    'dx-save': 'M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7',
    'dx-export': 'M12 4v11M7 10l5 5 5-5M5 20h14',
    'dx-trash': 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    'dx-pencil': 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    'dx-ul': 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    'dx-link': 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    'dx-theme': 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18',
    'dx-al-l': 'M4 6h16M4 10h10M4 14h16M4 18h10',
    'dx-al-c': 'M4 6h16M7 10h10M4 14h16M7 18h10',
    'dx-al-r': 'M4 6h16M10 10h10M4 14h16M10 18h10',
    'dx-al-j': 'M4 6h16M4 10h16M4 14h16M4 18h16',
    'dx-undo': 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
    'dx-redo': 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13'
  };
  (function addIcons() {
    const defs = document.querySelector('svg defs');
    if (!defs) return;
    Object.keys(ICONS).forEach(function (k) {
      if (document.getElementById('i-' + k)) return;
      const sym = document.createElementNS(NS, 'symbol');
      sym.setAttribute('id', 'i-' + k);
      sym.setAttribute('viewBox', '0 0 24 24');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', ICONS[k]);
      sym.appendChild(p);
      defs.appendChild(sym);
    });
  })();

  /* =====================================================
     Диалог с одним полем (ссылка, переименование)
     ===================================================== */
  let dlg = null, dForm, dHead, dLabel, dInput, dExtra, dCancel, dOk;

  function buildDlg() {
    if (dlg) return;
    dHead = el('h2', { class: 'modal__title' });
    dLabel = el('span');
    dInput = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    dExtra = el('div', { class: 'dx__extra' });
    dCancel = el('button', { class: 'btn', type: 'button', text: 'Отмена' });
    dOk = el('button', { class: 'btn btn--primary', type: 'submit' });
    dForm = el('form', { class: 'modal__box', novalidate: '', autocomplete: 'off' }, [
      dHead, el('label', { class: 'field' }, [dLabel, dInput]), dExtra,
      el('div', { class: 'modal__actions' }, [dCancel, dOk])
    ]);
    dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Диалог', hidden: '' }, [dForm]);
    document.getElementById('app').appendChild(dlg);
  }

  /** o: {heading, label, value, placeholder, type:'text'|'url', max, confirmText, extra:[{text, action, danger}]}
      Возвращает Promise<{action, value}> или null, если нажали «Отмена». */
  function prompt(o) {
    buildDlg();
    return new Promise(function (resolve) {
      let result = null;
      dHead.textContent = o.heading || '';
      dLabel.textContent = o.label || '';
      dInput.value = o.value || '';
      dInput.placeholder = o.placeholder || '';
      dInput.maxLength = o.max || 200;
      dInput.setAttribute('inputmode', o.type === 'url' ? 'url' : 'text');
      dOk.textContent = o.confirmText || 'OK';
      dExtra.textContent = '';
      (o.extra || []).forEach(function (x) {
        const b = el('button', { class: 'btn' + (x.danger ? ' btn--danger' : ''), type: 'button', text: x.text });
        b.addEventListener('click', function () { result = { action: x.action, value: dInput.value }; ui.requestClose(); });
        dExtra.appendChild(b);
      });
      const onSubmit = function (e) { e.preventDefault(); result = { action: 'ok', value: dInput.value }; ui.requestClose(); };
      const onCancel = function () { result = null; ui.requestClose(); };
      const onBackdrop = function (e) { if (e.target === dlg) onCancel(); };
      dForm.addEventListener('submit', onSubmit);
      dCancel.addEventListener('click', onCancel);
      dlg.addEventListener('click', onBackdrop);
      dlg.hidden = false;
      ui.pushOverlay(function () {
        dlg.hidden = true;
        dForm.removeEventListener('submit', onSubmit);
        dCancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('click', onBackdrop);
        dInput.value = '';
        dExtra.textContent = '';
        resolve(result);
      });
      setTimeout(function () { dInput.focus(); }, 60);
    });
  }

  /* =====================================================
     Состояние редактора
     ===================================================== */
  const plugins = [];
  let built = false;
  let root, bar, tools, scrollEl, titleIn, tagsIn, ed, pop, popBd;
  let statusEl, undoBtn, redoBtn, saveBtn, exportBtn, delBtn;
  const toolBtns = {};
  const pluginRuns = {};
  let active = false, deleted = false, dirty = false, composing = false;
  let hooks = null, theme = 'white', savedRange = null, pendingSize = null, toolRaf = 0;
  let saveTimer = 0, recTimer = 0;
  const hist = { s: [], i: -1, chars: 0 };

  const api = {
    cmd: function (n, v, css) { return cmd(n, v, css); },
    restoreRange: function () { restoreRange(); },
    getRange: function () { return savedRange; },
    commit: function () { after(); },
    openPop: function (a, n) { openPop(a, n); },
    closePop: function () { closePop(); },
    toast: function (m, t, ms) { if (VOID.toast) VOID.toast(m, t, ms); },
    prompt: prompt, core: core, ui: ui
  };

  function toast(m, t, ms) { if (VOID.toast) VOID.toast(m, t, ms); }

  /* ---------- Выделение: сохранение и восстановление ---------- */
  function inEd(n) { return !!(n && ed && ed.contains(n)); }

  function onSelChange() {
    if (!active) return;
    const s = window.getSelection();
    if (s && s.rangeCount) {
      const r = s.getRangeAt(0);
      if (inEd(r.commonAncestorContainer)) savedRange = r.cloneRange();
    }
    scheduleTools();
  }

  function restoreRange() {
    if (!savedRange || !inEd(savedRange.commonAncestorContainer)) { savedRange = null; if (document.activeElement !== ed) ed.focus({ preventScroll: true }); return; }
    const s = window.getSelection();
    const inside = s && s.rangeCount && inEd(s.getRangeAt(0).commonAncestorContainer);
    if (document.activeElement !== ed) ed.focus({ preventScroll: true });
    if (!inside) { s.removeAllRanges(); s.addRange(savedRange); }
  }

  function offsetOf(node, off) {
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.setEnd(node, off);
    return r.toString().length;
  }

  function getOffsets() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!inEd(r.startContainer) || !inEd(r.endContainer)) return null;
    return { a: offsetOf(r.startContainer, r.startOffset), b: offsetOf(r.endContainer, r.endOffset) };
  }

  function setOffsets(o) {
    if (!o) return;
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, pos = 0, sN = null, sO = 0, eN = null, eO = 0;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      if (!sN && o.a <= pos + len) { sN = n; sO = o.a - pos; }
      if (!eN && o.b <= pos + len) { eN = n; eO = o.b - pos; break; }
      pos += len;
    }
    const r = document.createRange();
    if (sN && eN) { r.setStart(sN, sO); r.setEnd(eN, eO); }
    else {
      const first = ed.querySelector('p,h1,h2,h3,li,td,th') || ed;
      r.setStart(first, 0);
      r.collapse(true);
    }
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    savedRange = r.cloneRange();
  }

  function selNode() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!inEd(r.startContainer)) return null;
    return r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
  }

  function closestTag(names) {
    let n = selNode();
    while (n && n !== ed) {
      if (n.nodeType === 1 && names.indexOf(n.tagName) >= 0) return n;
      n = n.parentNode;
    }
    return null;
  }

  /* ---------- Приведение корня редактора в порядок ---------- */
  function fixRoot() {
    if (!ed.firstChild) { ed.innerHTML = '<p><br></p>'; setOffsets({ a: 0, b: 0 }); return; }
    const sel = getOffsets();
    let run = null, changed = false;
    Array.from(ed.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && ROOT_OK.has(n.tagName)) { run = null; return; }
      if (n.nodeType === 3 && !n.nodeValue.trim()) {
        if (run) run.appendChild(n); else ed.removeChild(n);
        return;
      }
      if (!run) { run = document.createElement('p'); ed.insertBefore(run, n); }
      run.appendChild(n);
      changed = true;
    });
    if (changed && sel) setOffsets(sel);
  }

  function ensureTail() {
    const last = ed.lastElementChild;
    if (!last || TAIL_OK.indexOf(last.tagName) < 0) {
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      ed.appendChild(p);
    }
  }

  function updateEmpty() {
    ed.classList.toggle('is-empty', ed.textContent.length === 0 && !ed.querySelector('img,table,hr,li'));
  }

  /* ---------- История (Undo / Redo) ---------- */
  function updateUndoUi() {
    undoBtn.disabled = hist.i <= 0;
    redoBtn.disabled = hist.i >= hist.s.length - 1;
  }

  function record() {
    const html = ed.innerHTML;
    if (hist.i >= 0 && hist.s[hist.i].html === html) return false;
    for (let k = hist.i + 1; k < hist.s.length; k++) hist.chars -= hist.s[k].html.length;
    hist.s.length = hist.i + 1;
    hist.s.push({ html: html, sel: getOffsets() });
    hist.chars += html.length;
    while (hist.s.length > 2 && (hist.s.length > HIST_MAX || hist.chars > HIST_CHARS)) {
      hist.chars -= hist.s.shift().html.length;
    }
    hist.i = hist.s.length - 1;
    updateUndoUi();
    return true;
  }

  function flushRec() {
    clearTimeout(recTimer);
    recTimer = 0;
    if (active) record();
  }

  function recNow() { clearTimeout(recTimer); recTimer = 0; record(); }

  function scheduleRec() {
    clearTimeout(recTimer);
    recTimer = setTimeout(function () {
      recTimer = 0;
      if (!active) return;
      if (!composing) fixRoot();
      record();
    }, REC_DELAY);
  }

  function renderPlugins() {
    plugins.forEach(function (p) {
      if (typeof p.afterRender === 'function') {
        try { p.afterRender(api); } catch (err) { console.error('Docs plugin error:', err); }
      }
    });
  }

  function applyState(st) {
    ed.innerHTML = st.html;
    savedRange = null;
    if (st.sel) setOffsets(st.sel);
    updateEmpty();
    renderPlugins();
    markDirty();
    scheduleTools();
    updateUndoUi();
  }

  function undo() {
    if (!active) return;
    flushRec();
    if (hist.i > 0) { hist.i--; applyState(hist.s[hist.i]); }
  }

  function redo() {
    if (!active) return;
    flushRec();
    if (hist.i < hist.s.length - 1) { hist.i++; applyState(hist.s[hist.i]); }
  }

  /* ---------- Команды форматирования ---------- */
  function cleanup() {
    ed.querySelectorAll('[style]').forEach(function (n) {
      const st = n.style;
      let ch = false;
      if (st.color === SENTINEL) { st.removeProperty('color'); ch = true; }
      if (st.backgroundColor === SENTINEL) { st.removeProperty('background-color'); ch = true; }
      if (ch && !n.getAttribute('style')) n.removeAttribute('style');
    });
    if (pendingSize !== null) {
      ed.querySelectorAll('font[size="7"]').forEach(function (f) {
        f.removeAttribute('size');
        f.querySelectorAll('[style]').forEach(function (d) {
          d.style.removeProperty('font-size');
          if (!d.getAttribute('style')) d.removeAttribute('style');
        });
        if (pendingSize > 0) f.style.fontSize = pendingSize + 'px';
      });
      pendingSize = null;
    }
    ed.querySelectorAll('font[size]').forEach(function (f) { f.removeAttribute('size'); });
  }

  function after() {
    if (!active) return;
    cleanup();
    if (!composing) fixRoot();
    ensureTail();
    recNow();
    markDirty();
    updateEmpty();
    scheduleTools();
  }

  function cmd(name, value, css) {
    if (!active) return false;
    restoreRange();
    flushRec();
    try { document.execCommand('styleWithCSS', false, !!css); } catch (_) { /* не критично */ }
    let ok = false;
    try { ok = document.execCommand(name, false, value === undefined ? null : value); } catch (_) { ok = false; }
    after();
    return ok;
  }

  function setBlock(tag) {
    const b = closestTag(['H1', 'H2', 'H3']);
    if (b && b.tagName === tag.toUpperCase()) cmd('formatBlock', '<p>');
    else cmd('formatBlock', '<' + tag + '>');
  }

  function toggleQuote() {
    if (closestTag(['BLOCKQUOTE'])) cmd('outdent'); else cmd('formatBlock', '<blockquote>');
  }

  function applySize(px) {
    const s = window.getSelection();
    const collapsed = !s || !s.rangeCount || s.getRangeAt(0).collapsed;
    if (collapsed) { toast('Выделите текст, чтобы изменить размер', 'info', 2200); return; }
    pendingSize = px;
    cmd('fontSize', '7', false);
  }

  function clearPalette(kind) {
    if (kind === 'color') cmd('foreColor', '#010203', true);
    else cmd('hiliteColor', '#010203', true);
  }

  /* ---------- Всплывающие панели ---------- */
  function closePop() {
    if (!pop) return;
    pop.hidden = true;
    popBd.hidden = true;
    pop.textContent = '';
  }

  function openPop(anchor, node) {
    closePop();
    pop.appendChild(node);
    pop.hidden = false;
    popBd.hidden = false;
    const ar = anchor.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    pop.style.top = (ar.bottom - rr.top + 4) + 'px';
    pop.style.left = '0px';
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(ar.left - rr.left, rr.width - w - 8)) + 'px';
  }

  function paletteNode(kind) {
    const list = kind === 'color' ? COLORS : HILITES;
    const grid = el('div', { class: 'dx__sw' });
    list.forEach(function (c) {
      const b = el('button', { type: 'button', 'aria-label': c[0], 'data-val': c[1] });
      b.style.background = c[1];
      grid.appendChild(b);
    });
    const reset = el('button', { class: 'dx__row', type: 'button', 'data-reset': '1',
      text: kind === 'color' ? 'Цвет по умолчанию' : 'Убрать выделение' });
    const box = el('div', {}, [grid, reset]);
    box.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      closePop();
      if (b.dataset.reset) clearPalette(kind);
      else cmd(kind === 'color' ? 'foreColor' : 'hiliteColor', b.dataset.val, true);
    });
    return box;
  }

  function sizesNode() {
    const box = el('div');
    SIZES.forEach(function (px) {
      const b = el('button', { class: 'dx__row', type: 'button', 'data-px': String(px) }, [
        el('span', { text: px + ' px' })
      ]);
      b.firstChild.style.fontSize = Math.min(px, 28) + 'px';
      box.appendChild(b);
    });
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-px': '0', text: 'Обычный размер' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-clear': '1', text: 'Очистить форматирование' }));
    box.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      closePop();
      if (b.dataset.clear) cmd('removeFormat');
      else applySize(Number(b.dataset.px));
    });
    return box;
  }

  function alignNode() {
    const items = [['Слева', 'dx-al-l', 'justifyLeft'], ['По центру', 'dx-al-c', 'justifyCenter'],
      ['Справа', 'dx-al-r', 'justifyRight'], ['По ширине', 'dx-al-j', 'justifyFull']];
    const box = el('div');
    items.forEach(function (it) {
      box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-cmd': it[2] }, [ui.icon(it[1]), el('span', { text: it[0] })]));
    });
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      closePop();
      cmd(b.dataset.cmd, null, true);
    });
    return box;
  }

  function themeNode() {
    const box = el('div');
    core.THEMES.forEach(function (t) {
      const dot = el('span', { class: 'dx__dot' });
      dot.style.background = THEME_SWATCH[t];
      box.appendChild(el('button', { class: 'dx__row' + (t === theme ? ' on' : ''), type: 'button', 'data-theme': t },
        [dot, el('span', { text: THEME_NAMES[t] + (t === theme ? ' ✓' : '') })]));
    });
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-theme]');
      if (!b) return;
      closePop();
      setTheme(b.dataset.theme);
    });
    return box;
  }

  function exportNode() {
    const box = el('div');
    const share = VOID.docsExport && VOID.docsExport.canShare && VOID.docsExport.canShare();
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-ex': 'txt', text: 'Скачать TXT' }));
    if (share) box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-ex': 'txt-share', text: 'Отправить TXT…' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-ex': 'pdf', text: 'Сохранить как PDF…' }));
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-ex]');
      if (!b) return;
      closePop();
      doExport(b.dataset.ex);
    });
    return box;
  }

  /* ---------- Ссылки ---------- */
  function normalizeUrl(v) {
    let s = String(v || '').trim().replace(/\s+/g, '');
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^(https?:|mailto:|tel:)/i.test(s) ? s : '';
    if (/^[^@\/]+@[^@\/]+\.[^@\/]+$/.test(s)) return 'mailto:' + s;
    if (/^[^\/]+\.[^\/]{2,}/.test(s)) return 'https://' + s;
    return '';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function linkTool() {
    restoreRange();
    const a = closestTag(['A']);
    const existing = a ? a.getAttribute('href') || '' : '';
    const s = window.getSelection();
    const collapsed = !s || !s.rangeCount || s.getRangeAt(0).collapsed;
    const saved = savedRange ? savedRange.cloneRange() : null;
    const extra = a ? [{ text: 'Открыть ссылку', action: 'open' }, { text: 'Убрать ссылку', action: 'unlink', danger: true }] : [];
    const res = await prompt({ heading: 'Ссылка', label: 'Адрес (https://…)', value: existing, type: 'url',
      max: 2000, confirmText: 'Применить', extra: extra });
    if (!res || !active) return;
    savedRange = saved;
    restoreRange();
    if (res.action === 'open') {
      const u = normalizeUrl(existing);
      if (u) window.open(u, '_blank', 'noopener,noreferrer');
      return;
    }
    if (res.action === 'unlink') { cmd('unlink'); return; }
    const url = normalizeUrl(res.value);
    if (!url) { toast('Нужен адрес вида https://… или почта', 'error', 3000); return; }
    if (a && existing) { a.setAttribute('href', url); after(); return; }
    if (collapsed) cmd('insertHTML', '<a href="' + esc(url) + '">' + esc(url.replace(/^mailto:|^tel:/i, '')) + '</a>');
    else cmd('createLink', url);
  }

  /* ---------- Тема документа ---------- */
  function applyTheme() {
    scrollEl.className = 'dx__scroll dx-theme--' + theme;
  }

  function setTheme(t) {
    if (core.THEMES.indexOf(t) < 0 || t === theme) return;
    theme = t;
    applyTheme();
    if (hooks && typeof hooks.onTheme === 'function') hooks.onTheme(t);
    markDirty();
  }

  /* ---------- Состояние кнопок ---------- */
  function setOn(id, on) { if (toolBtns[id]) toolBtns[id].classList.toggle('on', !!on); }

  function updateTools() {
    toolRaf = 0;
    if (!active || !selNode()) return;
    const q = function (n) { try { return document.queryCommandState(n); } catch (_) { return false; } };
    setOn('bold', q('bold'));
    setOn('italic', q('italic'));
    setOn('underline', q('underline'));
    setOn('strike', q('strikeThrough'));
    setOn('ul', q('insertUnorderedList'));
    setOn('ol', q('insertOrderedList'));
    const h = closestTag(['H1', 'H2', 'H3']);
    setOn('h1', h && h.tagName === 'H1');
    setOn('h2', h && h.tagName === 'H2');
    setOn('h3', h && h.tagName === 'H3');
    setOn('quote', closestTag(['BLOCKQUOTE']));
    setOn('link', closestTag(['A']));
  }

  function scheduleTools() { if (!toolRaf) toolRaf = requestAnimationFrame(updateTools); }

  /* =====================================================
     Сохранение
     ===================================================== */
  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  function snapshotOut() {
    return { title: titleIn.value, tagsText: tagsIn.value, html: ed.innerHTML, theme: theme };
  }

  function markDirty() {
    if (!active) return;
    dirty = true;
    setStatus('Не сохранено');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save('auto'); }, SAVE_DELAY);
  }

  function save(kind) {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!active || deleted || !hooks) return Promise.resolve(false);
    if (!dirty && kind !== 'manual') return Promise.resolve(true);
    const snap = snapshotOut();
    dirty = false;
    setStatus('Сохранение…');
    return Promise.resolve(hooks.save(snap, kind)).then(function (res) {
      if (res === 'empty') { setStatus('Пустой документ не сохраняется'); return true; }
      if (!dirty) setStatus('Сохранено · ' + ui.formatTime(Date.now()));
      return true;
    }).catch(function (err) {
      dirty = true;
      setStatus('Ошибка сохранения');
      if (!(err && err.message === 'LOCKED')) toast((err && err.user) ? err.message : 'Не удалось сохранить документ', 'error', 4000);
      return false;
    });
  }

  async function manualSave() {
    const ok = await save('manual');
    if (!ok || !active) return;
    const empty = !titleIn.value.trim() && ed.textContent.trim() === '' && !core.hasMedia(ed.innerHTML);
    toast(empty && statusEl.textContent.indexOf('Пустой') === 0 ? 'Документ пуст: сохранять нечего' : 'Документ сохранён', 'success', 1500);
  }

  async function doDelete() {
    if (!active) return;
    const ok = await ui.confirm({ title: 'Удалить документ?',
      text: 'Документ и его содержимое будут удалены без возможности восстановления.', confirmText: 'Удалить' });
    if (!ok || !active) return;
    try {
      deleted = true;
      clearTimeout(saveTimer);
      await hooks.remove();
      toast('Документ удалён');
      ui.requestClose();
    } catch (err) {
      deleted = false;
      if (!(err && err.message === 'LOCKED')) toast('Не удалось удалить документ', 'error');
    }
  }

  async function doExport(kind) {
    const E = VOID.docsExport;
    if (!E) { toast('Не загружен модуль экспорта (js/docs-export.js)', 'error'); return; }
    const snap = snapshotOut();
    const html = core.sanitize(snap.html);
    const title = snap.title.trim() || 'Документ';
    try {
      if (kind === 'txt') {
        const name = E.downloadTxt(title, html);
        toast('Файл «' + name + '» создан. Ищите его в «Загрузках».', 'success', 4500);
      } else if (kind === 'txt-share') {
        await E.shareTxt(title, html);
      } else if (kind === 'pdf') {
        toast('В окне печати выберите «Сохранить как PDF»', 'info', 5000);
        await E.printPdf(title, html);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('Export error:', err);
      toast(err && err.message === 'SHARE_UNSUPPORTED' ? 'Отправка файлов не поддерживается' : 'Не удалось выполнить экспорт', 'error', 4000);
    }
  }

  /* =====================================================
     Построение интерфейса
     ===================================================== */
  const BASE = [
    { id: 'h1', text: 'H1', title: 'Заголовок 1' }, { id: 'h2', text: 'H2', title: 'Заголовок 2' },
    { id: 'h3', text: 'H3', title: 'Заголовок 3' }, { id: 'p', text: '¶', title: 'Обычный текст' }, '|',
    { id: 'bold', text: 'B', title: 'Жирный', css: 'font-weight:700' },
    { id: 'italic', text: 'I', title: 'Курсив', css: 'font-style:italic;font-family:serif' },
    { id: 'underline', text: 'U', title: 'Подчёркнутый', css: 'text-decoration:underline' },
    { id: 'strike', text: 'S', title: 'Зачёркнутый', css: 'text-decoration:line-through' }, '|',
    { id: 'color', text: 'A', title: 'Цвет текста', css: 'border-bottom:3px solid #E5484D;line-height:1.1' },
    { id: 'hilite', text: 'Ab', title: 'Выделение цветом', css: 'background:rgba(255,214,10,.5);color:#111;padding:0 4px;border-radius:3px' },
    { id: 'size', text: 'Aa', title: 'Размер текста' }, '|',
    { id: 'ul', icon: 'dx-ul', title: 'Маркированный список' }, { id: 'ol', text: '1.', title: 'Нумерованный список' },
    { id: 'quote', text: '“', title: 'Цитата', css: 'font-size:22px;line-height:1' },
    { id: 'hr', text: '―', title: 'Горизонтальный разделитель' }, '@insert', '|',
    { id: 'align', icon: 'dx-al-l', title: 'Выравнивание' }, { id: 'link', icon: 'dx-link', title: 'Ссылка' },
    { id: 'theme', icon: 'dx-theme', title: 'Тема документа' }
  ];

  const ACTIONS = {
    h1: function () { setBlock('h1'); }, h2: function () { setBlock('h2'); }, h3: function () { setBlock('h3'); },
    p: function () { cmd('formatBlock', '<p>'); },
    bold: function () { cmd('bold'); }, italic: function () { cmd('italic'); },
    underline: function () { cmd('underline'); }, strike: function () { cmd('strikeThrough'); },
    color: function (b) { openPop(b, paletteNode('color')); },
    hilite: function (b) { openPop(b, paletteNode('hilite')); },
    size: function (b) { openPop(b, sizesNode()); },
    ul: function () { cmd('insertUnorderedList'); }, ol: function () { cmd('insertOrderedList'); },
    quote: toggleQuote, hr: function () { cmd('insertHorizontalRule'); },
    align: function (b) { openPop(b, alignNode()); },
    link: linkTool,
    theme: function (b) { openPop(b, themeNode()); }
  };

  function toolButton(t) {
    const b = el('button', { class: 'dx-t', type: 'button', 'data-tool': t.id, 'aria-label': t.title, title: t.title });
    if (t.icon) b.appendChild(ui.icon(t.icon));
    else {
      const s = el('span', { text: t.text });
      if (t.css) s.setAttribute('style', t.css);
      b.appendChild(s);
    }
    return b;
  }

  function buildTools() {
    const frag = document.createDocumentFragment();
    const add = function (t) { toolBtns[t.id] = toolButton(t); frag.appendChild(toolBtns[t.id]); };
    BASE.forEach(function (t) {
      if (t === '|') { frag.appendChild(el('div', { class: 'dx__sep' })); return; }
      if (t === '@insert') {
        let any = false;
        plugins.forEach(function (p) {
          (p.tools || []).forEach(function (pt) {
            if (!pt || !pt.id || typeof pt.run !== 'function') return;
            pluginRuns[pt.id] = pt.run;
            add(pt);
            any = true;
          });
        });
        if (!any) return;
        return;
      }
      add(t);
    });
    tools.appendChild(frag);
  }

  function build() {
    if (built) return;
    built = true;

    const backBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад' }, [ui.icon('back')]);
    statusEl = el('div', { class: 'dx__status', 'aria-live': 'polite' });
    undoBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Отменить' }, [ui.icon('dx-undo')]);
    redoBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Повторить' }, [ui.icon('dx-redo')]);
    saveBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Сохранить' }, [ui.icon('dx-save')]);
    exportBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Экспорт', 'aria-haspopup': 'menu' }, [ui.icon('dx-export')]);
    delBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Удалить документ' }, [ui.icon('dx-trash')]);
    bar = el('div', { class: 'dx__bar' }, [
      backBtn,
      el('div', { class: 'dx__head' }, [el('div', { class: 'dx__label', text: 'Документ' }), statusEl]),
      undoBtn, redoBtn, saveBtn, exportBtn, delBtn
    ]);

    tools = el('div', { class: 'dx__tools', role: 'toolbar', 'aria-label': 'Форматирование' });

    titleIn = el('input', { class: 'dx__title', type: 'text', maxlength: 200, placeholder: 'Название документа',
      autocomplete: 'off', 'aria-label': 'Название документа', enterkeyhint: 'next' });
    tagsIn = el('input', { class: 'dx__tags', type: 'text', maxlength: 400, placeholder: 'Теги через запятую',
      autocomplete: 'off', 'aria-label': 'Теги' });
    ed = el('div', { class: 'dx__ed dx-rich', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': 'Текст документа', 'data-ph': 'Начните писать…', spellcheck: 'true', autocapitalize: 'sentences' });
    scrollEl = el('div', { class: 'dx__scroll dx-theme--white' }, [el('div', { class: 'dx__page' }, [titleIn, tagsIn, ed])]);

    popBd = el('div', { class: 'dx__popbd', hidden: '' });
    pop = el('div', { class: 'dx__pop', role: 'menu', hidden: '' });
    root = el('div', { class: 'dx', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Редактор документа', hidden: '' },
      [bar, tools, scrollEl, popBd, pop]);
    document.getElementById('app').appendChild(root);
    api.ed = ed;
    buildTools();

    // Кнопки не должны отнимать фокус и выделение у редактора
    [bar, tools, pop].forEach(function (n) {
      n.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    });

    backBtn.addEventListener('click', function () { ui.requestClose(); });
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    saveBtn.addEventListener('click', manualSave);
    exportBtn.addEventListener('click', function () { openPop(exportBtn, exportNode()); });
    delBtn.addEventListener('click', doDelete);
    popBd.addEventListener('click', closePop);

    tools.addEventListener('click', function (e) {
      const b = e.target.closest('[data-tool]');
      if (!b || !active) return;
      const id = b.dataset.tool;
      closePop();
      if (Object.prototype.hasOwnProperty.call(ACTIONS, id)) ACTIONS[id](b);
      else if (Object.prototype.hasOwnProperty.call(pluginRuns, id)) {
        try { pluginRuns[id](api, b); } catch (err) { console.error('Docs tool error:', err); }
      }
    });

    titleIn.addEventListener('input', markDirty);
    tagsIn.addEventListener('input', markDirty);
    titleIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });

    ed.addEventListener('compositionstart', function () { composing = true; });
    ed.addEventListener('compositionend', function () { composing = false; scheduleRec(); });
    ed.addEventListener('input', function (e) {
      if (!active) return;
      markDirty();
      updateEmpty();
      const t = (e && e.inputType) || '';
      if (/^(insertFromPaste|insertFromDrop|deleteByCut|format)/.test(t)) {
        if (!composing) fixRoot();
        recNow();
      } else scheduleRec();
    });
    ed.addEventListener('beforeinput', function (e) {
      if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
      else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
    });
    ed.addEventListener('paste', function (e) {
      const cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      flushRec();
      const html = cd.getData('text/html');
      const text = cd.getData('text/plain');
      let ins = '';
      if (html) ins = core.sanitize(html, { strip: true });
      if ((!ins || !html) && text) ins = core.htmlFromPlain(text);
      if (!ins) return;
      const tmp = core.sanitizeNode(ins);
      if (tmp.children.length === 1 && tmp.firstElementChild.tagName === 'P') ins = tmp.firstElementChild.innerHTML;
      cmd('insertHTML', ins);
    });
    ed.addEventListener('dragover', function (e) { e.preventDefault(); });
    ed.addEventListener('drop', function (e) { e.preventDefault(); });
    ed.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('a');
      if (a) e.preventDefault();
    });
    root.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = String(e.key).toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); manualSave(); }
    });
  }

  /* =====================================================
     Открытие и закрытие
     ===================================================== */
  function open(doc, h) {
    if (active || !VOID.auth || !VOID.auth.isUnlocked()) return false;
    build();
    hooks = h || {};
    deleted = false;
    dirty = false;
    composing = false;
    savedRange = null;
    pendingSize = null;
    theme = core.THEMES.indexOf(doc.theme) >= 0 ? doc.theme : 'white';
    applyTheme();
    titleIn.value = doc.title || '';
    tagsIn.value = Array.isArray(doc.tags) ? doc.tags.join(', ') : '';
    ed.innerHTML = core.sanitize(doc.html || '');
    ensureTail();
    updateEmpty();
    hist.s = []; hist.i = -1; hist.chars = 0;
    root.hidden = false;
    active = true;
    record();
    updateUndoUi();
    renderPlugins();
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* не критично */ }
    document.addEventListener('selectionchange', onSelChange);
    scrollEl.scrollTop = 0;
    setStatus(doc.isNew ? 'Новый документ' : 'Сохранено · ' + ui.formatDateTime(doc.updatedAt));
    ui.pushOverlay(closeUI);
    if (doc.isNew) setTimeout(function () { titleIn.focus(); }, 80);
    return true;
  }

  /** Вызывается стеком оверлеев: кнопка «Назад», системный «Назад», блокировка. */
  function closeUI() {
    if (!active) return;
    clearTimeout(recTimer);
    clearTimeout(saveTimer);
    document.removeEventListener('selectionchange', onSelChange);
    const h = hooks;
    let p = Promise.resolve();
    if (!deleted && VOID.auth.isUnlocked() && dirty) p = save('close'); // снимок берётся сразу
    active = false;
    closePop();
    root.hidden = true;
    ed.textContent = '';
    titleIn.value = '';
    tagsIn.value = '';
    hist.s = []; hist.i = -1; hist.chars = 0;
    savedRange = null;
    hooks = null;
    p.then(function () { if (h && typeof h.onClosed === 'function') h.onClosed(); });
  }

  document.addEventListener('visibilitychange', function () { if (active && document.hidden && dirty) save('auto'); });
  window.addEventListener('pagehide', function () { if (active && dirty) save('auto'); });
  document.addEventListener('void:beforelock', function (e) {
    if (active && e.detail && typeof e.detail.waitUntil === 'function') e.detail.waitUntil(save('auto'));
  });

  VOID.docsEditor = {
    open: open,
    isOpen: function () { return active; },
    use: function (plugin) { if (plugin && typeof plugin === 'object') plugins.push(plugin); },
    prompt: prompt
  };
})();