/* ===== VOID GRAPH — связи и стрелки (этапы D и G1) =====
   Связь: { id, from, to, style:'straight|curve|elbow', arrow:'none|end|both', dashed, label, color,
            w (толщина), hs (размер наконечника), bend:{x,y} (изгиб) }.
   Конец связи: {node, side} — привязан к стороне объекта (t, r, b, l), либо {x, y} — свободный.
   Связь без привязок (оба конца свободны) — самостоятельная стрелка.
   Изгиб: у кривой bend — смещение середины кривой от стандартной формы; у «угла» — сдвиг средней части.
   Линии рисует SVG-слой под объектами, ручки (концы и изгиб) — слой над ними.
   Историю (отмена/повтор) и сохранение ведёт редактор: сюда передаётся его commit(). */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID GRAPH: не загружен ui.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';

  const SIDES = ['t', 'r', 'b', 'l'];
  const STYLES = ['straight', 'curve', 'elbow'];
  const STYLE_LABEL = { straight: 'Линия: прямая', curve: 'Линия: изгиб', elbow: 'Линия: угол' };
  const ARROWS = ['none', 'end', 'both'];
  const ARROW_CYCLE = ['end', 'both', 'none'];
  const ARROW_LABEL = { end: 'Стрелка →', both: 'Стрелки ↔', none: 'Без стрелки' };
  const COLORS = { gray: '#9a9a9a', white: '#F0F0F0', red: '#C03945', blue: '#5588BF', green: '#5FA46F', amber: '#C48A2B', violet: '#9566BF' };
  const COLOR_LABELS = { gray: 'Серый', white: 'Белый', red: 'Красный', blue: 'Синий', green: 'Зелёный', amber: 'Янтарный', violet: 'Фиолетовый' };
  const COLOR_IDS = Object.keys(COLORS);
  const WIDTHS = [1.5, 2.5, 4, 6, 9, 13];
  const HEADS = [0.6, 0.8, 1, 1.3, 1.7, 2.2];

  const STUB = 28;        // выступ линии от объекта при изгибах
  const MAX_EDGES = 2000;
  const MAX_LABEL = 100;
  const TAP_MOVE = 6;
  const TAP_TIME = 450;
  const BEND_SLOP = 6;
  const ZERO = { x: 0, y: 0 };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function num(v, d, a, b) { return Number.isFinite(v) ? clamp(v, a, b) : d; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /* ---------- Приведение данных к безопасному виду ---------- */
  function cleanEnd(r, nodeMap, defSide) {
    if (!r || typeof r !== 'object') return null;
    if (typeof r.node === 'string') {
      if (!nodeMap.has(r.node)) return null;
      return { node: r.node, side: SIDES.indexOf(r.side) >= 0 ? r.side : defSide };
    }
    if (Number.isFinite(r.x) && Number.isFinite(r.y)) return { x: clamp(r.x, -1e6, 1e6), y: clamp(r.y, -1e6, 1e6) };
    return null;
  }

  function cleanEdge(r, nodeMap) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
    const from = cleanEnd(r.from, nodeMap, 'r');
    const to = cleanEnd(r.to, nodeMap, 'l');
    if (!from || !to) return null;
    if (from.node && to.node && from.node === to.node) return null;
    const b = r.bend && typeof r.bend === 'object' ? r.bend : {};
    return {
      id: r.id, from: from, to: to,
      style: STYLES.indexOf(r.style) >= 0 ? r.style : 'straight',
      arrow: ARROWS.indexOf(r.arrow) >= 0 ? r.arrow : 'end',
      dashed: r.dashed === true,
      label: str(r.label).slice(0, MAX_LABEL),
      color: (typeof r.color === 'string' && has(COLORS, r.color)) ? r.color : 'gray',
      w: num(r.w, 2.5, 1, 20),
      hs: num(r.hs, 1, 0.4, 3),
      bend: { x: num(b.x, 0, -1e5, 1e5), y: num(b.y, 0, -1e5, 1e5) }
    };
  }

  /* ---------- Геометрия ---------- */
  function anchor(n, side) {
    if (side === 't') return { x: n.x + n.w / 2, y: n.y, dx: 0, dy: -1 };
    if (side === 'b') return { x: n.x + n.w / 2, y: n.y + n.h, dx: 0, dy: 1 };
    if (side === 'l') return { x: n.x, y: n.y + n.h / 2, dx: -1, dy: 0 };
    return { x: n.x + n.w, y: n.y + n.h / 2, dx: 1, dy: 0 };
  }

  /** Стороны двух объектов, обращённые друг к другу. */
  function autoSides(a, b) {
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    const rx = Math.abs(dx) / ((a.w + b.w) / 2);
    const ry = Math.abs(dy) / ((a.h + b.h) / 2);
    if (rx >= ry) return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
    return dy >= 0 ? ['b', 't'] : ['t', 'b'];
  }

  /** Сторона объекта, ближайшая к точке. */
  function nearestSide(n, px, py) {
    let best = 'l', bd = Infinity;
    SIDES.forEach(function (s) {
      const a = anchor(n, s);
      const d = Math.hypot(a.x - px, a.y - py);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }

  /** Положение конца: привязанный к объекту (с направлением выхода) или свободный. */
  function endInfo(end, nodeMap) {
    if (end.node) {
      const n = nodeMap.get(end.node);
      if (!n) return null;
      const a = anchor(n, end.side);
      return { x: a.x, y: a.y, dx: a.dx, dy: a.dy, attached: true };
    }
    return { x: end.x, y: end.y, dx: 0, dy: 0, attached: false };
  }

  function unit(dx, dy) {
    const l = Math.hypot(dx, dy);
    return l > 1e-3 ? [dx / l, dy / l] : null;
  }

  function cubicAt(P, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]];
  }

  function splitCubic(P, t) {
    const l = function (a, b) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    const p01 = l(P[0], P[1]), p12 = l(P[1], P[2]), p23 = l(P[2], P[3]);
    const p012 = l(p01, p12), p123 = l(p12, p23);
    const m = l(p012, p123);
    return { left: [P[0], p01, p012, m], right: [m, p123, p23, P[3]] };
  }

  function subCubic(P, t0, t1) {
    let Q = splitCubic(P, t1).left;
    if (t0 > 0) Q = splitCubic(Q, t0 / t1).right;
    return Q;
  }

  function tAtDistFromEnd(P, s) {
    const tip = P[3];
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const q = cubicAt(P, mid);
      if (Math.hypot(q[0] - tip[0], q[1] - tip[1]) > s) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function tAtDistFromStart(P, s) {
    const tip = P[0];
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const q = cubicAt(P, mid);
      if (Math.hypot(q[0] - tip[0], q[1] - tip[1]) < s) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Кривая Безье: направления выхода из объектов + смещение bend (середина кривой сдвигается ровно на bend). */
  function curveCtrl(A, B, bend) {
    const dist = Math.hypot(B.x - A.x, B.y - A.y);
    const k = Math.min(260, Math.max(36, dist * 0.45));
    const c1 = A.attached ? [A.x + A.dx * k, A.y + A.dy * k] : [A.x + (B.x - A.x) / 3, A.y + (B.y - A.y) / 3];
    const c2 = B.attached ? [B.x + B.dx * k, B.y + B.dy * k] : [B.x + (A.x - B.x) / 3, B.y + (A.y - B.y) / 3];
    const hx = bend.x * 4 / 3, hy = bend.y * 4 / 3;
    return [[A.x, A.y], [c1[0] + hx, c1[1] + hy], [c2[0] + hx, c2[1] + hy], [B.x, B.y]];
  }

  function cubicD(P) {
    return 'M' + P[0][0] + ' ' + P[0][1] + 'C' + P[1][0] + ' ' + P[1][1] + ' ' + P[2][0] + ' ' + P[2][1] + ' ' + P[3][0] + ' ' + P[3][1];
  }

  function dirOf(tip, a, b, c) {
    return unit(tip[0] - a[0], tip[1] - a[1]) || unit(tip[0] - b[0], tip[1] - b[1]) ||
      unit(tip[0] - c[0], tip[1] - c[1]) || [1, 0];
  }

  function dedupe(pts) {
    const out = [];
    pts.forEach(function (p) {
      const l = out[out.length - 1];
      if (!l || Math.abs(l[0] - p[0]) > 0.01 || Math.abs(l[1] - p[1]) > 0.01) out.push(p);
    });
    return out.length >= 2 ? out : [pts[0], pts[pts.length - 1]];
  }

  /** Линия с прямыми углами. info описывает среднюю часть, которую можно двигать (изгиб). */
  function elbowRoute(A, B, bend) {
    const aS = A.attached ? [A.x + A.dx * STUB, A.y + A.dy * STUB] : [A.x, A.y];
    const bS = B.attached ? [B.x + B.dx * STUB, B.y + B.dy * STUB] : [B.x, B.y];
    let ao = A.attached ? (A.dx !== 0 ? 'h' : 'v') : null;
    let bo = B.attached ? (B.dx !== 0 ? 'h' : 'v') : null;
    if (!ao && !bo) ao = bo = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y) ? 'h' : 'v';
    else if (!ao) ao = bo;
    else if (!bo) bo = ao;
    const pts = [[A.x, A.y]];
    if (A.attached) pts.push(aS);
    let info = null;
    if (ao === 'h' && bo === 'h') {
      const base = (aS[0] + bS[0]) / 2;
      const mx = base + bend.x;
      pts.push([mx, aS[1]], [mx, bS[1]]);
      info = { axis: 'x', base: base, at: [mx, (aS[1] + bS[1]) / 2] };
    } else if (ao === 'v' && bo === 'v') {
      const base = (aS[1] + bS[1]) / 2;
      const my = base + bend.y;
      pts.push([aS[0], my], [bS[0], my]);
      info = { axis: 'y', base: base, at: [(aS[0] + bS[0]) / 2, my] };
    } else if (ao === 'h') {
      pts.push([bS[0], aS[1]]);
    } else {
      pts.push([aS[0], bS[1]]);
    }
    if (B.attached) pts.push(bS);
    pts.push([B.x, B.y]);
    return { pts: dedupe(pts), info: info };
  }

  function polyD(pts) { return 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L'); }

  function polyLen(pts) {
    let t = 0;
    for (let i = 0; i < pts.length - 1; i++) t += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    return t;
  }

  function midPoint(pts) {
    const lens = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      lens.push(l);
      total += l;
    }
    let half = total / 2;
    for (let i = 0; i < lens.length; i++) {
      if (half <= lens[i]) {
        const t = lens[i] ? half / lens[i] : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      }
      half -= lens[i];
    }
    return pts[0];
  }

  function dirEnd(pts) {
    for (let i = pts.length - 1; i >= 1; i--) {
      const u = unit(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (u) return u;
    }
    return [1, 0];
  }

  function dirStart(pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      const u = unit(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]);
      if (u) return u;
    }
    return [-1, 0];
  }

  /** Укорачивает ломаную с конца на s единиц (линия не должна торчать из наконечника). */
  function shortenEnd(pts, s) {
    const out = pts.map(function (p) { return p.slice(); });
    let rem = s;
    while (out.length >= 2 && rem > 0) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > rem) {
        const t = (len - rem) / len;
        out[out.length - 1] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        rem = 0;
      } else if (out.length > 2) {
        out.pop();
        rem -= len;
      } else {
        break;
      }
    }
    return out;
  }

  function headPoints(tip, u, L, W) {
    const bx = tip[0] - u[0] * L, by = tip[1] - u[1] * L;
    const nx = -u[1] * W, ny = u[0] * W;
    return tip[0] + ',' + tip[1] + ' ' + (bx + nx) + ',' + (by + ny) + ' ' + (bx - nx) + ',' + (by - ny);
  }

  /** Вся геометрия связи: пути, наконечники, середина, положение ручки изгиба. */
  function geom(e, nodeMap) {
    const A = endInfo(e.from, nodeMap);
    const B = endInfo(e.to, nodeMap);
    if (!A || !B) return null;
    const headL = (9 + e.w * 2.2) * e.hs;
    const hasEnd = e.arrow === 'end' || e.arrow === 'both';
    const hasStart = e.arrow === 'both';
    const g = { A: A, B: B, headL: headL, full: '', line: '', mid: [0, 0], handle: null, endDir: [1, 0], startDir: [-1, 0] };
    if (e.style === 'curve') {
      const P = curveCtrl(A, B, e.bend);
      g.apex = cubicAt(P, 0.5);
      g.mid = g.apex;
      g.handle = g.apex;
      g.full = cubicD(P);
      g.endDir = dirOf(P[3], P[2], P[1], P[0]);
      g.startDir = dirOf(P[0], P[1], P[2], P[3]);
      const chord = Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1]);
      const s = Math.min(headL * 0.85, Math.max(0, chord * 0.4));
      let t0 = 0, t1 = 1;
      if (hasEnd) t1 = tAtDistFromEnd(P, s);
      if (hasStart) t0 = tAtDistFromStart(P, s);
      if (t1 - t0 < 0.08) { t0 = 0; t1 = 1; }
      g.line = (t0 > 0 || t1 < 1) ? cubicD(subCubic(P, t0, t1)) : g.full;
    } else {
      let pts, info = null;
      if (e.style === 'elbow') { const r = elbowRoute(A, B, e.bend); pts = r.pts; info = r.info; }
      else pts = [[A.x, A.y], [B.x, B.y]];
      g.full = polyD(pts);
      g.mid = midPoint(pts);
      g.handle = e.style === 'elbow' ? (info ? info.at : null) : g.mid;
      g.endDir = dirEnd(pts);
      g.startDir = dirStart(pts);
      const s = Math.min(headL * 0.85, polyLen(pts) * 0.45);
      let lp = pts;
      if (hasEnd) lp = shortenEnd(lp, s);
      if (hasStart) lp = shortenEnd(lp.slice().reverse(), s).reverse();
      g.line = polyD(lp);
    }
    return g;
  }

  /* =====================================================
     Подключение к редактору
     ===================================================== */
  function attach(ctx) {
    const data = ctx.data;
    const nodeMap = ctx.nodeMap;
    const vp = ctx.vp;
    const stage = ctx.stage;
    const world = ctx.world;
    const toast = ctx.toast || function () {};
    const snap = ctx.snap || function (v) { return Math.round(v); };

    const recs = new Map();   // id связи -> { g, hit, line, h1, h2, lbl }
    const dirty = new Set();  // объекты, сдвинутые с прошлого кадра
    const dots = [];          // точки подключения выделенного объекта
    const hEls = { from: null, to: null, bend: null };
    let layer = null, hLayer = null, tmp = null;
    let selEdge = null;
    let linking = null;       // режим «Связать»: { from }
    let drag = null;          // перетаскивание ручки или тела выделенной связи
    let cdrag = null;         // протягивание новой связи от точки подключения
    let pend = null;          // нажатие на линию, ожидающее отпускания
    let hoverId = null;
    let raf = 0;
    let dead = false;

    function findEdge(id) {
      return data.edges.find(function (e) { return e && e.id === id; }) || null;
    }
    function isFree(e) { return !e.from.node && !e.to.node; }

    /* ---------- Слои и отрисовка ---------- */
    function ensureLayer() {
      if (!layer) {
        layer = svgEl('svg', { class: 'ge', width: '1', height: '1', 'aria-hidden': 'true' });
        layer.addEventListener('pointerdown', onLayerDown);
      }
      if (!hLayer) {
        hLayer = svgEl('svg', { class: 'ge ge--top', width: '1', height: '1', 'aria-hidden': 'true' });
        tmp = svgEl('path', { class: 'ge__tmp' });
        tmp.style.display = 'none';
        hLayer.appendChild(tmp);
        hLayer.addEventListener('pointerdown', onLayerDown);
      }
      if (layer.parentNode !== world) world.insertBefore(layer, world.firstChild);
      if (hLayer.parentNode !== world) world.appendChild(hLayer);
    }

    function createRec(e) {
      const g = svgEl('g', { class: 'ge__g', 'data-eid': e.id });
      const hit = svgEl('path', { class: 'ge__hit' });
      const line = svgEl('path', { class: 'ge__line' });
      const h1 = svgEl('polygon', { class: 'ge__head' });
      const h2 = svgEl('polygon', { class: 'ge__head' });
      const lbl = svgEl('text', { class: 'ge__lbl' });
      g.append(hit, line, h1, h2, lbl);
      layer.appendChild(g);
      const rec = { g: g, hit: hit, line: line, h1: h1, h2: h2, lbl: lbl };
      recs.set(e.id, rec);
      return rec;
    }

    function draw(rec, e) {
      const g = geom(e, nodeMap);
      if (!g) { rec.g.style.display = 'none'; return null; }
      rec.g.style.display = '';
      const col = COLORS[e.color];
      rec.hit.setAttribute('d', g.full);
      rec.hit.setAttribute('data-movable', isFree(e) ? '1' : '');
      rec.line.setAttribute('d', g.line);
      rec.line.setAttribute('stroke', col);
      rec.line.style.setProperty('--w', String(e.w));
      if (e.dashed) rec.line.setAttribute('stroke-dasharray', Math.round(e.w * 3 + 5) + ' ' + Math.round(e.w * 2 + 4));
      else rec.line.removeAttribute('stroke-dasharray');

      const hasEnd = e.arrow === 'end' || e.arrow === 'both';
      const hasStart = e.arrow === 'both';
      const hw = g.headL * 0.46;
      [[rec.h1, hasEnd ? headPoints([g.B.x, g.B.y], g.endDir, g.headL, hw) : null],
       [rec.h2, hasStart ? headPoints([g.A.x, g.A.y], g.startDir, g.headL, hw) : null]].forEach(function (pair) {
        const h = pair[0], pts = pair[1];
        if (!pts) { h.style.display = 'none'; return; }
        h.style.display = '';
        h.setAttribute('points', pts);
        h.setAttribute('fill', col);
        h.setAttribute('stroke', col);
        h.setAttribute('stroke-width', '1');
      });

      if (e.label) {
        rec.lbl.textContent = e.label;
        rec.lbl.setAttribute('x', g.mid[0]);
        rec.lbl.setAttribute('y', g.mid[1]);
        rec.lbl.style.display = '';
      } else {
        rec.lbl.textContent = '';
        rec.lbl.style.display = 'none';
      }
      return g;
    }

    /** Полная перерисовка всех связей (после отмены, удаления, правки). */
    function renderAll() {
      if (dead) return;
      ensureLayer();
      data.edges = data.edges.map(function (r) { return cleanEdge(r, nodeMap); }).filter(Boolean);
      const seen = new Set();
      data.edges = data.edges.filter(function (e) {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      }).slice(0, MAX_EDGES);
      recs.forEach(function (r) { r.g.remove(); });
      recs.clear();
      data.edges.forEach(function (e) { draw(createRec(e), e); });
      if (selEdge && !recs.has(selEdge)) selEdge = null;
      if (selEdge) recs.get(selEdge).g.classList.add('sel');
      renderHandles();
      updateEdgeBar();
    }

    /** Сдвиг объекта: пересчитываем только связанные с ним связи (не чаще раза за кадр). */
    function nodeMoved(id) {
      if (dead || !recs.size) return;
      dirty.add(id);
      if (!raf) raf = requestAnimationFrame(flush);
    }

    function flush() {
      raf = 0;
      if (dead) return;
      let touchedSel = false;
      data.edges.forEach(function (e) {
        if (dirty.has(e.from.node) || dirty.has(e.to.node)) {
          const r = recs.get(e.id);
          if (r) draw(r, e);
          if (e.id === selEdge) touchedSel = true;
        }
      });
      dirty.clear();
      if (touchedSel && hEls.from) { const se = findEdge(selEdge); if (se) placeHandles(se); }
    }

    /* ---------- Ручки: концы и изгиб ---------- */
    function setPos(h, x, y) {
      h.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(var(--inv))';
    }

    function mkHandle(kind, x, y, attached) {
      const g = svgEl('g', { class: 'ge__h ge__h--' + kind, 'data-h': kind });
      g.appendChild(svgEl('circle', { class: 'ge__hhit', r: 24 }));
      g.appendChild(svgEl('circle', { class: 'ge__hdot' + (attached ? ' on' : ''), r: kind === 'bend' ? 6 : 8 }));
      setPos(g, x, y);
      return g;
    }

    function clearHandles() {
      ['from', 'to', 'bend'].forEach(function (k) {
        if (hEls[k]) { hEls[k].remove(); hEls[k] = null; }
      });
    }

    function renderHandles() {
      if (!hLayer) return;
      clearHandles();
      const e = selEdge ? findEdge(selEdge) : null;
      if (!e) return;
      const g = geom(e, nodeMap);
      if (!g) return;
      hEls.from = mkHandle('from', g.A.x, g.A.y, g.A.attached);
      hEls.to = mkHandle('to', g.B.x, g.B.y, g.B.attached);
      hLayer.append(hEls.from, hEls.to);
      if (g.handle) {
        hEls.bend = mkHandle('bend', g.handle[0], g.handle[1], false);
        hLayer.appendChild(hEls.bend);
      }
    }

    /** Обновление положения ручек на месте (во время перетаскивания, чтобы не терять захват пальца). */
    function placeHandles(e) {
      const g = geom(e, nodeMap);
      if (!g || !hEls.from) return;
      setPos(hEls.from, g.A.x, g.A.y);
      setPos(hEls.to, g.B.x, g.B.y);
      hEls.from.querySelector('.ge__hdot').classList.toggle('on', g.A.attached);
      hEls.to.querySelector('.ge__hdot').classList.toggle('on', g.B.attached);
      if (g.handle && hEls.bend) setPos(hEls.bend, g.handle[0], g.handle[1]);
    }

    /* ---------- Создание и изменение ---------- */
    function pushEdge(from, to) {
      if (data.edges.length >= MAX_EDGES) { toast('Слишком много связей на доске', 'error'); return null; }
      if (from.node && to.node && data.edges.some(function (x) { return x.from.node === from.node && x.to.node === to.node; })) {
        toast('Такая связь уже есть', 'info', 1500);
        return null;
      }
      const e = { id: VOID.crypto.randomId(), from: from, to: to, style: 'straight', arrow: 'end', dashed: false,
        label: '', color: 'gray', w: 2.5, hs: 1, bend: { x: 0, y: 0 } };
      data.edges.push(e);
      ctx.commit();
      selectEdge(e.id);
      return e;
    }

    /** Самостоятельная стрелка в центре экрана (не привязана к объектам). */
    function addFree() {
      const v = vp.getView();
      const len = Math.max(120, Math.min(700, 220 / v.zoom));
      const y = snap(v.cy);
      pushEdge({ x: snap(v.cx - len / 2), y: y }, { x: snap(v.cx + len / 2), y: y });
    }

    function removeEdge(id) {
      data.edges = data.edges.filter(function (e) { return e.id !== id; });
      if (selEdge === id) selEdge = null;
      ctx.commit();
      updateEdgeBar();
      toast('Связь удалена (можно отменить)', 'info', 1800);
    }

    function changed() { ctx.commit(); updateEdgeBar(); }

    /** Перед удалением объектов: привязанные к ним концы становятся свободными, связи между удаляемыми исчезают. */
    function detachNodes(ids) {
      const set = new Set(ids);
      const out = [];
      data.edges.forEach(function (e) {
        const fa = !!(e.from.node && set.has(e.from.node));
        const ta = !!(e.to.node && set.has(e.to.node));
        if (!fa && !ta) { out.push(e); return; }
        if (fa && ta) return;
        const A = endInfo(e.from, nodeMap), B = endInfo(e.to, nodeMap);
        if (!A || !B) return;
        if (fa) e.from = { x: r1(A.x), y: r1(A.y) };
        if (ta) e.to = { x: r1(B.x), y: r1(B.y) };
        out.push(e);
      });
      data.edges = out;
      if (selEdge && !findEdge(selEdge)) selEdge = null;
    }

    function editLabel(e) {
      const id = e.id;
      ctx.askText({ heading: 'Подпись связи', withTitle: false, title: '', text: e.label })
        .then(function (res) {
          if (!res || dead) return;
          const cur = findEdge(id);
          if (!cur) return;
          cur.label = res.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
          changed();
        });
    }

    function stepNearest(arr, v, dir) {
      let bi = 0, bd = Infinity;
      arr.forEach(function (x, i) { const d = Math.abs(x - v); if (d < bd) { bd = d; bi = i; } });
      return arr[clamp(bi + dir, 0, arr.length - 1)];
    }

    /** Длина: растягиваем стрелку по свободным концам (привязанные концы не двигаем). */
    function scaleLen(e, f) {
      const A = endInfo(e.from, nodeMap), B = endInfo(e.to, nodeMap);
      if (!A || !B) return false;
      const aFree = !e.from.node, bFree = !e.to.node;
      if (!aFree && !bFree) return false;
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      if (len < 0.5) return false;
      const k = clamp(len * f, 24, 6000) / len;
      if (aFree && bFree) {
        const cx = (A.x + B.x) / 2, cy = (A.y + B.y) / 2;
        e.from = { x: r1(cx + (A.x - cx) * k), y: r1(cy + (A.y - cy) * k) };
        e.to = { x: r1(cx + (B.x - cx) * k), y: r1(cy + (B.y - cy) * k) };
      } else if (bFree) {
        e.to = { x: r1(A.x + (B.x - A.x) * k), y: r1(A.y + (B.y - A.y) * k) };
      } else {
        e.from = { x: r1(B.x + (A.x - B.x) * k), y: r1(B.y + (A.y - B.y) * k) };
      }
      e.bend = { x: r1(e.bend.x * k), y: r1(e.bend.y * k) };
      return true;
    }

    /* ---------- Выбор связи и панель ---------- */
    const swEls = COLOR_IDS.map(function (id) {
      const b = el('button', { class: 'sw', type: 'button', 'data-ecolor': id, 'aria-label': 'Цвет связи: ' + COLOR_LABELS[id] });
      b.style.background = COLORS[id];
      return b;
    });
    const mk = function (a, text, cls) { return el('button', { type: 'button', 'data-eact': a, class: cls || '', text: text }); };
    const styleBtn = mk('style', '');
    const arrowBtn = mk('arrow', '');
    const dashBtn = mk('dash', 'Пунктир');
    const labelBtn = mk('label', 'Подпись');
    const reverseBtn = mk('reverse', 'Развернуть');
    const wDown = mk('w-', 'Тоньше');
    const wUp = mk('w+', 'Толще');
    const hDown = mk('h-', 'Наконечник −');
    const hUp = mk('h+', 'Наконечник +');
    const lenDown = mk('len-', 'Короче');
    const lenUp = mk('len+', 'Длиннее');
    const lenBtns = [lenDown, lenUp];
    const delBtn = mk('del', 'Удалить', 'is-danger');
    const edgeBar = el('div', { class: 'gw__sel', hidden: '', role: 'toolbar', 'aria-label': 'Свойства связи' },
      swEls.concat([el('div', { class: 'sep' }), styleBtn, arrowBtn, dashBtn, labelBtn, reverseBtn,
        el('div', { class: 'sep' }), wDown, wUp, hDown, hUp, lenDown, lenUp,
        el('div', { class: 'sep' }), delBtn]));

    function updateEdgeBar() {
      const e = selEdge ? findEdge(selEdge) : null;
      edgeBar.hidden = !e;
      if (!e) return;
      swEls.forEach(function (s) { s.classList.toggle('on', s.dataset.ecolor === e.color); });
      styleBtn.textContent = STYLE_LABEL[e.style];
      arrowBtn.textContent = ARROW_LABEL[e.arrow];
      dashBtn.classList.toggle('is-on', e.dashed);
      labelBtn.textContent = e.label ? 'Подпись…' : 'Подпись';
      const free = !e.from.node || !e.to.node;
      lenBtns.forEach(function (b) { b.hidden = !free; });
    }

    function selectEdge(id) {
      if (!findEdge(id)) return;
      linking = null;
      updateLinkBtn();
      if (ctx.getSel().length) ctx.setSel([]);
      recs.forEach(function (r) { r.g.classList.remove('sel'); });
      selEdge = id;
      const r = recs.get(id);
      if (r) r.g.classList.add('sel');
      renderHandles();
      updateEdgeBar();
    }

    function deselectEdge() {
      if (!selEdge) return;
      const r = recs.get(selEdge);
      if (r) r.g.classList.remove('sel');
      selEdge = null;
      clearHandles();
      updateEdgeBar();
    }

    edgeBar.addEventListener('click', function (ev) {
      const e = selEdge ? findEdge(selEdge) : null;
      if (!e) return;
      const sw = ev.target.closest('[data-ecolor]');
      if (sw) {
        if (has(COLORS, sw.dataset.ecolor)) { e.color = sw.dataset.ecolor; changed(); }
        return;
      }
      const b = ev.target.closest('[data-eact]');
      if (!b) return;
      switch (b.dataset.eact) {
        case 'style':
          e.style = STYLES[(STYLES.indexOf(e.style) + 1) % STYLES.length];
          e.bend = { x: 0, y: 0 };
          changed();
          break;
        case 'arrow': e.arrow = ARROW_CYCLE[(ARROW_CYCLE.indexOf(e.arrow) + 1) % ARROW_CYCLE.length]; changed(); break;
        case 'dash': e.dashed = !e.dashed; changed(); break;
        case 'label': editLabel(e); break;
        case 'reverse': { const t = e.from; e.from = e.to; e.to = t; changed(); break; }
        case 'w-': case 'w+':
          e.w = stepNearest(WIDTHS, e.w, b.dataset.eact === 'w+' ? 1 : -1);
          toast('Толщина: ' + e.w, 'info', 700);
          changed();
          break;
        case 'h-': case 'h+':
          e.hs = stepNearest(HEADS, e.hs, b.dataset.eact === 'h+' ? 1 : -1);
          toast('Наконечник: ×' + e.hs, 'info', 700);
          changed();
          break;
        case 'len-': case 'len+':
          if (scaleLen(e, b.dataset.eact === 'len+' ? 1.25 : 0.8)) changed();
          break;
        case 'del': removeEdge(e.id); break;
        default: break;
      }
    });

    /* ---------- Перетаскивание ручек и тела связи ---------- */
    function hitNode(p, except) {
      const m = 14 / vp.getView().zoom;
      let best = null;
      nodeMap.forEach(function (n) {
        if (n.id === except) return;
        if (p.x >= n.x - m && p.x <= n.x + n.w + m && p.y >= n.y - m && p.y <= n.y + n.h + m) {
          if (!best || n.z >= best.z) best = n;
        }
      });
      return best;
    }

    function setHover(id) {
      if (hoverId === id) return;
      if (hoverId) { const o = ctx.nodeEls.get(hoverId); if (o) o.el.classList.remove('ge-target'); }
      hoverId = id;
      if (id) { const r = ctx.nodeEls.get(id); if (r) r.el.classList.add('ge-target'); }
    }

    function onLayerDown(ev) {
      pend = null;
      if (dead || drag || cdrag) return;
      if (!ev.isPrimary) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const t = ev.target;
      if (!t || !t.closest) return;
      const h = t.closest('[data-h]');
      if (h && selEdge) { startDrag(ev, h.getAttribute('data-h'), h); return; }
      const g = t.closest('[data-eid]');
      if (!g) return;
      const id = g.getAttribute('data-eid');
      const e = findEdge(id);
      if (!e) return;
      if (isFree(e)) {
        selectEdge(id);
        startDrag(ev, 'move', t);
        return;
      }
      pend = { pid: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), id: id };
    }

    function startDrag(ev, kind, capEl) {
      const e = selEdge ? findEdge(selEdge) : null;
      if (!e) return;
      ev.preventDefault();
      try { capEl.setPointerCapture(ev.pointerId); } catch (_) { /* не критично */ }
      drag = { kind: kind, pid: ev.pointerId, id: e.id, sx: ev.clientX, sy: ev.clientY, moved: false,
        orig: JSON.parse(JSON.stringify(e)), p0: vp.screenToWorld(ev.clientX, ev.clientY), el: capEl };
    }

    function moveEnd(e, d, p) {
      const other = d.kind === 'from' ? e.to : e.from;
      const target = hitNode(p, other.node || null);
      setHover(target ? target.id : null);
      const end = target ? { node: target.id, side: nearestSide(target, p.x, p.y) } : { x: snap(p.x), y: snap(p.y) };
      if (d.kind === 'from') e.from = end; else e.to = end;
    }

    function moveBend(e, p) {
      const A = endInfo(e.from, nodeMap), B = endInfo(e.to, nodeMap);
      if (!A || !B) return;
      if (e.style === 'straight') e.style = 'curve'; // прямую линию можно согнуть, потянув за середину
      if (e.style === 'curve') {
        const a0 = cubicAt(curveCtrl(A, B, ZERO), 0.5);
        e.bend = { x: r1(p.x - a0[0]), y: r1(p.y - a0[1]) };
      } else if (e.style === 'elbow') {
        const r = elbowRoute(A, B, ZERO);
        if (r.info) {
          if (r.info.axis === 'x') e.bend = { x: r1(p.x - r.info.base), y: 0 };
          else e.bend = { x: 0, y: r1(p.y - r.info.base) };
        }
      }
    }

    function moveBody(e, d, p) {
      const o = d.orig;
      const nx = snap(o.from.x + (p.x - d.p0.x));
      const ny = snap(o.from.y + (p.y - d.p0.y));
      const ox = nx - o.from.x, oy = ny - o.from.y;
      e.from = { x: r1(o.from.x + ox), y: r1(o.from.y + oy) };
      e.to = { x: r1(o.to.x + ox), y: r1(o.to.y + oy) };
    }

    function onStageMove(ev) {
      const d = drag;
      if (!d || ev.pointerId !== d.pid) return;
      const e = findEdge(d.id);
      if (!e) { drag = null; return; }
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < (d.kind === 'bend' ? BEND_SLOP : 4)) return;
      d.moved = true;
      const p = vp.screenToWorld(ev.clientX, ev.clientY);
      if (d.kind === 'from' || d.kind === 'to') moveEnd(e, d, p);
      else if (d.kind === 'bend') moveBend(e, p);
      else moveBody(e, d, p);
      const rec = recs.get(e.id);
      if (rec) draw(rec, e);
      placeHandles(e);
    }

    function finishDrag(ok) {
      const d = drag;
      drag = null;
      if (!d) return;
      setHover(null);
      try { d.el.releasePointerCapture(d.pid); } catch (_) { /* уже освобождён */ }
      const e = findEdge(d.id);
      if (!e) return;
      if (!ok) {
        const i = data.edges.indexOf(e);
        if (i >= 0) data.edges[i] = d.orig;
        renderAll();
        return;
      }
      if (d.moved) changed();
    }

    // Выполняется после обработчика полотна: фоновое нажатие уже сняло выделение, затем выбираем связь
    function onStageUp(ev) {
      const d = drag;
      if (d && ev.pointerId === d.pid) { finishDrag(ev.type === 'pointerup'); return; }
      const p = pend;
      pend = null;
      if (!p || ev.type !== 'pointerup' || ev.pointerId !== p.pid) return;
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > TAP_MOVE || performance.now() - p.t > TAP_TIME) return;
      selectEdge(p.id);
    }

    /* ---------- Точки подключения ---------- */
    function removeDots() {
      dots.forEach(function (d) { d.remove(); });
      dots.length = 0;
    }

    function addDots(id) {
      const rec = ctx.nodeEls.get(id);
      if (!rec) return;
      SIDES.forEach(function (side) {
        const d = el('div', { class: 'gn__c gn__c--' + side, 'aria-hidden': 'true' });
        d.addEventListener('pointerdown', function (e) { dotDown(e, id, side, d); });
        rec.el.appendChild(d);
        dots.push(d);
      });
    }

    function cancelCdrag() {
      if (!cdrag) return;
      setHover(null);
      cdrag.cleanup();
      if (tmp) tmp.style.display = 'none';
      cdrag = null;
    }

    function dotDown(ev, id, side, dot) {
      if (dead || drag || cdrag) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      const src = nodeMap.get(id);
      if (!src) return;
      try { dot.setPointerCapture(ev.pointerId); } catch (_) { /* не критично */ }
      const A = anchor(src, side);
      const d = { pid: ev.pointerId, id: id, side: side, ax: A.x, ay: A.y, sx: ev.clientX, sy: ev.clientY,
        moved: false, cleanup: null };
      cdrag = d;
      ensureLayer();
      tmp.setAttribute('d', 'M' + A.x + ' ' + A.y + 'L' + A.x + ' ' + A.y);
      tmp.style.display = '';

      const onMove = function (e2) {
        if (e2.pointerId !== d.pid || cdrag !== d) return;
        if (!d.moved && Math.hypot(e2.clientX - d.sx, e2.clientY - d.sy) > TAP_MOVE) d.moved = true;
        const p = vp.screenToWorld(e2.clientX, e2.clientY);
        tmp.setAttribute('d', 'M' + d.ax + ' ' + d.ay + 'L' + p.x + ' ' + p.y);
        const t = hitNode(p, d.id);
        setHover(t ? t.id : null);
      };
      const onUp = function (e2) {
        if (e2.pointerId !== d.pid || cdrag !== d) return;
        const target = hoverId;
        const ok = e2.type === 'pointerup' && d.moved;
        const p = vp.screenToWorld(e2.clientX, e2.clientY);
        cancelCdrag();
        if (!ok) return;
        const tn = target ? nodeMap.get(target) : null;
        if (tn) { pushEdge({ node: d.id, side: d.side }, { node: target, side: nearestSide(tn, d.ax, d.ay) }); return; }
        if (Math.hypot(p.x - d.ax, p.y - d.ay) < 40) { toast('Протяните стрелку дальше или отпустите на другом объекте', 'info', 1800); return; }
        pushEdge({ node: d.id, side: d.side }, { x: snap(p.x), y: snap(p.y) });
      };
      dot.addEventListener('pointermove', onMove);
      dot.addEventListener('pointerup', onUp);
      dot.addEventListener('pointercancel', onUp);
      d.cleanup = function () {
        dot.removeEventListener('pointermove', onMove);
        dot.removeEventListener('pointerup', onUp);
        dot.removeEventListener('pointercancel', onUp);
        try { dot.releasePointerCapture(d.pid); } catch (_) { /* уже освобождён */ }
      };
    }

    /* ---------- Кнопка «Связать» в панели объекта ---------- */
    const linkBtn = el('button', { type: 'button', text: 'Связать', hidden: '' });
    const delNode = ctx.bar.querySelector('[data-act="del"]');
    ctx.bar.insertBefore(linkBtn, delNode);

    function updateLinkBtn() { linkBtn.classList.toggle('is-on', !!linking); }

    function connectAuto(fromId, toId) {
      const a = nodeMap.get(fromId), b = nodeMap.get(toId);
      if (!a || !b) return;
      const s = autoSides(a, b);
      pushEdge({ node: fromId, side: s[0] }, { node: toId, side: s[1] });
    }

    linkBtn.addEventListener('click', function () {
      const ids = ctx.getSel();
      if (ids.length === 2) { connectAuto(ids[0], ids[1]); return; }
      if (ids.length !== 1) return;
      if (linking) { linking = null; updateLinkBtn(); return; }
      linking = { from: ids[0] };
      updateLinkBtn();
      toast('Коснитесь объекта, куда ведёт стрелка', 'info', 2600);
    });

    /** Вызывается редактором при каждом изменении выделения объектов. */
    function onSelection() {
      if (dead) return;
      const ids = ctx.getSel();
      removeDots();
      if (ids.length === 1) addDots(ids[0]);
      linkBtn.hidden = !(ids.length === 1 || ids.length === 2);
      if (ids.length && selEdge) deselectEdge();
      if (!ids.length && linking) { linking = null; updateLinkBtn(); }
      if (linking && ids.length === 1 && ids[0] !== linking.from) {
        const from = linking.from, to = ids[0];
        linking = null;
        updateLinkBtn();
        setTimeout(function () { if (!dead) connectAuto(from, to); }, 0);
      }
    }

    function onBackgroundTap() {
      if (linking) { linking = null; updateLinkBtn(); }
      deselectEdge();
    }

    /* ---------- Клавиатура (для компьютера) ---------- */
    function onKey(e) {
      if (dead || !selEdge) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const m = document.getElementById('modal');
      if (m && !m.hidden) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeEdge(selEdge); }
    }

    /* ---------- Запуск и остановка ---------- */
    stage.addEventListener('pointermove', onStageMove);
    stage.addEventListener('pointerup', onStageUp);
    stage.addEventListener('pointercancel', onStageUp);
    document.addEventListener('keydown', onKey);
    ctx.main.append(edgeBar);

    function detach() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', onStageMove);
      stage.removeEventListener('pointerup', onStageUp);
      stage.removeEventListener('pointercancel', onStageUp);
      document.removeEventListener('keydown', onKey);
      cancelCdrag();
      drag = null;
      setHover(null);
      removeDots();
      clearHandles();
      edgeBar.remove();
      linkBtn.remove();
      if (layer) layer.remove();
      if (hLayer) hLayer.remove();
      recs.clear();
      dirty.clear();
    }

    return {
      renderAll: renderAll, nodeMoved: nodeMoved, onSelection: onSelection,
      onBackgroundTap: onBackgroundTap, deselect: deselectEdge, addFree: addFree,
      detachNodes: detachNodes, detach: detach,
      // true, если касание относится к ручке или самостоятельной стрелке (полотно не должно двигаться)
      claims: function (ev) {
        const t = ev.target;
        if (!t || !t.closest) return false;
        return !!(t.closest('[data-h]') || t.closest('[data-movable="1"]'));
      }
    };
  }

    VOID.graphEdges = { attach: attach, geom: geom };
})();