/* ===== VOID — темы оформления (шаги T1–T3) =====
   Тема = набор цветов (фон, карточки, границы, текст, акцент) и мягкое свечение сверху.
   Применяется через CSS-переменные на <html>; выбор хранится в служебных настройках
   (в них нет личных данных). Акцент можно переопределить своим цветом.
   Светлые темы (light: true) переключают цветовую схему браузера (выпадающие списки,
   поля даты, полосы прокрутки) и используют более тёмный цвет для наведения.

   Анимациями занимается js/fx.js: он подписывается на смену темы через VOID.themes.onApply(fn),
   а текущая тема записана в атрибут data-theme у <html>. */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};

  const THEMES = {
    graphite: { name: 'Графит', desc: 'Классика VOID', fx: null,
      bg: '#080808', bg2: '#101010', card: '#171717', border: '#303030', text: '#E5E5E5', text2: '#858585',
      accent: '#A32632', hover: '#C03945', accent2: '#C03945', ambient: 'transparent' },
    phoenix: { name: 'Феникс', desc: 'Угли и оранжевое пламя', fx: 'embers',
      bg: '#0E0605', bg2: '#180B07', card: '#21110A', border: '#47261A', text: '#F6E7DB', text2: '#B0917F',
      accent: '#D9480F', hover: '#F76707', accent2: '#FFB020', ambient: 'rgba(240,110,20,0.20)' },
    iceberg: { name: 'Айсберг', desc: 'Глубокий синий и иней', fx: 'frost',
      bg: '#060B12', bg2: '#0C151F', card: '#122030', border: '#27394D', text: '#E4EFF9', text2: '#86A0B6',
      accent: '#2B77B8', hover: '#4A9AE0', accent2: '#A8DCFF', ambient: 'rgba(80,160,230,0.17)' },
    forest: { name: 'Лес', desc: 'Тёмная хвоя и мох', fx: 'fireflies',
      bg: '#07100A', bg2: '#0D1A11', card: '#142619', border: '#2A4331', text: '#E5EFE5', text2: '#8CA790',
      accent: '#2A7F46', hover: '#3FA462', accent2: '#BFE07A', ambient: 'rgba(60,170,100,0.16)' },
    cosmos: { name: 'Космос', desc: 'Индиго и фиолет', fx: 'stars',
      bg: '#070613', bg2: '#0E0C20', card: '#16132D', border: '#312B58', text: '#E9E7F9', text2: '#928EBB',
      accent: '#6B4FD6', hover: '#8668F0', accent2: '#D58CFF', ambient: 'rgba(130,100,240,0.22)' },
    angel: { name: 'Ангел', desc: 'Светлая, нежно-голубая', fx: 'feathers', light: true, danger: '#C0392B',
      bg: '#EAF1F8', bg2: '#F6FAFD', card: '#FFFFFF', border: '#D0DDEA', text: '#1B2733', text2: '#55697D',
      accent: '#2F6DB5', hover: '#1F5A9E', accent2: '#7DB9EE', ambient: 'rgba(150,200,248,0.40)' },
    black: { name: 'Чёрный', desc: 'Чистый чёрный для OLED', fx: null,
      bg: '#000000', bg2: '#070707', card: '#101010', border: '#262626', text: '#E5E5E5', text2: '#858585',
      accent: '#A32632', hover: '#C03945', accent2: '#C03945', ambient: 'transparent' },
    gray: { name: 'Серый', desc: 'Мягкий графитовый серый', fx: null,
      bg: '#141414', bg2: '#1C1C1C', card: '#242424', border: '#3A3A3A', text: '#E5E5E5', text2: '#858585',
      accent: '#A32632', hover: '#C03945', accent2: '#C03945', ambient: 'transparent' }
  };
  const ORDER = ['graphite', 'phoenix', 'iceberg', 'forest', 'cosmos', 'angel', 'black', 'gray'];

  const ACCENTS = {
    crimson: { label: 'Бордовый', main: '#A32632', hover: '#C03945' },
    steel: { label: 'Сталь', main: '#3F6FA3', hover: '#5588BF' },
    moss: { label: 'Мох', main: '#4C8A5B', hover: '#5FA46F' },
    amber: { label: 'Янтарь', main: '#A8741F', hover: '#C48A2B' },
    violet: { label: 'Фиолет', main: '#7B4FA3', hover: '#9566BF' }
  };

  let current = { theme: 'graphite', accent: 'auto' };
  let switchTimer = 0;
  let cardEls = null;
  let swatchEls = null;
  const listeners = [];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** Проверка сохранённого выбора: неизвестные значения заменяются безопасными. */
  function sanitize(a) {
    const out = { theme: 'graphite', accent: 'auto' };
    if (a && typeof a === 'object') {
      if (typeof a.theme === 'string' && has(THEMES, a.theme)) out.theme = a.theme;
      if (typeof a.accent === 'string' && (a.accent === 'auto' || has(ACCENTS, a.accent))) out.accent = a.accent;
    }
    return out;
  }

  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /** Затемнение цвета (множитель f < 1): для наведения на светлых темах. */
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); };
    return '#' + [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)]
      .map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------- Применение ---------- */
  function apply(animate) {
    const t = THEMES[current.theme];
    const root = document.documentElement;
    let accent = t.accent, hover = t.hover, accent2 = t.accent2, ambient = t.ambient;
    if (current.accent !== 'auto') {
      const a = ACCENTS[current.accent];
      accent = a.main;
      hover = t.light ? shade(a.main, 0.78) : a.hover;
      accent2 = a.hover;
      if (t.ambient !== 'transparent') ambient = rgba(a.main, t.light ? 0.22 : 0.15);
    }

    if (animate && !reducedMotion()) {
      root.classList.add('theming');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(function () { root.classList.remove('theming'); }, 450);
    }

    const vars = {
      '--bg': t.bg, '--bg2': t.bg2, '--card': t.card, '--border': t.border,
      '--text': t.text, '--text2': t.text2, '--danger': t.danger || '#E06A75',
      '--accent': accent, '--accent-hover': hover, '--accent2': accent2, '--ambient': ambient,
      '--accent-12': rgba(accent, 0.12), '--accent-22': rgba(accent, 0.22),
      '--accent-35': rgba(accent, 0.35), '--accent-45': rgba(accent, 0.45)
    };
    Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
    root.style.colorScheme = t.light ? 'light' : 'dark';
    root.dataset.theme = current.theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.bg);

    highlight();
    const info = { theme: current.theme, accent: current.accent, fx: t.fx };
    listeners.forEach(function (fn) {
      try { fn(info); } catch (err) { console.error('Theme listener error:', err); }
    });
  }

  /* ---------- Хранение ---------- */
  async function readSettings() {
    try { return (await VOID.db.getMeta('settings')) || {}; } catch (_) { return {}; }
  }

  async function save() {
    try {
      const cur = await readSettings();
      await VOID.db.setMeta('settings', Object.assign({}, cur,
        { appearance: { theme: current.theme, accent: current.accent } }));
    } catch (err) {
      console.error('Appearance save error:', err);
      if (VOID.toast) VOID.toast('Не удалось сохранить оформление', 'error');
    }
  }

  function set(theme, accent) {
    const next = sanitize({ theme: theme, accent: accent });
    if (next.theme === current.theme && next.accent === current.accent) return;
    current = next;
    apply(true);
    save();
  }

  /* ---------- Панель в настройках ---------- */
  function highlight() {
    if (cardEls) {
      cardEls.forEach(function (b, id) {
        const on = id === current.theme;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    if (swatchEls) {
      swatchEls.forEach(function (b, id) {
        const on = id === current.accent;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
  }

  /** Возвращает два блока для раздела «Оформление» (тема и акцентный цвет). */
  function buildPanel() {
    const el = VOID.ui.el;
    cardEls = new Map();
    swatchEls = new Map();

    const grid = el('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Тема оформления' });
    ORDER.forEach(function (id) {
      const t = THEMES[id];
      const preview = el('div', { class: 'theme-card__preview' });
      [t.bg, t.card, t.accent, t.accent2].forEach(function (c) {
        const s = el('span');
        s.style.background = c;
        preview.appendChild(s);
      });
      const card = el('button', { class: 'theme-card', type: 'button', role: 'radio',
        'data-theme': id, 'aria-checked': 'false' }, [
        preview,
        el('div', { class: 'theme-card__name', text: t.name }),
        el('div', { class: 'theme-card__desc', text: t.desc })
      ]);
      cardEls.set(id, card);
      grid.appendChild(card);
    });
    grid.addEventListener('click', function (e) {
      const b = e.target.closest('[data-theme]');
      if (b && has(THEMES, b.dataset.theme)) set(b.dataset.theme, 'auto'); // при смене темы акцент снова «из темы»
    });

    const sw = el('div', { class: 'swatches' });
    const auto = el('button', { class: 'swatch swatch--auto', type: 'button', 'data-accent': 'auto', text: 'Как в теме' });
    swatchEls.set('auto', auto);
    sw.appendChild(auto);
    Object.keys(ACCENTS).forEach(function (id) {
      const b = el('button', { class: 'swatch', type: 'button', 'data-accent': id, 'aria-label': ACCENTS[id].label });
      b.style.background = ACCENTS[id].main;
      swatchEls.set(id, b);
      sw.appendChild(b);
    });
    sw.addEventListener('click', function (e) {
      const b = e.target.closest('[data-accent]');
      if (!b) return;
      const id = b.dataset.accent;
      if (id === 'auto' || has(ACCENTS, id)) set(current.theme, id);
    });

    highlight();
    const row = function (label, node) {
      return el('div', { class: 'set-row' }, [el('div', { class: 'set-label', text: label }), node]);
    };
    return [row('Тема', grid), row('Акцентный цвет', sw)];
  }

  /* ---------- Запуск ---------- */
  readSettings().then(function (s) {
    current = sanitize(s.appearance);
    apply(false);
  });

  VOID.themes = {
    list: ORDER.map(function (id) { return { id: id, name: THEMES[id].name }; }),
    get: function () { return { theme: current.theme, accent: current.accent }; },
    set: set,
    apply: function () { apply(false); },
    refresh: highlight,
    onApply: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    buildPanel: buildPanel
  };
})();