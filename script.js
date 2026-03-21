import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, push, onValue, update, get, remove }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ════════════════════════════════════════════════════════
//  🔥 YOUR FIREBASE CONFIG
// ════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyDQRUbLUevDjKEw-aiivrPvD6EnubVhRAc",
  authDomain: "afl-auction.firebaseapp.com",
  databaseURL: "https://afl-auction-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "afl-auction",
  storageBucket: "afl-auction.firebasestorage.app",
  messagingSenderId: "468307928384",
  appId: "1:468307928384:web:a719f87a0ae046290946a5"
};

// ─── INIT ─────────────────────────────────────────────
let db = null;
let demoMode = false;
let demoItems = {};
let demoHistory = [];
let historyCache = {};

try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  setupFirebaseListeners();
} catch(e) {
  demoMode = true;
  document.getElementById('fb-warning').classList.add('show');
  setupDemoMode();
}

// ─── STATE ────────────────────────────────────────────
let currentUser = localStorage.getItem('auction_name') || null;
let globalTicker = null;
let activeEndTimes = {};
const photoCache = {}; // id -> array of base64 dataURLs

// ─── NAME GATE ────────────────────────────────────────
window.joinAuction = function() {
  const v = document.getElementById('name-input').value.trim();
  if (!v) { toast('Önce isminizi gir', 'error'); return; }
  currentUser = v;
  localStorage.setItem('auction_name', v);
  document.getElementById('name-gate').style.display = 'none';
  updateNavUser();
};

window.changeName = function() {
  currentUser = null;
  localStorage.removeItem('auction_name');
  document.getElementById('name-gate').style.display = 'flex';
  document.getElementById('name-input').value = '';
};

if (currentUser) {
  document.getElementById('name-gate').style.display = 'none';
  updateNavUser();
}

function updateNavUser() {
  document.getElementById('nav-name').textContent = currentUser;
  document.getElementById('nav-avatar').textContent = currentUser.charAt(0).toUpperCase();
}

// ─── TABS ─────────────────────────────────────────────
window.showTab = function(tab) {
  ['live','add','history'].forEach(t => {
    document.getElementById('tab-'+t).style.display = t === tab ? '' : 'none';
    document.querySelectorAll('.tab')[['live','add','history'].indexOf(t)].classList.toggle('active', t===tab);
  });
  if (tab === 'history') renderHistory();
};

// ─── FIREBASE ─────────────────────────────────────────
function setupFirebaseListeners() {
  onValue(ref(db, 'items'), snap => {
    const data = snap.val() || {};
    renderItems(data);
    Object.entries(data).forEach(([id, item]) => {
      if (item.status === 'active' && item.endTime && !activeEndTimes[id]) {
        registerTimer(id, item.endTime);
      }
    });
  });

  onValue(ref(db, 'history'), snap => {
    historyCache = snap.val() || {};
    renderHistory();
    cleanupExpired(snap.val() || {});
  });
}

// ─── CLEANUP EXPIRED ──────────────────────────────────
const EXPIRE_MS = 24 * 60 * 60 * 1000; // 24 hours

function cleanupExpired(historyData) {
  const now = Date.now();
  Object.entries(historyData).forEach(([id, item]) => {
    if (item.soldAt && (now - item.soldAt) > EXPIRE_MS) {
      remove(ref(db, 'history/' + id));

    }
  });
}

// ─── DEMO MODE ────────────────────────────────────────
function setupDemoMode() {
  renderItems(demoItems);
}

// ─── ADD ITEM ─────────────────────────────────────────
// ─── COMPRESS IMAGE ───────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function compressImage(file, maxW=1200, quality=0.75) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

