/* ===== VOID ACADEMY — интерфейс и логика =====
   Раздел «Ещё → Academy»: главная академии, интерактивные тесты (Learning / Exam), результаты и история.
   Вопросы лежат в js/academy-data-*.js (VOID.academyData), здесь только логика.
   История прохождений хранится в служебных настройках (ключ academy): там нет личных данных,
   только id теста, режим, баллы и время. Весь текст выводится через textContent.
   Прогресс незавершённого теста не сохраняется. Результат записывается один раз, при завершении. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID ACADEMY: не загружен ui.js'); return; }
  const el = ui.el;
  const NS = 'http://www.w3.org/2000/svg';

  const TOTAL = 12;
  const MAX_HISTORY = 300;
  const SHOWN_HISTORY = 20;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const LEVELS = [[11, 'Excellent'], [8, 'Advanced'], [5, 'Intermediate'], [0, 'Beginner']];
  const MODE_NAME = { learning: 'LEARNING MODE', exam: 'EXAM MODE' };
  const DISCLAIMER = 'Это оценка результата конкретного теста, а не подтверждение профессиональной квалификации.';

  function str(v) { return typeof v === 'string' ? v : ''; }

  function levelOf(score) {
    for (let i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i][0]) return LEVELS[i][1];
    return 'Beginner';
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- Иконка ---------- */
  (function addIcon() {
    const defs = document.querySelector('svg defs');
    if (!defs || document.getElementById('i-academy')) return;
    const sym = document.createElementNS(NS, 'symbol');
    sym.setAttribute('id', 'i-academy');
    sym.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5');
    sym.appendChild(p);
    defs.appendChild(sym);
  })();

  /* ---------- Данные тестов (с проверкой) ---------- */
  const raw = Array.isArray(VOID.academyData) ? VOID.academyData : [];
  const tests = [];
  const byId = new Map();
  raw.forEach(function (t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || byId.has(t.id)) return;
    if (!str(t.title) || !Array.isArray(t.questions) || t.questions.length !== TOTAL) {
      console.error('VOID ACADEMY: в тесте "' + t.id + '" должно быть ровно ' + TOTAL + ' вопросов');
      return;
    }
    const qs = [];
    const ok = t.questions.every(function (q) {
      if (!q || !str(q.q) || !Array.isArray(q.o) || q.o.length !== 4) return false;
      if (!q.o.every(function (o) { return typeof o === 'string' && o; })) return false;
      if (!Number.isInteger(q.a) || q.a < 0 || q.a > 3 || !str(q.e)) return false;
      qs.push({ q: q.q, o: q.o.slice(), a: q.a, e: q.e });
      return true;
    });
    if (!ok) { console.error('VOID ACADEMY: тест "' + t.id + '" содержит неверные данные'); return; }
    const test = { id: t.id, title: t.title, sub: str(t.sub), desc: str(t.desc), questions: qs };
    tests.push(test);
    byId.set(test.id, test);
  });

  /* ---------- История ---------- */
  let history = [];
  let loaded = false;

  function cleanHistory(rawList) {
    const out = [];
    if (Array.isArray(rawList)) {
      rawList.forEach(function (h) {
        if (!h || typeof h !== 'object' || typeof h.t !== 'string') return;
        if (h.m !== 'learning' && h.m !== 'exam') return;
        if (!Number.isInteger(h.s) || h.s < 0 || h.s > TOTAL || !Number.isFinite(h.ts)) return;
        out.push({ t: h.t, m: h.m, s: h.s, ts: h.ts });
      });
    }
    return out.slice(-MAX_HISTORY);
  }

  function loadHistory() {
    if (!(VOID.settings && VOID.settings.read)) { history = []; loaded = true; return Promise.resolve(); }
    return VOID.settings.read().then(function (s) {
      history = cleanHistory(s && s.academy && s.academy.history);
      loaded = true;
    }).catch(function () { history = []; loaded = true; });
  }

  function saveHistory() {
    if (!(VOID.settings && VOID.settings.update)) return Promise.reject(new Error('NO_SETTINGS'));
    return VOID.settings.update({ academy: { history: history.slice() } });
  }

  function computeStats() {
    const per = new Map();
    tests.forEach(function (t) { per.set(t.id, { n: 0, best: -1 }); });
    let attempts = 0;
    history.forEach(function (h) {
      const p = per.get(h.t);
      if (!p) return;
      p.n++;
      attempts++;
      if (h.s > p.best) p.best = h.s;
    });
    let done = 0, points = 0;
    per.forEach(function (p) { if (p.n) { done++; points += p.best; } });
    const max = tests.length * TOTAL;
    return { per: per, attempts: attempts, done: done, points: points, max: max,
      percent: max ? Math.round(points / max * 100) : 0 };
  }

  /* ---------- Раздел ---------- */
  const appRoot = document.getElementById('app');
  const viewsRoot = document.getElementById('views');
  const sheet = document.getElementById('sheet');

  const view = el('section', { class: 'view', id: 'view-academy', 'data-title': 'VOID ACADEMY', hidden: '' });
  viewsRoot.appendChild(view);

  if (sheet) {
    sheet.insertBefore(
      el('button', { class: 'sheet__item', type: 'button', 'data-route': 'academy' },
        [ui.icon('academy'), el('span', { text: 'Academy' })]),
      sheet.lastElementChild);
  }

  function statCard(num, label) {
    return el('div', { class: 'stat-card' }, [
      el('div', { class: 'stat-card__num', text: String(num) }),
      el('div', { class: 'stat-card__label', text: label })
    ]);
  }

  function recommend(st) {
    let pick = null;
    tests.forEach(function (t) { if (!pick && st.per.get(t.id).n === 0) pick = { t: t, fresh: true }; });
    if (pick) return pick;
    let low = tests[0];
    tests.forEach(function (t) { if (st.per.get(t.id).best < st.per.get(low.id).best) low = t; });
    return { t: low, fresh: false };
  }

  function renderHome() {
    view.textContent = '';
    if (!loaded) { view.appendChild(ui.emptyBlock('Загрузка…', '')); return; }
    if (!tests.length) {
      view.appendChild(ui.emptyBlock('Тесты не загружены', 'Не найдены файлы данных (js/academy-data-*.js).'));
      return;
    }
    const st = computeStats();

    view.appendChild(el('h1', { class: 'ac-title', text: 'VOID ACADEMY' }));
    view.appendChild(el('p', { class: 'ac-lead',
      text: 'Учебный раздел по OSINT, OPSEC и кибербезопасности. Проверьте себя на ситуационных задачах: ' +
            'в режиме Learning каждый ответ сопровождается разбором, в режиме Exam разбор будет в конце.' }));

    // Начать обучение
    const rec = recommend(st);
    const best = st.per.get(rec.t.id).best;
    view.appendChild(el('button', { class: 'list-item list-item--click list-item--draft ac-start', type: 'button',
      'data-test': rec.t.id }, [
      el('div', { class: 'card-cat', text: 'НАЧАТЬ ОБУЧЕНИЕ' }),
      el('div', { class: 'list-item__title', text: rec.t.title }),
      el('div', { class: 'card-snippet', text: rec.fresh
        ? (st.attempts === 0 ? 'С него лучше начать: ' + rec.t.sub : 'Вы ещё не проходили этот тест: ' + rec.t.sub)
        : 'Тест с самым низким результатом (' + best + '/' + TOTAL + '): попробуйте улучшить его' })
    ]));

    // Статистика и прогресс
    view.appendChild(el('h2', { class: 'section-title', text: 'Статистика' }));
    view.appendChild(el('div', { class: 'stat-grid' }, [
      statCard(st.done + '/' + tests.length, 'Тестов пройдено'),
      statCard(st.attempts, 'Попыток'),
      statCard(st.points + '/' + st.max, 'Баллов'),
      statCard(st.percent + '%', 'Общий прогресс')
    ]));
    const fill = el('div', { class: 'hbar__fill' });
    fill.style.width = st.percent + '%';
    view.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'ac-plabel', text: 'Прогресс = сумма лучших результатов по всем тестам' }),
      el('div', { class: 'hbar__track' }, [fill])
    ]));

    // Тесты
    view.appendChild(el('h2', { class: 'section-title', text: 'Тесты' }));
    const list = el('div', { class: 'list' });
    tests.forEach(function (t, i) {
      const p = st.per.get(t.id);
      const meta = TOTAL + ' вопросов · ' + (p.n
        ? 'попыток ' + p.n + ' · лучший ' + p.best + '/' + TOTAL + ' · ' + levelOf(p.best)
        : 'ещё не проходили');
      list.appendChild(el('button', { class: 'list-item list-item--click', type: 'button', 'data-test': t.id }, [
        el('div', { class: 'card-cat', text: 'TEST ' + (i + 1) }),
        el('div', { class: 'list-item__title', text: t.title }),
        el('div', { class: 'card-sub', text: t.sub }),
        el('div', { class: 'list-item__meta', text: meta })
      ]));
    });
    view.appendChild(list);

    // История
    view.appendChild(el('h2', { class: 'section-title', text: 'История результатов' }));
    const rows = history.filter(function (h) { return byId.has(h.t); })
      .slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, SHOWN_HISTORY);
    if (!rows.length) {
      view.appendChild(ui.emptyBlock('Пока пусто', 'Результаты появятся после первого пройденного теста.'));
    } else {
      const hl = el('div', { class: 'list' });
      rows.forEach(function (h) {
        hl.appendChild(el('div', { class: 'list-item' }, [
          el('div', { class: 'ac-hrow' }, [
            el('div', { class: 'list-item__title', text: byId.get(h.t).title }),
            el('div', { class: 'ac-hscore', text: h.s + '/' + TOTAL })
          ]),
          el('div', { class: 'list-item__meta',
            text: levelOf(h.s) + ' · ' + MODE_NAME[h.m] + ' · ' + ui.formatDateTime(h.ts) })
        ]));
      });
      view.appendChild(hl);
    }

    view.appendChild(el('p', { class: 'stats-note', text: DISCLAIMER }));
  }

  view.addEventListener('click', function (e) {
    const b = e.target.closest('[data-test]');
    if (b) openRun(b.dataset.test);
  });

  /* =====================================================
     Окно теста (оверлей на весь экран)
     ===================================================== */
  const backBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Назад' }, [ui.icon('back')]);
  const barTitle = el('div', { class: 'editor__title', text: 'VOID ACADEMY' });
  const body = el('div', { class: 'editor__body ac-body' });
  const runEl = el('div', { class: 'editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Тест', hidden: '' }, [
    el('div', { class: 'editor__bar' }, [backBtn, barTitle]),
    body
  ]);
  appRoot.appendChild(runEl);

  let run = null; // { test, mode, items, i, answers, locked, done, score }

  function openRun(id) {
    const t = byId.get(id);
    if (!t || run || !VOID.auth || !VOID.auth.isUnlocked()) return;
    run = { test: t, mode: '', items: [], i: 0, answers: [], locked: false, done: false, score: 0 };
    barTitle.textContent = t.title;
    runEl.hidden = false;
    renderIntro();
    ui.pushOverlay(closeRun);
  }

  function closeRun() {
    run = null;
    runEl.hidden = true;
    body.textContent = '';
    if (VOID.auth && VOID.auth.isUnlocked()) renderHome();
  }

  function resetScroll() { body.scrollTop = 0; }

  /* ---------- Вводный экран ---------- */
  function modeBtn(id, title, text) {
    return el('button', { class: 'list-item list-item--click ac-mode', type: 'button', 'data-mode': id }, [
      el('div', { class: 'card-cat', text: MODE_NAME[id] }),
      el('div', { class: 'list-item__title', text: title }),
      el('div', { class: 'card-snippet', text: text })
    ]);
  }

  function renderIntro() {
    const t = run.test;
    const p = computeStats().per.get(t.id);
    body.textContent = '';
    body.append(
      el('div', { class: 'card-cat', text: 'ТЕСТ · ' + TOTAL + ' ВОПРОСОВ' }),
      el('h1', { class: 'ac-title', text: t.title }),
      el('p', { class: 'ac-lead', text: t.sub + (t.desc ? '. ' + t.desc : '') }),
      el('div', { class: 'list-item__meta',
        text: p.n ? 'Попыток: ' + p.n + ' · лучший результат: ' + p.best + '/' + TOTAL : 'Вы ещё не проходили этот тест' }),
      el('h2', { class: 'section-title', text: 'Выберите режим' }),
      modeBtn('learning', 'Режим обучения', 'После каждого ответа видно, верен ли он, и показано объяснение.'),
      modeBtn('exam', 'Экзамен', 'Все вопросы без подсказок. Результат и разбор ответов появятся только в конце.'),
      el('p', { class: 'stats-note',
        text: 'Если выйти из теста до конца, прогресс не сохранится. Варианты ответов перемешиваются при каждой попытке.' })
    );
    resetScroll();
  }

  function startRun(mode) {
    if (!run) return;
    run.mode = mode;
    run.items = run.test.questions.map(function (q) {
      const perm = shuffle([0, 1, 2, 3]);
      return { q: q.q, opts: perm.map(function (k) { return q.o[k]; }), correct: perm.indexOf(q.a), e: q.e };
    });
    run.i = 0;
    run.answers = [];
    for (let k = 0; k < TOTAL; k++) run.answers.push(-1);
    run.locked = false;
    run.done = false;
    run.score = 0;
    renderQuestion(false);
  }

  /* ---------- Вопрос ---------- */
  function renderQuestion(keepScroll) {
    const it = run.items[run.i];
    const ans = run.answers[run.i];
    const learning = run.mode === 'learning';
    const reveal = learning && run.locked;
    const last = run.i === TOTAL - 1;

    body.textContent = '';
    const fill = el('div', { class: 'ac-bar__fill' });
    fill.style.width = Math.round((run.i + 1) / TOTAL * 100) + '%';
    body.append(
      el('div', { class: 'ac-head' }, [
        el('span', { class: 'ac-prog', text: 'QUESTION ' + (run.i + 1) + '/' + TOTAL }),
        el('span', { class: 'ac-modetag', text: MODE_NAME[run.mode] })
      ]),
      el('div', { class: 'ac-bar' }, [fill]),
      el('p', { class: 'ac-q', text: it.q })
    );

    const opts = el('div', { class: 'ac-opts', role: 'group', 'aria-label': 'Варианты ответа' });
    it.opts.forEach(function (text, k) {
      let cls = 'ac-opt';
      if (reveal) {
        if (k === it.correct) cls += ' ok';
        else if (k === ans) cls += ' bad';
      } else if (k === ans) cls += ' sel';
      const props = { class: cls, type: 'button', 'data-opt': String(k) };
      if (!reveal) props['aria-pressed'] = k === ans ? 'true' : 'false';
      if (reveal) props.disabled = '';
      opts.appendChild(el('button', props, [
        el('span', { class: 'ac-opt__l', text: LETTERS[k] }),
        el('span', { class: 'ac-opt__t', text: text })
      ]));
    });
    body.appendChild(opts);

    let fb = null;
    if (reveal) {
      const good = ans === it.correct;
      fb = el('div', { class: 'ac-fb ' + (good ? 'ok' : 'bad'), role: 'status' }, [
        el('div', { class: 'ac-fb__t', text: good ? 'Верно' : 'Неверно. Правильный ответ: ' + LETTERS[it.correct] }),
        el('p', { class: 'ac-fb__p', text: it.e })
      ]);
      body.appendChild(fb);
    }

    const ready = learning ? run.locked : ans >= 0;
    const next = el('button', { class: 'btn btn--primary btn--block', type: 'button', 'data-next': '1',
      text: last ? 'Показать результат' : 'Далее' });
    if (!ready) next.setAttribute('disabled', '');
    body.appendChild(next);

    if (!keepScroll) resetScroll();
    if (fb) { try { fb.scrollIntoView({ block: 'nearest' }); } catch (_) { /* не критично */ } }
  }

  function choose(k) {
    if (!run || run.done || !run.mode) return;
    if (!(k >= 0 && k <= 3)) return;
    if (run.mode === 'learning') {
      if (run.locked) return;
      run.answers[run.i] = k;
      run.locked = true;
      renderQuestion(true);
    } else {
      run.answers[run.i] = k;
      renderQuestion(true);
    }
  }

  function next() {
    if (!run || run.done || !run.mode) return;
    if (run.answers[run.i] < 0) return;
    if (run.mode === 'learning' && !run.locked) return;
    if (run.i < TOTAL - 1) {
      run.i++;
      run.locked = false;
      renderQuestion(false);
    } else {
      finish();
    }
  }

  /* ---------- Результат ---------- */
  function finish() {
    const cur = run;
    cur.done = true;
    let score = 0;
    cur.items.forEach(function (it, k) { if (cur.answers[k] === it.correct) score++; });
    cur.score = score;
    history.push({ t: cur.test.id, m: cur.mode, s: score, ts: Date.now() });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    saveHistory().catch(function (err) {
      if (err && err.message === 'LOCKED') return;
      console.error('Academy save error:', err);
      if (VOID.toast) VOID.toast('Не удалось сохранить результат', 'error');
    });
    renderResult();
  }

  function renderResult() {
    const score = run.score;
    const wrong = TOTAL - score;
    const pct = Math.round(score / TOTAL * 100);

    body.textContent = '';
    body.append(
      el('div', { class: 'card-cat', text: 'РЕЗУЛЬТАТ · ' + MODE_NAME[run.mode] }),
      el('div', { class: 'ac-score', text: score + '/' + TOTAL }),
      el('div', { class: 'ac-level', text: levelOf(score) }),
      el('div', { class: 'grid3' }, [
        statCard(score, 'Верно'),
        statCard(wrong, 'Неверно'),
        statCard(pct + '%', 'Точность')
      ]),
      el('p', { class: 'stats-note', text: DISCLAIMER }),
      el('h2', { class: 'section-title', text: 'Разбор ответов' })
    );

    run.items.forEach(function (it, k) {
      const ok = run.answers[k] === it.correct;
      const rows = [el('p', { class: 'ac-rev__q', text: it.q })];
      if (!ok) rows.push(el('p', { class: 'ac-rev__a', text: 'Ваш ответ: ' + LETTERS[run.answers[k]] + '. ' + it.opts[run.answers[k]] }));
      rows.push(el('p', { class: 'ac-rev__a ac-rev__a--ok', text: 'Правильный ответ: ' + LETTERS[it.correct] + '. ' + it.opts[it.correct] }));
      rows.push(el('p', { class: 'ac-rev__e', text: it.e }));
      const props = { class: 'ac-rev ' + (ok ? 'ok' : 'bad') };
      if (!ok) props.open = '';
      body.appendChild(el('details', props, [
        el('summary', {}, [
          el('span', { class: 'ac-rev__m', text: ok ? '✓' : '✗' }),
          el('span', { text: (k + 1) + '. ' + ui.snippet(it.q, 90) })
        ]),
        el('div', { class: 'ac-rev__b' }, rows)
      ]));
    });

    body.append(
      el('button', { class: 'btn btn--primary btn--block', type: 'button', 'data-retry': '1', text: 'Пройти ещё раз' }),
      el('button', { class: 'btn btn--block', type: 'button', 'data-home': '1', text: 'Вернуться в академию' })
    );
    resetScroll();
  }

  /* ---------- Обработчики ---------- */
  body.addEventListener('click', function (e) {
    const m = e.target.closest('[data-mode]');
    if (m) { if (run && !run.mode) startRun(m.dataset.mode); return; }
    const o = e.target.closest('[data-opt]');
    if (o) { choose(Number(o.dataset.opt)); return; }
    if (e.target.closest('[data-next]')) { next(); return; }
    if (e.target.closest('[data-retry]')) { if (run && run.done) startRun(run.mode); return; }
    if (e.target.closest('[data-home]')) ui.requestClose();
  });
  backBtn.addEventListener('click', function () { ui.requestClose(); });

  window.addEventListener('hashchange', function () {
    if (location.hash !== '#academy' || !VOID.auth || !VOID.auth.isUnlocked()) return;
    if (loaded) renderHome(); else loadHistory().then(renderHome);
  });

  document.addEventListener('void:unlock', function () { loadHistory().then(renderHome); });

  // Блокировка: стираем всё с экрана и из памяти
  document.addEventListener('void:lock', function () {
    run = null;
    runEl.hidden = true;
    body.textContent = '';
    view.textContent = '';
    history = [];
    loaded = false;
  });

  VOID.academy = { count: tests.length };
})();
