/**
 * 🍱 點餐系統 - Google Apps Script 後端與全域雲端設定同步服務
 * 支援功能：
 * 1. 訂單即時寫入與同座號覆蓋
 * 2. 系統設定（座位數、截止時間、管理Email、回報時間、管理密碼）雲端雙向同步
 * 3. 每日定時自動發送訂單彙總 Email
 */

// ===================== 基本常數 =====================
const SHEET_ORDERS = "訂單紀錄";
const SHEET_SETTINGS = "系統設定";
const EMAIL_SUBJECT_PREFIX = "🍱 今日點餐統計回報";

/**
 * 取得或初始化「系統設定」工作表
 */
function getSettingsMap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SETTINGS);
    sheet.appendRow(["設定鍵值", "設定內容", "備註說明"]);
    sheet.setFrozenRows(1);
    sheet.getRange("B:B").setNumberFormat("@");
    // 寫入預設值
    sheet.appendRow(["seatCount", "30", "座位數量"]);
    sheet.appendRow(["cutoffTime", "12:00", "每日點餐截止時間 (HH:mm)"]);
    sheet.appendRow(["adminEmail", "", "管理者 Email"]);
    sheet.appendRow(["reportTime", "12:00", "自動回報時間 (HH:mm)"]);
    sheet.appendRow(["adminPassword", "admin1234", "維護端登入密碼"]);
  }

  const rows = sheet.getDataRange().getValues();
  const settings = {
    seatCount: 30,
    cutoffTime: "12:00",
    adminEmail: "",
    reportTime: "12:00",
    adminPassword: "admin1234"
  };

  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0]).trim();
    const rawVal = rows[i][1];
    let val = String(rawVal).trim();
    if (key && rawVal !== undefined) {
      if (key === "seatCount") {
        settings[key] = Number(val) || 30;
      } else if (key === "cutoffTime" || key === "reportTime") {
        settings[key] = normalizeTimeStr(rawVal) || "12:00";
      } else {
        settings[key] = val;
      }
    }
  }
  return settings;
}

/**
 * 儲存設定至「系統設定」工作表
 */
function saveSettingsToSheet(newSettings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) {
    getSettingsMap();
    sheet = ss.getSheetByName(SHEET_SETTINGS);
  }
  sheet.getRange("B:B").setNumberFormat("@");

  const rows = sheet.getDataRange().getValues();
  const keys = Object.keys(newSettings);

  for (const key of keys) {
    let saveVal = String(newSettings[key]);
    if (key === "cutoffTime" || key === "reportTime") {
      saveVal = normalizeTimeStr(newSettings[key]) || "12:00";
    }
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === key) {
        const cell = sheet.getRange(i + 1, 2);
        cell.setNumberFormat("@");
        cell.setValue(saveVal);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([key, saveVal, "自訂設定"]);
      sheet.getRange(sheet.getLastRow(), 2).setNumberFormat("@");
    }
  }
}

/**
 * 輔助函式：格式化日期為 YYYY-MM-DD
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
 * 輔助函式：格式化時間為 HH:mm
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
 * 1. 處理網頁端 POST 請求 (支援點餐寫入 OR 儲存系統設定)
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // 【模式 A】：儲存系統設定
    if (data.action === "saveSettings") {
      saveSettingsToSheet(data.settings || {});
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "設定已儲存至雲端" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 【模式 B】：點餐送出
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_ORDERS);
    
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_ORDERS);
      sheet.appendRow(["訂單ID", "預訂日期", "星期", "座號", "餐點名稱", "價格", "訂購時間"]);
      sheet.setFrozenRows(1);
      sheet.getRange("B:B").setNumberFormat("@");
      sheet.getRange("G:G").setNumberFormat("@");
    }

    const targetDate = normalizeDateStr(data.targetDateStr);
    const seat = Number(data.seat);
    const nowTime = normalizeTimeStr(data.time || new Date());
    const dayName = data.dayName || "";

    const rows = sheet.getDataRange().getValues();

    // 檢查同日同座號，落實覆蓋更新
    let updated = false;
    for (let i = 1; i < rows.length; i++) {
      const rowDate = normalizeDateStr(rows[i][1]);
      const rowSeat = Number(rows[i][3]);

      if (rowDate === targetDate && rowSeat === seat) {
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
 * 2. 處理網頁端 GET 請求 (同時回傳訂單與雲端設定)
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ORDERS);
  
  // 1. 取得雲端設定
  const settings = getSettingsMap();

  // 2. 取得訂單紀錄
  const cleanOrders = [];
  if (sheet) {
    const rows = sheet.getDataRange().getValues();
    const orderMap = {};

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

    Object.values(orderMap).forEach(o => cleanOrders.push(o));
    cleanOrders.sort((a, b) => a.seat - b.seat);
  }

  // 同時打包回傳 orders 與 settings
  const payload = {
    orders: cleanOrders,
    settings: settings
  };

  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. 每日定時自動寄信函式 (每天中午 12:00 觸發)
 */
function sendDailySummaryEmail() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) return;

  const settings = getSettingsMap();
  const adminEmail = settings.adminEmail;
  if (!adminEmail) {
    console.log("未設定管理者 Email，略過寄信。");
    return;
  }

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

  const totalAmount = todayOrders.reduce((acc, cur) => acc + cur.price, 0);
  const counts = {};
  todayOrders.forEach(o => {
    counts[o.mealName] = (counts[o.mealName] || 0) + 1;
  });

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
    to: adminEmail,
    subject: EMAIL_SUBJECT_PREFIX + " (" + todayStr + ") - 共 " + todayOrders.length + " 筆",
    body: body
  });

  console.log("已成功發送今日訂單統計信件至: " + adminEmail);
}
