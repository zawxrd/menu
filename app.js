
const DAY_NAMES = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' };

function getDefaultWeekday() {
  const day = new Date().getDay();
  return (day >= 1 && day <= 5) ? day : 1;
}

// ===================== STATE =====================
let state = {
  weeklyMenu: { 1:[], 2:[], 3:[], 4:[], 5:[] },
  menuUpdatedAt: 0,
  orders: [],
  seatCount: 30,
  cutoffTime: '12:00',
  adminEmail: '',
  reportTime: '12:00',
  googleSheetUrl: '',
  adminPassword: 'admin1234',
  isManualMenu: false,
  menuClearedAt: 0,
  menuValidWeekStart: '',
  currentPage: 'user',
  currentAdminTab: 'menu',
  selectedAdminDay: getDefaultWeekday(),
  selectedAdminOrderDay: getDefaultWeekday()
};

function getActiveTarget() {
  const now = new Date();
  const [h, m] = state.cutoffTime.split(':').map(Number);
  const cutoff = new Date();
  cutoff.setHours(h, m, 0, 0);

  let targetDate = new Date();
  let isTomorrow = false;

  if (now > cutoff) {
    targetDate.setDate(targetDate.getDate() + 1);
    isTomorrow = true;
  }

  while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
    targetDate.setDate(targetDate.getDate() + 1);
    if (targetDate.getDay() === 1) isTomorrow = true;
  }

  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const dayOfWeek = targetDate.getDay();

  return { dateStr, dayOfWeek, isTomorrow, dayName: DAY_NAMES[dayOfWeek] };
}

function loadState() {
  // 1. 優先套用 config.js 中的預設設定 (若存在)
  if (window.DEFAULT_CONFIG) {
    if (window.DEFAULT_CONFIG.seatCount) state.seatCount = Number(window.DEFAULT_CONFIG.seatCount);
    if (window.DEFAULT_CONFIG.cutoffTime) state.cutoffTime = String(window.DEFAULT_CONFIG.cutoffTime);
    if (window.DEFAULT_CONFIG.adminEmail) state.adminEmail = String(window.DEFAULT_CONFIG.adminEmail);
    if (window.DEFAULT_CONFIG.reportTime) state.reportTime = String(window.DEFAULT_CONFIG.reportTime);
    if (window.DEFAULT_CONFIG.googleSheetUrl) state.googleSheetUrl = String(window.DEFAULT_CONFIG.googleSheetUrl);
    if (window.DEFAULT_CONFIG.adminPassword) state.adminPassword = String(window.DEFAULT_CONFIG.adminPassword);
  }

  // 2. 合併使用者在瀏覽器修改過的 localStorage 設定
  try {
    const s = localStorage.getItem('orderSystemWeeklyState');
    if (s) {
      const parsed = JSON.parse(s);
      // 確保只合併有效值，不以空字串或 undefined 抹消既有設定
      for (const key of Object.keys(parsed)) {
        if (parsed[key] !== null && parsed[key] !== undefined && parsed[key] !== '') {
          state[key] = parsed[key];
        } else if (key === 'orders' || key === 'weeklyMenu') {
          state[key] = parsed[key];
        }
      }
    }
  } catch(e) {}
  state.cutoffTime = cleanCloudTimeStr(state.cutoffTime);
  state.reportTime = cleanCloudTimeStr(state.reportTime);
}

function saveState() {
  try {
    localStorage.setItem('orderSystemWeeklyState', JSON.stringify(state));
  } catch(e) {}
}

// ===================== NAV =====================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-tab')[name === 'user' ? 0 : 1].classList.add('active');
  state.currentPage = name;
  if (name === 'user') renderUserPage();
  if (name === 'admin') {
    renderAdminPage();
    syncOrdersFromCloud(false); // 切換至維護端時自動靜默重整一次雲端最新訂單
  }
}

function showAdminLogin() {
  document.getElementById('login-pw').value = '';
  document.getElementById('login-err').style.display = 'none';
  document.getElementById('login-modal').classList.add('show');
  setTimeout(() => document.getElementById('login-pw').focus(), 100);
}

