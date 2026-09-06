/**
 * 🍱 點餐系統 - Google Apps Script 後端與自動寄信服務
 * 
 * 部署教學請參考 README.md
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
 * 1. 處理網頁端 POST 請求 (點餐寫入)
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
    }

    const targetDate = data.targetDateStr; // YYYY-MM-DD
    const seat = Number(data.seat);
    const rows = sheet.getDataRange().getValues();

    // 檢查同一天、同座號是否已點餐；若有則覆蓋更新，避免重複
    let updated = false;
    for (let i = 1; i < rows.length; i++) {
      const rowDate = String(rows[i][1]);
      const rowSeat = Number(rows[i][3]);

      if (rowDate === targetDate && rowSeat === seat) {
        // 覆蓋舊資料 (Row index 在 Sheet 是 1-based)
        sheet.getRange(i + 1, 1, 1, 7).setValues([[
          data.id || Utilities.getUuid(),
          targetDate,
          data.dayName || "",
          seat,
          data.mealName,
          data.price,
          data.time || Utilities.formatDate(new Date(), "Asia/Taipei", "HH:mm")
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
        data.dayName || "",
        seat,
        data.mealName,
        data.price,
        data.time || Utilities.formatDate(new Date(), "Asia/Taipei", "HH:mm")
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
 * 2. 處理網頁端 GET 請求 (可取得當日已點餐清單供後台同步)
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
  
  const rows = sheet.getDataRange().getValues();
  const orders = [];
  for (let i = 1; i < rows.length; i++) {
    orders.push({
      id: rows[i][0],
      targetDateStr: rows[i][1],
      dayName: rows[i][2],
      seat: rows[i][3],
      mealName: rows[i][4],
      price: rows[i][5],
      time: rows[i][6]
    });
  }
  return ContentService.createTextOutput(JSON.stringify(orders)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. 每日定時自動寄信函式 (設定在每天中午 12:00-13:00 觸發)
 */
function sendDailySummaryEmail() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const todayStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  const rows = sheet.getDataRange().getValues();
  
  const todayOrders = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === todayStr) {
      todayOrders.push({
        seat: rows[i][3],
        mealName: rows[i][4],
        price: Number(rows[i][5]),
        time: rows[i][6]
      });
    }
  }

  // 依座號排序
  todayOrders.sort((a, b) => a.seat - b.seat);

  if (todayOrders.length === 0) {
    console.log("今日 (" + todayStr + ") 尚無訂單，略過寄信。");
    return;
  }

  // 統計總份數與總金額
  const totalAmount = todayOrders.reduce((acc, cur) => acc + cur.price, 0);
  const counts = {};
  todayOrders.forEach(o => {
    counts[o.mealName] = (counts[o.mealName] || 0) + 1;
  });

  // 組裝郵件文字
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

  // 發送 Email
  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: CONFIG.EMAIL_SUBJECT_PREFIX + " (" + todayStr + ") - 共 " + todayOrders.length + " 筆",
    body: body
  });

  console.log("已成功發送今日訂單統計信件！");
}
