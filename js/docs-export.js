/* ===== VOID DOCUMENTS — экспорт =====
   TXT: файл создаётся на устройстве (скачивание или системное меню «Поделиться»).
   PDF: открывается системное окно печати Android, в нём выбирается «Сохранить как PDF».
        Так получается настоящий текст (его можно выделять), таблицы, картинки, кириллица
        и нормальная разбивка по страницам. Для печати всегда используется белая тема.
   Ничего никуда не отправляется. */

(function () {
  'use strict';
  const VOID = window.VOID = window.VOID || {};
  const core = VOID.docsCore;
  if (!core) { console.error('VOID DOCUMENTS: не загружен docs-core.js'); return; }

  let printTimer = 0;

  function buildText(title, html) {
    const head = (String(title || '').trim() || 'Без названия');
    const line = new Array(Math.min(60, Math.max(3, head.length)) + 1).join('=');
    return head + '\n' + line + '\n\n' + core.toText(html, 'rich') + '\n';
  }

  function txtBlob(title, html) {
    return new Blob(['\uFEFF', buildText(title, html)], { type: 'text/plain;charset=utf-8' });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  function downloadTxt(title, html) {
    const name = core.fileName(title) + '.txt';
    download(txtBlob(title, html), name);
    return name;
  }

  function canShare() {
    try {
      return !!(navigator.share && navigator.canShare &&
        navigator.canShare({ files: [new File(['x'], 'a.txt', { type: 'text/plain' })] }));
    } catch (_) { return false; }
  }

  async function shareTxt(title, html) {
    if (!canShare()) throw new Error('SHARE_UNSUPPORTED');
    const name = core.fileName(title) + '.txt';
    const file = new File([txtBlob(title, html)], name, { type: 'text/plain' });
    await navigator.share({ files: [file], title: name });
  }

  /* ---------- PDF через печать ---------- */
  function cleanupPrint() {
    clearTimeout(printTimer);
    printTimer = 0;
    document.querySelectorAll('.dx-print').forEach(function (n) { n.remove(); });
    document.documentElement.classList.remove('dx-printing');
  }

  async function printPdf(title, html) {
    cleanupPrint();
    const wrap = document.createElement('div');
    wrap.className = 'dx-print dx-rich dx-theme--white';
    wrap.setAttribute('aria-hidden', 'true');
    const h = document.createElement('div');
    h.className = 'dx-print__title';
    h.textContent = String(title || '').trim() || 'Без названия';
    const body = document.createElement('div');
    body.innerHTML = core.sanitize(html); // только очищенный HTML
        // Картинки: догружаем недостающие и подставляем ссылки
    const imgEls = Array.from(body.querySelectorAll('img[data-img]'));
    if (imgEls.length && VOID.docsImages && VOID.docsImages.load) {
      await Promise.all(imgEls.map(function (img) {
        return VOID.docsImages.load(img.getAttribute('data-img'))
          .then(function (u) { img.src = u; })
          .catch(function () { img.remove(); });
      }));
    }
    wrap.append(h, body);
    document.body.appendChild(wrap);
    document.documentElement.classList.add('dx-printing');

    const prevTitle = document.title;
    document.title = core.fileName(title);
    let done = false;
    const finish = function () {
      if (done) return;
      done = true;
      window.removeEventListener('afterprint', finish);
      document.title = prevTitle;
      cleanupPrint();
    };
    window.addEventListener('afterprint', finish);
    printTimer = setTimeout(finish, 180000);

    // Ждём картинки, но не дольше 4 секунд
    const pending = Array.from(wrap.querySelectorAll('img')).filter(function (i) { return !i.complete; });
    if (pending.length) {
      await Promise.race([
        Promise.all(pending.map(function (i) { return new Promise(function (r) { i.onload = i.onerror = r; }); })),
        new Promise(function (r) { setTimeout(r, 4000); })
      ]);
    }
    await new Promise(function (r) { setTimeout(r, 60); });
    try {
      window.print();
    } catch (err) {
      finish();
      throw err;
    }
  }

  // Блокировка: содержимое для печати не остаётся в странице
  document.addEventListener('void:lock', cleanupPrint);

  VOID.docsExport = { downloadTxt: downloadTxt, shareTxt: shareTxt, canShare: canShare, printPdf: printPdf, buildText: buildText };
})();