function doLogin() {
  const pw = document.getElementById('login-pw').value;
  if (pw === state.adminPassword) { closeModal('login-modal'); showPage('admin'); }
  else { document.getElementById('login-err').style.display = 'flex'; }
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ===================== USER PAGE =====================
function getThisWeekMondayStr() {
  const today = new Date();
  const day = today.getDay(); // 0=日, 1=週一...6=週六
  const diff = day === 0 ? -6 : 1 - day; // 往前找週一
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderUserPage() {
  const target = getActiveTarget();
  const seatSel = document.getElementById('seat-select');
  const mealSel = document.getElementById('meal-select');

  const badge = document.getElementById('order-target-badge');
  if (target.isTomorrow) {
    badge.textContent = `預訂明日 (${target.dayName} ${target.dateStr})`;
    badge.className = 'chip chip-warn';
    document.getElementById('user-order-title').textContent = `📋 預訂餐點 (${target.dayName} ${target.dateStr})`;
  } else {
    badge.textContent = `開放今日 (${target.dayName} ${target.dateStr})`;
    badge.className = 'chip chip-success';
    document.getElementById('user-order-title').textContent = '📋 今日點餐';
  }

  seatSel.innerHTML = '<option value="">-- 請選擇座號 --</option>';
  for (let i = 1; i <= state.seatCount; i++) {
    seatSel.innerHTML += `<option value="${i}">${i}</option>`;
  }

  // ── 有效週驗證 ──
  // 若菜單帶有 validWeekStart，且不屬於本週，視為「尚未開放」
  const thisWeekMonday = getThisWeekMondayStr();
  const menuWeekStart = state.menuValidWeekStart || '';
  const menuExpired = menuWeekStart && menuWeekStart !== thisWeekMonday;

  const activeMenu = menuExpired ? [] : (state.weeklyMenu[target.dayOfWeek] || []);
  mealSel.innerHTML = '<option value="">-- 請選擇餐點 --</option>';
  activeMenu.forEach(item => {
    mealSel.innerHTML += `<option value="${item.id}">${item.name}（$${item.price}）</option>`;
  });

  const hasMenu = activeMenu.length > 0;
  const emptyEl = document.getElementById('user-menu-empty');
  document.getElementById('user-form').style.display = hasMenu ? 'block' : 'none';

  if (!hasMenu) {
    emptyEl.style.display = 'flex';
    if (menuExpired) {
      emptyEl.textContent = `📅 本週菜單尚未發布（上份菜單有效週：${menuWeekStart}）`;
    } else {
      emptyEl.textContent = '📋 今日尚無菜單';
    }
  } else {
    emptyEl.style.display = 'none';
  }

  const userCutoff = document.getElementById('user-cutoff-display');
  if (userCutoff) userCutoff.textContent = state.cutoffTime || '12:00';
}

document.addEventListener('change', function(e) {
  const target = getActiveTarget();
  if (e.target.id === 'meal-select') {
    const id = e.target.value;
    const activeMenu = state.weeklyMenu[target.dayOfWeek] || [];
    const item = activeMenu.find(m => m.id == id);
    const disp = document.getElementById('meal-price-display');
    if (item) { disp.style.display = 'flex'; disp.textContent = `💰 單價：$${item.price} 元`; }
    else { disp.style.display = 'none'; }
  }
  if (e.target.id === 'seat-select') {
    const seat = parseInt(e.target.value);
    const existed = state.orders.find(o => o.seat === seat && o.targetDateStr === target.dateStr);
    document.getElementById('already-ordered-warn').style.display = existed ? 'flex' : 'none';
  }
});

function submitOrder() {
  const target = getActiveTarget();
  const seat = parseInt(document.getElementById('seat-select').value);
  const mealId = document.getElementById('meal-select').value;

  if (!seat) { alert('請選擇座號'); return; }
  if (!mealId) { alert('請選擇餐點'); return; }

  const activeMenu = state.weeklyMenu[target.dayOfWeek] || [];
  const item = activeMenu.find(m => m.id == mealId);
  if (!item) return;

  const orderPayload = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    targetDateStr: target.dateStr,
    dayName: target.dayName,
    dayOfWeek: target.dayOfWeek,
    seat,
    mealId: item.id,
    mealName: item.name,
    price: item.price,
    time: new Date().toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'})
  };

  state.orders = state.orders.filter(o => !(o.seat === seat && o.targetDateStr === target.dateStr));
  state.orders.push(orderPayload);
  state.orders.sort((a, b) => a.seat - b.seat);
  saveState();

  // 若有設定 Google 試算表 Web App 網址，自動推送到雲端試算表
  if (state.googleSheetUrl) {
    try {
      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors', // 避免跨網域 CORS 警告
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      }).catch(err => console.log('雲端同步提示:', err));
    } catch(e) {}
  }

  document.getElementById('success-detail').textContent =
    `[${target.dayName} ${target.dateStr}] 座號 ${seat} — ${item.name}（$${item.price}）`;
  document.getElementById('success-overlay').classList.add('show');

  document.getElementById('seat-select').value = '';
  document.getElementById('meal-select').value = '';
  document.getElementById('meal-price-display').style.display = 'none';
  document.getElementById('already-ordered-warn').style.display = 'none';
}

function closeSuccess() { document.getElementById('success-overlay').classList.remove('show'); }

// ===================== ADMIN PAGE =====================
function renderAdminPage() {
  updateAdminDayButtons();
  updateAdminOrderDayButtons();
  updateStats();
  renderMenuList();
  renderAdminOrders();
  renderMealStats();
  populateSettingsUI();
}

