/* ===== VOID DOCUMENTS — изображения (этапы D2 и D4) =====
   - Выбор файла, сжатие, шифрование и показ выполняет общий модуль js/graph-images.js
     (отдельные зашифрованные записи в разделе graphdata, id вида img_<32 hex>).
     Здесь только тонкая обёртка и расширение редактора: кнопка «Изображение»,
     окно размера, вставка из буфера обмена.
   - В документе хранится только <img data-img="id" style="width:..px">, без адреса картинки:
     ссылка подставляется при показе (blob в памяти) и исчезает при блокировке.
   - Размер меняется только через проверенный стиль width (px); максимум по экрану ограничен CSS.
   - Если фото не загрузилось, делается автоповтор; на месте картинки видна подпись с причиной,
     касание такой картинки загружает её заново. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const NS = 'http://www.w3.org/2000/svg';
  const STORE = 'graphdata';
  const ID_RE = /^img_[0-9a-f]{32}$/;
  const SIZES = [['Маленькое', 140], ['Среднее', 240], ['Крупное', 400], ['Большое', 640], ['На всю ширину', 2000]];

  const cache = new Map();    // id -> blob-ссылка (владелец ссылок — graph-images.js)
  const session = new Set();  // id, загруженные с последней проверки (для чистки)
  const bound = new WeakSet();
  let busy = false;

  function userError(m) { const e = new Error(m); e.user = true; return e; }
  function isId(id) { return typeof id === 'string' && ID_RE.test(id); }
  function lib() {
    if (!VOID.graphImages) throw userError('Не загружен модуль фото (js/graph-images.js)');
    return VOID.graphImages;
  }

  const API = {
    isId: isId,
    choose: function () { return lib().choose(); },
    add: function (file) {
      const L = lib();
      return L.add(file).then(function (res) {
        if (!res) return res;
        session.add(res.id);
        return L.load(res.id).then(function (u) { cache.set(res.id, u); return res; });
      });
    },
    load: function (id) {
      if (!isId(id)) return Promise.reject(new Error('BAD_ID'));
      if (cache.has(id)) return Promise.resolve(cache.get(id));
      return lib().load(id).then(function (u) { cache.set(id, u); return u; });
    },
    /** Сбросить сохранённую ссылку, чтобы фото прочиталось из хранилища заново. */
    reload: function (id) {
      cache.delete(id);
      if (VOID.graphImages && VOID.graphImages.forget) VOID.graphImages.forget(id);
    },
    cachedUrl: function (id) { return cache.get(id) || ''; },
    clear: function () { cache.clear(); },
    takeSession: function () { const a = Array.from(session); session.clear(); return a; },
    remove: async function (ids) {
      let n = 0;
      for (const id of (ids || [])) {
        if (!isId(id)) continue;
        try { await VOID.db.deleteItem(STORE, id); cache.delete(id); n++; }
        catch (err) { console.error('Image delete error:', err); }
      }
      return n;
    }
  };

  document.addEventListener('void:lock', function () { cache.clear(); session.clear(); });
  VOID.docsImages = API;

  /* ---------- Иконка ---------- */
  (function addIcon() {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById('i-dx-image')) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', 'i-dx-image');
    sym.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01');
    sym.appendChild(p);
    defs.appendChild(sym);
  })();

  /* ---------- Показ картинок в редакторе ---------- */
  function loadInto(ed, img, attempt) {
    const id = img.getAttribute('data-img');
    img.setAttribute('alt', 'Фото загружается…');
    API.load(id).then(function (url) {
      if (!ed.contains(img)) return;
      img.removeAttribute('data-failed');
      img.removeAttribute('data-retry');
      img.src = url;
    }).catch(function (err) {
      if (!ed.contains(img)) return;
      if (err && err.message === 'LOCKED') return;
      if (attempt < 1) {
        API.reload(id);
        setTimeout(function () {
          if (ed.contains(img) && !img.getAttribute('src')) loadInto(ed, img, attempt + 1);
        }, 400);
        return;
      }
      img.setAttribute('alt', err && err.message === 'IMG_MISSING' ? 'Фото удалено из хранилища' : 'Фото недоступно');
      img.setAttribute('data-failed', '1');
    });
  }

  function fill(ed) {
    ed.querySelectorAll('img.is-sel').forEach(function (i) { i.classList.remove('is-sel'); });
    ed.querySelectorAll('img[data-img]').forEach(function (img) {
      if (img.getAttribute('src')) return;
      const u = API.cachedUrl(img.getAttribute('data-img'));
      if (u) { img.src = u; return; }
      loadInto(ed, img, 0);
    });
  }

  /* ---------- Добавление ---------- */
  function insertPhoto(api, res) {
    if (!res) return;
    if (!VOID.docsEditor.isOpen() || !document.body.contains(api.ed)) {
      API.remove([res.id]); // редактор уже закрыт: фото никому не нужно
      return;
    }
    api.restoreRange();
    const w = Math.max(40, Math.min(res.w, 480));
    api.cmd('insertHTML', '<img data-img="' + res.id + '" style="width:' + w + 'px">');
    fill(api.ed);
    if (res.suspicious) {
      api.toast('Фото выглядит пустым (белым). Если это не так, выберите другое фото, это баг,который в скором времени мы исправим. Прости!', 'info', 6500);
    }
  }

  function handleError(api) {
    return function (err) {
      if (err && err.message === 'LOCKED') return;
      if (err && err.user) api.toast(err.message, 'error', 4500);
      else { console.error('Doc image error:', err); api.toast('Не удалось добавить изображение', 'error', 4000); }
    };
  }

  function addFile(api, file) {
    if (busy || !file) return Promise.resolve();
    busy = true;
    api.toast('Обработка фото…', 'info', 1800);
    return API.add(file).then(function (res) { insertPhoto(api, res); })
      .catch(handleError(api)).then(function () { busy = false; });
  }

  function pick(api) {
    if (busy) return;
    let p;
    try { p = API.choose(); } catch (err) { handleError(api)(err); return; }
    p.then(function (file) { return addFile(api, file); });
  }

  /* ---------- Окно размера ---------- */
  function clearSel(ed) { ed.querySelectorAll('img.is-sel').forEach(function (i) { i.classList.remove('is-sel'); }); }

  function sizeNode(api, img) {
    const el = api.ui.el;
    const box = el('div');
    box.appendChild(el('div', { class: 'dx__cap', text: 'Размер изображения' }));
    SIZES.forEach(function (s) {
      box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-w': String(s[1]), text: s[0] }));
    });
    box.appendChild(el('div', { class: 'dx__hr' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-scale': '0.8', text: 'Меньше' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-scale': '1.25', text: 'Больше' }));
    box.appendChild(el('div', { class: 'dx__hr' }));
    box.appendChild(el('button', { class: 'dx__row is-danger', type: 'button', 'data-del': '1', text: 'Удалить изображение' }));

    box.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || !api.ed.contains(img)) return;
      api.closePop();
      clearSel(api.ed);
      if (b.dataset.del) {
        const parent = img.parentNode;
        img.remove();
        if (parent && parent !== api.ed && !parent.firstChild) parent.appendChild(document.createElement('br'));
        api.commit();
        return;
      }
      let w = 0;
      if (b.dataset.w) w = Number(b.dataset.w);
      else if (b.dataset.scale) w = Math.round(img.getBoundingClientRect().width * Number(b.dataset.scale));
      if (!(w > 0)) return;
      img.style.width = Math.max(40, Math.min(2000, w)) + 'px';
      api.commit();
    });
    return box;
  }

  function attachOnce(api) {
    const ed = api.ed;
    if (!ed || bound.has(ed)) return;
    bound.add(ed);

    ed.addEventListener('click', function (e) {
      const img = e.target.closest && e.target.closest('img[data-img]');
      if (!img || !ed.contains(img)) { clearSel(ed); return; }
      e.preventDefault();
      if (!img.getAttribute('src')) { // не загружено: пробуем ещё раз
        clearSel(ed);
        API.reload(img.getAttribute('data-img'));
        img.removeAttribute('data-failed');
        img.removeAttribute('data-retry');
        loadInto(ed, img, 0);
        api.toast('Загружаю фото…', 'info', 1500);
        return;
      }
      clearSel(ed);
      img.classList.add('is-sel');
      const r = img.getBoundingClientRect();
      const top = Math.min(Math.max(r.top + 20, 150), window.innerHeight - 330);
      api.openPop({ getBoundingClientRect: function () { return { left: r.left, right: r.right, top: top, bottom: top }; } },
        sizeNode(api, img));
    });

    // Ссылка на фото «протухла» или файл не читается: одна повторная попытка с новой ссылкой
    ed.addEventListener('error', function (e) {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-img')) return;
      const id = img.getAttribute('data-img');
      img.removeAttribute('src');
      if (img.getAttribute('data-retry') === '1') {
        img.setAttribute('alt', 'Фото недоступно');
        img.setAttribute('data-failed', '1');
        return;
      }
      img.setAttribute('data-retry', '1');
      API.reload(id);
      loadInto(ed, img, 0);
    }, true);

    // Вставка картинки из буфера обмена (до обработчика текста)
    if (ed.parentNode) {
      ed.parentNode.addEventListener('paste', function (e) {
        const files = e.clipboardData && e.clipboardData.files;
        if (!files || !files.length) return;
        let f = null;
        for (let i = 0; i < files.length; i++) if (/^image\//.test(files[i].type)) f = files[i];
        if (!f) return;
        e.preventDefault();
        e.stopPropagation();
        addFile(api, f);
      }, true);
    }
  }

  if (VOID.docsEditor && VOID.docsEditor.use) {
    VOID.docsEditor.use({
      tools: [{ id: 'image', icon: 'dx-image', title: 'Вставить изображение', run: function (api) { pick(api); } }],
      afterRender: function (api) { attachOnce(api); fill(api.ed); }
    });
  } else {
    console.error('VOID DOCUMENTS: не загружен docs-editor.js (изображения недоступны)');
  }
})();