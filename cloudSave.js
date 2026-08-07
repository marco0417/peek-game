// public/cloudSave.js — 云存档 / 排行榜 / 分析埋点 模块（从 game.js 拆分，经典 <script defer> 加载）
// 依赖 game.js 全局：$ / tr / S / RUN / STATS / ACH / ZODIACS / PEEK_STRINGS（运行时已就绪；index.html 加载顺序：i18n -> cloudSave -> game）。
// 本文件仅在 <script> 顶层定义函数与配置；按钮绑定(_bindOn)与顶层调用(initLeaderboard / trackEvent app_open)保留在 game.js。

// itch.io 上游戏以 iframe(html.itch.zone) 嵌入运行：邮箱云存档走 magic-link，链接回跳在 iframe 下会死，
// 故运行时关闭「绑定/恢复进度」UI；但排行榜走 anon upsert（不查登录态），与 GitHub Pages 共用 leaderboard 表，照常工作。
// 同一份构建喂多端：由 platformProfile.js 按主机判定的 PEEK_FEATURES.cloudSave 决定（itch/通用 iframe 关，standalone 开）。
// 保留变量名 CLOUD_SAVE_ENABLED 以减少改动面；PEEK_FEATURES 在 platformProfile.js（加载序早于本文件）已就绪。
const CLOUD_SAVE_ENABLED = !!(window.PEEK_FEATURES && window.PEEK_FEATURES.cloudSave);
function setupCloudSaveUI(){
  if(CLOUD_SAVE_ENABLED) return;   // 非 itch：保留云存档 UI，不动
  ['setBind','setRecover'].forEach(id=>{
    const el=document.getElementById(id);
    const row = el && el.closest ? el.closest('.settings-row') : null;
    if(row) row.style.display='none';
  });
  const hint=document.getElementById('localSaveHint');
  if(hint) hint.style.display='';
}

