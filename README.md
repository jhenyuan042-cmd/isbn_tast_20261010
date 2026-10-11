# 📚 ISBN v2 (A 方案) - Google 全網即時搜尋與書目清單匯出器

全新重構的 **v2 (A 方案)**：直接將掃描到的 ISBN 條碼透過 **Google Programmable Search (Google 全網搜尋 API)** 發起全網檢索，精準擷取與填入 **4 大核心書籍欄位**，並支援連續批次掃描、重複防呆與 Excel 相容 CSV 匯出。

---

## 🌟 核心特色 (A 方案)

1. **Google 全網搜尋引擎 (Custom Search JSON API)**：
   - 捨棄繁體中文覆蓋率低的 Open Library。
   - 掃描到 ISBN 後，直接在全網（包含博客來、誠品線上、三民網路書店、讀書共和國、讀冊、豆瓣等）進行搜尋。
   - Google 官方提供**每日 100 次完全免費**搜尋額度。
2. **智慧摘要解析引擎 (Regex + NLP)**：
   - 自動過濾搜尋標題中的書局後綴（如「│ 誠品線上」、「- 三民網路書店」）。
   - 自動從搜尋摘要 (Snippet) 與中繼資料 (PageMap) 中萃取 4 大核心欄位：
     1. **書名 (Title)**
     2. **出版社 (Publisher)**
     3. **出版日期 (Publication Date)**
     4. **頁數 (Page Count)**
3. **Google Books 全文關鍵字備援**：
   - 遇到冷門或未完整標註頁數之書籍，自動以相同 API Key 呼叫 Google Books 全文關鍵字資料庫互補資料。
4. **貼上 Google 摘要智慧辨識 (Smart Snippet Parser)**：
   - 若手動在 Google 搜尋複製了一段書店或網頁文字，可直接貼入「智慧辨識」表單，系統自動抽出 4 大欄位填入清單。
5. **卡片即時校對與外鏈驗證**：
   - 每張卡片皆附有「🔍 Google 搜尋」與「📚 博客來搜尋」快速跳轉按鈕，點擊即可一鍵在新分頁核對。
   - 每張卡片提供「✏️ 編輯」按鈕，可手動修正任一欄位。
6. **CSV 匯出純淨版 (UTF-8 BOM)**：
   - 產出的試算表僅包含精簡的核心欄位，內建 UTF-8 BOM，在 Windows Excel 開啟保證絕不亂碼。

---

## ⚙️ 2 分鐘快速設定教學 (取得 API Key 與 CX)

若要啟用 A 方案的 Google 全網搜尋，請於網頁右上角點擊 **⚙️ 設定** 填入以下兩項資訊（僅保存在您瀏覽器的本地 localStorage，不外洩）：

### 步驟 1：建立 Google 搜尋引擎並取得「搜尋引擎 ID (cx)」
1. 前往 [Google Programmable Search Engine 控制台](https://programmablesearchengine.google.com/)。
2. 點擊「**新增 (Add)**」。
3. 為搜尋引擎命名（例如：`書籍搜尋`）。
4. 在搜尋內容選擇「**搜尋整個網路 (Search the entire web)**」。
5. 建立完成後，在「總覽」頁面中複製 **搜尋引擎 ID (cx)**（格式通常為英數代碼，例如 `a1b2c3d4e5f6g`）。

### 步驟 2：取得「Google API Key」
1. 前往 [Google Cloud Console API 憑證頁面](https://console.cloud.google.com/apis/credentials)。
2. 建立新專案或選擇既有專案。
3. 前往「程式庫 (Library)」，搜尋並啟用 **Custom Search API**（若需要備援亦可啟用 **Books API**）。
4. 在「憑證」中點擊「**建立憑證 > API 金鑰**」，複製產生的金鑰（以 `AIzaSy...` 開頭）。

### 步驟 3：在網頁中貼上並測試
1. 在本系統右上角點擊 **⚙️ 設定**，貼上 API Key 與 搜尋引擎 ID (cx)。
2. 點擊「**測試連線**」，系統將自動以《少爺》(ISBN `9789863840626`) 發送測試請求，顯示綠色勾勾即代表設定成功！
3. 點擊「儲存設定」即可開始掃描！

---

## 📂 檔案目錄結構

- `isbn_v2/`
  - `index.html`：三欄式介面、API 設定彈窗、智慧辨識表單
  - `style.css`：深色毛玻璃設計、設定卡片、標籤頁切換
  - `app.js`：Google Custom Search API 串接、智慧摘要萃取、相機與 CSV 邏輯
  - `README.md`：本說明文檔
