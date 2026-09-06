# 🍱 週一至週五點餐系統 (Food Ordering System)

這是一個極簡、無伺服器後端負擔（Serverless）的便當點餐網頁系統，專門設計部署在 **GitHub Pages** 上。
搭配本機 Python 輔助工具，只需將每週菜單（PDF、PNG、JPG）丟給程式，即可自動透過 AI 辨識並推送到 GitHub，達成全自動更新菜單！

---

## ✨ 系統特色

- 📱 **用戶端 (點餐)**
  - 只需選擇「座號（純數字）」與「餐點」，一鍵送出。
  - 隱私保護：用戶端不會顯示他人點餐內容。
  - 防重複點餐：同座號當天再次點餐會提示並覆蓋前筆訂單。
  - 自動依設定的截止時間（預設中午 12:00）自動切換至隔天或下週一預訂。

- 🛠️ **維護端 (管理)**
  - 預設密碼：`admin1234`（可於設定頁面自行變更）。
  - **菜單管理**：支援手動新增/編輯/刪除，亦可上傳 CSV。
  - **訂單檢視**：按星期檢視訂單、即時統計餐點份數與總金額。
  - **匯出功能**：一鍵匯出各日訂單 CSV，或生成彙總文字供複製發送。
  - **純前端運作**：所有訂單與設定均儲存在瀏覽器 `localStorage` 中。

- 🤖 **本機 AI 自動更新工具 (`menu_to_csv.py`)**
  - 在本機端呼叫 Gemini / Claude API，**不外洩 API Key 到前端**。
  - 支援 **PDF、PNG、JPG** 菜單檔案。
  - 解析後自動產出 CSV，並自動將 `menu.json` 透過 `git push` 推送至 GitHub，線上菜單即時更新！

---

## 📁 專案檔案結構

```text
order-system/
├── index.html           # 點餐系統主要網頁 (部署到 GitHub Pages)
├── menu.json            # 線上最新菜單資料 (由本機工具自動產生與推送)
├── menu_to_csv.py       # 本機 Python 轉檔與自動 Git 推送工具
├── run_converter.bat    # Windows 雙擊快速啟動腳本
└── README.md            # 本專案說明文件
```

---

## 🚀 部署至 GitHub Pages 教學

### 步驟 1：建立 GitHub 倉庫並推送程式碼
在專案目錄下開啟終端機（Terminal / PowerShell），執行：

```bash
# 1. 初始化 Git 倉庫
git init

# 2. 加入所有檔案並提交
git add .
git commit -m "feat: initial commit for order system"

# 3. 連結到你的 GitHub 倉庫 (請替換為你的倉庫網址)
git remote add origin https://github.com/你的帳號/你的倉庫名稱.git

# 4. 推送至 main 分支
git branch -M main
git push -u origin main
```

### 步驟 2：開啟 GitHub Pages
1. 前往 GitHub 倉庫的 **Settings** 頁面。
2. 在左側選單點擊 **Pages**。
3. 在 **Build and deployment** 下的 **Branch** 選擇 `main`，資料夾選擇 `/ (root)`，點擊 **Save**。
4. 等候約 1~2 分鐘，上方會出現專屬的點餐網址（例如：`https://你的帳號.github.io/你的倉庫名稱/`）。

---

## 🤖 每週如何自動更新菜單？

### 1. 安裝環境（僅首次需要）
本機需安裝 Python 3.8+，並安裝 Google GenAI 套件（推薦，免費額度充足）：

```bash
pip install google-genai
```

> **建議設定環境變數**：在系統中新增環境變數 `GEMINI_API_KEY`，這樣每次執行都不需要重複輸入金鑰。

### 2. 更新菜單（每週只要 1 動）
1. 雙擊執行專案目錄下的 **`run_converter.bat`**。
2. 彈出的視窗中選取新一週的菜單檔案（支援 **PDF**、**PNG**、**JPG**）。
3. 程式將自動：
   - 辨識週一至週五餐點與價格。
   - 儲存本機備用 CSV。
   - 更新 `menu.json` 並自動執行 `git commit` & `git push` 上傳至 GitHub。