function switchAdminTab(tab) {
  ['menu', 'orders', 'settings'].forEach(t => {
    document.getElementById('admin-' + t + '-tab').style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach((el, i) => {
    el.classList.toggle('active', ['menu', 'orders', 'settings'][i] === tab);
  });
  state.currentAdminTab = tab;
}

function selectAdminDay(day) {
  state.selectedAdminDay = day;
  updateAdminDayButtons();
  renderMenuList();
  updateStats();
}

function selectAdminOrderDay(day) {
  state.selectedAdminOrderDay = day;
  updateAdminOrderDayButtons();
  renderAdminOrders();
  renderMealStats();
  updateStats();
}

function updateAdminDayButtons() {
  const btns = document.querySelectorAll('#admin-day-selector .day-btn');
  [1,2,3,4,5].forEach((d, i) => btns[i].classList.toggle('active', d === state.selectedAdminDay));
}

function updateAdminOrderDayButtons() {
  const btns = document.querySelectorAll('#admin-order-day-selector .day-btn');
  const days = [0, 1, 2, 3, 4, 5];
  btns.forEach((btn, idx) => {
    btn.classList.toggle('active', days[idx] === state.selectedAdminOrderDay);
  });
}

function getFilteredOrders() {
  if (state.selectedAdminOrderDay === 0) {
    return state.orders; // 0 代表顯示全部
  }
  return state.orders.filter(o => o.dayOfWeek === state.selectedAdminOrderDay);
}

function updateStats() {
  // 所選日餐點數：若選全部(0)，計算週一至週五全週餐點種類總數；否則計算該星期幾的餐點數
  let menuCount = 0;
  if (state.selectedAdminOrderDay === 0) {
    [1, 2, 3, 4, 5].forEach(d => {
      menuCount += (state.weeklyMenu[d] || []).length;
    });
  } else {
    menuCount = (state.weeklyMenu[state.selectedAdminOrderDay] || []).length;
  }
  document.getElementById('stat-items').textContent = menuCount;

  // 所選日訂單數與營收
  const filteredOrders = getFilteredOrders();
  document.getElementById('stat-orders').textContent = filteredOrders.length;
  document.getElementById('stat-revenue').textContent = '$' + filteredOrders.reduce((s, o) => s + o.price, 0);
}

function renderMenuList() {
  const list = document.getElementById('menu-list');
  const empty = document.getElementById('menu-list-empty');
  const dayMenu = state.weeklyMenu[state.selectedAdminDay] || [];
  if (dayMenu.length === 0) { empty.style.display = 'flex'; list.innerHTML = ''; return; }
  empty.style.display = 'none';
  list.innerHTML = dayMenu.map(item => `
    <div class="menu-item">
      <div class="menu-item-info"><div class="menu-item-name">${item.name}</div></div>
      <div class="menu-item-price">$${item.price}</div>
      <div class="menu-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="editItem('${item.id}')">編輯</button>
        <button class="btn btn-danger btn-sm" onclick="removeItem('${item.id}')">刪除</button>
      </div>
    </div>`).join('');
}

function renderAdminOrders() {
  const c = document.getElementById('admin-orders-container');
  const filteredOrders = getFilteredOrders();
  const label = state.selectedAdminOrderDay === 0 ? "全部" : DAY_NAMES[state.selectedAdminOrderDay];

  if (filteredOrders.length === 0) {
    c.innerHTML = `<div class="alert alert-info">${label} 尚無訂單紀錄。</div>`;
    return;
  }
  c.innerHTML = `<table>
    <thead><tr><th>預訂日期</th><th>星期</th><th>座號</th><th>餐點</th><th>價格</th><th>訂購時間</th><th></th></tr></thead>
    <tbody>${filteredOrders.map(o => `
      <tr>
        <td style="color:var(--text-soft)">${o.targetDateStr || '—'}</td>
        <td style="color:var(--text-soft)">${DAY_NAMES[o.dayOfWeek] || o.dayName || '—'}</td>
        <td><strong>${o.seat}</strong></td>
        <td>${o.mealName}</td>
        <td>$${o.price}</td>
        <td style="color:var(--text-soft)">${o.time}</td>
        <td><button class="btn btn-danger btn-sm" onclick="cancelOrder('${o.id}')">取消</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}

function renderMealStats() {
  const el = document.getElementById('meal-stats');
  const filteredOrders = getFilteredOrders();
  if (filteredOrders.length === 0) { el.innerHTML = '<div class="alert alert-info">尚無資料</div>'; return; }
  
  // 統計每項餐點的數量與點餐座號
  const stats = {};
  filteredOrders.forEach(o => {
    if (!stats[o.mealName]) {
      stats[o.mealName] = { count: 0, seats: [] };
    }
    stats[o.mealName].count++;
    if (!stats[o.mealName].seats.includes(o.seat)) {
      stats[o.mealName].seats.push(o.seat);
    }
  });

  // 座號升冪排序，並依被點次數排序
  el.innerHTML = Object.entries(stats).sort((a,b) => b[1].count - a[1].count).map(([name, data]) => {
    const seatsText = data.seats.sort((a, b) => a - b).join(', ');
    return `
    <div class="menu-item" style="padding: 12px 14px;">
      <div class="menu-item-info">
        <div class="menu-item-name" style="font-size: .95rem; font-weight: 600;">${name}</div>
        <div style="font-size: .8rem; color: var(--text-soft); margin-top: 4px;">
          👥 點餐座號：<span style="color: var(--accent); font-weight: 600;">${seatsText}</span>
        </div>
      </div>
      <div style="font-weight: 700; color: var(--accent); font-size: 1rem; white-space: nowrap; margin-left: 12px;">
        ${data.count} 份
      </div>
    </div>`;
  }).join('');
}

// ===================== CLOUD ORDER SYNC =====================
function cleanCloudDateStr(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d)) {
      return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    }
  }
  return s.split(' ')[0];
}

