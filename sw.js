// public/sw.js — Peek 离线缓存 Service Worker（leaf；随 index.html 一起原样部署到根）
// 策略：
//   · 导航(HTML) → network-first：优先拿最新，保证 HTML 与其引用的 hash 资源(main.js/css)版本一致；断网回落缓存(离线可玩)。
//   · 其余同源静态 → stale-while-revalidate：有缓存先秒回、同时后台悄悄拉新写缓存 → 下次即新版。
// 铁律：只碰「同源 GET」。version.json / 跨源(Supabase·CDN·beacon) 一律放行走网络、绝不缓存。
//   version.json 不缓存是为了保住 src/main.js 的「线上有新版就自动刷新」机制。
// 版本号：public 文件不经 vite 变量注入，故由注册方(swReg.js)经 ?v= 传入，缓存名随每次发布切换 → activate 清旧缓存，永不卡版本。
const VER = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'peek-' + VER;

// install 时预缓存「固定名」核心壳；hash 名的 main.js/css 与面具图靠运行时缓存（首次在线访问后即离线可玩）。
const PRECACHE = ['./', './index.html', './i18n.js', './cloudSave.js', './audio.js', './game.js', './gmPanel.js', './swReg.js'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('peek-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                      // 非 GET：放行
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // 跨源(Supabase/CDN/beacon)：放行
  if (url.pathname.endsWith('/version.json')) return;    // 版本探测：永远走网络(保住自动刷新)

  // 导航(HTML)：network-first，断网回落缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 其余同源静态：stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetching = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetching;
    })
  );
});