const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4bmR2ZnBzZWxiZ29obXFiaW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTQ0MzEsImV4cCI6MjEwMDYzMDQzMX0.vOqigKGQKdc8lXvXpnLkFzHld2IDShxGw2xsduqr5qk';
const LB_NAME_KEY = 'peek_lb_name';
const LB_LAST_KEY = 'peek_lb_last_';   // 后缀拼 mode(endless/hell)：记录上次自动提交分数，比上次低不重复提交
const LB_UID_KEY = 'peek_lb_uid';
const LB_LOCAL_KEY = 'peek_lb_local';
let _sb = null, _sbUser = null, _sbReady = false, _sbInit = null;
function lbUid(){
  try{
    let id=localStorage.getItem(LB_UID_KEY);
    if(!id){ id=(crypto&&crypto.randomUUID)?crypto.randomUUID():('u'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)); localStorage.setItem(LB_UID_KEY,id); }
    return id;
  }catch(e){ return 'u'+Date.now().toString(36); }
}
function readLocalLb(){ try{ return JSON.parse(localStorage.getItem(LB_LOCAL_KEY)||'[]'); }catch(e){ return []; } }
function writeLocalLb(rec){
  const a=readLocalLb();
  const i=a.findIndex(r=>r.user_id===rec.user_id && r.mode===rec.mode);
  if(i>=0){ if(rec.score > a[i].score) a[i]=rec; }
  else a.push(rec);
  a.sort((x,y)=>y.score-x.score);
  try{ localStorage.setItem(LB_LOCAL_KEY, JSON.stringify(a.slice(0,100))); }catch(e){}
}
function getLocalLb(mode){ return readLocalLb().filter(r=>!mode || r.mode===mode); }
function sbTimeout(p, ms){
  // 给 Supabase 远程调用加超时：超时则 resolve 成 {__timeout:true}，绝不抛错、绝不 pending 卡死
  return Promise.race([
    p,
    new Promise(res=>setTimeout(()=>res({__timeout:true}), ms))
  ]);
}
function loadSupabaseScript(){
  // 静态 CDN 标签可能失败（网络/adblock/离线）→ 动态补一个 jsdelivr 兜底
  return new Promise(res=>{
    if(window.supabase){ res(true); return; }
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload=()=>res(!!window.supabase);
    s.onerror=()=>res(false);
    document.head.appendChild(s);
    setTimeout(()=>res(!!window.supabase), 6000);
  });
}
let _lbCloud=false;   // 云端是否真正可用（成功建客=真，否则仅本地）
let _emailLinkPending=false; // 已发起邮箱绑定发送、等待链接/验证码确认
function setLbStatus(){
  const el=document.getElementById('lbStatus'); if(!el) return;
  if(_lbCloud) el.innerHTML='<span class="lb-dot cloud"></span>'+tr('☁ 云端已连接 · 提交将写入全球榜');
  else el.innerHTML='<span class="lb-dot local"></span>'+tr('💾 云端不可用 · 本次仅本地备份');
}
async function initLeaderboard(){
  setupCloudSaveUI();   // 启动即按运行环境切换云存档 UI（itch 隐藏绑定/恢复、显示本地存档提示）
  if(_sbInit) return _sbInit;
  const ok=await loadSupabaseScript();
  if(!ok || !window.supabase){ _lbCloud=false; setLbStatus(); return (_sbInit = Promise.resolve()); }
  try{
    _sb = supabase.createClient(SB_URL, SB_KEY);
    _sb.auth.onAuthStateChange((event, session)=>{
      const u = session && session.user;
      if(u && u.id) _sbUser = u;
      if(u && u.email){
        // 邮箱已在会话中（链接确认后回跳，或重载后同一匿名身份）→ 同步 profiles（邮箱 + 昵称）
        syncProfile(u);
        if(_emailLinkPending){
          _emailLinkPending=false;
          setBindStatus(tr('绑定成功！战绩已关联到该邮箱。'), 'ok');
          uploadSave(true);
          setTimeout(()=>{ const m=$('bindModal'); if(m) m.classList.remove('show'); }, 2600);
        }
        afterAuthEmail(u);
      }
    });
  }catch(e){ _sb=null; _lbCloud=false; setLbStatus(); return (_sbInit = Promise.resolve()); }
  // 优先复用已有会话：① 邮箱确认链接带 #access_token 回跳时直接拿到带 email 的会话；② 重载后保留同一匿名身份，使分数/埋点按同一用户累计
  let existing=null;
  try{ const s=await _sb.auth.getSession(); existing=s && s.data && s.data.session; }catch(_e){}
  if(existing && existing.user){
    _sbUser=existing.user; _lbCloud=true;
    if(existing.user.email){ syncProfile(existing.user); afterAuthEmail(existing.user); }
    setLbStatus(); return (_sbInit = Promise.resolve());
  }
  const anon = _sb.auth.signInAnonymously().then(({data})=>{
    if(data?.user){ _sbUser = data.user; _lbCloud=true; }
    else { _sbUser = {id: lbUid()}; _lbCloud=true; }
  }).catch(()=>{ _sbUser = {id: lbUid()}; _lbCloud=false; });
  _sbInit = sbTimeout(anon, 6000).then(()=>{ if(!_sbUser) _sbUser={id:lbUid()}; _lbCloud=_lbCloud && !!_sb; setLbStatus(); });
  return _sbInit;
}
async function submitLb(name){
  if(!RUN.endless) return null;   // 仅无尽/地狱模式更新排行榜；普通、困难只走云存档记数据，不碰排行榜（避免 score=0 覆盖高分）
  await initLeaderboard();
  const score = RUN.endless ? (RUN.best||RUN.score||0) : 0;
  const streak = RUN.streak||0;
  const mode = RUN.hard ? 'hell' : 'endless';
  let zd = 0; try{ ZODIACS.forEach((z,i)=>{ if(STATS.perIndex[i]?.win>0) zd++; }); }catch(e){}
  const ac = ACHIEVEMENTS.filter(a=>ACH.unlocked[a.id]).length;
  const uid = (_sbUser && _sbUser.id) || lbUid();   // 用真实匿名 auth id（与 RLS auth.uid() 一致，云端写入才不被拒）；无 _sb 时回退本地 uuid
  const entry = { player_name: name.slice(0,16), score, streak, zodiacs_defeated: zd, ach_unlocked: ac, user_id: uid, mode };
  if(!_sb){ writeLocalLb(entry); return tr('已记录到本地排行榜'); }
  try{
    const res = await sbTimeout(_sb.from('leaderboard').upsert(entry, { onConflict: 'user_id,mode' }), 6000);
    if(res && res.__timeout){ writeLocalLb(entry); return tr('已记录到本地排行榜'); }
    if(res && res.error){ writeLocalLb(entry); return tr('已记录到本地排行榜'); }
    try{ localStorage.setItem(LB_NAME_KEY, name); }catch(e){}
    try{ localStorage.setItem(LB_LAST_KEY+mode, String(score)); }catch(e){}   // 记下本次分数，自动提交守卫用
    return null;
  }catch(e){
    // 任何异常都不让调用方卡死：回落本地
    writeLocalLb(entry);
    return tr('已记录到本地排行榜');
  }
}
// 每局结束自动提交排行榜（仅无尽/地狱；不弹 toast、不拦游戏），玩家懒得手动提交时也能上榜
async function autoSubmitLb(){
  if(!window.PEEK_FEATURES || !window.PEEK_FEATURES.leaderboard) return;  // 平台关闭排行榜（通用 iframe）时不提交
  if(!RUN.endless) return;                 // 双保险：非无尽模式不提交
  const score = (RUN.best||RUN.score||0);
  if(score<=0) return;                     // 0 分（普通无尽失败）不提交，避免用 0 覆盖高分
  const mode = RUN.hard ? 'hell' : 'endless';
  let last=0; try{ last=+(localStorage.getItem(LB_LAST_KEY+mode)||0)||0; }catch(e){}
  if(score<=last) return;                  // 没比上次高就不重复提交，省 Supabase 配额 + 防回退
  let nm=''; try{ nm=(localStorage.getItem(LB_NAME_KEY)||'').trim(); }catch(e){}
  if(!nm) nm=tr('匿名玩家');               // 空昵称兜底，避免写出空名公开记录
  await submitLb(nm);                       // 等结果；成功会写 LB_LAST_KEY，失败静默回落本地
}
async function getLb(mode){
  await initLeaderboard();
  let data=[];
  if(_sb){
    try{
      let q = _sb.from('leaderboard').select('*');
      if(mode) q = q.eq('mode', mode);
      const res = await sbTimeout(q.order('score',{ascending:false}).limit(50), 6000);
      if(res && !res.__timeout && !res.error) data = res.data || [];
    }catch(e){ data=[]; }
  }
  // 合并本地记录（按 user_id 去重，取高分）
  const local = getLocalLb(mode);
  const merged = data.slice();
  local.forEach(r=>{ if(!merged.some(d=>d.user_id===r.user_id)){ merged.push(r); } });
  merged.sort((a,b)=>b.score-a.score);
  return merged.slice(0,50);
}
function escHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showLeaderboardSubmit(){
  const m=$('lbSubmitModal'); if(!m) return;
  let name=''; try{ name=localStorage.getItem(LB_NAME_KEY)||''; }catch(e){}
  $('lbNameInput').value=name;
  $('lbNameInput').placeholder=tr('输入昵称（1-16字）');
  const sc=RUN.endless?(RUN.best||RUN.score||0):0;
  const modeLabel=RUN.hard?tr('地狱模式'):tr('无尽模式');
  $('lbMyScore').textContent=tr('🎲 模式：{m} · 分数 {s} · 连胜 {st}',{m:modeLabel,s:sc,st:RUN.streak||0});
  m.classList.add('show');
}
// 排行榜提交弹窗的按钮绑定延迟到 bindCloudUI()（DOMContentLoaded 时 $ 已就绪，见文末）
let lbViewMode='endless';
async function showLeaderboard(){
  $('leaderboardModal').classList.add('show');
  setLbStatus();
  const b=$('lbBody'); b.innerHTML='<div class="lb-loading">'+tr('加载中…')+'</div>';
  const toggle=document.getElementById('lbModeToggle');
  if(toggle){
    toggle.querySelectorAll('.lb-mode-btn').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.mode===lbViewMode);
      btn.onclick=()=>{ lbViewMode=btn.dataset.mode; showLeaderboard(); };
    });
  }
  const data=await getLb(lbViewMode);
  if(!data||!data.length){ b.innerHTML='<div class="lb-loading">'+tr('暂无排行数据')+'</div>'; return; }
  const myId=(_sbUser && _sbUser.id) || lbUid();
  const top3=['🥇','🥈','🥉'];
  const modeTag = lbViewMode==='hell' ? '（'+tr('地狱模式')+'）' : '（'+tr('无尽模式')+'）';
  b.innerHTML='<div class="lb-mode-tag">'+modeTag+'</div><div class="lb-table"><div class="lb-row lb-hdr"><span class="lb-rr">#</span><span class="lb-rn">'+tr('玩家')+'</span><span class="lb-rs">'+tr('分数')+'</span><span class="lb-rk">'+tr('连胜')+'</span><span class="lb-rz">'+tr('生肖')+'</span><span class="lb-ra">'+tr('成就数')+'</span></div>'+data.map((r,i)=>{
    const rk=i<3?top3[i]:'#'+(i+1);
    const me=myId&&r.user_id===myId;
    return '<div class="lb-row'+(me?' lb-me':'')+'"><span class="lb-rr">'+rk+'</span><span class="lb-rn">'+escHtml(r.player_name)+'</span><span class="lb-rs">'+r.score+'</span><span class="lb-rk">'+r.streak+'</span><span class="lb-rz">'+(r.zodiacs_defeated||0)+'</span><span class="lb-ra">'+(r.ach_unlocked||0)+'</span></div>';
  }).join('')+'</div>';
}
// 排行榜/设置入口绑定延迟到 bindCloudUI()
/* 顶层绑定集中函数：延迟到 DOMContentLoaded 执行，确保 game.js 已加载、$ 已就绪。
   cloudSave.js 在 i18n→cloudSave→audio→game→gmPanel 顺序中先于 game.js，若顶层直接用 $ 会在加载期抛
   “$ is not defined”，导致本文件后续 let/function 全部落入 TDZ，连锁破坏分析埋点与排行榜绑定。 */
