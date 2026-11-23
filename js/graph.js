/* ===== VOID GRAPH — список досок и рабочее пространство (этапы B–E1) =====
   Раздел «Graph» (Ещё → Graph): список досок и карточка «Продолжить» (последняя открытая доска).
   Открытая доска занимает весь экран, системная кнопка «Назад» возвращает к списку.
   Автосохранение положения, сетки, объектов и связей: через 0,7 с после изменения, а также
   при сворачивании приложения и ПЕРЕД блокировкой. При блокировке всё расшифрованное стирается.
   В служебных настройках хранится только случайный id последней доски (личных данных в нём нет). */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  const store = VOID.graphStore;
  if (!ui || !store || !VOID.graphView) {
    console.error('VOID GRAPH: не загружены ui.js, graph-store.js или graph-view.js');
    return;
  }
  const el = ui.el;

  const NS = 'http://www.w3.org/2000/svg';
  const SAVE_DELAY = 700;
  const GRID_ORDER = ['dots', 'lines', 'none'];
  const GRID_LABELS = { dots: 'Сетка: точки', lines: 'Сетка: линии', none: 'Сетка выключена' };

  const appRoot = document.getElementById('app');
  const viewsRoot = document.getElementById('views');
  const sheet = document.getElementById('sheet');

  let boards = [];
  let loaded = false;
  let lastId = '';      // id последней открытой доски
  let ws = null;        // открытая доска: { meta, data, vp, editor, timer, dirty, deleted }
  let opening = false;
  let busyDup = false;

  function quiet(err) {
    if (!(err && err.message === 'LOCKED')) console.error('Graph error:', err);
  }

  /* ---------- Иконки (добавляем в общий набор из index.html) ---------- */
  function addSymbol(id, shapes) {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById(id)) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', id);
    sym.setAttribute('viewBox', '0 0 24 24');
    shapes.forEach(function (s) {
      const n = document.createElementNS(NS, s[0]);
      Object.keys(s[1]).forEach(function (k) { n.setAttribute(k, s[1][k]); });
      sym.appendChild(n);
    });
    defs.appendChild(sym);
  }
  addSymbol('i-graph', [
    ['circle', { cx: 6, cy: 6, r: 2.5 }], ['circle', { cx: 18, cy: 8, r: 2.5 }], ['circle', { cx: 12, cy: 18, r: 2.5 }],
    ['path', { d: 'M8.3 7l7.4.8M7.3 8.2l3.7 7.6M16.7 10.2l-3.7 5.6' }]
  ]);
  addSymbol('i-minus', [['path', { d: 'M5 12h14' }]]);
  addSymbol('i-fit', [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }]]);
  addSymbol('i-grid', [['path', { d: 'M4 4h16v16H4zM4 12h16M12 4v16' }]]);

  /* ---------- Последняя открытая доска ---------- */
  async function readLast() {
    if (!(VOID.settings && VOID.settings.read)) return;
    try {
      const s = await VOID.settings.read();
      lastId = typeof s.lastGraphBoard === 'string' ? s.lastGraphBoard : '';
    } catch (_) { lastId = ''; }
  }

  async function rememberLast(id) {
    lastId = id;
    if (!(VOID.settings && VOID.settings.update)) return;
    try { await VOID.settings.update({ lastGraphBoard: id }); } catch (err) { console.error('Last board error:', err); }
  }

  /* ---------- Раздел со списком досок ---------- */
  const view = el('section', { class: 'view', id: 'view-graph', 'data-title': 'Graph', hidden: '' });
  viewsRoot.appendChild(view);

  const newBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button' },
    [ui.icon('plus'), el('span', { text: 'Новая доска' })]);
  const continueBox = el('div', { class: 'list list--drafts', 'aria-live': 'polite' });
  const listBox = el('div', { class: 'list', 'aria-live': 'polite' });
  view.append(el('div', { class: 'toolbar' }, [newBtn]), continueBox, listBox);

  // Пункт меню «Ещё» (перед «Настройками»)
  sheet.insertBefore(
    el('button', { class: 'sheet__item', type: 'button', 'data-route': 'graph' },
      [ui.icon('graph'), el('span', { text: 'Graph' })]),
    sheet.lastElementChild);

  function renderContinue() {
    continueBox.textContent = '';
    if (!loaded || !lastId) return;
    const b = boards.find(function (x) { return x.id === lastId; });
    if (!b) return;
    const card = el('button', { class: 'list-item list-item--click list-item--draft', type: 'button', 'data-id': b.id });
    card.append(
      el('div', { class: 'card-cat', text: 'ПРОДОЛЖИТЬ' }),
      el('div', { class: 'list-item__title', text: b.title || 'Без названия' }),
      el('div', { class: 'list-item__meta', text: 'Последняя открытая доска' })
    );
    continueBox.appendChild(card);
  }

  function renderList() {
    renderContinue();
    listBox.textContent = '';
    if (!loaded) { listBox.appendChild(ui.emptyBlock('Загрузка…', '')); return; }
    if (!boards.length) {
      listBox.appendChild(ui.emptyBlock('Досок пока нет',
        'Нажмите «Новая доска», чтобы создать первое рабочее пространство.'));
      return;
    }
    boards.forEach(function (b) {
      const card = el('button', { class: 'list-item list-item--click', type: 'button', 'data-id': b.id });
      card.appendChild(el('div', { class: 'list-item__title', text: b.title || 'Без названия' }));
      if (b.description) card.appendChild(el('div', { class: 'card-snippet', text: ui.snippet(b.description, 140) }));
      card.appendChild(el('div', { class: 'list-item__meta',
        text: 'Объектов: ' + b.nodeCount + ' · изменено ' + ui.formatDateTime(b.updatedAt) }));
      listBox.appendChild(card);
    });
  }

  async function reloadBoards() {
    if (!VOID.auth.isUnlocked()) return;
    try {
      const rows = await store.listBoards();
      await readLast();
      if (!VOID.auth.isUnlocked()) return;
      boards = rows;
      loaded = true;
      renderList();
    } catch (err) {
      if (err && err.message === 'LOCKED') return;
      console.error('Graph list error:', err);
      VOID.toast('Не удалось загрузить список досок', 'error');
    }
  }

  /* ---------- Диалог «Название и описание» ---------- */
  const dlgTitle = el('h2', { class: 'modal__title' });
  const nameIn = el('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder: 'Название доски' });
  const descIn = el('textarea', { maxlength: 500, rows: 3, placeholder: 'Описание (необязательно)' });
  const dlgOk = el('button', { class: 'btn btn--primary', type: 'submit' });
  const dlgCancel = el('button', { class: 'btn', type: 'button', text: 'Отмена' });
  const dlgForm = el('form', { class: 'modal__box', novalidate: '', autocomplete: 'off' }, [
    dlgTitle,
    el('label', { class: 'field' }, [el('span', { text: 'Название' }), nameIn]),
    el('label', { class: 'field' }, [el('span', { text: 'Описание' }), descIn]),
    el('div', { class: 'modal__actions' }, [dlgCancel, dlgOk])
  ]);
  const dlg = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Доска', hidden: '' }, [dlgForm]);
  appRoot.appendChild(dlg);

  /** Возвращает Promise<{title, description}> или null, если пользователь отменил. */
  function boardForm(o) {
    return new Promise(function (resolve) {
      let result = null;
      dlgTitle.textContent = o.heading;
      dlgOk.textContent = o.confirmText;
      nameIn.value = o.title || '';
      descIn.value = o.description || '';

      const onSubmit = function (e) {
        e.preventDefault();
        result = { title: nameIn.value.trim(), description: descIn.value.trim() };
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
        resolve(result);
      });
      setTimeout(function () { nameIn.focus(); }, 60);
    });
  }

  /* ---------- Рабочее пространство ---------- */
  const backBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'К списку досок' }, [ui.icon('back')]);
  const titleEl = el('div', { class: 'gw__title' });
  const gridBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Сменить сетку' }, [ui.icon('grid')]);
  const menuBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Меню доски',
    'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [ui.icon('more')]);

  const gridEl = el('div', { class: 'gw__grid' });
  const worldEl = el('div', { class: 'gw__world' });
  const stage = el('div', { class: 'gw__stage', role: 'application', 'aria-label': 'Рабочее полотно' }, [gridEl, worldEl]);

  const zoomOutBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Уменьшить' }, [ui.icon('minus')]);
  const zoomLabel = el('button', { class: 'gw__zoom', type: 'button', 'aria-label': 'Масштаб 100%. Нажмите, чтобы вернуть 100%', text: '100%' });
  const zoomInBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Увеличить' }, [ui.icon('plus')]);
  const fitBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Показать всё содержимое' }, [ui.icon('fit')]);
  const dock = el('div', { class: 'gw__dock' }, [zoomOutBtn, zoomLabel, zoomInBtn, fitBtn]);

  const propsItem = el('button', { type: 'button', role: 'menuitem', text: 'Название и описание' });
  const dupItem = el('button', { type: 'button', role: 'menuitem', text: 'Дублировать доску' });
  const deleteItem = el('button', { type: 'button', role: 'menuitem', class: 'is-danger', text: 'Удалить доску' });
    const bgItem = el('button', { type: 'button', role: 'menuitem' });
  const menu = el('div', { class: 'gw__menu', role: 'menu', hidden: '' }, [propsItem, dupItem, bgItem, deleteItem]);
  const menuBackdrop = el('div', { class: 'gw__backdrop', hidden: '' });

  const mainEl = el('div', { class: 'gw__main' }, [stage, dock]);
  const wsEl = el('div', { class: 'gw', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Доска', hidden: '' }, [
    el('div', { class: 'gw__bar' }, [backBtn, titleEl, gridBtn, menuBtn]),
    mainEl,
    menuBackdrop, menu
  ]);
  appRoot.appendChild(wsEl);

  function openMenu() {
    menu.hidden = false;
    menuBackdrop.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    menu.hidden = true;
    menuBackdrop.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- Автосохранение ---------- */
  function sameView(a, b) {
    return Math.abs(a.cx - b.cx) < 0.01 && Math.abs(a.cy - b.cy) < 0.01 && Math.abs(a.zoom - b.zoom) < 0.001;
  }

  function scheduleSave() {
    if (!ws) return;
    ws.dirty = true;
    clearTimeout(ws.timer);
    ws.timer = setTimeout(saveNow, SAVE_DELAY);
  }

  function saveNow() {
    const cur = ws;
    if (!cur || !cur.dirty || cur.deleted || !VOID.auth.isUnlocked()) return Promise.resolve();
    clearTimeout(cur.timer);
    cur.dirty = false;
    return store.saveData(cur.data).catch(function (err) {
      cur.dirty = true;
      if (!(err && err.message === 'LOCKED')) {
        console.error('Graph save error:', err);
        VOID.toast('Не удалось сохранить доску', 'error');
      }
    });
  }

  function onViewChange(v) {
    zoomLabel.textContent = Math.round(v.zoom * 100) + '%';
    if (ws && ws.editor) ws.editor.onView(v);
    if (!ws) return;
    const next = { cx: Math.round(v.cx * 100) / 100, cy: Math.round(v.cy * 100) / 100, zoom: Math.round(v.zoom * 1000) / 1000 };
    if (sameView(ws.data.view, next)) return;
    ws.data.view = next;
    scheduleSave();
  }

  /** Границы всех объектов доски (null, если объектов нет). */
  function contentBounds() {
    if (!ws) return null;
    let b = null;
    ws.data.nodes.forEach(function (n) {
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.w) || !Number.isFinite(n.h)) return;
      if (!b) b = { minX: n.x, minY: n.y, maxX: n.x + n.w, maxY: n.y + n.h };
      else {
        b.minX = Math.min(b.minX, n.x); b.minY = Math.min(b.minY, n.y);
        b.maxX = Math.max(b.maxX, n.x + n.w); b.maxY = Math.max(b.maxY, n.y + n.h);
      }
    });
    return b;
  }

  /* ---------- Открытие и закрытие доски ---------- */
  async function openBoard(id) {
    if (ws || opening || !VOID.auth.isUnlocked()) return;
    opening = true;
    try {
      const meta = boards.find(function (b) { return b.id === id; });
      if (!meta) { VOID.toast('Доска не найдена', 'error'); return; }
      const data = await store.loadData(id);
      if (!VOID.auth.isUnlocked() || ws) return;
      mountWorkspace(meta, data);
      rememberLast(id); // фоном: запоминаем последнюю открытую доску
    } catch (err) {
      if (!(err && err.message === 'LOCKED')) {
        console.error('Graph open error:', err);
        VOID.toast('Не удалось открыть доску', 'error');
      }
    } finally {
      opening = false;
    }
  }

  function mountWorkspace(meta, data) {
    ws = { meta: meta, data: data, vp: null, editor: null, timer: null, dirty: false, deleted: false };
    titleEl.textContent = meta.title || 'Без названия';
    wsEl.hidden = false; // сначала показываем, затем измеряем размер полотна
    ws.vp = VOID.graphView.createViewport({
      stage: stage, world: worldEl, grid: gridEl, onChange: onViewChange,
      shouldPan: function (e) { return !(ws && ws.editor && ws.editor.claims(e)); },
      onTap: function (e, p) { if (ws && ws.editor) ws.editor.onBackgroundTap(e, p); }
    });
    ws.vp.setGrid(data.settings.grid, data.settings.gridSize);
        ws.vp.setView(data.view);
    applyBg();
    if (VOID.graphEditor) {
      ws.editor = VOID.graphEditor.attach({
        ws: ws, vp: ws.vp, stage: stage, world: worldEl, main: mainEl,
        titleEl: titleEl, menu: menu, closeMenu: closeMenu,
        onChange: scheduleSave, toast: VOID.toast
      });
    } else {
      console.error('VOID GRAPH: не загружен graph-editor.js');
      VOID.toast('Не загружен редактор объектов (js/graph-editor.js)', 'error', 6000);
    }
    ui.pushOverlay(closeWorkspaceUI);
  }

  /** Вызывается стеком оверлеев: кнопка «Назад», системный «Назад», блокировка. */
  function closeWorkspaceUI() {
    const cur = ws;
    ws = null;
    closeMenu();
    if (cur) {
      clearTimeout(cur.timer);
      if (cur.editor) cur.editor.detach();
      if (cur.vp) cur.vp.destroy();
      if (cur.dirty && !cur.deleted && VOID.auth.isUnlocked()) store.saveData(cur.data).catch(quiet);
    }
    wsEl.hidden = true;
    worldEl.textContent = '';
    zoomLabel.textContent = '100%';
    if (VOID.auth.isUnlocked()) {
      // Ждём окончания записи, чтобы в списке были свежие данные
      store.flush().then(reloadBoards);
    }
  }

  /* ---------- Действия ---------- */
  async function createBoard() {
    if (!VOID.auth.isUnlocked()) return;
    const res = await boardForm({ heading: 'Новая доска', title: '', description: '', confirmText: 'Создать' });
    if (!res || !VOID.auth.isUnlocked()) return;
    try {
      const meta = await store.createBoard(res);
      boards.unshift(meta);
      loaded = true;
      renderList();
      openBoard(meta.id);
    } catch (err) {
      quiet(err);
      if (!(err && err.message === 'LOCKED')) VOID.toast('Не удалось создать доску', 'error');
    }
  }

  async function editProps() {
    closeMenu();
    const cur = ws;
    if (!cur) return;
    const res = await boardForm({ heading: 'Название и описание', title: cur.meta.title,
      description: cur.meta.description, confirmText: 'Сохранить' });
    if (!res || ws !== cur) return;
    try {
      cur.meta = await store.updateBoard(cur.meta.id, res);
      titleEl.textContent = cur.meta.title || 'Без названия';
      VOID.toast('Сохранено');
    } catch (err) {
      quiet(err);
      if (!(err && err.message === 'LOCKED')) VOID.toast('Не удалось сохранить', 'error');
    }
  }

  /** Копия доски: те же объекты и связи, отдельное независимое пространство. Текущая доска остаётся открытой. */
  async function duplicateCurrent() {
    closeMenu();
    const cur = ws;
    if (!cur || busyDup) return;
    busyDup = true;
    try {
      await saveNow();      // сначала сохраняем текущие правки
      await store.flush();
      if (!VOID.auth.isUnlocked()) return;
      const src = await store.loadData(cur.meta.id);
      const title = ('Копия: ' + (cur.meta.title || 'Без названия')).slice(0, 100);
      const meta = await store.createBoard({ title: title, description: cur.meta.description });
      const next = await store.loadData(meta.id);
      next.view = src.view;
      next.settings = src.settings;
      next.nodes = src.nodes;
            next.edges = src.edges;
      next.strokes = src.strokes;
      await store.saveData(next);
      VOID.toast('Создана копия: «' + title + '»');
    } catch (err) {
      quiet(err);
      if (!(err && err.message === 'LOCKED')) VOID.toast('Не удалось создать копию', 'error');
    } finally {
      busyDup = false;
    }
  }

  async function deleteCurrent() {
    closeMenu();
    const cur = ws;
    if (!cur) return;
    const ok = await ui.confirm({
      title: 'Удалить доску?',
      text: 'Доска «' + (cur.meta.title || 'Без названия') + '» и всё её содержимое будут удалены без возможности восстановления.',
      confirmText: 'Удалить'
    });
    if (!ok || ws !== cur) return;
    try {
      clearTimeout(cur.timer);
      cur.deleted = true; // больше не сохраняем, иначе удалённая доска «воскреснет»
      await store.deleteBoard(cur.meta.id);
      if (lastId === cur.meta.id) rememberLast('');
      VOID.toast('Доска удалена');
      ui.requestClose();
    } catch (err) {
      cur.deleted = false;
      quiet(err);
      if (!(err && err.message === 'LOCKED')) VOID.toast('Не удалось удалить доску', 'error');
    }
  }

    const BG_ORDER = ['dark', 'charcoal', 'gray'];
  const BG_COLORS = { charcoal: '#2A2C30', gray: '#484B50' };
  const BG_LABELS = { dark: 'тёмный', charcoal: 'тёмно-серый', gray: 'серый' };

  function applyBg() {
    if (!ws) return;
    const mode = ws.data.settings.bg;
    if (mode && BG_COLORS[mode]) stage.style.setProperty('--gw-bg', BG_COLORS[mode]);
    else stage.style.removeProperty('--gw-bg');
    bgItem.textContent = 'Фон доски: ' + (BG_LABELS[mode] || BG_LABELS.dark);
  }

  function cycleBg() {
    if (!ws) return;
    const cur = BG_ORDER.indexOf(ws.data.settings.bg);
    ws.data.settings.bg = BG_ORDER[((cur < 0 ? 0 : cur) + 1) % BG_ORDER.length];
    applyBg();
    closeMenu();
    scheduleSave();
  }

  function cycleGrid() {
    if (!ws) return;
    const i = GRID_ORDER.indexOf(ws.data.settings.grid);
    const next = GRID_ORDER[(i + 1) % GRID_ORDER.length];
    ws.data.settings.grid = next;
    ws.vp.setGrid(next, ws.data.settings.gridSize);
    VOID.toast(GRID_LABELS[next], 'info', 1200);
    scheduleSave();
  }

  /* ---------- Обработчики ---------- */
  newBtn.addEventListener('click', createBoard);
  function onListClick(e) {
    const card = e.target.closest('[data-id]');
    if (card) openBoard(card.dataset.id);
  }
  listBox.addEventListener('click', onListClick);
  continueBox.addEventListener('click', onListClick);

  backBtn.addEventListener('click', function () { ui.requestClose(); });
    gridBtn.addEventListener('click', cycleGrid);
  bgItem.addEventListener('click', cycleBg);
  menuBtn.addEventListener('click', function () { if (menu.hidden) openMenu(); else closeMenu(); });
  menuBackdrop.addEventListener('click', closeMenu);
  propsItem.addEventListener('click', editProps);
  dupItem.addEventListener('click', duplicateCurrent);
  deleteItem.addEventListener('click', deleteCurrent);

  zoomInBtn.addEventListener('click', function () { if (ws) ws.vp.zoomBy(1.25); });
  zoomOutBtn.addEventListener('click', function () { if (ws) ws.vp.zoomBy(0.8); });
  zoomLabel.addEventListener('click', function () {
    if (!ws) return;
    const v = ws.vp.getView();
    ws.vp.animateTo({ cx: v.cx, cy: v.cy, zoom: 1 }, 200);
  });
    fitBtn.addEventListener('click', function () {
    if (ws) ws.vp.fit(ws.editor && ws.editor.bounds ? ws.editor.bounds() : contentBounds());
  });

  window.addEventListener('hashchange', function () {
    if (location.hash === '#graph') reloadBoards();
  });

  // Сворачивание приложения: сразу сохраняем
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', function () { saveNow(); });

  // Перед блокировкой ключ ещё жив: даём время дозаписать
  document.addEventListener('void:beforelock', function (e) {
    if (e.detail && typeof e.detail.waitUntil === 'function') {
      e.detail.waitUntil(Promise.resolve(saveNow()).then(function () { return store.flush(); }).catch(function () {}));
    }
  });

  // Блокировка: стираем всё расшифрованное из памяти и с экрана
  document.addEventListener('void:lock', function () {
    if (ws) {
      clearTimeout(ws.timer);
      if (ws.editor) ws.editor.detach();
      if (ws.vp) ws.vp.destroy();
    }
    ws = null;
    boards = [];
    loaded = false;
    lastId = '';
    listBox.textContent = '';
    continueBox.textContent = '';
    closeMenu();
    wsEl.hidden = true;
    dlg.hidden = true;
    worldEl.textContent = '';
    nameIn.value = '';
    descIn.value = '';
    titleEl.textContent = '';
  });

  document.addEventListener('void:unlock', reloadBoards);

  VOID.graph = { reload: reloadBoards };
})();