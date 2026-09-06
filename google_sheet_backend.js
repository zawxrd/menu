/**
 * 🍱 點餐系統 - Google Apps Script 後端與自動寄信服務 (修正版)
 * 解決問題：
 * 1. 修正日期與時間被試算表轉成 ISO 字串 (1899-12-30T... / UTC) 的問題
 * 2. 修正同座號同日期重複追加問題，落實覆蓋更新
 */

// ===================== 基本設定 =====================
const CONFIG = {
  // 接收每日點餐回報的管理者 Email (多個請用逗號分隔)
  ADMIN_EMAIL: "admin@example.com", 
  // 試算表工作表名稱
  SHEET_NAME: "訂單紀錄",
  // 郵件主旨前綴
  EMAIL_SUBJECT_PREFIX: "🍱 今日點餐統計回報"
};

/**
 * 輔助函式：將任何日期/字串格式化為乾淨的 YYYY-MM-DD
 */
function normalizeDateStr(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "Asia/Taipei", "yyyy-MM-dd");
  }
  const s = String(val).trim();
  if (s.indexOf("T") !== -1) {
    try {
      const d = new Date(s);
      return Utilities.formatDate(d, "Asia/Taipei", "yyyy-MM-dd");
    } catch(e) {}
  }
  return s.split(" ")[0];
}

/**
 * 輔助函式：將任何時間格式化為乾淨的 HH:mm (24小時制)
 */
function normalizeTimeStr(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "Asia/Taipei", "HH:mm");
  }
  const s = String(val).trim();
  if (s.indexOf("T") !== -1) {
    try {
      const d = new Date(s);
      return Utilities.formatDate(d, "Asia/Taipei", "HH:mm");
    } catch(e) {}
  }
  return s;
}

/**
 * 1. 處理網頁端 POST 請求 (點餐寫入與覆蓋)
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    
    // 若工作表不存在則自動建立與初始化表頭
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEET_NAME);
      sheet.appendRow(["訂單ID", "預訂日期", "星期", "座號", "餐點名稱", "價格", "訂購時間"]);
      sheet.setFrozenRows(1);
      // 將預訂日期與訂購時間欄位設定為純文字格式，避免 Google 試算表自動轉換
      sheet.getRange("B:B").setNumberFormat("@");
      sheet.getRange("G:G").setNumberFormat("@");
    }

    const targetDate = normalizeDateStr(data.targetDateStr);
    const seat = Number(data.seat);
    const nowTime = normalizeTimeStr(data.time || new Date());
    const dayName = data.dayName || "";

    const rows = sheet.getDataRange().getValues();

    // 檢查同一天、同座號是否已點餐；若有則覆蓋更新
    let updated = false;
    for (let i = 1; i < rows.length; i++) {
      const rowDate = normalizeDateStr(rows[i][1]);
      const rowSeat = Number(rows[i][3]);

      if (rowDate === targetDate && rowSeat === seat) {
        // 覆蓋舊資料
        sheet.getRange(i + 1, 1, 1, 7).setValues([[
          data.id || Utilities.getUuid(),
          targetDate,
          dayName,
          seat,
          data.mealName,
          Number(data.price) || 0,
          nowTime
        ]]);
        updated = true;
        break;
      }
    }

    // 若為新訂單則追加一行
    if (!updated) {
      sheet.appendRow([
        data.id || Utilities.getUuid(),
        targetDate,
        dayName,
        seat,
        data.mealName,
        Number(data.price) || 0,
        nowTime
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success", updated: updated }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 2. 處理網頁端 GET 請求 (取得整理後的訂單清單供後台同步)
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
  
  const rows = sheet.getDataRange().getValues();
  const orderMap = {}; // 用於避免同一天同座號在試算表中有歷史殘留紀錄

  for (let i = 1; i < rows.length; i++) {
    const rawDate = rows[i][1];
    const rawSeat = rows[i][3];
    if (!rawDate || !rawSeat) continue;

    const dateStr = normalizeDateStr(rawDate);
    const seatNum = Number(rawSeat);
    const timeStr = normalizeTimeStr(rows[i][6]);

    const orderKey = dateStr + "_" + seatNum;
    orderMap[orderKey] = {
      id: String(rows[i][0] || Utilities.getUuid()),
      targetDateStr: dateStr,
      dayName: String(rows[i][2] || ''),
      seat: seatNum,
      mealName: String(rows[i][4] || ''),
      price: Number(rows[i][5]) || 0,
      time: timeStr
    };
  }

  const cleanOrders = Object.values(orderMap);
  // 依座號排序
  cleanOrders.sort((a, b) => a.seat - b.seat);

  return ContentService.createTextOutput(JSON.stringify(cleanOrders))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. 每日定時自動寄信函式 (每天中午 12:00 觸發)
 */
function sendDailySummaryEmail() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const todayStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  const rows = sheet.getDataRange().getValues();
  
  const todayMap = {};
  for (let i = 1; i < rows.length; i++) {
    const dateStr = normalizeDateStr(rows[i][1]);
    const seatNum = Number(rows[i][3]);

    if (dateStr === todayStr && seatNum) {
      todayMap[seatNum] = {
        seat: seatNum,
        mealName: String(rows[i][4]),
        price: Number(rows[i][5]) || 0,
        time: normalizeTimeStr(rows[i][6])
      };
    }
  }

  const todayOrders = Object.values(todayMap);
  todayOrders.sort((a, b) => a.seat - b.seat);

  if (todayOrders.length === 0) {
    console.log("今日 (" + todayStr + ") 尚無訂單，略過寄信。");
    return;
  }

  // 統計總金額與份數
  const totalAmount = todayOrders.reduce((acc, cur) => acc + cur.price, 0);
  const counts = {};
  todayOrders.forEach(o => {
    counts[o.mealName] = (counts[o.mealName] || 0) + 1;
  });

  // 組裝郵件內文
  let body = "📋 點餐統計回報 (" + todayStr + ")\n";
  body += "━━━━━━━━━━━━━━━━━━━━━━━\n";
  body += "總訂單數：" + todayOrders.length + " 筆\n";
  body += "總計金額：$" + totalAmount + " 元\n\n";

  body += "── 🍱 餐點數量統計 ──\n";
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(name => {
    body += "・" + name + "：" + counts[name] + " 份\n";
  });

  body += "\n── 📝 座號詳細清單 ──\n";
  todayOrders.forEach(o => {
    body += "座號 " + o.seat + " ➔ " + o.mealName + " ($" + o.price + ")\n";
  });

  body += "\n━━━━━━━━━━━━━━━━━━━━━━━\n";
  body += "本信件由 Google 試算表點餐系統自動發送。";

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: CONFIG.EMAIL_SUBJECT_PREFIX + " (" + todayStr + ") - 共 " + todayOrders.length + " 筆",
    body: body
  });

  console.log("已成功發送今日訂單統計信件！");
}
