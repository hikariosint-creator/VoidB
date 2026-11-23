/* ===== VOID GRAPH — хранилище досок (этапы B–G1) =====
   Два зашифрованных раздела базы (шифрование и ключ — общие, из VOID.db / VOID.crypto):
   - graph      : паспорт доски {id, title, description, nodeCount, createdAt, updatedAt}
                  (чтобы список досок строился без расшифровки всего содержимого);
   - graphdata  : содержимое доски с тем же id {view, settings, nodes[], edges[], strokes[], images[]},
                  а также отдельные записи фото с id вида img_<32 hex> (см. graph-images.js).
   Сохранения идут в общей очереди, чтобы они не перемешивались.
   Фото могут использоваться сразу несколькими досками (копии, вставка), поэтому при удалении
   фото освобождаются только если на них не ссылается ни одна другая доска. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};

  const META = 'graph';
  const DATA = 'graphdata';
  const MAX_TITLE = 100;
  const MAX_DESC = 500;
  const MAX_IMAGES = 2000;
  const GRID_MODES = ['dots', 'lines', 'none'];
  const BG_MODES = ['dark', 'charcoal', 'gray'];
  const DATA_VERSION = 1;
  const IMG_ID_RE = /^img_[0-9a-f]{32}$/;

  let chain = Promise.resolve();

  function enqueue(task) {
    const p = chain.then(task);
    chain = p.catch(function () { /* очередь не должна ломаться из-за одной ошибки */ });
    return p;
  }

  const str = function (v) { return typeof v === 'string' ? v : ''; };
  const isImgId = function (v) { return typeof v === 'string' && IMG_ID_RE.test(v); };
  function num(v, fallback, min, max) {
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  }
  function cleanTitle(s, fallback) {
    const t = str(s).trim().slice(0, MAX_TITLE);
    return t || fallback;
  }

  /* ---------- Приведение данных к безопасному виду ---------- */
  function normalizeMeta(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      title: str(raw.title).slice(0, MAX_TITLE),
      description: str(raw.description).slice(0, MAX_DESC),
      nodeCount: Number.isInteger(raw.nodeCount) && raw.nodeCount >= 0 ? raw.nodeCount : 0,
      createdAt: num(raw.createdAt, 0, 0, Infinity),
      updatedAt: num(raw.updatedAt, 0, 0, Infinity)
    };
  }

  function normalizeData(raw, id) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const v = r.view && typeof r.view === 'object' ? r.view : {};
    const s = r.settings && typeof r.settings === 'object' ? r.settings : {};
    return {
      id: id,
      v: DATA_VERSION,
      createdAt: num(r.createdAt, 0, 0, Infinity),
      updatedAt: num(r.updatedAt, 0, 0, Infinity),
      view: {
        cx: num(v.cx, 0, -1e7, 1e7),
        cy: num(v.cy, 0, -1e7, 1e7),
        zoom: num(v.zoom, 1, 0.1, 4)
      },
      settings: {
        grid: GRID_MODES.includes(s.grid) ? s.grid : 'dots',
        snap: s.snap !== false,
        gridSize: num(s.gridSize, 24, 8, 120),
        bg: BG_MODES.includes(s.bg) ? s.bg : 'dark'
      },
      nodes: Array.isArray(r.nodes) ? r.nodes : [],
      edges: Array.isArray(r.edges) ? r.edges : [],
      strokes: Array.isArray(r.strokes) ? r.strokes : [],
      images: Array.isArray(r.images) ? r.images.filter(isImgId).slice(0, MAX_IMAGES) : []
    };
  }

  /** Все фото, на которые ссылается доска (объекты и список images). */
  function imageIdsOf(data) {
    const set = new Set();
    (Array.isArray(data.images) ? data.images : []).forEach(function (id) { if (isImgId(id)) set.add(id); });
    (Array.isArray(data.nodes) ? data.nodes : []).forEach(function (n) {
      if (n && n.type === 'image' && isImgId(n.imgId)) set.add(n.imgId);
    });
    return set;
  }

  /* ---------- Доски ---------- */
  async function listBoards() {
    const rows = await VOID.db.getAllItems(META);
    return rows.map(normalizeMeta).filter(Boolean)
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  async function createBoard(fields) {
    const f = fields || {};
    const rec = await VOID.db.saveItem(META, {
      title: cleanTitle(f.title, 'Новая доска'),
      description: str(f.description).trim().slice(0, MAX_DESC),
      nodeCount: 0
    });
    const meta = normalizeMeta(rec);
    try {
      await VOID.db.saveItem(DATA, normalizeData({}, meta.id));
    } catch (err) {
      // Паспорт без содержимого не оставляем
      try { await VOID.db.deleteItem(META, meta.id); } catch (_) { /* уже нет */ }
      throw err;
    }
    return meta;
  }

  async function updateBoard(id, patch) {
    const raw = await VOID.db.getItem(META, id);
    const cur = normalizeMeta(raw);
    if (!cur) throw new Error('BOARD_NOT_FOUND');
    const next = Object.assign({}, raw, cur); // createdAt сохраняется
    if (patch && typeof patch.title === 'string') next.title = cleanTitle(patch.title, 'Без названия');
    if (patch && typeof patch.description === 'string') next.description = patch.description.trim().slice(0, MAX_DESC);
    return normalizeMeta(await VOID.db.saveItem(META, next));
  }

  /* ---------- Содержимое доски ---------- */
  async function loadData(id) {
    const raw = await VOID.db.getItem(DATA, id);
    return normalizeData(raw, id);
  }

  function saveData(data) {
    const snap = JSON.parse(JSON.stringify(data)); // снимок на момент вызова
    return enqueue(async function () {
      const rec = await VOID.db.saveItem(DATA, snap);
      data.createdAt = rec.createdAt;
      data.updatedAt = rec.updatedAt;
      // Обновляем паспорт: число объектов и время изменения для списка досок
      const metaRaw = await VOID.db.getItem(META, snap.id);
      if (metaRaw) {
        metaRaw.nodeCount = snap.nodes.length;
        await VOID.db.saveItem(META, metaRaw);
      }
    });
  }

  function flush() { return chain; }

  /* ---------- Фото ---------- */
  /** Удаляет фото из базы, если на них не ссылается ни одна доска, кроме exceptBoardId.
      При любой ошибке чтения ничего не удаляется (безопаснее оставить лишнее). */
  async function releaseImages(ids, exceptBoardId) {
    const cand = new Set((Array.isArray(ids) ? ids : []).filter(isImgId));
    if (!cand.size) return 0;
    const all = await listBoards();
    for (const b of all) {
      if (b.id === exceptBoardId) continue;
      const d = await loadData(b.id);
      imageIdsOf(d).forEach(function (id) { cand.delete(id); });
      if (!cand.size) return 0;
    }
    let n = 0;
    for (const id of cand) { await VOID.db.deleteItem(DATA, id); n++; }
    return n;
  }

  /** Удаление безвозвратное (корзины в VOID пока нет). Сначала дожидаемся записей из очереди. */
  async function deleteBoard(id) {
    await flush();
    let data = null;
    try { data = await loadData(id); } catch (_) { data = null; }
    await VOID.db.deleteItem(DATA, id);
    await VOID.db.deleteItem(META, id);
    if (data) {
      try { await releaseImages(Array.from(imageIdsOf(data)), id); }
      catch (err) { console.error('Image cleanup error:', err); }
    }
  }

  VOID.graphStore = {
    GRID_MODES: GRID_MODES, BG_MODES: BG_MODES,
    listBoards: listBoards, createBoard: createBoard, updateBoard: updateBoard, deleteBoard: deleteBoard,
    loadData: loadData, saveData: saveData, flush: flush,
    releaseImages: releaseImages, imageIdsOf: imageIdsOf
  };
})();