window.addItem = async function() {
  if (!currentUser) { toast('Önce isim gir', 'error'); return; }
  const name = document.getElementById('item-name').value.trim();
  const desc = document.getElementById('item-desc').value.trim();
  const city = document.getElementById('item-city').value.trim();
  const district = document.getElementById('item-district').value.trim();
  const start = parseFloat(document.getElementById('item-start').value) || 0;
  const seconds = 24 * 3600; // 24 saat sabit
  const fileInput = document.getElementById('item-photo');
  const files = fileInput ? Array.from(fileInput.files) : [];
  if (!name) { toast('Ürün adı gerekli', 'error'); return; }

  const btn = document.querySelector('#tab-add .btn-gold');
  btn.disabled = true;
  btn.textContent = files.length ? 'Yükleniyor...' : 'Ekleniyor...';

  let photos = [];
  for (const file of files) {
    try {
      const compressed = await compressImage(file);
      const b64 = await blobToBase64(compressed);
      photos.push(b64);
    } catch(e) {
      toast('Bir fotoğraf işlenemedi, atlanıyor', 'error');
    }
  }

  const endTime = Date.now() + seconds * 1000;
  const item = {
    name, desc, startPrice: start, currentPrice: start,
    duration: seconds, status: 'active', endTime, bidCount: 0,
    topBidder: null, createdBy: currentUser, createdAt: Date.now(),
    photos: photos.length ? photos : null,
    city: city || null,
    district: district || null
  };

  if (demoMode) {
    const id = 'demo_' + Date.now();
    const demoCount = Object.keys(demoItems).length + Object.values(historyCache).length + 1;
    demoItems[id] = { ...item, itemNumber: demoCount };
    renderItems(demoItems);
    registerTimer(id, endTime);
  } else {
    get(ref(db, 'meta/itemCounter')).then(snap => {
      const next = (snap.val() || 0) + 1;
      update(ref(db, 'meta'), { itemCounter: next });
      push(ref(db, 'items'), { ...item, itemNumber: next });
    });
  }

  ['item-name','item-desc','item-start','item-city','item-district'].forEach(id => document.getElementById(id).value = '');

  if (fileInput) fileInput.value = '';
  document.getElementById('photo-preview-wrap').innerHTML = '';
  btn.disabled = false;
  btn.textContent = 'Mezata Ekle';
  showTab('live');
  toast('Ürün eklendi! Mezat başladı.', 'success');
};

// ─── RENDER ITEMS ─────────────────────────────────────
function renderItems(data) {
  const grid = document.getElementById('items-grid');
  const ids = Object.keys(data).filter(id => data[id].status !== 'sold');
  document.getElementById('item-count').textContent = ids.length ? `${ids.length} ürün` : '';

  if (!ids.length) {
    grid.innerHTML = `<div class="empty"><div class="big">📦</div><h3>Aktif ürün yok</h3><p>Mezatı başlatmak için ürün ekle</p></div>`;
    return;
  }

  ids.sort((a,b) => {
    const sa = data[a].status, sb = data[b].status;
    // active items first, sorted by endTime ascending (least time left = top)
    if (sa === 'active' && sb === 'active') {
      return (data[a].endTime || 0) - (data[b].endTime || 0);
    }
    const order = {active:0, waiting:1};
    return (order[sa]||2) - (order[sb]||2);
  });

  ids.forEach(id => { if (data[id].photos) photoCache[id] = data[id].photos; });
  grid.innerHTML = ids.map(id => buildCard(id, data[id])).join('');

  ids.forEach(id => {
    const item = data[id];
    const bidBtn = document.getElementById('bid-btn-'+id);
    if (bidBtn) bidBtn.onclick = () => placeBid(id, item);


    if (item.status === 'active' && item.endTime && !activeEndTimes[id]) {
      registerTimer(id, item.endTime);
    }
  });
}