function cleanCloudTimeStr(raw) {
  if (!raw) return '12:00';
  const s = String(raw).trim();
  // 格式 1: 標準 HH:mm (例如 12:00 或 9:30 或 12:00:00)
  const matchSimple = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (matchSimple) {
    const h = matchSimple[1].padStart(2, '0');
    const m = matchSimple[2];
    return `${h}:${m}`;
  }
  // 格式 2: ISO 格式或 Date 字串
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  // 格式 3: 包含 HH:mm
  const matchAny = s.match(/(\d{1,2}):(\d{2})/);
  if (matchAny) {
    const h = matchAny[1].padStart(2, '0');
    const m = matchAny[2];
    return `${h}:${m}`;
  }
  return '12:00';
}

async function syncOrdersFromCloud(isManual = false) {
  if (!state.googleSheetUrl) {
    if (isManual) alert("尚未設定 Google 試算表 Web App 網址！\n請先至「設定」頁面填寫。");
    return;
  }
  try {
    const res = await fetch(state.googleSheetUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cloudData = await res.json();

    const cloudOrders = Array.isArray(cloudData) ? cloudData : (cloudData.orders || []);
    const cloudSettings = (!Array.isArray(cloudData) && cloudData.settings) ? cloudData.settings : null;

    // 1. 同步雲端設定 (若存在)
    if (cloudSettings) {
      if (cloudSettings.seatCount) state.seatCount = Number(cloudSettings.seatCount);
      if (cloudSettings.cutoffTime) state.cutoffTime = cleanCloudTimeStr(cloudSettings.cutoffTime);
      if (cloudSettings.adminEmail !== undefined) state.adminEmail = String(cloudSettings.adminEmail);
      if (cloudSettings.reportTime) state.reportTime = cleanCloudTimeStr(cloudSettings.reportTime);
      if (cloudSettings.adminPassword) state.adminPassword = String(cloudSettings.adminPassword);
      if (cloudSettings.menuClearedAt) {
        const cloudClearedAt = Number(cloudSettings.menuClearedAt);
        if (cloudClearedAt > (state.menuUpdatedAt || 0)) {
          state.menuClearedAt = cloudClearedAt;
          state.weeklyMenu = { 1:[], 2:[], 3:[], 4:[], 5:[] };
          state.isManualMenu = true;
          if (state.currentPage === 'user') renderUserPage();
          if (state.currentPage === 'admin') renderAdminPage();
        }
      }
      populateSettingsUI();
    }

    // 2. 同步訂單紀錄
    if (Array.isArray(cloudOrders)) {
      const dayKeys = { '週一': 1, '週二': 2, '週三': 3, '週四': 4, '週五': 5 };
      const map = {};

      cloudOrders.forEach(o => {
        const cleanDate = cleanCloudDateStr(o.targetDateStr);
        const cleanTime = cleanCloudTimeStr(o.time);
        const seatNum = Number(o.seat);
        if (!cleanDate || !seatNum) return;

        // 同一天同座號只保留一筆 (落實去重複)
        map[`${cleanDate}_${seatNum}`] = {
          id: String(o.id || Math.random()),
          targetDateStr: cleanDate,
          dayName: String(o.dayName || ''),
          dayOfWeek: Number(o.dayOfWeek) || dayKeys[o.dayName] || 1,
          seat: seatNum,
          mealName: String(o.mealName),
          price: Number(o.price) || 0,
          time: cleanTime
        };
      });

      state.orders = Object.values(map);
      state.orders.sort((a, b) => a.seat - b.seat);
    }

    saveState();

    if (state.currentPage === 'admin') {
      renderAdminOrders();
      renderMealStats();
      updateStats();
    }
    if (state.currentPage === 'user') {
      renderUserPage();
    }

    if (isManual) {
      alert(`✅ 成功從 Google 試算表同步！\n・訂單：${state.orders.length} 筆\n・雲端設定已成功載入！`);
    }
  } catch (err) {
    if (isManual) {
      alert("❌ 載入雲端失敗：" + err.message + "\n請確認 Google 試算表 Web App 部署權限是否設為「任何人 (Anyone)」。");
    }
  }
}

function cancelOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!confirm('確定取消此筆訂單？')) return;
  state.orders = state.orders.filter(o => o.id !== orderId);
  saveState();
  renderAdminOrders();
  renderMealStats();
  updateStats();

  // 同步從 Google 試算表刪除
  if (state.googleSheetUrl && order) {
    try {
      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteOrder',
          id: orderId,
          targetDateStr: order.targetDateStr,
          seat: order.seat
        })
      }).catch(e => console.log('雲端刪除訂單提示:', e));
    } catch(e) {}
  }
}

