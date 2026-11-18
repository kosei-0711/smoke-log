/* =========================================================
   スモークログ  app.js
   - データは localStorage に保存
   - グラフは Chart.js（sw.js がキャッシュするのでオフラインでも表示）
   ========================================================= */
'use strict';

/* ---------- 定数・初期値 ---------- */
const STORAGE_KEY = 'smokeLog.v1';
const APP_ID = 'smoke-log';
const DATA_VERSION = 1;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const DEFAULT_SETTINGS = {
  goal: 10,        // 1日の目標本数（0で目標なし）
  packPrice: 600,  // 1箱の値段（円）
  perPack: 20,     // 1箱の本数
  dayStart: 0,     // 1日の区切り時刻（0〜6時）
  vibrate: true,   // 振動ON/OFF
  brandName: 'マルボロ・メンソール', // 銘柄名
  spin: true       // 箱を回転させるか
};

// 銘柄画像（写真はサイズが大きいので記録データとは別のキーに保存）
const BRAND_IMG_KEY = 'smokeLog.brandImage';
const DEFAULT_BRAND_IMAGE = {
  src: 'img/pack-menthol.svg',
  side: '#0d6e52',   // 箱の側面の色
  top: '#f3f6f5',    // 箱の上面の色
  custom: false
};

/* ---------- 状態 ---------- */
// records は「記録した時刻（ミリ秒）」の配列。古い順に並べる。
let state = load();
let brandImage = loadBrandImage();
let chart = null;
let chartRange = 7;
let currentView = 'home';
let lastTapAt = 0;
let lastMinusAt = 0;
let toastTimer = null;
let renderedDayKey = '';

/* ---------- 要素 ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  headerDate: $('headerDate'),
  todayCount: $('todayCount'),
  goalWrap: $('goalWrap'),
  goalFill: $('goalFill'),
  goalText: $('goalText'),
  sinceLast: $('sinceLast'),
  yesterdaySameTime: $('yesterdaySameTime'),
  todayCost: $('todayCost'),
  plusBtn: $('plusBtn'),
  minusBtn: $('minusBtn'),
  packScene: $('packScene'),
  packBoost: $('packBoost'),
  pack: $('pack'),
  packImgs: document.querySelectorAll('.pack-img'),
  brandName: $('brandName'),
  brandSub: $('brandSub'),
  setBrandName: $('setBrandName'),
  brandThumb: $('brandThumb'),
  brandImgBtn: $('brandImgBtn'),
  brandResetBtn: $('brandResetBtn'),
  brandFile: $('brandFile'),
  setSpin: $('setSpin'),
  chartCanvas: $('chart'),
  chartFallback: $('chartFallback'),
  statTotal: $('statTotal'),
  statAvg: $('statAvg'),
  statGoal: $('statGoal'),
  statCost: $('statCost'),
  addPastForm: $('addPastForm'),
  pastTime: $('pastTime'),
  dayList: $('dayList'),
  emptyHistory: $('emptyHistory'),
  setGoal: $('setGoal'),
  setPackPrice: $('setPackPrice'),
  setPerPack: $('setPerPack'),
  setDayStart: $('setDayStart'),
  setVibrate: $('setVibrate'),
  lastBackup: $('lastBackup'),
  backupBtn: $('backupBtn'),
  restoreBtn: $('restoreBtn'),
  restoreFile: $('restoreFile'),
  clearBtn: $('clearBtn'),
  dataSummary: $('dataSummary'),
  toast: $('toast'),
  toastText: $('toastText'),
  toastAction: $('toastAction')
};

/* =========================================================
   保存・読み込み
   ========================================================= */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        records: sanitizeRecords(data.records),
        settings: sanitizeSettings(data.settings),
        lastBackupAt: typeof data.lastBackupAt === 'number' ? data.lastBackupAt : null
      };
    }
  } catch (e) {
    console.warn('データの読み込みに失敗しました', e);
  }
  return { records: [], settings: { ...DEFAULT_SETTINGS }, lastBackupAt: null };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: DATA_VERSION,
      records: state.records,
      settings: state.settings,
      lastBackupAt: state.lastBackupAt
    }));
    return true;
  } catch (e) {
    console.error(e);
    showToast('保存できませんでした（空き容量不足やプライベートモードの可能性があります）');
    return false;
  }
}