4. **完成！** 所有打開網頁的用戶都會自動載入最新的週菜單！

---

## 📋 CSV 格式規範（備用手動上傳）

若不使用 Python 工具，亦可在網頁維護端直接拖曳上傳 CSV，格式如下：

```csv
星期,餐點名稱,價格
週一,排骨便當,80
週一,雞腿便當,90
週二,魚排便當,75
週三,控肉飯,70
週四,燒肉便當,85
週五,牛丼,95
```

- 星期支援：`週一～週五`、`1～5`、`Monday～Friday`。
- 第一列標題列會自動識別並略過。

---

---

## 📧 雲端訂單彙整與每日定時自動寄信 (Google 試算表串接)

當大家使用各自手機點餐時，可透過免費的 **Google 試算表 (Google Apps Script)** 收集大家的訂單，並設定**每天中午 12:00 自動寄送統計信件**給管理者！

### 設定步驟 (只需設定一次，約 3 分鐘)：

#### 1. 建立 Google 試算表
1. 開啟 [Google 雲端硬碟](https://drive.google.com/)，新增一份「Google 試算表」，可命名為 `辦公室點餐紀錄`。
2. 點選頂部選單 **擴充功能 (Extensions)** ➔ **Apps Script**。

#### 2. 貼上後端程式碼
1. 將專案中的 `google_sheet_backend.js` 內容全部複製，貼上覆蓋 Apps Script 編輯器內的預設程式碼。
2. 修改頂部的 `CONFIG` 設定：
   ```javascript
   const CONFIG = {
     ADMIN_EMAIL: "your_email@gmail.com", // 填入接收回報的信箱
     SHEET_NAME: "訂單紀錄",
     EMAIL_SUBJECT_PREFIX: "🍱 今日點餐統計回報"
   };
   ```
3. 點擊上方的「儲存 (磁碟片圖示)」。

#### 3. 發布為 Web 應用程式 (Web App)
1. 點擊右上角藍色按鈕 **部署 (Deploy)** ➔ **新增部署 (New deployment)**。
2. 點選左上齒輪圖示 ➔ 選擇 **網路應用程式 (Web app)**。
3. 設定：
   - 說明：`點餐 API`
   - 誰可以存取 (Who has access)：**任何人 (Anyone)** *(非常重要，這樣同仁手機才能送出訂單)*。
4. 點擊 **部署** ➔ 授予權限 (進階 ➔ 前往專案 ➔ 允許)。
5. 複製產生的 **網路應用程式網址 (Web app URL)** (格式如 `https://script.google.com/macros/s/.../exec`)。

#### 4. 綁定到點餐系統
1. 開啟點餐網頁，進入「維護端」➔「設定」。
2. 將剛剛複製的網址貼到 **「Google 試算表 Web App 網址」** 欄位。
3. **完成！** 此後每當有人用手機點餐，訂單會自動同步進 Google 試算表！

#### 5. 設定每日定時自動發信 (每天中午 12:00 準時發送)
1. 回到剛才的 Apps Script 網頁，點擊左側時鐘圖示 **觸發條件 (Triggers)**。
2. 點擊右下角 **+ 新增觸發條件 (Add Trigger)**。
3. 設定：
   - 選擇要執行的功能：`sendDailySummaryEmail`
   - 選取活動來源：**時間驅動 (Time-driven)**
   - 選取時間型觸發條件類型：**特定日期計時器 (Day timer)**
   - 選取時段：**中午 12 點到下午 1 點 (12:00 to 13:00)**
4. 點擊 **儲存**。
5. 👉 **完成！** 即使你的電腦關機，Google 雲端每天中午 12:00 也會準時將統計報表自動寄到你的信箱！

---

## 🔒 常見問題與安全性說明

1. **維護端密碼安全嗎？**
   - 這是純前端驗證系統，適合內部辦公室、班級使用。請勿存放高度敏感的商業機密。
2. **同仁手機重複點餐會怎樣？**
   - 系統具有同座號防呆覆蓋邏輯，同座號當天再次送出時，只會覆蓋原訂單，不會造成重複計數。

