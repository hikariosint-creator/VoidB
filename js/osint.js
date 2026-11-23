/* ===== VOID OSINT FRAMEWORK: интерфейс =====
   Каталог ресурсов: поиск, категории, фильтры, сортировка, два вида (список и компактная сетка).
   Каталог НИЧЕГО не запускает и не отправляет: карточки только ведут по ссылкам на оригинальные сайты
   и репозитории (https). Данные берутся из js/osint-data*.js (VOID.osintData). Весь текст выводится через textContent.
   В служебных настройках хранятся только: отметки «проверено мной» (osintChecked) и выбранный вид (osintView).
   Запросы поиска нигде не сохраняются и стираются при блокировке. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID OSINT: не загружен ui.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';

  const TYPES = ['WEB', 'CLI', 'DESKTOP'];
  const STATUS_NAME = { verified: 'Verified', unverified: 'Unverified', unavailable: 'Unavailable' };
  const URL_RE = /^https:\/\/[^\s"'<>]+$/i;
  const FORMS = ['ресурс', 'ресурса', 'ресурсов'];

  /* ---------- Иконки (в стиле Lucide, встроенные: без внешних загрузок) ---------- */
  const ICONS = {
    'of-compass': [['circle', { cx: 12, cy: 12, r: 10 }], ['polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' }]],
    'of-user': [['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }], ['circle', { cx: 12, cy: 7, r: 4 }]],
    'of-mail': [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], ['path', { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' }]],
    'of-globe': [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }], ['path', { d: 'M2 12h20' }]],
    'of-network': [['rect', { x: 16, y: 16, width: 6, height: 6, rx: 1 }], ['rect', { x: 2, y: 16, width: 6, height: 6, rx: 1 }],
      ['rect', { x: 9, y: 2, width: 6, height: 6, rx: 1 }], ['path', { d: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' }], ['path', { d: 'M12 12V8' }]],
    'of-share': [['circle', { cx: 18, cy: 5, r: 3 }], ['circle', { cx: 6, cy: 12, r: 3 }], ['circle', { cx: 18, cy: 19, r: 3 }],
      ['path', { d: 'M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98' }]],
    'of-image': [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ['circle', { cx: 9, cy: 9, r: 2 }], ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }]],
    'of-pin': [['path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z' }], ['circle', { cx: 12, cy: 10, r: 3 }]],
    'of-archive': [['rect', { x: 2, y: 3, width: 20, height: 5, rx: 1 }], ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }], ['path', { d: 'M10 12h4' }]],
    'of-file': [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
      ['path', { d: 'M10 9H8M16 13H8M16 17H8' }]],
    'of-landmark': [['path', { d: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7' }], ['polygon', { points: '12 2 20 7 4 7' }]],
    'of-search': [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
    'of-wrench': [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
    'of-all': [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }]],
    'of-ext': [['path', { d: 'M15 3h6v6' }], ['path', { d: 'M10 14 21 3' }], ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]],
    'of-check': [['path', { d: 'M20 6 9 17l-5-5' }]],
    'of-x': [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]]
  };

  (function addIcons() {
    const defs = document.querySelector('svg defs');
    if (!defs) return;
    Object.keys(ICONS).forEach(function (id) {
      if (document.getElementById('i-' + id)) return;
      const sym = document.createElementNS(NS, 'symbol');
      sym.setAttribute('id', 'i-' + id);
      sym.setAttribute('viewBox', '0 0 24 24');
      ICONS[id].forEach(function (s) {
        const n = document.createElementNS(NS, s[0]);
        Object.keys(s[1]).forEach(function (k) { n.setAttribute(k, s[1][k]); });
        sym.appendChild(n);
      });
      defs.appendChild(sym);
    });
  })();

  function ic(name) {
    const n = ui.icon(name);
    n.classList.add('of-i');
    return n;
  }

  /* ---------- Каталог: проверка данных ---------- */
  const D = VOID.osintData && typeof VOID.osintData === 'object' ? VOID.osintData : { categories: [], tools: [] };
  const str = function (v) { return typeof v === 'string' ? v : ''; };
  const url = function (v) { return typeof v === 'string' && v.length < 300 && URL_RE.test(v) ? v : ''; };
  const fold = function (s) { return String(s).toLowerCase().replace(/ё/g, 'е'); };
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  const cats = (Array.isArray(D.categories) ? D.categories : []).filter(function (c) {
    return c && typeof c.id === 'string' && c.id && str(c.name);
  }).map(function (c) {
    return { id: c.id, name: str(c.name), short: str(c.short) || str(c.name),
      icon: ICONS[c.icon] ? c.icon : 'of-all', desc: str(c.desc) };
  });
  const catById = new Map(cats.map(function (c) { return [c.id, c]; }));

  const tools = [];
  const byId = new Map();
  (Array.isArray(D.tools) ? D.tools : []).forEach(function (r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || byId.has(r.id)) return;
    if (!catById.has(r.cat) || TYPES.indexOf(r.type) < 0 || !str(r.name) || !str(r.desc)) return;
    const t = {
      id: r.id, name: str(r.name), cat: r.cat, type: r.type, install: r.install === true,
      desc: str(r.desc), note: str(r.note), site: url(r.site), repo: url(r.repo),
      tags: (Array.isArray(r.tags) ? r.tags : []).filter(function (x) { return typeof x === 'string' && x; }).slice(0, 12),
      status: has(STATUS_NAME, r.status) ? r.status : 'unverified'
    };
    if (!t.site && !t.repo) return; // ресурс без оригинальной ссылки в каталог не попадает
    t.hay = fold([t.name, t.desc, t.tags.join(' ')].join('\n'));
    tools.push(t);
    byId.set(t.id, t);
  });

  /* ---------- Состояние ---------- */
  const filters = { q: '', cat: '', type: '', install: '', status: '', sort: 'name-asc' };
  let marks = {};        // id -> время, когда пользователь отметил ссылку проверенной
  let viewMode = 'list'; // 'list' (подробные карточки) или 'grid' (компактные плитки)
  let detailId = '';

  function effStatus(t) { return marks[t.id] ? 'verified' : t.status; }

  function plural(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return FORMS[2];
    if (b > 1 && b < 5) return FORMS[1];
    if (b === 1) return FORMS[0];
    return FORMS[2];
  }

  function filtersActive() {
    return !!(filters.q.trim() || filters.cat || filters.type || filters.install || filters.status);
  }

  function visible() {
    const tokens = fold(filters.q).split(/\s+/).map(function (k) { return k.replace(/^#+/, ''); }).filter(Boolean);
    const list = tools.filter(function (t) {
      if (filters.cat && t.cat !== filters.cat) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.install === 'yes' && !t.install) return false;
      if (filters.install === 'no' && t.install) return false;
      if (filters.status && effStatus(t) !== filters.status) return false;
      return tokens.every(function (k) { return t.hay.indexOf(k) >= 0; });
    });
    const dir = filters.sort === 'name-desc' ? -1 : 1;
    list.sort(function (a, b) { return dir * a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }); });
    return list;
  }

  /* ---------- Настройки пользователя (отметки и вид) ---------- */
  function cleanMarks(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) { if (byId.has(k) && Number.isFinite(raw[k])) out[k] = raw[k]; });
    }
    return out;
  }

  function loadPrefs() {
    if (!(VOID.settings && VOID.settings.read)) return Promise.resolve();
    return VOID.settings.read().then(function (s) {
      marks = cleanMarks(s && s.osintChecked);
      if (s && (s.osintView === 'grid' || s.osintView === 'list')) viewMode = s.osintView;
    }).catch(function () { marks = {}; });
  }

  function savePref(patch) {
    if (!(VOID.settings && VOID.settings.update)) return;
    VOID.settings.update(patch).catch(function (err) {
      console.error('OSINT settings save error:', err);
      if (VOID.toast) VOID.toast('Не удалось сохранить настройку', 'error');
    });
  }

  function toggleMark(id) {
    if (!byId.has(id)) return;
    if (marks[id]) delete marks[id]; else marks[id] = Date.now();
    savePref({ osintChecked: Object.assign({}, marks) });
    renderList();
    if (detailId) renderDetail();
    if (VOID.toast) VOID.toast(marks[id] ? 'Отмечено как проверенное (только на этом устройстве)' : 'Отметка снята', 'info', 1800);
  }

  /* ---------- Раздел ---------- */
  const viewsRoot = document.getElementById('views');
  const sheet = document.getElementById('sheet');
  const view = el('section', { class: 'view', id: 'view-osint', 'data-title': 'OSINT Framework', hidden: '' });
  viewsRoot.appendChild(view);

  if (sheet) {
    sheet.insertBefore(
      el('button', { class: 'sheet__item', type: 'button', 'data-route': 'osint' },
        [ui.icon('of-compass'), el('span', { text: 'OSINT Framework' })]),
      sheet.lastElementChild);
  }

  const searchInput = el('input', { class: 'input', type: 'search', maxlength: 100, autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', placeholder: 'Поиск: название, описание, тег', 'aria-label': 'Поиск по каталогу' });

  const chipEls = new Map();
  const chipBox = el('div', { class: 'of-chips', role: 'group', 'aria-label': 'Категории' });
  function addChip(id, label, icon, count) {
    const b = el('button', { class: 'of-chip', type: 'button', 'data-cat': id, 'aria-pressed': 'false' },
      [ic(icon), el('span', { text: label }), el('b', { text: String(count) })]);
    chipEls.set(id, b);
    chipBox.appendChild(b);
  }
  addChip('', 'Все', 'of-all', tools.length);
  cats.forEach(function (c) {
    addChip(c.id, c.short, c.icon, tools.filter(function (t) { return t.cat === c.id; }).length);
  });
  const catDesc = el('p', { class: 'of-catdesc', 'aria-live': 'polite' });

  function sel(label, opts) {
    const s = el('select', { class: 'select', 'aria-label': label });
    opts.forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1] })); });
    return s;
  }
  const typeSel = sel('Тип', [['', 'Все типы'], ['WEB', 'WEB'], ['CLI', 'CLI'], ['DESKTOP', 'DESKTOP']]);
  const instSel = sel('Установка', [['', 'Любая установка'], ['no', 'Не требуется'], ['yes', 'Требуется']]);
  const statSel = sel('Статус', [['', 'Любой статус'], ['verified', 'Verified'], ['unverified', 'Unverified'], ['unavailable', 'Unavailable']]);
  const sortSel = sel('Сортировка', [['name-asc', 'По названию А–Я'], ['name-desc', 'По названию Я–А']]);
  const resetBtn = el('button', { class: 'btn btn--ghost btn--small of-reset', type: 'button', disabled: '' },
    [ic('of-x'), el('span', { text: 'Сбросить фильтры' })]);

  // Переключатель вида: подробный список или компактные плитки
  const listTab = el('button', { class: 'tab', type: 'button', role: 'tab', 'data-view': 'list', text: 'Список' });
  const gridTab = el('button', { class: 'tab', type: 'button', role: 'tab', 'data-view': 'grid', text: 'Компактно' });
  const viewTabs = el('div', { class: 'tabs of-views', role: 'tablist', 'aria-label': 'Вид каталога' }, [listTab, gridTab]);

  const countEl = el('div', { class: 'of-count', 'aria-live': 'polite' });
  const listBox = el('div', { class: 'list' });
  const foot = el('p', { class: 'of-foot',
    text: 'Каталог не запускает инструменты и не отправляет запросы: он только открывает оригинальные сайты и репозитории по вашему нажатию. ' +
          'Статус Unverified значит, что адрес внесён по известным сведениям, но в приложении его не проверяли. ' +
          'Откройте ссылку и, если это оригинальный проект, нажмите «Отметить: ссылка проверена мной»: отметка хранится только на этом устройстве. ' +
          'Каталог предназначен для законного изучения открытых источников, обучения и защитной работы. ' +
          'В него не входят инструменты для подбора паролей, взлома, слежки, доксинга и работы с утёкшими приватными данными.' });

  view.append(
    el('h1', { class: 'of-title', text: 'VOID OSINT FRAMEWORK' }),
    el('p', { class: 'of-lead',
      text: 'Каталог инструментов, сервисов и открытых ресурсов для исследования открытых источников. Выберите направление и откройте оригинальный сайт или репозиторий инструмента.' }),
    el('div', { class: 'toolbar' }, [
      searchInput, chipBox, catDesc,
      el('div', { class: 'toolbar__row' }, [typeSel, instSel, statSel, sortSel]),
      viewTabs,
      resetBtn
    ]),
    countEl, listBox, foot);

  /* ---------- Карточка (подробная) ---------- */
  function link(href, label) {
    return el('a', { class: 'btn btn--small of-link', href: href, target: '_blank', rel: 'noopener noreferrer' },
      [ic('of-ext'), el('span', { text: label })]);
  }

  function kv(label, valueNode) {
    return [el('dt', { text: label }), el('dd', {}, [valueNode])];
  }

  function buildCard(t) {
    const eff = effStatus(t);
    const mine = !!marks[t.id];
    const stText = STATUS_NAME[eff] + (mine ? ' · проверено вами ' + ui.formatDate(marks[t.id]) : '');
    const source = t.site && t.repo ? 'Сайт и GitHub' : t.repo ? 'GitHub' : 'Официальный сайт';
    const card = el('article', { class: 'list-item of-card' });

    card.appendChild(el('div', { class: 'card-cat of-cat', text: catById.get(t.cat).name }));
    card.appendChild(el('div', { class: 'of-head' }, [
      el('div', { class: 'of-name', text: t.name }),
      el('span', { class: 'of-pill', text: t.type })
    ]));
    card.appendChild(el('p', { class: 'of-desc', text: t.desc }));
    if (t.tags.length) card.appendChild(ui.tagChips(t.tags));

    const rows = [].concat(
      kv('Тип', document.createTextNode(t.type)),
      kv('Установка', document.createTextNode(t.install ? 'требуется' : 'не требуется')),
      kv('Источник', document.createTextNode(source)),
      kv('Статус', el('span', { class: 'of-st of-st--' + eff, text: stText }))
    );
    card.appendChild(el('dl', { class: 'of-kv' }, rows));
    if (t.note) card.appendChild(el('div', { class: 'of-note', text: 'Ограничения: ' + t.note }));

    const links = el('div', { class: 'of-links' });
    if (t.site) links.appendChild(link(t.site, 'Официальный сайт'));
    if (t.repo) links.appendChild(link(t.repo, 'GitHub'));
    links.appendChild(el('button', { class: 'btn btn--ghost btn--small of-mark' + (mine ? ' on' : ''), type: 'button',
      'data-mark': t.id, 'aria-pressed': mine ? 'true' : 'false' },
      [ic('of-check'), el('span', { text: mine ? 'Проверено мной: снять отметку' : 'Отметить: ссылка проверена мной' })]));
    card.appendChild(links);
    return card;
  }

  /* ---------- Плитка (компактная) ---------- */
  function buildTile(t) {
    const eff = effStatus(t);
    return el('button', { class: 'of-tile', type: 'button', 'data-open': t.id,
      'aria-label': t.name + ', ' + t.type + ', ' + STATUS_NAME[eff] }, [
      el('div', { class: 'of-tile__top' }, [
        el('span', { class: 'of-tile__type', text: t.type + (t.install ? ' · установка' : '') }),
        el('span', { class: 'of-dot of-dot--' + eff, title: STATUS_NAME[eff] })
      ]),
      el('div', { class: 'of-tile__name', text: t.name }),
      el('div', { class: 'of-tile__desc', text: t.desc }),
      el('div', { class: 'of-tile__cat', text: catById.get(t.cat).short })
    ]);
  }

  /* ---------- Окно с полной карточкой (для компактного вида) ---------- */
  const dBack = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад' }, [ui.icon('back')]);
  const dTitle = el('div', { class: 'editor__title', text: 'Инструмент' });
  const dBody = el('div', { class: 'editor__body' });
  const detail = el('div', { class: 'editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Описание инструмента', hidden: '' },
    [el('div', { class: 'editor__bar' }, [dBack, dTitle]), dBody]);
  document.getElementById('app').appendChild(detail);

  function renderDetail() {
    const t = byId.get(detailId);
    const top = dBody.scrollTop;
    dBody.textContent = '';
    if (!t) return;
    dTitle.textContent = t.name;
    dBody.appendChild(buildCard(t));
    dBody.scrollTop = top;
  }

  function closeDetail() {
    detail.hidden = true;
    dBody.textContent = '';
    detailId = '';
  }

  function openDetail(id) {
    if (!byId.has(id)) return;
    detailId = id;
    renderDetail();
    if (detail.hidden) {
      detail.hidden = false;
      dBody.scrollTop = 0;
      ui.pushOverlay(closeDetail);
    }
  }

  dBack.addEventListener('click', function () { ui.requestClose(); });
  dBody.addEventListener('click', function (e) {
    const m = e.target.closest('[data-mark]');
    if (m) toggleMark(m.dataset.mark);
  });

  /* ---------- Отрисовка списка ---------- */
  function renderList() {
    const list = visible();
    const grid = viewMode === 'grid';
    listBox.textContent = '';
    listBox.className = grid ? 'of-grid' : 'list';
    countEl.textContent = 'Найдено: ' + list.length + ' ' + plural(list.length) + ' из ' + tools.length;
    resetBtn.disabled = !filtersActive();

    if (!tools.length) {
      listBox.className = 'list';
      listBox.appendChild(ui.emptyBlock('Каталог пуст', 'Не загружен файл данных (js/osint-data.js).'));
      return;
    }
    if (!list.length) {
      listBox.className = 'list';
      listBox.appendChild(ui.emptyBlock('Ничего не найдено', 'Измените запрос или фильтры.'));
      const again = el('button', { class: 'btn btn--block', type: 'button', text: 'Сбросить все фильтры' });
      again.addEventListener('click', resetFilters);
      listBox.appendChild(again);
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach(function (t) { frag.appendChild(grid ? buildTile(t) : buildCard(t)); });
    listBox.appendChild(frag);
  }

  function syncChips() {
    chipEls.forEach(function (b, id) {
      const on = id === filters.cat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const c = filters.cat ? catById.get(filters.cat) : null;
    catDesc.textContent = c ? c.name + ': ' + c.desc : '';
  }

  function syncViewTabs() {
    [listTab, gridTab].forEach(function (b) {
      const on = b.dataset.view === viewMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function setViewMode(m) {
    if (m !== 'list' && m !== 'grid') return;
    if (m === viewMode) return;
    viewMode = m;
    syncViewTabs();
    renderList();
    savePref({ osintView: m });
  }

  function resetFilters() {
    filters.q = ''; filters.cat = ''; filters.type = ''; filters.install = ''; filters.status = '';
    searchInput.value = '';
    typeSel.value = ''; instSel.value = ''; statSel.value = '';
    syncChips();
    renderList();
  }

  /* ---------- Обработчики ---------- */
  searchInput.addEventListener('input', ui.debounce(function () { filters.q = searchInput.value; renderList(); }, 150));
  searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchInput.blur(); });
  chipBox.addEventListener('click', function (e) {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    filters.cat = b.dataset.cat;
    syncChips();
    renderList();
  });
  typeSel.addEventListener('change', function () { filters.type = typeSel.value; renderList(); });
  instSel.addEventListener('change', function () { filters.install = instSel.value; renderList(); });
  statSel.addEventListener('change', function () { filters.status = statSel.value; renderList(); });
  sortSel.addEventListener('change', function () { filters.sort = sortSel.value; renderList(); });
  resetBtn.addEventListener('click', resetFilters);
  viewTabs.addEventListener('click', function (e) {
    const b = e.target.closest('[data-view]');
    if (b) setViewMode(b.dataset.view);
  });
  listBox.addEventListener('click', function (e) {
    const m = e.target.closest('[data-mark]');
    if (m) { toggleMark(m.dataset.mark); return; }
    const o = e.target.closest('[data-open]');
    if (o) openDetail(o.dataset.open);
  });

  // Блокировка: запросы и отметки убираем из памяти и с экрана (выбранный вид сохраняется)
  document.addEventListener('void:lock', function () {
    marks = {};
    detail.hidden = true;
    dBody.textContent = '';
    detailId = '';
    filters.sort = 'name-asc';
    sortSel.value = 'name-asc';
    resetFilters();
  });
  document.addEventListener('void:unlock', function () { loadPrefs().then(function () { syncViewTabs(); renderList(); }); });

  syncChips();
  syncViewTabs();
  renderList();
  loadPrefs().then(function () { syncViewTabs(); renderList(); });

  VOID.osint = { count: tools.length };
})();