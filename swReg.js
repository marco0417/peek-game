// public/swReg.js — Service Worker 注册（leaf；index.html 末尾最后加载）
// 版本号读 meta[app-version]（构建期由 vite 注入真实版本），拼进 ?v= 让 SW 缓存名随发布切换。
// 应急自杀开关：把 SW_KILL 置 true 部署一次 → 用户端自动「注销所有 SW + 清 peek- 缓存」自愈；
//   适用于万一 SW 出问题需要全量回退（这是 SW 上线后难救的保险）。
(function () {
  var SW_KILL = false;
  if (!('serviceWorker' in navigator)) return;

  // 本地开发时绝不能让 SW 缓存干扰：注销已有注册 + 清掉 peek- 缓存。
  // 关键：本地「不」自动 location.reload()——Vite dev 每次本就从服务器取最新，残留
  // 缓存清掉后即无害；自动刷新反而会制造「载入闪一下」的观感（旧版 swReg 曾在 localhost
  // 注册过 SW、留过 peek- 缓存，每次开页都会被迫重刷一次）。若想立刻让新代码生效，
  // 手动 Cmd/Ctrl+Shift+R 硬刷一次即可（之后 SW 已注销，永不再闪）。
  var host = location.hostname;
  var isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalDev) {
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
    if (window.caches) {
      caches.keys().then(function (ks) {
        ks.filter(function (k) { return k.indexOf('peek-') === 0; }).forEach(function (k) { caches.delete(k); });
      }).catch(function () {});
    }
    return;
  }

  if (SW_KILL) {
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
    if (window.caches) {
      caches.keys().then(function (ks) {
        ks.forEach(function (k) { if (k.indexOf('peek-') === 0) caches.delete(k); });
      }).catch(function () {});
    }
    return;
  }

  var m = document.querySelector('meta[name="app-version"]');
  var ver = (m && m.getAttribute('content')) || 'dev';
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js?v=' + encodeURIComponent(ver)).catch(function () {});
  });
})();
