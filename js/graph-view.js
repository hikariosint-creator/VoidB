/* ===== VOID GRAPH — холст: перемещение, масштаб, сетка (этап B) =====
   Управление: один палец или мышь двигают полотно, два пальца дают масштаб и сдвиг,
   колесо мыши масштабирует к курсору.
   Положение хранится как «центр экрана в координатах доски» + масштаб,
   поэтому не ломается при повороте экрана и появлении клавиатуры.
   Сетка рисуется одним CSS-фоном (без сотен элементов), поэтому работает быстро. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 4;
  const TAP_MOVE = 6;   // px: сдвиг меньше этого считается нажатием
  const TAP_TIME = 400; // мс

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /** opts: { stage, world, grid, onChange(view), onTap(event, worldPoint), shouldPan(event) } */
  function createViewport(opts) {
    const stage = opts.stage;
    const world = opts.world;
    const gridEl = opts.grid;
    const view = { cx: 0, cy: 0, zoom: 1 };
    const grid = { mode: 'dots', size: 24 };
    const pointers = new Map();
    let gesture = null;
    let W = 0, H = 0;
    let raf = 0, animId = 0, destroyed = false, ro = null, lastGridKey = '';

    function measure() { W = stage.clientWidth; H = stage.clientHeight; }

    function schedule() {
      if (!raf && !destroyed) raf = requestAnimationFrame(apply);
    }

    /* ---------- Сетка ---------- */
    function drawGrid(tx, ty, z) {
      if (grid.mode === 'none') {
        if (lastGridKey !== 'none') { gridEl.style.backgroundImage = 'none'; lastGridKey = 'none'; }
        return;
      }
      let s = grid.size * z;
      while (s < 12) s *= 5; // при сильном уменьшении сетка становится реже
      const mod = function (v) { return ((v % s) + s) % s; };
      const key = grid.mode + '|' + s.toFixed(2);
      if (grid.mode === 'dots') {
        gridEl.style.backgroundImage = 'radial-gradient(circle, rgba(255,255,255,0.26) 1px, transparent 1.7px)';
        gridEl.style.backgroundPosition = mod(tx - s / 2) + 'px ' + mod(ty - s / 2) + 'px';
      } else {
        gridEl.style.backgroundImage =
          'linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)';
        gridEl.style.backgroundPosition = mod(tx) + 'px ' + mod(ty) + 'px';
      }
      if (key !== lastGridKey) { gridEl.style.backgroundSize = s + 'px ' + s + 'px'; lastGridKey = key; }
    }

    function apply() {
      raf = 0;
      if (destroyed) return;
      const z = view.zoom;
      const tx = W / 2 - view.cx * z;
      const ty = H / 2 - view.cy * z;
      world.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + z + ')';
      drawGrid(tx, ty, z);
      if (opts.onChange) opts.onChange({ cx: view.cx, cy: view.cy, zoom: view.zoom });
    }

    /* ---------- Положение ---------- */
    function getView() { return { cx: view.cx, cy: view.cy, zoom: view.zoom }; }

    function setView(v) {
      if (!v) return;
      if (Number.isFinite(v.cx)) view.cx = v.cx;
      if (Number.isFinite(v.cy)) view.cy = v.cy;
      if (Number.isFinite(v.zoom)) view.zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
      schedule();
    }

    function setGrid(mode, size) {
      grid.mode = mode;
      if (Number.isFinite(size) && size > 0) grid.size = size;
      lastGridKey = '';
      schedule();
    }

    function screenToWorld(clientX, clientY) {
      const r = stage.getBoundingClientRect();
      return {
        x: view.cx + (clientX - r.left - W / 2) / view.zoom,
        y: view.cy + (clientY - r.top - H / 2) / view.zoom
      };
    }

    function cancelAnim() { animId++; }

    function animateTo(t, ms) {
      cancelAnim();
      const to = { cx: t.cx, cy: t.cy, zoom: clamp(t.zoom, MIN_ZOOM, MAX_ZOOM) };
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !ms) { setView(to); return; }
      const from = getView();
      const id = animId;
      const t0 = performance.now();
      (function step(now) {
        if (id !== animId || destroyed) return;
        const k = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        view.zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
        view.cx = from.cx + (to.cx - from.cx) * e;
        view.cy = from.cy + (to.cy - from.cy) * e;
        apply();
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }

    /** Масштаб с сохранением точки под пальцем/курсором. */
    function zoomAt(factor, clientX, clientY) {
      const r = stage.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      const wx = view.cx + (px - W / 2) / view.zoom;
      const wy = view.cy + (py - H / 2) / view.zoom;
      view.zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      view.cx = wx - (px - W / 2) / view.zoom;
      view.cy = wy - (py - H / 2) / view.zoom;
      schedule();
    }

    /** Кнопки +/−: масштаб относительно центра экрана. */
    function zoomBy(factor) {
      animateTo({ cx: view.cx, cy: view.cy, zoom: view.zoom * factor }, 160);
    }

    /** Показать всё содержимое. bounds: {minX, minY, maxX, maxY} или null (пустая доска). */
    function fit(bounds, pad) {
      const p = pad == null ? 60 : pad;
      if (!bounds) { animateTo({ cx: 0, cy: 0, zoom: 1 }, 260); return; }
      const w = Math.max(1, bounds.maxX - bounds.minX);
      const h = Math.max(1, bounds.maxY - bounds.minY);
      const z = clamp(Math.min((W - p * 2) / w, (H - p * 2) / h), MIN_ZOOM, 1.5);
      animateTo({ cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, zoom: z }, 260);
    }

    /* ---------- Жесты ---------- */
    function startGesture() {
      const ids = Array.from(pointers.keys());
      if (ids.length === 1) {
        const p = pointers.get(ids[0]);
        gesture = { type: 'pan', id: ids[0], lastX: p.x, lastY: p.y, startX: p.x, startY: p.y,
          t0: performance.now(), moved: false };
      } else if (ids.length >= 2) {
        const a = pointers.get(ids[0]);
        const b = pointers.get(ids[1]);
        const r = stage.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        gesture = {
          type: 'pinch', a: ids[0], b: ids[1],
          dist0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: view.zoom,
          wx: view.cx + (mx - W / 2) / view.zoom, wy: view.cy + (my - H / 2) / view.zoom
        };
        stage.classList.add('panning');
      }
    }

    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      if (opts.shouldPan && pointers.size === 0 && !opts.shouldPan(e)) return;
      cancelAnim();
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      startGesture();
    }

    function onMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (!gesture) return;
      if (gesture.type === 'pan' && gesture.id === e.pointerId) {
        const dx = p.x - gesture.lastX;
        const dy = p.y - gesture.lastY;
        gesture.lastX = p.x;
        gesture.lastY = p.y;
        if (!gesture.moved && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > TAP_MOVE) {
          gesture.moved = true;
          stage.classList.add('panning');
        }
        if (gesture.moved) {
          view.cx -= dx / view.zoom;
          view.cy -= dy / view.zoom;
          schedule();
        }
      } else if (gesture.type === 'pinch') {
        const a = pointers.get(gesture.a);
        const b = pointers.get(gesture.b);
        if (!a || !b) return;
        const r = stage.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        view.zoom = clamp(gesture.z0 * dist / gesture.dist0, MIN_ZOOM, MAX_ZOOM);
        view.cx = gesture.wx - (mx - W / 2) / view.zoom;
        view.cy = gesture.wy - (my - H / 2) / view.zoom;
        schedule();
      }
    }

    function onUp(e) {
      if (!pointers.has(e.pointerId)) return;
      const g = gesture;
      pointers.delete(e.pointerId);
      try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* уже освобождён */ }

      if (g && g.type === 'pan' && g.id === e.pointerId) {
        if (e.type === 'pointerup' && !g.moved && performance.now() - g.t0 < TAP_TIME && opts.onTap) {
          opts.onTap(e, screenToWorld(e.clientX, e.clientY));
        }
        gesture = null;
      } else if (g && g.type === 'pinch') {
        gesture = null;
        if (pointers.size >= 1) {
          startGesture();
          if (gesture && gesture.type === 'pan') gesture.moved = true; // после щипка нажатия не бывает
        }
      }
      if (!pointers.size) { gesture = null; stage.classList.remove('panning'); }
    }

    function onWheel(e) {
      e.preventDefault();
      cancelAnim();
      const speed = e.ctrlKey ? 0.01 : 0.0015; // щипок на тачпаде приходит как ctrl + колесо
      zoomAt(Math.exp(-e.deltaY * speed), e.clientX, e.clientY);
    }

    function onContextMenu(e) { e.preventDefault(); } // долгое нажатие не должно открывать меню браузера

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', onContextMenu);

    measure();
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function () { measure(); schedule(); });
      ro.observe(stage);
    }
    window.addEventListener('resize', onWindowResize);
    function onWindowResize() { measure(); schedule(); }

    function destroy() {
      destroyed = true;
      cancelAnim();
      if (raf) cancelAnimationFrame(raf);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', onWindowResize);
      if (ro) ro.disconnect();
      pointers.clear();
      stage.classList.remove('panning');
    }

    return {
      getView: getView, setView: setView, setGrid: setGrid, screenToWorld: screenToWorld,
      animateTo: animateTo, zoomBy: zoomBy, fit: fit, destroy: destroy,
      resize: function () { measure(); schedule(); }
    };
  }

  VOID.graphView = { createViewport: createViewport, MIN_ZOOM: MIN_ZOOM, MAX_ZOOM: MAX_ZOOM };
})();