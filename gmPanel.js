/* ===== GM 调试面板（仅测试用）=====
 * 开启：URL 加 ?gm=1（会记住）；关闭：?gm=0 或面板内「关闭 GM」。
 * 独立 overlay（z-index 9999），不进游戏弹窗优先级体系；跳关前强制关闭所有游戏弹窗（铁则#2）。
 * 不改动任何正式玩法逻辑，全部复用现有函数（checkOver/reset/resetRun/ckUnlock/unlock 等）。 */
(function(){
  try{
    const q=new URLSearchParams(location.search);
    if(q.get('gm')==='1') localStorage.setItem('peek_gm','1');
    if(q.get('gm')==='0') localStorage.removeItem('peek_gm');
    if(localStorage.getItem('peek_gm')!=='1') return;
  }catch(e){ return; }

  const GM_MODALS=['result','twist','roundbreak','awakenModal','deathstarModal','betModal','checkpointModal','challengeModal','dailyModal','jokerGiftModal','faceReveal'];
  function gmCloseModals(){ GM_MODALS.forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('show'); }); if(S){ S.pausedForBet=false; S.bet=null; } }
  function gmToast(m){ try{ miniToast('GM · '+m); }catch(e){} }
  function gmInBattle(){ return !!(S && !S.over); }

  /* 悬浮按钮 + 面板 */
  const fab=document.createElement('button');
  fab.id='gmFab'; fab.textContent='🛠'; fab.title='GM 面板';
  const panel=document.createElement('div');
  panel.id='gmPanel';
  const zops=ZODIACS.map((z,i)=>`<option value="${i}">${i}. ${z.emoji} ${z.name}</option>`).join('')+`<option value="99">🎭 小丑</option>`;
  panel.innerHTML=`
    <div class="gm-h">🛠 GM 面板 <span id="gmClose">✕</span></div>
    <div class="gm-sec">解锁</div>
    <div class="gm-row">
      <button id="gmUnlockAll">🔓 全解锁</button>
      <button id="gmWipe">🧹 清空进度</button>
    </div>
    <div class="gm-sec">战斗内</div>
    <div class="gm-row">
      <button id="gmKillDealer">⚔️ 秒杀庄家</button>
      <button id="gmSuicide">💀 自杀</button>
      <button id="gmHeal">❤️ 满血</button>
      <button id="gmDmgDealer">💔 庄家-1</button>
      <button id="gmDmgSelf">🩸 用户-1</button>
    </div>
    <div class="gm-row">
      <button id="gmPeek">👁 偷看+3</button>
      <button id="gmItems">🎁 道具+3</button>
      <button id="gmChamber">🔮 看弹序</button>
    </div>
    <div class="gm-sec">跳关</div>
    <div class="gm-row">
      <select id="gmZodiac">${zops}</select>
      <label class="gm-ck"><input type="checkbox" id="gmHard"> 困难</label>
      <button id="gmGo">⏭ 前往</button>
    </div>
    <div class="gm-sec">氛围调参（实时生效，存 peek_gm_params）</div>
    <div class="gm-pgroup">面具 · 大小与漂浮</div>
    <label class="gm-prow">面具大小 <input class="gm-range" type="range" data-k="mask.size" min="110" max="240" step="2"><span class="gm-pval"></span></label>
    <label class="gm-prow">浮动幅度 <input class="gm-range" type="range" data-k="mask.floatY" min="-30" max="0" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">浮动缩放 <input class="gm-range" type="range" data-k="mask.floatScale" min="0.9" max="1.15" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">浮动时长 <input class="gm-range" type="range" data-k="mask.dur" min="1" max="8" step="0.1"><span class="gm-pval"></span></label>
    <div class="gm-pgroup">面具 · 伪3D 摇头/左顾右盼</div>
    <label class="gm-prow">转动角度 <input class="gm-range" type="range" data-k="mask.rotY" min="0" max="45" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">横向位移 <input class="gm-range" type="range" data-k="mask.lookX" min="0" max="40" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">动作周期 <input class="gm-range" type="range" data-k="mask.dur3d" min="3" max="16" step="0.5"><span class="gm-pval"></span></label>
    <div class="gm-pgroup">枪支演出（开枪即见效果）</div>
    <label class="gm-prow">枪高·打庄家 <input class="gm-range" type="range" data-k="gun.dealer" min="20" max="75" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">枪高·打玩家 <input class="gm-range" type="range" data-k="gun.player" min="20" max="75" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">水平偏移 <input class="gm-range" type="range" data-k="gun.x" min="-120" max="120" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">枪缩放 <input class="gm-range" type="range" data-k="gun.scale" min="0.8" max="1.5" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">垂直偏移 <input class="gm-range" type="range" data-k="gun.y" min="-30" max="80" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">上升速度 <input class="gm-range" type="range" data-k="gun.rise" min="200" max="2000" step="50"><span class="gm-pval"></span></label>
    <div class="gm-pgroup">烛光</div>
    <label class="gm-prow">左半径 <input class="gm-range" type="range" data-k="candle.r1" min="60" max="420" step="5"><span class="gm-pval"></span></label>
    <label class="gm-prow">右半径 <input class="gm-range" type="range" data-k="candle.r2" min="60" max="420" step="5"><span class="gm-pval"></span></label>
    <label class="gm-prow">亮度基础 <input class="gm-range" type="range" data-k="candle.aBase" min="0" max="0.5" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">亮度增益 <input class="gm-range" type="range" data-k="candle.aGain" min="0" max="0.6" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">烛光高度 <input class="gm-range" type="range" data-k="candle.y1" min="0" max="0.4" step="0.01"><span class="gm-pval"></span></label>
    <div class="gm-pgroup">暗角</div>
    <label class="gm-prow">基础强度 <input class="gm-range" type="range" data-k="vignette.basePow" min="0" max="0.95" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">轮间增益 <input class="gm-range" type="range" data-k="vignette.roundGain" min="0" max="0.6" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">命中增益 <input class="gm-range" type="range" data-k="vignette.hitGain" min="0" max="0.6" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">内径 <input class="gm-range" type="range" data-k="vignette.innerR" min="0.1" max="0.6" step="0.01"><span class="gm-pval"></span></label>
    <div class="gm-pgroup">香灰</div>
    <label class="gm-prow">生成概率 <input class="gm-range" type="range" data-k="ash.prob" min="0" max="1" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">数量上限 <input class="gm-range" type="range" data-k="ash.max" min="0" max="160" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">大小最小 <input class="gm-range" type="range" data-k="ash.sizeMin" min="4" max="40" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">大小最大 <input class="gm-range" type="range" data-k="ash.sizeMax" min="4" max="60" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">透明度 <input class="gm-range" type="range" data-k="ash.alpha" min="0" max="1" step="0.01"><span class="gm-pval"></span></label>
    <label class="gm-prow">下落速度 <input class="gm-range" type="range" data-k="ash.vyMax" min="0.2" max="3" step="0.05"><span class="gm-pval"></span></label>
    <div class="gm-row gm-prow-btns">
      <button id="gmParamsReset" class="gm-pbtn">↺ 调参重置</button>
      <button id="gmParamsCopy" class="gm-pbtn">⧉ 复制配置</button>
    </div>
    <div class="gm-sec">布局（均可拖动）</div>
    <div class="gm-pgroup">面具位置</div>
    <label class="gm-prow">水平 X <input class="gm-range" id="gmMaskX" type="range" min="-160" max="160" step="1"><span class="gm-pval"></span></label>
    <label class="gm-prow">垂直 Y <input class="gm-range" id="gmMaskY" type="range" min="-260" max="260" step="1"><span class="gm-pval"></span></label>
    <div class="gm-pgroup">左上门派信息（名字 / 血条 / 道具栏）</div>
    <div class="gm-pnote">开启 GM 后可直接拖动：面具区、名字、血条、道具栏，四个模块各自独立保存</div>
    <div class="gm-row gm-prow-btns">
      <button id="gmLayoutReset" class="gm-pbtn">↺ 复位布局</button>
    </div>
    <div class="gm-sec">音效试听</div>
    <div class="gm-row gm-sfx">
      <button data-sfx="sfxShot">🔫</button><button data-sfx="sfxSpin">🔄</button>
      <button data-sfx="sfxAwaken">🌅</button><button data-sfx="sfxRaise">🎲</button>
      <button data-sfx="sfxTwist">🎭</button><button data-sfx="sfxVictory">🏆</button>
      <button data-sfx="sfxDealerLaugh">😈</button><button data-sfx="sfxHurt">🩸</button>
    </div>
    <div class="gm-row">
      <button id="gmOff" class="gm-danger">⛔ 关闭 GM 模式</button>
    </div>`;
  document.body.appendChild(fab);
  document.body.appendChild(panel);
  try{
    document.getElementById('dealerZone')?.classList.add('gm-pos');
    document.querySelectorAll('.di-block').forEach(el=>el.classList.add('gm-pos'));
  }catch(e){}
  fab.onclick=()=>panel.classList.toggle('show');
  panel.querySelector('#gmClose').onclick=()=>panel.classList.remove('show');
  const $g=id=>panel.querySelector('#'+id);

  /* 解锁 */
  $g('gmUnlockAll').onclick=()=>{
    CK_POINTS.forEach(ckUnlock);                                         // 存档点 5/8/11
    // 全解锁：12 生肖战绩全开（各模式 win/lose 与 normal/hard/endless/hell 均置位），小丑独立桶同样全开
    for(let i=0;i<RAW_ZODIACS.length;i++){
      const m=RAW_ZODIACS[i];
      if(m.id==='joker'){
        const j=STATS.joker=STATS.joker||{win:0,lose:0,modes:{normal:0,hard:0,endless:0,hell:0},firstWin:0,bullets:0};
        j.win=Math.max(j.win,1); j.lose=Math.max(j.lose,1);
        ['normal','hard','endless','hell'].forEach(k=>j.modes[k]=Math.max(j.modes[k],1));
      } else {
        const p=STATS.perIndex[i]=STATS.perIndex[i]||{win:0,lose:0,modes:{normal:0,hard:0,endless:0,hell:0},firstWin:0,bullets:0};
        p.win=Math.max(p.win,1); p.lose=Math.max(p.lose,1);
        ['normal','hard','endless','hell'].forEach(k=>p.modes[k]=Math.max(p.modes[k],1));
      }
    }
    STATS.hardClear=true;                                                  // 困难（普通击败辰龙的解锁标志）
    saveStats();                                                          // 持久化全部战绩 / 困难 / 小丑
    unlock('story_clear');                                                // 无尽（击败小丑成就）
    try{ unlock('joker'); }catch(e){}                                     // 小丑成就（真结局）
    try{ localStorage.setItem('peek_hard_clear','1'); }catch(e){}         // 地狱
    try{ updateEyesButtons(); }catch(e){}
    gmToast('已解锁：全部生肖战绩 / 小丑 / 存档点×3 / 困难 / 无尽 / 地狱 / 每日挑战');
  };
  $g('gmWipe').onclick=()=>{
    if(!confirm('GM：清空本机全部进度（成就/战绩/存档点/解锁/排行榜/馈赠）？')) return;
    const keys=[
      'peek_stats','peek_ach','peek_ach_seen','peek_ckpts','peek_hard_clear',
      'peek_ch_seen','peek_best_endless','peek_daily','peek_gifts_seen','peek_ms_seen',
      'peek_hints_seen','peek_lb_local','peek_lb_uid','peek_lb_name'
    ];
    keys.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
    // 立刻重置内存状态，即使页面没有成功 reload，UI 也立即表现为初始状态
    STATS={plays:0,wins:0,losses:0,perIndex:{},betProposed:0,betAccepted:0,betDeclined:0,peekTotal:0,itemTotal:0,roundTotal:0,zodiacDeaths:{}};
    ACH={unlocked:{},seen:{}};
    try{ updateEyesButtons(); }catch(e){}   // 立即隐藏存档点/轮回挑战按钮，无需等 reload
    gmToast('已清空，刷新页面生效'); setTimeout(()=>location.reload(), 800);
  };

  /* 战斗内 */
  $g('gmKillDealer').onclick=()=>{ if(!gmInBattle()) return gmToast('不在战斗中'); panel.classList.remove('show'); S.dhp=0; render(); checkOver(); };
  $g('gmSuicide').onclick=()=>{ if(!gmInBattle()) return gmToast('不在战斗中'); panel.classList.remove('show'); S.php=0; render(); checkOver(); };
  $g('gmHeal').onclick=()=>{ if(!gmInBattle()) return gmToast('不在战斗中'); S.php=S.phpMax; render(); gmToast('已满血'); };
  $g('gmDmgDealer').onclick=()=>{ if(!gmInBattle()) return gmToast('不在战斗中'); S.dhp=Math.max(0,S.dhp-1); render(); if(S.dhp<=0){ panel.classList.remove('show'); checkOver(); } };
  $g('gmDmgSelf').onclick=()=>{ if(!gmInBattle()) return gmToast('不在战斗中'); S.lastPhp=S.php; S.php=Math.max(0,S.php-1); render(); gmToast('用户血量 -1（'+S.php+'/'+S.phpMax+'）'); if(S.php===1 && S.lastPhp>1){ checkDeathStar(); return; } if(S.php<=0){ panel.classList.remove('show'); checkOver(); } };
  $g('gmPeek').onclick=()=>{ if(!gmInBattle()) return gmToast('不在战斗中'); S.peekUnlocked=true; RUN.peekUnlocked=true; S.peekMax+=3; render(); gmToast('偷看已解锁，次数 +3'); };
  $g('gmItems').onclick=()=>{
    if(!gmInBattle()) return gmToast('不在战斗中');
    S.itemsUnlocked=true; RUN.itemsUnlocked=true;
    const pool=poolFor(RUN.index); let n=0;
    while(n<3 && S.itemsPlayer.length<5){ S.itemsPlayer.push(pool[Math.floor(Math.random()*pool.length)]); n++; }
    render(); gmToast('道具 +'+n);
  };
  $g('gmChamber').onclick=()=>{
    if(!gmInBattle()) return gmToast('不在战斗中');
    const rest=S.chamber.slice(S.pos).map(s=>s===LIVE?'🔴':'⚪').join(' ');
    log('<b>GM 弹序（当前→末尾）：'+rest+'</b>'); gmToast('弹序已写入日志');
  };

  /* 跳关（强制：先关所有游戏弹窗，再重开一局） */
  $g('gmGo').onclick=()=>{
    const v=+$g('gmZodiac').value, hard=$g('gmHard').checked;
    gmCloseModals(); panel.classList.remove('show');
    try{ stopHeart(); }catch(e){}
    resetRun();
    RUN.hard=hard;
    if(v===99){ RUN.index=ZODIACS.length-1; RUN.isJoker=true; RUN.zodiac=JOKER; }
    else { RUN.index=v; RUN.zodiac=ZODIACS[v]; }
    if(v!==0){ RUN.peekUnlocked=true; RUN.itemsUnlocked=true; }
    hideIntroToGame();
    reset();
    gmToast('已跳转：'+(v===99?'🎭 小丑':RUN.zodiac.emoji+' '+zDisp(RUN.zodiac))+(hard?'（困难）':''));
  };

  /* 音效试听 */
  panel.querySelectorAll('[data-sfx]').forEach(b=>b.onclick=()=>{
    audio();
    const fn=b.dataset.sfx;
    try{ fn==='sfxHurt' ? sfxHurt('player') : window[fn](); }catch(e){ gmToast(fn+' 播放失败'); }
  });

  /* 氛围调参滑块：实时写 PEEK_DEBUG / CSS 变量，存 peek_gm_params（与 GM 开关 peek_gm 分离） */
  const DM=window.PEEK_DEBUG;
  /* 布局：面具区 + 名字/血/道具三个模块，各自独立拖动/调位，同存 peek_gm_params.layout */
  const GM_LAYOUT_DEFAULT={
    mask:{x:0,y:0},
    name:{x:12,y:10},
    hp:{x:12,y:40},
    items:{x:12,y:70}
  };
  function gmLoadLayout(){
    try{
      const s=localStorage.getItem('peek_gm_params');
      if(s){
        const p=JSON.parse(s);
        if(p&&p.layout) return Object.assign(deepClone(GM_LAYOUT_DEFAULT), p.layout);
        // 兼容旧版：只有 info 字段时，把旧位置迁移到三个模块
        if(p&&p.info && typeof p.info.x==='number' && typeof p.info.y==='number'){
          const {x,y}=p.info;
          return {mask:{x:0,y:0}, name:{x,y}, hp:{x,y:y+30}, items:{x,y:y+60}};
        }
      }
    }catch(e){}
    return deepClone(GM_LAYOUT_DEFAULT);
  }
  let GM_LAYOUT=gmLoadLayout();
  function gmApplyLayout(){
    const r=document.documentElement.style;
    r.setProperty('--mask-x', (GM_LAYOUT.mask.x||0)+'px');
    r.setProperty('--mask-y', (GM_LAYOUT.mask.y||0)+'px');
    r.setProperty('--di-name-x', (GM_LAYOUT.name.x||12)+'px');
    r.setProperty('--di-name-y', (GM_LAYOUT.name.y||10)+'px');
    r.setProperty('--di-hp-x', (GM_LAYOUT.hp.x||12)+'px');
    r.setProperty('--di-hp-y', (GM_LAYOUT.hp.y||40)+'px');
    r.setProperty('--di-items-x', (GM_LAYOUT.items.x||12)+'px');
    r.setProperty('--di-items-y', (GM_LAYOUT.items.y||70)+'px');
  }
  function gmApplyMask(){
    const r=document.documentElement.style;
    r.setProperty('--mask-float-y', DM.mask.floatY+'px');
    r.setProperty('--mask-float-scale', DM.mask.floatScale);
    r.setProperty('--mask-float-dur', DM.mask.dur+'s');
    const sz=DM.mask.size||172;
    r.setProperty('--mask-size', sz+'px');
    r.setProperty('--mask-img', Math.round(sz*0.92)+'px');
    r.setProperty('--mask-3d-rot', (DM.mask.rotY||24)+'deg');
    r.setProperty('--mask-3d-x', (DM.mask.lookX||16)+'px');
    r.setProperty('--mask-3d-dur', (DM.mask.dur3d||9)+'s');
  }
  function gmApplyGun(){
    const r=document.documentElement.style;
    const g=DM.gun||{};
    r.setProperty('--gun-x', (g.x==null?0:g.x)+'px');
    r.setProperty('--gun-scale', g.scale==null?1.12:g.scale);
    r.setProperty('--gun-y', (g.y==null?20:g.y)+'%');
    r.setProperty('--rise', (g.rise==null?RISE_MS:g.rise)+'ms');
  }
  function gmSaveParams(){
    try{ localStorage.setItem('peek_gm_params', JSON.stringify({candle:DM.candle,vignette:DM.vignette,ash:DM.ash,mask:DM.mask,gun:DM.gun,layout:GM_LAYOUT})); }catch(e){}
  }
  function gmFmt(v){ return (typeof v==='number' && !Number.isInteger(v)) ? (+v.toFixed(2)) : v; }
  panel.querySelectorAll('input.gm-range').forEach(inp=>{
    if(!inp.dataset.k) return; /* 面具/布局滑块无 data-k，单独处理 */
    const [grp,key]=inp.dataset.k.split('.');
    inp.value = DM[grp][key];
    const val=inp.parentElement.querySelector('.gm-pval');
    if(val) val.textContent=gmFmt(DM[grp][key]);
    inp.addEventListener('input',()=>{
      const nv=parseFloat(inp.value);
      DM[grp][key]=nv;
      if(val) val.textContent=gmFmt(nv);
      if(grp==='mask') gmApplyMask();
      if(grp==='gun') gmApplyGun();
      gmSaveParams();
    });
  });
  gmApplyMask();
  gmApplyGun();
  gmApplyLayout();
  /* 面具位置滑块 + 所有模块拖动定位 */
  const gmMaskX=$g('gmMaskX'), gmMaskY=$g('gmMaskY');
  function gmLayoutSyncSliders(){
    if(gmMaskX){ gmMaskX.value=GM_LAYOUT.mask.x; const v=gmMaskX.parentElement.querySelector('.gm-pval'); if(v) v.textContent=GM_LAYOUT.mask.x+'px'; }
    if(gmMaskY){ gmMaskY.value=GM_LAYOUT.mask.y; const v=gmMaskY.parentElement.querySelector('.gm-pval'); if(v) v.textContent=GM_LAYOUT.mask.y+'px'; }
  }
  gmLayoutSyncSliders();
  if(gmMaskX) gmMaskX.addEventListener('input',()=>{ GM_LAYOUT.mask.x=+gmMaskX.value; const v=gmMaskX.parentElement.querySelector('.gm-pval'); if(v) v.textContent=GM_LAYOUT.mask.x+'px'; gmApplyLayout(); gmSaveParams(); });
  if(gmMaskY) gmMaskY.addEventListener('input',()=>{ GM_LAYOUT.mask.y=+gmMaskY.value; const v=gmMaskY.parentElement.querySelector('.gm-pval'); if(v) v.textContent=GM_LAYOUT.mask.y+'px'; gmApplyLayout(); gmSaveParams(); });
  const gLayoutReset=$g('gmLayoutReset'); if(gLayoutReset) gLayoutReset.onclick=()=>{ GM_LAYOUT=deepClone(GM_LAYOUT_DEFAULT); gmApplyLayout(); gmSaveParams(); gmLayoutSyncSliders(); };
  /* 通用拖动：dealerZone（面具区）+ 三个 info 模块 */
  const gameEl=document.getElementById('game');
  function gmMakeDraggable(el, key){
    if(!el||!gameEl) return;
    let dg=false, psx=0, psy=0, oX=0, oY=0;
    const isMask=(key==='mask');
    const dMove=e=>{
      if(!dg) return;
      const gw=gameEl.getBoundingClientRect();
      const dx=e.clientX-psx, dy=e.clientY-psy;
      let nx=oX+dx, ny=oY+dy;
      if(isMask){
        nx=Math.max(-gw.width/2, Math.min(gw.width/2, nx));
        ny=Math.max(-gw.height, Math.min(gw.height, ny));
      }else{
        nx=Math.max(0, Math.min(gw.width-40, nx));
        ny=Math.max(0, Math.min(gw.height-40, ny));
      }
      GM_LAYOUT[key].x=Math.round(nx); GM_LAYOUT[key].y=Math.round(ny);
      gmApplyLayout(); gmLayoutSyncSliders();
    };
    const dEnd=()=>{ if(dg){ dg=false; gmSaveParams(); } };
    el.addEventListener('pointerdown',e=>{
      dg=true; try{ el.setPointerCapture(e.pointerId); }catch(_){}
      psx=e.clientX; psy=e.clientY; oX=GM_LAYOUT[key].x; oY=GM_LAYOUT[key].y; e.preventDefault();
    });
    el.addEventListener('pointermove',dMove);
    el.addEventListener('pointerup',dEnd);
    el.addEventListener('pointercancel',dEnd);
  }
  gmMakeDraggable(document.getElementById('dealerZone'), 'mask');
  gmMakeDraggable(document.getElementById('diName'), 'name');
  gmMakeDraggable(document.getElementById('diHp'), 'hp');
  gmMakeDraggable(document.getElementById('diItems'), 'items');
  const pReset=$g('gmParamsReset'); if(pReset) pReset.onclick=()=>{
    Object.assign(DM.candle, PEEK_DEBUG_DEFAULT.candle);
    Object.assign(DM.vignette, PEEK_DEBUG_DEFAULT.vignette);
    Object.assign(DM.ash, PEEK_DEBUG_DEFAULT.ash);
    Object.assign(DM.mask, PEEK_DEBUG_DEFAULT.mask);
    Object.assign(DM.gun, PEEK_DEBUG_DEFAULT.gun);
    gmApplyMask(); gmApplyGun(); gmSaveParams();
    panel.querySelectorAll('input.gm-range').forEach(inp=>{
      if(!inp.dataset.k) return;
      const [grp,key]=inp.dataset.k.split('.'); inp.value=DM[grp][key];
      const val=inp.parentElement.querySelector('.gm-pval'); if(val) val.textContent=gmFmt(DM[grp][key]);
    });
  };
  const pCopy=$g('gmParamsCopy'); if(pCopy) pCopy.onclick=()=>{
    const txt=JSON.stringify({mask:DM.mask,gun:DM.gun,candle:DM.candle,vignette:DM.vignette,ash:DM.ash},null,2);
    try{ navigator.clipboard.writeText(txt); pCopy.textContent='已复制'; setTimeout(()=>pCopy.textContent='⧉ 复制配置',1200); }catch(e){ gmToast('复制失败'); }
  };

  /* 关闭 GM */
  $g('gmOff').onclick=()=>{ try{ localStorage.removeItem('peek_gm'); }catch(e){} location.href=location.pathname; };
})();