function bindCloudUI(){
  $('lbSubmitBackdrop').onclick=()=>{ $('lbSubmitModal').classList.remove('show'); };
  $('lbSubmitCancel').onclick=()=>{ $('lbSubmitModal').classList.remove('show'); };
  $('lbSubmitBtn').onclick=async()=>{
    const n=$('lbNameInput')?.value?.trim(); if(!n||n.length<1){ miniToast(tr('昵称不能为空')); return; }
    $('lbSubmitBtn').disabled=true; $('lbSubmitBtn').textContent=tr('提交中…');
    let e=null;
    try{ e=await submitLb(n); }
    catch(err){ e=tr('已记录到本地排行榜'); }
    // 无论成功/超时/失败：保证弹窗必关、按钮必复位，绝不卡死
    $('lbSubmitModal').classList.remove('show');
    $('lbSubmitBtn').disabled=false; $('lbSubmitBtn').textContent=tr('提交');
    if(e){ miniToast(e); return; }
    miniToast(tr('排行榜提交成功！'));
  };
  $('lbBackdrop').onclick=()=>{ $('leaderboardModal').classList.remove('show'); };
  $('lbClose').onclick=()=>{ $('leaderboardModal').classList.remove('show'); };
  $('setLb').onclick=()=>{ $('settings').classList.remove('show'); showLeaderboard(); };
}
function bindCloudUIAndFlush(){
  bindCloudUI();
  // 启动后延迟补发上次未成功的事件（网络恢复 / Supabase 限流缓解后自动补齐）
  setTimeout(flushAnalyticsQueue, 2000);
}
if (document.readyState === 'complete') bindCloudUIAndFlush();
else document.addEventListener('DOMContentLoaded', bindCloudUIAndFlush);