function buildCard(id, item) {
  const isActive = item.status === 'active';
  const isWaiting = item.status === 'waiting';
  const price = item.currentPrice;
  const currency = '₺';
  let statusBadge, timerHtml, actionHtml;

  if (isActive) {
    statusBadge = `<span class="status-badge badge-active">● Canlı</span>`;
    const secsLeft = item.endTime ? Math.max(0, Math.ceil((item.endTime - Date.now()) / 1000)) : item.duration;
    timerHtml = `<span class="timer${secsLeft <= 10 ? ' urgent' : ''}" id="timer-${id}">${fmtTime(secsLeft)}</span>`;
    actionHtml = `
      <div class="bid-row">
        <input type="number" id="bid-input-${id}" placeholder="min. ₺${fmt(item.currentPrice + 50)}" min="${item.currentPrice + 50}" step="any">
        <button class="btn btn-gold btn-sm" id="bid-btn-${id}">Teklif Ver</button>
      </div>`;
  } else if (isWaiting) {
    statusBadge = `<span class="status-badge badge-waiting">Bekliyor</span>`;
    timerHtml = `<span style="font-family:'DM Mono',monospace;font-size:14px;color:var(--text3);">${fmtTime(item.duration)}</span>`;
    actionHtml = '';
  } else {
    statusBadge = `<span class="status-badge badge-sold">Satıldı</span>`;
    timerHtml = `<span style="font-family:'DM Mono',monospace;font-size:14px;color:var(--text3);">—</span>`;
    actionHtml = '';
  }

  const topBidderLine = item.topBidder
    ? `<div class="top-bidder">🥇 <span class="name">${esc(item.topBidder)}</span> kazanıyor</div>`
    : `<div class="top-bidder" style="color:var(--text3)">Henüz teklif yok</div>`;

  const photos = item.photos || (item.photoURL ? [item.photoURL] : []);
  const photoThumb = photos.length
    ? `<div class="card-thumb" id="thumb-${id}">
        <img src="${photos[0]}" alt="${esc(item.name)}" id="thumb-img-${id}">
        ${photos.length > 1 ? `
        <button class="thumb-nav thumb-prev" onclick="slideThumb(event,'${id}',-1)">&#8249;</button>
        <button class="thumb-nav thumb-next" onclick="slideThumb(event,'${id}',1)">&#8250;</button>
        <div class="thumb-dots" id="thumb-dots-${id}">
          ${photos.map((_,i) => `<span class="thumb-dot${i===0?' active':''}" onclick="goThumb(event,'${id}',${i})"></span>`).join('')}
        </div>` : ''}
        <div class="card-thumb-overlay" onclick="openPhoto('${id}',0)">🔍</div>
      </div>`
    : '';

  return `
  <div class="item-card ${isActive?'active':''}" id="card-${id}">
    <div class="card-header">
      ${photoThumb}
      <div class="card-status">${statusBadge}${timerHtml}</div>
      <div style="display:flex;align-items:baseline;gap:8px;">
        <div class="card-title">${esc(item.name)}</div>
        ${item.itemNumber ? `<span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">#${String(item.itemNumber).padStart(3,'0')}</span>` : ''}
      </div>
      ${item.city ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;">📍 ${esc(item.city)}${item.district ? ' / '+esc(item.district) : ''}</div>` : ''}
      ${item.desc ? `<div class="card-desc">${esc(item.desc)}</div>` : ''}
    </div>
    <div class="card-body">
      <div class="price-row">
        <div class="price-current">${currency}${fmt(price)}</div>
        ${price > item.startPrice ? `<div class="price-start">başlangıç: ${currency}${fmt(item.startPrice)}</div>` : `<div class="price-start">başlangıç fiyatı</div>`}
      </div>
      ${topBidderLine}
      ${actionHtml}
    </div>
    <div class="card-footer">
      <span class="bid-count">${item.bidCount || 0} teklif</span>
      <div style="display:flex;align-items:center;gap:8px;">
        ${item.createdBy ? `<span style="font-size:11px;color:var(--text3);">ekleyen: ${esc(item.createdBy)}</span>` : ''}
        <button class="btn-delete" data-delete-id="${id}" title="Ürünü sil">✕</button>
      </div>
    </div>
  </div>`;
}

// ─── TIMER ────────────────────────────────────────────
function registerTimer(id, endTime) {
  activeEndTimes[id] = endTime;
  if (!globalTicker) {
    globalTicker = setInterval(tickAll, 500);
  }
}

function unregisterTimer(id) {
  delete activeEndTimes[id];
  if (Object.keys(activeEndTimes).length === 0 && globalTicker) {
    clearInterval(globalTicker);
    globalTicker = null;
  }
}

function tickAll() {
  const now = Date.now();
  for (const [id, endTime] of Object.entries(activeEndTimes)) {
    const msLeft = endTime - now;
    const secsLeft = Math.max(0, Math.ceil(msLeft / 1000));
    const el = document.getElementById('timer-' + id);
    if (el) {
      el.textContent = fmtTime(secsLeft);
      el.className = 'timer' + (secsLeft <= 10 ? ' urgent' : '');
    }
    if (msLeft <= 0) {
      unregisterTimer(id);
      endItem(id);
    }
  }
}

// ─── START ITEM ───────────────────────────────────────
function startItem(id, item) {
  const endTime = Date.now() + item.duration * 1000;
  const update_data = { status: 'active', endTime };
  if (demoMode) {
    demoItems[id] = { ...demoItems[id], ...update_data };
    renderItems(demoItems);
    registerTimer(id, endTime);
  } else {
    update(ref(db, 'items/'+id), update_data);
  }
  toast(`"${item.name}" başladı!`, 'success'); // kept for legacy waiting items
}

// ─── END ITEM ─────────────────────────────────────────
function endItem(id) {
  if (demoMode) {
    const item = demoItems[id];
    if (!item || item.status === 'sold') return;
    demoItems[id].status = 'sold';
    demoHistory.push({ ...item, soldAt: Date.now() });
    if (item.topBidder) {
      toast(`🔨 Satıldı! ${item.name} → ${item.topBidder} — ₺${fmt(item.currentPrice)}`, 'success');
    } else {
      toast(`"${item.name}" teklif gelmeden sona erdi.`);
    }
    renderItems(demoItems);
    return;
  }

  get(ref(db, 'items/'+id)).then(snap => {
    const item = snap.val();
    if (!item || item.status === 'sold') return;
    update(ref(db, 'items/'+id), { status: 'sold' });
    push(ref(db, 'history'), { ...item, soldAt: Date.now() });
    if (item.topBidder) {
      toast(`🔨 Satıldı! ${item.name} → ${item.topBidder} — ₺${fmt(item.currentPrice)}`, 'success');
    } else {
      toast(`"${item.name}" teklif gelmeden sona erdi.`);
    }
  });
}

// ─── PLACE BID ────────────────────────────────────────
window.placeBid = function(id, item) {
  if (!currentUser) { toast('Önce isim gir', 'error'); return; }
  const input = document.getElementById('bid-input-'+id);
  const amount = parseFloat(input.value);
  if (!amount || amount < item.currentPrice + 50) {
    toast(`Teklif en az ₺${fmt(item.currentPrice + 50)} olmalı (+50₺)`, 'error');
    return;
  }

  const updates = {
    currentPrice: amount,
    topBidder: currentUser,
    bidCount: (item.bidCount || 0) + 1
  };

  if (demoMode) {
    demoItems[id] = { ...demoItems[id], ...updates };
    renderItems(demoItems);
  } else {
    update(ref(db, 'items/'+id), updates);
  }

  input.value = '';
  toast(`₺${fmt(amount)} teklif verildi!`, 'success');
};

// ─── HISTORY ──────────────────────────────────────────
let lastHistoryItems = [];
let historyItemIds = []; // Firebase keys for deletion

function renderHistory() {
  const list = document.getElementById('history-list');
  let items = [];
  let ids = [];

  if (demoMode) {
    items = [...demoHistory].reverse();
    ids = items.map((_,i) => 'demo_h_'+i);
  } else {
    const entries = Object.entries(historyCache).sort((a,b) => b[1].soldAt - a[1].soldAt);
    ids = entries.map(e => e[0]);
    items = entries.map(e => e[1]);
  }

  lastHistoryItems = items;
  historyItemIds = ids;

  // Cache photos for detail modal
  items.forEach((item, i) => {
    const hid = 'h_' + i;
    if (item.photos) photoCache[hid] = item.photos;
    else if (item.photoURL) photoCache[hid] = [item.photoURL];
  });

  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="big">🏆</div><h3>Henüz satış yok</h3><p>Tamamlanan mezatlar burada görünecek</p></div>`;
    return;
  }

  list.innerHTML = items.map((item, i) => `
    <div class="history-card" data-detail-idx="${i}" style="cursor:pointer;">
      <div class="history-num">#${String(item.itemNumber || (i+1)).padStart(3,'0')}</div>
      <div class="history-info">
        <div class="history-name">${esc(item.name)}</div>
        <div class="history-winner">
          ${item.topBidder ? `Kazanan: <span>${esc(item.topBidder)}</span>` : 'Kazanan yok'}
          · ${new Date(item.soldAt).toLocaleTimeString('tr-TR')}
          ${item.city ? `· ${esc(item.city)}${item.district ? ' / '+esc(item.district) : ''}` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <div class="history-price">${item.topBidder ? '₺'+fmt(item.currentPrice) : '—'}</div>
        <button class="btn-delete" data-history-idx="${i}" title="Geçmişten sil">✕</button>
      </div>
    </div>
  `).join('');
}