// ===================== MENU MANAGEMENT =====================
function showAddItemModal() {
  document.getElementById('new-item-name').value = '';
  document.getElementById('new-item-price').value = '';
  document.getElementById('add-item-modal').classList.add('show');
  setTimeout(() => document.getElementById('new-item-name').focus(), 100);
}

function addMenuItem() {
  const name = document.getElementById('new-item-name').value.trim();
  const price = parseInt(document.getElementById('new-item-price').value);
  if (!name || isNaN(price) || price < 0) { alert('請填寫餐點名稱與有效價格'); return; }
  if (!state.weeklyMenu[state.selectedAdminDay]) state.weeklyMenu[state.selectedAdminDay] = [];
  state.weeklyMenu[state.selectedAdminDay].push({
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    name, price
  });
  state.menuUpdatedAt = Date.now();
  state.isManualMenu = true;
  saveState();
  closeModal('add-item-modal');
  renderMenuList();
  updateStats();
}

function editItem(id) {
  const dayMenu = state.weeklyMenu[state.selectedAdminDay] || [];
  const item = dayMenu.find(m => m.id === id);
  if (!item) return;
  const name = prompt('餐點名稱：', item.name);
  if (name === null) return;
  const price = parseInt(prompt('價格：', item.price));
  if (isNaN(price)) return;
  item.name = name.trim() || item.name;
  item.price = price;
  state.menuUpdatedAt = Date.now();
  state.isManualMenu = true;
  saveState();
  renderMenuList();
  updateStats();
}

function removeItem(id) {
  if (!confirm('確定刪除此餐點？')) return;
  state.weeklyMenu[state.selectedAdminDay] = (state.weeklyMenu[state.selectedAdminDay] || []).filter(m => m.id !== id);
  state.orders = state.orders.filter(o => !(o.dayOfWeek === state.selectedAdminDay && o.mealId === id));
  state.menuUpdatedAt = Date.now();
  state.isManualMenu = true;
  saveState();
  renderMenuList();
  renderAdminOrders();
  updateStats();
}

// ===================== SETTINGS =====================
function saveSeatCount() {
  const val = parseInt(document.getElementById('seat-count').value);
  if (val > 0) { state.seatCount = val; saveState(); }
}

function pushSettingsToCloud() {
  if (!state.googleSheetUrl) return;
  const payload = {
    action: "saveSettings",
    settings: {
      seatCount: state.seatCount,
      cutoffTime: state.cutoffTime,
      adminEmail: state.adminEmail,
      reportTime: state.reportTime,
      adminPassword: state.adminPassword
    }
  };
  try {
    fetch(state.googleSheetUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(e => console.log("雲端設定儲存提示:", e));
  } catch(e) {}
}

function saveAllSettings() {
  const seat = parseInt(document.getElementById('seat-count').value);
  if (seat > 0) state.seatCount = seat;
  
  const cutoff = document.getElementById('cutoff-time').value;
  if (cutoff) state.cutoffTime = cleanCloudTimeStr(cutoff);

  const email = document.getElementById('admin-email').value.trim();
  state.adminEmail = email;

  const reportTime = document.getElementById('report-time').value;
  if (reportTime) state.reportTime = cleanCloudTimeStr(reportTime);

  const sheetUrl = document.getElementById('google-sheet-url').value.trim();
  state.googleSheetUrl = sheetUrl;

  saveState();
  populateSettingsUI(); // 立即同步更新所有標籤與介面
  pushSettingsToCloud(); // 🚀 同步推送到 Google 試算表雲端

  // 顯示儲存成功提示
  const msg = document.getElementById('save-settings-msg');
  if (msg) {
    msg.style.display = 'inline';
    msg.textContent = state.googleSheetUrl ? '✅ 設定已成功儲存並同步至雲端！' : '✅ 設定已儲存至本機！';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
}

function changePassword() {
  const pw = document.getElementById('new-password').value;
  if (pw.length < 4) { alert('密碼至少 4 個字元'); return; }
  state.adminPassword = pw;
  saveState();
  pushSettingsToCloud(); // 🚀 密碼也同步更新至雲端
  document.getElementById('new-password').value = '';
  alert('密碼已更新，並同步至雲端！');
}

function clearSelectedDayOrders() {
  const dayName = state.selectedAdminOrderDay === 0 ? "全部" : DAY_NAMES[state.selectedAdminOrderDay];
  if (!confirm(`確定清除 ${dayName} 的訂單？`)) return;

  const targetOrders = state.selectedAdminOrderDay === 0
    ? state.orders
    : state.orders.filter(o => o.dayOfWeek === state.selectedAdminOrderDay);
  const targetDateStr = targetOrders.length > 0 ? targetOrders[0].targetDateStr : null;

  if (state.selectedAdminOrderDay === 0) {
    state.orders = [];
  } else {
    state.orders = state.orders.filter(o => o.dayOfWeek !== state.selectedAdminOrderDay);
  }

  saveState();
  renderAdminPage();

  // 同步通知 Google 試算表刪除
  if (state.googleSheetUrl) {
    try {
      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: state.selectedAdminOrderDay === 0 ? 'clearAllOrders' : 'clearDayOrders',
          dayOfWeek: state.selectedAdminOrderDay,
          targetDateStr: targetDateStr
        })
      }).catch(e => console.log('雲端清除指定日訂單提示:', e));
    } catch(e) {}
  }
}

