/* ===== VOID DOCUMENTS — ядро =====
   - sanitize(): безопасная очистка HTML по белому списку. Документ разбирается в «мёртвом» DOM
     (DOMParser: скрипты и загрузка картинок отключены), и из него заново строится чистое дерево:
     только разрешённые теги и несколько проверенных стилей. Скрипты, обработчики событий, iframe,
     опасные ссылки отбрасываются. Это единственный путь, по которому содержимое попадает в хранилище.
   - toText(): преобразование документа в текст (для поиска, статистики и экспорта TXT). */

(function () {
  'use strict';
  const VOID = window.VOID = window.VOID || {};

  const THEMES = ['white', 'gray', 'black'];
  const MAX_HTML = 1500000;
  const MAX_TEXT = 100000;

  const KEEP = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'BR',
    'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SPAN', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH',
    'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'INPUT', 'FORM', 'LINK', 'META', 'TITLE', 'HEAD', 'CANVAS',
    'AUDIO', 'VIDEO', 'SOURCE', 'FRAME', 'FRAMESET', 'APPLET', 'BASE']);
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SPAN', 'A', 'BR', 'IMG']);
  const ALIGN_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'TD', 'TH']);
  const ALIGN_VALUES = ['left', 'center', 'right', 'justify'];
  const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?\))$/i;
  const IMG_ID_RE = /^img_[0-9a-f]{32}$/;

  function safeHref(v) {
    const s = String(v == null ? '' : v).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
    if (!s || s.length > 2000) return '';
    return /^(https?:|mailto:|tel:)/i.test(s) ? s : '';
  }

  /** Из inline-стилей исходного элемента берём только проверенные свойства. */
  function styleOf(src, tag, strip) {
    const parts = [];
    const st = src.style;
    if (!strip && st) {
      const c = (st.color || '').trim();
      if (c && COLOR_RE.test(c)) parts.push('color:' + c);
      const bg = (st.backgroundColor || '').trim();
      if (bg && COLOR_RE.test(bg)) parts.push('background-color:' + bg);
      const m = /^(\d{1,3}(?:\.\d+)?)px$/.exec(st.fontSize || '');
      if (m) {
        const v = parseFloat(m[1]);
        if (v >= 8 && v <= 120) parts.push('font-size:' + v + 'px');
      }
    }
    if (!strip && src.tagName === 'FONT') {
      const fc = (src.getAttribute('color') || '').trim();
      if (fc && /^#[0-9a-f]{3,8}$/i.test(fc) && !parts.some(function (p) { return p.indexOf('color:') === 0; })) {
        parts.push('color:' + fc);
      }
    }
    if (!strip && ALIGN_TAGS.has(tag)) {
      let ta = st ? st.textAlign : '';
      if (ALIGN_VALUES.indexOf(ta) < 0) ta = (src.getAttribute('align') || '').toLowerCase();
      if (ALIGN_VALUES.indexOf(ta) >= 0) parts.push('text-align:' + ta);
    }
    return parts.join(';');
  }

  function intAttr(v, max) {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 1 && n <= max ? n : 0;
  }

  /** Рекурсивное построение чистого дерева. */
  function build(src, dst, depth, strip) {
    for (let n = src.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      let tag = n.tagName;
      if (tag === 'STRIKE' || tag === 'DEL') tag = 'S';
      else if (tag === 'FONT') tag = 'SPAN';
      if (DROP.has(tag)) continue;
      if (!KEEP.has(tag) || depth > 60) { build(n, dst, depth + 1, strip); continue; }

      if (tag === 'IMG') {
        const id = n.getAttribute('data-img') || '';
        if (!IMG_ID_RE.test(id)) continue;
                const img = document.createElement('img');
        img.setAttribute('data-img', id);
        img.setAttribute('alt', '');
        if (n.getAttribute('data-dg') === '1') {
          img.setAttribute('data-dg', '1');
          const bd = n.getAttribute('data-bd') || '';
          if (/^[0-9a-f]{32}$/.test(bd)) img.setAttribute('data-bd', bd);
        }
        const w = n.style ? /^(\d{2,4})px$/.exec(n.style.width || '') : null;
        if (w && +w[1] >= 20 && +w[1] <= 4000) img.setAttribute('style', 'width:' + w[1] + 'px');
        dst.appendChild(img);
        continue;
      }
      if (tag === 'A') {
        const href = safeHref(n.getAttribute('href'));
        if (!href) { build(n, dst, depth + 1, strip); continue; }
        const a = document.createElement('a');
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        build(n, a, depth + 1, strip);
        dst.appendChild(a);
        continue;
      }
      if (tag === 'HR' || tag === 'BR') { dst.appendChild(document.createElement(tag)); continue; }

      const style = styleOf(n, tag, strip);
      if (tag === 'SPAN') {
        if (!style) { build(n, dst, depth + 1, strip); continue; } // пустая обёртка — убираем
        const sp = document.createElement('span');
        sp.setAttribute('style', style);
        build(n, sp, depth + 1, strip);
        dst.appendChild(sp);
        continue;
      }
      const e = document.createElement(tag);
      if (style) e.setAttribute('style', style);
      if (tag === 'TD' || tag === 'TH') {
        const cs = intAttr(n.getAttribute('colspan'), 20);
        const rs = intAttr(n.getAttribute('rowspan'), 20);
        if (cs) e.setAttribute('colspan', String(cs));
        if (rs) e.setAttribute('rowspan', String(rs));
      }
      build(n, e, depth + 1, strip);
      dst.appendChild(e);
    }
  }

  function emptyPara() {
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    return p;
  }

  /** Строчные элементы и текст на верхнем уровне заворачиваем в абзацы. */
  function normalizeTop(c) {
    let run = null;
    Array.from(c.childNodes).forEach(function (n) {
      const inline = n.nodeType === 3 || (n.nodeType === 1 && INLINE.has(n.tagName));
      if (!inline) { run = null; return; }
      if (n.nodeType === 3 && !n.nodeValue.trim() && !run) { c.removeChild(n); return; }
      if (!run) { run = document.createElement('p'); c.insertBefore(run, n); }
      run.appendChild(n);
    });
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><body>' + String(html == null ? '' : html) + '</body></html>', 'text/html');
    return doc.body;
  }

  /** Возвращает «чистый» контейнер (не вставленный в страницу). opts.strip — убрать цвета и размеры (для вставки). */
  function sanitizeNode(html, opts) {
    const out = document.createElement('div');
    build(parse(html), out, 0, !!(opts && opts.strip));
    normalizeTop(out);
    if (!out.firstChild) out.appendChild(emptyPara());
    return out;
  }

  function sanitize(html, opts) { return sanitizeNode(html, opts).innerHTML; }

  /* ---------- Текст из документа ---------- */
  /** mode: 'rich' — со структурой (для TXT), 'plain' — без разметки (для поиска и подсчёта слов). */
  function textFromNode(root, mode) {
    const rich = mode === 'rich';
    const lines = [];
    const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'BLOCKQUOTE', 'HR', 'TABLE']);
    const collapse = function (s) { return s.replace(/[ \t\r\n\f]+/g, ' '); };
    const hasBlock = function (n) { return Array.from(n.children).some(function (c) { return BLOCKS.has(c.tagName); }); };

    function inl(n) {
      if (n.nodeType === 3) return collapse(n.nodeValue);
      if (n.nodeType !== 1) return '';
      const tag = n.tagName;
      if (tag === 'BR') return '\n';
            if (tag === 'IMG') return rich ? (n.getAttribute('data-dg') === '1' ? '[Схема]' : '[Изображение]') : '';
      let s = '';
      n.childNodes.forEach(function (c) { s += inl(c); });
      if (tag === 'A' && rich) {
        const href = n.getAttribute('href') || '';
        const t = s.trim();
        if (href && t && t !== href && ('mailto:' + t) !== href && ('tel:' + t) !== href) return s + ' (' + href + ')';
      }
      return s;
    }
    function pushPara(text, indent) {
      text.split('\n').forEach(function (part) {
        const t = part.replace(/ +/g, ' ').trim();
        if (t) lines.push(indent + t);
      });
    }
    function list(listEl, indent) {
      const ordered = listEl.tagName === 'OL';
      let i = 0;
      Array.from(listEl.children).forEach(function (li) {
        if (li.tagName !== 'LI') return;
        i++;
        let text = '';
        const nested = [];
        li.childNodes.forEach(function (c) {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c);
          else text += inl(c) + ((c.nodeType === 1 && (c.tagName === 'P' || c.tagName === 'DIV')) ? ' ' : '');
        });
        const t = text.replace(/\s*\n\s*/g, ' ').replace(/ +/g, ' ').trim();
        if (t || !nested.length) lines.push(indent + (rich ? (ordered ? i + '. ' : '• ') : '') + t);
        nested.forEach(function (nl) { list(nl, indent + (rich ? '   ' : '')); });
      });
    }
    function cellText(c) {
      let t = inl(c).replace(/\s*\n\s*/g, ' ').replace(/ +/g, ' ').trim();
      if (rich) t = t.replace(/\|/g, '\\|');
      return t;
    }
    function table(t) {
      const data = Array.from(t.querySelectorAll('tr')).map(function (tr) {
        return Array.from(tr.children).filter(function (c) { return c.tagName === 'TD' || c.tagName === 'TH'; }).map(cellText);
      }).filter(function (r) { return r.length; });
      if (!data.length) return;
      const cols = data.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      lines.push('');
      data.forEach(function (r, idx) {
        const row = r.concat(new Array(cols - r.length).fill(''));
        if (rich) {
          lines.push('| ' + row.join(' | ') + ' |');
          if (idx === 0) lines.push('|' + new Array(cols).fill('---').join('|') + '|');
        } else {
          const s = row.join(' ').replace(/ +/g, ' ').trim();
          if (s) lines.push(s);
        }
      });
      lines.push('');
    }
    function walk(parent, indent) {
      parent.childNodes.forEach(function (n) {
        if (n.nodeType === 3) {
          const t = collapse(n.nodeValue).trim();
          if (t) lines.push(indent + t);
          return;
        }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
          const t = inl(n).replace(/\s*\n\s*/g, ' ').trim();
          if (t) { lines.push(''); lines.push(indent + (rich ? new Array(Number(tag[1]) + 1).join('#') + ' ' : '') + t); lines.push(''); }
        } else if (tag === 'P' || tag === 'DIV') {
          if (hasBlock(n)) walk(n, indent);
          else { pushPara(inl(n), indent); lines.push(''); }
        } else if (tag === 'UL' || tag === 'OL') {
          list(n, indent);
          lines.push('');
        } else if (tag === 'BLOCKQUOTE') {
          const start = lines.length;
          walk(n, '');
          for (let i = start; i < lines.length; i++) if (lines[i]) lines[i] = (rich ? '> ' : '') + lines[i];
          lines.push('');
        } else if (tag === 'HR') {
          if (rich) { lines.push(''); lines.push('----------'); lines.push(''); }
        } else if (tag === 'TABLE') {
          table(n);
        } else {
          pushPara(inl(n), indent);
        }
      });
    }

    walk(root, '');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function toText(html, mode) { return textFromNode(sanitizeNode(html), mode); }

  /** Обычный текст -> абзацы (для старых записей дневника). */
  function htmlFromPlain(text) {
    const c = document.createElement('div');
    String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      const p = document.createElement('p');
      if (line) p.textContent = line; else p.appendChild(document.createElement('br'));
      c.appendChild(p);
    });
    if (!c.firstChild) c.appendChild(emptyPara());
    return c.innerHTML;
  }

  function fileName(title) {
    const s = String(title || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return s || 'document';
  }

  function hasMedia(html) { return /<(img|table|hr)\b/i.test(String(html || '')); }

  VOID.docsCore = {
    THEMES: THEMES, MAX_HTML: MAX_HTML, MAX_TEXT: MAX_TEXT,
    sanitize: sanitize, sanitizeNode: sanitizeNode, textFromNode: textFromNode, toText: toText,
    htmlFromPlain: htmlFromPlain, fileName: fileName, hasMedia: hasMedia
  };
})();