// ─── DETAIL MODAL ─────────────────────────────────────
window.openDetail = function(idx) {
  const item = lastHistoryItems[idx];
  if (!item) return;
  const hid = 'h_' + idx;
  const photos = photoCache[hid] || [];

  const photoSlider = photos.length ? `
    <div style="position:relative;width:100%;height:220px;overflow:hidden;border-radius:12px 12px 0 0;">
      <img id="detail-slide-img" src="${photos[0]}" style="width:100%;height:100%;object-fit:cover;">
      ${photos.length > 1 ? `
        <button onclick="detailSlide(-1)" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:24px;width:36px;height:36px;border-radius:50%;cursor:pointer;">&#8249;</button>
        <button onclick="detailSlide(1)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:24px;width:36px;height:36px;border-radius:50%;cursor:pointer;">&#8250;</button>
        <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.5);color:#fff;font-size:11px;padding:2px 8px;border-radius:999px;" id="detail-slide-count">1 / ${photos.length}</div>
      ` : ''}
    </div>` : '';

  document.getElementById('detail-content').innerHTML = `
    ${photoSlider}
    <div style="padding:24px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-family:'DM Serif Display',serif;font-size:22px;margin-bottom:4px;">${esc(item.name)}</div>
          ${item.desc ? `<div style="font-size:13px;color:var(--text2);margin-bottom:4px;">${esc(item.desc)}</div>` : ''}
          ${item.city ? `<div style="font-size:12px;color:var(--text3);">📍 ${esc(item.city)}${item.district ? ' / '+esc(item.district) : ''}</div>` : ''}
        </div>
        <button onclick="closeDetail()" style="background:transparent;border:1px solid var(--border);color:var(--text2);border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px;flex-shrink:0;">✕</button>
      </div>
      <div style="background:var(--surface);border-radius:10px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Kazanan</div>
            <div style="font-size:18px;font-weight:500;color:var(--gold3);">${item.topBidder ? esc(item.topBidder) : 'Kazanan yok'}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Son Fiyat</div>
            <div style="font-family:'DM Serif Display',serif;font-size:26px;color:var(--gold2);">${item.topBidder ? '₺'+fmt(item.currentPrice) : '—'}</div>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);">
        <span>Başlangıç: ₺${fmt(item.startPrice)}</span>
        <span>${item.bidCount || 0} teklif</span>
        <span>${new Date(item.soldAt).toLocaleString('tr-TR')}</span>
      </div>
      ${item.createdBy ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;">ekleyen: ${esc(item.createdBy)}</div>` : ''}
    </div>
  `;

  // Store current photos for slider
  window._detailPhotos = photos;
  window._detailPhotoIdx = 0;
  document.getElementById('detail-modal').style.display = 'flex';
};

window.detailSlide = function(dir) {
  const photos = window._detailPhotos || [];
  if (!photos.length) return;
  window._detailPhotoIdx = (window._detailPhotoIdx + dir + photos.length) % photos.length;
  const img = document.getElementById('detail-slide-img');
  const count = document.getElementById('detail-slide-count');
  if (img) img.src = photos[window._detailPhotoIdx];
  if (count) count.textContent = `${window._detailPhotoIdx + 1} / ${photos.length}`;
};

window.closeDetail = function() {
  document.getElementById('detail-modal').style.display = 'none';
};

// ─── LIGHTBOX ─────────────────────────────────────────
let lightboxPhotos = [];
let lightboxIndex = 0;

window.openPhoto = function(id, idx) {
  const photos = photoCache[id];
  if (!photos || !photos.length) return;
  lightboxPhotos = Array.isArray(photos) ? photos : [photos];
  lightboxIndex = idx || 0;
  showLightboxPhoto();
  document.getElementById('lightbox').style.display = 'flex';
};

function showLightboxPhoto() {
  document.getElementById('lightbox-img').src = lightboxPhotos[lightboxIndex];
  const counter = document.getElementById('lightbox-counter');
  if (counter) {
    counter.textContent = lightboxPhotos.length > 1 ? `${lightboxIndex + 1} / ${lightboxPhotos.length}` : '';
  }
}

window.lightboxNav = function(e, dir) {
  e.stopPropagation();
  lightboxIndex = (lightboxIndex + dir + lightboxPhotos.length) % lightboxPhotos.length;
  showLightboxPhoto();
};

window.slideThumb = function(e, id, dir) {
  e.stopPropagation();
  const photos = photoCache[id];
  if (!photos) return;
  const img = document.getElementById('thumb-img-' + id);
  const dots = document.getElementById('thumb-dots-' + id);
  if (!img) return;
  const current = parseInt(img.dataset.idx || '0');
  const idx = (current + dir + photos.length) % photos.length;
  img.src = photos[idx];
  img.dataset.idx = idx;
  if (dots) {
    dots.querySelectorAll('.thumb-dot').forEach((d,i) => d.classList.toggle('active', i === idx));
  }
};

window.goThumb = function(e, id, idx) {
  e.stopPropagation();
  const photos = photoCache[id];
  if (!photos) return;
  const img = document.getElementById('thumb-img-' + id);
  const dots = document.getElementById('thumb-dots-' + id);
  if (img) { img.src = photos[idx]; img.dataset.idx = idx; }
  if (dots) {
    dots.querySelectorAll('.thumb-dot').forEach((d,i) => d.classList.toggle('active', i === idx));
  }
};
window.closeLightbox = function() {
  document.getElementById('lightbox').style.display = 'none';
};



// ─── HELPERS ──────────────────────────────────────────
function fmtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(Math.max(0,sec)).padStart(2,'0')}`;
}
function fmt(n) {
  return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.toast = function(msg, type='') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
};