/* ===== 事件埋点（Supabase events 表；本地缓冲 + 失败补发 + 6s 超时，绝不卡 gameplay） ===== */
let analyticsSession = null;
const ANALYTICS_QUEUE_KEY = 'peek_analytics_queue';
const ANALYTICS_QUEUE_MAX = 200;   // 防止本地队列无限膨胀
function readAnalyticsQueue(){ try{ return JSON.parse(localStorage.getItem(ANALYTICS_QUEUE_KEY)||'[]'); }catch(e){ return []; } }
function writeAnalyticsQueue(q){ try{ localStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify(q)); }catch(e){} }
function enqueueAnalyticsEvent(rec){
  const q = readAnalyticsQueue();
  q.push(rec);
  if(q.length > ANALYTICS_QUEUE_MAX) q.splice(0, q.length - ANALYTICS_QUEUE_MAX);
  writeAnalyticsQueue(q);
}
async function flushAnalyticsQueue(){
  if(!window.PEEK_FEATURES || !window.PEEK_FEATURES.analytics) return;
  if(!_sbInit) await initLeaderboard();
  else await _sbInit;
  const uid = analyticsUid();
  if(!_sb || !uid) return;
  let q = readAnalyticsQueue();
  if(!q.length) return;
  let sent = 0;
  while(q.length > 0){
    const rec = q[0];
    rec.user_id = uid;
    rec.session_id = rec.session_id || '-';
    // 兼容旧队列：events 表无 ts 列，写入前剔除（也防止未来误加未知列）
    delete rec.ts;
    try{
      const res = await sbTimeout(_sb.from('events').insert(rec), 6000);
      if(res && !res.__timeout && !res.error){
        q.shift();
        sent++;
      } else {
        break;   // 发送失败或超时：保留剩余队列，下次再补发
      }
    }catch(e){ break; }
  }
  if(sent > 0) writeAnalyticsQueue(q);
}
function modeOf(){
  if(RUN && RUN.hard) return 'hell';
  if(RUN && RUN.endless) return 'endless';
  if(RUN && RUN.daily) return 'daily';
  return 'normal';
}
function analyticsUid(){
  // 匿名用户用真实 auth.id 写入（events RLS: user_id = auth.uid()）；离线则先入队，flush 时补 uid
  return (_sbUser && _sbUser.id) ? _sbUser.id : null;
}
async function trackEvent(type, payload){
  if(!window.PEEK_FEATURES || !window.PEEK_FEATURES.analytics) return;  // 平台关闭分析（通用 iframe）时所有埋点短路
  try{
    const rec = {
      session_id: analyticsSession ? analyticsSession.id : '-',
      event_type: type,
      payload: payload || {},
      app_version: window.PEEK_APP_VERSION || ''
    };
    enqueueAnalyticsEvent(rec);   // 先入本地队列
    await flushAnalyticsQueue();  // 再尝试发送（失败也不抛错）
  }catch(e){ /* 静默 */ }
}
function startAnalyticsSession(){
  if(!analyticsSession){
    analyticsSession = { id: 's_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7), startMs: performance.now(), levels: 0 };
    trackEvent('session_start', { mode: modeOf() });
  }
  analyticsSession.levels++;
}
function endAnalyticsSession(reason){
  if(!analyticsSession) return;
  const dur = Math.round(performance.now() - analyticsSession.startMs);
  trackEvent('session_end', { mode: modeOf(), duration_ms: dur, levels_played: analyticsSession.levels, reason: reason||'' });
  analyticsSession = null;
}

/* ===== 云存档（saves 表：一人一行整包 JSON，最后上传为准） =====
   只在「已绑定邮箱」时工作；未绑定时全部函数直接返回，行为与旧版一致。 */
const SAVE_KEYS = ['peek_stats','peek_ach','peek_ckpts','peek_hard_clear','peek_best_endless','peek_lb_name'];
const BIND_PENDING_KEY = 'peek_bind_pending';       // 已点「发送确认邮件」，等链接回跳
const RECOVER_PENDING_KEY = 'peek_recover_pending'; // 已点「发送登录链接」，等链接回跳后拉云端
const CLOUD_AT_KEY = 'peek_cloud_at';               // 本机最后一次成功上传的时间戳
let _cloudSyncT=null, _cloudBusy=false, _authEmailHandled=false;
function cloudBound(){ return !!(_sb && _sbUser && _sbUser.id && _sbUser.email); }
function cloudNick(){ try{ return localStorage.getItem(LB_NAME_KEY)||''; }catch(e){ return ''; } }
function syncProfile(u){
  // 注意：supabase-js 的查询构造器是惰性的，必须 .then() 才会真正发请求（旧代码漏了，所以 profiles 从没写进去）
  if(!_sb || !u || !u.id) return;
  const rec = { id: u.id };
  if(u.email){ rec.email = u.email; rec.linked_at = new Date().toISOString(); }
  const nm = cloudNick() || (u.user_metadata && u.user_metadata.display_name) || '';
  if(nm) rec.display_name = nm;
  try{ _sb.from('profiles').upsert(rec, { onConflict: 'id' }).then(()=>{}, ()=>{}); }catch(_e){}
}
function snapshotSave(){
  const d={}; SAVE_KEYS.forEach(k=>{ const v=lsGet(k); if(v!=null) d[k]=v; }); return d;
}
function applyCloudSave(d){
  if(!d || typeof d!=='object') return 0;
  let n=0;
  SAVE_KEYS.forEach(k=>{ if(typeof d[k]==='string'){ try{ localStorage.setItem(k, d[k]); n++; }catch(e){} } });
  // 内存态必须重载：STATS / ACH / RUN.best 都是启动时读出来的对象，不重载会被旧内存写回去
  try{ const s=loadStats(); if(s) STATS=s; }catch(e){}
  try{ ACH=loadAch(); }catch(e){}
  try{ RUN.best = +(lsGet('peek_best_endless')||0); }catch(e){}
  return n;
}
async function uploadSave(silent){
  if(!cloudBound()) return silent?null:tr('尚未绑定邮箱，无法上传');
  if(_cloudBusy) return null;
  _cloudBusy=true;
  const rec = { user_id:_sbUser.id, data:snapshotSave(), display_name:cloudNick()||null,
                app_version: window.PEEK_APP_VERSION||'', updated_at:new Date().toISOString() };
  try{
    const res = await sbTimeout(_sb.from('saves').upsert(rec, { onConflict:'user_id' }), 6000);
    _cloudBusy=false;
    if(!res || res.__timeout || res.error) return silent?null:tr('上传失败，请检查网络后重试');
    try{ localStorage.setItem(CLOUD_AT_KEY, String(Date.now())); }catch(e){}
    syncProfile(_sbUser);   // 昵称改了也一并同步到 profiles
    return null;
  }catch(e){ _cloudBusy=false; return silent?null:tr('上传失败，请检查网络后重试'); }
}
function scheduleCloudSync(){
  // 每局结束后自动上传一次（fire-and-forget，永不阻塞结算演出）；未绑定不做任何事
  if(!cloudBound()) return;
  if(_cloudSyncT){ clearTimeout(_cloudSyncT); _cloudSyncT=null; }
  _cloudSyncT=setTimeout(()=>{ _cloudSyncT=null; uploadSave(true); }, 1500);
}
async function downloadSave(){
  if(!cloudBound()) return { err: tr('尚未绑定邮箱，无法下载') };
  try{
    const res = await sbTimeout(_sb.from('saves').select('data,display_name,updated_at').eq('user_id', _sbUser.id).maybeSingle(), 6000);
    if(!res || res.__timeout || res.error) return { err: tr('下载失败，请检查网络后重试') };
    const row = res.data;
    if(!row || !row.data) return { err: tr('云端还没有存档，请先上传一次') };
    const n = applyCloudSave(row.data);
    if(row.display_name){ try{ localStorage.setItem(LB_NAME_KEY, row.display_name); }catch(e){} }
    return { ok:true, n, at: row.updated_at };
  }catch(e){ return { err: tr('下载失败，请检查网络后重试') }; }
}
function afterAuthEmail(u){
  // 链接回跳后只跑一次：绑定完成 → 上传；恢复进度 → 下载覆盖
  if(_authEmailHandled) return; _authEmailHandled=true;
  if(lsGet(BIND_PENDING_KEY)==='1'){
    try{ localStorage.removeItem(BIND_PENDING_KEY); }catch(e){}
    uploadSave(true).then(()=>{ miniToast(tr('邮箱绑定成功，本机进度已上传云端')); });
  }
  if(lsGet(RECOVER_PENDING_KEY)==='1'){
    try{ localStorage.removeItem(RECOVER_PENDING_KEY); }catch(e){}
    downloadSave().then(r=>{
      if(r && r.ok) miniToast(tr('已从云端取回进度（{n} 项）', {n:r.n}));
      else if(r && r.err) miniToast(r.err);
    });
  }
}

/* ===== 绑定邮箱（匿名用户 → 邮箱，跨设备保留战绩） ===== */
function showBindModal(){
  if(!CLOUD_SAVE_ENABLED){ miniToast(tr('进度自动保存于本浏览器')); return; }
  const m=$('bindModal'); if(!m) return;
  setBindStatus('', '');
  const nm=cloudNick() || ((_sbUser && _sbUser.user_metadata && _sbUser.user_metadata.display_name) || '');
  const nameInput=$('bindName'); if(nameInput) nameInput.value=nm;
  const bound=cloudBound();
  const un=$('bindUnbound'), bd=$('bindBound');
  if(un) un.style.display = bound ? 'none' : 'block';
  if(bd) bd.style.display = bound ? 'block' : 'none';
  if(bound){
    const info=$('bindBoundInfo');
    if(info){
      let at=''; try{ at=localStorage.getItem(CLOUD_AT_KEY)||''; }catch(e){}
      const when = at ? new Date(+at).toLocaleString() : tr('尚未上传');
      info.innerHTML = tr('已绑定：{e}', {e: escHtml(_sbUser.email)}) + '<br>' + tr('本机最后上传：{t}', {t: escHtml(when)});
    }
  } else {
    const em=$('bindEmail'); if(em){ em.placeholder=tr('请输入邮箱地址'); em.value=''; }
    const sd=$('bindSend'); if(sd){ sd.disabled=false; sd.textContent=tr('发送确认邮件'); }
  }
  m.classList.add('show');
}
function setBindStatus(msg, kind){
  const el=$('bindStatus'); if(!el) return;
  el.textContent = msg||''; el.className = 'bind-status' + (kind?(' '+kind):'');
}
async function bindEmailSend(){
  if(!_sb || !_sbUser){ setBindStatus(tr('云端暂不可用，请稍后再试'), 'err'); return; }
  const email = ($('bindEmail').value||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ setBindStatus(tr('请输入有效邮箱'), 'err'); return; }
  const nm=($('bindName')?.value||'').trim(); if(nm) try{ localStorage.setItem(LB_NAME_KEY, nm); }catch(e){}
  $('bindSend').disabled=true; $('bindSend').textContent=tr('发送中…');
  try{
    // data.display_name 会写进 auth 用户资料；profiles 表另外由 syncProfile 落库
    const { error } = await sbTimeout(_sb.auth.updateUser({ email, data: { display_name: nm||null } }, { emailRedirectTo: window.location.origin + window.location.pathname }), 6000);
    if(error){ setBindStatus(tr('发送失败：')+(error.message||error.code||'err'), 'err'); }
    else {
      _emailLinkPending=true;
      try{ localStorage.setItem(BIND_PENDING_KEY, '1'); }catch(e){}
      syncProfile(_sbUser);   // 先把昵称写进 profiles，不用等邮箱确认
      setBindStatus(tr('确认邮件已发送至 {e}，请前往邮箱点击链接完成绑定。', {e: email}), 'ok');
    }
  }catch(e){ setBindStatus(tr('发送失败，请重试'), 'err'); }
  finally{ $('bindSend').disabled=false; $('bindSend').textContent=tr('发送确认邮件'); }
}
// 绑定走邮件链接确认（{{ .ConfirmationURL }}），无需验证码，故无 verify 流程

/* ===== 恢复进度（新设备：用已绑定邮箱收登录链接 → 拉云端存档覆盖本机） ===== */
function showRecoverModal(){
  if(!CLOUD_SAVE_ENABLED){ miniToast(tr('进度自动保存于本浏览器')); return; }
  const m=$('recoverModal'); if(!m) return;
  setRecoverStatus('', '');
  const em=$('recoverEmail'); if(em){ em.placeholder=tr('请输入邮箱地址'); em.value=''; }
  const sd=$('recoverSend'); if(sd){ sd.disabled=false; sd.textContent=tr('发送登录链接'); }
  m.classList.add('show');
}
function setRecoverStatus(msg, kind){
  const el=$('recoverStatus'); if(!el) return;
  el.textContent = msg||''; el.className = 'bind-status' + (kind?(' '+kind):'');
}
async function recoverSend(){
  if(!_sb){ setRecoverStatus(tr('云端暂不可用，请稍后再试'), 'err'); return; }
  const email = ($('recoverEmail').value||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ setRecoverStatus(tr('请输入有效邮箱'), 'err'); return; }
  $('recoverSend').disabled=true; $('recoverSend').textContent=tr('发送中…');
  try{
    const { error } = await sbTimeout(_sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin + window.location.pathname, shouldCreateUser:false } }), 6000);
    if(error){ setRecoverStatus(tr('发送失败：')+(error.message||error.code||'err'), 'err'); }
    else {
      try{ localStorage.setItem(RECOVER_PENDING_KEY, '1'); }catch(e){}
      setRecoverStatus(tr('登录链接已发送至 {e}。点击链接回到游戏后，云端进度会自动覆盖本机。', {e: email}), 'ok');
    }
  }catch(e){ setRecoverStatus(tr('发送失败，请重试'), 'err'); }
  finally{ $('recoverSend').disabled=false; $('recoverSend').textContent=tr('发送登录链接'); }
}

function _bindOn(id, fn){ const el=$(id); if(el) el.onclick=fn; }
