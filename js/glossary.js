/* ===== VOID — Словарь OSINT-аналитика (интерфейс) =====
   Данные лежат в js/glossary-data-1.js и js/glossary-data-2.js (VOID.glossaryData).
   Раздел статичный: это справочный текст, личных данных в нём нет, поэтому он не шифруется,
   ничего не сохраняет и работает офлайн. Поисковые запросы нигде не запоминаются.
   Весь текст выводится только через textContent.

   Формат записи данных:
   { id, cat, t (термин), en (англ. название), al [синонимы], s (кратко), d [абзацы],
     k [ключевые мысли], ex (пример), rel [id связанных терминов], act:'graph' (кнопка Graph) } */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID Словарь: не загружен ui.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';
  
    const CATS = [
    ['basics', 'Основы'], ['branches', 'Ветви OSINT'], ['process', 'Процесс'], ['cases', 'Кейсы'],
    ['viz', 'Визуализация'], ['tech', 'Методы и техники'], ['verify', 'Проверка и анализ'],
    ['safety', 'Этика, право, безопасность'], ['tools', 'Инструменты'],
    ['anon', 'Анонимность и приватность'], ['protect', 'Защита от доксинга'],
    ['threats', 'Сваттинг и преследование'], ['malware', 'Вредоносные программы'],
    ['hacking', 'Хакинг и кибербезопасность'], ['social', 'Социальная инженерия']
  ];
  const CAT_NAME = {};
  CATS.forEach(function (c) { CAT_NAME[c[0]] = c[1]; });
  const GO_ROUTES = ['graph'];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function strList(v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : [];
  }
  function fold(s) { return String(s).toLowerCase().replace(/ё/g, 'е'); }

  /* ---------- Данные ---------- */
  const raw = Array.isArray(VOID.glossaryData) ? VOID.glossaryData : [];
  const entries = [];
  const byId = new Map();
  raw.forEach(function (r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || byId.has(r.id)) return;
    if (typeof r.cat !== 'string' || !has(CAT_NAME, r.cat)) return;
    const e = {
      id: r.id, cat: r.cat, t: str(r.t), en: str(r.en), s: str(r.s),
      d: strList(r.d), k: strList(r.k), ex: str(r.ex), rel: strList(r.rel), al: strList(r.al),
      act: r.act === 'graph' ? 'graph' : '', order: entries.length
    };
    if (!e.t || !e.s) return;
    e.title = fold([e.t, e.en, e.al.join(' ')].join(' '));
    e.hay = fold([e.t, e.en, e.al.join(' '), e.s, e.d.join(' '), e.k.join(' '), e.ex].join('\n'));
    entries.push(e);
    byId.set(e.id, e);
  });
  entries.forEach(function (e) {
    e.rel = e.rel.filter(function (id) { return byId.has(id) && id !== e.id; });
  });

  /* ---------- Иконка ---------- */
  (function addIcon() {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById('i-book')) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', 'i-book');
    sym.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11');
    sym.appendChild(p);
    defs.appendChild(sym);
  })();

  /* ---------- Раздел ---------- */
  const appRoot = document.getElementById('app');
  const viewsRoot = document.getElementById('views');
  const sheet = document.getElementById('sheet');

  const view = el('section', { class: 'view', id: 'view-glossary', 'data-title': 'Словарь', hidden: '' });
  viewsRoot.appendChild(view);

  const searchInput = el('input', { class: 'input', type: 'search',
    placeholder: 'Поиск: термин, аббревиатура, слово из описания', maxlength: 100,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Поиск по словарю' });
  const catSelect = el('select', { class: 'select', 'aria-label': 'Раздел словаря' });
  const countEl = el('div', { class: 'gl-count', 'aria-live': 'polite' });
  const listBox = el('div', { class: 'gl-list' });
  view.append(el('div', { class: 'toolbar' }, [searchInput, catSelect]), countEl, listBox);

  // Пункт меню «Ещё» (перед «Настройками»)
  if (sheet) {
    sheet.insertBefore(
      el('button', { class: 'sheet__item', type: 'button', 'data-route': 'glossary' },
        [ui.icon('book'), el('span', { text: 'Словарь' })]),
      sheet.lastElementChild);
  }

  function fillCategories() {
    catSelect.textContent = '';
    catSelect.appendChild(el('option', { value: '', text: 'Все разделы (' + entries.length + ')' }));
    CATS.forEach(function (c) {
      const n = entries.filter(function (e) { return e.cat === c[0]; }).length;
      if (n) catSelect.appendChild(el('option', { value: c[0], text: c[1] + ' (' + n + ')' }));
    });
  }
  fillCategories();

  const filters = { q: '', cat: '' };

  function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function buildCard(e) {
    const card = el('button', { class: 'list-item list-item--click gl-card', type: 'button', 'data-term': e.id });
    card.appendChild(el('div', { class: 'list-item__title', text: e.t }));
    if (e.en) card.appendChild(el('div', { class: 'gl-en', text: e.en }));
    card.appendChild(el('div', { class: 'card-snippet', text: e.s }));
    return card;
  }

  function renderList() {
    listBox.textContent = '';
    if (!entries.length) {
      listBox.appendChild(ui.emptyBlock('Словарь пуст', 'Не загружены файлы данных (js/glossary-data-1.js, js/glossary-data-2.js).'));
      countEl.textContent = '';
      return;
    }
    const tokens = fold(filters.q).split(/\s+/).map(function (t) { return t.replace(/^#+/, ''); }).filter(Boolean);
    let list = entries.filter(function (e) {
      if (filters.cat && e.cat !== filters.cat) return false;
      return tokens.every(function (t) { return e.hay.indexOf(t) >= 0; });
    });
    const total = list.length;
    countEl.textContent = tokens.length
      ? 'Найдено: ' + total + ' ' + plural(total, ['термин', 'термина', 'терминов'])
      : 'Терминов: ' + total;

    if (!total) {
      listBox.appendChild(ui.emptyBlock('Ничего не найдено', 'Попробуйте другое слово или выберите «Все разделы».'));
      return;
    }
    const frag = document.createDocumentFragment();
    if (tokens.length) {
      // Сначала совпадения в названии, затем остальные
      list = list.map(function (e) {
        return { e: e, hit: tokens.every(function (t) { return e.title.indexOf(t) >= 0; }) ? 1 : 0 };
      }).sort(function (a, b) { return (b.hit - a.hit) || (a.e.order - b.e.order); })
        .map(function (x) { return x.e; });
      const box = el('div', { class: 'list' });
      list.forEach(function (e) { box.appendChild(buildCard(e)); });
      frag.appendChild(box);
    } else {
      CATS.forEach(function (c) {
        const part = list.filter(function (e) { return e.cat === c[0]; });
        if (!part.length) return;
        const box = el('div', { class: 'list' });
        part.forEach(function (e) { box.appendChild(buildCard(e)); });
        frag.appendChild(el('section', { class: 'gl-group' }, [
          el('h2', { class: 'section-title', text: c[1] + ' · ' + part.length }), box
        ]));
      });
    }
    listBox.appendChild(frag);
  }

  /* ---------- Окно термина ---------- */
  const backBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад' }, [ui.icon('back')]);
  const barTitle = el('div', { class: 'editor__title', text: 'Словарь' });
  const detailBody = el('div', { class: 'editor__body gl-detail' });
  const detail = el('div', { class: 'editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Термин', hidden: '' }, [
    el('div', { class: 'editor__bar' }, [backBtn, barTitle]),
    detailBody
  ]);
  appRoot.appendChild(detail);

  let pendingGo = '';

  function renderDetail(e) {
    detailBody.textContent = '';
    barTitle.textContent = CAT_NAME[e.cat];
    const nodes = [];
    nodes.push(el('div', { class: 'card-cat', text: CAT_NAME[e.cat].toUpperCase() }));
    nodes.push(el('h1', { class: 'gl-term', text: e.t }));
    if (e.en) nodes.push(el('div', { class: 'gl-en', text: e.en }));
    if (e.al.length) nodes.push(el('div', { class: 'gl-en', text: 'Также: ' + e.al.join(', ') }));
    nodes.push(el('p', { class: 'gl-lead', text: e.s }));
    e.d.forEach(function (p) { nodes.push(el('p', { class: 'gl-p', text: p })); });

    if (e.k.length) {
      const ul = el('ul', { class: 'gl-points' });
      e.k.forEach(function (k) { ul.appendChild(el('li', { text: k })); });
      nodes.push(el('div', { class: 'gl-block' }, [el('div', { class: 'gl-label', text: 'Главное' }), ul]));
    }
    if (e.ex) {
      nodes.push(el('div', { class: 'gl-ex' }, [
        el('div', { class: 'gl-label', text: 'Пример' }), el('p', { class: 'gl-p', text: e.ex })
      ]));
    }
    if (e.rel.length) {
      const chips = el('div', { class: 'chips' });
      e.rel.forEach(function (id) {
        chips.appendChild(el('button', { class: 'chip chip--btn', type: 'button', 'data-term': id, text: byId.get(id).t }));
      });
      nodes.push(el('div', {}, [el('div', { class: 'gl-label', text: 'Связанные термины' }), chips]));
    }
    if (e.act === 'graph') {
      nodes.push(el('button', { class: 'btn btn--primary btn--block', type: 'button', 'data-go': 'graph', text: 'Открыть Graph' }));
    }
    const prev = entries[e.order - 1];
    const next = entries[e.order + 1];
    const mk = function (target, label) {
      const b = el('button', { class: 'btn', type: 'button' });
      if (target) {
        b.setAttribute('data-term', target.id);
        b.textContent = label + '\n' + target.t;
        b.style.whiteSpace = 'pre-line';
      } else {
        b.hidden = true;
      }
      return b;
    };
    nodes.push(el('div', { class: 'gl-nav' }, [mk(prev, '← Предыдущий'), mk(next, 'Следующий →')]));

    detailBody.append.apply(detailBody, nodes);
    detailBody.scrollTop = 0;
  }

  function closeDetail() {
    detail.hidden = true;
    detailBody.textContent = '';
    const go = pendingGo;
    pendingGo = '';
    if (go && GO_ROUTES.indexOf(go) >= 0 && typeof VOID.navigate === 'function') {
      setTimeout(function () { VOID.navigate(go); }, 0);
    }
  }

  function openTerm(id) {
    const e = byId.get(id);
    if (!e) return;
    renderDetail(e);
    if (detail.hidden) {
      detail.hidden = false;
      ui.pushOverlay(closeDetail);
    }
  }

  detailBody.addEventListener('click', function (ev) {
    const t = ev.target.closest('[data-term]');
    if (t) {
      const e = byId.get(t.dataset.term);
      if (e) renderDetail(e);
      return;
    }
    const g = ev.target.closest('[data-go]');
    if (g && GO_ROUTES.indexOf(g.dataset.go) >= 0) {
      pendingGo = g.dataset.go;
      ui.requestClose();
    }
  });
  backBtn.addEventListener('click', function () { ui.requestClose(); });

  /* ---------- События ---------- */
  listBox.addEventListener('click', function (ev) {
    const card = ev.target.closest('[data-term]');
    if (card) openTerm(card.dataset.term);
  });
  searchInput.addEventListener('input', ui.debounce(function () {
    filters.q = searchInput.value;
    renderList();
  }, 150));
  searchInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') searchInput.blur(); });
  catSelect.addEventListener('change', function () {
    filters.cat = catSelect.value;
    renderList();
  });

  // Блокировка: стираем запрос с экрана (запросы нигде не хранятся)
  document.addEventListener('void:lock', function () {
    filters.q = '';
    filters.cat = '';
    searchInput.value = '';
    catSelect.value = '';
    pendingGo = '';
    detail.hidden = true;
    detailBody.textContent = '';
    renderList();
  });

  renderList();

  VOID.glossary = { open: openTerm, count: entries.length };
})();