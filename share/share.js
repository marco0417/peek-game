/* =====================================================================
 * PeekShare — 战绩分享模块（经典脚本，挂在 <script> 加载顺序末尾，game.js 之后）
 * 依赖（均已在前面加载）：window.PEEK_STRINGS / PEEK_LANG / tr() / RUN
 * 代码：public/share/{share.js(本文件), qrcode.lib.js(vendor)}
 * 素材：public/assets/share/{peeksharewx.png(800² 去文字Logo的兔子品牌图),
 *                            peeklogotext-q90.webp(文字Logo),
 *                            peeksharex.png(1200×630 og:image 静态分享图)}
 * 设计：卡片 = 纯黑底 + peeksharewx.png(垫最底层) + 文字Logo/数据元素(在其上)。
 *       先发 itch，浮层只渲染国际横图(og)；方图(wx)参数已烤好留待后续启用。
 *       支持「隐藏数据」品牌模式 + 可选昵称(右下角)。
 * ===================================================================== */
(function () {
  'use strict';

  // 素材相对路径（相对文档 base URL，兼容 GitHub Pages 子路径 / marconest.cc 镜像）
  // 注意：素材在 assets/share/，脚本自身在 share/ —— 二者目录不同，勿混。
  var ASSET_BASE = 'assets/share/';
  // 复制链接 / 二维码 指向的「官方可玩地址」。
  var SHARE_URL = 'https://marconest.itch.io/peek-zodiac-roulette';

  // 元素 src 名 → 资源 URL（drawCard 用 imgCache[el.src]）
  var ASSETS = {
    logo: ASSET_BASE + 'peeklogotext-q90.webp',   // 文字 Logo（左上）
    peeksharewx: ASSET_BASE + 'peeksharewx.png'     // 去文字Logo的兔子品牌图（垫底）
  };

  var FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Source Han Sans SC",system-ui,sans-serif';

  // ---- 烘焙布局（来自编辑器导出参数，已与用户确认）------------------------
  // type:text 有 cx/cy(中心占比) fontFrac(字高=fontFrac×画布宽) color bold
  // type:image 有 src imgWfrac(占画布宽)；bgwx 为垫底品牌层，必须置于数组首位。
  var SHARE_LAYOUT = {
    wx: {
      w: 800, h: 800, els: [
        { id: 'bgwx',    type: 'image', src: 'peeksharewx', cx: 0.5366585951585037, cy: 0.5038882035475509, imgWfrac: 1,    visible: true },
        { id: 'logo',    type: 'image', src: 'logo',        cx: 0.24225961245023286, cy: 0.10579927884615385, imgWfrac: 0.38, visible: true },
        { id: 'score',    type: 'text',  text: '1280', cx: 0.24596754220815806, cy: 0.28830525324894835, fontFrac: 0.13,  color: '#ffffff', bold: true,  visible: true },
        { id: 'scoreCap', type: 'text',  text: 'SCORE', cx: 0.5,   cy: 0.47,  fontFrac: 0.05,  color: '#cfcfe0', bold: false, visible: false },
        { id: 'round',    type: 'text',  text: '第 12 回合', cx: 0.5103365384615385, cy: 0.44475956843449516, fontFrac: 0.06, color: '#ebebf2', bold: false, visible: false },
        { id: 'mode',     type: 'text',  text: '无尽模式', cx: 0.366310060941256, cy: 0.3845734581580529, fontFrac: 0.025, color: '#ebebf2', bold: false, visible: true },
        { id: 'streak',   type: 'text',  text: '连胜 ×5', cx: 0.4348857586200421, cy: 0.4436056518554688, fontFrac: 0.025, color: '#e8c977', bold: true,  visible: true },
        { id: 'player',   type: 'text',  text: 'ZodiacPlayer', cx: 0.12, cy: 0.05, fontFrac: 0.045, color: '#ffffff', bold: false, visible: false },
        { id: 'avatar',   type: 'image', src: 'logo', cx: 0.5, cy: 0.38, imgWfrac: 0.2, visible: false },
        { id: 'title',    type: 'text',  text: 'PEEK: ZODIAC ROULETTE', cx: 0.5, cy: 0.1, fontFrac: 0.055, color: '#ffffff', bold: true, visible: false },
        { id: 'subtitle', type: 'text',  text: '生肖规则怪谈 · 博弈', cx: 0.5, cy: 0.9, fontFrac: 0.045, color: '#cfcfe0', bold: false, visible: false },
        { id: 'date',     type: 'text',  text: '2026-08-01', cx: 0.88, cy: 0.05, fontFrac: 0.04, color: '#cfcfe0', bold: false, visible: false },
        { id: 'rank',     type: 'text',  text: '全球第 #342', cx: 0.5, cy: 0.62, fontFrac: 0.05, color: '#9ad', bold: false, visible: false },
        { id: 'qr',       type: 'qr', cx: 0.9095011784480168, cy: 0.8972115149864783, imgWfrac: 0.18, visible: true },
        { id: 'watermark',type: 'text',  text: 'marconest.itch.io', cx: 0.5, cy: 0.965, fontFrac: 0.035, color: '#888', bold: false, visible: false },
        { id: 'modePill', type: 'text',  text: 'ENDLESS', cx: 0.5, cy: 0.82, fontFrac: 0.05, color: '#0b0b10', bold: true, visible: false },
        { id: 'nick',     type: 'text',  text: '玩家昵称', cx: 0.8705679575602214, cy: 0.9641340529882214, fontFrac: 0.02, color: '#969696', bold: false, visible: true }
      ]
    },
    og: {
      w: 1200, h: 630, els: [
        { id: 'bgwx',    type: 'image', src: 'peeksharewx', cx: 0.7318309392684546, cy: 0.4932245377006881, imgWfrac: 0.5,  visible: true },
        { id: 'logo',    type: 'image', src: 'logo',        cx: 0.297576109568278, cy: 0.20359330016903193, imgWfrac: 0.44, visible: true },
        { id: 'score',    type: 'text',  text: '1280', cx: 0.3834685545701247, cy: 0.4614679459038132, fontFrac: 0.075, color: '#ffffff', bold: true,  visible: true },
        { id: 'scoreCap', type: 'text',  text: 'SCORE', cx: 0.5, cy: 0.47, fontFrac: 0.05, color: '#cfcfe0', bold: false, visible: false },
        { id: 'round',    type: 'text',  text: '第 12 回合', cx: 0.5, cy: 0.69, fontFrac: 0.06, color: '#ebebf2', bold: false, visible: false },
        { id: 'mode',     type: 'text',  text: '无尽模式', cx: 0.44706532894036716, cy: 0.5697858020654147, fontFrac: 0.02, color: '#ebebf2', bold: false, visible: true },
        { id: 'streak',   type: 'text',  text: '连胜 ×5', cx: 0.4885015854468713, cy: 0.6365694042520785, fontFrac: 0.02, color: '#e8c977', bold: true,  visible: true },
        { id: 'player',   type: 'text',  text: 'ZodiacPlayer', cx: 0.12, cy: 0.05, fontFrac: 0.045, color: '#ffffff', bold: false, visible: false },
        { id: 'avatar',   type: 'image', src: 'logo', cx: 0.5, cy: 0.38, imgWfrac: 0.2, visible: false },
        { id: 'title',    type: 'text',  text: 'PEEK: ZODIAC ROULETTE', cx: 0.5, cy: 0.1, fontFrac: 0.055, color: '#ffffff', bold: true, visible: false },
        { id: 'subtitle', type: 'text',  text: '生肖规则怪谈 · 博弈', cx: 0.5, cy: 0.9, fontFrac: 0.045, color: '#cfcfe0', bold: false, visible: false },
        { id: 'date',     type: 'text',  text: '2026-08-01', cx: 0.88, cy: 0.05, fontFrac: 0.04, color: '#cfcfe0', bold: false, visible: false },
        { id: 'rank',     type: 'text',  text: '全球第 #342', cx: 0.5, cy: 0.62, fontFrac: 0.05, color: '#9ad', bold: false, visible: false },
        { id: 'qr',       type: 'qr', cx: 0.85, cy: 0.85, imgWfrac: 0.18, visible: false },
        { id: 'watermark',type: 'text',  text: 'marconest.itch.io', cx: 0.5, cy: 0.965, fontFrac: 0.035, color: '#888', bold: false, visible: false },
        { id: 'modePill', type: 'text',  text: 'ENDLESS', cx: 0.5, cy: 0.82, fontFrac: 0.05, color: '#0b0b10', bold: true, visible: false },
        { id: 'nick',     type: 'text',  text: '玩家昵称', cx: 0.8705679575602214, cy: 0.9641340529882214, fontFrac: 0.02, color: '#969696', bold: false, visible: true }
      ]
    }
  };

  // ---- 资源预加载 ---------------------------------------------------------
  var imgCache = {};
  var assetsPromise = null;
  function loadImg(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('img load failed: ' + url)); };
      img.src = url;
    });
  }
  function ensureAssets() {
    if (assetsPromise) return assetsPromise;
    var names = Object.keys(ASSETS);
    assetsPromise = Promise.all(names.map(function (n) { return loadImg(ASSETS[n]); }))
      .then(function (imgs) {
        names.forEach(function (n, i) { imgCache[n] = imgs[i]; });
        return true;
      }).catch(function (e) {
        console.error('[PeekShare] 资源加载失败', e);
        throw e;
      });
    return assetsPromise;
  }

  // ---- 绘制辅助 -----------------------------------------------------------
  function drawQr(ctx, x, y, size) {
    try {
      var qr = qrcode(0, 'M');
      qr.addData(SHARE_URL);
      qr.make();
      var count = qr.getModuleCount();
      var margin = 4;
      var cell = Math.max(1, Math.floor(size / (count + margin * 2)));
      var dim = cell * (count + margin * 2);
      var off = (size - dim) / 2;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#0b0b10';
      for (var r = 0; r < count; r++) {
        for (var c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(x + off + (c + margin) * cell, y + off + (r + margin) * cell, cell, cell);
          }
        }
      }
      ctx.restore();
    } catch (e) { console.error('[PeekShare] QR 绘制失败', e); }
  }

  function modeText() {
    if (!RUN) return '';
    if (RUN.daily) return tr('每日挑战');
    if (RUN.isJoker) return tr('小丑');
    if (RUN.endless) return RUN.hard ? tr('地狱模式') : tr('无尽模式');
    return RUN.hard ? tr('困难模式') : tr('简单模式');
  }

  // opts: { hideData:bool, nick:string }
  function drawCard(canvas, layout, opts) {
    opts = opts || {};
    var W = layout.w, H = layout.h;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // 1) 纯黑底（防穿帮，所有分享图皆全黑）
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // 2) 品牌层(bgwx)在最底，其余元素依次叠上
    layout.els.forEach(function (el) {
      if (!el.visible) return;

      if (el.type === 'qr') {
        if (opts.hideData) return; // 品牌模式不画二维码
        var qs = el.imgWfrac * W;
        drawQr(ctx, el.cx * W - qs / 2, el.cy * H - qs / 2, qs);
        return;
      }
      if (el.type === 'image') {
        var img = imgCache[el.src];
        if (!img || !img.complete || !img.naturalWidth) return;
        var iw = el.imgWfrac * W;
        var ih = iw * (img.naturalHeight / img.naturalWidth);
        ctx.drawImage(img, el.cx * W - iw / 2, el.cy * H - ih / 2, iw, ih);
        return;
      }
      // text —— 隐藏数据模式下跳过个人战绩元素
      if (opts.hideData && (el.id === 'score' || el.id === 'mode' || el.id === 'streak' || el.id === 'round' || el.id === 'rank' || el.id === 'scoreCap')) return;

      if (el.id === 'nick') {
        if (!opts.nick) return; // 昵称删空则不显示（编辑器内显示占位文字以便定位）
        var nf = el.fontFrac * W;
        ctx.save();
        ctx.font = (el.bold ? '700 ' : '400 ') + nf + 'px ' + FONT_STACK;
        ctx.fillStyle = el.color || '#969696';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(opts.nick, el.cx * W, el.cy * H);
        ctx.restore();
        return;
      }

      var text = el.text;
      if (el.id === 'score') {
        // 通关制模式（普通/困难/小丑/每日）无分数概念：绝不放误导性「0」，改用进度/通关文案
        if (RUN && RUN.endless) {
          text = String((RUN.score != null) ? RUN.score : 0);   // 无尽/地狱：分数是核心战绩
        } else if (RUN && RUN.isJoker) {
          text = tr('击败小丑 · 通关');                          // 终局小丑：通关时刻
        } else if (RUN && RUN.daily) {
          text = (RUN.lastResult === 'victory') ? tr('胜利') : tr('失败');  // 每日挑战：大字放胜负，小字留模式名避免重复
        } else {
          var total = (typeof ZODIACS !== 'undefined' && ZODIACS.length) ? ZODIACS.length : 12;
          var win = RUN && RUN.lastResult === 'victory';
          var cleared = win ? (RUN.index + 1) : (RUN.index || 0); // 胜：含本局；负：止步前序
          text = (cleared >= total) ? tr('全 {n} 生肖通关', { n: total }) : tr('已通关 {n}/{t} 生肖', { n: cleared, t: total });
        }
      }
      else if (el.id === 'streak') {
        // 连胜仅在无尽/地狱模式有意义；普通/小丑/每日无连胜概念，跳过「连胜 ×0」
        if (!RUN || !RUN.endless || !RUN.streak) return;
        text = tr('连胜 ×{n}', { n: RUN.streak || 0 });
      }
      else if (el.id === 'mode') text = modeText();
      if (!text) return;

      var fontSize = el.fontFrac * W;
      // 通关文案（中文）比数字占面积更大，同字号会显得夸张；非无尽模式收敛到 45%
      if (el.id === 'score' && RUN && !RUN.endless) fontSize = fontSize * 0.45;
      ctx.save();
      ctx.font = (el.bold ? '700 ' : '400 ') + fontSize + 'px ' + FONT_STACK;
      ctx.fillStyle = el.color || '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var m = ctx.measureText(text);
      if (m.width > W * 0.94) {
        fontSize = fontSize * (W * 0.94 / m.width);
        ctx.font = (el.bold ? '700 ' : '400 ') + fontSize + 'px ' + FONT_STACK;
      }
      ctx.fillText(text, el.cx * W, el.cy * H);
      ctx.restore();
    });
  }

  // ---- 昵称默认值（localStorage 优先，其次云存档昵称）-----------------------
  function getDefaultNick() {
    try { var s = localStorage.getItem('peek_nick'); if (s) return s; } catch (e) {}
    try { if (window.PeekCloud && window.PeekCloud.displayName) return window.PeekCloud.displayName; } catch (e) {}
    return '';
  }

  // ---- 浮层 ---------------------------------------------------------------
  var overlayBuilt = false;
  var ogCanvas = null;
  var CSS = '' +
    '#shareBtn{margin-top:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);color:#e8e8f2;font-weight:600;}' +
    '#shareBtn:hover{background:rgba(255,255,255,.12);}' +
    '.share-overlay{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,.72);padding:18px;backdrop-filter:blur(2px);}' +
    '.share-overlay.show{display:flex;}' +
    '.share-box{position:relative;box-sizing:border-box;width:100%;max-width:460px;background:#15151c;border:1px solid #2a2a35;border-radius:16px;' +
    'padding:18px;color:#eef0f6;font-family:' + FONT_STACK + ';box-shadow:0 18px 60px rgba(0,0,0,.5);}' +
    '.share-head{display:flex;align-items:center;justify-content:space-between;}' +
    '.share-title{flex:1;min-width:0;font-size:17px;font-weight:700;padding-right:42px;}' +
    '.share-x{position:absolute;top:8px;right:10px;flex-shrink:0;background:none;border:none;color:#9a9ab0;font-size:24px;line-height:1;cursor:pointer;padding:8px;}' +
    '.share-x:hover{color:#eef0f6;}' +
    '.share-ctrl{display:flex;flex-direction:column;gap:10px;margin:14px 0;}' +
    '.share-nick-wrap{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9a9ab0;}' +
    '.share-nick-wrap input{margin-top:2px;padding:8px 10px;border-radius:8px;border:1px solid #34343f;' +
    'background:#0f0f15;color:#eef0f6;font-size:13px;font-family:inherit;}' +
    '.share-nick-wrap input:focus{outline:none;border-color:#e8c977;}' +
    '.share-toggle{display:flex;align-items:center;gap:7px;font-size:13px;color:#cfcfe0;cursor:pointer;user-select:none;}' +
    '.share-toggle input{width:16px;height:16px;cursor:pointer;accent-color:#e8c977;margin:0;}' +
    '.share-prev{display:flex;flex-direction:column;align-items:center;gap:6px;}' +
    '.share-prev canvas{width:100%;height:auto;border-radius:10px;background:#000;display:block;box-shadow:0 4px 16px rgba(0,0,0,.4);}' +
    '.share-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px;}' +
    '.share-btn{padding:11px 10px;border-radius:10px;border:1px solid #34343f;background:#1d1d27;color:#eef0f6;' +
    'font-size:14px;cursor:pointer;font-family:inherit;transition:background .15s;}' +
    '.share-btn:hover{background:#262633;}' +
    '.share-btn.primary{background:#e8c977;color:#1a1408;border:none;font-weight:700;}' +
    '.share-btn.primary:hover{background:#f1d488;}' +
    '.share-toast{position:fixed;left:50%;bottom:42px;transform:translateX(-50%) translateY(10px);' +
    'background:rgba(0,0,0,.86);color:#fff;padding:10px 18px;border-radius:22px;font-size:14px;' +
    'opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:300;}' +
    '.share-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}';

  function applyI18n(root) {
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      nodes[i].textContent = tr(k);
    }
  }

  function buildOverlay() {
    if (overlayBuilt) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var ov = document.createElement('div');
    ov.id = 'shareOverlay';
    ov.className = 'share-overlay';
    ov.innerHTML =
      '<div class="share-box">' +
        '<div class="share-head">' +
          '<div class="share-title" data-i18n="分享战绩">分享战绩</div>' +
          '<button class="share-x" id="shareCloseBtn" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="share-ctrl">' +
          '<label class="share-nick-wrap">' +
            '<span data-i18n="昵称（可选）">昵称（可选）</span>' +
            '<input type="text" id="shareNick" maxlength="16" placeholder="玩家昵称，留空则不显示">' +
          '</label>' +
          '<label class="share-toggle">' +
            '<input type="checkbox" id="shareHideData">' +
            '<span data-i18n="隐藏数据（只发品牌图）">隐藏数据（只发品牌图）</span>' +
          '</label>' +
        '</div>' +
        '<div class="share-prev"><canvas id="shareOgCanvas"></canvas></div>' +
        '<div class="share-actions">' +
          '<button class="share-btn primary" id="shareWebBtn" data-i18n="分享到">分享到</button>' +
          '<button class="share-btn" id="shareOgBtn" data-i18n="下载">下载</button>' +
          '<button class="share-btn" id="shareLinkBtn" data-i18n="复制链接">复制链接</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    overlayBuilt = true;

    ogCanvas = document.getElementById('shareOgCanvas');
    var nickInput = document.getElementById('shareNick');
    var hideInput = document.getElementById('shareHideData');

    nickInput.value = getDefaultNick();
    var render = function () {
      drawCard(ogCanvas, SHARE_LAYOUT.og, { hideData: hideInput.checked, nick: nickInput.value.trim() });
    };
    nickInput.addEventListener('input', function () {
      try { localStorage.setItem('peek_nick', nickInput.value.trim()); } catch (e) {}
      render();
    });
    hideInput.addEventListener('change', render);

    document.getElementById('shareCloseBtn').addEventListener('click', close);
    document.getElementById('shareWebBtn').addEventListener('click', webShare);
    document.getElementById('shareOgBtn').addEventListener('click', function () { downloadCanvas(ogCanvas, 'peek-share.png'); });
    document.getElementById('shareLinkBtn').addEventListener('click', copyLink);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    applyI18n(ov);
    nickInput.placeholder = tr('玩家昵称，留空则不显示'); // A2：placeholder 不走 data-i18n，需 JS 设值
  }

  // 记录最近一次渲染参数，供 webShare 复用
  var lastOpts = { hideData: false, nick: '' };
  function open() {
    if (typeof RUN === 'undefined' || !RUN) return;
    buildOverlay();
    var nickInput = document.getElementById('shareNick');
    var hideInput = document.getElementById('shareHideData');
    function render() {
      lastOpts = { hideData: hideInput.checked, nick: nickInput.value.trim() };
      drawCard(ogCanvas, SHARE_LAYOUT.og, lastOpts);
      document.getElementById('shareOverlay').classList.add('show');
    }
    ensureAssets().then(render).catch(render); // 资源失败也兜底渲染（黑底）
  }
  function close() {
    var ov = document.getElementById('shareOverlay');
    if (ov) ov.classList.remove('show');
  }

  function canvasToBlob(canvas) {
    return new Promise(function (res, rej) {
      try { canvas.toBlob(function (b) { b ? res(b) : rej(new Error('toBlob null')); }, 'image/png'); }
      catch (e) { rej(e); }
    });
  }
  function downloadCanvas(canvas, name) {
    try {
      canvas.toBlob(function (blob) {
        if (!blob) { fallbackDownload(canvas, name); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      }, 'image/png');
    } catch (e) { fallbackDownload(canvas, name); }
  }
  function fallbackDownload(canvas, name) {
    try {
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e2) { /* ignore */ }
  }

  function webShare() {
    if (!navigator.share) { copyLink(); return; }
    canvasToBlob(ogCanvas).then(function (ogBlob) {
      var ogFile = new File([ogBlob], 'peek-share.png', { type: 'image/png' });
      var payload = {
        title: tr('分享战绩'),
        text: tr('分享简介'), // A3：不再塞实时 streak/score（未玩时显示 ×0 很丑），改用固定游戏简介
        url: SHARE_URL
      };
      if (navigator.canShare && navigator.canShare({ files: [ogFile] })) {
        return navigator.share(Object.assign({ files: [ogFile] }, payload));
      }
      return navigator.share(payload);
    }).catch(function () { copyLink(); });
  }

  function copyLink() {
    var done = function () { toast(tr('链接已复制')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(SHARE_URL).then(done).catch(function () { fallbackCopy(SHARE_URL, done); });
    } else {
      fallbackCopy(SHARE_URL, done);
    }
  }
  function fallbackCopy(text, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      if (cb) cb();
    } catch (e) { /* ignore */ }
  }
  function toast(msg) {
    var t = document.getElementById('shareToast');
    if (!t) { t = document.createElement('div'); t.id = 'shareToast'; t.className = 'share-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ---- 接线（defer 保证 DOM 就绪，shareBtn 为静态元素）--------------------
  function init() {
    if(window.PEEK_FEATURES && !window.PEEK_FEATURES.share) return;  // 平台关闭分享（通用 iframe）时不绑定分享按钮
    var btn = document.getElementById('shareBtn');
    if (btn) btn.addEventListener('click', open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.PeekShare = { open: open, close: close, init: init };
})();
