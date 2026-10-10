# 📚 ISBN 批次掃描與書籍清單匯出器

一個輕量、現代化、支援手機相機即時掃描 ISBN 條碼的 Web 應用。串接 Google Books API 自動獲取書籍中英詳細資訊，支援連續批次掃描、重複條碼警示與 UTF-8 BOM CSV 匯出。

---

## ✨ 核心功能

1. **鏡頭即時掃描**：
   - 採用 `html5-qrcode` 專門鎖定 `EAN-13` / `EAN-8` 條碼，大幅提升辨識速度。
   - 支援後置相機自動切換與支援裝置之補光燈（手電筒）控制。
2. **重複條碼防呆警示**：
   - 當掃描到已存在的書籍時，自動發出**警示低音 + 震動**，彈出橙黃色警告，並平滑捲動至該卡片進行脈衝高亮，**不重複加入清單**。
3. **Google Books API 即時串接**：
   - 即時獲取書名、副標題、作者群、出版社、出版日期、頁數、分類、封面縮圖與內容簡介。
   - 支援免金鑰模式；右上角 ⚙️ 設定提供個人 Google Books API Key 欄位，可防範高頻查詢時的 `429 Too Many Requests`。
4. **一鍵匯出 CSV 試算表**：
   - 自動寫入 `\uFEFF` (UTF-8 BOM)，在 Windows Excel 或 Mac Numbers 開啟**中文絕對不亂碼**。
   - 嚴格跳脫引號與長文內容簡介中的換行，保證試算表格式整齊。
5. **資料自動持久化**：
   - 所有掃描記錄自動存於瀏覽器 `localStorage`，誤觸關閉或重新整理網頁紀錄不遺失。
6. **手動輸入 ISBN 備案**：
   - 若書籍條碼損毀或污損，點選右上角鍵盤圖示即可手動輸入 10 或 13 碼 ISBN。

---

## 📱 手機如何開啟與測試相機？

> [!IMPORTANT]
> 現代手機瀏覽器（iOS Safari 與 Android Chrome）為了隱私安全，規定**只有在 `localhost` 或 `HTTPS` 網址下才允許調用相機權限**。

### 方式一：直接上傳至免費靜態主機（最推薦、最穩定，自帶 HTTPS）
將本專案整個資料夾（`index.html`、`style.css`、`app.js`）上傳到以下任一免費服務，1 分鐘即可取得手機可開的 HTTPS 網址：
- **GitHub Pages**
- **Vercel** (`npx vercel`)
- **Cloudflare Pages**
- **Netlify Drop** (直接拖拉資料夾上傳)

### 方式二：使用免費 HTTPS 穿透工具（本地即時測試）
若本機正在運行測試伺服器（例如 `python -m http.server 8080`），可透過 Cloudflare 或 ngrok 快速建立 HTTPS 穿透網址讓手機掃描開啟：
```bash
# 使用免費 Cloudflare 穿透
npx cloudflared tunnel --url http://localhost:8080
```
或
```bash
# 使用 ngrok
ngrok http 8080
```
終端機產生的 `https://xxx.trycloudflare.com` 網址即可直接用手機瀏覽器開啟，相機功能即可順利運作！

### 方式三：Android 手機透過 USB 偵錯端口轉發 (Port Forwarding)
1. 手機開啟 USB 偵錯連上電腦。
2. 電腦開啟 Chrome 瀏覽器網址：`chrome://inspect/#devices`。
3. 點擊 **Port forwarding**，將 `8080` 轉發至 `localhost:8080`。
4. 手機 Chrome 直接打開 `http://localhost:8080`，因為被視為本機 localhost，**相機權限完全開放**！