function sanitizeRecords(list) {
  if (!Array.isArray(list)) return [];
  const min = Date.UTC(2000, 0, 1);
  const max = Date.now() + DAY;
  return list
    .map(Number)
    .filter((t) => Number.isFinite(t) && t >= min && t <= max)
    .map(Math.round)
    .sort((a, b) => a - b);
}

function sanitizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  return {
    goal: clampInt(src.goal, 0, 100, DEFAULT_SETTINGS.goal),
    packPrice: clampInt(src.packPrice, 0, 10000, DEFAULT_SETTINGS.packPrice),
    perPack: clampInt(src.perPack, 1, 100, DEFAULT_SETTINGS.perPack),
    dayStart: clampInt(src.dayStart, 0, 6, DEFAULT_SETTINGS.dayStart),
    vibrate: typeof src.vibrate === 'boolean' ? src.vibrate : DEFAULT_SETTINGS.vibrate,
    brandName: typeof src.brandName === 'string' && src.brandName.trim()
      ? src.brandName.trim().slice(0, 30)
      : DEFAULT_SETTINGS.brandName,
    spin: typeof src.spin === 'boolean' ? src.spin : DEFAULT_SETTINGS.spin
  };
}

/* ---------- 銘柄画像の保存・読み込み ---------- */
function isImageDataUrl(s) {
  return typeof s === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(s);
}
function isColor(s) {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
}

function loadBrandImage() {
  try {
    const data = JSON.parse(localStorage.getItem(BRAND_IMG_KEY) || 'null');
    if (data && isImageDataUrl(data.src)) {
      const side = isColor(data.side) ? data.side : DEFAULT_BRAND_IMAGE.side;
      return { src: data.src, side, top: side, custom: true };
    }
  } catch (e) { /* 壊れていたら初期画像 */ }
  return { ...DEFAULT_BRAND_IMAGE };
}

function saveBrandImage(img) {
  try {
    if (img && img.custom) {
      localStorage.setItem(BRAND_IMG_KEY, JSON.stringify({ src: img.src, side: img.side }));
    } else {
      localStorage.removeItem(BRAND_IMG_KEY);
    }
    brandImage = img && img.custom ? img : { ...DEFAULT_BRAND_IMAGE };
    return true;
  } catch (e) {
    console.error(e);
    showToast('画像を保存できませんでした（空き容量不足の可能性があります）');
    return false;
  }
}

// 写真を箱の比率（幅:高さ = 0.625:1）に中央で切り抜き、小さくしてJPEGにする
function makePackImage(img) {
  const W = 320, H = 512;
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const ratio = W / H;
  let cw = sw, ch = sw / ratio;
  if (ch > sh) { ch = sh; cw = sh * ratio; }
  const sx = (sw - cw) / 2, sy = (sh - ch) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, W, H);

  // 写真の平均色から、箱の側面の色を決める
  const tiny = document.createElement('canvas');
  tiny.width = 8;
  tiny.height = 8;
  const tctx = tiny.getContext('2d');
  tctx.drawImage(canvas, 0, 0, 8, 8);
  const px = tctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  const n = px.length / 4;
  const hex = (v) => pad(Math.round((v / n) * 0.8).toString(16));
  const side = `#${hex(r)}${hex(g)}${hex(b)}`;

  return { src: canvas.toDataURL('image/jpeg', 0.85), side, top: side, custom: true };
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めません')); };
    img.src = url;
  });
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || v === '' || v === null) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* =========================================================
   日付まわり（「1日の区切り時刻」を考慮）
   ========================================================= */
function pad(n) { return String(n).padStart(2, '0'); }

