// 售后雷达离线缓存（6.36 起由 index.html 注册）。网页本身永远先走网络（不会卡在旧版本），网络不通时才用缓存显示页面。
// 只缓存本站的页面、清单和图标；Supabase 等外部请求一律不经过这里。每次发版改 CACHE 名字，旧缓存在激活时删除。
const CACHE = 'after-sales-radar-6.39.2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then((res) => {
    if (res && res.ok && (r.mode === 'navigate' || SHELL.some((p) => new URL(p, location.href).href === r.url.split('#')[0]))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('./index.html') : undefined)).then((m) => m || Response.error())));
});
