/**
 * 🍱 點餐系統 - 全域預設設定檔 (System Configuration)
 * 
 * 部署至 GitHub Pages 時，你可以在此填妥預設設定。
 * 這樣任何同仁用自己的手機打開網頁時，就自動擁有連線設定，絕不消失！
 */
window.DEFAULT_CONFIG = {
  // 1. 座位數量 (預設 30)
  seatCount: 30,

  // 2. 每日點餐截止時間 (24小時制，超過此時間自動開放隔天/下週一預訂)
  cutoffTime: "12:00",

  // 3. 管理者 Email (多個請用逗號分隔)
  adminEmail: "",

  // 4. 自動回報時間
  reportTime: "12:00",

  // 5. Google 試算表 Web App 網址 (從 Google Apps Script 部署複製過來的網址)
  // 填寫後，所有同仁手機點餐時會自動將訂單送入此試算表，並由 Google 每日定時自動寄信！
  googleSheetUrl: "",

  // 6. 維護端登入密碼
  adminPassword: "admin1234"
};
