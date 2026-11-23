/* ===== VOID — кастомизация интерфейса =====
   Настройки (хранятся в служебных настройках VOID под ключом custom; личных данных в них нет):
   радиус, акцентный цвет, интенсивность свечения, плотность, фон (однотонный/градиент/текстура),
   интенсивность анимаций, шрифт, прозрачность поверхностей.
   Всё применяется через CSS-переменные на <html> (см. css/custom.css), без перезагрузки.
   Работает поверх тем: при смене темы кастомизация применяется заново (VOID.themes.onApply).
   Прозрачность затрагивает только фоны поверхностей (--card, --bg2 становятся rgba), а не сами элементы.
   Если выбран свой цвет фона, цвета поверхностей, границ и текста выводятся из него автоматически,
   чтобы текст оставался читаемым. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const ui = VOID.ui;
  if (!ui) { console.error('VOID CUSTOMIZATION: не загружен ui.js'); return; }
  const el = ui.el;
  const root = document.documentElement;
  const HEX = /^#[0-9a-f]{6}$/i;
  const LIGHT = 0.25; // яркость фона, выше которой фон считается светлым

  const RADII = [0, 5, 10, 16, 26];
  const RADIUS_LABELS = ['Минимальный', 'Небольшой', 'Средний', 'Большой', 'Максимальный'];
  const RADIUS_TICKS = ['Мин', 'Мал', 'Сред', 'Бол', 'Макс'];
  const DENS = { compact: 0.86, default: 1, spacious: 1.14 };
  const DENS_IDS = ['compact', 'default', 'spacious'];
  const DENS_NAMES = { compact: 'Compact', default: 'Default', spacious: 'Spacious' };
  const FONTS = {
    standard: { name: 'Standard', fw: 400, ls: 'normal', fs: '16px',
      family: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif' },
    modern: { name: 'Modern', fw: 400, ls: '0.012em', fs: '16px',
      family: '"Google Sans", "Product Sans", "Segoe UI Variable Text", "SF Pro Text", "sans-serif-medium", Roboto, system-ui, sans-serif' },
    minimal: { name: 'Minimal', fw: 300, ls: '0.02em', fs: '16px',
      family: '"sans-serif-light", "Roboto Light", "Segoe UI Light", "Helvetica Neue", system-ui, sans-serif' },
    mono: { name: 'Monospace', fw: 400, ls: 'normal', fs: '15px',
      family: 'ui-monospace, "SF Mono", "Roboto Mono", "Noto Sans Mono", "DejaVu Sans Mono", Consolas, "Droid Sans Mono", monospace' }
  };
  const FONT_IDS = ['standard', 'modern', 'minimal', 'mono'];
  const TEXTURES = { noise: 'Шум', dots: 'Точки', grid: 'Сетка', lines: 'Линии' };
  const TEX_IDS = ['noise', 'dots', 'grid', 'lines'];
  const DIRS = { '180': '↓', '135': '↘', '90': '→', radial: '◉' };
  const DIR_IDS = ['180', '135', '90', 'radial'];
  const MODES = [['solid', 'Solid'], ['gradient', 'Gradient'], ['texture', 'Texture']];
  const ACCENTS = ['#a32632', '#d9480f', '#e0a800', '#4c8a5b', '#2fa84f', '#14a3a3', '#2b77b8', '#3b82f6',
    '#6b4fd6', '#9b59b6', '#d6336c', '#8a8f98'];
  const SOLIDS = ['#080808', '#0b0f14', '#0e0a12', '#12100c', '#0a1210', '#161b22', '#1e1e24', '#eaf1f8', '#f3efe6'];
  const GRADS = [['#0b0b0f', '#1a1030'], ['#0a0a0a', '#262626'], ['#06101a', '#0f4a6b'], ['#07100a', '#1d4a2b'],
    ['#140808', '#5a2314'], ['#0d0d14', '#2a1b3d'], ['#eaf1f8', '#bfd8f2'], ['#f4f0e8', '#e0d4bc']];
  const BASE_NAMES = ['bg', 'bg2', 'card', 'border', 'text', 'text2'];
  const DEFAULT_BASE = { bg: '#080808', bg2: '#101010', card: '#171717', border: '#303030', text: '#e5e5e5', text2: '#858585' };

  const DEF = { radius: 2, accent: null, glow: 50, density: 'default',
    bg: { mode: 'solid', color: null, g1: null, g2: null, dir: '180', texture: 'noise' },
    anim: 50, font: 'standard', opacity: 100 };

  let state = clone(DEF);
  const base = Object.assign({}, DEFAULT_BASE);
  let inited = false;
  let saveTimer = 0, fxTimer = 0, applyRaf = 0;
  const P = {}; // ссылки на элементы панели

  /* ---------- Помощники ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function hexOr(v) { return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null; }
  function inl(n) { return root.style.getPropertyValue(n).trim(); }

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    }).join('');
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function rgba(h, a) {
    const c = hexToRgb(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (Math.round(a * 1000) / 1000) + ')';
  }
  function lum(h) {
    const c = hexToRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function sanitize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const b = r.bg && typeof r.bg === 'object' ? r.bg : {};
    const n = function (v, min, max, d) { return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d; };
    return {
      radius: n(r.radius, 0, 4, 2),
      accent: hexOr(r.accent),
      glow: n(r.glow, 0, 100, 50),
      density: DENS_IDS.indexOf(r.density) >= 0 ? r.density : 'default',
      bg: {
        mode: ['solid', 'gradient', 'texture'].indexOf(b.mode) >= 0 ? b.mode : 'solid',
        color: hexOr(b.color), g1: hexOr(b.g1), g2: hexOr(b.g2),
        dir: DIR_IDS.indexOf(String(b.dir)) >= 0 ? String(b.dir) : '180',
        texture: has(TEXTURES, b.texture) ? b.texture : 'noise'
      },
      anim: n(r.anim, 0, 100, 50),
      font: has(FONTS, r.font) ? r.font : 'standard',
      opacity: n(r.opacity, 0, 100, 100)
    };
  }

  /* ---------- Цвета темы (то, что выставил themes.js) ---------- */
  function initBases() {
    const cs = getComputedStyle(root);
    BASE_NAMES.forEach(function (n) {
      const v = cs.getPropertyValue('--' + n).trim();
      base[n] = HEX.test(v) ? v.toLowerCase() : DEFAULT_BASE[n];
    });
  }

  /** Вызывается сразу после того, как themes.js выставил свежие значения. */
  function readBases() {
    BASE_NAMES.forEach(function (n) {
      const v = inl('--' + n);
      if (HEX.test(v)) base[n] = v.toLowerCase();
    });
  }

  function effAccent() {
    if (state.accent) return state.accent;
    const v = inl('--accent');
    return HEX.test(v) ? v.toLowerCase() : '#a32632';
  }

  function gradDefaults() {
    const acc = effAccent();
    const lt = lum(base.bg) > LIGHT;
    return [base.bg, mix(base.bg, acc, lt ? 0.14 : 0.24)];
  }

  /* ---------- Текстуры ---------- */
  function texture(kind, light) {
    const ink = light ? '0,0,0' : '255,255,255';
    if (kind === 'dots') {
      return { img: 'radial-gradient(circle, rgba(' + ink + ',0.16) 1px, transparent 1.6px)', size: '22px 22px' };
    }
    if (kind === 'grid') {
      return { img: 'linear-gradient(to right, rgba(' + ink + ',0.06) 1px, transparent 1px), ' +
        'linear-gradient(to bottom, rgba(' + ink + ',0.06) 1px, transparent 1px)', size: '28px 28px' };
    }
    if (kind === 'lines') {
      return { img: 'repeating-linear-gradient(135deg, rgba(' + ink + ',0.045) 0, rgba(' + ink + ',0.045) 1px, transparent 1px, transparent 10px)',
        size: 'auto' };
    }
    const c = light ? '0' : '1';
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n' x='0' y='0' width='100%' height='100%'>" +
      "<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
      "<feColorMatrix values='0 0 0 0 " + c + " 0 0 0 0 " + c + " 0 0 0 0 " + c + " 0.3 0 0 0 -0.09'/></filter>" +
      "<rect width='160' height='160' filter='url(#n)'/></svg>";
    return { img: 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")', size: '160px 160px' };
  }

  /* =====================================================
     Применение настроек
     ===================================================== */
  function apply() {
    if (!inited) return;
    const c = state, bgc = c.bg;
    const S = function (k, v) { root.style.setProperty(k, v); };
    const acc = effAccent();

    // Фон
    let customBg, bgVar, ref, g1 = null, g2 = null;
    if (bgc.mode === 'gradient') {
      const d = gradDefaults();
      g1 = bgc.g1 || d[0];
      g2 = bgc.g2 || d[1];
      customBg = !!(bgc.g1 || bgc.g2);
      bgVar = g1;
      ref = customBg ? mix(g1, g2, 0.5) : base.bg;
    } else {
      customBg = !!bgc.color;
      bgVar = bgc.color || base.bg;
      ref = bgVar;
    }
    const light = lum(ref) > LIGHT;

    // Поверхности и текст: из темы или (при своём фоне) из выбранного цвета
    let bg2 = base.bg2, card = base.card, border = base.border, text = base.text, text2 = base.text2;
    if (customBg) {
      const tgt = light ? '#000000' : '#ffffff';
      bg2 = mix(ref, tgt, 0.04);
      card = mix(ref, tgt, 0.08);
      border = mix(ref, tgt, 0.2);
      text = light ? '#1b1b1b' : '#e5e5e5';
      text2 = light ? '#5c5c5c' : '#8e8e8e';
    }
    const op = c.opacity / 100;
    const popA = 0.45 + 0.55 * op; // всплывающие окна не становятся полностью прозрачными
    S('--bg', bgVar);
    S('--bg2', rgba(bg2, op));
    S('--card', rgba(card, op));
    S('--border', border);
    S('--text', text);
    S('--text2', text2);
    S('--bg2-pop', rgba(bg2, popA));
    S('--card-pop', rgba(card, popA));
    BASE_NAMES.forEach(function (n) { S('--theme-' + n, base[n]); });
    root.style.colorScheme = light ? 'light' : 'dark';
    root.classList.toggle('cz-blur', c.opacity < 100);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bgVar);

    // Фоновое изображение страницы
    if (bgc.mode === 'gradient') {
      const img = bgc.dir === 'radial'
        ? 'radial-gradient(120% 90% at 50% 0%, ' + g2 + ', ' + g1 + ')'
        : 'linear-gradient(' + bgc.dir + 'deg, ' + g1 + ', ' + g2 + ')';
      S('--cz-bg-image', img); S('--cz-bg-size', '100% 100%'); S('--cz-bg-repeat', 'no-repeat');
    } else if (bgc.mode === 'texture') {
      const t = texture(bgc.texture, light);
      S('--cz-bg-image', t.img); S('--cz-bg-size', t.size); S('--cz-bg-repeat', 'repeat');
    } else {
      root.style.removeProperty('--cz-bg-image');
      root.style.removeProperty('--cz-bg-size');
      root.style.removeProperty('--cz-bg-repeat');
    }

    // Акцентный цвет
    if (c.accent) {
      const hov = light ? mix(acc, '#000000', 0.22) : mix(acc, '#ffffff', 0.2);
      S('--accent', acc); S('--accent-hover', hov); S('--accent2', mix(acc, '#ffffff', light ? 0.45 : 0.5));
      S('--accent-12', rgba(acc, 0.12)); S('--accent-22', rgba(acc, 0.22));
      S('--accent-35', rgba(acc, 0.35)); S('--accent-45', rgba(acc, 0.45));
    }
    S('--on-accent', lum(acc) > 0.19 ? '#111111' : '#ffffff');

    // Свечение (50 % соответствует прежнему виду)
    const g = c.glow / 100;
    S('--glow', String(g));
    S('--gl-ring', rgba(acc, 0.24 * g));
    S('--gl-soft', rgba(acc, 0.44 * g));
    S('--gl-fab', rgba(acc, Math.min(0.9, 0.7 * g)));
    S('--gl-blur', Math.round(36 * g * 10) / 10 + 'px');
    const amb = inl('--ambient');
    const m = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(amb);
    if (m && +m[4] > 0) {
      const a = Math.min(0.6, +m[4] * g * 2);
      const col = c.accent ? hexToRgb(acc) : [+m[1], +m[2], +m[3]];
      S('--ambient-x', 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (Math.round(a * 1000) / 1000) + ')');
    } else {
      S('--ambient-x', 'transparent');
    }

    // Радиус, плотность, шрифт, анимации
    S('--radius', RADII[c.radius] + 'px');
    S('--dens', String(DENS[c.density]));
    const f = FONTS[c.font];
    S('--font', f.family); S('--cz-fw', String(f.fw)); S('--cz-ls', f.ls); S('--cz-fs', f.fs);
    const s = c.anim / 50;
    S('--anim-s', String(s));
    S('--anim-t', String(0.4 + 0.6 * s));
    root.classList.toggle('anim-off', c.anim === 0);
  }

  function scheduleApply() {
    if (applyRaf) return;
    applyRaf = requestAnimationFrame(function () { applyRaf = 0; apply(); });
  }

  /* =====================================================
     Сохранение
     ===================================================== */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!(VOID.settings && VOID.settings.update)) return;
    VOID.settings.update({ custom: clone(state) }).catch(function (err) {
      console.error('Customization save error:', err);
      if (VOID.toast) VOID.toast('Не удалось сохранить кастомизацию', 'error');
    });
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }

  /** Свечение и частицы тем берут акцент из CSS: после смены цвета просим тему перечитать его. */
  function refreshFx() {
    clearTimeout(fxTimer);
    fxTimer = setTimeout(function () { if (VOID.themes && VOID.themes.apply) VOID.themes.apply(); }, 500);
  }

  function change(fn) {
    fn(state);
    scheduleApply();
    syncUi();
    scheduleSave();
  }

  /* =====================================================
     Интерфейс панели
     ===================================================== */
  function fillRange(r) {
    const p = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)) * 100;
    r.style.setProperty('--fill', p + '%');
  }
  function range(min, max, step, label, onInput) {
    const r = el('input', { class: 'cz-range', type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
    r.addEventListener('input', function () { fillRange(r); onInput(Number(r.value)); });
    return r;
  }
  function tabsOf(items, onPick) {
    const box = el('div', { class: 'tabs', role: 'tablist' });
    const map = {};
    items.forEach(function (it) {
      const b = el('button', { class: 'tab', type: 'button', role: 'tab', 'data-id': it[0], text: it[1] });
      map[it[0]] = b;
      box.appendChild(b);
    });
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-id]');
      if (b) onPick(b.dataset.id);
    });
    return { box: box, map: map };
  }
  function mark(map, cur) {
    Object.keys(map).forEach(function (k) {
      const on = k === cur;
      map[k].classList.toggle('active', on);
      map[k].setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  function colorInput(label, onInput) {
    const c = el('input', { class: 'cz-color', type: 'color', 'aria-label': label });
    c.addEventListener('input', function () { onInput(c.value.toLowerCase()); });
    return c;
  }
  function row(label, valueEl, nodes) {
    return el('div', { class: 'set-row' }, [
      el('div', { class: 'cz-line' }, [el('span', { class: 'set-label', text: label }), valueEl || null])
    ].concat(nodes));
  }
  function level5(v, names) { return v === 0 ? names[0] : v <= 25 ? names[1] : v <= 50 ? names[2] : v <= 75 ? names[3] : names[4]; }
  function swatches(list, onPick, kind) {
    const box = el('div', { class: 'swatches' });
    list.forEach(function (h) {
      const b = el('button', { class: kind === 'grad' ? 'cz-gsw' : 'swatch', type: 'button', 'data-c': Array.isArray(h) ? h.join('|') : h,
        'aria-label': Array.isArray(h) ? h.join(' — ') : h });
      b.style.background = Array.isArray(h) ? 'linear-gradient(135deg,' + h[0] + ',' + h[1] + ')' : h;
      box.appendChild(b);
    });
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-c]');
      if (b) onPick(b.dataset.c);
    });
    return box;
  }

  function build() {
    const view = document.getElementById('view-settings');
    if (!view || P.group) return;

    // Предпросмотр: настоящие элементы приложения, поэтому он меняется вместе с настройками в реальном времени
    P.prevInput = el('input', { class: 'input', type: 'text', value: 'Поле ввода', readonly: '', 'aria-hidden': 'true', tabindex: '-1' });
    const preview = el('div', { class: 'cz-preview', 'aria-label': 'Предпросмотр' }, [
      el('div', { class: 'list-item' }, [
        el('div', { class: 'list-item__title', text: 'Карточка / Card' }),
        el('div', { class: 'card-snippet', text: 'Пример текста и вторичного текста. Sample text 123.' }),
        el('div', { class: 'list-item__meta', text: 'Создано сегодня' })
      ]),
      el('div', { class: 'cz-prow' }, [
        el('button', { class: 'btn btn--primary', type: 'button', tabindex: '-1', text: 'Главная кнопка' }),
        el('button', { class: 'btn', type: 'button', tabindex: '-1', text: 'Кнопка' })
      ]),
      el('div', { class: 'tabs' }, [
        el('button', { class: 'tab active', type: 'button', tabindex: '-1', text: 'Вкладка' }),
        el('button', { class: 'tab', type: 'button', tabindex: '-1', text: 'Другая' })
      ]),
      P.prevInput
    ]);

    // Радиус
    P.radiusVal = el('span', { class: 'cz-val' });
    P.radius = range(0, 4, 1, 'Радиус элементов', function (v) { change(function (s) { s.radius = v; }); });
    const ticks = el('div', { class: 'cz-ticks' }, RADIUS_TICKS.map(function (t) { return el('span', { text: t }); }));

    // Акцент
    P.accVal = el('span', { class: 'cz-val' });
    P.accSw = swatches(ACCENTS, function (h) { change(function (s) { s.accent = h; }); refreshFx(); });
    P.accPick = colorInput('Свой цвет акцента', function (h) { change(function (s) { s.accent = h; }); refreshFx(); });
    P.accAuto = el('button', { class: 'swatch swatch--auto', type: 'button', text: 'Как в теме' });
    P.accAuto.addEventListener('click', function () {
      state.accent = null;
      if (VOID.themes && VOID.themes.apply) VOID.themes.apply(); else apply();
      syncUi();
      scheduleSave();
    });
    const accRow = el('div', { class: 'cz-crow' }, [P.accPick, P.accAuto]);

    // Glow
    P.glowVal = el('span', { class: 'cz-val' });
    P.glow = range(0, 100, 5, 'Интенсивность свечения', function (v) { change(function (s) { s.glow = v; }); });

    // Плотность
    const dens = tabsOf(DENS_IDS.map(function (d) { return [d, DENS_NAMES[d]]; }),
      function (id) { change(function (s) { s.density = id; }); });
    P.dens = dens.map;

    // Фон
    const modes = tabsOf(MODES, function (id) { change(function (s) { s.bg.mode = id; }); });
    P.modes = modes.map;
    P.bgNote = el('p', { class: 'set-hint' });

    P.solidSw = swatches(SOLIDS, function (h) { change(function (s) { s.bg.color = h; }); });
    P.solidPick = colorInput('Цвет фона', function (h) { change(function (s) { s.bg.color = h; }); });
    P.solidAuto = el('button', { class: 'swatch swatch--auto', type: 'button', text: 'Как в теме' });
    P.solidAuto.addEventListener('click', function () { change(function (s) { s.bg.color = null; }); });
    P.subSolid = el('div', { class: 'cz-sub' }, [P.solidSw, el('div', { class: 'cz-crow' }, [P.solidPick, P.solidAuto])]);

    function setGrad(a, b) {
      change(function (s) { s.bg.g1 = a || s.bg.g1; s.bg.g2 = b || s.bg.g2; });
    }
    P.gradSw = swatches(GRADS, function (v) { const p = v.split('|'); setGrad(p[0], p[1]); }, 'grad');
    P.g1 = colorInput('Цвет градиента 1', function (h) { const d = gradDefaults(); change(function (s) { s.bg.g1 = h; s.bg.g2 = s.bg.g2 || d[1]; }); });
    P.g2 = colorInput('Цвет градиента 2', function (h) { const d = gradDefaults(); change(function (s) { s.bg.g2 = h; s.bg.g1 = s.bg.g1 || d[0]; }); });
    P.gAuto = el('button', { class: 'swatch swatch--auto', type: 'button', text: 'Как в теме' });
    P.gAuto.addEventListener('click', function () { change(function (s) { s.bg.g1 = null; s.bg.g2 = null; }); });
    const dirs = tabsOf(DIR_IDS.map(function (d) { return [d, DIRS[d]]; }), function (id) { change(function (s) { s.bg.dir = id; }); });
    P.dirs = dirs.map;
    P.subGrad = el('div', { class: 'cz-sub' }, [P.gradSw,
      el('div', { class: 'cz-crow' }, [el('span', { class: 'cz-clabel', text: 'Цвет 1' }), P.g1,
        el('span', { class: 'cz-clabel', text: 'Цвет 2' }), P.g2, P.gAuto]),
      el('span', { class: 'cz-clabel', text: 'Направление' }), dirs.box]);

    const texs = tabsOf(TEX_IDS.map(function (t) { return [t, TEXTURES[t]]; }), function (id) { change(function (s) { s.bg.texture = id; }); });
    P.texs = texs.map;
    P.tPick = colorInput('Базовый цвет текстуры', function (h) { change(function (s) { s.bg.color = h; }); });
    P.tAuto = el('button', { class: 'swatch swatch--auto', type: 'button', text: 'Как в теме' });
    P.tAuto.addEventListener('click', function () { change(function (s) { s.bg.color = null; }); });
    P.subTex = el('div', { class: 'cz-sub' }, [texs.box,
      el('div', { class: 'cz-crow' }, [el('span', { class: 'cz-clabel', text: 'Базовый цвет' }), P.tPick, P.tAuto])]);

    // Анимации
    P.animVal = el('span', { class: 'cz-val' });
    P.anim = range(0, 100, 5, 'Интенсивность анимаций', function (v) { change(function (s) { s.anim = v; }); });

    // Шрифты
    P.fonts = {};
    const fontBox = el('div', { class: 'cz-fonts', role: 'radiogroup', 'aria-label': 'Шрифт' });
    FONT_IDS.forEach(function (id) {
      const f = FONTS[id];
      const sample = el('span', { class: 'cz-font__s', text: 'Aa Яя Абв 123' });
      sample.style.fontFamily = f.family;
      sample.style.fontWeight = String(f.fw);
      sample.style.letterSpacing = f.ls;
      const b = el('button', { class: 'cz-font', type: 'button', role: 'radio', 'data-font': id, 'aria-checked': 'false' },
        [sample, el('span', { class: 'cz-font__n', text: f.name })]);
      P.fonts[id] = b;
      fontBox.appendChild(b);
    });
    fontBox.addEventListener('click', function (e) {
      const b = e.target.closest('[data-font]');
      if (b && has(FONTS, b.dataset.font)) change(function (s) { s.font = b.dataset.font; });
    });

    // Прозрачность
    P.opVal = el('span', { class: 'cz-val' });
    P.op = range(0, 100, 5, 'Прозрачность поверхностей', function (v) { change(function (s) { s.opacity = v; }); });

    // Кнопки
    const resetBtn = el('button', { class: 'btn btn--block', type: 'button', text: 'Сбросить кастомизацию' });
    const defBtn = el('button', { class: 'btn btn--block btn--danger', type: 'button', text: 'Стандартное оформление' });
    resetBtn.addEventListener('click', function () { resetAll(false); });
    defBtn.addEventListener('click', function () {
      ui.confirm({ title: 'Вернуть стандартное оформление?',
        text: 'Кастомизация будет сброшена, а тема станет «Графит» с её родным акцентным цветом.',
        confirmText: 'Вернуть' }).then(function (ok) { if (ok) resetAll(true); });
    });

    P.group = el('section', { class: 'set-group' }, [
      el('h2', { class: 'section-title', text: 'Кастомизация' }),
      el('div', { class: 'set-panel' }, [
        preview,
        row('Радиус элементов', P.radiusVal, [P.radius, ticks]),
        row('Акцентный цвет', P.accVal, [P.accSw, accRow,
          el('p', { class: 'set-hint', text: 'Свой цвет перекрывает акцент из блока «Оформление». «Как в теме» возвращает акцент темы.' })]),
        row('Интенсивность Glow', P.glowVal, [P.glow]),
        row('Плотность интерфейса', null, [dens.box]),
        row('Фон', null, [modes.box, P.subSolid, P.subGrad, P.subTex, P.bgNote]),
        row('Интенсивность анимаций', P.animVal, [P.anim]),
        row('Шрифт', null, [fontBox,
          el('p', { class: 'set-hint', text: 'Используются шрифты вашего устройства (кириллица и латиница поддерживаются). Вид зависит от телефона.' })]),
        row('Прозрачность поверхностей', P.opVal, [P.op,
          el('p', { class: 'set-hint', text: 'Меняется только фон карточек, панелей и окон. Текст и значки остаются чёткими.' })]),
        el('div', { class: 'set-row' }, [resetBtn, defBtn])
      ])
    ]);

    // Вставляем сразу после блока «Оформление»
    let after = null;
    view.querySelectorAll(':scope > .set-group').forEach(function (g) {
      const h = g.querySelector('h2');
      if (h && h.textContent === 'Оформление') after = g;
    });
    if (after) view.insertBefore(P.group, after.nextSibling);
    else view.insertBefore(P.group, view.firstChild);
    syncUi();
  }

  function syncUi() {
    if (!P.group) return;
    const c = state;
    const set = function (r, v) { if (document.activeElement !== r || Number(r.value) !== v) r.value = String(v); fillRange(r); };
    set(P.radius, c.radius);
    P.radiusVal.textContent = RADIUS_LABELS[c.radius] + ' · ' + RADII[c.radius] + ' px';
    const acc = effAccent();
    P.accVal.textContent = (c.accent ? c.accent : 'из темы') + (c.accent ? '' : ' (' + acc + ')');
    P.accPick.value = acc;
    P.accSw.querySelectorAll('.swatch').forEach(function (b) { b.classList.toggle('on', b.dataset.c === c.accent); });
    P.accAuto.classList.toggle('on', !c.accent);
    set(P.glow, c.glow);
    P.glowVal.textContent = c.glow + '% · ' + level5(c.glow, ['выкл', 'слабое', 'умеренное', 'выраженное', 'максимальное']);
    mark(P.dens, c.density);
    mark(P.modes, c.bg.mode);
    P.subSolid.hidden = c.bg.mode !== 'solid';
    P.subGrad.hidden = c.bg.mode !== 'gradient';
    P.subTex.hidden = c.bg.mode !== 'texture';
    const d = gradDefaults();
    P.g1.value = c.bg.g1 || d[0];
    P.g2.value = c.bg.g2 || d[1];
    P.solidPick.value = c.bg.color || base.bg;
    P.tPick.value = c.bg.color || base.bg;
    P.solidSw.querySelectorAll('.swatch').forEach(function (b) { b.classList.toggle('on', b.dataset.c === c.bg.color); });
    P.gradSw.querySelectorAll('.cz-gsw').forEach(function (b) {
      b.classList.toggle('on', c.bg.g1 && c.bg.g2 && b.dataset.c === c.bg.g1 + '|' + c.bg.g2);
    });
    mark(P.dirs, c.bg.dir);
    mark(P.texs, c.bg.texture);
    P.bgNote.textContent = (c.bg.mode === 'solid' ? !c.bg.color : c.bg.mode === 'gradient' ? !(c.bg.g1 || c.bg.g2) : !c.bg.color)
      ? 'Цвета фона взяты из текущей темы.'
      : 'Цвета карточек, границ и текста подбираются под выбранный фон автоматически.';
    set(P.anim, c.anim);
    P.animVal.textContent = c.anim + '% · ' + level5(c.anim, ['выкл', 'минимальные', 'стандартные', 'выраженные', 'максимальные']);
    FONT_IDS.forEach(function (id) {
      P.fonts[id].classList.toggle('on', id === c.font);
      P.fonts[id].setAttribute('aria-checked', id === c.font ? 'true' : 'false');
    });
    set(P.op, c.opacity);
    P.opVal.textContent = c.opacity + '%';
  }

  function resetAll(withTheme) {
    state = clone(DEF);
    if (withTheme && VOID.themes && VOID.themes.set) VOID.themes.set('graphite', 'auto');
    if (VOID.themes && VOID.themes.apply) VOID.themes.apply(); // вернёт цвета темы; наша подписка применит значения по умолчанию
    else apply();
    syncUi();
    save();
    if (VOID.toast) VOID.toast(withTheme ? 'Стандартное оформление возвращено' : 'Кастомизация сброшена', 'success', 1800);
  }

  /* =====================================================
     Запуск
     ===================================================== */
  if (VOID.themes && VOID.themes.onApply) {
    VOID.themes.onApply(function () { readBases(); apply(); syncUi(); });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && saveTimer) save(); });
  window.addEventListener('pagehide', function () { if (saveTimer) save(); });

  initBases();
  build();
  (VOID.settings && VOID.settings.read ? VOID.settings.read() : Promise.resolve({})).then(function (s) {
    state = sanitize(s && s.custom);
    inited = true;
    apply();
    syncUi();
  }).catch(function () {
    inited = true;
    apply();
  });

  VOID.custom = {
    get: function () { return clone(state); },
    animLevel: function () { return state.anim; },
    animScale: function () { return Math.max(0.3, state.anim / 50); },
    reset: function () { resetAll(false); }
  };
})();