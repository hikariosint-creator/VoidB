/* ===== VOID DOCUMENTS — таблицы (этап D2) =====
   Таблица — обычные теги <table><tbody><tr><td|th>, которые проходят ту же очистку, что и весь документ.
   Операции меняют DOM напрямую и затем вызывают api.commit(): так они попадают в Undo/Redo и автосохранение.
   Кнопка «Таблица» открывает панель: если курсор в таблице — действия над ней, ниже — вставка новой.
   В ячейках работает всё форматирование (жирный, цвет, списки, ссылки, изображения). */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_ROWS = 100;
  const MAX_COLS = 20;
  const NEW_MAX_ROWS = 20;
  const NEW_MAX_COLS = 8;
  const BLOCK_OK = ['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'BLOCKQUOTE'];
  const OPS = [
    ['row-above', 'Строка выше'], ['row-below', 'Строка ниже'],
    ['col-left', 'Столбец слева'], ['col-right', 'Столбец справа'],
    ['header', 'Первая строка — заголовок'],
    ['row-del', 'Удалить строку', true], ['col-del', 'Удалить столбец', true], ['table-del', 'Удалить таблицу', true]
  ];
  const state = { rows: 3, cols: 3, header: true };
  const bound = new WeakSet();

  (function addIcon() {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById('i-dx-table')) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', 'i-dx-table');
    sym.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14');
    sym.appendChild(p);
    defs.appendChild(sym);
  })();

  /* ---------- Помощники ---------- */
  function cellOfSelection(ed) {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    let n = s.anchorNode;
    if (!n || !ed.contains(n)) return null;
    if (n.nodeType === 3) n = n.parentNode;
    while (n && n !== ed) {
      if (n.nodeType === 1 && (n.tagName === 'TD' || n.tagName === 'TH')) return n;
      n = n.parentNode;
    }
    return null;
  }

  function topBlock(ed, node) {
    while (node && node.parentNode !== ed) node = node.parentNode;
    return node || null;
  }

  function newCell(tag) {
    const c = document.createElement(tag);
    c.appendChild(document.createElement('br'));
    return c;
  }

  function convertCell(cell, tag) {
    if (cell.tagName === tag) return cell;
    const n = document.createElement(tag);
    Array.from(cell.attributes).forEach(function (a) { n.setAttribute(a.name, a.value); });
    while (cell.firstChild) n.appendChild(cell.firstChild);
    cell.replaceWith(n);
    return n;
  }

  function placeCaret(api, cell) {
    if (!cell) return;
    api.ed.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(cell);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    try { cell.scrollIntoView({ block: 'nearest' }); } catch (_) { /* не критично */ }
  }

  function makeTable(rows, cols, header) {
    const t = document.createElement('table');
    const tb = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) tr.appendChild(newCell(header && r === 0 ? 'th' : 'td'));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return t;
  }

  function isEmptyBlock(b) {
    return b.nodeType === 1 && (b.tagName === 'P' || b.tagName === 'DIV') &&
      b.textContent.trim() === '' && !b.querySelector('img,table,hr');
  }

  /* ---------- Вставка новой таблицы ---------- */
  function insertTable(api) {
    api.restoreRange();
    const ed = api.ed;
    const t = makeTable(state.rows, state.cols, state.header);
    const s = window.getSelection();
    const anchor = s && s.rangeCount && ed.contains(s.anchorNode) ? s.anchorNode : null;
    const blk = anchor ? topBlock(ed, anchor) : null;
    if (blk && isEmptyBlock(blk)) ed.replaceChild(t, blk);
    else if (blk) blk.after(t);
    else ed.appendChild(t);
    const nx = t.nextElementSibling;
    if (!nx || BLOCK_OK.indexOf(nx.tagName) < 0) {
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      t.after(p);
    }
    placeCaret(api, t.rows[0].cells[0]);
    api.commit();
  }

  /* ---------- Операции над таблицей ---------- */
  function addRow(api, cell, after) {
    const row = cell.parentNode;
    const table = row.closest('table');
    if (table.rows.length >= MAX_ROWS) { api.toast('Слишком много строк', 'error', 2500); return null; }
    const n = row.cells.length;
    const tr = document.createElement('tr');
    for (let i = 0; i < n; i++) tr.appendChild(newCell('td'));
    if (after) row.after(tr); else row.before(tr);
    return tr;
  }

  function addCol(api, cell, after) {
    const row = cell.parentNode;
    const table = row.closest('table');
    if (row.cells.length >= MAX_COLS) { api.toast('Слишком много столбцов', 'error', 2500); return false; }
    const idx = cell.cellIndex;
    Array.from(table.rows).forEach(function (tr) {
      const ref = tr.cells[idx];
      const th = ref ? ref.tagName === 'TH' : (tr.cells.length > 0 && tr.cells[0].tagName === 'TH');
      const nc = newCell(th ? 'th' : 'td');
      if (ref) { if (after) ref.after(nc); else ref.before(nc); } else tr.appendChild(nc);
    });
    return true;
  }

  function runOp(api, op) {
    api.restoreRange();
    const ed = api.ed;
    const cell = cellOfSelection(ed);
    if (!cell) { api.toast('Поставьте курсор в ячейку таблицы', 'info', 2200); return; }
    const row = cell.parentNode;
    const table = row.closest('table');
    if (!table) return;
    const ci = cell.cellIndex;

    if (op === 'row-above' || op === 'row-below') {
      const tr = addRow(api, cell, op === 'row-below');
      if (!tr) return;
      placeCaret(api, tr.cells[Math.min(ci, tr.cells.length - 1)]);
      api.commit();
    } else if (op === 'col-left' || op === 'col-right') {
      const after = op === 'col-right';
      if (!addCol(api, cell, after)) return;
      placeCaret(api, row.cells[after ? ci + 1 : ci]);
      api.commit();
    } else if (op === 'row-del') {
      const rows = Array.from(table.rows);
      if (rows.length <= 1) { api.toast('Это последняя строка. Используйте «Удалить таблицу».', 'info', 3000); return; }
      const i = rows.indexOf(row);
      const target = rows[i + 1] || rows[i - 1];
      row.remove();
      placeCaret(api, target.cells[Math.min(ci, target.cells.length - 1)]);
      api.commit();
    } else if (op === 'col-del') {
      if (row.cells.length <= 1) { api.toast('Это последний столбец. Используйте «Удалить таблицу».', 'info', 3000); return; }
      const target = row.cells[ci + 1] || row.cells[ci - 1];
      Array.from(table.rows).forEach(function (tr) { if (tr.cells[ci]) tr.cells[ci].remove(); });
      placeCaret(api, target);
      api.commit();
    } else if (op === 'header') {
      const ri = Array.from(table.rows).indexOf(row);
      const cells = Array.from(table.rows[0].cells);
      const all = cells.every(function (c) { return c.tagName === 'TH'; });
      cells.forEach(function (c) { convertCell(c, all ? 'TD' : 'TH'); });
      const tr = table.rows[ri];
      if (tr && tr.cells[ci]) placeCaret(api, tr.cells[ci]);
      api.commit();
    } else if (op === 'table-del') {
      api.ui.confirm({ title: 'Удалить таблицу?', text: 'Таблица и всё её содержимое будут удалены (это можно отменить кнопкой «Отменить»).',
        confirmText: 'Удалить' }).then(function (ok) {
        if (!ok || !ed.contains(table)) return;
        table.remove();
        ed.focus({ preventScroll: true });
        api.commit();
      });
    }
  }

  /* ---------- Панель ---------- */
  function stepper(el, label, key) {
    const val = el('b', { text: String(state[key]) });
    return el('div', { class: 'dx__step' }, [
      el('span', { text: label }),
      el('div', { class: 'dx__stepbtns' }, [
        el('button', { type: 'button', 'data-step': key + ':-1', 'aria-label': label + ': меньше', text: '−' }),
        val,
        el('button', { type: 'button', 'data-step': key + ':1', 'aria-label': label + ': больше', text: '+' })
      ])
    ]);
  }

  function popNode(api) {
    const el = api.ui.el;
    const box = el('div');
    if (cellOfSelection(api.ed)) {
      box.appendChild(el('div', { class: 'dx__cap', text: 'Текущая таблица' }));
      OPS.forEach(function (o) {
        box.appendChild(el('button', { class: 'dx__row' + (o[2] ? ' is-danger' : ''), type: 'button', 'data-op': o[0], text: o[1] }));
      });
      box.appendChild(el('div', { class: 'dx__hr' }));
    }
    box.appendChild(el('div', { class: 'dx__cap', text: 'Новая таблица' }));
    box.appendChild(stepper(el, 'Строки', 'rows'));
    box.appendChild(stepper(el, 'Столбцы', 'cols'));
    const hdr = el('button', { class: 'dx__row' + (state.header ? ' on' : ''), type: 'button', 'data-hdr': '1',
      text: 'Строка заголовка: ' + (state.header ? 'да' : 'нет') });
    box.appendChild(hdr);
    box.appendChild(el('button', { class: 'btn btn--primary btn--block', type: 'button', 'data-insert': '1', text: 'Вставить таблицу' }));

    box.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.step) {
        const p = b.dataset.step.split(':');
        const key = p[0];
        const max = key === 'rows' ? NEW_MAX_ROWS : NEW_MAX_COLS;
        state[key] = Math.max(1, Math.min(max, state[key] + Number(p[1])));
        b.closest('.dx__step').querySelector('b').textContent = String(state[key]);
        return;
      }
      if (b.dataset.hdr) {
        state.header = !state.header;
        b.classList.toggle('on', state.header);
        b.textContent = 'Строка заголовка: ' + (state.header ? 'да' : 'нет');
        return;
      }
      if (b.dataset.insert) { api.closePop(); insertTable(api); return; }
      if (b.dataset.op) { api.closePop(); runOp(api, b.dataset.op); }
    });
    return box;
  }

  /* ---------- Клавиша Tab в таблице (для компьютера) ---------- */
  function attachOnce(api) {
    const ed = api.ed;
    if (!ed || bound.has(ed)) return;
    bound.add(ed);
    ed.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
      const cell = cellOfSelection(ed);
      if (!cell) return;
      e.preventDefault();
      const table = cell.closest('table');
      const cells = Array.from(table.querySelectorAll('td,th'));
      const i = cells.indexOf(cell);
      const next = cells[e.shiftKey ? i - 1 : i + 1];
      if (next) { placeCaret(api, next); return; }
      if (!e.shiftKey) {
        const tr = addRow(api, cell, true);
        if (tr) { placeCaret(api, tr.cells[0]); api.commit(); }
      }
    });
  }

  if (VOID.docsEditor && VOID.docsEditor.use) {
    VOID.docsEditor.use({
      tools: [{ id: 'table', icon: 'dx-table', title: 'Таблица', run: function (api, btn) { api.openPop(btn, popNode(api)); } }],
      afterRender: function (api) { attachOnce(api); }
    });
  } else {
    console.error('VOID DOCUMENTS: не загружен docs-editor.js (таблицы недоступны)');
  }
})();