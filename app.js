/**
 * ISBN Batch Scanner & Google Books Integration
 * Full feature implementation: Camera Barcode Scanner, Duplicate Prevention,
 * Google Books API lookup, Offline LocalStorage, and UTF-8 BOM CSV Export.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 狀態管理 (State Management)
  // =========================================================================
  const STORAGE_KEY = 'isbn_scanner_books_v1';
  let books = [];
  let html5QrCode = null;
  let isScanning = false;
  let isTorchOn = false;
  let hasTorchCapability = false;
  let scanCooldown = false; // 防抖冷卻
  let lastScannedIsbn = '';

  // =========================================================================
  // 2. DOM 元素快取 (DOM Cache)
  // =========================================================================
  const el = {
    // 掃描視窗
    reader: document.getElementById('reader'),
    scannerOverlay: document.getElementById('scanner-overlay'),
    cameraPlaceholder: document.getElementById('camera-placeholder'),
    btnStartCamera: document.getElementById('btn-start-camera'),
    btnToggleCamera: document.getElementById('btn-toggle-camera'),
    iconToggleCamera: document.getElementById('icon-toggle-camera'),
    textToggleCamera: document.getElementById('text-toggle-camera'),
    btnToggleTorch: document.getElementById('btn-toggle-torch'),
    scanPulse: document.getElementById('scan-pulse'),
    scanStatusText: document.getElementById('scan-status-text'),

    // 書籍清單與操作
    booksCountBadge: document.getElementById('books-count-badge'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnClearAll: document.getElementById('btn-clear-all'),
    btnManualInput: document.getElementById('btn-manual-input'),
    toastBanner: document.getElementById('toast-banner'),
    toastIcon: document.getElementById('toast-icon'),
    toastMsg: document.getElementById('toast-msg'),
    booksContainer: document.getElementById('books-container'),
    emptyState: document.getElementById('empty-state'),
    booksList: document.getElementById('books-list'),

    // 手動輸入 Dialog
    manualDialog: document.getElementById('manual-dialog'),
    manualForm: document.getElementById('manual-form'),
    manualIsbnInput: document.getElementById('manual-isbn-input'),
    btnCloseDialog: document.getElementById('btn-close-dialog'),
    btnDialogCancel: document.getElementById('btn-dialog-cancel'),

    // 書籍詳情 Dialog
    detailDialog: document.getElementById('detail-dialog'),
    detailBody: document.getElementById('detail-body'),
    btnCloseDetail: document.getElementById('btn-close-detail'),

    // 設定 Dialog
    btnSettings: document.getElementById('btn-settings'),
    settingsDialog: document.getElementById('settings-dialog'),
    settingsForm: document.getElementById('settings-form'),
    apiKeyInput: document.getElementById('api-key-input'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnSettingsCancel: document.getElementById('btn-settings-cancel')
  };

  // =========================================================================
  // 3. Web Audio 音效合成器 (免外掛音訊檔，高相容即時發聲)
  // =========================================================================
  const SoundEffects = {
    ctx: null,

    init() {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    // 成功掃描提示：輕快的高音雙嗶
    playSuccess() {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now); // A5
        gain1.gain.setValueAtTime(0.2, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.12);

        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1320, now + 0.1); // E6
        gain2.gain.setValueAtTime(0.25, now + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        osc2.start(now + 0.1);
        osc2.stop(now + 0.25);
      } catch (err) {
        console.warn('Audio play error:', err);
      }
    },

    // 重複條碼警示：較低頻的警戒聲 (雙重警告音)
    playWarning() {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(370, now);
        osc.frequency.setValueAtTime(293, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      } catch (err) {
        console.warn('Audio play error:', err);
      }
    }
  };

  // 震動反饋 (行動裝置)
  function triggerHaptic(pattern = [100]) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  // =========================================================================
  // 4. 即時通知 Toast Banner
  // =========================================================================
  let toastTimer = null;

  function showToast(message, type = 'success', duration = 3800) {
    clearTimeout(toastTimer);
    el.toastBanner.className = `toast-banner ${type}`;
    el.toastMsg.textContent = message;

    let iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'error') iconName = 'alert-circle';

    el.toastIcon.innerHTML = `<i data-lucide="${iconName}"></i>`;
    el.toastBanner.style.display = 'flex';
    lucide.createIcons();

    toastTimer = setTimeout(() => {
      el.toastBanner.style.display = 'none';
    }, duration);
  }

  // =========================================================================
  // 5. 資料儲存與載入 (LocalStorage)
  // =========================================================================
  function loadBooksFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        books = JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load books from localStorage:', e);
      books = [];
    }
    renderBooksList();
  }

  function saveBooksToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    } catch (e) {
      console.error('Failed to save books to localStorage:', e);
    }
    updateUIControls();
  }

  // =========================================================================
  // 6. Google Books API 串接邏輯 (支援雙重檢索、403 金鑰回退與詳細報錯)
  // =========================================================================
  async function fetchBookInfoByISBN(isbn) {
    const clean = isbn.replace(/[^0-9Xx]/g, '').trim();
    const apiKey = localStorage.getItem('google_books_api_key') || '';

    // 輔助函式：發送請求並解析
    async function queryGoogleBooks(queryStr, useKey = true) {
      let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(queryStr)}`;
      if (useKey && apiKey) {
        url += `&key=${encodeURIComponent(apiKey)}`;
      }

      const res = await fetch(url);
      
      // 處理 400 (API Key 無效) 或 403 (權限/網址受限)
      if (res.status === 400 || res.status === 403) {
        let errMsg = res.status === 400 ? '金鑰無效 (API_KEY_INVALID)' : '金鑰受限或網址未授權';
        try {
          const errJson = await res.json();
          errMsg = errJson?.error?.message || errMsg;
        } catch (e) {}
        
        // 若帶 Key 發生錯誤，自動嘗試切換無 Key 模式
        if (useKey && apiKey) {
          showToast(`⚠️ API Key 錯誤 (${res.status})：${errMsg}。自動切換無金鑰模式重試...`, 'warning', 6000);
          return await queryGoogleBooks(queryStr, false);
        } else {
          throw new Error(`Google API ${res.status}: ${errMsg}`);
        }
      }

      if (res.status === 429) {
        showToast('⚠️ Google 查詢次數達上限 (429)，請稍候重試或至 ⚙️ 設定更換 API Key', 'warning', 6000);
        throw new Error('Google Books API 429 頻率受限');
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          errMsg = errJson?.error?.message || errMsg;
        } catch (e) {}
        throw new Error(`Google API 錯誤 (${errMsg})`);
      }

      return await res.json();
    }

    try {
      // 策略一：直接以純 ISBN 全文檢索 (q=xxx)，速度最快、省去重複請求，對繁體中文書涵蓋率最高
      let data = await queryGoogleBooks(clean);

      // 策略二：若極少數情況查無資料，備用嘗試 q=isbn:xxx
      if (!data || data.totalItems === 0 || !data.items || data.items.length === 0) {
        console.log(`q=${clean} 查無結果，嘗試備用檢索 isbn:${clean}...`);
        data = await queryGoogleBooks(`isbn:${clean}`);
      }

      if (data && data.totalItems > 0 && data.items && data.items.length > 0) {
        const item = data.items[0];
        const info = item.volumeInfo || {};

        let thumbnail = '';
        if (info.imageLinks) {
          thumbnail = (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || '')
            .replace(/^http:\/\//i, 'https://');
        }

        return {
          isbn: clean,
          title: info.title || '未知書名',
          subtitle: info.subtitle || '',
          authors: (info.authors && info.authors.length > 0) ? info.authors.join('、') : '未知作者',
          publisher: info.publisher || '未知出版社',
          publishedDate: info.publishedDate || '',
          pageCount: info.pageCount || '',
          categories: (info.categories && info.categories.length > 0) ? info.categories.join(' / ') : '',
          description: info.description || '無詳細簡介',
          thumbnail: thumbnail,
          scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
        };
      } else {
        // Google Books 無對應記錄時
        showToast(`ℹ️ Google Books 未收錄 ISBN: ${clean}，已建立空白卡片供手動填寫`, 'warning', 5000);
        return {
          isbn: clean,
          title: `未收錄書籍 (${clean})`,
          subtitle: '',
          authors: '未知',
          publisher: '未知',
          publishedDate: '',
          pageCount: '',
          categories: '',
          description: 'Google Books 資料庫中未找到該 ISBN 之線上書籍資訊。可點擊卡片編輯手動輸入書名。',
          thumbnail: '',
          scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
        };
      }
    } catch (err) {
      console.error('Google Books API fetch failed:', err);
      showToast(`❌ ${err.message}`, 'error', 6000);
      return {
        isbn: clean,
        title: `查詢失敗書籍 (${clean})`,
        subtitle: '',
        authors: '未知',
        publisher: '查詢異常',
        publishedDate: '',
        pageCount: '',
        categories: '',
        description: `連線查詢失敗：${err.message}`,
        thumbnail: '',
        scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
      };
    }
  }

  // =========================================================================
  // 7. 條碼處理與防呆重複機制 (Barcode Handling + 防誤讀校驗)
  // =========================================================================
  let candidateCode = '';
  let candidateHits = 0;

  async function handleScannedBarcode(decodedText, isManual = false) {
    if (scanCooldown) return;

    // 清理字元 (排除條碼前後空格或非數字字元)
    const rawIsbn = decodedText.replace(/[^0-9Xx]/g, '').trim();

    // 基本長度驗證 (ISBN-10 或 ISBN-13)
    if (rawIsbn.length !== 10 && rawIsbn.length !== 13) {
      return;
    }

    // ISBN-13 規範校驗：國際標準書號必須以 978 或 979 開頭
    if (rawIsbn.length === 13 && !rawIsbn.startsWith('978') && !rawIsbn.startsWith('979')) {
      if (isManual) {
        showToast(`⚠️ 條碼 ${rawIsbn} 並非標準 ISBN（應以 978 或 979 開頭）`, 'warning', 4000);
      }
      return; // 忽略台灣書籍封底常見的第二組定價/分類條碼 (非 ISBN)
    }

    // 鏡頭防光影誤讀機制 (Double-Frame Confirmation)
    // 鏡頭掃描需連續 2 幀讀取相同碼才確認，手動輸入則直接通過
    if (!isManual) {
      if (rawIsbn === candidateCode) {
        candidateHits++;
      } else {
        candidateCode = rawIsbn;
        candidateHits = 1;
        return; // 等待下一幀驗證
      }

      if (candidateHits < 2) {
        return; // 尚未達到 2 幀確認
      }
    }

    // 重置候選緩存並進入防抖冷卻
    candidateCode = '';
    candidateHits = 0;
    scanCooldown = true;
    lastScannedIsbn = rawIsbn;
    setTimeout(() => {
      scanCooldown = false;
    }, 2200);

    // 【核心邏輯】：檢查是否重複
    const existingIndex = books.findIndex(b => b.isbn === rawIsbn);
    if (existingIndex !== -1) {
      SoundEffects.playWarning();
      triggerHaptic([180, 80, 180]);

      const existingBook = books[existingIndex];
      showToast(`⚠️ 重複條碼：【${existingBook.title}】(${rawIsbn}) 已在清單中！`, 'warning', 4500);
      highlightCard(existingIndex);
      return;
    }

    // 【新增書籍流程】
    updateScanStatus('查詢中...', 'searching');

    try {
      const bookData = await fetchBookInfoByISBN(rawIsbn);
      books.unshift(bookData); // 最新掃描排在最上方
      saveBooksToStorage();
      renderBooksList();

      SoundEffects.playSuccess();
      triggerHaptic([90]);
      showToast(`✅ 已新增：【${bookData.title}】`, 'success');
      updateScanStatus('準備就緒', 'ready');
    } catch (e) {
      console.error(e);
      showToast(`❌ 處理失敗：${e.message}`, 'error');
      updateScanStatus('準備就緒', 'ready');
    }
  }

  // 高亮標記重複卡片
  function highlightCard(index) {
    const cards = el.booksList.querySelectorAll('.book-card');
    if (cards[index]) {
      cards[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
      cards[index].classList.remove('highlight-duplicate');
      void cards[index].offsetWidth; // trigger reflow
      cards[index].classList.add('highlight-duplicate');
    }
  }

  function updateScanStatus(text, state = 'ready') {
    el.scanStatusText.textContent = text;
    el.scanPulse.className = `status-dot ${state}`;
  }

  // =========================================================================
  // 8. 鏡頭與掃描核心 (Html5Qrcode 控制，支援 HD 與連續對焦)
  // =========================================================================
  async function startScanner() {
    if (isScanning) return;

    SoundEffects.init();
    el.cameraPlaceholder.style.display = 'none';
    el.scannerOverlay.style.display = 'flex';
    updateScanStatus('啟動相機中...', 'searching');

    try {
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode('reader', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8
          ],
          verbose: false
        });
      }

      // 請求高解析度視訊串流與對焦，大幅改善低光、反光誤讀問題
      const cameraConfig = {
        facingMode: 'environment',
        focusMode: 'continuous',
        width: { min: 1280, ideal: 1920 },
        height: { min: 720, ideal: 1080 }
      };

      const scanConfig = {
        fps: 12, // 12 FPS 給予手機相機充裕曝光與自動對焦時間
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          // 精確鎖定橫向條碼區域，避免讀取到周圍背景
          const width = Math.min(Math.floor(viewfinderWidth * 0.85), 360);
          const height = Math.min(Math.floor(viewfinderHeight * 0.4), 160);
          return { width, height };
        },
        aspectRatio: 1.3333
      };

      await html5QrCode.start(
        cameraConfig,
        scanConfig,
        (decodedText) => {
          handleScannedBarcode(decodedText, false);
        },
        () => {}
      );

      isScanning = true;
      updateScanStatus('鏡頭就緒中 (對準條碼)', 'ready');
      el.textToggleCamera.textContent = '暫停';
      el.iconToggleCamera.setAttribute('data-lucide', 'pause');

      // 偵測補光燈 (Torch) 支援能力
      checkTorchSupport();
      lucide.createIcons();
    } catch (err) {
      console.error('啟動相機失敗:', err);
      isScanning = false;
      el.cameraPlaceholder.style.display = 'flex';
      el.scannerOverlay.style.display = 'none';
      updateScanStatus('相機未啟動', 'idle');
      showToast(`無法啟動相機: ${err.message || '請確認是否已授權相機權限且處於 HTTPS 環境'}`, 'error', 6000);
    }
  }

  async function stopScanner() {
    if (!isScanning || !html5QrCode) return;

    try {
      if (isTorchOn) {
        await toggleTorch(false);
      }
      await html5QrCode.stop();
      isScanning = false;
      el.cameraPlaceholder.style.display = 'flex';
      el.scannerOverlay.style.display = 'none';
      updateScanStatus('已暫停掃描', 'idle');
      el.textToggleCamera.textContent = '啟動';
      el.iconToggleCamera.setAttribute('data-lucide', 'play');
      el.btnToggleTorch.disabled = true;
      lucide.createIcons();
    } catch (err) {
      console.error('停止相機失敗:', err);
    }
  }

  async function checkTorchSupport() {
    try {
      const runningTrack = html5QrCode.getRunningTrackCapabilities();
      if (runningTrack && 'torch' in runningTrack) {
        hasTorchCapability = true;
        el.btnToggleTorch.disabled = false;
      } else {
        hasTorchCapability = false;
        el.btnToggleTorch.disabled = true;
      }
    } catch (e) {
      hasTorchCapability = false;
      el.btnToggleTorch.disabled = true;
    }
  }

  async function toggleTorch(targetState) {
    if (!isScanning || !html5QrCode || !hasTorchCapability) return;
    try {
      const newState = typeof targetState === 'boolean' ? targetState : !isTorchOn;
      await html5QrCode.applyVideoConstraints({
        advanced: [{ torch: newState }]
      });
      isTorchOn = newState;
      el.btnToggleTorch.classList.toggle('btn-primary', isTorchOn);
      el.btnToggleTorch.classList.toggle('btn-ghost', !isTorchOn);
    } catch (err) {
      console.warn('切換補光燈失敗:', err);
    }
  }

  // =========================================================================
  // 9. 清單渲染與互動 (Rendering)
  // =========================================================================
  function renderBooksList() {
    el.booksCountBadge.textContent = `${books.length} 本`;

    if (books.length === 0) {
      el.emptyState.style.display = 'flex';
      el.booksList.innerHTML = '';
      el.btnExportCsv.disabled = true;
      el.btnClearAll.disabled = true;
      return;
    }

    el.emptyState.style.display = 'none';
    el.btnExportCsv.disabled = false;
    el.btnClearAll.disabled = false;

    el.booksList.innerHTML = books.map((book, index) => {
      const coverHtml = book.thumbnail
        ? `<img src="${escapeHtml(book.thumbnail)}" alt="封面" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'book-cover-placeholder\\'><i data-lucide=\\'book\\'></i></div>'; lucide.createIcons();">`
        : `<div class="book-cover-placeholder"><i data-lucide="book"></i></div>`;

      return `
        <article class="book-card" data-index="${index}">
          <div class="book-cover">
            ${coverHtml}
          </div>
          <div class="book-info">
            <div class="book-title-row">
              <h3 class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</h3>
              ${book.subtitle ? `<div class="book-subtitle">${escapeHtml(book.subtitle)}</div>` : ''}
            </div>
            <div class="book-meta">
              <div class="meta-line">
                <span>作者：${escapeHtml(book.authors || '未知')}</span>
              </div>
              <div class="meta-line">
                <span>出版社：${escapeHtml(book.publisher || '未知')}</span>
                ${book.publishedDate ? `<span>(${escapeHtml(book.publishedDate)})</span>` : ''}
              </div>
              <div class="meta-line">
                <span class="meta-isbn">ISBN: ${escapeHtml(book.isbn)}</span>
              </div>
            </div>
            <div class="book-card-actions">
              <span class="scan-time">${book.scannedAt || ''}</span>
              <div class="action-btns">
                <button class="btn-icon btn-icon-sm btn-edit" title="手動編輯書名" data-index="${index}">
                  <i data-lucide="edit-3"></i>
                </button>
                <button class="btn-icon btn-icon-sm btn-detail" title="查看詳細" data-index="${index}">
                  <i data-lucide="info"></i>
                </button>
                <button class="btn-icon btn-icon-sm btn-danger btn-delete" title="刪除此項" data-index="${index}">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    lucide.createIcons();
    bindCardEvents();
  }

  function bindCardEvents() {
    // 綁定編輯按鈕
    el.booksList.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const book = books[idx];
        const newTitle = prompt('請輸入書籍名稱：', book.title.startsWith('未收錄') || book.title.startsWith('查詢失敗') ? '' : book.title);
        if (newTitle !== null && newTitle.trim()) {
          book.title = newTitle.trim();
          const newAuthor = prompt('請輸入作者名稱（選填）：', book.authors === '未知' ? '' : book.authors);
          if (newAuthor !== null && newAuthor.trim()) {
            book.authors = newAuthor.trim();
          }
          saveBooksToStorage();
          renderBooksList();
          showToast('已更新書籍資訊', 'success');
        }
      });
    });

    // 綁定個別刪除按鈕
    el.booksList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const removed = books.splice(idx, 1)[0];
        saveBooksToStorage();
        renderBooksList();
        showToast(`已自清單移除：【${removed.title}】`, 'warning');
      });
    });

    // 綁定詳細資訊彈窗按鈕
    el.booksList.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        showBookDetail(books[idx]);
      });
    });
  }

  function showBookDetail(book) {
    if (!book) return;

    const coverHtml = book.thumbnail
      ? `<img src="${escapeHtml(book.thumbnail)}" class="detail-cover" alt="封面">`
      : `<div class="detail-cover book-cover-placeholder"><i data-lucide="book"></i></div>`;

    el.detailBody.innerHTML = `
      <div class="detail-hero">
        ${coverHtml}
        <div class="detail-primary">
          <h4>${escapeHtml(book.title)}</h4>
          ${book.subtitle ? `<p class="book-subtitle" style="margin-bottom:0.5rem;">${escapeHtml(book.subtitle)}</p>` : ''}
          <span class="meta-isbn">ISBN: ${escapeHtml(book.isbn)}</span>
        </div>
      </div>
      <table class="detail-table">
        <tbody>
          <tr><td>作者</td><td>${escapeHtml(book.authors || '無紀錄')}</td></tr>
          <tr><td>出版社</td><td>${escapeHtml(book.publisher || '無紀錄')}</td></tr>
          <tr><td>出版日期</td><td>${escapeHtml(book.publishedDate || '無紀錄')}</td></tr>
          <tr><td>頁數</td><td>${book.pageCount ? `${escapeHtml(book.pageCount)} 頁` : '無紀錄'}</td></tr>
          <tr><td>分類</td><td>${escapeHtml(book.categories || '無分類')}</td></tr>
          <tr><td>掃描時間</td><td>${escapeHtml(book.scannedAt || '')}</td></tr>
        </tbody>
      </table>
      <div>
        <label style="font-size:0.8rem; color:var(--text-dim); display:block; margin-bottom:0.3rem;">內容簡介：</label>
        <div class="detail-desc">${escapeHtml(book.description || '無詳細簡介')}</div>
      </div>
    `;

    lucide.createIcons();
    el.detailDialog.showModal();
  }

  function updateUIControls() {
    el.btnExportCsv.disabled = books.length === 0;
    el.btnClearAll.disabled = books.length === 0;
    el.booksCountBadge.textContent = `${books.length} 本`;
  }

  // =========================================================================
  // 10. CSV 匯出邏輯 (嚴格跳脫 + UTF-8 BOM 避免 Excel 亂碼)
  // =========================================================================
  function exportToCSV() {
    if (books.length === 0) {
      showToast('清單中尚無書籍可供匯出', 'warning');
      return;
    }

    const headers = [
      'ISBN',
      '書名',
      '副標題',
      '作者',
      '出版社',
      '出版日期',
      '頁數',
      '分類',
      '掃描時間',
      '封面連結',
      '內容簡介'
    ];

    // CSV 跳脫輔助函式：包覆引號並將內部引號雙寫 ""
    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val).trim();
      // 防止換行符號過度破壞行數（替換內部特殊空格，保留正常換行）
      str = str.replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = books.map(book => [
      escapeCSV(book.isbn),
      escapeCSV(book.title),
      escapeCSV(book.subtitle),
      escapeCSV(book.authors),
      escapeCSV(book.publisher),
      escapeCSV(book.publishedDate),
      escapeCSV(book.pageCount),
      escapeCSV(book.categories),
      escapeCSV(book.scannedAt),
      escapeCSV(book.thumbnail),
      escapeCSV(book.description)
    ]);

    // 結合標頭與資料行
    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.join(','))
    ].join('\r\n');

    // 加入 UTF-8 BOM (\uFEFF)
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // 檔名加上格式化時間戳記
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `ISBN_書籍清單_${timestamp}.csv`;

    // 觸發下載
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.setAttribute('download', filename);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);

    showToast(`🎉 成功匯出 ${books.length} 本書籍資料：${filename}`, 'success');
  }

  // HTML 字符逃逸防 XSS
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // =========================================================================
  // 11. 事件監聽註冊 (Event Listeners)
  // =========================================================================
  function initEvents() {
    // 啟動相機
    el.btnStartCamera.addEventListener('click', startScanner);

    // 切換相機暫停 / 恢復
    el.btnToggleCamera.addEventListener('click', () => {
      if (isScanning) {
        stopScanner();
      } else {
        startScanner();
      }
    });

    // 切換補光燈
    el.btnToggleTorch.addEventListener('click', () => {
      toggleTorch();
    });

    // 匯出 CSV 按鈕
    el.btnExportCsv.addEventListener('click', exportToCSV);

    // 清空全部書籍
    el.btnClearAll.addEventListener('click', () => {
      if (books.length === 0) return;
      if (confirm(`確定要清空目前掃描的全部 ${books.length} 本書籍記錄嗎？此操作無法復原。`)) {
        books = [];
        saveBooksToStorage();
        renderBooksList();
        showToast('已清空所有書籍清單', 'warning');
      }
    });

    // 手動輸入 ISBN 視窗開關
    el.btnManualInput.addEventListener('click', () => {
      el.manualIsbnInput.value = '';
      el.manualDialog.showModal();
      setTimeout(() => el.manualIsbnInput.focus(), 100);
    });

    el.btnCloseDialog.addEventListener('click', () => el.manualDialog.close());
    el.btnDialogCancel.addEventListener('click', () => el.manualDialog.close());

    // 手動輸入表單提交
    el.manualForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = el.manualIsbnInput.value.trim();
      if (!val) return;
      el.manualDialog.close();
      await handleScannedBarcode(val, true);
    });

    // 設定視窗開關
    el.btnSettings.addEventListener('click', () => {
      el.apiKeyInput.value = localStorage.getItem('google_books_api_key') || '';
      el.settingsDialog.showModal();
    });

    el.btnCloseSettings.addEventListener('click', () => el.settingsDialog.close());
    el.btnSettingsCancel.addEventListener('click', () => el.settingsDialog.close());

    el.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = el.apiKeyInput.value.trim();
      if (key) {
        localStorage.setItem('google_books_api_key', key);
        showToast('已儲存 Google Books API Key', 'success');
      } else {
        localStorage.removeItem('google_books_api_key');
        showToast('已清除 API Key（使用預設模式）', 'warning');
      }
      el.settingsDialog.close();
    });

    // 書籍詳情視窗關閉
    el.btnCloseDetail.addEventListener('click', () => el.detailDialog.close());

    // 點擊對話框外圍 backdrop 關閉
    [el.manualDialog, el.detailDialog, el.settingsDialog].forEach(dialog => {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    });
  }

  // =========================================================================
  // 12. 應用程式入口啟動 (Initialization)
  // =========================================================================
  function init() {
    lucide.createIcons();
    initEvents();
    loadBooksFromStorage();

    // 手機端使用者體驗：若為 HTTPS 且支援攝影機，可嘗試自動或由使用者按鍵啟動
    // 遵循行動端標準，保持在未互動前不強制搶佔鏡頭
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
