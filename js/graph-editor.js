/* ===== VOID GRAPH — редактор объектов (этапы C–G1) =====
   Объекты: текст, стикер, заметка, прямоугольник, круг, ромб, фото.
   Управление (подходит для пальца):
   - касание выделяет объект; перетаскивание двигает (все выделенные вместе);
   - долгое нажатие добавляет/убирает объект из выделения (мульти-выбор);
   - двойное касание или кнопка «Изменить» открывает редактор текста;
   - круглая точка в углу выделенного объекта меняет размер (у фото с сохранением пропорций);
   - кнопка «+» добавляет объект, стрелку, режим рисования или фото;
   - связи и стрелки: модуль graph-edges.js; рисование: graph-draw.js; фото: graph-images.js.
   Отмена и повтор хранятся только в памяти (до 100 шагов и общий предел по объёму) и стираются при блокировке.
   Буфер копирования тоже только в памяти (системный буфер обмена не используется).
   Весь пользовательский текст выводится через textContent. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID GRAPH: не загружен ui.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';

  const MAX_NODES = 1000;
  const MAX_TEXT = 10000;
  const MAX_TITLE = 200;
  const HISTORY_LIMIT = 100;
  const HIST_CHARS = 20000000;
  const LONG_PRESS = 450; // мс
  const DRAG_SLOP = 6;    // px
  const DOUBLE_TAP = 320; // мс
  const GC_DELAY = 2000;  // мс после открытия доски
  const IMG_RE = /^img_[0-9a-f]{32}$/;
  const FS_STEPS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96];

  const COLORS = {
    gray:   { label: 'Серый',      stroke: '#6b6b6b', fill: 'rgba(120,120,120,0.16)', solid: '#D6D6D6', ink: '#E5E5E5' },
    red:    { label: 'Красный',    stroke: '#A32632', fill: 'rgba(163,38,50,0.22)',   solid: '#E0959D', ink: '#E8737F' },
    blue:   { label: 'Синий',      stroke: '#3F6FA3', fill: 'rgba(63,111,163,0.22)',  solid: '#9CC3EC', ink: '#86B5E8' },
    green:  { label: 'Зелёный',    stroke: '#4C8A5B', fill: 'rgba(76,138,91,0.22)',   solid: '#9ED3AB', ink: '#86C896' },
    amber:  { label: 'Янтарный',   stroke: '#A8741F', fill: 'rgba(168,116,31,0.22)',  solid: '#EBCB7C', ink: '#E8BC62' },
    violet: { label: 'Фиолетовый', stroke: '#7B4FA3', fill: 'rgba(123,79,163,0.22)',  solid: '#C6AAE8', ink: '#B592E0' }
  };
  const COLOR_IDS = Object.keys(COLORS);

  const TYPES = {
    text:    { label: 'Текст',         w: 220, h: 60,  minW: 60,  minH: 30, fs: 20, color: 'gray',  ph: 'Текст' },
    sticky:  { label: 'Стикер',        w: 180, h: 180, minW: 90,  minH: 90, fs: 16, color: 'amber', ph: 'Стикер' },
    note:    { label: 'Заметка',       w: 260, h: 180, minW: 140, minH: 90, fs: 15, color: 'gray',  ph: 'Заметка' },
    rect:    { label: 'Прямоугольник', w: 200, h: 120, minW: 60,  minH: 40, fs: 16, color: 'gray',  ph: '' },
    ellipse: { label: 'Круг',          w: 180, h: 120, minW: 60,  minH: 40, fs: 16, color: 'gray',  ph: '' },
    diamond: { label: 'Ромб',          w: 180, h: 140, minW: 70,  minH: 50, fs: 16, color: 'gray',  ph: '' },
    image:   { label: 'Фото',          w: 280, h: 200, minW: 60,  minH: 40, fs: 14, color: 'gray',  ph: '' }
  };
  const ADD_ORDER = ['text', 'sticky', 'note', 'rect', 'ellipse', 'diamond'];

  let clip = [];  // буфер копирования (только в памяти)

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v, d, min, max) { return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; }
  function isShape(t) { return t === 'rect' || t === 'ellipse' || t === 'diamond'; }

  /** Приведение объекта к безопасному виду (данные могут прийти из файла или старой версии). */
  function cleanNode(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
    if (typeof r.type !== 'string' || !has(TYPES, r.type)) return null;
    const T = TYPES[r.type];
    return {
      id: r.id, type: r.type,
      x: num(r.x, 0, -1e6, 1e6), y: num(r.y, 0, -1e6, 1e6),
      w: num(r.w, T.w, 20, 4000), h: num(r.h, T.h, 20, 4000),
      z: num(r.z, 1, 0, 1e9),
      color: (typeof r.color === 'string' && has(COLORS, r.color)) ? r.color : T.color,
      text: str(r.text).slice(0, MAX_TEXT),
      title: str(r.title).slice(0, MAX_TITLE),
      fs: num(r.fs, T.fs, 8, 200),
      bold: r.bold === true,
      imgId: (typeof r.imgId === 'string' && IMG_RE.test(r.imgId)) ? r.imgId : ''
    };
  }

  /* ---------- Иконки отмены и повтора ---------- */
  function addSymbol(id, d) {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById(id)) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', id);
    sym.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    sym.appendChild(p);
    defs.appendChild(sym);
  }
  addSymbol('i-undo', 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11');
  addSymbol('i-redo', 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13');

  /* =====================================================
     Окно редактирования текста (одно на всё приложение)
     ===================================================== */
  let dlg = null, dlgForm, dlgHead, dlgTitleField, dlgTitle, dlgText, dlgCancel;

  function buildDlg() {
    if (dlg) return;
    dlgHead = el('h2', { class: 'modal__title' });
    dlgTitle = el('input', { type: 'text', maxlength: MAX_TITLE, autocomplete: 'off', placeholder: 'Заголовок' });
    dlgTitleField = el('label', { class: 'field' }, [el('span', { text: 'Заголовок' }), dlgTitle]);
    dlgText = el('textarea', { maxlength: MAX_TEXT, rows: 5, placeholder: 'Текст' });
    dlgCancel = el('button', { class: 'btn', type: 'button', text: 'Отмена' });
    const ok = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Готово' });
    dlgForm = el('form', { class: 'modal__box', novalidate: '', autocomplete: 'off' }, [
      dlgHead, dlgTitleField,
      el('label', { class: 'field' }, [el('span', { text: 'Текст' }), dlgText]),
      el('div', { class: 'modal__actions' }, [dlgCancel, ok])
    ]);
    dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Редактирование объекта', hidden: '' }, [dlgForm]);
    document.getElementById('app').appendChild(dlg);
  }

  /** Promise<{title, text}> или null, если пользователь отменил. */
  function askText(o) {
    buildDlg();
    return new Promise(function (resolve) {
      let result = null;
      dlgHead.textContent = o.heading;
      dlgTitleField.hidden = !o.withTitle;
      dlgTitle.value = o.title || '';
      dlgText.value = o.text || '';

      const onSubmit = function (e) {
        e.preventDefault();
        result = { title: dlgTitle.value.trim().slice(0, MAX_TITLE), text: dlgText.value.slice(0, MAX_TEXT) };
        ui.requestClose();
      };
      const onCancel = function () { result = null; ui.requestClose(); };
      const onBackdrop = function (e) { if (e.target === dlg) onCancel(); };

      dlgForm.addEventListener('submit', onSubmit);
      dlgCancel.addEventListener('click', onCancel);
      dlg.addEventListener('click', onBackdrop);
      dlg.hidden = false;

      ui.pushOverlay(function () {
        dlg.hidden = true;
        dlgForm.removeEventListener('submit', onSubmit);
        dlgCancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('click', onBackdrop);
        dlgTitle.value = '';
        dlgText.value = '';
        resolve(result);
      });
      setTimeout(function () { (o.withTitle && !dlgTitle.value ? dlgTitle : dlgText).focus(); }, 60);
    });
  }

  /* =====================================================
     Редактор доски
     ===================================================== */
  function attach(ctx) {
    const ws = ctx.ws;
    const data = ws.data;
    const vp = ctx.vp;
    const stage = ctx.stage;
    const world = ctx.world;
    const toast = ctx.toast || function () {};

    const nodeEls = new Map();  // id -> { el, body, title, img, ph, handle }
    const nodeMap = new Map();  // id -> объект данных
    const sel = new Set();
    const hist = { states: [], i: -1, chars: 0 };
    let act = null;             // текущее действие пальца: нажатие, перетаскивание, изменение размера
    let lastTap = null;
    let lastZoom = 0;
    let topZ = 1;
    let pasteN = 0;
    let dead = false;
    let edges = null;           // модуль связей (graph-edges.js)
    let draw = null;            // модуль рисования (graph-draw.js)

    // Очистка и проверка загруженных объектов
    const seen = new Set();
    data.nodes = (Array.isArray(data.nodes) ? data.nodes : []).map(cleanNode).filter(function (n) {
      if (!n || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    }).slice(0, MAX_NODES);
    if (!Array.isArray(data.edges)) data.edges = [];
    if (!Array.isArray(data.strokes)) data.strokes = [];
    if (!Array.isArray(data.images)) data.images = [];
    data.nodes.forEach(function (n) { topZ = Math.max(topZ, n.z); nodeMap.set(n.id, n); });

    /** Все используемые фото записываем в список images доски (нужен для очистки при удалении). */
    function syncImages() {
      data.nodes.forEach(function (n) {
        if (n.type === 'image' && n.imgId && data.images.indexOf(n.imgId) < 0) data.images.push(n.imgId);
      });
    }
    syncImages();

    const gridSize = function () { return data.settings.gridSize || 24; };
    const snapv = function (v) {
      return data.settings.snap ? Math.round(v / gridSize()) * gridSize() : Math.round(v);
    };
    const selectedNodes = function () {
      return Array.from(sel).map(function (id) { return nodeMap.get(id); }).filter(Boolean);
    };

    /* ---------- История (отмена / повтор) ---------- */
    function snapshot() { return JSON.stringify({ nodes: data.nodes, edges: data.edges, strokes: data.strokes }); }

    function pushHist() {
      const s = snapshot();
      if (hist.i >= 0 && hist.states[hist.i] === s) return false;
      for (let k = hist.i + 1; k < hist.states.length; k++) hist.chars -= hist.states[k].length;
      hist.states.length = hist.i + 1;
      hist.states.push(s);
      hist.chars += s.length;
      while (hist.states.length > 2 && (hist.states.length > HISTORY_LIMIT || hist.chars > HIST_CHARS)) {
        hist.chars -= hist.states.shift().length;
      }
      hist.i = hist.states.length - 1;
      return true;
    }

    function commit() {
      syncImages();
      if (pushHist()) ctx.onChange();
      if (edges) edges.renderAll();
      updateUndoUi();
    }

    function restore() {
      let o;
      try { o = JSON.parse(hist.states[hist.i]); } catch (_) { return; }
      data.nodes = Array.isArray(o.nodes) ? o.nodes : [];
      data.edges = Array.isArray(o.edges) ? o.edges : [];
      data.strokes = Array.isArray(o.strokes) ? o.strokes : [];
      nodeMap.clear();
      data.nodes.forEach(function (n) { nodeMap.set(n.id, n); });
      syncImages();
      renderAll();
      Array.from(sel).forEach(function (id) { if (!nodeMap.has(id)) sel.delete(id); });
      refreshSel();
      ctx.onChange();
      updateUndoUi();
    }

    function undo() { if (hist.i > 0) { hist.i--; restore(); } }
    function redo() { if (hist.i < hist.states.length - 1) { hist.i++; restore(); } }

    /* ---------- Отрисовка объектов ---------- */
    function shapeSvg(type) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'gn__bg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      let s;
      if (type === 'ellipse') {
        s = document.createElementNS(NS, 'ellipse');
        s.setAttribute('cx', '50'); s.setAttribute('cy', '50'); s.setAttribute('rx', '49'); s.setAttribute('ry', '49');
      } else if (type === 'diamond') {
        s = document.createElementNS(NS, 'polygon');
        s.setAttribute('points', '50,1 99,50 50,99 1,50');
      } else {
        s = document.createElementNS(NS, 'rect');
        s.setAttribute('x', '1'); s.setAttribute('y', '1'); s.setAttribute('width', '98'); s.setAttribute('height', '98');
        s.setAttribute('rx', '2');
      }
      s.setAttribute('class', 'gn__shape');
      s.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(s);
      return svg;
    }

    /** Подгружает фото для объекта (расшифровка идёт в очереди, по одному). */
    function loadPhoto(n) {
      const r = nodeEls.get(n.id);
      if (!r || !r.img) return;
      const imgs = VOID.graphImages;
      if (!n.imgId || !imgs) { r.ph.textContent = 'Фото недоступно'; return; }
      imgs.load(n.imgId).then(function (url) {
        if (dead || nodeEls.get(n.id) !== r) return;
        r.img.src = url;
        r.el.classList.add('has-img');
      }).catch(function (err) {
        if (dead || nodeEls.get(n.id) !== r) return;
        if (err && err.message === 'LOCKED') return;
        r.ph.textContent = 'Фото недоступно';
      });
    }

    function createEl(n) {
      const T = TYPES[n.type];
      const inner = el('div', { class: 'gn__in' });
      if (isShape(n.type)) inner.appendChild(shapeSvg(n.type));
      let title = null, body = null, img = null, ph = null;
      if (n.type === 'image') {
        img = el('img', { class: 'gn__img', alt: '', draggable: 'false' });
        ph = el('div', { class: 'gn__ph', text: 'Загрузка…' });
        inner.append(img, ph);
      } else {
        if (n.type === 'note') {
          title = el('div', { class: 'gn__t', 'data-ph': 'Заголовок' });
          inner.appendChild(title);
        }
        body = el('div', { class: 'gn__b', 'data-ph': T.ph });
        inner.appendChild(body);
      }
      const d = el('div', { class: 'gn gn--' + n.type, 'data-id': n.id }, [inner]);
      const rec = { el: d, body: body, title: title, img: img, ph: ph, handle: null };
      nodeEls.set(n.id, rec);
      paint(n);
      if (img) loadPhoto(n);
      return rec;
    }

    function moveEl(n) {
      const r = nodeEls.get(n.id);
      if (r) r.el.style.transform = 'translate(' + n.x + 'px,' + n.y + 'px)';
      if (edges) edges.nodeMoved(n.id);
    }

    function sizeEl(n) {
      const r = nodeEls.get(n.id);
      if (!r) return;
      r.el.style.width = n.w + 'px';
      r.el.style.height = n.h + 'px';
      if (edges) edges.nodeMoved(n.id);
    }

    function paint(n) {
      const r = nodeEls.get(n.id);
      if (!r) return;
      const s = r.el.style;
      const c = COLORS[n.color];
      moveEl(n);
      sizeEl(n);
      s.zIndex = String(Math.round(n.z));
      s.setProperty('--c-stroke', c.stroke);
      s.setProperty('--c-fill', c.fill);
      s.setProperty('--c-solid', c.solid);
      s.setProperty('--c-ink', c.ink);
      if (r.body) {
        r.body.textContent = n.text;
        r.body.style.fontSize = n.fs + 'px';
        r.body.style.fontWeight = n.bold ? '700' : '400';
      }
      if (r.title) {
        r.title.textContent = n.title;
        r.title.style.fontSize = Math.round(n.fs * 1.1) + 'px';
      }
    }

    function renderAll() {
      world.textContent = '';
      nodeEls.clear();
      const f = document.createDocumentFragment();
      data.nodes.forEach(function (n) { f.appendChild(createEl(n).el); });
      world.appendChild(f);
      if (edges) edges.renderAll();
      if (draw) draw.renderAll();
    }

    /* ---------- Выделение ---------- */
    function refreshSel() {
      nodeEls.forEach(function (r, id) {
        const on = sel.has(id);
        r.el.classList.toggle('sel', on);
        const want = on && sel.size === 1;
        if (want && !r.handle) {
          r.handle = el('div', { class: 'gn__h', 'aria-hidden': 'true' });
          r.el.appendChild(r.handle);
        } else if (!want && r.handle) {
          r.handle.remove();
          r.handle = null;
        }
      });
      updateBar();
    }

    function setSel(ids) {
      sel.clear();
      ids.forEach(function (id) { if (nodeMap.has(id)) sel.add(id); });
      refreshSel();
    }

    function toggleSel(id) {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      refreshSel();
    }

    /* ---------- Панель выбранного ---------- */
    const swEls = COLOR_IDS.map(function (id) {
      const b = el('button', { class: 'sw', type: 'button', 'data-color': id, 'aria-label': 'Цвет: ' + COLORS[id].label });
      b.style.background = COLORS[id].solid;
      return b;
    });
    const mk = function (a, text, cls) { return el('button', { type: 'button', 'data-act': a, class: cls || '', text: text }); };
    const editBtn = mk('edit', 'Изменить');
    const fsDown = mk('fs-', 'A−');
    const fsUp = mk('fs+', 'A+');
    const boldBtn = mk('bold', 'B');
    const copyBtn = mk('copy', 'Копия');
    const dupBtn = mk('dup', 'Дубль');
    const frontBtn = mk('front', 'Наверх');
    const delBtn = mk('del', 'Удалить', 'is-danger');
    const bar = el('div', { class: 'gw__sel', hidden: '', role: 'toolbar', 'aria-label': 'Свойства объекта' },
      swEls.concat([el('div', { class: 'sep' }), editBtn, fsDown, fsUp, boldBtn, copyBtn, dupBtn, frontBtn, delBtn]));

    function updateBar() {
      const list = selectedNodes();
      bar.hidden = list.length === 0;
      if (edges) edges.onSelection();
      editBtn.hidden = !(list.length === 1 && list[0].type !== 'image');
      const cols = new Set(list.map(function (n) { return n.color; }));
      swEls.forEach(function (s) { s.classList.toggle('on', cols.size === 1 && cols.has(s.dataset.color)); });
      boldBtn.classList.toggle('is-on', list.length > 0 && list.every(function (n) { return n.bold; }));
    }

    function applySel(fn) {
      const list = selectedNodes();
      if (!list.length) return;
      list.forEach(function (n) { fn(n); paint(n); });
      commit();
    }

    function stepFs(n, dir) {
      if (dir > 0) {
        n.fs = FS_STEPS.find(function (s) { return s > n.fs; }) || FS_STEPS[FS_STEPS.length - 1];
      } else {
        n.fs = FS_STEPS.slice().reverse().find(function (s) { return s < n.fs; }) || FS_STEPS[0];
      }
    }

    function bringFront() {
      const list = selectedNodes().sort(function (a, b) { return a.z - b.z; });
      list.forEach(function (n) { n.z = ++topZ; });
      applySel(function () {});
    }

    function deleteSel() {
      if (!sel.size) return;
      const ids = new Set(sel);
      // Привязанные стрелки не пропадают: их концы становятся свободными (связи между удаляемыми исчезают)
      if (edges) edges.detachNodes(Array.from(ids));
      data.nodes = data.nodes.filter(function (n) { return !ids.has(n.id); });
      ids.forEach(function (id) {
        const r = nodeEls.get(id);
        if (r) r.el.remove();
        nodeEls.delete(id);
        nodeMap.delete(id);
      });
      sel.clear();
      refreshSel();
      commit();
      toast('Удалено: ' + ids.size + ' (можно отменить)', 'info', 1800);
    }

    /* ---------- Добавление, копирование ---------- */
    function addMany(list) {
      list.forEach(function (n) {
        data.nodes.push(n);
        nodeMap.set(n.id, n);
        world.appendChild(createEl(n).el);
      });
      setSel(list.map(function (n) { return n.id; }));
      commit();
    }

    function addNode(type) {
      if (data.nodes.length >= MAX_NODES) { toast('Слишком много объектов на доске', 'error'); return; }
      const T = TYPES[type];
      const v = vp.getView();
      let x = snapv(v.cx - T.w / 2);
      let y = snapv(v.cy - T.h / 2);
      let guard = 0;
      while (guard++ < 12 && data.nodes.some(function (n) { return n.x === x && n.y === y; })) { x += 24; y += 24; }
      const n = { id: VOID.crypto.randomId(), type: type, x: x, y: y, w: T.w, h: T.h, z: ++topZ,
        color: T.color, text: '', title: '', fs: T.fs, bold: false, imgId: '' };
      addMany([n]);
      openEdit(n.id); // сразу предлагаем ввести текст
    }

    /** Добавление фото. Выбор файла вызывается сразу в обработчике нажатия (требование браузера). */
    function addPhoto() {
      const imgs = VOID.graphImages;
      if (!imgs) { toast('Не загружен модуль фото (js/graph-images.js)', 'error', 5000); return; }
      if (data.nodes.length >= MAX_NODES) { toast('Слишком много объектов на доске', 'error'); return; }
      imgs.choose().then(function (file) {
        if (!file || dead) return null;
        toast('Обработка фото…', 'info', 1500);
        return imgs.add(file).then(function (res) {
          if (!res) return;
          if (dead) { // доску закрыли, пока шла обработка: фото никому не нужно
            if (VOID.graphStore && VOID.graphStore.releaseImages) VOID.graphStore.releaseImages([res.id], data.id).catch(function () {});
            return;
          }
          let w = 280;
          let h = Math.round(w * res.h / res.w);
          if (h > 520) { w = Math.max(60, Math.round(w * 520 / h)); h = 520; }
          h = Math.max(TYPES.image.minH, h);
          const v = vp.getView();
          const n = { id: VOID.crypto.randomId(), type: 'image', x: snapv(v.cx - w / 2), y: snapv(v.cy - h / 2),
            w: w, h: h, z: ++topZ, color: 'gray', text: '', title: '', fs: 14, bold: false, imgId: res.id };
          addMany([n]);
        });
      }).catch(function (err) {
        if (dead || (err && err.message === 'LOCKED')) return;
        if (err && err.user) toast(err.message, 'error', 4500);
        else { console.error('Photo error:', err); toast('Не удалось добавить фото', 'error', 4000); }
      });
    }

    function cloneInto(source, offset) {
      if (!source.length) return;
      if (data.nodes.length + source.length > MAX_NODES) { toast('Слишком много объектов на доске', 'error'); return; }
      const created = source.map(function (c) {
        const n = cleanNode(Object.assign({}, c, { id: VOID.crypto.randomId() }));
        if (!n) return null;
        n.x += offset; n.y += offset; n.z = ++topZ;
        return n;
      }).filter(Boolean);
      addMany(created);
    }

    function copySel() {
      const list = selectedNodes();
      if (!list.length) return;
      clip = list.map(function (n) { return JSON.parse(JSON.stringify(n)); });
      pasteN = 0;
      updatePal();
      toast('Скопировано: ' + clip.length, 'info', 1200);
    }

    function pasteClip() {
      if (!clip.length) return;
      pasteN++;
      cloneInto(clip, 24 * pasteN);
    }

    function duplicateSel() {
      cloneInto(selectedNodes().map(function (n) { return JSON.parse(JSON.stringify(n)); }), 24);
    }

    function selectAll() { setSel(data.nodes.map(function (n) { return n.id; })); }

    function openEdit(id) {
      const n = nodeMap.get(id);
      if (!n || n.type === 'image') return;
      askText({ heading: TYPES[n.type].label, withTitle: n.type === 'note', title: n.title, text: n.text })
        .then(function (res) {
          if (!res || dead) return;
          const cur = nodeMap.get(id);
          if (!cur) return;
          cur.text = res.text;
          if (cur.type === 'note') cur.title = res.title;
          paint(cur);
          commit();
        });
    }

    bar.addEventListener('click', function (e) {
      const sw = e.target.closest('[data-color]');
      if (sw) {
        const c = sw.dataset.color;
        if (has(COLORS, c)) applySel(function (n) { n.color = c; });
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      switch (b.dataset.act) {
        case 'edit': { const l = selectedNodes(); if (l.length === 1) openEdit(l[0].id); break; }
        case 'fs-': applySel(function (n) { stepFs(n, -1); }); break;
        case 'fs+': applySel(function (n) { stepFs(n, 1); }); break;
        case 'bold': {
          const all = selectedNodes().every(function (n) { return n.bold; });
          applySel(function (n) { n.bold = !all; });
          break;
        }
        case 'copy': copySel(); break;
        case 'dup': duplicateSel(); break;
        case 'front': bringFront(); break;
        case 'del': deleteSel(); break;
        default: break;
      }
    });

    /* ---------- Кнопка «+» и палитра ---------- */
    const fab = el('button', { class: 'gw__fab', type: 'button', 'aria-label': 'Добавить объект',
      'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [ui.icon('plus')]);
    const palBtns = ADD_ORDER.map(function (t) {
      return el('button', { type: 'button', role: 'menuitem', 'data-add': t, text: TYPES[t].label });
    });
    const arrowBtn = el('button', { type: 'button', role: 'menuitem', 'data-tool': 'arrow', text: 'Стрелка' });
    const drawBtn = el('button', { type: 'button', role: 'menuitem', 'data-tool': 'draw', text: 'Рисование' });
    const photoBtn = el('button', { type: 'button', role: 'menuitem', 'data-photo': '1', text: 'Фото' });
    const pasteBtn = el('button', { type: 'button', role: 'menuitem', 'data-act': 'paste', text: 'Вставить' });
    const allBtn = el('button', { type: 'button', role: 'menuitem', 'data-act': 'all', text: 'Выбрать всё' });
    const pal = el('div', { class: 'gw__pal', role: 'menu', hidden: '' },
      palBtns.concat([arrowBtn, drawBtn, photoBtn, pasteBtn, allBtn]));
    const palBd = el('div', { class: 'gw__palbd', hidden: '' });

    function updatePal() { pasteBtn.hidden = clip.length === 0; }
    function openPal() { updatePal(); pal.hidden = false; palBd.hidden = false; fab.setAttribute('aria-expanded', 'true'); }
    function closePal() { pal.hidden = true; palBd.hidden = true; fab.setAttribute('aria-expanded', 'false'); }

    fab.addEventListener('click', function () { if (pal.hidden) openPal(); else closePal(); });
    palBd.addEventListener('click', closePal);
    pal.addEventListener('click', function (e) {
      const tool = e.target.closest('[data-tool]');
      if (tool) {
        closePal();
        if (tool.dataset.tool === 'arrow') {
          if (edges) edges.addFree(); else toast('Не загружен модуль связей (js/graph-edges.js)', 'error', 4000);
        } else if (draw) draw.enter();
        else toast('Не загружен модуль рисования (js/graph-draw.js)', 'error', 4000);
        return;
      }
      if (e.target.closest('[data-photo]')) { closePal(); addPhoto(); return; }
      const add = e.target.closest('[data-add]');
      if (add && has(TYPES, add.dataset.add)) { closePal(); addNode(add.dataset.add); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      closePal();
      if (b.dataset.act === 'paste') pasteClip();
      else if (b.dataset.act === 'all') selectAll();
    });

    /* ---------- Отмена и повтор в верхней панели ---------- */
    const undoBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Отменить' }, [ui.icon('undo')]);
    const redoBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Повторить' }, [ui.icon('redo')]);
    function updateUndoUi() {
      undoBtn.disabled = hist.i <= 0;
      redoBtn.disabled = hist.i >= hist.states.length - 1;
    }
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    ctx.titleEl.after(undoBtn, redoBtn);

    /* ---------- Привязка к сетке (пункт в меню доски) ---------- */
    const snapItem = el('button', { type: 'button', role: 'menuitem' });
    function snapLabel() { snapItem.textContent = 'Привязка к сетке: ' + (data.settings.snap ? 'вкл' : 'выкл'); }
    snapItem.addEventListener('click', function () {
      data.settings.snap = !data.settings.snap;
      snapLabel();
      ctx.closeMenu();
      ctx.onChange();
      toast('Привязка к сетке: ' + (data.settings.snap ? 'включена' : 'выключена'), 'info', 1200);
    });
    ctx.menu.insertBefore(snapItem, ctx.menu.firstChild);

    /* ---------- Жесты над объектами ---------- */
    function onDown(e) {
      if (dead) return;
      if (draw && draw.isActive()) return; // в режиме рисования объекты не реагируют на касания
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const t = e.target;
      if (!t || !t.closest) return;
      const nodeEl = t.closest('.gn');
      if (!nodeEl) return;
      if (t.closest('.gn__c')) return; // точки подключения обрабатывает graph-edges.js
      if (act) { finishAct(true); return; } // второй палец: завершаем начатое
      const id = nodeEl.dataset.id;
      const n = nodeMap.get(id);
      if (!n) return;
      closePal();
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }

      if (t.closest('.gn__h')) {
        act = { kind: 'resize', pid: e.pointerId, id: id, sx: e.clientX, sy: e.clientY, w: n.w, h: n.h, changed: false };
        return;
      }
      const pre = sel.has(id);
      if (!pre) setSel([id]);
      act = { kind: 'press', pid: e.pointerId, id: id, sx: e.clientX, sy: e.clientY, pre: pre, starts: null, long: false };
      act.timer = setTimeout(function () {
        if (act && act.kind === 'press' && !act.starts) {
          act.long = true;
          toggleSel(act.id);
          if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* не критично */ } }
        }
      }, LONG_PRESS);
    }

    function onMove(e) {
      if (!act || e.pointerId !== act.pid) return;
      const z = vp.getView().zoom;
      if (act.kind === 'press') {
        if (act.long) return;
        if (!act.starts) {
          if (Math.hypot(e.clientX - act.sx, e.clientY - act.sy) < DRAG_SLOP) return;
          clearTimeout(act.timer);
          act.starts = new Map();
          sel.forEach(function (id) {
            const n = nodeMap.get(id);
            if (n) act.starts.set(id, { x: n.x, y: n.y });
          });
          if (!act.starts.has(act.id)) { act.starts = null; return; }
        }
        const dx = (e.clientX - act.sx) / z;
        const dy = (e.clientY - act.sy) / z;
        const p = act.starts.get(act.id);
        const ox = snapv(p.x + dx) - p.x;
        const oy = snapv(p.y + dy) - p.y;
        act.starts.forEach(function (s, id) {
          const n = nodeMap.get(id);
          if (!n) return;
          n.x = s.x + ox;
          n.y = s.y + oy;
          moveEl(n);
        });
      } else if (act.kind === 'resize') {
        const n = nodeMap.get(act.id);
        if (!n) return;
        const T = TYPES[n.type];
        const nw = Math.max(T.minW, snapv(act.w + (e.clientX - act.sx) / z));
        // Фото меняют размер с сохранением пропорций
        const nh = n.type === 'image'
          ? Math.max(T.minH, Math.round(nw * act.h / act.w))
          : Math.max(T.minH, snapv(act.h + (e.clientY - act.sy) / z));
        if (nw !== n.w || nh !== n.h) {
          n.w = nw; n.h = nh;
          sizeEl(n);
          act.changed = true;
        }
      }
    }

    function finishAct(ok) {
      const a = act;
      act = null;
      if (!a) return;
      clearTimeout(a.timer);
      try { stage.releasePointerCapture(a.pid); } catch (_) { /* уже освобождён */ }
      if (a.kind === 'resize') { if (a.changed) commit(); return; }
      if (a.starts) { commit(); return; } // перетаскивание завершено
      if (a.long || !ok) return;
      // Обычное касание
      if (a.pre && sel.size > 1) setSel([a.id]);
      const now = performance.now();
      if (lastTap && lastTap.id === a.id && now - lastTap.t < DOUBLE_TAP) {
        lastTap = null;
        openEdit(a.id);
      } else {
        lastTap = { id: a.id, t: now };
      }
    }

    function onUp(e) {
      if (!act || e.pointerId !== act.pid) return;
      finishAct(e.type === 'pointerup');
    }

    /* ---------- Клавиатура (для компьютера) ---------- */
    function onKey(e) {
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const m = document.getElementById('modal');
      if ((m && !m.hidden) || (dlg && !dlg.hidden)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = String(e.key).toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && k === 'y') { e.preventDefault(); redo(); }
      else if (mod && k === 'd') { e.preventDefault(); duplicateSel(); }
      else if (mod && k === 'c') { copySel(); }
      else if (mod && k === 'v') { pasteClip(); }
      else if (mod && k === 'a') { e.preventDefault(); selectAll(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); deleteSel(); }
    }

    /* ---------- Очистка неиспользуемых фото ----------
       Выполняется один раз после открытия доски (история пуста, отмена вернуть фото не потребует).
       Фото, на которые ссылается другая доска, не удаляются (проверяет graph-store.js). */
    function gcImages() {
      const store = VOID.graphStore;
      if (dead || !store || !store.releaseImages) return;
      const used = new Set();
      data.nodes.forEach(function (n) { if (n.type === 'image' && n.imgId) used.add(n.imgId); });
      const orphans = data.images.filter(function (id) { return !used.has(id); });
      if (!orphans.length) return;
      store.releaseImages(orphans, data.id).then(function () {
        if (dead) return;
        const still = new Set();
        data.nodes.forEach(function (n) { if (n.type === 'image' && n.imgId) still.add(n.imgId); });
        const before = data.images.length;
        data.images = data.images.filter(function (id) { return still.has(id); });
        if (data.images.length !== before) ctx.onChange();
      }).catch(function (err) {
        if (!(err && err.message === 'LOCKED')) console.error('Image GC error:', err);
      });
    }

    stage.addEventListener('pointerdown', onDown, true);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKey);

    /* ---------- Запуск ---------- */
    ctx.main.append(bar, palBd, pal, fab);
    edges = VOID.graphEdges ? VOID.graphEdges.attach({
      data: data, world: world, stage: stage, vp: vp, main: ctx.main, bar: bar,
      nodeMap: nodeMap, nodeEls: nodeEls,
      getSel: function () { return Array.from(sel); },
      setSel: setSel, commit: commit, toast: toast, askText: askText, snap: snapv
    }) : null;
    if (!edges) console.error('VOID GRAPH: не загружен graph-edges.js, связи недоступны');
    draw = VOID.graphDraw ? VOID.graphDraw.attach({
      data: data, world: world, stage: stage, main: ctx.main, vp: vp,
      commit: commit, toast: toast, confirm: ui.confirm,
      onEnter: function () { setSel([]); if (edges) edges.deselect(); closePal(); }
    }) : null;
    if (!draw) console.error('VOID GRAPH: не загружен graph-draw.js, рисование недоступно');
    renderAll();
    pushHist();
    updateUndoUi();
    snapLabel();
    updatePal();
    refreshSel();
    if (vp.getView) world.style.setProperty('--inv', String(1 / vp.getView().zoom));
    setTimeout(gcImages, GC_DELAY);

    function detach() {
      dead = true;
      if (act) clearTimeout(act.timer);
      act = null;
      stage.removeEventListener('pointerdown', onDown, true);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      document.removeEventListener('keydown', onKey);
      [bar, palBd, pal, fab, undoBtn, redoBtn, snapItem].forEach(function (n) { n.remove(); });
      if (draw) draw.detach();
      if (edges) edges.detach();
      if (VOID.graphImages) VOID.graphImages.revokeAll(); // расшифрованные фото не остаются в памяти
      world.textContent = '';
      world.style.removeProperty('--inv');
      nodeEls.clear();
      nodeMap.clear();
      sel.clear();
      hist.states = [];
      hist.i = -1;
      hist.chars = 0;
    }

    /** Границы всего содержимого: объекты, свободные концы стрелок, рисунки. */
    function bounds() {
      let b = null;
      const add = function (x0, y0, x1, y1) {
        if (!b) b = { minX: x0, minY: y0, maxX: x1, maxY: y1 };
        else {
          b.minX = Math.min(b.minX, x0); b.minY = Math.min(b.minY, y0);
          b.maxX = Math.max(b.maxX, x1); b.maxY = Math.max(b.maxY, y1);
        }
      };
      data.nodes.forEach(function (n) { add(n.x, n.y, n.x + n.w, n.y + n.h); });
      data.edges.forEach(function (e) {
        [e.from, e.to].forEach(function (end) {
          if (end && !end.node && Number.isFinite(end.x) && Number.isFinite(end.y)) add(end.x, end.y, end.x, end.y);
        });
      });
      if (draw) { const d = draw.bounds(); if (d) add(d.minX, d.minY, d.maxX, d.maxY); }
      return b;
    }

    return {
      claims: function (e) {
        if (draw && draw.isActive()) return false;
        const t = e.target;
        if (t && t.closest && t.closest('.gn')) return true;
        return !!(edges && edges.claims(e));
      },
      onBackgroundTap: function () {
        if (sel.size) setSel([]);
        closePal();
        if (edges) edges.onBackgroundTap();
      },
      onView: function (v) {
        if (v.zoom !== lastZoom) {
          lastZoom = v.zoom;
          world.style.setProperty('--inv', String(1 / v.zoom)); // ручки и рамка не меняют экранный размер
        }
      },
      bounds: bounds,
      detach: detach
    };
  }

  // Блокировка: буфер копирования стираем
  document.addEventListener('void:lock', function () { clip = []; });

  VOID.graphEditor = { attach: attach };
})();