document.getElementById('name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.joinAuction();
});

// ─── EVENT DELEGATION ─────────────────────────────────
document.addEventListener('click', e => {
  // Delete active item
  const delBtn = e.target.closest('[data-delete-id]');
  if (delBtn) {
    e.stopPropagation();
    const id = delBtn.dataset.deleteId;
    showConfirm('Bu ürün silinsin mi?', () => {
      if (demoMode) {
        delete demoItems[id];
        renderItems(demoItems);
      } else {
        remove(ref(db, 'items/' + id));
      }
      toast('Ürün silindi.');
    });
    return;
  }

  // Delete history item
  const histDel = e.target.closest('[data-history-idx]');
  if (histDel) {
    e.stopPropagation();
    const idx = parseInt(histDel.dataset.historyIdx);
    const item = lastHistoryItems[idx];
    if (!item) return;
    showConfirm(`"${item.name}" geçmişten silinsin mi?`, () => {
      if (demoMode) {
        demoHistory.splice(demoHistory.length - 1 - idx, 1);
        renderHistory();
      } else {
        const fbId = historyItemIds[idx];
        if (fbId) remove(ref(db, 'history/' + fbId));
      }
      toast('Geçmişten silindi.');
    });
    return;
  }

  // Open history detail
  const histCard = e.target.closest('[data-detail-idx]');
  if (histCard && !e.target.closest('[data-history-idx]')) {
    const idx = parseInt(histCard.dataset.detailIdx);
    openDetail(idx);
    return;
  }
});

