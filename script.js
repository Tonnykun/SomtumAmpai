/* =========================================================
   ระบบบันทึกยอดขาย — script.js
   เชื่อมกับ Google Sheets ผ่าน Apps Script
   ========================================================= */

'use strict';

/* ──────────────────────────────────────────────────────────
   ★ ตั้งค่าตรงนี้
   วาง Apps Script Web App URL ที่ได้จาก Google
   ────────────────────────────────────────────────────────── */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzj_h3fjFqKmDsJhZ3QnLsBP2R5MIJm5JDOR72-11H7wxeYNeJxzBu4arl4WPD8RPUo1Q/exec";
//                       ↑ แทนด้วย URL จริงที่ได้จาก Deploy

/* ── Price Table ────────────────────────────────────────── */
const PRICE_TABLE = {
  store: {
    "ขนมจีน":             25,
    "ขนมจีนเปล่า":        5,
    "แคบหมู":              5,
    "ตำปูปลาร้า":         40,
    "ตำไทย":              40,
    "ตำแตงหมูยอ":         50,
    "ตำข้าวโพดไข่เค็ม":  60,
    "ตำถั่ว":             60,
    "ตำซั่ว":             50,
    "ตำมะม่วง":           30,
    "ยำหมูยอ":            50,
    "ยำคอหมูย่าง":        60,
    "น้ำแตงโมปั่น":       20,
    "น้ำสัปปะรดปั่น":     20,
    "น้ำส้มปั่น":         25,
    "น้ำมะพร้าวปั่น":     40,
  },
  grabfood: {
    "ขนมจีน":             35,
    "ขนมจีนเปล่า":        10,
    "แคบหมู":             10,
    "ตำปูปลาร้า":         50,
    "ตำไทย":              50,
    "ตำแตงหมูยอ":         60,
    "ตำข้าวโพดไข่เค็ม":  60,
    "ตำถั่ว":             69,
    "ตำซั่ว":             60,
    "ตำมะม่วง":           60,
    "ยำหมูยอ":            60,
    "ยำคอหมูย่าง":        60,
    "น้ำแตงโมปั่น":       30,
    "น้ำสัปปะรดปั่น":     30,
    "น้ำส้มปั่น":         40,
    "น้ำมะพร้าวปั่น":     50,
  }
};

/* ── State ──────────────────────────────────────────────── */
let currentBillItems = [];
let currentChannel   = "store";
let isLoading        = false;

/* ── DOM refs ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── Helpers ────────────────────────────────────────────── */
function getToday() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoney(amount) {
  return "฿" + Number(amount).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHTML(value = "") {
  const str = String(value ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function isTransientNetworkError(err) {
  const msg = String(err?.message || "");
  return (
    err instanceof TypeError ||
    /Failed to fetch|Load failed|NetworkError|fetch/i.test(msg)
  );
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryOnceOnNetworkError(task, delay = 900) {
  try {
    return await task();
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    await wait(delay);
    return await task();
  }
}

/* ── API Layer ──────────────────────────────────────────── */
async function apiFetchBills(params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getBills");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store"
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Apps Script ไม่ได้ส่ง JSON กลับมา");
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  if (!data.ok) {
    throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
  }

  return data.bills;
}

async function apiSaveBill(bill) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "saveBill", ...bill })
  });

  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error || "บันทึกไม่สำเร็จ");
    err.isDuplicate = data.isDuplicate || false;
    err.dupCount = data.duplicateCount || 1;
    throw err;
  }

  return data;
}

async function apiDeleteBill(id) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "deleteBill", id })
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "ลบไม่สำเร็จ");
  return data;
}

async function apiDeleteAll() {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "deleteAll" })
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "ลบไม่สำเร็จ");
  return data;
}

/* ── Loading helpers ────────────────────────────────────── */
function setLoading(state) {
  isLoading = state;
  document.querySelectorAll(".btn-primary, .btn-add").forEach(btn => {
    btn.disabled      = state;
    btn.style.opacity = state ? "0.6" : "1";
  });
}

