/* ===== VOID — изображения (этап E2, усилен в этапе D4) =====
   Используется досками Graph и документами.
   - Выбор файла через системное окно (accept="image/*"); камера и сеть не используются.
   - Фото уменьшается (до 1600 px по длинной стороне) и перекодируется через canvas:
     это экономит место и стирает метаданные (геолокацию, модель камеры).
   - Защита от «пустых» картинок: результат проверяется на однотонность/прозрачность; если холст
     нарисовал пустоту, пробуются другие способы чтения файла (bitmap, <img>, пошаговое уменьшение).
   - Хранится отдельной зашифрованной записью в разделе graphdata (id вида img_<32 hex>):
     { id, kind:'image', mime, w, h, data(base64) }. Шифрование и ключ общие, из VOID.db.
   - Для показа используются Blob-ссылки в памяти; при блокировке и закрытии доски они отзываются.
   - Форматы на входе: JPG, PNG, WebP, GIF (первый кадр), BMP; HEIC пробуется, но многие браузеры его не читают.
     SVG не принимается. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};

  const STORE = 'graphdata';
  const ID_RE = /^img_[0-9a-f]{32}$/;
  const ALLOWED_IN = ['', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
    'image/heic', 'image/heif'];
  const ALPHA_TYPES = ['image/png', 'image/webp', 'image/gif']; // только они могут быть прозрачными
  const STORED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_INPUT = 30 * 1024 * 1024;  // байт, исходный файл
  const MAX_STORED = 3 * 1024 * 1024;  // байт, после сжатия
  const SIDES = [1600, 1200, 900];     // попытки: если не влезло, уменьшаем ещё
  const STEP_LIMIT = 2400;             // при пошаговом уменьшении доводим до такого размера

  const urls = new Map();     // id -> Blob-ссылка
  const pending = new Map();  // id -> идущая загрузка
  let gen = 0;                // поколение: сбрасывается при отзыве ссылок
  let chain = Promise.resolve();

  function isId(id) { return typeof id === 'string' && ID_RE.test(id); }

  function userError(message) {
    const e = new Error(message);
    e.user = true;
    return e;
  }

  /** Загрузки идут по одной, чтобы не перегружать слабый телефон расшифровкой. */
  function queueRun(fn) {
    const p = chain.then(fn);
    chain = p.catch(function () { /* очередь не ломается из-за одной ошибки */ });
    return p;
  }

  /* ---------- Выбор файла ---------- */
  /** Вызывать СРАЗУ в обработчике нажатия (иначе браузер не покажет окно выбора). */
  function choose() {
    return new Promise(function (resolve) {
      const input = document.createElement('input');
      let done = false;
      const finish = function (f) {
        if (done) return;
        done = true;
        input.remove();
        resolve(f);
      };
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      input.addEventListener('change', function () { finish(input.files && input.files[0] ? input.files[0] : null); });
      input.addEventListener('cancel', function () { finish(null); });
      document.body.appendChild(input);
      input.click();
    });
  }

  /* ---------- Чтение файла: три способа ---------- */
  function decodeBitmap(file) {
    if (typeof createImageBitmap !== 'function') return Promise.reject(new Error('NO_BITMAP'));
    return createImageBitmap(file).then(function (bmp) {
      return { src: bmp, w: bmp.width, h: bmp.height, close: function () { if (bmp.close) bmp.close(); } };
    });
  }

  function decodeElement(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight,
          close: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('IMG_DECODE')); };
      img.src = url;
    });
  }

  /** Очень большие снимки сначала уменьшаем вдвое несколько раз: так надёжнее на слабых устройствах. */
  function decodeStepped(file) {
    return decodeElement(file).then(function (d) {
      let src = d.src, w = d.w, h = d.h;
      const temp = [];
      while (Math.max(w, h) > STEP_LIMIT) {
        const nw = Math.max(1, Math.round(w / 2));
        const nh = Math.max(1, Math.round(h / 2));
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        c.getContext('2d').drawImage(src, 0, 0, nw, nh);
        temp.push(c);
        src = c; w = nw; h = nh;
      }
      return { src: src, w: w, h: h, close: function () {
        d.close();
        temp.forEach(function (c) { c.width = 0; c.height = 0; });
      } };
    });
  }

  /* ---------- Рисование и проверка результата ---------- */
  function render(dec, side, alpha) {
    const k = Math.min(1, side / Math.max(dec.w, dec.h));
    const w = Math.max(1, Math.round(dec.w * k));
    const h = Math.max(1, Math.round(dec.h * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('NO_CANVAS');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (!alpha) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    g.drawImage(dec.src, 0, 0, w, h);
    return { canvas: canvas, w: w, h: h };
  }

  /** «Пустая» картинка: полностью прозрачная или однотонная (белая пустота после сбоя холста). */
  function looksBlank(canvas) {
    try {
      const s = document.createElement('canvas');
      s.width = 24;
      s.height = 24;
      const g = s.getContext('2d', { willReadFrequently: true });
      g.drawImage(canvas, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let min = 255, max = 0, amax = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > amax) amax = d[i + 3];
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (l < min) min = l;
        if (l > max) max = l;
      }
      s.width = 0;
      s.height = 0;
      return amax < 8 || (max - min) < 3;
    } catch (_) {
      return false; // проверить не удалось: считаем нормальной
    }
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  async function compress(file) {
    const alpha = ALPHA_TYPES.indexOf(file.type) >= 0;
    const strategies = [decodeBitmap, decodeElement, decodeStepped];
    let fallback = null, lastErr = null, tooHeavy = false;
    for (let s = 0; s < strategies.length; s++) {
      let dec = null;
      try { dec = await strategies[s](file); } catch (err) { lastErr = err; continue; }
      try {
        if (!dec.w || !dec.h) continue;
        for (let i = 0; i < SIDES.length; i++) {
          let r;
          try { r = render(dec, SIDES[i], alpha); } catch (err) { lastErr = err; break; }
          const blank = looksBlank(r.canvas);
          let blob = await canvasBlob(r.canvas, alpha ? 'image/webp' : 'image/jpeg', 0.85);
          if (alpha && (!blob || blob.type !== 'image/webp')) blob = await canvasBlob(r.canvas, 'image/png');
          r.canvas.width = 0; // освобождаем память
          r.canvas.height = 0;
          if (!blob || blob.size > MAX_STORED || STORED_MIMES.indexOf(blob.type) < 0) {
            if (blob && blob.size > MAX_STORED) tooHeavy = true;
            continue;
          }
          if (!blank) return { blob: blob, w: r.w, h: r.h, suspicious: false };
          if (!fallback) fallback = { blob: blob, w: r.w, h: r.h, suspicious: true };
          break; // результат пустой: пробуем следующий способ чтения
        }
      } finally {
        dec.close();
      }
    }
    if (fallback) return fallback;
    if (tooHeavy) throw userError('Фото слишком тяжёлое даже после сжатия.');
    throw lastErr || new Error('IMG_DECODE');
  }

  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () {
        const s = String(r.result);
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : '');
      };
      r.onerror = function () { reject(r.error || new Error('READ_FAILED')); };
      r.readAsDataURL(blob);
    });
  }

  /* ---------- Добавление ---------- */
  /** Сжимает, шифрует и сохраняет фото. Возвращает { id, w, h, suspicious }. */
  async function add(file) {
    if (!file) return null;
    if (ALLOWED_IN.indexOf(file.type) < 0) throw userError('Этот формат не поддерживается. Выберите JPG, PNG или WebP.');
    if (file.size > MAX_INPUT) throw userError('Файл слишком большой (больше 30 МБ).');
    let c;
    try {
      c = await compress(file);
    } catch (err) {
      if (err && err.user) throw err;
      if (/hei[cf]/i.test(file.type)) {
        throw userError('Формат HEIC этот браузер не читает. Сохраните фото как JPG и повторите.');
      }
      throw userError('Не удалось прочитать это изображение.');
    }
    const data = await blobToB64(c.blob);
    if (!data) throw userError('Не удалось прочитать это изображение.');
    const id = 'img_' + VOID.crypto.randomId();
    await VOID.db.saveItem(STORE, { id: id, kind: 'image', mime: c.blob.type, w: c.w, h: c.h, data: data });
    urls.set(id, URL.createObjectURL(c.blob)); // сразу можно показывать
    return { id: id, w: c.w, h: c.h, suspicious: c.suspicious };
  }

  /* ---------- Показ ---------- */
  /** Возвращает Blob-ссылку для <img>. Читает и расшифровывает запись при первом обращении. */
  function load(id) {
    if (!isId(id)) return Promise.reject(new Error('BAD_ID'));
    if (urls.has(id)) return Promise.resolve(urls.get(id));
    if (pending.has(id)) return pending.get(id);
    const g = gen;
    const run = queueRun(async function () {
      if (urls.has(id)) return urls.get(id);
      const rec = await VOID.db.getItem(STORE, id);
      if (g !== gen) throw new Error('LOCKED');
      if (!rec || rec.kind !== 'image' || typeof rec.data !== 'string' || STORED_MIMES.indexOf(rec.mime) < 0) {
        throw new Error('IMG_MISSING');
      }
      const url = URL.createObjectURL(new Blob([VOID.crypto.fromB64(rec.data)], { type: rec.mime }));
      urls.set(id, url);
      return url;
    });
    const wrapped = run.finally(function () { pending.delete(id); });
    pending.set(id, wrapped);
    return wrapped;
  }

  /** Забыть ссылку на фото (например, если она «протухла»), чтобы при следующей загрузке прочитать заново. */
  function forget(id) {
    const u = urls.get(id);
    if (u) { try { URL.revokeObjectURL(u); } catch (_) { /* не критично */ } urls.delete(id); }
    pending.delete(id);
  }

  /** Отзывает все ссылки: расшифрованные фото не остаются в памяти. */
  function revokeAll() {
    gen++;
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls.clear();
    pending.clear();
  }

  document.addEventListener('void:lock', revokeAll);

  VOID.graphImages = { isId: isId, choose: choose, add: add, load: load, forget: forget, revokeAll: revokeAll };
})();