function clearWeeklyMenu() {
  if (!confirm('確定清除「週一至週五」全週菜單？')) return;
  const now = Date.now();
  state.weeklyMenu = { 1:[], 2:[], 3:[], 4:[], 5:[] };
  state.isManualMenu = true;
  state.menuUpdatedAt = now;
  state.menuClearedAt = now;
  state.menuValidWeekStart = ''; // 清空有效週，避免殘留舊週資訊
  saveState();
  renderAdminPage();

  // 同步通知雲端設定：菜單已由管理者清空
  if (state.googleSheetUrl) {
    try {
      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveSettings',
          settings: { menuClearedAt: now }
        })
      }).catch(e => console.log('雲端清空菜單提示:', e));
    } catch(e) {}
  }
}

function fullReset() {
  if (!confirm('確定全部重置（包含菜單、訂單）？此操作不可復原。')) return;
  const now = Date.now();
  state.weeklyMenu = { 1:[], 2:[], 3:[], 4:[], 5:[] };
  state.orders = [];
  state.isManualMenu = true;
  state.menuUpdatedAt = now;
  state.menuClearedAt = now;
  saveState();
  renderAdminPage();

  // 同步清空 Google 試算表全部訂單與設定菜單清空
  if (state.googleSheetUrl) {
    try {
      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clearAllOrders' })
      }).catch(e => console.log('雲端全部清空提示:', e));

      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveSettings',
          settings: { menuClearedAt: now }
        })
      }).catch(e => {});
    } catch(e) {}
  }
}

// ===================== EXPORT & REPORT =====================
function exportCSV() {
  const filteredOrders = getFilteredOrders();
  if (filteredOrders.length === 0) { alert('目前無訂單可匯出'); return; }
  const label = state.selectedAdminOrderDay === 0 ? "全部訂單" : DAY_NAMES[state.selectedAdminOrderDay];
  let csv = '\uFEFF預訂日期,星期,座號,餐點,價格,時間\n';
  filteredOrders.forEach(o => {
    csv += `"${o.targetDateStr}","${DAY_NAMES[o.dayOfWeek] || o.dayName || ''}",${o.seat},"${o.mealName}",${o.price},${o.time}\n`;
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  a.download = `訂單_${label}.csv`;
  a.click();
}

function sendReport() {
  const filteredOrders = getFilteredOrders();
  const label = state.selectedAdminOrderDay === 0 ? "全部訂單" : DAY_NAMES[state.selectedAdminOrderDay];
  const total = filteredOrders.reduce((s, o) => s + o.price, 0);
  const counts = {};
  const seats = {};
  filteredOrders.forEach(o => {
    counts[o.mealName] = (counts[o.mealName] || 0) + 1;
    if (!seats[o.mealName]) seats[o.mealName] = [];
    seats[o.mealName].push(o.seat);
  });
  let report = `📋 點餐統計回報 (${label})\n總訂單：${filteredOrders.length} 筆\n總金額：$${total}\n\n── 餐點統計 ──\n`;
  Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([n, c]) => {
    const seatList = (seats[n] || []).sort((a,b) => a-b).join('、');
    report += `${n} (${seatList}) ${c} 份\n`;
  });
  report += `\n── 詳細訂單 ──\n`;
  filteredOrders.forEach(o => {
    report += `[${o.targetDateStr}] 座號${o.seat} ${o.mealName} $${o.price}\n`;
  });
  document.getElementById('report-content').value = report;
  document.getElementById('report-modal').classList.add('show');
  if (state.adminEmail) {
    const subject = encodeURIComponent(`點餐回報 ${label}`);
    const body = encodeURIComponent(report);
    window.open(`mailto:${state.adminEmail}?subject=${subject}&body=${body}`);
  }
}

function copyReport() {
  const el = document.getElementById('report-content');
  el.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(el.value).then(() => alert('已複製到剪貼簿！'));
  } else {
    document.execCommand('copy');
    alert('已複製到剪貼簿！');
  }
}