// 記録時刻 → その記録が属する日のキー（例: "2026-11-18"）
function dayKey(t) {
  const d = new Date(t - state.settings.dayStart * HOUR);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// その日の開始時刻（区切り時刻を含む）
function dayStartTime(t) {
  const d = new Date(t - state.settings.dayStart * HOUR);
  d.setHours(state.settings.dayStart, 0, 0, 0);
  return d.getTime();
}

// 今日から数えて n 日前の日付キー
function keyDaysAgo(n) {
  const d = new Date(dayStartTime(Date.now()));
  d.setDate(d.getDate() - n);
  return dayKey(d.getTime() + HOUR); // 区切り時刻ちょうどを避けて1時間足す
}

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDayLabel(key) {
  const d = keyToDate(key);
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
  if (key === keyDaysAgo(0)) return `今日 ${base}`;
  if (key === keyDaysAgo(1)) return `昨日 ${base}`;
  return base;
}

function formatTime(t) {
  const d = new Date(t);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

function formatElapsed(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間${min % 60}分`;
  return `${Math.floor(h / 24)}日${h % 24}時間`;
}

function formatYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

function toLocalInputValue(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pricePerCig() {
  return state.settings.packPrice / state.settings.perPack;
}

// 日付キーごとの本数
function countByDay() {
  const map = new Map();
  for (const t of state.records) {
    const k = dayKey(t);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

/* =========================================================
   記録の追加・削除
   ========================================================= */
function addRecord(t) {
  state.records.push(t);
  state.records.sort((a, b) => a - b);
  save();
}

function removeRecord(t) {
  const i = state.records.lastIndexOf(t);
  if (i === -1) return false;
  state.records.splice(i, 1);
  save();
  return true;
}

function vibrate(pattern) {
  if (!state.settings.vibrate) return;
  if (typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch (e) { /* 非対応端末では何もしない */ }
  }
}

function onPlus() {
  const now = Date.now();
  // 連打による誤記録を防ぐ（0.6秒以内の2回目は無視）
  if (now - lastTapAt < 600) return;
  lastTapAt = now;

  addRecord(now);
  vibrate(30);
  renderAll();
  bumpCount();
  boostPack(1);

  showToast(`1本記録しました（${formatTime(now)}）`, {
    actionLabel: '取り消す',
    onAction: () => {
      if (removeRecord(now)) {
        vibrate([15, 40, 15]);
        renderAll();
        showToast('記録を取り消しました');
      }
    }
  });
}

// −ボタン：今日の一番新しい記録を1本減らす
function onMinus() {
  const now = Date.now();
  if (now - lastMinusAt < 400) return;
  lastMinusAt = now;

  const last = state.records[state.records.length - 1];
  if (last === undefined || last < dayStartTime(now)) {
    vibrate([10, 60, 10]);
    showToast('今日の記録はまだありません');
    return;
  }
  removeRecord(last);
  vibrate([20, 40, 20]);
  renderAll();
  bumpCount();
  boostPack(-1);

  showToast(`1本減らしました（${formatTime(last)} の記録）`, {
    actionLabel: '元に戻す',
    onAction: () => {
      addRecord(last);
      vibrate(30);
      renderAll();
      boostPack(1);
    }
  });
}

// 今日の本数を「ぽよん」と弾ませる
function bumpCount() {
  const box = el.todayCount.parentElement;
  box.classList.remove('bump');
  void box.offsetWidth; // アニメーションを再スタートさせるため
  box.classList.add('bump');
}

// 箱を1回転させる（dir: 1 = 正回転、-1 = 逆回転）
function boostPack(dir) {
  const b = el.packBoost;
  b.classList.remove('spin-fwd', 'spin-back');
  void b.offsetWidth;
  b.classList.add(dir > 0 ? 'spin-fwd' : 'spin-back');
}

/* =========================================================
   描画
   ========================================================= */
function renderAll() {
  renderedDayKey = keyDaysAgo(0);
  renderHeader();
  renderBrand();
  renderHome();
  if (currentView === 'stats') renderStats();
  if (currentView === 'settings') renderSettings();
}

function renderHeader() {
  const d = new Date();
  el.headerDate.textContent = `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`;
}

function renderHome() {
  const now = Date.now();
  const todayStart = dayStartTime(now);
  const todayCount = state.records.filter((t) => t >= todayStart).length;
  el.todayCount.textContent = todayCount;

  // 目標
  const goal = state.settings.goal;
  if (goal > 0) {
    el.goalWrap.hidden = false;
    const ratio = todayCount / goal;
    el.goalFill.style.width = `${Math.min(100, ratio * 100)}%`;
    el.goalFill.classList.toggle('is-over', todayCount > goal);
    el.goalFill.classList.toggle('is-near', todayCount <= goal && ratio >= 0.8);
    el.goalText.textContent = todayCount > goal
      ? `目標 ${goal}本を ${todayCount - goal}本 オーバー`
      : `目標 ${goal}本まで あと${goal - todayCount}本`;
  } else {
    el.goalWrap.hidden = true;
  }

  // 前回から
  const last = state.records[state.records.length - 1];
  el.sinceLast.textContent = last ? formatElapsed(now - last) : '—';

  // 昨日の同じ時刻までの本数
  const yStart = new Date(todayStart);
  yStart.setDate(yStart.getDate() - 1);
  const yCount = state.records.filter((t) => t >= yStart.getTime() && t <= now - DAY).length;
  el.yesterdaySameTime.textContent = `${yCount}本`;

  // 今日の金額
  el.todayCost.textContent = formatYen(todayCount * pricePerCig());

  // 箱の下の表示（何箱分か）
  const packs = todayCount / state.settings.perPack;
  el.brandSub.textContent = `今日 ${packs.toFixed(packs > 0 && packs < 0.1 ? 2 : 1)}箱分`;
}

function renderBrand() {
  const img = brandImage;
  el.packImgs.forEach((i) => { if (i.getAttribute('src') !== img.src) i.src = img.src; });
  if (el.brandThumb.getAttribute('src') !== img.src) el.brandThumb.src = img.src;
  el.pack.style.setProperty('--pack-side', img.side);
  el.pack.style.setProperty('--pack-top', img.top || img.side);
  el.pack.classList.toggle('is-still', !state.settings.spin);
  el.brandName.textContent = state.settings.brandName;
  el.brandResetBtn.disabled = !img.custom;
}

function renderStats() {
  const counts = countByDay();
  const goal = state.settings.goal;

  // --- グラフ ---
  const keys = [];
  for (let i = chartRange - 1; i >= 0; i--) keys.push(keyDaysAgo(i));
  const values = keys.map((k) => counts.get(k) || 0);
  const labels = keys.map((k) => {
    const d = keyToDate(k);
    return chartRange <= 7 ? `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})` : `${d.getMonth() + 1}/${d.getDate()}`;
  });
  drawChart(labels, values, goal);

  // --- 集計 ---
  // 記録を始める前の日は平均に含めない
  const first = state.records[0];
  let days = chartRange;
  if (first) {
    const firstKey = dayKey(first);
    const idx = keys.indexOf(firstKey);
    if (idx > 0) days = chartRange - idx;
  }
  const validValues = values.slice(chartRange - days);
  const total = validValues.reduce((a, b) => a + b, 0);

  el.statTotal.textContent = `${total}本`;
  el.statAvg.textContent = first ? `${(total / days).toFixed(1)}本` : '—';
  if (goal > 0 && first) {
    const ok = validValues.filter((v) => v <= goal).length;
    el.statGoal.textContent = `${ok}/${days}日`;
  } else {
    el.statGoal.textContent = '—';
  }
  el.statCost.textContent = formatYen(total * pricePerCig());

  renderDayList(counts);

  const now = Date.now();
  el.pastTime.max = toLocalInputValue(now);
  if (!el.pastTime.value) el.pastTime.value = toLocalInputValue(now);
}

function drawChart(labels, values, goal) {
  if (typeof window.Chart === 'undefined') {
    el.chartCanvas.parentElement.hidden = true;
    el.chartFallback.hidden = false;
    return;
  }
  el.chartCanvas.parentElement.hidden = false;
  el.chartFallback.hidden = true;

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const accent = color('--accent');
  const danger = color('--danger');
  const muted = color('--muted');
  const line = color('--line');

  const datasets = [{
    type: 'bar',
    label: '本数',
    data: values,
    backgroundColor: values.map((v) => (goal > 0 && v > goal ? danger : accent)),
    borderRadius: 4,
    maxBarThickness: 32,
    order: 2
  }];
  if (goal > 0) {
    datasets.push({
      type: 'line',
      label: '目標',
      data: values.map(() => goal),
      borderColor: muted,
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      order: 1
    });
  }

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
    return;
  }

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = muted;

  chart = new Chart(el.chartCanvas, {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}本`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 8 }
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(5, goal + 2),
          ticks: { precision: 0 },
          grid: { color: line },
          border: { display: false }
        }
      }
    }
  });
}

