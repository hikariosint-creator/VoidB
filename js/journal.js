/* ===== VOID DOCUMENTS — список документов (бывший «Дневник») =====
   Документ хранится в том же зашифрованном разделе journal:
   { id, title, body (простой текст для поиска и статистики), tags, html (содержимое),
     images (id вставленных картинок), theme ('white'|'gray'|'black'), createdAt, updatedAt }.
   Старые записи дневника (без html) открываются как документы из поля body.
   Главная, поиск, статистика и резервные копии продолжают работать через VOID.journal.
   Чистка картинок: при закрытии документа и при его удалении стираются фото, которых больше нет
   ни в одном документе (по списку images). Во время работы картинки не удаляются, чтобы работала отмена. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  const core = VOID.docsCore;
  const editor = VOID.docsEditor;
  if (!ui || !core || !editor) { console.error('VOID DOCUMENTS: не загружены docs-core.js или docs-editor.js'); return; }
  const el = ui.el;

  const STORE = 'journal';
  const MAX_TITLE = 200;
  const MAX_IMAGES = 500;
  const IMG_RE = /^img_[0-9a-f]{32}$/;
  const THEME_LABEL = { white: 'White', gray: 'Gray', black: 'Black' };
  const SORTS = [['updated', 'Недавно изменённые'], ['created', 'Сначала новые'], ['title', 'По названию А–Я']];

  const view = document.getElementById('view-journal');
  view.dataset.title = 'Документы';
  const navLabel = document.querySelector('.nav-btn[data-route="journal"] span');
  if (navLabel) navLabel.textContent = 'Документы';

  let items = [];
  let loaded = false;
  let loadingPromise = null;
  let draftsDone = false;
  let opening = false;
  let defaultTheme = 'white';
  let query = '';
  let sortMode = 'updated';
  let chain = Promise.resolve();

  const str = function (v) { return typeof v === 'string' ? v : ''; };
  const num = function (v) { return Number.isFinite(v) ? v : 0; };

  function userError(message) { const e = new Error(message); e.user = true; return e; }

  /** Записи идут по очереди, чтобы сохранения, удаления и чистка не перемешивались. */
  function enqueue(task) {
    const p = chain.then(task);
    chain = p.catch(function () { /* очередь не ломается из-за одной ошибки */ });
    return p;
  }

  const notifyChange = ui.debounce(function () {
    if (typeof VOID.refreshDashboard === 'function') VOID.refreshDashboard();
  }, 1200);

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      title: str(raw.title),
      body: str(raw.body),
      tags: Array.isArray(raw.tags) ? raw.tags.filter(function (t) { return typeof t === 'string'; }) : [],
      category: '',
      html: str(raw.html),
      images: Array.isArray(raw.images) ? raw.images.filter(function (i) { return typeof i === 'string' && IMG_RE.test(i); }).slice(0, MAX_IMAGES) : [],
      theme: core.THEMES.indexOf(raw.theme) >= 0 ? raw.theme : 'white',
      createdAt: num(raw.createdAt),
      updatedAt: num(raw.updatedAt)
    };
  }

  function imageIds(node) {
    const out = [];
    node.querySelectorAll('img[data-img]').forEach(function (img) {
      const id = img.getAttribute('data-img');
      if (id && IMG_RE.test(id) && out.indexOf(id) < 0 && out.length < MAX_IMAGES) out.push(id);
    });
    return out;
  }

  /* =====================================================
     Интерфейс списка
     ===================================================== */
  const newBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button' },
    [ui.icon('plus'), el('span', { text: 'Новый документ' })]);
  const searchInput = el('input', { class: 'input', type: 'search', placeholder: 'Поиск по документам',
    maxlength: 100, autocomplete: 'off', 'aria-label': 'Поиск' });
  const sortSelect = el('select', { class: 'select', 'aria-label': 'Сортировка' });
  SORTS.forEach(function (s) { sortSelect.appendChild(el('option', { value: s[0], text: s[1] })); });
  const listBox = el('div', { class: 'list', 'aria-live': 'polite' });
  view.textContent = '';
  view.append(el('div', { class: 'toolbar' }, [newBtn, searchInput, sortSelect]), listBox);

  function visibleItems() {
    const tokens = query.toLowerCase().split(/\s+/).map(function (t) { return t.replace(/^#+/, ''); }).filter(Boolean);
    const list = items.filter(function (it) {
      if (!tokens.length) return true;
      const hay = (it.title + '\n' + it.body + '\n' + it.tags.join(' ')).toLowerCase();
      return tokens.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    list.sort(function (a, b) {
      if (sortMode === 'title') return a.title.localeCompare(b.title, 'ru');
      if (sortMode === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }

  function buildCard(it) {
    const open = el('button', { class: 'list-item list-item--click', type: 'button', 'data-open': it.id });
    open.appendChild(el('div', { class: 'list-item__title', text: it.title || 'Без названия' }));
    const sn = ui.snippet(it.body, 160);
    if (sn) open.appendChild(el('div', { class: 'card-snippet', text: sn }));
    if (it.tags.length) open.appendChild(ui.tagChips(it.tags));
    let meta = 'Создан ' + ui.formatDate(it.createdAt);
    if (it.updatedAt - it.createdAt > 60000) meta += ' · изменён ' + ui.formatDateTime(it.updatedAt);
    meta += ' · тема ' + THEME_LABEL[it.theme];
    open.appendChild(el('div', { class: 'list-item__meta', text: meta }));
    const acts = el('div', { class: 'dl-actions' }, [
      el('button', { class: 'icon-btn', type: 'button', 'data-rename': it.id, 'aria-label': 'Переименовать' }, [ui.icon('dx-pencil')]),
      el('button', { class: 'icon-btn', type: 'button', 'data-del': it.id, 'aria-label': 'Удалить' }, [ui.icon('dx-trash')])
    ]);
    return el('div', { class: 'dl-card' }, [open, acts]);
  }

  function renderList() {
    listBox.textContent = '';
    if (!loaded) { listBox.appendChild(ui.emptyBlock('Загрузка…', '')); return; }
    if (!items.length) {
      listBox.appendChild(ui.emptyBlock('Документов пока нет', 'Нажмите «Новый документ», чтобы создать первый.'));
      return;
    }
    const shown = visibleItems();
    if (!shown.length) { listBox.appendChild(ui.emptyBlock('Ничего не найдено', 'Измените запрос.')); return; }
    const frag = document.createDocumentFragment();
    shown.forEach(function (it) { frag.appendChild(buildCard(it)); });
    listBox.appendChild(frag);
  }

  /* =====================================================
     Загрузка
     ===================================================== */
  async function readTheme() {
    if (!(VOID.settings && VOID.settings.read)) return;
    try {
      const s = await VOID.settings.read();
      if (s && core.THEMES.indexOf(s.docsTheme) >= 0) defaultTheme = s.docsTheme;
    } catch (_) { /* не критично */ }
  }

  function rememberTheme(t) {
    defaultTheme = t;
    if (VOID.settings && VOID.settings.update) {
      VOID.settings.update({ docsTheme: t }).catch(function (err) { console.error('Docs theme save error:', err); });
    }
  }

  /** Старые несохранённые черновики дневника превращаем в документы (один раз за сеанс). */
  async function convertOldDrafts() {
    if (draftsDone) return;
    draftsDone = true;
    let drafts = [];
    try {
      drafts = (await VOID.db.getAllItems('drafts')).filter(function (d) { return d && d.kind === 'journal'; });
    } catch (_) { return; }
    let made = 0;
    for (const d of drafts) {
      try {
        const v = d.values && typeof d.values === 'object' ? d.values : d;
        const title = str(v.title).trim();
        const body = str(v.body);
        if (title || body.trim()) {
          const rec = await VOID.db.saveItem(STORE, {
            title: ('Черновик: ' + (title || 'без названия')).slice(0, MAX_TITLE),
            body: body.slice(0, core.MAX_TEXT), tags: ui.parseTags(str(v.tags)), category: '',
            html: core.htmlFromPlain(body), images: [], theme: 'white', v: 2
          });
          const n = normalize(rec);
          if (n) { items.push(n); made++; }
        }
        await VOID.db.deleteItem('drafts', d.id);
      } catch (err) {
        if (err && err.message === 'LOCKED') return;
        console.error('Draft convert error:', err);
      }
    }
    if (made && VOID.toast) VOID.toast('Старые черновики превращены в документы: ' + made, 'info', 4000);
  }

  function reload() {
    if (loadingPromise) return loadingPromise;
    loaded = false;
    renderList();
    loadingPromise = (async function () {
      try {
        const rows = await VOID.db.getAllItems(STORE);
        if (!VOID.auth.isUnlocked()) return;
        items = rows.map(normalize).filter(Boolean);
        loaded = true;
      } catch (err) {
        if (!(err && err.message === 'LOCKED')) {
          console.error('Documents load error:', err);
          VOID.toast('Не удалось загрузить документы', 'error');
        }
        return;
      }
      await readTheme();
      await convertOldDrafts();
      if (VOID.auth.isUnlocked()) renderList();
    })().finally(function () { loadingPromise = null; });
    return loadingPromise;
  }

  function ensureLoaded() { return loaded ? Promise.resolve() : reload(); }

  /* =====================================================
     Картинки: чистка
     ===================================================== */
  /** Удаляет фото, на которые не ссылается ни один из оставшихся документов. */
  async function releaseImages(ids) {
    if (!VOID.docsImages || !ids.length) return;
    const keep = new Set();
    items.forEach(function (it) { it.images.forEach(function (i) { keep.add(i); }); });
    const del = ids.filter(function (id) { return !keep.has(id); });
    if (del.length) await VOID.docsImages.remove(del);
  }

  /** Вызывается после закрытия документа (в общей очереди, после всех сохранений). */
  function finishImages(doc) {
    if (!VOID.docsImages || doc.removed) return;
    enqueue(async function () {
      if (!VOID.auth.isUnlocked() || !loaded) return; // при блокировке чистку откладываем
      VOID.docsImages.takeSession().forEach(function (id) { doc.seen.add(id); });
      const orphans = Array.from(doc.seen).filter(function (id) { return doc.lastImages.indexOf(id) < 0; });
      doc.seen = new Set(doc.lastImages);
      await releaseImages(orphans);
    }).catch(function (err) {
      if (!(err && err.message === 'LOCKED')) console.error('Image cleanup error:', err);
    });
  }

  /* =====================================================
     Сохранение и удаление
     ===================================================== */
  async function persist(doc, snap) {
    const node = core.sanitizeNode(snap.html);
    const html = node.innerHTML;
    if (html.length > core.MAX_HTML) throw userError('Документ слишком большой. Разделите его на два.');
    const title = str(snap.title).trim().slice(0, MAX_TITLE);
    const body = core.textFromNode(node, 'plain').slice(0, core.MAX_TEXT);
    const tags = ui.parseTags(snap.tagsText);
    const theme = core.THEMES.indexOf(snap.theme) >= 0 ? snap.theme : 'white';
    const images = imageIds(node);
    if (!doc.id && !title && !body.trim() && !core.hasMedia(html)) return 'empty';

    const rec = await VOID.db.saveItem(STORE, {
      id: doc.id || undefined, title: title, body: body, tags: tags, category: '',
      html: html, images: images, theme: theme, createdAt: doc.createdAt || undefined, v: 2
    });
    doc.id = rec.id;
    doc.createdAt = rec.createdAt;
    doc.lastImages = images;
    images.forEach(function (id) { doc.seen.add(id); });
    const n = normalize(rec);
    if (n && VOID.auth.isUnlocked()) {
      const idx = items.findIndex(function (x) { return x.id === n.id; });
      if (idx >= 0) items[idx] = n; else items.push(n);
      renderList();
      notifyChange();
    }
    return 'saved';
  }

  async function removeById(id, doc) {
    const it = items.find(function (x) { return x.id === id; });
    const ids = new Set(it ? it.images : []);
    if (doc) doc.seen.forEach(function (i) { ids.add(i); });
    if (VOID.docsImages) VOID.docsImages.takeSession().forEach(function (i) { ids.add(i); });
    await VOID.db.deleteItem(STORE, id);
    items = items.filter(function (x) { return x.id !== id; });
    if (VOID.auth.isUnlocked()) { renderList(); notifyChange(); }
    try { await releaseImages(Array.from(ids)); }
    catch (err) { console.error('Image cleanup error:', err); }
  }

  function newDocState(id, createdAt, images) {
    return { id: id, createdAt: createdAt, lastImages: images.slice(), seen: new Set(images), removed: false };
  }

  function makeHooks(doc) {
    return {
      save: function (snap) { return enqueue(function () { return persist(doc, snap); }); },
      remove: function () {
        return enqueue(async function () {
          if (doc.id) await removeById(doc.id, doc);
          doc.removed = true;
        });
      },
      onTheme: rememberTheme,
      onClosed: function () {
        if (VOID.auth.isUnlocked()) renderList();
        finishImages(doc);
      }
    };
  }

  /* =====================================================
     Открытие, создание, переименование, удаление
     ===================================================== */
  function prepareImages() {
    if (VOID.docsImages) { VOID.docsImages.clear(); VOID.docsImages.takeSession(); }
  }

  async function openDoc(id) {
    if (editor.isOpen() || opening || !VOID.auth.isUnlocked()) return;
    opening = true;
    try {
      await ensureLoaded();
      const it = items.find(function (x) { return x.id === id; });
      if (!it) { VOID.toast('Документ не найден', 'error'); return; }
      prepareImages();
      const doc = newDocState(it.id, it.createdAt, it.images);
      editor.open({ title: it.title, tags: it.tags, html: it.html || core.htmlFromPlain(it.body),
        theme: it.theme, updatedAt: it.updatedAt, isNew: false }, makeHooks(doc));
    } catch (err) {
      if (!(err && err.message === 'LOCKED')) { console.error('Open document error:', err); VOID.toast('Не удалось открыть документ', 'error'); }
    } finally {
      opening = false;
    }
  }

  function newDoc() {
    if (editor.isOpen() || !VOID.auth.isUnlocked()) return;
    prepareImages();
    editor.open({ title: '', tags: [], html: '<p><br></p>', theme: defaultTheme, isNew: true },
      makeHooks(newDocState(null, 0, [])));
  }

  async function renameDoc(id) {
    const it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    const res = await editor.prompt({ heading: 'Переименовать документ', label: 'Название', value: it.title,
      max: MAX_TITLE, confirmText: 'Сохранить' });
    if (!res || !VOID.auth.isUnlocked()) return;
    const title = res.value.trim().slice(0, MAX_TITLE);
    try {
      await enqueue(async function () {
        const raw = await VOID.db.getItem(STORE, id);
        if (!raw) return;
        const rec = await VOID.db.saveItem(STORE, Object.assign({}, raw, { title: title }));
        const n = normalize(rec);
        const idx = items.findIndex(function (x) { return x.id === id; });
        if (n && idx >= 0) items[idx] = n;
      });
      renderList();
      notifyChange();
      VOID.toast('Название изменено');
    } catch (err) {
      if (!(err && err.message === 'LOCKED')) VOID.toast('Не удалось переименовать', 'error');
    }
  }

  async function deleteDoc(id) {
    const it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    const ok = await ui.confirm({ title: 'Удалить документ?',
      text: '«' + (it.title || 'Без названия') + '» будет удалён без возможности восстановления.', confirmText: 'Удалить' });
    if (!ok || !VOID.auth.isUnlocked()) return;
    try {
      await enqueue(function () { return removeById(id, null); });
      VOID.toast('Документ удалён');
    } catch (err) {
      if (!(err && err.message === 'LOCKED')) VOID.toast('Не удалось удалить документ', 'error');
    }
  }

  /* =====================================================
     Обработчики
     ===================================================== */
  newBtn.addEventListener('click', newDoc);
  searchInput.addEventListener('input', ui.debounce(function () { query = searchInput.value; renderList(); }, 150));
  sortSelect.addEventListener('change', function () { sortMode = sortSelect.value; renderList(); });
  listBox.addEventListener('click', function (e) {
    const r = e.target.closest('[data-rename]');
    if (r) { renameDoc(r.dataset.rename); return; }
    const d = e.target.closest('[data-del]');
    if (d) { deleteDoc(d.dataset.del); return; }
    const o = e.target.closest('[data-open]');
    if (o) openDoc(o.dataset.open);
  });

  // Блокировка: всё расшифрованное убираем из памяти и с экрана
  document.addEventListener('void:lock', function () {
    items = [];
    loaded = false;
    draftsDone = false;
    query = '';
    sortMode = 'updated';
    searchInput.value = '';
    sortSelect.value = 'updated';
    listBox.textContent = '';
  });
  document.addEventListener('void:unlock', reload);

  /* =====================================================
     Интерфейс для остальных модулей (главная, поиск, статистика, резервные копии)
     ===================================================== */
  VOID.journal = {
    reload: reload,
    ensureLoaded: ensureLoaded,
    renderList: renderList,
    refreshTagOptions: function () { /* теги теперь только в карточках и поиске */ },
    openEditor: openDoc,
    newEntry: function () { newDoc(); return Promise.resolve(); },
    getItems: function () {
      return items.map(function (it) {
        return { id: it.id, title: it.title, body: it.body, tags: it.tags.slice(), category: '',
          theme: it.theme, createdAt: it.createdAt, updatedAt: it.updatedAt };
      });
    }
  };

  // Источник данных для блока «Последние записи» на главной
  VOID.providers = VOID.providers || {};
  VOID.providers.recent = async function (limit) {
    await ensureLoaded();
    return items.slice()
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; })
      .slice(0, limit)
      .map(function (it) {
        return { id: it.id, title: it.title || 'Без названия', meta: ui.formatDateTime(it.updatedAt) };
      });
  };
})();