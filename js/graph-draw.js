/* ===== VOID GRAPH — рисование (этап G1) =====
   Рисунки хранятся в data.strokes: { id, c (цвет), k ('pen'|'hl'), w (толщина), p [x0,y0,x1,y1,…] }
   в координатах доски, внутри зашифрованного содержимого доски (общая система VOID).
   Режим рисования: поверх полотна ложится прозрачная «накладка»; одним пальцем рисуем или стираем.
   Инструмент «Рука» отдаёт жесты полотну (двигать и масштабировать двумя пальцами).
   Ластик удаляет рисунок целиком, к которому прикоснулись. Все действия идут в Undo/Redo редактора. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID GRAPH: не загружен ui.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';

  const COLORS = { red: '#E5484D', yellow: '#F5C400', green: '#2FA84F', blue: '#4C9AFF', violet: '#9B6BFF', white: '#F2F2F2', black: '#111111' };
  const COLOR_LABELS = { red: 'Красный', yellow: 'Жёлтый', green: 'Зелёный', blue: 'Синий', violet: 'Фиолетовый', white: 'Белый', black: 'Чёрный' };
  const COLOR_IDS = Object.keys(COLORS);
  const SIZES = { pen: [2, 4, 7, 12], hl: [12, 18, 28, 42] };
  const DOT_PX = [6, 10, 14, 20];
  const TOOLS = [['pen', 'Ручка'], ['hl', 'Маркер'], ['eraser', 'Ластик'], ['hand', 'Рука']];
  const MAX_STROKES = 1500;
  const MAX_POINTS = 4000;   // точек в одном рисунке после упрощения
  const MAX_RAW = 8000;      // точек, принимаемых за один штрих
  const MAX_TOTAL = 250000;  // точек на всей доске
  const ERASER_PX = 14;
  const HL_OPACITY = 0.4;

  let tool = 'pen', color = 'red', sizeIdx = 1; // настройки живут в памяти, пока открыто приложение

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function num(v, d, a, b) { return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /** Проверка рисунка (данные могут прийти из файла или старой версии). */
  function cleanStroke(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
    if (!Array.isArray(r.p) || r.p.length < 2 || r.p.length % 2 !== 0 || r.p.length > MAX_POINTS * 2) return null;
    const p = [];
    for (let i = 0; i < r.p.length; i++) {
      if (!Number.isFinite(r.p[i])) return null;
      p.push(Math.max(-1e6, Math.min(1e6, r.p[i])));
    }
    return { id: r.id, c: has(COLORS, r.c) ? r.c : 'white', k: r.k === 'hl' ? 'hl' : 'pen', w: num(r.w, 4, 0.5, 80), p: p };
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /** Упрощение ломаной (алгоритм Дугласа-Пекера), чтобы рисунки занимали меньше места. */
  function simplify(pts, eps) {
    const n = pts.length;
    if (n < 3) return pts;
    const keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const seg = stack.pop();
      const a = seg[0], b = seg[1];
      let maxD = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter(function (_, i) { return keep[i] === 1; });
  }

  /** Плавная линия через середины отрезков. p — плоский массив [x0,y0,x1,y1,…]. */
  function pathD(p) {
    const n = p.length / 2;
    if (n === 0) return '';
    if (n === 1) return 'M' + p[0] + ' ' + p[1] + 'l0.01 0'; // точка
    if (n === 2) return 'M' + p[0] + ' ' + p[1] + 'L' + p[2] + ' ' + p[3];
    let d = 'M' + p[0] + ' ' + p[1];
    for (let i = 1; i < n - 1; i++) {
      const mx = (p[2 * i] + p[2 * i + 2]) / 2;
      const my = (p[2 * i + 1] + p[2 * i + 3]) / 2;
      d += 'Q' + p[2 * i] + ' ' + p[2 * i + 1] + ' ' + mx + ' ' + my;
    }
    return d + 'L' + p[2 * (n - 1)] + ' ' + p[2 * (n - 1) + 1];
  }

  function flat(pts) {
    const out = [];
    pts.forEach(function (p) { out.push(r1(p[0]), r1(p[1])); });
    return out;
  }

  function makeEl(s) {
    const p = svgEl('path', { class: 'gd__s', 'data-sid': s.id });
    p.setAttribute('d', pathD(s.p));
    p.setAttribute('stroke', COLORS[s.c]);
    p.setAttribute('stroke-width', String(s.w));
    if (s.k === 'hl') p.setAttribute('stroke-opacity', String(HL_OPACITY));
    return p;
  }

  /* =====================================================
     Подключение к доске
     ===================================================== */
  function attach(ctx) {
    const data = ctx.data;
    const world = ctx.world;
    const stage = ctx.stage;
    const main = ctx.main;
    const vp = ctx.vp;
    const toast = ctx.toast || function () {};

    const els = new Map();      // id рисунка -> <path>
    const bboxes = new Map();   // id рисунка -> [minX, minY, maxX, maxY]
    const down = new Set();     // нажатые пальцы
    const cam = { r: null };
    let layer = null;
    let cur = null;
    let raf = 0;
    let active = false;
    let dead = false;

    data.strokes = (Array.isArray(data.strokes) ? data.strokes : []).map(cleanStroke).filter(Boolean).slice(0, MAX_STROKES);

    function ensureLayer() {
      if (!layer) layer = svgEl('svg', { class: 'gd', width: '1', height: '1', 'aria-hidden': 'true' });
      if (layer.parentNode !== world) world.appendChild(layer);
    }

    function renderAll() {
      if (dead) return;
      ensureLayer();
      layer.textContent = '';
      els.clear();
      const f = document.createDocumentFragment();
      data.strokes.forEach(function (s) {
        const p = makeEl(s);
        els.set(s.id, p);
        f.appendChild(p);
      });
      layer.appendChild(f);
    }

    function bboxOf(s) {
      let b = bboxes.get(s.id);
      if (b) return b;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < s.p.length; i += 2) {
        if (s.p[i] < x0) x0 = s.p[i];
        if (s.p[i] > x1) x1 = s.p[i];
        if (s.p[i + 1] < y0) y0 = s.p[i + 1];
        if (s.p[i + 1] > y1) y1 = s.p[i + 1];
      }
      const m = s.w / 2;
      b = [x0 - m, y0 - m, x1 + m, y1 + m];
      bboxes.set(s.id, b);
      return b;
    }

    function totalPoints() {
      let n = 0;
      data.strokes.forEach(function (s) { n += s.p.length / 2; });
      return n;
    }

    /* ---------- Накладка и панель ---------- */
    const pad = el('div', { class: 'gd__pad', hidden: '' });
    stage.appendChild(pad);

    const toolEls = {};
    const toolRow = el('div', { class: 'gd__row' });
    TOOLS.forEach(function (t) {
      const b = el('button', { class: 'gd__btn', type: 'button', 'data-tool': t[0], text: t[1] });
      toolEls[t[0]] = b;
      toolRow.appendChild(b);
    });
    const doneBtn = el('button', { class: 'gd__btn gd__btn--done', type: 'button', text: 'Готово' });
    toolRow.appendChild(doneBtn);

    const swEls = {};
    const sizeEls = [];
    const optRow = el('div', { class: 'gd__row' });
    COLOR_IDS.forEach(function (id) {
      const b = el('button', { class: 'gd__sw', type: 'button', 'data-color': id, 'aria-label': COLOR_LABELS[id] });
      b.style.background = COLORS[id];
      swEls[id] = b;
      optRow.appendChild(b);
    });
    DOT_PX.forEach(function (px, i) {
      const dot = el('span', { class: 'gd__dot' });
      dot.style.width = px + 'px';
      dot.style.height = px + 'px';
      const b = el('button', { class: 'gd__btn', type: 'button', 'data-size': String(i), 'aria-label': 'Толщина ' + (i + 1) }, [dot]);
      sizeEls.push(b);
      optRow.appendChild(b);
    });
    const clearBtn = el('button', { class: 'gd__btn is-danger', type: 'button', text: 'Стереть всё' });
    const bar = el('div', { class: 'gd__bar', hidden: '', role: 'toolbar', 'aria-label': 'Рисование' },
      [toolRow, optRow, el('div', { class: 'gd__row' }, [clearBtn])]);
    main.appendChild(bar);

    function updateUi() {
      Object.keys(toolEls).forEach(function (k) {
        const on = k === tool;
        toolEls[k].classList.toggle('on', on);
        toolEls[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      Object.keys(swEls).forEach(function (k) { swEls[k].classList.toggle('on', k === color); });
      sizeEls.forEach(function (b, i) { b.classList.toggle('on', i === sizeIdx); });
      optRow.hidden = tool === 'eraser' || tool === 'hand';
      pad.classList.toggle('hand', tool === 'hand');
    }

    bar.addEventListener('click', function (e) {
      const t = e.target.closest('[data-tool]');
      if (t && has(toolEls, t.dataset.tool)) { cancelCur(); tool = t.dataset.tool; updateUi(); return; }
      const c = e.target.closest('[data-color]');
      if (c && has(COLORS, c.dataset.color)) { color = c.dataset.color; updateUi(); return; }
      const s = e.target.closest('[data-size]');
      if (s) { sizeIdx = Math.max(0, Math.min(3, Number(s.dataset.size) || 0)); updateUi(); }
    });
    doneBtn.addEventListener('click', function () { exit(); });
    clearBtn.addEventListener('click', clearAll);

    /* ---------- Вход и выход ---------- */
    function enter() {
      if (dead || active) return;
      active = true;
      if (ctx.onEnter) ctx.onEnter();
      stage.classList.add('is-drawing');
      main.classList.add('is-draw');
      bar.hidden = false;
      pad.hidden = false;
      updateUi();
    }

    function exit() {
      if (!active) return;
      cancelCur();
      active = false;
      stage.classList.remove('is-drawing');
      main.classList.remove('is-draw');
      bar.hidden = true;
      pad.hidden = true;
    }

    /* ---------- Координаты ---------- */
    function toWorld(ev) {
      const v = vp.getView();
      const r = cam.r;
      return [v.cx + (ev.clientX - r.left - r.width / 2) / v.zoom, v.cy + (ev.clientY - r.top - r.height / 2) / v.zoom];
    }

    /* ---------- Ластик ---------- */
    function hits(s, p, rad) {
      const a = s.p;
      if (a.length === 2) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= rad;
      for (let i = 0; i < a.length - 2; i += 2) {
        if (segDist(p[0], p[1], a[i], a[i + 1], a[i + 2], a[i + 3]) <= rad) return true;
      }
      return false;
    }

    function eraseAt(p, c) {
      const r = ERASER_PX / vp.getView().zoom;
      const list = data.strokes;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (c.gone.has(s.id)) continue;
        const b = bboxOf(s);
        if (p[0] < b[0] - r || p[0] > b[2] + r || p[1] < b[1] - r || p[1] > b[3] + r) continue;
        if (hits(s, p, r + s.w / 2)) {
          c.gone.add(s.id);
          const e = els.get(s.id);
          if (e) e.style.display = 'none';
        }
      }
    }

    function eraseLine(a, b, c) {
      const step = Math.max(1, 10 / vp.getView().zoom);
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 1; k <= n; k++) eraseAt([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], c);
    }

    function finishErase(c) {
      if (!c.gone.size) return;
      c.gone.forEach(function (id) {
        const e = els.get(id);
        if (e) e.remove();
        els.delete(id);
        bboxes.delete(id);
      });
      data.strokes = data.strokes.filter(function (s) { return !c.gone.has(s.id); });
      ctx.commit();
    }

    /* ---------- Штрих ---------- */
    function schedule() { if (!raf) raf = requestAnimationFrame(flush); }

    function flush() {
      raf = 0;
      if (cur && cur.kind === 'draw' && cur.dirty) {
        cur.path.setAttribute('d', pathD(flat(cur.pts)));
        cur.dirty = false;
      }
    }

    function cancelCur() {
      const c = cur;
      cur = null;
      if (!c) return;
      if (c.kind === 'draw') { c.path.remove(); }
      else { c.gone.forEach(function (id) { const e = els.get(id); if (e) e.style.display = ''; }); }
    }

    function finishDraw(c) {
      const zoom = vp.getView().zoom;
      let pts = c.pts.length > 2 ? simplify(c.pts, 0.7 / zoom) : c.pts;
      if (pts.length > MAX_POINTS) {
        const k = Math.ceil(pts.length / MAX_POINTS);
        pts = pts.filter(function (_, i) { return i % k === 0 || i === pts.length - 1; }).slice(0, MAX_POINTS);
      }
      const s = { id: VOID.crypto.randomId(), c: c.s.c, k: c.s.k, w: c.s.w, p: flat(pts) };
      data.strokes.push(s);
      c.path.setAttribute('d', pathD(s.p));
      c.path.setAttribute('data-sid', s.id);
      els.set(s.id, c.path);
      ctx.commit();
    }

    /* ---------- События накладки ---------- */
    function onDown(ev) {
      if (!active || tool === 'hand') return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.stopPropagation(); // полотно не должно двигаться вместе с рисованием
      down.add(ev.pointerId);
      if (down.size > 1) { cancelCur(); return; } // второй палец отменяет штрих
      ev.preventDefault();
      try { pad.setPointerCapture(ev.pointerId); } catch (_) { /* не критично */ }
      cam.r = stage.getBoundingClientRect();
      const p = toWorld(ev);
      if (tool === 'eraser') {
        cur = { kind: 'erase', pid: ev.pointerId, last: p, gone: new Set() };
        eraseAt(p, cur);
        return;
      }
      if (data.strokes.length >= MAX_STROKES || totalPoints() >= MAX_TOTAL) {
        toast('Слишком много рисунков на доске. Сотрите часть.', 'error', 3000);
        return;
      }
      ensureLayer();
      const s = { c: color, k: tool === 'hl' ? 'hl' : 'pen', w: SIZES[tool === 'hl' ? 'hl' : 'pen'][sizeIdx] };
      const path = makeEl({ id: '', c: s.c, k: s.k, w: s.w, p: [p[0], p[1]] });
      layer.appendChild(path);
      cur = { kind: 'draw', pid: ev.pointerId, pts: [p], s: s, path: path, dirty: false };
    }

    function addPoint(ev) {
      const p = toWorld(ev);
      if (cur.kind === 'erase') { eraseLine(cur.last, p, cur); cur.last = p; return; }
      const last = cur.pts[cur.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.4 / vp.getView().zoom) return;
      if (cur.pts.length >= MAX_RAW) return;
      cur.pts.push(p);
      cur.dirty = true;
    }

    function onMove(ev) {
      if (!active || !cur || ev.pointerId !== cur.pid) return;
      ev.stopPropagation();
      const list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
      const evs = list && list.length ? list : [ev];
      for (let i = 0; i < evs.length; i++) addPoint(evs[i]);
      schedule();
    }

    function onUp(ev) {
      down.delete(ev.pointerId);
      if (!cur || ev.pointerId !== cur.pid) return;
      ev.stopPropagation();
      const c = cur;
      cur = null;
      try { pad.releasePointerCapture(ev.pointerId); } catch (_) { /* уже освобождён */ }
      if (c.kind === 'erase') {
        if (ev.type === 'pointercancel') { c.gone.forEach(function (id) { const e = els.get(id); if (e) e.style.display = ''; }); }
        else finishErase(c);
        return;
      }
      if (ev.type === 'pointercancel') { c.path.remove(); return; }
      finishDraw(c);
    }

    function onContextMenu(ev) { ev.preventDefault(); }

    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onUp);
    pad.addEventListener('pointercancel', onUp);
    pad.addEventListener('contextmenu', onContextMenu);

    /* ---------- «Стереть всё» ---------- */
    function clearAll() {
      if (!data.strokes.length) { toast('Рисунков на доске нет', 'info', 1500); return; }
      ctx.confirm({ title: 'Стереть все рисунки?',
        text: 'Все рисунки на этой доске будут удалены. Это можно отменить кнопкой «Отменить».',
        confirmText: 'Стереть' }).then(function (ok) {
        if (!ok || dead) return;
        data.strokes = [];
        els.clear();
        bboxes.clear();
        if (layer) layer.textContent = '';
        ctx.commit();
      });
    }

    function bounds() {
      if (!data.strokes.length) return null;
      let b = null;
      data.strokes.forEach(function (s) {
        const x = bboxOf(s);
        if (!b) b = { minX: x[0], minY: x[1], maxX: x[2], maxY: x[3] };
        else {
          b.minX = Math.min(b.minX, x[0]); b.minY = Math.min(b.minY, x[1]);
          b.maxX = Math.max(b.maxX, x[2]); b.maxY = Math.max(b.maxY, x[3]);
        }
      });
      return b;
    }

    function detach() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      cur = null;
      active = false;
      stage.classList.remove('is-drawing');
      main.classList.remove('is-draw');
      pad.remove();
      bar.remove();
      if (layer) layer.remove();
      els.clear();
      bboxes.clear();
      down.clear();
    }

    return { renderAll: renderAll, enter: enter, exit: exit, isActive: function () { return active; },
      bounds: bounds, detach: detach };
  }

  VOID.graphDraw = { attach: attach };
})();