// public/platformProfile.js — 平台风味检测（经典 <script defer> 加载，置于 i18n 之后、cloudSave 之前）
// 依据运行主机判定 PEEK_PLATFORM（'standalone' | 'itch' | 'iframe'）并输出 window.PEEK_FEATURES 门控对象：
//   { cloudSave, leaderboard, share, feedback, analytics, fullscreen }
// 除 standalone/itch 白名单外，其余所有主机（含各门户真实 iframe 域名，无需逐个枚举）一律按 iframe 锁定外部服务。
// 这样新上架任何门户都自动合规，不需要回头补域名清单。

(function(){
  function detectPlatform(){
    const h = location.hostname;
    // 自有全功能站点（含本地调试）
    if(h === 'marco0417.github.io' || h === 'marconest.cc' || h.endsWith('.marconest.cc')
       || h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'standalone';
    // itch.io 嵌入：保留排行榜/分享/反馈/分析，仅关云存档（沿用 v2.7.56 刻意保留的留存钩子）
    if(h === 'html.itch.zone' || h === 'html-classic.itch.zone') return 'itch';
    // 其余一切（CrazyGames / Poki / Newgrounds / Kongregate / Armor Games / Game Jolt 等）全关外部服务
    return 'iframe';
  }

  const platform = detectPlatform();
  window.PEEK_PLATFORM = platform;

  const FEATURES = {
    standalone: { cloudSave:true,  leaderboard:true,  share:true,  feedback:true,  analytics:true,  fullscreen:true },
    itch:       { cloudSave:false, leaderboard:true,  share:true,  feedback:true,  analytics:true,  fullscreen:true },
    iframe:     { cloudSave:false, leaderboard:false, share:true,  feedback:false, analytics:false, fullscreen:true }
  };
  window.PEEK_FEATURES = FEATURES[platform] || FEATURES.iframe;

  // 按 features 隐藏设置页/结算页相关 UI（防御性：按钮也会被对应调用处的 feature 守卫兜底）
  function hideRow(id){
    const el = document.getElementById(id);
    const row = el && el.closest ? el.closest('.settings-row') : null;
    if(row) row.style.display = 'none';
  }
  function applyPlatformGating(){
    const F = window.PEEK_FEATURES;
    if(!F.leaderboard){ hideRow('setLb'); }
    if(!F.cloudSave){ hideRow('setBind'); hideRow('setRecover'); }
    if(!F.feedback){ hideRow('setFeedback'); }
    if(!F.share){
      const sb = document.getElementById('shareBtn'); if(sb) sb.style.display = 'none';
      const ach = document.getElementById('achShareAll'); if(ach) ach.style.display = 'none';
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyPlatformGating);
  else applyPlatformGating();

  // 仅在 standalone/itch（analytics=true）注入腾讯 beacon 分析；iframe 平台完全不加载该外部脚本
  if(window.PEEK_FEATURES.analytics){
    var bs = document.createElement('script');
    bs.src = 'https://beacon.cdn.qq.com/sdk/4.5.9/beacon_web.min.js';
    bs.async = true;
    bs.onload = function(){
      try{
        var beacon = new BeaconAction({
          appkey:'0WEB06U85YBSLJNL',
          versionCode:'1.0.0',
          channelID:'share',
          delay:1000,
          sessionDuration:30*60*1000,
          isOversea:false,
          needReportRqdEvent:false
        });
        beacon.onDirectUserAction('preview_page_view',{
          'url':location.href,
          'referrer':document.referrer,
          'title':document.title,
          'sandbox_id':'0e8f0d1fd14e4a0bb5d592beecf45835'
        });
      }catch(e){}
    };
    bs.onerror = function(){};
    document.head.appendChild(bs);
  }

  if(window.PEEK_DEBUG) console.log('[platformProfile]', platform, window.PEEK_FEATURES);
})();