function showTableLoading(tbodyId, cols) {
  $(tbodyId).innerHTML = `
    <tr class="empty-row">
      <td colspan="${cols}">
        <span class="loading-dots"><span></span><span></span><span></span></span>
      </td>
    </tr>
  `;
}

/* ── Toast ──────────────────────────────────────────────── */
function showToast(message, type = "success", duration = 2800) {
  const container = $("toastContainer");
  const toast     = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<div class="toast-dot"></div><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
  setTimeout(() => {
    toast.classList.add("hide");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

/* ── Confirm Dialog ─────────────────────────────────────── */
function showConfirm(message, onConfirm) {
  const existing = $("confirmOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "confirmOverlay";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99998;display:flex;align-items:center;
    justify-content:center;background:rgba(0,0,0,0.45);
    backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
    padding:16px;animation:fadeInOverlay .2s ease;
  `;
  const lines = message.split("\n").map(l => `<div>${l}</div>`).join("");
  overlay.innerHTML = `
    <style>
      @keyframes fadeInOverlay{from{opacity:0}to{opacity:1}}
      @keyframes slideUpDialog{from{transform:translateY(12px) scale(.97);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
    </style>
    <div style="background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,0.22);
      padding:24px 22px 18px;width:min(320px,100%);animation:slideUpDialog .22s cubic-bezier(.34,1.2,.64,1);">
      <div style="font-size:16px;font-weight:600;color:#1c1c1e;line-height:1.6;
        margin-bottom:18px;font-family:'Kanit',sans-serif;">${lines}</div>
      <div style="display:flex;gap:10px;">
        <button onclick="document.getElementById('confirmOverlay').remove()"
          style="flex:1;height:48px;border-radius:12px;border:1.5px solid rgba(0,0,0,0.1);
          background:#f2f2f7;color:#1c1c1e;font-size:16px;font-weight:600;cursor:pointer;
          font-family:'Kanit',sans-serif;">ยกเลิก</button>
        <button id="confirmOkBtn"
          style="flex:1;height:48px;border-radius:12px;border:none;background:#ff3b30;
          color:#fff;font-size:16px;font-weight:600;cursor:pointer;
          font-family:'Kanit',sans-serif;">ยืนยัน</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  $("confirmOkBtn").addEventListener("click", () => { overlay.remove(); onConfirm(); });
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

/* ── Channel ────────────────────────────────────────────── */
function setChannel(value) {
  currentChannel = value;
  $("salesChannel").value = value;
  document.querySelectorAll(".seg-btn").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.value === value)
  );
  renderFoodOptions();
  updatePriceDisplay();
}

/* ── Menu ───────────────────────────────────────────────── */
function renderFoodOptions() {
  const menuList = PRICE_TABLE[currentChannel] || {};
  const select   = $("foodItem");
  const current  = select.value;
  const options  = Object.keys(menuList)
    .map(name => `<option value="${name}"${name === current ? " selected" : ""}>${name}</option>`)
    .join("");
  select.innerHTML = `<option value="">-- เลือกเมนู --</option>${options}`;
  updatePriceDisplay();
}

function updatePriceDisplay() {
  const foodName = $("foodItem").value;
  const display  = $("itemPrice");
  if (!foodName) { display.textContent = "—"; display.style.color = ""; return; }
  const price = PRICE_TABLE[currentChannel]?.[foodName];
  if (price != null) {
    display.textContent = formatMoney(price);
    display.style.color = "var(--green-dark)";
  } else {
    display.textContent = "—";
    display.style.color = "";
  }
}

/* ── Qty ────────────────────────────────────────────────── */
function adjustQty(delta) {
  const input = $("itemQty");
  input.value = Math.max(1, (parseInt(input.value, 10) || 1) + delta);
}

/* ── Add item ───────────────────────────────────────────── */
function addItemToCurrentBill() {
  const foodName = $("foodItem").value;
  const qty      = parseInt($("itemQty").value, 10);
  if (!foodName)       { showToast("กรุณาเลือกรายการอาหาร", "warn"); return; }
  if (!qty || qty < 1) { showToast("กรุณากรอกจำนวนให้ถูกต้อง", "warn"); return; }
  const price = PRICE_TABLE[currentChannel]?.[foodName];
  if (price == null)   { showToast("ไม่พบราคาของเมนูนี้", "error"); return; }

  const existing = currentBillItems.find(
    i => i.foodName === foodName && i.channel === currentChannel
  );
  if (existing) {
    existing.qty      += qty;
    existing.lineTotal = existing.qty * existing.price;
    showToast(`${foodName} +${qty} (รวม ${existing.qty})`, "success");
  } else {
    currentBillItems.push({ channel: currentChannel, foodName, price, qty, lineTotal: price * qty });
    showToast(`เพิ่ม ${foodName} ×${qty}`, "success");
  }

  $("foodItem").value = "";
  $("itemQty").value  = 1;
  updatePriceDisplay();
  renderCurrentBill();
}

function removeCurrentBillItem(foodName) {
  currentBillItems = currentBillItems.filter(i => i.foodName !== foodName);
  renderCurrentBill();
  showToast(`ลบ ${foodName} แล้ว`, "warn");
}

function clearCurrentBill(askConfirm = true) {
  if (askConfirm && currentBillItems.length > 0) {
    showConfirm("ต้องการล้างรายการในบิลปัจจุบัน?", () => {
      currentBillItems = [];
      renderCurrentBill();
      showToast("ล้างบิลแล้ว", "warn");
    });
    return;
  }
  currentBillItems = [];
  renderCurrentBill();
}

/* ── Render current bill ────────────────────────────────── */
function renderCurrentBill() {
  const tbody = $("currentBillBody");
  if (!currentBillItems.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">ยังไม่มีรายการในบิลปัจจุบัน</td></tr>`;
  } else {
    tbody.innerHTML = currentBillItems.map(item => {
      const chClass = item.channel === "grabfood" ? "grab" : "store";
      const chLabel = item.channel === "grabfood" ? "Grab" : "ร้าน";
      return `
        <tr>
          <td>
            <span class="channel-tag channel-tag--${chClass}">${chLabel}</span>
            ${escapeHTML(item.foodName)}
          </td>
          <td class="num">${formatMoney(item.price)}</td>
          <td class="num">${item.qty}</td>
          <td class="num amount">${formatMoney(item.lineTotal)}</td>
          <td>
            <button class="btn-delete"
              onclick="removeCurrentBillItem('${item.foodName.replace(/'/g, "\\'")}')">✕</button>
          </td>
        </tr>
      `;
    }).join("");
  }
  $("draftLines").textContent = currentBillItems.length;
  $("draftQty").textContent   = currentBillItems.reduce((s, i) => s + i.qty, 0);
  $("draftTotal").textContent = formatMoney(currentBillItems.reduce((s, i) => s + i.lineTotal, 0));
}

/* ── Save bill → Google Sheet ───────────────────────────── */
async function saveCurrentBill() {
  if (isLoading) return;
  const date   = $("saleDate").value;
  const billNo = $("billNo").value.trim();
  if (!date)                    { showToast("กรุณาเลือกวันที่", "warn"); return; }
  if (!billNo)                  { showToast("กรุณากรอกเลขบิล", "warn"); return; }
  if (!currentBillItems.length) { showToast("กรุณาเพิ่มรายการอาหารก่อน", "warn"); return; }

  const totalAmount = currentBillItems.reduce((s, i) => s + i.lineTotal, 0);
  const bill = { id: makeId(), date, billNo, items: [...currentBillItems], totalAmount };

  setLoading(true);
  showToast("กำลังบันทึก...", "success", 60000);

  try {
    await retryOnceOnNetworkError(() => apiSaveBill(bill), 900);
    $("billNo").value = "";
    currentBillItems  = [];
    renderCurrentBill();
    await loadAndRenderSavedBills();
    await updateStats();
    document.querySelectorAll(".toast").forEach(t => t.remove());
    showToast(`บันทึกบิล ${billNo} สำเร็จ · ${formatMoney(totalAmount)}`, "success");
  } catch (err) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    if (err.isDuplicate) {
      showToast(`⚠️ บิล ${billNo} ซ้ำ! ส่งซ้ำครั้งที่ ${err.dupCount} — ดู Log ใน Sheet`, "error", 5000);
    } else {
      showToast(`บันทึกไม่สำเร็จ: ${err.message}`, "error", 4000);
    }
  } finally {
    setLoading(false);
  }
}

/* ── Delete bill ────────────────────────────────────────── */
function deleteBill(id) {
  showConfirm("ต้องการลบบิลนี้?", async () => {
    setLoading(true);
    try {
      await apiDeleteBill(id);
      await loadAndRenderSavedBills();
      await updateStats();
      showToast("ลบบิลแล้ว", "warn");
    } catch (err) {
      showToast(`ลบไม่สำเร็จ: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  });
}

/* ── Clear all ──────────────────────────────────────────── */
function clearAllBills() {
  showConfirm("ต้องการลบข้อมูลทั้งหมด?\nการกระทำนี้ไม่สามารถย้อนกลับได้", async () => {
    setLoading(true);
    try {
      await apiDeleteAll();
      currentBillItems  = [];
      $("billNo").value = "";
      renderCurrentBill();
      await loadAndRenderSavedBills();
      await updateStats();
      showToast("ลบข้อมูลทั้งหมดแล้ว", "warn");
    } catch (err) {
      showToast(`ลบไม่สำเร็จ: ${err.message}`, "error", 4000);
    } finally {
      setLoading(false);
    }
  });
}

/* ── Load saved bills from Sheet ────────────────────────── */
async function loadAndRenderSavedBills() {
  showTableLoading("savedBillsBody", 5);
  try {
    const bills = await apiFetchBills();
    renderSavedBills(bills);
  } catch (err) {
    $("savedBillsBody").innerHTML = `
      <tr class="empty-row">
        <td colspan="5" style="color:var(--red);">โหลดข้อมูลไม่สำเร็จ: ${err.message}</td>
      </tr>
    `;
  }
}

function renderSavedBills(bills) {
  const tbody = $("savedBillsBody");
  if (!bills || !bills.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">ยังไม่มีบิลที่บันทึกไว้</td></tr>`;
    return;
  }
  tbody.innerHTML = bills.map(bill => {
    const itemsHtml = bill.items.map(item => {
      const chClass = item.channel === "grabfood" ? "grab" : "store";
      const chLabel = item.channel === "grabfood" ? "Grab" : "ร้าน";
      return `
        <div class="food-line">
          <span class="channel-tag channel-tag--${chClass}">${chLabel}</span>
          ${escapeHTML(item.foodName)} ×${item.qty}
          <strong style="font-family:var(--font-mono);margin-left:4px;">${formatMoney(item.lineTotal)}</strong>
        </div>
      `;
    }).join("");
    return `
      <tr>
        <td style="font-family:var(--font-mono);font-size:13px;white-space:nowrap;">${bill.date}</td>
        <td><span class="bill-tag">${escapeHTML(bill.billNo)}</span></td>
        <td><div class="food-lines">${itemsHtml}</div></td>
        <td class="num amount">${formatMoney(bill.totalAmount)}</td>
        <td><button class="btn-delete" onclick="deleteBill(${bill.id})">✕</button></td>
      </tr>
    `;
  }).join("");
}

/* ── Stats (from Sheet) ─────────────────────────────────── */
async function updateStats() {
  try {
    const today      = getToday();
    const allBills   = await apiFetchBills();
    const todayBills = allBills.filter(b => b.date === today);
    const todaySales = todayBills.reduce((s, b) => s + b.totalAmount, 0);
    $("statTodayBills").textContent = todayBills.length;
    $("statTodaySales").textContent = todaySales > 0 ? formatMoney(todaySales) : "฿0";
    $("statTotalBills").textContent = allBills.length;
  } catch { /* ไม่ crash ถ้า stats ล้มเหลว */ }
}

/* ── Summary Modal ──────────────────────────────────────── */
async function showTodaySummary() {
  const selectedDate = $("summaryDate").value || getToday();
  $("slipDate").textContent = `วันที่ ${selectedDate}`;
  $("summaryBox").innerHTML = `
    <div style="text-align:center;padding:24px 0;">
      <span class="loading-dots"><span></span><span></span><span></span></span>
    </div>
  `;
  $("summaryModal").classList.add("show");
  document.body.style.overflow = "hidden";

  try {
    const bills = await apiFetchBills({ date: selectedDate });
    if (!bills.length) {
      $("summaryBox").innerHTML = `
        <div style="text-align:center;padding:24px 0;color:var(--text-tertiary);font-size:15px;">
          ไม่มีข้อมูลยอดขายของวันที่เลือก
        </div>
      `;
      return;
    }

    const totalSales = bills.reduce((s, b) => s + b.totalAmount, 0);
    const totalBills = bills.length;
    let   totalQty   = 0;
    const grouped    = {};

    bills.forEach(bill => {
      bill.items.forEach(item => {
        totalQty += item.qty;
        if (!grouped[item.foodName]) grouped[item.foodName] = { qty: 0, amount: 0 };
        grouped[item.foodName].qty    += item.qty;
        grouped[item.foodName].amount += item.lineTotal;
      });
    });

    const menuItems = Object.entries(grouped)
      .sort((a, b) => b[1].qty - a[1].qty)
      .map(([name, data]) => `
        <div class="slip-menu-item">
          <span>${escapeHTML(name)} <span style="color:var(--text-tertiary);">×${data.qty}</span></span>
          <strong>${formatMoney(data.amount)}</strong>
        </div>
      `).join("");

    $("summaryBox").innerHTML = `
      <div class="slip-row slip-row--total">
        <span>ยอดขายรวม</span><strong>${formatMoney(totalSales)}</strong>
      </div>
      <div class="slip-row">
        <span>จำนวนบิล</span>
        <span style="font-family:var(--font-mono);font-weight:700;">${totalBills} บิล</span>
      </div>
      <div class="slip-row">
        <span>จำนวนที่ขายทั้งหมด</span>
        <span style="font-family:var(--font-mono);font-weight:700;">${totalQty} รายการ</span>
      </div>
      <hr class="slip-divider"/>
      <div class="slip-section-title">สรุปตามเมนู</div>
      <div class="slip-menu-list">${menuItems}</div>
    `;
  } catch (err) {
    $("summaryBox").innerHTML = `
      <div style="color:var(--red);padding:16px 0;font-size:14px;">โหลดข้อมูลไม่สำเร็จ: ${err.message}</div>
    `;
  }
}

function closeSummaryModal() {
  $("summaryModal").classList.remove("show");
  document.body.style.overflow = "";
}

function handleBackdropClick(e) {
  if (e.target === $("summaryModal")) closeSummaryModal();
}

/* ── Init ───────────────────────────────────────────────── */
async function initializeApp() {
  const today = getToday();
  $("saleDate").value         = today;
  $("summaryDate").value      = today;
  $("todayBadge").textContent = today;

  renderFoodOptions();
  renderCurrentBill();

  showTableLoading("savedBillsBody", 5);
  try {
    const bills = await apiFetchBills();
    renderSavedBills(bills);
    await updateStats();
    } catch (err) {
    console.error("initializeApp error:", err);

    $("savedBillsBody").innerHTML = `
        <tr class="empty-row">
        <td colspan="5" style="color:var(--red);">
            ⚠️ โหลดข้อมูลไม่สำเร็จ: ${err.message}
        </td>
        </tr>
    `;
    }

  $("foodItem").addEventListener("change", updatePriceDisplay);
  $("salesChannel").addEventListener("change", () => {
    currentChannel = $("salesChannel").value;
    renderFoodOptions();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeSummaryModal();
  });
}

document.addEventListener("DOMContentLoaded", initializeApp);
