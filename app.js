/**
 * ISBN 批次掃描器 - 輕量極簡版 (Ultra-lightweight)
 */
(function () {
  'use strict';

  // 1. 資料狀態
  let books = [];
  try {
    books = JSON.parse(localStorage.getItem('isbn_books_v2') || '[]');
  } catch (e) { books = []; }

  let html5QrCode = null;
  let isScanning = false;
  let scanCooldown = false;

  // 2. DOM 元素
  const el = {
    reader: document.getElementById('reader'),
    camOverlay: document.getElementById('cam-overlay'),
    camTip: document.getElementById('cam-tip'),
    btnToggleCam: document.getElementById('btn-toggle-cam'),
    manualIsbn: document.getElementById('manual-isbn'),
    btnManualAdd: document.getElementById('btn-manual-add'),
    btnExport: document.getElementById('btn-export'),
    btnClear: document.getElementById('btn-clear'),
    bookCount: document.getElementById('book-count'),
    bookList: document.getElementById('book-list'),
    emptyHint: document.getElementById('empty-hint'),
    toast: document.getElementById('toast')
  };

  // 3. 訊息提示 (Toast)
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    clearTimeout(toastTimer);
    el.toast.className = `toast ${type}`;
    el.toast.textContent = msg;
    toastTimer = setTimeout(() => { el.toast.className = 'toast'; }, 3500);
  }

  // 4. ISBN 校驗 (EAN-13 數學標準驗證，徹底杜絕誤讀與假條碼)
  function isValidISBN(code) {
    const clean = code.replace(/[^0-9Xx]/g, '').trim();
    if (clean.length === 13) {
      if (!clean.startsWith('978') && !clean.startsWith('979')) return false;
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += parseInt(clean[i], 10) * (i % 2 === 0 ? 1 : 3);
      return (10 - (sum % 10)) % 10 === parseInt(clean[12], 10);
    }
    if (clean.length === 10) {
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += parseInt(clean[i], 10) * (10 - i);
      const last = clean[9].toUpperCase();
      return (sum + (last === 'X' ? 10 : parseInt(last, 10))) % 11 === 0;
    }
    return false;
  }

  // 5. Google Books API 查詢
  async function fetchBookInfo(isbn) {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(isbn)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.totalItems > 0 && data.items && data.items.length > 0) {
        const info = data.items[0].volumeInfo || {};
        let thumb = '';
        if (info.imageLinks) {
          thumb = (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || '').replace(/^http:\/\//, 'https://');
        }
        return {
          isbn: isbn,
          title: info.title || '未知書名',
          authors: (info.authors && info.authors.length) ? info.authors.join('、') : '未知',
          publisher: info.publisher || '未知',
          publishedDate: info.publishedDate || '',
          thumbnail: thumb,
          scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
        };
      }
    } catch (err) {
      console.warn('API 查詢失敗或頻率受限:', err);
    }

    // Google Books 未收錄時的備用結構
    return {
      isbn: isbn,
      title: `未收錄書籍 (${isbn})`,
      authors: '未知',
      publisher: '未知',
      publishedDate: '',
      thumbnail: '',
      scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
    };
  }

  // 6. 處理掃描/手動輸入到的 ISBN (去重防呆)
  async function handleISBN(rawCode, isManual = false) {
    if (scanCooldown) return;
    const clean = rawCode.replace(/[^0-9Xx]/g, '').trim();

    // 校驗格式
    if (!isValidISBN(clean)) {
      if (isManual) showToast(`⚠️ 條碼 ${clean} 不符合 ISBN 標準規範`, 'warning');
      return;
    }

    // 防抖冷卻
    scanCooldown = true;
    setTimeout(() => { scanCooldown = false; }, 1800);

    // 重複檢查
    if (books.some(b => b.isbn === clean)) {
      showToast(`⚠️ 此書已在清單中：${clean} (不重複加入)`, 'warning');
      return;
    }

    showToast(`🔍 查詢中: ${clean}...`, 'success');
    const book = await fetchBookInfo(clean);
    books.unshift(book);
    saveData();
    renderList();
    showToast(`✅ 已新增：《${book.title}》`, 'success');
  }

  // 7. 資料儲存與畫面渲染
  function saveData() {
    localStorage.setItem('isbn_books_v2', JSON.stringify(books));
    el.bookCount.textContent = books.length;
    el.btnExport.disabled = books.length === 0;
    el.btnClear.disabled = books.length === 0;
  }

  function renderList() {
    el.bookCount.textContent = books.length;
    el.btnExport.disabled = books.length === 0;
    el.btnClear.disabled = books.length === 0;

    if (books.length === 0) {
      el.emptyHint.style.display = 'block';
      el.bookList.querySelectorAll('.book-item').forEach(e => e.remove());
      return;
    }
    el.emptyHint.style.display = 'none';

    const html = books.map((b, idx) => `
      <div class="book-item">
        <img class="book-thumb" src="${b.thumbnail || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'48\' height=\'65\' fill=\'%23334155\'><rect width=\'100%25\' height=\'100%25\'/><text x=\'50%25\' y=\'50%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%2394a3b8\' font-size=\'10\'>無封面</text></svg>'}" alt="封面">
        <div class="book-info">
          <div class="book-title" title="${b.title}">${b.title}</div>
          <div class="book-meta">
            <span>${b.authors}</span>
            <span>· ${b.publisher}</span>
            <span class="book-isbn-tag">${b.isbn}</span>
          </div>
        </div>
        <button class="btn-del" data-idx="${idx}" title="刪除">✕</button>
      </div>
    `).join('');

    el.bookList.innerHTML = html;

    // 刪除按鈕綁定
    el.bookList.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        books.splice(idx, 1);
        saveData();
        renderList();
      });
    });
  }

  // 8. 匯出 CSV (帶 UTF-8 BOM，Excel 打開不亂碼)
  function exportCSV() {
    if (books.length === 0) return;
    const header = ['ISBN', '書名', '作者', '出版社', '出版日期', '掃描時間'];
    const rows = books.map(b => [
      `"${b.isbn}"`,
      `"${(b.title || '').replace(/"/g, '""')}"`,
      `"${(b.authors || '').replace(/"/g, '""')}"`,
      `"${(b.publisher || '').replace(/"/g, '""')}"`,
      `"${(b.publishedDate || '')}"`,
      `"${(b.scannedAt || '')}"`
    ]);

    const csvStr = '\uFEFF' + [header.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `書籍清單_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`🎉 成功匯出 ${books.length} 本書籍 CSV！`, 'success');
  }

  // 9. 相機控制 (高相容原生硬體加速 + Html5Qrcode)
  async function startCam() {
    el.camOverlay.classList.add('hidden');
    el.btnToggleCam.textContent = '⏹ 關閉相機';
    el.btnToggleCam.className = 'btn btn-danger';

    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode('reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8
        ],
        verbose: false
      });
    }

    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: (w, h) => ({ width: Math.floor(w * 0.95), height: Math.floor(h * 0.8) }) },
        (decodedText) => handleISBN(decodedText, false),
        () => {}
      );
      isScanning = true;

      // 手機 Chrome 原生硬體加速偵測 (0.05秒急速識別)
      if ('BarcodeDetector' in window) {
        try {
          const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
          const video = document.querySelector('#reader video');
          if (video) {
            const loop = setInterval(async () => {
              if (!isScanning) return clearInterval(loop);
              if (video.readyState >= 2) {
                try {
                  const codes = await detector.detect(video);
                  if (codes.length > 0 && codes[0].rawValue) handleISBN(codes[0].rawValue, false);
                } catch(e) {}
              }
            }, 100);
          }
        } catch(e) {}
      }
    } catch (err) {
      console.error(err);
      stopCam();
      showToast('無法啟動相機 (請確認相機權限與 HTTPS 網址)', 'error');
    }
  }

  async function stopCam() {
    if (html5QrCode && isScanning) {
      try { await html5QrCode.stop(); } catch (e) {}
    }
    isScanning = false;
    el.camOverlay.classList.remove('hidden');
    el.btnToggleCam.textContent = '📷 啟動相機';
    el.btnToggleCam.className = 'btn btn-primary';
  }

  // 10. 事件綁定
  el.btnToggleCam.addEventListener('click', () => {
    isScanning ? stopCam() : startCam();
  });

  el.btnManualAdd.addEventListener('click', () => {
    const val = el.manualIsbn.value.trim();
    if (val) {
      handleISBN(val, true);
      el.manualIsbn.value = '';
    }
  });

  el.manualIsbn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.btnManualAdd.click();
  });

  el.btnExport.addEventListener('click', exportCSV);

  el.btnClear.addEventListener('click', () => {
    if (confirm('確定清空所有掃描紀錄？')) {
      books = [];
      saveData();
      renderList();
    }
  });

  // 初始化
  renderList();
})();
