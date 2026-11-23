/* ===== VOID DOCUMENTS — схемы из Graph (этап D3) =====
   Берёт доску Graph, рисует её на прозрачном холсте (объекты, стрелки с изгибами и подписями,
   рисунки, фото) и вставляет в документ как обычное изображение (img с data-img),
   дополнительно помеченное data-dg="1" и data-bd="<id доски>" (для «Обновить из доски»).
   - Хранение и шифрование картинки: общий модуль docs-images.js -> graph-images.js (раздел graphdata).
   - Палитра «для печати»: тёмный текст и линии на прозрачном фоне; на чёрной теме документа
     схему инвертирует CSS (см. docs.css).
   - Геометрию стрелок берёт у graph-edges.js (VOID.graphEdges.geom), поэтому изгибы совпадают с доской.
   Расшифрованные данные доски живут только в памяти на время построения картинки. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const NS = 'http://www.w3.org/2000/svg';
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const MAX_SIDE = 1600;
  const MAX_SCALE = 2;
  const PAD = 24;
  const BD_RE = /^[0-9a-f]{32}$/;
  const SIDES = ['t', 'r', 'b', 'l'];
  const STYLES = ['straight', 'curve', 'elbow'];
  const ARROWS = ['none', 'end', 'both'];
  const SIZES = [['Маленькая', 220], ['Средняя', 380], ['Крупная', 560], ['На всю ширину', 2000]];

  const TYPES = {
    text: { w: 220, h: 60, fs: 20, color: 'gray' }, sticky: { w: 180, h: 180, fs: 16, color: 'amber' },
    note: { w: 260, h: 180, fs: 15, color: 'gray' }, rect: { w: 200, h: 120, fs: 16, color: 'gray' },
    ellipse: { w: 180, h: 120, fs: 16, color: 'gray' }, diamond: { w: 180, h: 140, fs: 16, color: 'gray' },
    image: { w: 280, h: 200, fs: 14, color: 'gray' }
  };
  const NODE_COLORS = {
    gray:   { stroke: '#6b6b6b', fill: 'rgba(120,120,120,0.16)', solid: '#D6D6D6', ink: '#1A1A1A' },
    red:    { stroke: '#A32632', fill: 'rgba(163,38,50,0.18)',   solid: '#E0959D', ink: '#B42332' },
    blue:   { stroke: '#3F6FA3', fill: 'rgba(63,111,163,0.18)',  solid: '#9CC3EC', ink: '#245E99' },
    green:  { stroke: '#4C8A5B', fill: 'rgba(76,138,91,0.18)',   solid: '#9ED3AB', ink: '#2F7A44' },
    amber:  { stroke: '#A8741F', fill: 'rgba(168,116,31,0.18)',  solid: '#EBCB7C', ink: '#8A5A0B' },
    violet: { stroke: '#7B4FA3', fill: 'rgba(123,79,163,0.18)',  solid: '#C6AAE8', ink: '#6A3C93' }
  };
  const EDGE_COLORS = { gray: '#5C5C5C', white: '#1A1A1A', red: '#C03945', blue: '#3F6FA3', green: '#3F8A55', amber: '#B07818', violet: '#7B4FA3' };
  const STROKE_COLORS = { red: '#E5484D', yellow: '#D9A800', green: '#2FA84F', blue: '#3B82F6', violet: '#8B5CF6', white: '#1A1A1A', black: '#111111' };

  let busy = false;

  /* ---------- Помощники ---------- */
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function num(v, d, a, b) { return Number.isFinite(v) ? clamp(v, a, b) : d; }
  function userError(m) { const e = new Error(m); e.user = true; return e; }
  function font(fs, bold) { return (bold ? '700 ' : '400 ') + fs + 'px ' + FONT; }

  (function addIcon() {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById('i-dx-graph')) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', 'i-dx-graph');
    sym.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M4 5h6v5H4zM14 14h6v5h-6zM10 7.5h2a3 3 0 013 3V14');
    sym.appendChild(p);
    defs.appendChild(sym);
  })();

  /* ---------- Проверка данных доски (могли прийти из старой версии или файла) ---------- */
  function cleanNodes(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.type !== 'string' || !has(TYPES, r.type)) return;
      const T = TYPES[r.type];
      out.push({
        id: r.id, type: r.type,
        x: num(r.x, 0, -1e6, 1e6), y: num(r.y, 0, -1e6, 1e6),
        w: num(r.w, T.w, 20, 4000), h: num(r.h, T.h, 20, 4000), z: num(r.z, 1, 0, 1e9),
        color: has(NODE_COLORS, r.color) ? r.color : T.color,
        text: str(r.text).slice(0, 10000), title: str(r.title).slice(0, 200),
        fs: num(r.fs, T.fs, 8, 200), bold: r.bold === true, imgId: str(r.imgId)
      });
    });
    return out.slice(0, 1000);
  }

  function cleanEnd(r, map, side) {
    if (!r || typeof r !== 'object') return null;
    if (typeof r.node === 'string') {
      if (!map.has(r.node)) return null;
      return { node: r.node, side: SIDES.indexOf(r.side) >= 0 ? r.side : side };
    }
    if (Number.isFinite(r.x) && Number.isFinite(r.y)) return { x: clamp(r.x, -1e6, 1e6), y: clamp(r.y, -1e6, 1e6) };
    return null;
  }

  function cleanEdges(raw, map) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      const from = cleanEnd(r.from, map, 'r');
      const to = cleanEnd(r.to, map, 'l');
      if (!from || !to || (from.node && to.node && from.node === to.node)) return;
      const b = r.bend && typeof r.bend === 'object' ? r.bend : {};
      out.push({
        from: from, to: to,
        style: STYLES.indexOf(r.style) >= 0 ? r.style : 'straight',
        arrow: ARROWS.indexOf(r.arrow) >= 0 ? r.arrow : 'end',
        dashed: r.dashed === true, label: str(r.label).slice(0, 100),
        color: has(EDGE_COLORS, r.color) ? r.color : 'gray',
        w: num(r.w, 2.5, 1, 20), hs: num(r.hs, 1, 0.4, 3),
        bend: { x: num(b.x, 0, -1e5, 1e5), y: num(b.y, 0, -1e5, 1e5) }
      });
    });
    return out.slice(0, 2000);
  }

  function cleanStrokes(raw) {
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!r || typeof r !== 'object' || !Array.isArray(r.p) || r.p.length < 2 || r.p.length % 2 !== 0 || r.p.length > 8000) return;
      for (let i = 0; i < r.p.length; i++) if (!Number.isFinite(r.p[i])) return;
      out.push({ c: has(STROKE_COLORS, r.c) ? r.c : 'black', k: r.k === 'hl' ? 'hl' : 'pen', w: num(r.w, 4, 0.5, 80), p: r.p });
    });
    return out.slice(0, 1500);
  }

  /* ---------- Текст и фигуры ---------- */
  function wrap(ctx, text, maxW) {
    const out = [];
    const w = Math.max(10, maxW);
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (par) {
      if (out.length > 400) return;
      if (!par.trim()) { out.push(''); return; }
      let line = '';
      par.split(' ').forEach(function (word) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width <= w) { line = test; return; }
        if (line) { out.push(line); line = ''; }
        if (ctx.measureText(word).width <= w) { line = word; return; }
        let chunk = '';
        Array.from(word).forEach(function (ch) {
          if (chunk && ctx.measureText(chunk + ch).width > w) { out.push(chunk); chunk = ch; } else chunk += ch;
        });
        line = chunk;
      });
      out.push(line);
    });
    return out;
  }

  function paint(ctx, lines, x, y, lh, align, maxW) {
    ctx.textAlign = align;
    const tx = align === 'center' ? x + maxW / 2 : x;
    lines.forEach(function (l, i) { if (l) ctx.fillText(l, tx, y + lh * i + lh / 2); });
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shapePath(ctx, n) {
    ctx.beginPath();
    if (n.type === 'ellipse') {
      ctx.ellipse(n.x + n.w / 2, n.y + n.h / 2, n.w / 2 - 1, n.h / 2 - 1, 0, 0, Math.PI * 2);
    } else if (n.type === 'diamond') {
      ctx.moveTo(n.x + n.w / 2, n.y + 1);
      ctx.lineTo(n.x + n.w - 1, n.y + n.h / 2);
      ctx.lineTo(n.x + n.w / 2, n.y + n.h - 1);
      ctx.lineTo(n.x + 1, n.y + n.h / 2);
      ctx.closePath();
    } else {
      rrect(ctx, n.x + 1, n.y + 1, n.w - 2, n.h - 2, 2);
    }
  }

  function drawNode(ctx, n, img) {
    const c = NODE_COLORS[n.color];
    const lh = n.fs * 1.3;
    ctx.save();
    ctx.textBaseline = 'middle';
    try {
      if (n.type === 'image') {
        if (img) {
          rrect(ctx, n.x, n.y, n.w, n.h, 4);
          ctx.clip();
          ctx.drawImage(img, n.x, n.y, n.w, n.h);
        } else {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = '#9A9A9A';
          ctx.lineWidth = 1;
          ctx.strokeRect(n.x + 0.5, n.y + 0.5, n.w - 1, n.h - 1);
          ctx.setLineDash([]);
          ctx.fillStyle = '#777777';
          ctx.font = font(13, false);
          ctx.textAlign = 'center';
          ctx.fillText('Фото недоступно', n.x + n.w / 2, n.y + n.h / 2);
        }
      } else if (n.type === 'text') {
        ctx.font = font(n.fs, n.bold);
        ctx.fillStyle = c.ink;
        paint(ctx, wrap(ctx, n.text, n.w - 12), n.x + 6, n.y + 4, lh, 'left', n.w - 12);
      } else if (n.type === 'sticky') {
        rrect(ctx, n.x, n.y, n.w, n.h, 3);
        ctx.fillStyle = c.solid;
        ctx.fill();
        ctx.clip();
        ctx.font = font(n.fs, n.bold);
        ctx.fillStyle = '#17150F';
        paint(ctx, wrap(ctx, n.text, n.w - 24), n.x + 12, n.y + 12, lh, 'left', n.w - 24);
      } else if (n.type === 'note') {
        rrect(ctx, n.x, n.y, n.w, n.h, 6);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#CFCFCF';
        ctx.stroke();
        ctx.clip();
        ctx.fillStyle = c.stroke;
        ctx.fillRect(n.x, n.y, 3, n.h);
        const tx = n.x + 15, tw = n.w - 27;
        let y = n.y + 10;
        if (n.title) {
          const tfs = Math.round(n.fs * 1.1);
          ctx.font = '600 ' + tfs + 'px ' + FONT;
          const tl = wrap(ctx, n.title, tw);
          ctx.fillStyle = c.ink;
          paint(ctx, tl, tx, y, tfs * 1.3, 'left', tw);
          y += tl.length * tfs * 1.3 + 6;
        }
        ctx.font = font(n.fs, n.bold);
        ctx.fillStyle = '#1A1A1A';
        paint(ctx, wrap(ctx, n.text, tw), tx, y, lh, 'left', tw);
      } else {
        shapePath(ctx, n);
        ctx.fillStyle = c.fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.stroke;
        ctx.stroke();
        const tw = n.type === 'ellipse' ? n.w * 0.72 : n.type === 'diamond' ? n.w * 0.56 : n.w - 24;
        ctx.beginPath();
        ctx.rect(n.x, n.y, n.w, n.h);
        ctx.clip();
        ctx.font = font(n.fs, n.bold);
        const ls = wrap(ctx, n.text, tw);
        ctx.fillStyle = '#1A1A1A';
        paint(ctx, ls, n.x + (n.w - tw) / 2, n.y + (n.h - ls.length * lh) / 2, lh, 'center', tw);
      }
    } finally {
      ctx.restore();
    }
  }

  /* ---------- Рисунки (плавная линия через середины отрезков, как на доске) ---------- */
  function pathD(p) {
    const n = p.length / 2;
    if (n === 1) return 'M' + p[0] + ' ' + p[1] + 'l0.01 0';
    if (n === 2) return 'M' + p[0] + ' ' + p[1] + 'L' + p[2] + ' ' + p[3];
    let d = 'M' + p[0] + ' ' + p[1];
    for (let i = 1; i < n - 1; i++) {
      d += 'Q' + p[2 * i] + ' ' + p[2 * i + 1] + ' ' + (p[2 * i] + p[2 * i + 2]) / 2 + ' ' + (p[2 * i + 1] + p[2 * i + 3]) / 2;
    }
    return d + 'L' + p[2 * (n - 1)] + ' ' + p[2 * (n - 1) + 1];
  }

  function drawStroke(ctx, s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = STROKE_COLORS[s.c];
    ctx.lineWidth = s.w;
    if (s.k === 'hl') ctx.globalAlpha = 0.4;
    ctx.stroke(new Path2D(pathD(s.p)));
    ctx.restore();
  }

  /* ---------- Стрелки ---------- */
  function head(ctx, tip, u, L) {
    const W = L * 0.46;
    const bx = tip[0] - u[0] * L, by = tip[1] - u[1] * L;
    const nx = -u[1] * W, ny = u[0] * W;
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(bx + nx, by + ny);
    ctx.lineTo(bx - nx, by - ny);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawEdge(ctx, e, g) {
    const col = EDGE_COLORS[e.color];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = e.w;
    ctx.setLineDash(e.dashed ? [e.w * 3 + 5, e.w * 2 + 4] : []);
    ctx.stroke(new Path2D(g.line));
    ctx.setLineDash([]);
    if (e.arrow === 'end' || e.arrow === 'both') head(ctx, [g.B.x, g.B.y], g.endDir, g.headL);
    if (e.arrow === 'both') head(ctx, [g.A.x, g.A.y], g.startDir, g.headL);
    if (e.label) {
      ctx.font = '600 13px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out'; // «вырез» в линии под подписью
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(e.label, g.mid[0], g.mid[1]);
      ctx.restore();
      ctx.fillStyle = '#1A1A1A';
      ctx.fillText(e.label, g.mid[0], g.mid[1]);
    }
    ctx.restore();
  }

  /* ---------- Загрузка фото узлов ---------- */
  function loadImage(id) {
    const L = VOID.graphImages;
    if (!L || !L.load) return Promise.reject(new Error('NO_IMAGES'));
    return L.load(id).then(function (url) {
      return new Promise(function (resolve, reject) {
        const im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(new Error('IMG')); };
        im.src = url;
      });
    });
  }

  /* =====================================================
     Построение картинки по данным доски
     ===================================================== */
  async function renderBoard(data) {
    const nodes = cleanNodes(data.nodes);
    const map = new Map(nodes.map(function (n) { return [n.id, n]; }));
    const edges = cleanEdges(data.edges, map);
    const strokes = cleanStrokes(data.strokes);
    if (!nodes.length && !edges.length && !strokes.length) throw userError('На этой доске пока ничего нет.');

    const geomFn = VOID.graphEdges && VOID.graphEdges.geom;
    if (edges.length && typeof geomFn !== 'function') {
      throw userError('Не хватает правки в js/graph-edges.js (строка с VOID.graphEdges в самом конце). См. инструкцию.');
    }
    const geoms = edges.map(function (e) {
      try { const g = geomFn(e, map); return g && g.line ? g : null; } catch (_) { return null; }
    });

    // Границы всего содержимого
    const sc = document.createElement('canvas').getContext('2d');
    let b = null;
    const add = function (x0, y0, x1, y1) {
      if (!b) b = { minX: x0, minY: y0, maxX: x1, maxY: y1 };
      else {
        b.minX = Math.min(b.minX, x0); b.minY = Math.min(b.minY, y0);
        b.maxX = Math.max(b.maxX, x1); b.maxY = Math.max(b.maxY, y1);
      }
    };
    nodes.forEach(function (n) {
      let h = n.h;
      if (n.type === 'text') { // длинный текст выходит за рамку объекта
        sc.font = font(n.fs, n.bold);
        h = Math.max(h, wrap(sc, n.text, n.w - 12).length * n.fs * 1.3 + 8);
      }
      add(n.x, n.y, n.x + n.w, n.y + h);
    });
    edges.forEach(function (e, i) {
      const g = geoms[i];
      if (!g) return;
      const nums = g.full.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
      const m = Math.max(e.w, g.headL * 0.6) + 2;
      for (let k = 0; k + 1 < nums.length; k += 2) {
        const x = Number(nums[k]), y = Number(nums[k + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) add(x - m, y - m, x + m, y + m);
      }
      if (e.label) {
        sc.font = '600 13px ' + FONT;
        const hw = sc.measureText(e.label).width / 2 + 8;
        add(g.mid[0] - hw, g.mid[1] - 12, g.mid[0] + hw, g.mid[1] + 12);
      }
    });
    strokes.forEach(function (s) {
      const m = s.w / 2 + 1;
      for (let i = 0; i < s.p.length; i += 2) add(s.p[i] - m, s.p[i + 1] - m, s.p[i] + m, s.p[i + 1] + m);
    });
    if (!b) throw userError('На этой доске пока ничего нет.');

    const bw = b.maxX - b.minX + PAD * 2;
    const bh = b.maxY - b.minY + PAD * 2;
    const scale = Math.min(MAX_SCALE, MAX_SIDE / Math.max(bw, bh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(bw * scale));
    canvas.height = Math.max(1, Math.ceil(bh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw userError('Не удалось создать рисунок.');
    ctx.scale(scale, scale);
    ctx.translate(PAD - b.minX, PAD - b.minY);

    // Фото узлов (если какое-то не загрузится, на его месте будет пометка)
    const imgs = new Map();
    await Promise.all(nodes.filter(function (n) { return n.type === 'image' && n.imgId; }).map(function (n) {
      return loadImage(n.imgId).then(function (im) { imgs.set(n.id, im); }).catch(function () { /* пометка */ });
    }));

    // Порядок как на доске: стрелки внизу, объекты по слоям, рисунки сверху
    edges.forEach(function (e, i) { if (geoms[i]) drawEdge(ctx, e, geoms[i]); });
    nodes.slice().sort(function (a, c) { return a.z - c.z; }).forEach(function (n) { drawNode(ctx, n, imgs.get(n.id)); });
    strokes.forEach(function (s) { drawStroke(ctx, s); });

    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw userError('Не удалось создать рисунок схемы.');
    return { file: new File([blob], 'diagram.png', { type: 'image/png' }), width: Math.round(bw) };
  }

  /** Доска -> зашифрованная запись-изображение. */
  async function buildFromBoard(boardId) {
    const store = VOID.graphStore;
    if (!store || !VOID.graphImages) throw userError('Не загружен модуль Graph.');
    if (!VOID.docsImages) throw userError('Не загружен модуль изображений (js/docs-images.js).');
    const data = await store.loadData(boardId);
    const out = await renderBoard(data);
    const res = await VOID.docsImages.add(out.file);
    return { id: res.id, width: out.width };
  }

  /* =====================================================
     Действия в редакторе
     ===================================================== */
  function handleError(api, err) {
    if (err && err.message === 'LOCKED') return;
    if (err && err.user) api.toast(err.message, 'error', 4500);
    else { console.error('Diagram error:', err); api.toast('Не удалось построить схему', 'error', 4000); }
  }

  async function insertDiagram(api, boardId) {
    if (busy || !BD_RE.test(boardId)) return;
    busy = true;
    api.toast('Рисую схему…', 'info', 2500);
    try {
      const r = await buildFromBoard(boardId);
      if (!VOID.docsEditor.isOpen() || !document.body.contains(api.ed)) { VOID.docsImages.remove([r.id]); return; }
      const w = Math.max(120, Math.min(620, r.width));
      api.restoreRange();
      api.cmd('insertHTML', '<img data-img="' + r.id + '" data-dg="1" data-bd="' + boardId + '" style="width:' + w + 'px">');
      const img = api.ed.querySelector('img[data-img="' + r.id + '"]');
      const u = VOID.docsImages.cachedUrl(r.id);
      if (img && u) img.src = u;
    } catch (err) {
      handleError(api, err);
    } finally {
      busy = false;
    }
  }

  async function refreshDiagram(api, img) {
    const bd = img.getAttribute('data-bd') || '';
    if (!BD_RE.test(bd)) { api.toast('Эта схема не связана с доской', 'error', 3000); return; }
    if (busy) return;
    busy = true;
    api.toast('Обновляю схему…', 'info', 2500);
    try {
      const boards = await VOID.graphStore.listBoards();
      if (!boards.some(function (x) { return x.id === bd; })) throw userError('Доска не найдена. Возможно, она удалена.');
      const r = await buildFromBoard(bd);
      if (!VOID.docsEditor.isOpen() || !api.ed.contains(img)) { VOID.docsImages.remove([r.id]); return; }
      img.removeAttribute('src');
      img.setAttribute('data-img', r.id);
      const u = VOID.docsImages.cachedUrl(r.id);
      if (u) img.src = u;
      api.commit();
      api.toast('Схема обновлена', 'success', 1500);
    } catch (err) {
      handleError(api, err);
    } finally {
      busy = false;
    }
  }

  /* ---------- Список досок ---------- */
  function openPicker(api, btn) {
    const el = api.ui.el;
    const box = el('div');
    box.style.width = '260px';
    box.style.maxWidth = '100%';
    box.appendChild(el('div', { class: 'dx__cap', text: 'Вставить схему из Graph' }));
    const list = el('div');
    list.appendChild(el('div', { class: 'dx__note', text: 'Загрузка…' }));
    box.appendChild(list);
    box.appendChild(el('p', { class: 'dx__note',
      text: 'Схема вставится картинкой без фона. Если доску изменили, нажмите на схему и выберите «Обновить из доски».' }));
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-bd]');
      if (!b) return;
      api.closePop();
      insertDiagram(api, b.dataset.bd);
    });
    api.openPop(btn, box);

    if (!VOID.graphStore) { list.textContent = ''; list.appendChild(el('div', { class: 'dx__note', text: 'Модуль Graph не загружен.' })); return; }
    VOID.graphStore.listBoards().then(function (boards) {
      list.textContent = '';
      if (!boards.length) {
        list.appendChild(el('div', { class: 'dx__note', text: 'Досок Graph пока нет. Создайте доску в разделе Graph.' }));
        return;
      }
      boards.forEach(function (bd) {
        if (!BD_RE.test(bd.id)) return;
        list.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-bd': bd.id }, [
          el('span', { text: bd.title || 'Без названия' }),
          el('span', { class: 'dx__meta', text: String(bd.nodeCount) })
        ]));
      });
    }).catch(function (err) {
      list.textContent = '';
      if (!(err && err.message === 'LOCKED')) list.appendChild(el('div', { class: 'dx__note', text: 'Не удалось загрузить список досок.' }));
    });
  }

  /* ---------- Панель схемы (касание картинки) ---------- */
  function clearSel(ed) { ed.querySelectorAll('img.is-sel').forEach(function (i) { i.classList.remove('is-sel'); }); }

  function diagramNode(api, img) {
    const el = api.ui.el;
    const box = el('div');
    box.appendChild(el('div', { class: 'dx__cap', text: 'Схема' }));
    SIZES.forEach(function (s) {
      box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-w': String(s[1]), text: s[0] }));
    });
    box.appendChild(el('div', { class: 'dx__hr' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-scale': '0.8', text: 'Меньше' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-scale': '1.25', text: 'Больше' }));
    box.appendChild(el('div', { class: 'dx__hr' }));
    box.appendChild(el('button', { class: 'dx__row', type: 'button', 'data-refresh': '1', text: 'Обновить из доски' }));
    box.appendChild(el('button', { class: 'dx__row is-danger', type: 'button', 'data-del': '1', text: 'Удалить схему' }));

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
      if (b.dataset.refresh) { refreshDiagram(api, img); return; }
      let w = 0;
      if (b.dataset.w) w = Number(b.dataset.w);
      else if (b.dataset.scale) w = Math.round(img.getBoundingClientRect().width * Number(b.dataset.scale));
      if (!(w > 0)) return;
      img.style.width = Math.max(60, Math.min(2000, w)) + 'px';
      api.commit();
    });
    return box;
  }

  const bound = new WeakSet();

  function attachOnce(api) {
    const ed = api.ed;
    if (!ed || bound.has(ed)) return;
    bound.add(ed);
    // Обработчик в фазе перехвата: касание схемы не доходит до обычной панели изображений
    ed.addEventListener('click', function (e) {
      const img = e.target.closest && e.target.closest('img[data-dg="1"]');
      if (!img || !ed.contains(img)) return;
      e.preventDefault();
      e.stopPropagation();
      clearSel(ed);
      img.classList.add('is-sel');
      const r = img.getBoundingClientRect();
      const top = Math.min(Math.max(r.top + 20, 150), window.innerHeight - 340);
      api.openPop({ getBoundingClientRect: function () { return { left: r.left, right: r.right, top: top, bottom: top }; } },
        diagramNode(api, img));
    }, true);
  }

  if (VOID.docsEditor && VOID.docsEditor.use) {
    VOID.docsEditor.use({
      tools: [{ id: 'diagram', icon: 'dx-graph', title: 'Схема из Graph', run: function (api, btn) { openPicker(api, btn); } }],
      afterRender: function (api) { attachOnce(api); }
    });
  } else {
    console.error('VOID DOCUMENTS: не загружен docs-editor.js (схемы недоступны)');
  }
})();