/**
 * ISBN v2 (A 方案) - Google 全網即時搜尋與書目清單匯出器
 * 核心架構：
 * 1. 相機掃描條碼 / 手動輸入 ISBN
 * 2. 直連 Google Programmable Search (Custom Search JSON API) 全網搜尋
 * 3. 智慧摘要剖析引擎：精準萃取 4 大核心欄位 (書名、出版社、出版日期、頁數)
 * 4. Google Books 全文關鍵字備援 (使用相同 Google API Key)
 * 5. 批次卡片管理、手動校對、智慧文字剪貼簿解析、UTF-8 BOM CSV 匯出
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. 常數、狀態與 DOM 快取
  // =========================================================================
  const STORAGE_KEY_BOOKS = 'isbn_v2_books_records';
  const STORAGE_KEY_API_KEY = 'isbn_v2_google_api_key';
  const STORAGE_KEY_CX = 'isbn_v2_google_cx';

  let books = [];
  let googleApiKey = '';
  let googleCx = '';

  let html5QrCode = null;
  let isScanning = false;
  let isTorchOn = false;
  let hasTorch = false;
  let scanCooldown = false;
  let candidateCode = '';
  let candidateHits = 0;

  const dom = {
    // 頂端與 Banner
    apiSetupBanner: document.getElementById('api-setup-banner'),
    btnBannerSettings: document.getElementById('btn-banner-settings'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    btnManualInput: document.getElementById('btn-manual-input'),
    btnClearAll: document.getElementById('btn-clear-all'),

    // 相機與掃描
    reader: document.getElementById('reader'),
    camPlaceholder: document.getElementById('camera-placeholder'),
    btnStartCam: document.getElementById('btn-start-camera'),
    scannerReticle: document.getElementById('scanner-reticle'),
    btnToggleCam: document.getElementById('btn-toggle-camera'),
    iconToggleCam: document.getElementById('icon-toggle-cam'),
    textToggleCam: document.getElementById('text-toggle-cam'),
    btnToggleTorch: document.getElementById('btn-toggle-torch'),
    scanStatusBadge: document.getElementById('scan-status-badge'),

    // 快速手動輸入
    quickIsbnInput: document.getElementById('quick-isbn-input'),
    btnQuickSearch: document.getElementById('btn-quick-search'),

    // 書籍清單
    booksCountBadge: document.getElementById('books-count-badge'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    toastBanner: document.getElementById('toast-banner'),
    booksContainer: document.getElementById('books-container'),
    booksEmpty: document.getElementById('books-empty'),
    booksList: document.getElementById('books-list'),

    // Terminal
    terminalLogs: document.getElementById('terminal-logs'),
    btnCopyLog: document.getElementById('btn-copy-log'),
    btnClearLog: document.getElementById('btn-clear-log'),

    // 對話框：Google API 設定 (A 方案)
    modalSettings: document.getElementById('modal-settings'),
    formSettings: document.getElementById('form-settings'),
    settingApiKey: document.getElementById('setting-api-key'),
    settingCx: document.getElementById('setting-cx'),
    btnTestConnection: document.getElementById('btn-test-connection'),
    testStatusText: document.getElementById('test-status-text'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnCancelSettings: document.getElementById('btn-cancel-settings'),

    // 對話框：手動輸入 / 智慧辨識
    modalManual: document.getElementById('modal-manual'),
    tabBtnIsbn: document.getElementById('tab-btn-isbn'),
    tabBtnSnippet: document.getElementById('tab-btn-snippet'),
    formManual: document.getElementById('form-manual'),
    modalIsbnInput: document.getElementById('modal-isbn-input'),
    formSnippet: document.getElementById('form-snippet'),
    snippetText: document.getElementById('snippet-text'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCancelModal: document.getElementById('btn-cancel-modal'),
    btnCancelSnippet: document.getElementById('btn-cancel-snippet'),

    // 對話框：手動編輯 4 大欄位
    modalEdit: document.getElementById('modal-edit'),
    formEdit: document.getElementById('form-edit'),
    editIndex: document.getElementById('edit-book-index'),
    editIsbn: document.getElementById('edit-isbn'),
    editTitle: document.getElementById('edit-title'),
    editPublisher: document.getElementById('edit-publisher'),
    editDate: document.getElementById('edit-date'),
    editPages: document.getElementById('edit-pages'),
    btnCloseEdit: document.getElementById('btn-close-edit'),
    btnCancelEdit: document.getElementById('btn-cancel-edit')
  };

  // =========================================================================
  // 2. 音效與震動反饋 (Web Audio API 合成音)
  // =========================================================================
  const AudioFeedback = {
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
    playSuccess() {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
      } catch (e) {}
    },
    playWarning() {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(360, now);
        osc.frequency.setValueAtTime(280, now + 0.12);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      } catch (e) {}
    }
  };

  function triggerHaptic(pattern = [100]) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  // =========================================================================
  // 3. 即時 Terminal 日誌系統
  // =========================================================================
  function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('zh-TW', { hour12: false, fractionalSecondDigits: 3 });
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.innerHTML = `<span class="log-t">[${time}]</span> ${escapeHtml(msg)}`;
    dom.terminalLogs.appendChild(line);
    dom.terminalLogs.scrollTop = dom.terminalLogs.scrollHeight;
  }

  let toastTimer = null;
  function showToast(msg, type = 'success', duration = 3500) {
    clearTimeout(toastTimer);
    dom.toastBanner.className = `toast-banner ${type}`;
    dom.toastBanner.innerHTML = msg;
    dom.toastBanner.style.display = 'flex';
    toastTimer = setTimeout(() => {
      dom.toastBanner.style.display = 'none';
    }, duration);
  }

  // =========================================================================
  // 4. A 方案：Google 全網搜尋與 4 大核心欄位解析器
  // =========================================================================

  /**
   * 從 Google 搜尋結果的標題、摘要與 pagemap 中萃取 4 大核心欄位
   */
  function parseGoogleSearchResults(items, isbn) {
    if (!items || items.length === 0) return null;

    let title = '';
    let publisher = '';
    let publishedDate = '';
    let pageCount = '';

    // 常見出版社名單 (加強比對)
    const knownPublishers = [
      '野人文化', '野人', '時報出版', '時報', '遠流', '天下文化', '圓神', '聯經',
      '麥田', '皇冠', '三采文化', '三采', '大塊文化', '大塊', '臉譜', '漫遊者',
      '木馬文化', '商周出版', '商周', '大田', '平安文化', '春光', '印刻', '寶瓶文化',
      '新經典文化', '先覺', '獨步文化', '小知堂', '商務印書館', '台灣商務', '奇幻基地'
    ];

    // 書店與網站尾綴清洗規則
    const siteSuffixRegex = /\s*[-–—|│:：]\s*(博客來|誠品線上|誠品網路書店|三民網路書店|讀冊生活|讀書共和國|金石堂|豆瓣|AliExpress|蝦皮購物|Findbook|一本 My Book One|Books Kinokuniya|Yahoo奇摩拍賣|露天市集).*$/i;
    const sitePrefixRegex = /^(?:【[^】]+】|\[[^\]]+\]|\([^\)]+\))?\s*(?:博客來|誠品線上|三民網路書店|讀冊生活)\s*[-–—|│:：]\s*/i;

    // 1. 萃取書名 (從排名最高的幾個網頁標題過濾)
    for (const item of items) {
      let t = item.title || '';
      t = t.replace(sitePrefixRegex, '');
      t = t.replace(siteSuffixRegex, '');
      t = t.replace(new RegExp(isbn, 'g'), '').trim();

      // 如果有書名號 《...》，優先萃取
      const bookQuoteMatch = t.match(/《([^》]+)》/);
      if (bookQuoteMatch && bookQuoteMatch[1]) {
        title = bookQuoteMatch[1].trim();
        break;
      }

      // 如果有主標題與副標題 (以冒號或破折號分隔)，取主標題
      const colonSplit = t.split(/[:：]/);
      if (colonSplit.length > 1 && colonSplit[0].length >= 2 && colonSplit[0].length <= 25) {
        title = colonSplit[0].trim();
        break;
      }

      if (!title && t) {
        title = t;
      }
    }

    // 2. 彙整所有搜尋結果的摘要文字 (Snippet) 與 pagemap
    const combinedTexts = [];
    for (const item of items) {
      if (item.snippet) combinedTexts.push(item.snippet);
      if (item.title) combinedTexts.push(item.title);
      if (item.pagemap && item.pagemap.metatags) {
        for (const meta of item.pagemap.metatags) {
          if (meta['og:title']) combinedTexts.push(meta['og:title']);
          if (meta['og:description']) combinedTexts.push(meta['og:description']);
          if (meta['description']) combinedTexts.push(meta['description']);
        }
      }
    }
    const fullText = combinedTexts.join(' \n ');

    // 3. 萃取出版社
    // 正則比對：出版社：xxx 或 出版品牌：xxx
    const pubMatch = fullText.match(/(?:出版社|出版品牌|出版單位|出版公司|出版商|出版)[:：\s]+([^\s,，;；\|｜\/、\<\>\(\)]+)/i);
    if (pubMatch && pubMatch[1]) {
      publisher = pubMatch[1].trim();
    } else {
      // 比對已知出版社
      for (const p of knownPublishers) {
        if (fullText.includes(p)) {
          publisher = p;
          break;
        }
      }
    }

    // 4. 萃取出版日期
    // 正則比對：出版日期：2015-05-13 或 出版日：2016/07/20 或 出版年: 2015-5
    const dateMatch = fullText.match(/(?:出版日(?:期)?|出版年|出版時間|發行日期)[:：\s]+([0-9]{4}[-/年\.][0-9]{1,2}(?:[-/月\.][0-9]{1,2})?日?)/i);
    if (dateMatch && dateMatch[1]) {
      publisher = publisher || '未提供';
      publishedDate = dateMatch[1].replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').trim();
    }

    // 5. 萃取頁數
    // 正則比對：裝訂／頁數：平裝／240頁 或 頁數：233 或 页数: 240
    const pageMatch = fullText.match(/(?:裝訂／頁數|平裝／頁數|頁數|页数|總頁數)[:：\s]+(?:[^\d\n\r]{0,8})?([0-9]{2,4})\s*頁?/i);
    if (pageMatch && pageMatch[1]) {
      pageCount = `${pageMatch[1]} 頁`;
    }

    return {
      title: title || '',
      publisher: publisher || '未提供',
      publishedDate: publishedDate || '未提供',
      pageCount: pageCount || '未提供',
      rawHits: items.length
    };
  }

  /**
   * 智慧文字剪貼簿剖析：直接從一段複製自 Google 或書店的文字中抽出 4 大欄位
   */
  function parseSnippetText(text, defaultIsbn = '') {
    if (!text || !text.trim()) return null;

    // 辨識 ISBN
    const isbnMatch = text.match(/(?:97[89][0-9]{10}|[0-9]{9}[0-9Xx])/);
    const isbn = isbnMatch ? isbnMatch[0] : (defaultIsbn || '0000000000000');

    // 辨識書名 (《...》 或 書名：xxx 或 標題第一行)
    let title = '';
    const bookQuote = text.match(/《([^》]+)》/);
    if (bookQuote) {
      title = bookQuote[1].trim();
    } else {
      const titleMatch = text.match(/(?:書名|書　名|Title)[:：\s]+([^\n\r,，;；|]+)/i);
      if (titleMatch) title = titleMatch[1].trim();
      else {
        // 第一行非空文字
        const firstLine = text.trim().split(/[\r\n]+/)[0];
        if (firstLine && firstLine.length < 50) title = firstLine.trim();
      }
    }

    // 辨識出版社
    let publisher = '未提供';
    const pubMatch = text.match(/(?:出版社|出版品牌|出版單位|出版公司|出版商)[:：\s]+([^\s,，;；\|｜\/、\<\>]+)/i);
    if (pubMatch) publisher = pubMatch[1].trim();

    // 辨識日期
    let date = '未提供';
    const dateMatch = text.match(/(?:出版日(?:期)?|出版年|出版時間)[:：\s]+([0-9]{4}[-/年\.][0-9]{1,2}(?:[-/月\.][0-9]{1,2})?日?)/i);
    if (dateMatch) date = dateMatch[1].replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').trim();

    // 辨識頁數
    let pages = '未提供';
    const pageMatch = text.match(/(?:裝訂／頁數|平裝／頁數|頁數|页数)[:：\s]+(?:[^\d\n\r]{0,8})?([0-9]{2,4})\s*頁?/i);
    if (pageMatch) pages = `${pageMatch[1]} 頁`;

    return {
      isbn: isbn,
      title: title || `手動貼上書目 (${isbn})`,
      publisher: publisher,
      publishedDate: date,
      pageCount: pages,
      source: 'Google 摘要辨識',
      scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
    };
  }

  /**
   * 核心搜尋引擎：執行 A 方案 Google Programmable Search
   */
  async function searchBookByISBN(isbn) {
    const clean = isbn.replace(/[^0-9Xx]/g, '').trim();
    if (!clean) {
      log('無效的 ISBN 碼', 'warn');
      return null;
    }

    log(`----------------------------------------`, 'info');
    log(`[開始檢索] 目標 ISBN: ${clean}`, 'info');

    let title = '';
    let publisher = '未提供';
    let publishedDate = '未提供';
    let pageCount = '未提供';
    let sourceUsed = 'Google 搜尋';

    // 步驟 1: 呼叫 Google Programmable Search Engine (A 方案)
    if (googleApiKey && googleCx) {
      try {
        log(`[A 方案: Google Programmable Search] 發送全網搜尋請求...`, 'info');
        const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(clean)}&key=${encodeURIComponent(googleApiKey)}&cx=${encodeURIComponent(googleCx)}`;
        const t0 = performance.now();
        const res = await fetch(searchUrl);
        const latency = Math.round(performance.now() - t0);

        if (res.ok) {
          const data = await res.json();
          const items = data.items || [];
          log(`[Google 搜尋回應] HTTP 200 (${latency}ms, 命中: ${items.length} 筆搜尋結果)`, 'success');

          if (items.length > 0) {
            const parsed = parseGoogleSearchResults(items, clean);
            if (parsed) {
              if (parsed.title) title = parsed.title;
              if (parsed.publisher !== '未提供') publisher = parsed.publisher;
              if (parsed.publishedDate !== '未提供') publishedDate = parsed.publishedDate;
              if (parsed.pageCount !== '未提供') pageCount = parsed.pageCount;
              sourceUsed = 'Google 全網搜尋';
              log(`[Google 搜尋解析] 書名:《${title}》| 出版社:${publisher} | 頁數:${pageCount}`, 'success');
            }
          } else {
            log(`[Google 搜尋] 關鍵字 ${clean} 在全網無相符結果`, 'warn');
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error ? errData.error.message : `HTTP ${res.status}`;
          log(`[Google 搜尋失敗] ${errMsg}`, 'error');
          showToast(`Google 搜尋失敗: ${errMsg}`, 'error', 4000);
        }
      } catch (e) {
        log(`[Google 搜尋網路異常] ${e.message}`, 'error');
      }
    } else {
      log(`[提示] 尚未設定 Google API Key / CX，跳過 Google Custom Search`, 'warn');
      showToast(`💡 提示：點擊右上角 ⚙️ 設定 Google API Key 與 CX 即可啟用每日 100 次全網搜尋`, 'warning', 4500);
    }

    // 步驟 2: Google Books 全文關鍵字檢索備援 (若欄位尚缺，或未填寫 CX)
    if (!title || publisher === '未提供' || publishedDate === '未提供' || pageCount === '未提供') {
      try {
        log(`[備援檢索: Google Books 全文關鍵字] 嘗試補充缺漏欄位...`, 'info');
        let gBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(clean)}&country=TW`;
        if (googleApiKey) {
          gBooksUrl += `&key=${encodeURIComponent(googleApiKey)}`;
        }
        const t0 = performance.now();
        const res = await fetch(gBooksUrl);
        const latency = Math.round(performance.now() - t0);

        if (res.ok) {
          const gData = await res.json();
          log(`[Google Books 回應] HTTP 200 (${latency}ms, 命中: ${gData.totalItems || 0} 筆)`, 'success');
          if (gData.totalItems > 0 && gData.items && gData.items.length > 0) {
            const info = gData.items[0].volumeInfo || {};
            if (!title && info.title) {
              title = info.title;
              sourceUsed = sourceUsed === 'Google 全網搜尋' ? 'Google 搜尋+Books' : 'Google Books';
            }
            if (publisher === '未提供' && info.publisher) publisher = info.publisher;
            if (publishedDate === '未提供' && info.publishedDate) publishedDate = info.publishedDate;
            if (pageCount === '未提供' && info.pageCount) pageCount = `${info.pageCount} 頁`;
            log(`[Google Books 補充成功] 書名:《${title}》`, 'success');
          }
        } else if (res.status === 429) {
          log(`[Google Books] 請求過於頻繁 (HTTP 429)，建議於設定中填入 API Key`, 'warn');
        }
      } catch (e) {
        log(`[Google Books 異常] ${e.message}`, 'warn');
      }
    }

    // 若依然皆無書名，給予友善提示並允許手動編輯
    if (!title) {
      title = `未收錄書名 (${clean})`;
      sourceUsed = '待補充';
      log(`[檢索結果] 搜尋未獲取完整資料，已產生卡片供手動編輯或 Google 查看`, 'warn');
    }

    const finalBook = {
      isbn: clean,
      title: title,
      publisher: publisher,
      publishedDate: publishedDate,
      pageCount: pageCount,
      source: sourceUsed,
      scannedAt: new Date().toLocaleString('zh-TW', { hour12: false })
    };

    log(`[完成擷取] 書名: ${finalBook.title} | 出版社: ${finalBook.publisher} | 日期: ${finalBook.publishedDate} | 頁數: ${finalBook.pageCount}`, 'success');
    return finalBook;
  }

  // =========================================================================
  // 5. 條碼處理與防重複機制
  // =========================================================================
  async function handleScannedBarcode(decodedText, isManual = false) {
    if (scanCooldown) return;

    const rawIsbn = decodedText.replace(/[^0-9Xx]/g, '').trim();
    if (rawIsbn.length !== 10 && rawIsbn.length !== 13) return;

    // 國際標準 ISBN 前綴校驗 (13 碼必須以 978 或 979 開頭)
    if (rawIsbn.length === 13 && !rawIsbn.startsWith('978') && !rawIsbn.startsWith('979')) {
      if (isManual) {
        showToast(`⚠️ 條碼 ${rawIsbn} 非標準 978/979 ISBN`, 'warning');
      }
      return;
    }

    // 鏡頭防反光雙幀校驗 (手動輸入則立即通過)
    if (!isManual) {
      if (rawIsbn === candidateCode) {
        candidateHits++;
      } else {
        candidateCode = rawIsbn;
        candidateHits = 1;
        return;
      }
      if (candidateHits < 2) return;
    }

    candidateCode = '';
    candidateHits = 0;
    scanCooldown = true;
    setTimeout(() => { scanCooldown = false; }, 2200);

    // 檢查是否重複
    const existingIdx = books.findIndex(b => b.isbn === rawIsbn);
    if (existingIdx !== -1) {
      AudioFeedback.playWarning();
      triggerHaptic([180, 80, 180]);
      showToast(`⚠️ 此書已在清單中：【${books[existingIdx].title}】`, 'warning');
      highlightCard(existingIdx);
      return;
    }

    // 進入搜尋流程
    updateScanBadge('Google 搜尋中...', 'searching');
    showToast(`🔍 正在 Google 檢索 ISBN: ${rawIsbn}...`, 'success', 2000);

    try {
      const bookData = await searchBookByISBN(rawIsbn);
      if (bookData) {
        books.unshift(bookData);
        saveBooks();
        renderBooks();

        AudioFeedback.playSuccess();
        triggerHaptic([90]);
        showToast(`✅ 已新增：【${bookData.title}】`, 'success');
      }
    } catch (err) {
      log(`[檢索終止] ${err.message}`, 'error');
      showToast(`❌ 檢索失敗: ${err.message}`, 'error');
    } finally {
      updateScanBadge('準備就緒', 'ready');
    }
  }

  function highlightCard(index) {
    const cards = dom.booksList.querySelectorAll('.book-card-v2');
    if (cards[index]) {
      cards[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
      cards[index].style.borderColor = 'var(--color-warning)';
      setTimeout(() => {
        cards[index].style.borderColor = '';
      }, 1500);
    }
  }

  function updateScanBadge(text, state) {
    dom.scanStatusBadge.textContent = text;
    dom.scanStatusBadge.className = `status-badge ${state}`;
  }

  // =========================================================================
  // 6. 相機啟動與控制 (極致相容性 + 階梯式後置鏡頭啟動)
  // =========================================================================
  async function startCamera() {
    if (isScanning) return;

    AudioFeedback.init();
    dom.camPlaceholder.style.display = 'none';
    dom.scannerReticle.style.display = 'flex';
    updateScanBadge('相機啟動中...', 'searching');
    log('[相機] 正在請求相機串流...', 'info');

    try {
      if (html5QrCode) {
        try {
          if (html5QrCode.isScanning) await html5QrCode.stop();
          await html5QrCode.clear();
        } catch (e) {}
      }

      html5QrCode = new Html5Qrcode('reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8
        ],
        verbose: false
      });

      const config = {
        fps: 12,
        qrbox: { width: 280, height: 120 }
      };

      const onScanSuccess = (text) => handleScannedBarcode(text, false);
      const onScanError = () => {};

      try {
        await html5QrCode.start({ facingMode: 'environment' }, config, onScanSuccess, onScanError);
      } catch (err1) {
        log('[相機提示] 直接以 facingMode 啟動失敗，嘗試枚舉相機設備...', 'warn');
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const backCam = cameras.find(c => /back|rear|environment|後/i.test(c.label)) || cameras[cameras.length - 1];
          await html5QrCode.start(backCam.id, config, onScanSuccess, onScanError);
        } else {
          throw err1;
        }
      }

      isScanning = true;
      updateScanBadge('掃描中 (對準條碼)', 'ready');
      dom.btnToggleCam.disabled = false;
      dom.textToggleCam.textContent = '暫停鏡頭';
      dom.iconToggleCam.setAttribute('data-lucide', 'pause');
      log('[相機] 相機成功啟動！請將書籍條碼置於綠框內', 'success');

      // 檢查補光燈
      try {
        const track = html5QrCode.getRunningTrackCapabilities();
        if (track && 'torch' in track) {
          hasTorch = true;
          dom.btnToggleTorch.disabled = false;
        }
      } catch (e) {}

      lucide.createIcons();
    } catch (err) {
      log(`[相機錯誤] ${err.message || err}`, 'error');
      isScanning = false;
      dom.camPlaceholder.style.display = 'flex';
      dom.scannerReticle.style.display = 'none';
      updateScanBadge('相機未啟動', 'idle');
      showToast(`無法啟動相機: ${err.message || '請確認是否已授權相機權限且處於 HTTPS 環境'}`, 'error', 6000);
    }
  }

  async function stopCamera() {
    if (!isScanning && !html5QrCode) return;
    try {
      if (isTorchOn) await toggleTorch(false);
      if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
    } catch (e) {
    } finally {
      isScanning = false;
      dom.camPlaceholder.style.display = 'flex';
      dom.scannerReticle.style.display = 'none';
      updateScanBadge('已暫停', 'idle');
      dom.textToggleCam.textContent = '啟動鏡頭';
      dom.iconToggleCam.setAttribute('data-lucide', 'play');
      dom.btnToggleTorch.disabled = true;
      log('[相機] 已暫停相機預覽', 'info');
      lucide.createIcons();
    }
  }

  async function toggleTorch(targetState) {
    if (!isScanning || !html5QrCode || !hasTorch) return;
    try {
      const newState = typeof targetState === 'boolean' ? targetState : !isTorchOn;
      await html5QrCode.applyVideoConstraints({ advanced: [{ torch: newState }] });
      isTorchOn = newState;
      dom.btnToggleTorch.classList.toggle('btn-primary', isTorchOn);
      log(`[相機] 補光燈已${isTorchOn ? '開啟' : '關閉'}`, 'info');
    } catch (e) {}
  }

  // =========================================================================
  // 7. 書籍卡片渲染 (專注 4 大核心欄位)
  // =========================================================================
  function renderBooks() {
    dom.booksCountBadge.textContent = `${books.length} 本`;

    if (books.length === 0) {
      dom.booksEmpty.style.display = 'flex';
      dom.booksList.innerHTML = '';
      dom.btnExportCsv.disabled = true;
      dom.btnClearAll.disabled = true;
      return;
    }

    dom.booksEmpty.style.display = 'none';
    dom.btnExportCsv.disabled = false;
    dom.btnClearAll.disabled = false;

    dom.booksList.innerHTML = books.map((b, idx) => `
      <article class="book-card-v2" data-index="${idx}">
        <div class="card-top">
          <h3 class="card-main-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</h3>
          <span class="source-tag">${escapeHtml(b.source)}</span>
        </div>

        <!-- 4 大核心欄位展示網格 -->
        <div class="core-fields-grid">
          <div class="field-item">
            <span class="field-label">ISBN 號碼</span>
            <span class="field-val field-isbn">${escapeHtml(b.isbn)}</span>
          </div>
          <div class="field-item">
            <span class="field-label">出版社</span>
            <span class="field-val" title="${escapeHtml(b.publisher)}">${escapeHtml(b.publisher)}</span>
          </div>
          <div class="field-item">
            <span class="field-label">出版日期</span>
            <span class="field-val">${escapeHtml(b.publishedDate)}</span>
          </div>
          <div class="field-item">
            <span class="field-label">頁數</span>
            <span class="field-val">${escapeHtml(b.pageCount)}</span>
          </div>
        </div>

        <div class="card-bottom-actions">
          <span class="scan-timestamp">${escapeHtml(b.scannedAt)}</span>
          <div class="card-btn-group">
            <a href="https://www.google.com/search?q=${encodeURIComponent(b.isbn)}" target="_blank" rel="noopener" class="btn-icon-xs" title="在 Google 搜尋此書">
              <i data-lucide="search"></i>
            </a>
            <a href="https://search.books.com.tw/search/query/key/${encodeURIComponent(b.isbn)}" target="_blank" rel="noopener" class="btn-icon-xs" title="在博客來搜尋">
              <i data-lucide="shopping-bag"></i>
            </a>
            <button class="btn-icon-xs btn-edit-book" title="編輯 4 大核心欄位" data-index="${idx}">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn-icon-xs btn-delete-book" title="刪除此紀錄" data-index="${idx}" style="color:var(--color-danger);">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      </article>
    `).join('');

    lucide.createIcons();
    bindCardEvents();
  }

  function bindCardEvents() {
    // 編輯卡片按鈕
    dom.booksList.querySelectorAll('.btn-edit-book').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        openEditModal(idx);
      });
    });

    // 刪除個別卡片按鈕
    dom.booksList.querySelectorAll('.btn-delete-book').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        const removed = books.splice(idx, 1)[0];
        saveBooks();
        renderBooks();
        log(`[清單操作] 已移除書籍: ${removed.title}`, 'warn');
        showToast(`已移除《${removed.title}》`, 'warning');
      });
    });
  }

  function openEditModal(idx) {
    const b = books[idx];
    if (!b) return;

    dom.editIndex.value = idx;
    dom.editIsbn.value = b.isbn;
    dom.editTitle.value = b.title.startsWith('未收錄') ? '' : b.title;
    dom.editPublisher.value = b.publisher === '未提供' ? '' : b.publisher;
    dom.editDate.value = b.publishedDate === '未提供' ? '' : b.publishedDate;
    dom.editPages.value = b.pageCount === '未提供' ? '' : b.pageCount;

    dom.modalEdit.showModal();
  }

  // =========================================================================
  // 8. CSV 匯出邏輯 (包含 4 大核心欄位 + ISBN，內建 UTF-8 BOM)
  // =========================================================================
  function exportCSV() {
    if (books.length === 0) return;

    const headers = ['ISBN', '書名', '出版社', '出版日期', '頁數', '資料來源', '登記時間'];
    const escapeCSV = (val) => {
      if (!val) return '""';
      let str = String(val).trim().replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = books.map(b => [
      escapeCSV(b.isbn),
      escapeCSV(b.title),
      escapeCSV(b.publisher),
      escapeCSV(b.publishedDate),
      escapeCSV(b.pageCount),
      escapeCSV(b.source),
      escapeCSV(b.scannedAt)
    ]);

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(r => r.join(','))
    ].join('\r\n');

    // 加入 UTF-8 BOM (\uFEFF) 保證 Windows Excel 中文不亂碼
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `書籍清單_${ts}.csv`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log(`[匯出完成] 成功下載試算表檔案: ${filename} (共 ${books.length} 本)`, 'success');
    showToast(`🎉 成功匯出 ${filename}！`, 'success');
  }

  // =========================================================================
  // 9. 本地快取與設定管理
  // =========================================================================
  function loadSettings() {
    googleApiKey = localStorage.getItem(STORAGE_KEY_API_KEY) || '';
    googleCx = localStorage.getItem(STORAGE_KEY_CX) || '';

    dom.settingApiKey.value = googleApiKey;
    dom.settingCx.value = googleCx;

    // 若尚未設定，顯示橫幅
    if (!googleApiKey || !googleCx) {
      dom.apiSetupBanner.style.display = 'flex';
    } else {
      dom.apiSetupBanner.style.display = 'none';
    }
  }

  function saveSettings(key, cx) {
    googleApiKey = key.trim();
    googleCx = cx.trim();

    localStorage.setItem(STORAGE_KEY_API_KEY, googleApiKey);
    localStorage.setItem(STORAGE_KEY_CX, googleCx);

    if (googleApiKey && googleCx) {
      dom.apiSetupBanner.style.display = 'none';
      log(`[設定更新] Google Custom Search API Key 與 CX 已儲存`, 'success');
      showToast('✅ Google API 設定已成功儲存！', 'success');
    } else {
      dom.apiSetupBanner.style.display = 'flex';
      log(`[設定更新] API Key 或 CX 尚未填妥`, 'warn');
      showToast('⚠️ 請完整填入 API Key 與 搜尋引擎 ID', 'warning');
    }
  }

  function loadBooks() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BOOKS);
      if (saved) books = JSON.parse(saved);
    } catch (e) {
      books = [];
    }
    renderBooks();
  }

  function saveBooks() {
    try {
      localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify(books));
    } catch (e) {}
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // =========================================================================
  // 10. 事件綁定註冊
  // =========================================================================
  function initEvents() {
    // 啟動鏡頭
    dom.btnStartCam.addEventListener('click', startCamera);

    // 切換暫停/啟動鏡頭
    dom.btnToggleCam.addEventListener('click', () => {
      if (isScanning) stopCamera();
      else startCamera();
    });

    // 補光燈
    dom.btnToggleTorch.addEventListener('click', () => toggleTorch());

    // 快速手動輸入測試
    dom.btnQuickSearch.addEventListener('click', () => {
      const val = dom.quickIsbnInput.value.trim();
      if (val) handleScannedBarcode(val, true);
    });

    // 清空全部
    dom.btnClearAll.addEventListener('click', () => {
      if (books.length === 0) return;
      if (confirm(`確定要清空目前全部 ${books.length} 本書籍記錄嗎？此操作無法還原。`)) {
        books = [];
        saveBooks();
        renderBooks();
        log('[清單操作] 已清空全部書籍', 'warn');
        showToast('已清空清單', 'warning');
      }
    });

    // 匯出 CSV
    dom.btnExportCsv.addEventListener('click', exportCSV);

    // 設定對話框開啟
    const openSettings = () => {
      dom.settingApiKey.value = googleApiKey;
      dom.settingCx.value = googleCx;
      dom.testStatusText.textContent = '';
      dom.modalSettings.showModal();
    };
    dom.btnOpenSettings.addEventListener('click', openSettings);
    dom.btnBannerSettings.addEventListener('click', openSettings);

    dom.btnCloseSettings.addEventListener('click', () => dom.modalSettings.close());
    dom.btnCancelSettings.addEventListener('click', () => dom.modalSettings.close());

    // 儲存設定
    dom.formSettings.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings(dom.settingApiKey.value, dom.settingCx.value);
      dom.modalSettings.close();
    });

    // 測試連線 (以《少爺》ISBN 9789863840626 測試)
    dom.btnTestConnection.addEventListener('click', async () => {
      const testKey = dom.settingApiKey.value.trim();
      const testCx = dom.settingCx.value.trim();

      if (!testKey || !testCx) {
        dom.testStatusText.textContent = '❌ 請先輸入 Key 與 CX';
        dom.testStatusText.className = 'test-status err';
        return;
      }

      dom.testStatusText.textContent = '連線測試中...';
      dom.testStatusText.className = 'test-status';

      try {
        const testUrl = `https://www.googleapis.com/customsearch/v1?q=9789863840626&key=${encodeURIComponent(testKey)}&cx=${encodeURIComponent(testCx)}`;
        const t0 = performance.now();
        const res = await fetch(testUrl);
        const ms = Math.round(performance.now() - t0);

        if (res.ok) {
          const data = await res.json();
          const count = (data.items || []).length;
          dom.testStatusText.textContent = `✅ 連線成功 (${ms}ms, 命中 ${count} 筆)`;
          dom.testStatusText.className = 'test-status ok';
          log(`[連線測試成功] HTTP 200 (${ms}ms, 命中 ${count} 筆)`, 'success');
        } else {
          const errData = await res.json().catch(() => ({}));
          const msg = errData.error ? errData.error.message : `HTTP ${res.status}`;
          dom.testStatusText.textContent = `❌ 連線失敗: ${msg}`;
          dom.testStatusText.className = 'test-status err';
          log(`[連線測試失敗] ${msg}`, 'error');
        }
      } catch (err) {
        dom.testStatusText.textContent = `❌ 請求異常: ${err.message}`;
        dom.testStatusText.className = 'test-status err';
      }
    });

    // 手動輸入對話框分頁切換
    dom.btnManualInput.addEventListener('click', () => {
      dom.modalIsbnInput.value = '';
      dom.snippetText.value = '';
      dom.tabBtnIsbn.click();
      dom.modalManual.showModal();
      setTimeout(() => dom.modalIsbnInput.focus(), 100);
    });
    dom.btnCloseModal.addEventListener('click', () => dom.modalManual.close());
    dom.btnCancelModal.addEventListener('click', () => dom.modalManual.close());
    dom.btnCancelSnippet.addEventListener('click', () => dom.modalManual.close());

    dom.tabBtnIsbn.addEventListener('click', () => {
      dom.tabBtnIsbn.classList.add('active');
      dom.tabBtnSnippet.classList.remove('active');
      dom.formManual.style.display = 'block';
      dom.formSnippet.style.display = 'none';
      dom.modalIsbnInput.focus();
    });

    dom.tabBtnSnippet.addEventListener('click', () => {
      dom.tabBtnSnippet.classList.add('active');
      dom.tabBtnIsbn.classList.remove('active');
      dom.formSnippet.style.display = 'block';
      dom.formManual.style.display = 'none';
      dom.snippetText.focus();
    });

    // 表單 1: 手動 ISBN 輸入
    dom.formManual.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = dom.modalIsbnInput.value.trim();
      if (val) {
        dom.modalManual.close();
        handleScannedBarcode(val, true);
      }
    });

    // 表單 2: 貼上 Google 摘要文字智慧辨識
    dom.formSnippet.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawText = dom.snippetText.value.trim();
      if (!rawText) return;

      const parsed = parseSnippetText(rawText);
      if (parsed) {
        books.unshift(parsed);
        saveBooks();
        renderBooks();
        dom.modalManual.close();
        AudioFeedback.playSuccess();
        triggerHaptic([90]);
        log(`[智慧辨識成功] 已新增《${parsed.title}》| 出版社: ${parsed.publisher} | 頁數: ${parsed.pageCount}`, 'success');
        showToast(`✅ 智慧辨識成功：【${parsed.title}】`, 'success');
      } else {
        showToast('無法辨識此文字內容，請手動確認', 'warning');
      }
    });

    // 編輯核心 4 欄位對話框
    dom.btnCloseEdit.addEventListener('click', () => dom.modalEdit.close());
    dom.btnCancelEdit.addEventListener('click', () => dom.modalEdit.close());

    dom.formEdit.addEventListener('submit', (e) => {
      e.preventDefault();
      const idx = parseInt(dom.editIndex.value, 10);
      if (books[idx]) {
        books[idx].title = dom.editTitle.value.trim() || '未命名書籍';
        books[idx].publisher = dom.editPublisher.value.trim() || '未提供';
        books[idx].publishedDate = dom.editDate.value.trim() || '未提供';
        books[idx].pageCount = dom.editPages.value.trim() || '未提供';
        books[idx].source = '手動校對';
        saveBooks();
        renderBooks();
        dom.modalEdit.close();
        log(`[編輯成功] 已手動校對《${books[idx].title}》之 4 大欄位`, 'success');
        showToast('核心欄位更新成功！', 'success');
      }
    });

    // 複製與清空 Log
    dom.btnCopyLog.addEventListener('click', () => {
      navigator.clipboard.writeText(dom.terminalLogs.innerText).then(() => {
        showToast('日誌已複製至剪貼簿', 'success');
      });
    });
    dom.btnClearLog.addEventListener('click', () => {
      dom.terminalLogs.innerHTML = '';
      log('日誌已清空', 'info');
    });

    // 點擊對話框外圍關閉
    [dom.modalSettings, dom.modalManual, dom.modalEdit].forEach(dialog => {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    });
  }

  // 初始化
  function init() {
    lucide.createIcons();
    initEvents();
    loadSettings();
    loadBooks();
    log('ISBN v2 (A 方案: Google Programmable Search) 檢索引擎就緒。', 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
