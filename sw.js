// ===================================================
// Service Worker - بين الشفتات PWA
// ===================================================

const CACHE_NAME = 'bayn-alshifat-v1.0.0';
const RUNTIME_CACHE = 'bayn-alshifat-runtime-v1';

// الملفات التي تُخزَّن مؤقتاً عند التثبيت (App Shell)
const PRECACHE_ASSETS = [
  '/bayn-alshifat/',
  '/bayn-alshifat/index.html',
  '/bayn-alshifat/style.css',
  '/bayn-alshifat/app.js',
  '/bayn-alshifat/config.js',
  '/bayn-alshifat/manifest.json',
  '/bayn-alshifat/icons/icon-192x192.png',
  '/bayn-alshifat/icons/icon-512x512.png',
  '/bayn-alshifat/icons/icon-180x180.png',
];

// ===================================================
// تثبيت Service Worker وتخزين App Shell
// ===================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching app shell...');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure (some assets may not exist yet):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ===================================================
// تفعيل Service Worker وحذف الكاشات القديمة
// ===================================================
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !currentCaches.includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ===================================================
// استراتيجية الجلب: Network First مع Fallback للكاش
// ===================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل طلبات غير HTTP/HTTPS أو طلبات Supabase (تحتاج اتصال دائم)
  if (!request.url.startsWith('http') || url.hostname.includes('supabase')) {
    return;
  }

  // تجاهل طلبات POST/PUT/DELETE (لا نخزنها في الكاش)
  if (request.method !== 'GET') {
    return;
  }

  // استراتيجية Cache First للأصول الثابتة (CSS, JS, الصور, الخطوط)
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // استراتيجية Network First للصفحات
  event.respondWith(networkFirst(request));
});

// ===================================================
// الدوال المساعدة
// ===================================================

function isStaticAsset(url) {
  return (
    url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|ico)$/) ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  );
}

// Cache First: ابحث في الكاش أولاً، وإلا اجلب من الشبكة وخزّن
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache first fetch failed:', err);
    return new Response('', { status: 503 });
  }
}

// Network First: جلب من الشبكة، وعند الفشل ارجع للكاش
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Serving from cache (offline):', request.url);
      return cached;
    }

    // Fallback للصفحة الرئيسية عند الأوفلاين
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/bayn-alshifat/') ||
                       await caches.match('/bayn-alshifat/index.html');
      if (fallback) return fallback;
    }

    // صفحة أوفلاين مخصصة
    return new Response(offlineHTML(), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// HTML مخصص للأوفلاين
function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بين الشفتات - غير متصل</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Tajawal', 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
    }
    .container {
      max-width: 380px;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #06b6d4, #3b82f6);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 2.5rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #f1f5f9;
    }
    p {
      color: #94a3b8;
      line-height: 1.7;
      margin-bottom: 2rem;
      font-size: 0.95rem;
    }
    button {
      background: linear-gradient(135deg, #06b6d4, #3b82f6);
      color: white;
      border: none;
      padding: 0.875rem 2rem;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>لا يوجد اتصال بالإنترنت</h1>
    <p>تحتاج إلى اتصال بالإنترنت للوصول إلى بيانات التطبيق. تحقق من اتصالك وحاول مجدداً.</p>
    <button onclick="window.location.reload()">🔄 إعادة المحاولة</button>
  </div>
</body>
</html>`;
}

// ===================================================
// استقبال رسائل من التطبيق (مثل: skipWaiting)
// ===================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
