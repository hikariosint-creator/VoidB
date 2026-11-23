/* ===== VOID — анимации тем (шаги T2–T3) =====
   Частицы рисуются на одном <canvas> позади приложения; свечение и лучи — отдельные слои на CSS.
   Эффекты по темам: Феникс (искры), Айсберг (иней), Лес (светлячки), Космос (звёзды),
   Ангел (перья и лучи света).
   Экономия батареи:
   - анимация работает только при разблокированном хранилище, на видимой странице
     и если сверху нет редактора или доски Graph (они закрывают фон);
   - режим «Эко»: 30 кадров в секунду, вдвое меньше частиц, без повышенной чёткости;
   - если в системе включено «Уменьшить движение», анимации выключены.
   Частицы подготовлены как маленькие картинки (спрайты), поэтому каждый кадр — только drawImage.
   Math.random() здесь используется лишь для внешнего вида (к шифрованию отношения не имеет).
   Выбор режима хранится в служебных настройках (личных данных там нет). */

(function () {
  'use strict';

  const VOID = window.VOID = window.VOID || {};
  const root = document.documentElement;

  const MODES = ['off', 'eco', 'on'];
  const MODE_LABEL = { off: 'Выкл', eco: 'Эко', on: 'Полные' };
  const MODE_TEXT = {
    off: 'Анимации выключены.',
    eco: 'Эко: меньше частиц и 30 кадров в секунду, экономит батарею.',
    on: 'Полные: больше частиц и максимальная плавность, расходует больше батареи.'
  };
  const GLOW_DUR = { eco: '11s', on: '7s' };

  // Какие эффекты у каких тем; g1/g2 — цвет и прозрачность двух пятен свечения
  const EFFECTS = {
    phoenix: { kind: 'embers',    g1: ['accent2', 0.20], g2: ['accent', 0.14] },
    iceberg: { kind: 'frost',     g1: ['accent', 0.20],  g2: ['accent2', 0.10] },
    forest:  { kind: 'fireflies', g1: ['accent', 0.22],  g2: ['accent2', 0.08] },
    cosmos:  { kind: 'stars',     g1: ['accent', 0.26],  g2: ['accent2', 0.12] },
    angel:   { kind: 'feathers',  g1: ['accent2', 0.38], g2: ['accent', 0.10], rays: true }
  };
  const BASE = { embers: 36, frost: 46, fireflies: 18, stars: 70, feathers: 16 };

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  let mode = 'eco';

  let canvas = null, ctx = null, glowIn = null;
  let W = 0, H = 0, dpr = 1;
  let kind = '', parts = [], sprites = [];
  let shoot = null, nextShoot = 6;
  let running = false, raf = 0, last = 0, t = 0, fade = 0, resizeTimer = 0;

  let tabEls = null, hintEl = null;

  /* ---------- Помощники ---------- */
  function themeId() { return root.dataset.theme || 'graphite'; }

  function cssColor(name, fallback) {
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /** Круглое «светящееся пятнышко» заданного цвета. */
  function makeSprite(hex) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, rgba(hex, 1));
    gr.addColorStop(0.3, rgba(hex, 0.5));
    gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 48, 48);
    return c;
  }

  /** Перо: белое с голубой окантовкой и мягкой тенью, чтобы было видно на светлом фоне. */
  function makeFeather(c1, c2, stroke) {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 96;
    const g = c.getContext('2d');
    g.translate(20, 48);
    g.beginPath();
    g.moveTo(0, -42);
    g.bezierCurveTo(15, -28, 17, 10, 0, 42);
    g.bezierCurveTo(-17, 10, -15, -28, 0, -42);
    g.closePath();
    const gr = g.createLinearGradient(-15, 0, 15, 0);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.shadowColor = 'rgba(60,110,170,0.28)';
    g.shadowBlur = 5;
    g.fillStyle = gr;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 1.4;
    g.strokeStyle = stroke;
    g.stroke();
    // стержень и бородки
    g.beginPath();
    g.moveTo(0, -40);
    g.lineTo(0, 46);
    for (let y = -20; y <= 24; y += 9) {
      g.moveTo(0, y + 6); g.lineTo(9, y - 3);
      g.moveTo(0, y + 6); g.lineTo(-9, y - 3);
    }
    g.lineWidth = 1;
    g.globalAlpha = 0.55;
    g.stroke();
    return c;
  }

  function palette(k) {
    const acc = cssColor('--accent', '#D9480F');
    const acc2 = cssColor('--accent2', '#FFB020');
    const hov = cssColor('--accent-hover', '#F76707');
    if (k === 'embers') return [acc2, hov];
    if (k === 'frost') return ['#CFEAFF', acc2];
    if (k === 'fireflies') return [acc2, '#E8FFB0'];
    return ['#FFFFFF', acc2]; // звёзды
  }

  /* ---------- Частицы ---------- */
  function makeParticle(initial) {
    const p = { x: rnd(0, W), y: rnd(0, H), vx: 0, vy: 0, s: 6, a: 0.6,
      ph: rnd(0, 6.28), fq: rnd(0.8, 2.2), ang: rnd(0, 6.28), sp: 0, tilt: 0, spr: Math.random() < 0.7 ? 0 : 1 };
    if (kind === 'embers') {
      p.vy = -rnd(22, 70);
      p.vx = rnd(-5, 5);
      p.s = rnd(8, 22);
      p.a = rnd(0.5, 1);
      if (!initial) p.y = H + rnd(10, 50);
    } else if (kind === 'frost') {
      p.vy = rnd(10, 36);
      p.vx = rnd(-4, 4);
      p.s = 3 + Math.pow(Math.random(), 2) * 12;
      p.a = rnd(0.25, 0.7);
      if (!initial) p.y = -rnd(10, 40);
    } else if (kind === 'fireflies') {
      p.sp = rnd(6, 20);
      p.s = rnd(12, 28);
      p.a = rnd(0.55, 0.95);
      p.fq = rnd(0.6, 1.8);
    } else if (kind === 'feathers') {
      p.vy = rnd(14, 34);
      p.s = rnd(26, 54);
      p.a = rnd(0.6, 0.95);
      p.fq = rnd(0.7, 1.7);
      p.tilt = rnd(-0.5, 0.5);
      if (!initial) p.y = -rnd(30, 90);
    } else { // звёзды
      p.s = 2 + Math.pow(Math.random(), 2) * 7;
      p.a = rnd(0.35, 0.95);
      p.fq = rnd(0.5, 2.4);
    }
    return p;
  }

  function target() {
    const area = Math.min(2.2, Math.max(0.7, (W * H) / (360 * 780)));
    return Math.max(6, Math.round(BASE[kind] * area * (mode === 'eco' ? 0.5 : 1)));
  }

  function syncCount() {
    if (!kind) return;
    const n = target();
    parts.forEach(function (p) {
      if (p.x > W) p.x = rnd(0, W);
      if (p.y > H && kind !== 'embers' && kind !== 'frost' && kind !== 'feathers') p.y = rnd(0, H);
    });
    while (parts.length < n) parts.push(makeParticle(true));
    if (parts.length > n) parts.length = n;
  }

  function step(dt) {
    ctx.clearRect(0, 0, W, H);
    const k = kind;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let a = p.a, s = p.s;
      if (k === 'embers') {
        p.y += p.vy * dt;
        p.x += (p.vx + Math.sin(t * p.fq + p.ph) * 14) * dt;
        if (p.y < -30) { parts[i] = makeParticle(false); continue; }
        const f = Math.max(0, Math.min(1, p.y / H));
        a = p.a * (0.2 + 0.8 * f) * (0.75 + 0.25 * Math.sin(t * p.fq * 3 + p.ph));
        s = p.s * (0.5 + 0.5 * f);
      } else if (k === 'frost') {
        p.y += p.vy * dt;
        p.x += (p.vx + Math.sin(t * p.fq * 0.6 + p.ph) * 10) * dt;
        if (p.y > H + 20) { parts[i] = makeParticle(false); continue; }
        a = p.a * (0.8 + 0.2 * Math.sin(t * p.fq + p.ph));
      } else if (k === 'fireflies') {
        p.ang += Math.sin(t * 0.3 + p.ph) * dt * 1.4;
        p.x += Math.cos(p.ang) * p.sp * dt;
        p.y += Math.sin(p.ang) * p.sp * dt;
        if (p.x < -30) p.x = W + 30; else if (p.x > W + 30) p.x = -30;
        if (p.y < -30) p.y = H + 30; else if (p.y > H + 30) p.y = -30;
        const b = 0.5 + 0.5 * Math.sin(t * p.fq + p.ph);
        a = p.a * b * b;
      } else if (k === 'feathers') {
        p.y += p.vy * dt;
        p.x += Math.sin(t * p.fq * 0.45 + p.ph) * 24 * dt;
        if (p.y > H + 60) { parts[i] = makeParticle(false); continue; }
        // перо покачивается и медленно кружится; рисуем с поворотом
        ctx.globalAlpha = Math.max(0, Math.min(1, p.a * fade));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.tilt + Math.sin(t * p.fq * 0.45 + p.ph + 1.2) * 0.7);
        ctx.drawImage(sprites[p.spr] || sprites[0], -p.s * 0.2083, -p.s / 2, p.s * 0.4167, p.s);
        ctx.restore();
        continue;
      } else {
        a = p.a * (0.55 + 0.45 * Math.sin(t * p.fq + p.ph));
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, a * fade));
      ctx.drawImage(sprites[p.spr] || sprites[0], p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    if (k === 'stars') drawShoot(dt);
  }

  /** Падающая звезда (только у Космоса), раз в 7–14 секунд (в «Эко» реже). */
  function drawShoot(dt) {
    nextShoot -= dt;
    if (!shoot && nextShoot <= 0) {
      shoot = { x: rnd(W * 0.35, W * 0.95), y: rnd(0, H * 0.35), vx: -rnd(260, 380), vy: rnd(120, 200), life: 0, dur: 0.9 };
      nextShoot = mode === 'eco' ? rnd(10, 20) : rnd(7, 14);
    }
    if (!shoot) return;
    shoot.life += dt;
    shoot.x += shoot.vx * dt;
    shoot.y += shoot.vy * dt;
    if (shoot.life >= shoot.dur) { shoot = null; return; }
    const al = Math.sin(Math.PI * shoot.life / shoot.dur) * fade;
    const tx = shoot.x - shoot.vx * 0.14;
    const ty = shoot.y - shoot.vy * 0.14;
    const g = ctx.createLinearGradient(tx, ty, shoot.x, shoot.y);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,' + (0.9 * al) + ')');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(shoot.x, shoot.y);
    ctx.stroke();
  }

  /* ---------- Холст, свечение и лучи ---------- */
  function ensureDom() {
    if (canvas) return true;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (!g) return false;
    canvas = c;
    ctx = g;
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const glow = document.createElement('div');
    glow.className = 'fx-glow';
    glow.setAttribute('aria-hidden', 'true');
    glowIn = document.createElement('div');
    glowIn.className = 'fx-glow__in';
    glow.appendChild(glowIn);
    const rays = document.createElement('div');
    rays.className = 'fx-rays';
    rays.setAttribute('aria-hidden', 'true');
    // снизу вверх: свечение, лучи, частицы
    document.body.insertBefore(canvas, document.body.firstChild);
    document.body.insertBefore(rays, canvas);
    document.body.insertBefore(glow, rays);
    return true;
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, mode === 'on' ? 1.5 : 1);
    W = window.innerWidth;
    H = window.innerHeight;
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncCount();
  }

  /** Подготовка эффекта текущей темы: цвета, свечение, лучи, частицы. */
  function applyTheme() {
    const fx = EFFECTS[themeId()];
    if (!fx || !ensureDom()) { kind = ''; return false; }
    kind = fx.kind;
    if (kind === 'feathers') {
      sprites = [
        makeFeather('#FFFFFF', '#F3F8FD', 'rgba(105,150,205,0.70)'),
        makeFeather('#F7FAFF', '#D9E9F9', 'rgba(90,135,195,0.75)')
      ];
    } else {
      sprites = palette(kind).map(makeSprite);
    }
        root.classList.toggle('fx-has-rays', !!fx.rays);
    glowIn.style.setProperty('--g1', rgba(cssColor('--' + fx.g1[0], '#D9480F'), fx.g1[1]));
    glowIn.style.setProperty('--g2', rgba(cssColor('--' + fx.g2[0], '#FFB020'), fx.g2[1]));
    glowIn.style.setProperty('--fx-dur', GLOW_DUR[mode] || '9s');
    parts = [];
    shoot = null;
    nextShoot = rnd(4, 8);
    resize();
    return true;
  }

  /* ---------- Цикл ---------- */
  function frame(now) {
    raf = 0;
    if (!running) return;
    if (mode === 'eco' && last && now - last < 29) { raf = requestAnimationFrame(frame); return; }
        const k = (VOID.custom && VOID.custom.animScale) ? VOID.custom.animScale() : 1;
    const dt = (last ? Math.min(0.06, (now - last) / 1000) : 0.016) * k;
    last = now;
    t += dt;
    fade = Math.min(1, fade + dt / 0.9); // плавное появление
    step(dt);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!applyTheme()) return;
    running = true;
    last = 0;
    fade = 0;
    root.classList.add('fx-live');
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (ctx) ctx.clearRect(0, 0, W, H);
    root.classList.remove('fx-live');
  }

  /** Редактор записи и доска Graph закрывают фон: анимацию под ними не тратим. */
  function covered() {
    return !!document.querySelector('.gw:not([hidden]), .editor:not([hidden])');
  }

  function shouldRun() {
        return mode !== 'off' && !reduced && !document.hidden &&
      !!(VOID.auth && VOID.auth.isUnlocked()) && !!EFFECTS[themeId()] && !covered() &&
      !(VOID.custom && VOID.custom.animLevel() === 0);
  }

  function sync() {
    const want = shouldRun();
    if (want && !running) start();
    else if (!want && running) stop();
  }

  /* ---------- Переключатель в «Настройках» ---------- */
  function refreshUi() {
    if (tabEls) {
      MODES.forEach(function (m) {
        const on = m === mode;
        tabEls[m].classList.toggle('active', on);
        tabEls[m].setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    if (!hintEl) return;
    let msg;
    if (reduced) msg = 'В системе включено «Уменьшить движение», поэтому анимации отключены.';
    else if (!EFFECTS[themeId()]) msg = 'У этой темы нет анимации. Она есть у тем Феникс, Айсберг, Лес, Космос и Ангел.';
    else msg = MODE_TEXT[mode];
    hintEl.textContent = msg + ' Анимации сами останавливаются, когда приложение свёрнуто или заблокировано, ' +
      'а также под редакторами и досками Graph.';
  }

  function setMode(m) {
    if (MODES.indexOf(m) < 0 || m === mode) return;
    mode = m;
    stop();
    sync();
    refreshUi();
    if (VOID.settings && VOID.settings.update) {
      VOID.settings.update({ fxMode: m }).catch(function (err) { console.error('FX save error:', err); });
    }
  }

  function install() {
    if (!VOID.ui) return;
    const el = VOID.ui.el;
    const view = document.getElementById('view-settings');
    if (!view) return;
    let panel = null;
    view.querySelectorAll(':scope > .set-group').forEach(function (g) {
      const h = g.querySelector('h2');
      if (h && h.textContent === 'Оформление') panel = g.querySelector('.set-panel');
    });
    if (!panel) return; // нет блока оформления: переключатель добавлять некуда

    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    tabEls = {};
    MODES.forEach(function (m) {
      const b = el('button', { class: 'tab', type: 'button', role: 'tab', 'data-fx': m, text: MODE_LABEL[m] });
      tabEls[m] = b;
      tabs.appendChild(b);
    });
    tabs.addEventListener('click', function (e) {
      const b = e.target.closest('[data-fx]');
      if (b) setMode(b.dataset.fx);
    });
    hintEl = el('p', { class: 'set-hint fx-hint' });
    panel.appendChild(el('div', { class: 'set-row' }, [
      el('div', { class: 'set-label', text: 'Анимации фона' }), tabs, hintEl
    ]));
    refreshUi();
  }

  /* ---------- События ---------- */
  function onTheme() {
    if (running) {
      if (EFFECTS[themeId()]) { applyTheme(); fade = 0; } else stop();
    } else {
      sync();
    }
    refreshUi();
  }

  document.addEventListener('visibilitychange', sync);
  document.addEventListener('void:lock', sync);
  document.addEventListener('void:unlock', sync);
  window.addEventListener('hashchange', sync);
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (running) resize(); }, 250);
  });
  if (mq) {
    const onMq = function () { reduced = mq.matches; sync(); refreshUi(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  if (VOID.themes && VOID.themes.onApply) VOID.themes.onApply(onTheme);
  setInterval(sync, 700); // замечает открытие и закрытие редакторов и досок

  if (VOID.settings && VOID.settings.read) {
    VOID.settings.read().then(function (s) {
      if (s && MODES.indexOf(s.fxMode) >= 0) mode = s.fxMode;
      refreshUi();
      sync();
    }).catch(function () { /* оставляем режим «Эко» */ });
  }
  install();

  VOID.fx = { setMode: setMode, getMode: function () { return mode; } };
})();