async function sendCloudEmailNow() {
  if (!state.googleSheetUrl) {
    alert("尚未設定 Google 試算表 Web App 網址！\n請至「設定」頁面填寫。");
    return;
  }
  if (!state.adminEmail) {
    alert("尚未填寫管理者 Email！\n請先至「設定」頁面填寫管理者 Email 並儲存。");
    return;
  }
  const btn = document.getElementById('cloud-email-btn');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 發送中...';

  try {
    const filteredOrders = getFilteredOrders();
    let targetDateStr = null;
    if (filteredOrders.length > 0 && state.selectedAdminOrderDay !== 0) {
      targetDateStr = filteredOrders[0].targetDateStr;
    }
    
    await fetch(state.googleSheetUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendEmailNow',
        targetDateStr: targetDateStr
      })
    });

    alert(`✅ 已向 Google 試算表發出寄信指令！\n系統正由雲端發送至：${state.adminEmail}\n\n💡 提示：若第一次使用未收到，請先至 Google Apps Script 執行一次完成授權。`);
  } catch(e) {
    alert('寄信請求失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// ===================== CSV UPLOAD =====================
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.add('drag');
}
function handleDragLeave() {
  document.getElementById('upload-zone').classList.remove('drag');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
  e.target.value = '';
}

function processFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    alert('請上傳 CSV 格式檔案');
    return;
  }
  const status = document.getElementById('parse-status');
  status.style.display = 'block';
  status.style.background = 'var(--accent-light)';
  status.style.color = '#1E3A8A';
  status.textContent = `⏳ 正在讀取「${file.name}」...`;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      parseCSVMenu(e.target.result, file.name, status);
    } catch(err) {
      status.textContent = `❌ 解析失敗：${err.message}`;
      status.style.background = 'var(--danger-light)';
      status.style.color = 'var(--danger)';
    }
  };
  reader.onerror = function() {
    status.textContent = '❌ 檔案讀取失敗';
    status.style.background = 'var(--danger-light)';
    status.style.color = 'var(--danger)';
  };
  // Try UTF-8 first; handle BOM
  reader.readAsText(file, 'UTF-8');
}

// Map various day name formats to 1-5
function parseDayNumber(raw) {
  const s = raw.trim().toLowerCase().replace(/\s/g, '');
  const map = {
    '週一':1, '周一':1, '1':1, 'monday':1, 'mon':1,
    '週二':2, '周二':2, '2':2, 'tuesday':2, 'tue':2,
    '週三':3, '周三':3, '3':3, 'wednesday':3, 'wed':3,
    '週四':4, '周四':4, '4':4, 'thursday':4, 'thu':4,
    '週五':5, '周五':5, '5':5, 'friday':5, 'fri':5,
  };
  return map[s] || null;
}

function parseCSVMenu(text, fileName, status) {
  // Remove BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) throw new Error('CSV 檔案是空的');

  // Detect if first row is header (contains non-day keywords)
  let startIdx = 0;
  const firstCols = lines[0].split(',').map(c => c.trim());
  if (parseDayNumber(firstCols[0]) === null) {
    // Likely a header row, skip it
    startIdx = 1;
  }

  let totalAdded = 0;
  let errorRows = 0;
  const warns = [];

  for (let i = startIdx; i < lines.length; i++) {
    // Handle simple CSV (no quoted fields with commas)
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 3) { errorRows++; continue; }

    const dayNum = parseDayNumber(cols[0]);
    const name = cols[1].trim();
    const price = parseInt(cols[2]);

    if (dayNum === null) { warns.push(`第 ${i+1} 列：不認識的星期「${cols[0]}」`); errorRows++; continue; }
    if (!name) { errorRows++; continue; }

    if (!state.weeklyMenu[dayNum]) state.weeklyMenu[dayNum] = [];
    state.weeklyMenu[dayNum].push({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random(),
      name,
      price: isNaN(price) ? 0 : price
    });
    totalAdded++;
  }

  state.menuUpdatedAt = Date.now();
  state.menuClearedAt = 0; // 重設清空標記，恢復正常顯示
  state.menuValidWeekStart = getThisWeekMondayStr(); // 手動上傳菜單，有效週設為本週
  state.isManualMenu = true; // 鎖定保護：手動修改/上傳後，不受線上舊檔案影響
  saveState();
  renderMenuList();
  updateStats();

  if (state.googleSheetUrl) {
    try {
      fetch(state.googleSheetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveSettings',
          settings: { menuClearedAt: 0 }
        })
      }).catch(e => {});
    } catch(e) {}
  }

  if (totalAdded === 0) {
    status.textContent = `⚠️ 未能從「${fileName}」匯入任何餐點，請確認 CSV 格式正確。`;
    status.style.background = 'var(--warn-light)';
    status.style.color = 'var(--warn)';
  } else {
    let msg = `✅ 成功從「${fileName}」匯入 ${totalAdded} 項餐點！`;
    if (errorRows > 0) msg += `（${errorRows} 列格式異常已略過）`;
    status.textContent = msg;
    status.style.background = 'var(--success-light)';
    status.style.color = 'var(--success)';
  }
}

