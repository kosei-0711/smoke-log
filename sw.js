/* =========================================================
   スモークログ  sw.js（Service Worker）
   - アプリの全ファイルと Chart.js（CDN）をキャッシュして、オフラインでも動くようにする
   - ファイルを更新したら CACHE_VERSION の数字を上げること！
   ========================================================= */
const CACHE_VERSION = 'v2';
const CACHE_NAME = `smoke-log-${CACHE_VERSION}`;

// アプリ本体のファイル（sw.js からの相対パス。GitHub Pages のサブフォルダでも動く）
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './img/pack-menthol.svg',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// 外部（CDN）のファイル
const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

/* ---------- インストール：ファイルをまとめてキャッシュ ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 自分のファイルは必須（1つでも失敗したらインストールをやり直す）
    await cache.addAll(APP_FILES);
    // CDN は失敗してもアプリは動くので、個別に挑戦する
    await Promise.all(CDN_FILES.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { mode: 'cors' }));
        if (res.ok) await cache.put(url, res);
      } catch (e) {
        console.warn('[sw] CDN のキャッシュに失敗:', url, e);
      }
    }));
    // 初回インストール時はすぐ有効化。更新時は画面の「更新」ボタンを待つ
    if (!self.registration.active) await self.skipWaiting();
  })());
});

/* ---------- 有効化：古いキャッシュを削除 ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('smoke-log-') && k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- 画面からの「更新」ボタン ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- 通信の横取り ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // CDN（Chart.js）：バージョン固定なので「キャッシュ優先」
  if (CDN_FILES.includes(url.href)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 自分のサイトのファイル
  if (url.origin === self.location.origin) {
    // ページ本体：オフラインなら index.html を返す
    if (req.mode === 'navigate') {
      event.respondWith(staleWhileRevalidate(req, './index.html'));
      return;
    }
    event.respondWith(staleWhileRevalidate(req));
  }
});

// キャッシュがあればそれを返し、なければネットから取ってキャッシュする
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// キャッシュをすぐ返しつつ、裏でネットから最新版を取ってキャッシュを更新する
async function staleWhileRevalidate(req, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });

  const network = fetch(req)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {}); // 裏の更新はエラーでも無視
    return cached;
  }
  const res = await network;
  if (res) return res;
  if (fallbackUrl) {
    const fallback = await cache.match(fallbackUrl);
    if (fallback) return fallback;
  }
  return new Response('オフラインです', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