function renderDayList(counts) {
  const goal = state.settings.goal;
  const todayKey = keyDaysAgo(0);
  const openKeys = new Set(
    [...el.dayList.querySelectorAll('.day-item.is-open')].map((li) => li.dataset.key)
  );
  const firstRender = el.dayList.childElementCount === 0;

  // 日ごとに記録時刻をまとめる（新しい日が上）
  const byDay = new Map();
  for (const t of state.records) {
    const k = dayKey(t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }
  const keys = [...byDay.keys()].sort().reverse().slice(0, 90);

  el.dayList.textContent = '';
  el.emptyHistory.hidden = keys.length > 0;

  for (const k of keys) {
    const times = byDay.get(k);
    const li = document.createElement('li');
    li.className = 'day-item';
    li.dataset.key = k;
    if (openKeys.has(k) || (firstRender && k === todayKey)) li.classList.add('is-open');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'day-head';
    head.setAttribute('aria-expanded', li.classList.contains('is-open'));
    const name = document.createElement('span');
    name.className = 'day-name';
    name.textContent = formatDayLabel(k);
    const cnt = document.createElement('span');
    cnt.className = 'day-count';
    if (goal > 0 && counts.get(k) > goal) cnt.classList.add('is-over');
    cnt.textContent = `${times.length}本`;
    head.append(name, cnt);
    head.addEventListener('click', () => {
      li.classList.toggle('is-open');
      head.setAttribute('aria-expanded', li.classList.contains('is-open'));
    });

    const body = document.createElement('div');
    body.className = 'day-body';
    const chips = document.createElement('div');
    chips.className = 'time-chips';
    for (const t of [...times].reverse()) {
      const chip = document.createElement('span');
      chip.className = 'time-chip';
      chip.append(formatTime(t));
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', `${formatTime(t)} の記録を削除`);
      del.addEventListener('click', () => {
        if (!confirm(`${formatDayLabel(k)} ${formatTime(t)} の記録を削除しますか？`)) return;
        if (removeRecord(t)) {
          vibrate(15);
          renderAll();
          showToast('記録を削除しました', {
            actionLabel: '元に戻す',
            onAction: () => { addRecord(t); renderAll(); }
          });
        }
      });
      chip.append(del);
      chips.append(chip);
    }
    body.append(chips);
    li.append(head, body);
    el.dayList.append(li);
  }
}

function renderSettings() {
  const s = state.settings;
  el.setGoal.value = s.goal;
  el.setPackPrice.value = s.packPrice;
  el.setPerPack.value = s.perPack;
  el.setDayStart.value = String(s.dayStart);
  el.setVibrate.checked = s.vibrate;
  el.setBrandName.value = s.brandName;
  el.setSpin.checked = s.spin;

  if (state.lastBackupAt) {
    const d = new Date(state.lastBackupAt);
    el.lastBackup.textContent = `最後のバックアップ：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${formatTime(state.lastBackupAt)}`;
  } else {
    el.lastBackup.textContent = 'まだバックアップしていません。';
  }

  const n = state.records.length;
  el.dataSummary.textContent = n
    ? `記録件数：${n}件（${dayKey(state.records[0]).replace(/-/g, '/')} から）`
    : '記録件数：0件';
}

/* =========================================================
   画面切り替え
   ========================================================= */
function switchView(name) {
  if (name !== currentView) hideToast();
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === name;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', active);
  });
  document.querySelector('.app-main').scrollTop = 0;
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