// ===================== AUTO LOAD MENU FROM GITHUB =====================
function isWeeklyMenuEmpty() {
  return ![1,2,3,4,5].some(d => state.weeklyMenu[d] && state.weeklyMenu[d].length > 0);
}

async function fetchOnlineMenu(force = false) {
  try {
    // 加上 timestamp 防止瀏覽器快取舊菜單
    const res = await fetch('./menu.json?t=' + Date.now());
    if (!res.ok) return;
    const onlineData = await res.json();
    if (!onlineData) return;

    // 支援直接是菜單物件，或是包含 timestamp 的封裝物件 { updatedAt: ..., validWeekStart: ..., menu: ... }
    const onlineUpdatedAt = Number(onlineData.updatedAt) || 0;
    const onlineValidWeekStart = onlineData.validWeekStart || '';
    const onlineMenu = onlineData.menu || onlineData;

    // 1. 若管理者已清空菜單，且線上沒有發布比清空時間更新的菜單，絕不載入
    if (!force && state.menuClearedAt && (!onlineUpdatedAt || state.menuClearedAt >= onlineUpdatedAt)) {
      return;
    }

    // 2. 如果本機已手動編輯過菜單，且線上的更新時間沒有更新，絕不覆蓋本機
    //    但若本機菜單是空的，不論如何都嘗試從線上載入
    const localIsEmpty = isWeeklyMenuEmpty();
    if (!force && !localIsEmpty && state.isManualMenu && (!onlineUpdatedAt || state.menuUpdatedAt >= onlineUpdatedAt)) {
      return;
    }

    // 檢查線上菜單是否至少包含一個星期的資料
    if (onlineMenu && (onlineMenu[1] || onlineMenu["週一"] || onlineMenu["monday"] || onlineMenu["1"])) {
      const mapped = { 1:[], 2:[], 3:[], 4:[], 5:[] };
      const dayKeys = {
        '1': 1, '週一': 1, '周一': 1, 'monday': 1,
        '2': 2, '週二': 2, '周二': 2, 'tuesday': 2,
        '3': 3, '週三': 3, '周三': 3, 'wednesday': 3,
        '4': 4, '週四': 4, '周四': 4, 'thursday': 4,
        '5': 5, '週五': 5, '周五': 5, 'friday': 5
      };

      let hasValidItems = false;
      for (const [key, items] of Object.entries(onlineMenu)) {
        const d = dayKeys[key.toLowerCase ? key.toLowerCase() : key];
        if (d && Array.isArray(items)) {
          mapped[d] = items.filter(it => it && it.name).map(it => ({
            id: it.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random()),
            name: it.name,
            price: Number(it.price) || 0
          }));
          if (mapped[d].length > 0) hasValidItems = true;
        }
      }

      // 只有當線上菜單確實有餐點時才覆蓋本機；如果線上是空的不覆蓋本機
      if (hasValidItems) {
        state.weeklyMenu = mapped;
        if (onlineUpdatedAt) state.menuUpdatedAt = onlineUpdatedAt;
        if (onlineValidWeekStart) state.menuValidWeekStart = onlineValidWeekStart;
        saveState();
        if (state.currentPage === 'user') renderUserPage();
        if (state.currentPage === 'admin') renderAdminPage();
      }
    }
  } catch (e) {
    // 網路錯誤或檔案不存在時，安全維持使用 localStorage
  }
}

function populateSettingsUI() {
  state.cutoffTime = cleanCloudTimeStr(state.cutoffTime);
  state.reportTime = cleanCloudTimeStr(state.reportTime);

  const seatEl = document.getElementById('seat-count');
  if (seatEl && state.seatCount) seatEl.value = state.seatCount;

  const cutoffEl = document.getElementById('cutoff-time');
  if (cutoffEl) cutoffEl.value = state.cutoffTime;

  const emailEl = document.getElementById('admin-email');
  if (emailEl && state.adminEmail !== undefined) emailEl.value = state.adminEmail;

  const reportEl = document.getElementById('report-time');
  if (reportEl) reportEl.value = state.reportTime;

  const sheetEl = document.getElementById('google-sheet-url');
  if (sheetEl && state.googleSheetUrl !== undefined) sheetEl.value = state.googleSheetUrl;

  // 同步更新網頁各處的時間與座位資訊顯示
  const userCutoff = document.getElementById('user-cutoff-display');
  if (userCutoff) userCutoff.textContent = state.cutoffTime;

  const adminCutoff = document.getElementById('admin-info-cutoff');
  if (adminCutoff) adminCutoff.textContent = state.cutoffTime;

  const adminReport = document.getElementById('admin-info-report');
  if (adminReport) adminReport.textContent = state.reportTime;
}

// ===================== INIT =====================
loadState();
populateSettingsUI(); // 啟動時立刻還原所有已儲存設定
renderUserPage();
fetchOnlineMenu(); // 自動同步線上最新菜單
syncOrdersFromCloud(false); // 🚀 每次進入網頁自動在背景載入雲端最新訂單

setInterval(() => {
  if (state.currentPage === 'user') renderUserPage();
}, 60000);