// ─── CUSTOM CONFIRM ───────────────────────────────────
const DELETE_PASSWORD = 'aflsil';

function showConfirm(msg, onYes) {
  const existing = document.getElementById('custom-confirm');
  if (existing) existing.remove();

  const box = document.createElement('div');
  box.id = 'custom-confirm';
  box.style.cssText = 'position:fixed;bottom:80px;right:24px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px 20px;z-index:9999;min-width:260px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
  box.innerHTML = `
    <div style="font-size:13px;color:var(--text);margin-bottom:10px;">${msg}</div>
    <input id="confirm-pw" type="password" placeholder="Şifre..." style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:13px;padding:7px 10px;outline:none;margin-bottom:10px;">
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="confirm-no" style="padding:6px 14px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px;">İptal</button>
      <button id="confirm-yes" style="padding:6px 14px;border-radius:7px;border:none;background:var(--red);color:#fff;cursor:pointer;font-size:12px;font-weight:500;">Sil</button>
    </div>
  `;
  document.body.appendChild(box);

  const pw = document.getElementById('confirm-pw');
  const yes = document.getElementById('confirm-yes');
  const no = document.getElementById('confirm-no');

  pw.focus();
  pw.addEventListener('keydown', e => {
    if (e.key === 'Enter') yes.click();
    if (e.key === 'Escape') { box.remove(); }
  });

  yes.onclick = () => {
    if (pw.value !== DELETE_PASSWORD) {
      pw.style.borderColor = 'var(--red)';
      pw.value = '';
      pw.placeholder = 'Yanlış şifre!';
      pw.focus();
      return;
    }
    box.remove();
    onYes();
  };
  no.onclick = () => box.remove();

  setTimeout(() => { if (box.parentNode) box.remove(); }, 10000);
}

window.previewPhoto = function(input) {
  const wrap = document.getElementById('photo-preview-wrap');
  wrap.innerHTML = '';
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border);';
      wrap.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
};