/* =========================================================
   トースト（お知らせ）
   ========================================================= */
function showToast(text, opts = {}) {
  clearTimeout(toastTimer);
  el.toastText.textContent = text;
  if (opts.onAction) {
    el.toastAction.hidden = false;
    el.toastAction.textContent = opts.actionLabel || '取り消す';
    el.toastAction.onclick = () => { hideToast(); opts.onAction(); };
  } else {
    el.toastAction.hidden = true;
    el.toastAction.onclick = null;
  }
  // 表示し直してアニメーションを再生
  el.toast.hidden = true;
  void el.toast.offsetWidth;
  el.toast.hidden = false;
  toastTimer = setTimeout(hideToast, opts.duration || (opts.onAction ? 5000 : 2500));
}

function hideToast() {
  clearTimeout(toastTimer);
  el.toast.hidden = true;
}

/* =========================================================
   バックアップ・復元
   ========================================================= */
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function backup() {
  const now = new Date();
  const data = {
    app: APP_ID,
    version: DATA_VERSION,
    exportedAt: now.toISOString(),
    settings: state.settings,
    records: state.records
  };
  if (brandImage.custom) data.brandImage = { src: brandImage.src, side: brandImage.side };
  const json = JSON.stringify(data, null, 2);
  const name = `smoke-log-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;

  // iPhoneは共有シートから「"ファイル"に保存」できるようにする
  if (isIOS() && typeof File === 'function' && navigator.canShare) {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'スモークログ バックアップ' });
        markBackedUp();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // ユーザーがキャンセル
        // 失敗したら下のダウンロード方式へ
      }
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markBackedUp();
}

function markBackedUp() {
  state.lastBackupAt = Date.now();
  save();
  renderSettings();
  showToast('バックアップを書き出しました');
}

function restoreFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      alert('ファイルを読み込めませんでした。スモークログのバックアップ（.json）を選んでください。');
      return;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.records) ||
        (data.app && data.app !== APP_ID)) {
      alert('このファイルはスモークログのバックアップではないようです。');
      return;
    }
    const records = sanitizeRecords(data.records);
    const settings = sanitizeSettings(data.settings);
    const when = data.exportedAt ? new Date(data.exportedAt) : null;
    const whenText = when && !isNaN(when) ? `${when.getFullYear()}/${when.getMonth() + 1}/${when.getDate()} 書き出し、` : '';

    const ok = confirm(
      `バックアップ（${whenText}${records.length}件）を読み込みます。\n` +
      `現在のデータ（${state.records.length}件）は置き換えられます。よろしいですか？`
    );
    if (!ok) return;

    state.records = records;
    state.settings = settings;
    // バックアップに銘柄の写真が入っていれば復元（入っていなければ今の画像のまま）
    if (data.brandImage && isImageDataUrl(data.brandImage.src)) {
      const side = isColor(data.brandImage.side) ? data.brandImage.side : DEFAULT_BRAND_IMAGE.side;
      saveBrandImage({ src: data.brandImage.src, side, top: side, custom: true });
    }
    if (save()) {
      renderAll();
      renderSettings();
      vibrate(30);
      showToast(`${records.length}件の記録を復元しました`);
    }
  };
  reader.onerror = () => alert('ファイルを読み込めませんでした。');
  reader.readAsText(file);
}

/* =========================================================
   イベント登録
   ========================================================= */
el.plusBtn.addEventListener('click', onPlus);
el.minusBtn.addEventListener('click', onMinus);
el.packScene.addEventListener('click', () => { vibrate(10); boostPack(1); });
el.packBoost.addEventListener('animationend', (e) => {
  if (e.target === el.packBoost) el.packBoost.classList.remove('spin-fwd', 'spin-back');
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    chartRange = Number(btn.dataset.range);
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderStats();
  });
});

el.addPastForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = new Date(el.pastTime.value).getTime();
  if (!Number.isFinite(t)) return;
  if (t > Date.now() + 60000) {
    alert('未来の時刻は記録できません。');
    return;
  }
  addRecord(t);
  vibrate(30);
  renderAll();
  showToast(`${formatDayLabel(dayKey(t))} ${formatTime(t)} に追加しました`, {
    actionLabel: '取り消す',
    onAction: () => { removeRecord(t); renderAll(); }
  });
});

// 設定は変更するとすぐ保存
function bindSetting(input, key, getValue) {
  input.addEventListener('change', () => {
    state.settings = sanitizeSettings({ ...state.settings, [key]: getValue() });
    save();
    renderAll();
    renderSettings(); // 範囲外の値を補正して表示し直す
  });
}
bindSetting(el.setGoal, 'goal', () => el.setGoal.value);
bindSetting(el.setPackPrice, 'packPrice', () => el.setPackPrice.value);
bindSetting(el.setPerPack, 'perPack', () => el.setPerPack.value);
bindSetting(el.setDayStart, 'dayStart', () => Number(el.setDayStart.value));
bindSetting(el.setVibrate, 'vibrate', () => el.setVibrate.checked);
el.setVibrate.addEventListener('change', () => { if (el.setVibrate.checked) vibrate(30); });
bindSetting(el.setBrandName, 'brandName', () => el.setBrandName.value);
bindSetting(el.setSpin, 'spin', () => el.setSpin.checked);

// 銘柄の写真
el.brandImgBtn.addEventListener('click', () => el.brandFile.click());
el.brandFile.addEventListener('change', async () => {
  const file = el.brandFile.files && el.brandFile.files[0];
  el.brandFile.value = '';
  if (!file) return;
  try {
    const img = await loadImageFromFile(file);
    if (saveBrandImage(makePackImage(img))) {
      renderBrand();
      boostPack(1);
      showToast('パッケージ画像を変更しました');
    }
  } catch (e) {
    console.error(e);
    alert('画像を読み込めませんでした。JPEGまたはPNGの写真を選んでください。');
  }
});
el.brandResetBtn.addEventListener('click', () => {
  if (!confirm('パッケージ画像を初期画像に戻しますか？')) return;
  if (saveBrandImage(null)) {
    renderBrand();
    boostPack(-1);
    showToast('初期画像に戻しました');
  }
});

el.backupBtn.addEventListener('click', backup);
el.restoreBtn.addEventListener('click', () => el.restoreFile.click());
el.restoreFile.addEventListener('change', () => {
  const file = el.restoreFile.files && el.restoreFile.files[0];
  if (file) restoreFromFile(file);
  el.restoreFile.value = ''; // 同じファイルを続けて選べるように
});

el.clearBtn.addEventListener('click', () => {
  if (!state.records.length) {
    showToast('削除する記録はありません');
    return;
  }
  if (!confirm(`すべての記録（${state.records.length}件）を削除します。\n元に戻せません。先にバックアップすることをおすすめします。\n\n削除しますか？`)) return;
  state.records = [];
  save();
  renderAll();
  renderSettings();
  showToast('すべての記録を削除しました');
});

// 「前回から」の表示更新と、日付が変わったときの再描画
setInterval(() => {
  if (keyDaysAgo(0) !== renderedDayKey) renderAll();
  else renderHome();
}, 30000);

// アプリに戻ってきたとき（別タブ・バックグラウンドから）に最新化
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    state = load(); // 別タブで変更された場合にも対応
    brandImage = loadBrandImage();
    renderAll();
  }
});
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY || e.key === BRAND_IMG_KEY) {
    state = load();
    brandImage = loadBrandImage();
    renderAll();
  }
});

/* =========================================================
   Service Worker（オフライン対応・更新のお知らせ）
   ========================================================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    // 初回インストール時はリロード不要。更新時だけリロードする
    const hadController = !!navigator.serviceWorker.controller;
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');

      // 新しいバージョンが届いたら知らせる
      const notify = (worker) => {
        showToast('新しいバージョンがあります', {
          actionLabel: '更新',
          duration: 15000,
          onAction: () => worker.postMessage({ type: 'SKIP_WAITING' })
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) notify(nw);
        });
      });

      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !hadController) return;
        reloaded = true;
        location.reload();
      });
    } catch (e) {
      console.warn('Service Worker の登録に失敗しました', e);
    }
  });
}

// ブラウザにデータを消されにくくする（対応ブラウザのみ）
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist(); }).catch(() => {});
}

/* ---------- 初回描画 ---------- */
renderAll();
