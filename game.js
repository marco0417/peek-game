const $=id=>document.getElementById(id);
const LIVE='live', BLANK='blank';
// Toast / 回合提示时序常量（单一真相源，避免散落硬编码延迟值）：
// TOAST_ANIM = shotToastSlide 动画时长；RELOAD_DELAY = 装弹后提示延迟（等装弹遮罩走完）；
// HANDOVER_DELAY = 换手提示延迟（等枪图降下）；DEALER_AFTER_* = 庄家回合整体延后到提示飞完再开始。
const TOAST_ANIM=3400;
const TOAST_RELOAD_DELAY=3000;
const TOAST_HANDOVER_DELAY=650;
const DEALER_AFTER_RELOAD=TOAST_RELOAD_DELAY+TOAST_ANIM;            // 6400
const DEALER_AFTER_HANDOVER=TOAST_HANDOVER_DELAY+TOAST_ANIM+150;    // ≈4200
// 游戏版本号（与 package.json 对齐），显示在设置面板底部。
// 单一真相源：src/main.js 构建期注入 window.PEEK_APP_VERSION（vite define PEEK_VERSION），
// 并静态写入 index.html meta[app-version]；此处兜底依次取 全局变量 → meta → 字面量，杜绝硬编码版本漂移（§1 坑）。
const APP_VERSION=(typeof window!=='undefined' && window.PEEK_APP_VERSION)
  || (function(){ try{ const m=document.querySelector('meta[name="app-version"]'); return m?m.getAttribute('content'):null; }catch(e){ return null; } })()
  || '2.3.0';
const PEEK_WINDOWS=[2000,1500,1000]; // 第1/2/3次偷看窗口(ms): 即警觉槽从0涨满的时间
const PEEK_MAX=3;
let S, raf, peekStart, curWin, lastBeat=0, beatPulse=0, AC=null, INPUT_MODE='button', idleTimer=null, BGM=null, bgmMuted=false, sfxMuted=false, heartTimer=null, heartInterval=560, TENSION=0, ambiTimer=null, pendingBluffBoost=false, typingInterval=null, typingDone=null;
try{
  const bm=localStorage.getItem('peek_bgm_mute');
  const sm=localStorage.getItem('peek_sfx_mute');
  if(bm!==null) bgmMuted=bm==='1';
  if(sm!==null) sfxMuted=sm==='1';
}catch(e){}
// §8 防御：localStorage 在隐私模式 / 部分 webview 会抛错，所有直读写必须走 try/catch。
// 这里集中提供安全读写，避免「一行 localStorage 抛错导致整个脚本初始化失败」的崩页。
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

/* 顺序：卯兔(教学·无道具) → … → 未羊(强·后移) → 寅虎(次终) → 辰龙(最终Boss)
   难度/道具随 index 递增；lines 为各庄家按情境的个性对话；drop 为击败后掉落的遗物 */
/* ===== 生肖/庄家数据：文案外置 src/locales/{zh-CN,en}.json，构建时内联为 PEEK_STRINGS ===== */
function loadZodiac(){
  const S=(typeof PEEK_STRINGS!=='undefined')?PEEK_STRINGS:null;
  if(!S||!S.zh||!S.zh.zodiac) return [];
  const lang=(typeof PEEK_LANG!=='undefined')?PEEK_LANG:'zh';
  const zh=S.zh.zodiac;
  const cur=(lang!=='zh'&&S[lang]&&S[lang].zodiac)?S[lang].zodiac:null;
  if(!cur) return zh;
  return zh.map((z,i)=> cur[i]?deepMerge(z,cur[i]):z);
}
function deepMerge(a,b){
  const o=Array.isArray(a)?a.slice():Object.assign({},a);
  for(const k in b){
    if(b[k]===null||b[k]===undefined) continue;
    const av=a[k],bv=b[k];
    if(bv&&typeof bv==='object'&&!Array.isArray(bv)&&av&&typeof av==='object'&&!Array.isArray(av)) o[k]=deepMerge(av,bv);
    else o[k]=bv;
  }
  return o;
}
function zDisp(z){
  if(!z) return '';
  const lang=(typeof PEEK_LANG!=='undefined')?PEEK_LANG:'zh';
  if(lang==='en') return z.ename||z.name||'';
  if(lang==='zh-TW') return z.tname||z.name||'';
  if(lang==='ja') return z.eja||z.name||'';
  if(lang==='ko') return z.eko||z.name||'';
  if(lang==='ru') return z.eru||z.name||'';
  if(lang==='es') return z.ees||z.name||'';
  if(lang==='fr') return z.efr||z.name||'';
  if(lang==='de') return z.ede||z.name||'';
  return z.name||'';
}
// 面具图片：生肖/小丑面具以 WebP 资源呈现（assets/masks/{id}.webp），加载失败回退 emoji
function peekMaskImg(z){
  const id=z&&z.id, fb=(z&&z.emoji)||'❓';
  if(!id) return fb;
  // 面具 WebP 约 47–82KB（512px），全部 eager 加载；wrapper 把 emoji 放在 img 背后，
  // 网络抖动导致失败时不会空白，而是显示 emoji；重试成功后自动切回图片。
  // 回退层填入 emoji 文本：WebP 加载失败（含 itch 上 rooster.webp 404）时 .fail 类让其显形，避免空白黑圆
  return `<span class="zmask-wrap"><img class="zmask-img" src="assets/masks/${id}.webp" alt="${fb}" data-id="${id}" data-fb="${fb}" decoding="async" loading="eager" onerror="peekMaskFail(this)" onload="peekMaskOk(this)"><span class="zmask-fb">${fb}</span></span>`;
}
// 复用已存在的面具 img：仅当面具 id 变化时才重建 DOM，避免 intro stage 切换时缓存命中仍闪烁（B2 修复）。
// 真正的防加载失败保护是 peekMaskImg 里的 emoji fallback，与此处的复用判断互不冲突。
function setMaskInto(el, z){
  if(!el) return;
  const cur = el.querySelector('.zmask-img');
  if(!cur || cur.dataset.id !== (z && z.id)) el.innerHTML = peekMaskImg(z);
}
// 空闲预取：首屏只加载当前庄家面具，其余生肖/小丑面具在浏览器空闲时后台预取（写入 HTTP 缓存），
// 切庄家/进 intro 时不闪空白。requestIdleCallback 不存在（旧 Safari）时回退 setTimeout。
let _peekMasksPrefetched=false;
function peekPrefetchMasks(){
  if(_peekMasksPrefetched) return; _peekMasksPrefetched=true;
  const ids=(typeof RAW_ZODIACS!=='undefined'?RAW_ZODIACS:[]).map(z=>z.id).filter(Boolean);
  if(!ids.length) return;
  const ric=(window.requestIdleCallback)||function(cb){return setTimeout(cb,200);};
  ric(function(){
    for(const id of ids){
      try{ const im=new Image(); im.decoding='async'; im.src='assets/masks/'+id+'.webp'; }catch(e){}
    }
  });
}
// 全局：面具图片加载失败时多次重试（弱网/抖动容错），全部失败才显示 fallback；加载成功移除 fail 标记。
window.peekMaskFail=function(img){
  if(!img) return;
  const wrap=img.closest('.zmask-wrap');
  const MAX_RETRY=3;
  const retry=+(img.dataset.retry||0);
  if(retry<MAX_RETRY && img.dataset.id){
    img.dataset.retry=String(retry+1);
    // 递增延迟重试，给弱网恢复时间（非演出链，不影响后台冻结逻辑）
    setTimeout(()=>{ if(img) img.src='assets/masks/'+img.dataset.id+'.webp?r='+Date.now()+'&t='+retry; }, 500*retry);
    return;
  }
  if(wrap) wrap.classList.add('fail');
};
window.peekMaskOk=function(img){
  if(!img) return;
  img.dataset.retry='';
  const wrap=img.closest('.zmask-wrap');
  if(wrap) wrap.classList.remove('fail');
};
const RAW_ZODIACS=loadZodiac();
const JOKER=RAW_ZODIACS.find(z=>z.id==='joker') || {};
const ZODIACS=RAW_ZODIACS.filter(z=>z.id!=='joker' && z.name!=='小丑');
// 数据就绪后空闲预取全部面具（见 peekPrefetchMasks 定义）
peekPrefetchMasks();
/* ===== 道具 / 困难能力 / 成就 等结构化文案：同样从 PEEK_STRINGS 加载（按当前语言合并 zh+当前非zh语言） ===== */
function _curLang(){ return (typeof PEEK_LANG!=='undefined')?PEEK_LANG:'zh'; }
function _loadObj(key){
  const S=(typeof PEEK_STRINGS!=='undefined')?PEEK_STRINGS:null;
  const zh=(S&&S.zh&&S.zh[key])||{};
  const lang=_curLang();
  const cur=(lang!=='zh'&&S[lang]&&S[lang][key])?S[lang][key]:null;
  const out={};
  for(const k in zh){
    if(typeof zh[k]==='string'){ out[k]=(cur&&cur[k]!==undefined)?cur[k]:zh[k]; }
    else { out[k]=(cur&&cur[k]!==undefined)?deepMerge(zh[k],cur[k]):zh[k]; }
  }
  return out;
}
function _loadArr(key){
  const S=(typeof PEEK_STRINGS!=='undefined')?PEEK_STRINGS:null;
  const zh=(S&&S.zh&&S.zh[key])||[];
  const lang=_curLang();
  const cur=(lang!=='zh'&&S[lang]&&S[lang][key])?S[lang][key]:null;
  if(!cur||!cur.length) return zh;
  const m={}; cur.forEach(x=>{ if(x&&x.id!=null) m[x.id]=x; });
  return zh.map(x=> (x&&x.id!=null&&m[x.id])?deepMerge(x,m[x.id]):x);
}
function ag(g){ // 成就分组名（多语）
  const S=(typeof PEEK_STRINGS!=='undefined')?PEEK_STRINGS:null;
  if(!S) return g;
  const lang=_curLang();
  if(lang!=='zh' && S[lang] && S[lang].achGroups && S[lang].achGroups[g]!==undefined) return S[lang].achGroups[g];
  if(S.zh && S.zh.achGroups && S.zh.achGroups[g]!==undefined) return S.zh.achGroups[g];
  return g;
}


/* ===== 生肖 AI 性格参数（影响决策，不做硬性倒计时） ===== */
const ROUND_BREAK={
  'rabbit':['这一轮……算你运气好。下一轮，我可不会手下留情了。'],
  'horse':['又让你多喘几口！下一发，老子直接崩了你！'],
  'monkey':['哟，又活过一轮？下一轮我骗你连亲妈都不认～'],
  'rat':['多活一轮而已。子时还长，这笔账，慢慢算。'],
  'snake':['你又多活了一轮。可惜，下一轮我不会再让你看清弹道。'],
  'rooster':['天亮前你还得死！这一轮，算你偷来的。'],
  'dog':['叫你多活一轮。下一轮，我咬碎你的心。'],
  'ox':['力气，我还没使完。下一轮，因果轮到你头上。'],
  'pig':['又多一口活气。下一盘，你就是我的菜。'],
  'goat':['（轻声）又让你活过一轮啦。下一轮，我保证骗到你哭（才不）。'],
  'tiger':['呸！又让你多活一轮。下一轮，老子连皮带骨吞了你！'],
  'dragon':['凡人又苟活一轮。下一轮，我让你见识何为天命。']
};
/* 下一局弹仓预告台词 —— 由生肖亲口说出，替代干巴巴的数字 */
function zbreakPreview(live,blank){
  const z=RUN.zodiac.id;
  const dict={
    'rabbit': live>=3
      ? `让我找找子弹……哦，这次有 {live} 个实弹呢。我们下一轮的进度会加速了，嘿嘿。`
      : `下一轮只有 {live} 个实弹……看来还得再陪你玩一会儿。`,
    'horse': live>=3
      ? `哈！下一仓 {live} 发实弹，够把你钉在墙上。`
      : `下一轮实弹才 {live} 发？不过也够把你掀下马。`,
    'monkey': live>=3
      ? `下一仓 {live} 红 {blank} 白，猜猜我会把哪颗塞进你嘴里？`
      : `下一轮实弹不多，但骗你打自己，一颗就够了。`,
    'rat': live>=3
      ? `（窸窣）我数过了，{live} 颗实弹。你逃不掉的。`
      : `下一轮只有 {live} 颗实弹……那就慢慢啃你的心。`,
    'snake': live>=3
      ? `下一仓，{live} 颗毒牙。你越是躲，咬得越紧。`
      : `实弹虽只有 {live} 颗，但蛇的耐心，比你命长。`,
    'rooster': live>=3
      ? `报时——下一仓 {live} 发实弹！你的死期又近了。`
      : `下一轮 {live} 发实弹，够你数完最后几声鸡啼。`,
    'dog': live>=3
      ? `闻到火药味了吗？{live} 发实弹，下一口就咬穿你。`
      : `下一仓 {live} 发实弹，我会慢慢把你逼到墙角。`,
    'ox': live>=3
      ? `下一仓 {live} 发实弹。因果沉重，你扛不住。`
      : `实弹 {live} 发，不多，但牛蹄踏下，从无落空。`,
    'pig': live>=3
      ? `下一盘菜里有 {live} 颗硬货，够把你嚼碎。`
      : `下一轮才 {live} 发实弹？那就先把你养肥再下刀。`,
    'goat': live>=3
      ? `（数子弹）{live} 颗实弹……下一轮，你可别哭哦。`
      : `下一轮实弹 {live} 颗，温柔点，也未尝不是一种折磨。`,
    'tiger': live>=3
      ? `下一仓 {live} 发实弹！老子要撕碎你！`
      : `才 {live} 发实弹？哼，虎爪下你照样活不过三轮。`,
    'dragon': live>=3
      ? `下一仓 {live} 发真火。凡人，你还能躲几次天命？`
      : `实弹 {live} 发……本尊便多看你挣扎片刻。`
  };
  return tr(dict[z]||`下一仓 {live} 实弹 {blank} 空包。`, {live, blank});
}
const RB_RETORTS=[
  '要死的是你','谁输谁赢还不知道','不服就干','继续啊','下一轮看谁倒',
  '子时还没过完','你也就嘴硬','下一轮我拆了你的局','行，继续'
];
const AI_DEFAULT={blankSelf:0.8, livePlayer:0.8, bluff:0.30, thinkMs:700, heal:false};
// 困难专属实弹攻击性减免（Marco 2026-08-04：降 livePlayer 抬 hard；仅 RUN.hard 生效，普通/无尽不变；hell=hard+endless 一并受益）。floor 0.45 与 mercy 对齐。
const HARD_LP_RELIEF=0.15;
const ZODIAC_AI={
  // 卯兔=教学关：实弹时也会偶尔对自己开枪(仁慈)，让新手稳妥过关
  'rabbit':{blankSelf:0.92, livePlayer:0.45, bluff:0.22, thinkMs:820},
  'horse':{blankSelf:0.93, livePlayer:0.70, bluff:0.20, thinkMs:420},
  'monkey':{blankSelf:0.80, livePlayer:0.75, bluff:0.62, thinkMs:560},
  'rat':{blankSelf:0.82, livePlayer:0.6,  bluff:0.48, thinkMs:640, heal:true},
  'snake':{blankSelf:0.88, livePlayer:0.78, bluff:0.52, thinkMs:780},
  'rooster':{blankSelf:0.82, livePlayer:0.82, bluff:0.34, thinkMs:600},
  'dog':{blankSelf:0.80, livePlayer:0.85, bluff:0.28, thinkMs:580},
  'ox':{blankSelf:0.70, livePlayer:0.6,  bluff:0.12, thinkMs:780},
  'pig':{blankSelf:0.80, livePlayer:0.82, bluff:0.26, thinkMs:700, heal:true},
  'goat':{blankSelf:0.86, livePlayer:0.66, bluff:0.74, thinkMs:700},
  'tiger':{blankSelf:0.60, livePlayer:0.93, bluff:0.40, thinkMs:480},
  'dragon':{blankSelf:0.76, livePlayer:0.88, bluff:0.55, thinkMs:880, heal:true},
  'joker':{blankSelf:0.55, livePlayer:0.95, bluff:0.85, thinkMs:420, heal:true}
};
function curAI(){ const ai=Object.assign({}, AI_DEFAULT, ZODIAC_AI[RUN.zodiac.id]||{}); if(RUN.mercyLivePlayer!=null) ai.livePlayer=RUN.mercyLivePlayer; if(RUN.hard) ai.livePlayer=Math.max(0.45, ai.livePlayer-HARD_LP_RELIEF); return ai; }
/* ===== 困难模式 · 12生肖直白能力（RUN.hard 时生效；地狱=困难+无尽 叠加） ===== */
const HARD_ABILITIES=_loadObj('hardAbilities');
function hardAbility(){ return RUN.hard ? HARD_ABILITIES[RUN.zodiac.id]||null : null; }
/* 解锁判定：困难=击败辰龙；无尽=击败小丑（story_clear）；地狱=困难模式通关小丑 */
function hardUnlocked(){ try{ return !!STATS.hardClear; }catch(e){ return false; } }
function endlessUnlocked(){ try{ return !!ACH.unlocked['story_clear']; }catch(e){ return false; } }
function hellUnlocked(){ try{ return localStorage.getItem('peek_hard_clear')==='1'; }catch(e){ return false; } }
/* 存档点：击败 5(酉鸡)/8(亥猪)/11(辰龙) 后解锁「从该生肖开始」 */
const CK_POINTS=[2,5,8,11];
const JOKER_GIFT_IDX=[5,8];   // 小丑送礼白名单（申猴=纯存档点，不送礼；辰龙原回魂礼物已移除 v2.7.55）
function ckUnlocked(){ try{ return JSON.parse(localStorage.getItem('peek_ckpts')||'[]'); }catch(e){ return []; } }
function ckUnlock(idx){ try{ const a=ckUnlocked(); if(!a.includes(idx)){ a.push(idx); localStorage.setItem('peek_ckpts', JSON.stringify(a)); } }catch(e){} }
let RUN={index:0, zodiac:ZODIACS[0], isJoker:false, peekUnlocked:false, itemsUnlocked:false, itemPulseDone:false, playerItems:[], lastDrop:[], betIntroduced:{},
  endless:false, endlessTier:0, streak:0, score:0, best:+(lsGet('peek_best_endless')||0),
  hard:false, giftPeek:false, mercyLivePlayer:null, giftsGiven:{}};
function endlessMult(){ return Math.min(5, 1 + RUN.streak*0.25); }   // 连胜倍率（封顶 ×5）
/* ===== 道具系统 (双方各自桌面, 按生肖进度各自发放) ===== */
const PROPS=_loadObj('props');
const PROP_DESC=_loadObj('propDesc');
function poolFor(idx){
  let p=['mirror','incense','wine'];
  if(idx>=4)p=p.concat(['lock','saw']);
  if(idx>=6)p=p.concat(['bell','pill']);
  if(idx>=8)p=p.concat(['steal','invert']);
  return p;
}
function dealItems(){
  if(RUN.endless){
    // 无限/地狱模式：每局起手就摆满 5 件道具，Buckshot 风格——同类型不重复（用全部道具池，保证开局即 5 件）
    const pool=Object.keys(PROPS);
    const k=5;
    const drawUnique=(n)=>{ const c=pool.slice(),out=[]; const count=Math.min(n,c.length); for(let i=0;i<count;i++) out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); return out; };
    S.itemsDealer=drawUnique(k);
    S.itemsPlayer=drawUnique(k);
    return;
  }
  const baseN=RUN.zodiac.propCount||0;
  // 从第二关开始，庄家至少拥有 2 个道具，保证公平；保留高难度关卡的更多道具
  const n = (RUN.index>0 && baseN<2) ? 2 : baseN;
  // 申猴（第三关）双道具固定为回血，平衡玩家断魂刃的爆发伤害
  if(RUN.zodiac.id==='monkey'){ S.itemsDealer=['incense','incense']; return; }
  const pool=poolFor(RUN.index);
  const draw=()=>{ const c=pool.slice(),out=[]; for(let i=0;i<n;i++){ if(!c.length)c=pool.slice(); out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); } return out; };
  S.itemsDealer=draw();
  // 每日挑战：也给玩家发 3 件道具（公平开打）
  if(RUN.daily && RUN.itemsUnlocked){
    const pn=Math.min(3, pool.length);
    const c=pool.slice(), out=[];
    for(let i=0;i<pn;i++){ if(!c.length)break; out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); }
    S.itemsPlayer=out;
  }
}
function redealEndless(){
  // 每轮（装弹）清旧发新：Buckshot 风格——道具是免费动作，可连发，但只用一轮；开局即 5 件且同类型不重复
  const pool=Object.keys(PROPS);
  const k=5;
  const drawUnique=(n)=>{ const c=pool.slice(),out=[]; const count=Math.min(n,c.length); for(let i=0;i<count;i++) out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); return out; };
  S.itemsPlayer=drawUnique(k);
  S.itemsDealer=drawUnique(k);
  S.itemLock=false; S.itemLockActive=false; S.cuffP=0; S.cuffD=0;   // 新一轮解除上轮的控制类加码；cuffP/cuffD 为「玩家/庄家被跳过回合数」计数器（可叠加）
  log(tr('<b>无尽模式</b>：新一轮，桌上重新摆满了 {k} 件道具。', {k}));
}
function dealerSignGlow(){
  const bs=$('bloodSign'); if(!bs)return;
  bs.classList.add('glow');
  clearTimeout(bs._t);
  bs._t=setTimeout(()=>bs.classList.remove('glow'),1200);
}
function applyItem(id, side){
  if(!S||S.over)return;
  if(side==='dealer'){ dealerItemFx(id); dealerSignGlow(); }
  const arr = side==='player'?S.itemsPlayer:S.itemsDealer;
  const idx=arr.indexOf(id); if(idx<0)return;
  arr.splice(idx,1);
  const who = side==='player'?tr('你'):tr(RUN.zodiac.title);
  switch(id){
    case 'mirror': {
      const cur=S.chamber[S.pos];
      if(side==='player') S.revealed=cur;
      log(tr('{who}以照妖镜窥得：<b>{b}</b>。', {who, b: cur===LIVE?liveTxt():blankTxt()}));
      break;
    }
    case 'incense': {
      // 满血也可使用：燃尽但无效（避免被庄家夺走）；此时间不回血、不触发死兆星
      if(side==='player'){
        if(S.php>=S.phpMax) log(tr('续命香燃尽 —— 但血已全满，未回血（留不被夺）。'));
        else { S.php=Math.min(S.phpMax,S.php+1); checkDeathStar(); log(tr('{who}点燃续命香，回 1 血。', {who})); }
      } else {
        if(S.dhp>=S.dhpMax) log(tr('庄家血已满，续命香燃尽未回血。'));
        else { S.dhp=Math.min(S.dhpMax,S.dhp+1); log(tr('{who}点燃续命香，回 1 血。', {who})); }
      }
      break;
    }
    case 'wine': {
      const shell=S.chamber[S.pos]; S.pos++;
      log(tr('{who}以忘川酒弹出当前一发：<b>{b}</b>。', {who, b: shell===LIVE?liveTxt():blankTxt()}));
      if(S.pos>=S.chamber.length){ S.chamber=loadChamber(); S.pos=0; log(tr('弹仓打空，庄家重新装弹（新比例已揭示）。')); playLoad(); shotToast(tr(S.turn==='player'?'toast_reload_p':'toast_reload_d'), S.turn, TOAST_RELOAD_DELAY); }
      break;
    }
    case 'lock': {
      // 缚灵锁：可叠加。玩家使用→庄家被跳过回合数 +1；庄家使用→玩家被跳过回合数 +1
      if(side==='player'){ S.cuffD=(S.cuffD||0)+1; log(tr('{who}祭出缚灵锁 —— 庄家被缚，将跳过 {n} 个回合。', {who, n:S.cuffD})); }
      else { S.cuffP=(S.cuffP||0)+1; log(tr('{who}祭出缚灵锁 —— 你被缚，将跳过 {n} 个回合。', {who, n:S.cuffP})); }
      break;
    }
    case 'saw': {
      const flag = side==='player' ? 'playerSaw' : 'dealerSaw';
      if(S[flag]){
        log(tr('{who}再祭断魂刃 —— 但伤害翻倍已生效，不会再次叠乘（单发封顶 −2）。', {who}));
      } else {
        S[flag]=true;
        log(tr('{who}以断魂刃断魂 —— 下一发实弹伤害翻倍（封顶 −2）。', {who}));
      }
      break;
    }
    case 'bell': {
      // 千里铃：随机多效果（6 发弹仓下揭示更有价值），并记录揭示范围供加码结算
      const hasNext2 = S.pos+1 < S.chamber.length;
      const r=Math.random();
      let scope, txt;
      if(!hasNext2){
        scope='single'; const cur=S.chamber[S.pos];
        txt=tr('下一发是 <b>{b}</b>', {b: cur===LIVE?liveTxt():blankTxt()});
        if(side==='player') S.revealed=cur;
      } else if(r<0.5){
        scope='single'; const cur=S.chamber[S.pos];
        txt=tr('下一发是 <b>{b}</b>', {b: cur===LIVE?liveTxt():blankTxt()});
        if(side==='player') S.revealed=cur;
      } else if(r<0.8){
        scope='multi'; const a=S.chamber[S.pos], b=S.chamber[S.pos+1];
        txt=tr('未来两发是 <b>{x}</b>、<b>{y}</b>', {x: a===LIVE?liveTxt():blankTxt(), y: b===LIVE?liveTxt():blankTxt()});
        if(side==='player') S.revealed=a;
      } else {
        scope='multi'; let L=0,B=0; for(let i=S.pos;i<S.chamber.length;i++) S.chamber[i]===LIVE?L++:B++;
        txt=tr('弹仓剩余 <b>{L} 实弹</b> / <b>{B} 空包</b>', {L, B});
      }
      S._lastBellScope=scope;
      log(tr('{who}摇响千里铃：{t}。', {who, t: txt}));
      break;
    }
    case 'pill': {
      const heal=Math.random()<0.4; S._lastPillOutcome=heal?'heal':'hurt';
      if(heal){ if(side==='player')S.php=Math.min(S.phpMax,S.php+2); else S.dhp=Math.min(S.dhpMax,S.dhp+2); if(side==='player')checkDeathStar(); log(tr('{who}吞下残丹，回 2 血！', {who})); }
      else { if(side==='player'){ S.php--; const unlocked=ensurePeekUnlocked(); if(unlocked) flushAwaken(); else checkDeathStar(); } else { S.dhp--; dealerHit(); } log(tr('{who}吞下残丹 —— 反噬 −1！', {who})); }
      break;
    }
    case 'steal': {
      const foeArr=side==='player'?S.itemsDealer:S.itemsPlayer;
      const meArr=side==='player'?S.itemsPlayer:S.itemsDealer;
      if(foeArr.length){
        const sid=foeArr.splice(Math.floor(Math.random()*foeArr.length),1)[0];
        if(sid==='steal'){
          // Bug1(Marco 2026-08-04)：偷到对家的「夺魂」不再立即递归使用而消失，
          // 改为直接收入自己行囊，留待后续主动使用（与玩家预期一致）。
          meArr.push(sid);
          log(tr('{who}夺魂，反手将对手的 {n} 收归己用！', {who, n: PROPS[sid].name}));
        } else {
          // Bug2(Marco 2026-08-04)：旧逻辑「已有同类型则不入栏」会导致后续 applyItem
          // 从『自己』栏移除并消耗了自有道具（如续命香）。改为始终先入栏（允许瞬时重复），
          // applyItem 会精确移除被偷来的这一件，自有同类型道具得以保留。
          meArr.push(sid);
          log(tr('{who}夺魂，盗走对手的 {n} 并立即使用！', {who, n: PROPS[sid].name}));
          applyItem(sid,side);
        }
      }
      else log(tr('{who}夺魂，但对手无道具可夺。', {who}));
      break;
    }
    case 'invert': {
      const cur=S.chamber[S.pos]; S.chamber[S.pos]=cur===LIVE?BLANK:LIVE;
      log(tr('{who}以逆命符翻转当前一发：<b>{x}</b>。', {who, x: cur===LIVE?tr('实弹→空包'):tr('空包→实弹')}));
      break;
    }
  }
}
function useItem(side,id){
  if(side!=='player'||!S||S.over||S.turn!=='player')return;
  if(betFlowPaused() || S.roundBreak){ log(tr('加码 / 轮间过场中，无法使用道具。')); return; }
  if(S.itemLockActive){ log(tr('加码惩罚生效 —— 你本回合无法使用道具。')); return; }
  S.itemsUsed=true; S.itemUseCount=(S.itemUseCount||0)+1; RUN.itemPulseDone=true;
  applyItem(id,'player'); render();
  // 道具反噬致死：残丹扣血、断魂刃被夺、夺魂自爆等
  if(!S.over && S.php<=0){ checkOver(); return; }
}
/* 庄家道具风格：按生肖 itemStyle 决定偏好与时机，避免"见道具就扔" */
const ITEM_STYLE_ALLOW={
  none:[],
  aggro:['saw','invert','steal'],        // 强攻：只爱进攻 / 抢夺
  defensive:['lock','incense','mirror'], // 控制 / 防守：留到关键回合
  trickster:['invert','wine','bell'],    // 诡诈：打乱节奏、误导
  greedy:['steal','pill','incense'],     // 贪婪：抢资源 + 自补
  balanced:['saw','incense','mirror','wine','lock','bell','pill','steal','invert']
};
function maybeDealerItem(){
  if(S.over) return false;
  if(S.loading) return false;  // 装弹动画期间：不使用道具
  // 濒死保护：残血（≤2）时无视冷却与风格限制，强制优先保命/控场道具，
  // 避免「小丑（greedy 风格 allow 不含 lock）握着缚魂锁却坐以待毙」这类被动死亡。
  const critical = S.dhp <= 2;
  if(critical) S.dealerItemCd = 0;
  if(S.dealerItemCd>0){ S.dealerItemCd--; return false; } // 道具冷却中：本回合不用
  const inv=S.itemsDealer; if(!inv.length) return false;
  const ai=curAI();
  const endless = !!RUN.endless;
  const style = RUN.zodiac.itemStyle || 'balanced';
  // 无尽模式：每轮都换 5 个新道具，必须尽量消耗，所以放宽允许列表与使用条件
  const allow = endless ? ITEM_STYLE_ALLOW.balanced : (ITEM_STYLE_ALLOW[style] || ITEM_STYLE_ALLOW.balanced);
  // 无尽模式优先进攻/节奏道具，避免把信息类留到死；普通模式保持原有优先级
  const PRIORITY= endless
    ? ['saw','wine','invert','steal','lock','pill','incense','bell','mirror']
    : ['saw','invert','steal','lock','incense','mirror','wine','bell','pill'];
  const canUse=(id,force=false)=>{
    const isLive = S.chamber[S.pos]===LIVE;
    const isBlank = S.chamber[S.pos]===BLANK;
    const hasNext = (S.chamber.length-S.pos-1)>0;
    switch(id){
      // 进攻类
      case 'saw':     return isLive;
      case 'invert':  return isBlank || (style==='trickster' && isLive) || endless;
      // 资源类
      case 'steal':   return S.itemsPlayer.length>0;
      case 'lock':    return true; // 控制节奏随时可用
      case 'incense': return S.dhp<=S.dhpMax-2 || (ai.heal && S.dhp<S.dhpMax) || (endless && S.dhp<S.dhpMax); // 无尽模式：只要不满血就烧，不浪费
      case 'mirror':  return true; // 信息类随时可用
      case 'wine':    return isLive || (endless && hasNext); // 无尽模式：即使空包也弹，避免浪费且可能重新装弹刷新道具
      case 'bell':    return hasNext || endless; // 无尽模式：只剩一发也摇，不带走
      case 'pill':    return S.dhp<=2 || style==='greedy' || endless; // 无尽模式：残丹赌命也要用掉
    }
    return false;
  };
  // 濒死：直接走保命优先级（残丹 > 续命香 > 缚魂锁 > 照妖镜 > 其余），忽略风格 allow，确保绝境必出手
  if(critical){
    const LIFE=['pill','incense','lock','mirror','wine','saw','invert','steal','bell'];
    for(const id of LIFE){
      if(!inv.includes(id)) continue;
      if(!canUse(id)) continue;
      applyItem(id,'dealer');
      S.dealerItemCd = 0;
      return true;
    }
  }
  // 第一遍：优先按生肖风格使用道具
  for(const id of PRIORITY){
    if(!inv.includes(id)) continue;
    if(!allow.includes(id)) continue;
    if(!canUse(id)) continue;
    applyItem(id,'dealer');
    S.dealerItemCd = endless ? 0 : ((style==='aggro')?1:2); // 无尽模式每回合都尝试用道具
    return true;
  }
  // 第二遍：风格内没有可用时，只要手上有道具且能用，就用（避免到死不用）
  for(const id of PRIORITY){
    if(!inv.includes(id)) continue;
    if(!canUse(id,true)) continue;
    applyItem(id,'dealer');
    S.dealerItemCd = endless ? 0 : ((style==='aggro')?1:2);
    return true;
  }
  return false;
}
/* ===== 程序化音效 (Web Audio, 零资源) ===== */
/* ===== 可暂停演出调度器 ActorSet（修复后台 tab / 手机锁屏画面冻结）=====
 * 庄家演出链（dealerAct/dealerTurn）与气泡/动作/情绪/补说定时器统一走此调度器。
 * 隐藏页（visibilitychange hidden）时冻结：已排程定时器按「可见时钟」记录剩余时间、停止原生计时；
 * 切回前台（visible）后按真实经过时间续跑（断点续演），并 render()+resetFx() 兜底对齐画面、清残留 FX。
 * 「可见时钟」仅在页面可见时推进：隐藏期间冻结，保证演出时序在切回后保持一致，不会再因 rAF/CSS 暂停而卡死。 */
const ActorSet=(function(){
  let hidden=false, hiddenTotal=0, pausedAt=0, frozenNow=0, master=null, nextId=1;
  const tasks=new Map();
  // 冻结条件：后台隐藏 或 任意打断弹窗（觉醒/死兆星/轮间/结算/主菜单/假结局/加码/帮助?/设置）开着。
  // 弹窗冻结可避免「玩家看说明时庄家在背景开枪扣血」。
  function isFrozen(){ return hidden || anyPauseModalOpen(); }
  function vnow(){ return hidden ? frozenNow : (performance.now()-hiddenTotal); }
  function schedule(){
    if(isFrozen()){
      // 冻结中：只在还有待执行任务时以 200ms 轮询续跑检查，解冻后立即执行（不丢任务、不重复触发）
      if(tasks.size>0){ master=setTimeout(tick, 200); }
      return;
    }
    if(master){ clearTimeout(master); master=null; }
    if(tasks.size===0) return;
    let soon=Infinity; tasks.forEach(t=>{ if(t.at<soon) soon=t.at; });
    master=setTimeout(tick, Math.max(0, soon-vnow()));
  }
  function tick(){
    master=null;
    if(isFrozen()){ schedule(); return; }  // 冻结期间不执行任何庄家动作（含开枪扣血），仅续跑轮询
    const now=vnow(), due=[];
    tasks.forEach((t,id)=>{ if(t.at<=now) due.push({id, fn:t.fn}); });
    due.forEach(d=>tasks.delete(d.id));
    due.forEach(d=>{ try{ d.fn(); }catch(e){ console.error(e); } });
    schedule();
  }
  function fire(fn, delay){
    const id=++nextId;
    tasks.set(id, { at: vnow()+(delay||0), fn });
    schedule();
    return { cancel(){ tasks.delete(id); } };
  }
  function start(){
    document.addEventListener('visibilitychange', ()=>{
      if(document.hidden){
        hidden=true; pausedAt=performance.now(); frozenNow=pausedAt-hiddenTotal;
        if(master){ clearTimeout(master); master=null; }
      } else {
        if(!hidden) return;
        hiddenTotal += performance.now()-pausedAt; hidden=false;
        try{ if(S && !S.over){ render(); resetFx(); } }catch(e){}  // 兜底：对齐画面 + 清残留 FX，防卡死
        schedule();
      }
    });
  }
  return { fire, start };
})();
function ActorFire(fn, delay){ return ActorSet.fire(fn, delay); }
ActorSet.start();

/* ===== 演出工具 ===== */
function splatter(cx,cy,container){
  const c=container||$('scene'); if(!c)return;
  for(let i=0;i<9;i++){ const s=document.createElement('div'); s.className='blood'; const a=Math.random()*Math.PI*2, dist=12+Math.random()*46; s.style.left=(cx+dist*Math.cos(a))+'px'; s.style.top=(cy+dist*Math.sin(a))+'px'; const sz=4+Math.random()*9; s.style.width=s.style.height=sz+'px'; c.appendChild(s); setTimeout(()=>s.remove(),900); }
}
function redFlash(){ const f=$('redFlash'); if(!f)return; f.style.opacity='1'; setTimeout(()=>f.style.opacity='0',90); }
function dealerHit(dmg=1){
  S.dealerHitCount++;
  const zone=$('dealerZone');
  const zr=zone.getBoundingClientRect();
  const r=$('mask').getBoundingClientRect();
  const cx=r.left+r.width/2, cy=r.top+r.height/2; // viewport 坐标，供 spawnDmgNum 自行换算
  splatter(cx-zr.left, cy-zr.top, zone);
  spawnDmgNum(cx, cy, `−${dmg} ❤`, 'dealer', zone);
  markLostHeart('dhp', S.dhp); dealerMood('hit'); sfxHurt('dealer');
  const m=$('mask');
  if(m){ m.classList.remove('knock'); void m.offsetWidth; m.classList.add('knock'); ActorFire(()=>{ if(m) m.classList.remove('knock'); }, 460); }
  ActorFire(()=>{ if(S&&!S.over) dealerMood('idle'); }, 600);
}
function ensurePeekUnlocked(){
  if(!S || S.over || S.php<=0) return false;
  if(S.peekUnlocked) return false;
  S.peekUnlocked=true; RUN.peekUnlocked=true;
  S.peekMax = 2;   // 觉醒解锁：每次 +2 次偷看机会
  $('bPeek').classList.add('awakened');
  S._awokePending = true;   // 弹窗延后到开枪演出结束（枪降下）再弹；无枪路径（残丹/警觉槽）由调用处立即 flushAwaken
  return true;
}
function flushAwaken(){
  if(!S || S.over) return;
  if(!S._awokePending) return;
  S._awokePending = false;
  awakenFx(); showAwakenModal();
}
function playerHit(dmg=1, resumeFn){
  S.playerHitCount++;
  const sc=$('scene').getBoundingClientRect();
  const php=$('php'); const pr=php?php.getBoundingClientRect():{left:sc.left+sc.width/2-20,top:sc.top+sc.height*0.82,width:40,height:24};
  const px=pr.left+pr.width/2-sc.left, py=pr.top+pr.height/2-sc.top;
  splatter(px, py); spawnDmgNum(px, py, `−${dmg} ❤`, 'player'); markLostHeart('php', S.php);
  const h=$('hurt'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); sfxHurt('player');
  const firstUnlock = ensurePeekUnlocked();
  if(!firstUnlock){
    checkDeathStar(resumeFn);
    dealerSay(zhpMinus('player'),2400);
  }
  S.lastPhp=S.php;
  return firstUnlock;
}
let currentMood='idle';
function moodText(m){ const map={idle:'',think:tr('（沉思）'),shoot:tr('（怒视）'),hit:tr('（吃痛）'),lose:tr('（溃散）'),win:tr('（冷笑）'),sweat:tr('（冒汗）'),bluff:tr('（虚张声势）'),worried:tr('（慌张）')}; return map[m]||''; }
function dealerMood(m){
  const z=$('zface');
  if(z){
    // 避免每次情绪变化都重建 img（导致缓存/弱网时偶发闪回 emoji）
    const cur=z.querySelector('.zmask-img');
    if(!cur || cur.dataset.id!==(RUN.zodiac&&RUN.zodiac.id)) z.innerHTML=peekMaskImg(RUN.zodiac);
  }
  // B5 血量驱动情绪曲线：庄家自身低血时，常态表情滑向紧张/慌乱
  let mood=m;
  if(S && (!m||m==='idle')){
    if(S.dhp<=1) mood='worried';
    else if(S.dhp===2) mood='sweat';
  }
  currentMood=mood||'idle';
  /* C3: moodBadge 已移除（定稿——去右下角情绪 emoji），改为气泡前缀文字 */
    const mk=$('mask'); if(mk){
    const hpClass = (S && m!=='lose' && S.dhp<=1) ? 'desperate' : (S && m!=='lose' && S.dhp===2 ? 'tense' : '');
    mk.className='mask no-avatar-frame '+(mood&&mood!=='idle'?mood:'')+(hpClass?' '+hpClass:'');
  }
}
function dealerSay(text,ms){
  if(S && betFlowPaused()) return;   // 加码/加码结算弹窗期间冻结庄家发言
  text = tr(text);
  const t=(text||'').trim();
  const b=$('bubble');
  // 空文本：立即隐藏气泡，避免空气泡
  if(!t){ if(b){ b.classList.remove('show'); b.textContent=''; } return; }
  // 只有被「（...）」明确包裹的文本才是场景/动作描述，显示在头像下方；其余全是对话，用气泡显示
  if(t.startsWith('（') && t.endsWith('）')){ dealerAction(t.slice(1,-1), ms); return; }
  // 情绪前缀：原右下角 emoji 改为文字前缀，若文案自身已带「（」则不重复
  const moodPrefix = (moodText(currentMood) && !t.startsWith('（')) ? moodText(currentMood) : '';
  b.textContent=moodPrefix ? (moodPrefix + text) : text; b.classList.add('show');
  if(b._t && b._t.cancel) b._t.cancel(); b._t=ActorFire(()=>{ if(b) b.classList.remove('show'); }, ms||2400);
  const mk=$('mask'); if(mk && !mk.classList.contains('hit') && !mk.classList.contains('lose')){ mk.classList.add('talk'); ActorFire(()=>{ if(mk) mk.classList.remove('talk'); },420); }
}
function dealerAction(text,ms){
  if(S && betFlowPaused()) return;   // 加码/加码结算弹窗期间冻结庄家动作描述
  text = tr(text);
  const a=$('actionLine'); if(!a)return;
  a.textContent=text; a.classList.add('show');
  if(a._t && a._t.cancel) a._t.cancel(); a._t=ActorFire(()=>{ if(a) a.classList.remove('show'); }, ms||2200);
}
function awakenFx(){ const g=$('game'); if(!g)return; const a=document.createElement('div'); a.className='awaken'; a.innerHTML='<span>'+tr('偷看 · 觉醒')+'</span>'; g.appendChild(a); setTimeout(()=>a.remove(),1600); }
let pendingResume=null;
let deathStarPending=false;
let achToastQueue = [];
let _achToastBusy = false;
function showAwakenModal(){
  if(!S || S.over) return;
  const m=$('awakenModal'); if(!m)return; m.classList.add('show'); sfxAwaken();
  const pkLine=zpick('peek_awaken');   // 首次觉醒：庄家点评（文档钩子 peek_awaken）
  const btn=$('awakenBtn'); if(btn) btn.onclick=()=>{
    if(!S || S.over){ if(m) m.classList.remove('show'); return; }
    m.classList.remove('show'); flushAchToast();
    const fn=pendingResume; pendingResume=null;
    const after=()=>{
      if(fn) fn(); else render();
      ActorFire(()=>dealerSay(pkLine,3200),600);   // 觉醒弹窗关闭后，庄家补一句点评
      maybeShowPeekTutor();   // 首次觉醒后，若未看过则弹静态偷看教学（游戏暂停于弹窗后）
    };
    // 首局：首次觉醒后若只剩 1 血，先弹死兆星，再把恢复函数交给死兆星弹窗关闭后执行
    if(S && !S.over && S.php===1 && S.lastPhp>1 && RUN.index===0){ showDeathStarModal(after); return; }
    after();
  };
}
function checkDeathStar(resumeFn){
  if(!S||S.over)return false;
  if(S.php===1 && S.lastPhp>1){
    // 第一局（卯兔）100% 触发，降低新手失败率；其余关卡保持 75%
    if(RUN.index===0 || Math.random()<0.75){ showDeathStarModal(resumeFn); return true; }
  }
  S.lastPhp=S.php;
  return false;
}
function showDeathStarModal(resumeFn){
  if(!S || S.over) return;
  const m=$('deathstarModal'); if(!m)return;
  deathStarPending=true;
  // 把「玩家点继续后的恢复逻辑」存进 pendingResume，弹窗关闭时执行（与觉醒弹窗同机制）
  pendingResume = (typeof resumeFn==='function') ? resumeFn : null;
  const btn=$('deathstarBtn'); if(btn) btn.onclick=()=>{
    if(!S || S.over){ if(m) m.classList.remove('show'); deathStarPending=false; return; }
    m.classList.remove('show'); deathStarPending=false; flushAchToast();
    S.peekMax=(S.peekMax||2)+2; log(tr('<b>死兆星降临</b>——你在恐惧中额外获得 2 次偷看机会。')); render();
    if(pendingResume){ const fn=pendingResume; pendingResume=null; fn(); } else render();
  };
  // 延迟 ~700ms 显示：等开枪/伤害演出（枪口闪光、血溅、震屏）放完再盖弹窗，避免「还没看到枪开火就弹窗」
  ActorFire(()=>{
    if(!S || S.over) return;
    resetFx(); // 死兆星弹窗出现时强制清空 Canvas 血溅/闪光/震屏特效，避免红屏残留在弹窗上
    m.classList.add('show');
  }, 700);
}
function dealerItemFx(id){ 
  const zone=$('dealerZone'); if(!zone)return; 
  const banner=document.createElement('div'); banner.className='dealer-item-banner'; banner.innerHTML=`<span class="ie">${PROPS[id].emoji}</span>${tr('庄家使出')} ${PROPS[id].name}`; 
  // 定位在庄家面具正下方（不再依赖 #ditems 位置，因信息块已移到左上），渲染在 dealerZone 顶层
  const zr=zone.getBoundingClientRect(); const mr=$('mask').getBoundingClientRect();
  banner.style.top=(mr.top - zr.top + 8)+'px';   // 移到气泡之下、头像上沿：避开中部回合 Toast，也不盖气泡
  zone.appendChild(banner); setTimeout(()=>banner.remove(),2600);   // 横幅存活延长到 ~2.5s（与 bannerPop 动画对齐），看得清
  // 庄家道具栏整体脉冲：强调「庄家动了道具」
  const di=$('ditems'); if(di){ di.classList.remove('used-pulse'); void di.offsetWidth; di.classList.add('used-pulse'); setTimeout(()=>di.classList.remove('used-pulse'),600); }
  // 头像高亮
  const m=$('mask'); if(m){ m.classList.remove('item-flash'); void m.offsetWidth; m.classList.add('item-flash'); setTimeout(()=>m.classList.remove('item-flash'),900); }
  shakeScreen(6,260); 
}
function shakeScreen(mag,ms){ const g=$('game'); if(!g)return; g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); ActorFire(()=>{ if(g) g.classList.remove('shake'); },ms||200); }
/* ===== juice 辅助：粒子 / 枪口火光 / 抛壳 / 漂浮伤害数字 / ❤️碎裂 ===== */
function spawnParticles(x,y,opts,container){
  opts=opts||{}; const c=container||$('scene'); if(!c)return;
  const n=opts.n||8, color=opts.color||'#ff5b76', size=opts.size||6, spread=opts.spread||60;
  for(let i=0;i<n;i++){
    const p=document.createElement('div'); p.className='particle';
    const a=Math.random()*Math.PI*2, d=spread*(0.4+Math.random()*0.6);
    p.style.left=x+'px'; p.style.top=y+'px'; p.style.width=p.style.height=size+'px';
    p.style.background=color; p.style.boxShadow='0 0 8px '+color;
    p.style.setProperty('--px',(Math.cos(a)*d)+'px');
    p.style.setProperty('--py',(Math.sin(a)*d - 10)+'px');
    c.appendChild(p); setTimeout(()=>p.remove(),820);
  }
}
function muzzleAt(x,y,container){
  const c=container||$('scene'); if(!c)return;
  const cr=c.getBoundingClientRect();
  const m=document.createElement('div'); m.className='muzzle';
  m.style.left=(x-cr.left)+'px'; m.style.top=(y-cr.top)+'px';
  c.appendChild(m); setTimeout(()=>m.remove(),240);
  spawnParticles(x-cr.left, y-cr.top, {n:10,color:'#ffcf6a',size:5,spread:72}, c);
}
function shellAt(x,y,container){
  const c=container||$('scene'); if(!c)return; const cr=c.getBoundingClientRect();
  const s=document.createElement('div'); s.className='shell'; s.textContent='🔩';
  s.style.left=(x-cr.left)+'px'; s.style.top=(y-cr.top)+'px';
  s.style.setProperty('--sx',((Math.random()*2-1)*60)+'px');
  s.style.setProperty('--sy',(-(40+Math.random()*40))+'px');
  c.appendChild(s); setTimeout(()=>s.remove(),720);
}
function spawnDmgNum(x,y,txt,cls,container){
  const c=container||$('scene'); if(!c)return;
  const cr=c.getBoundingClientRect();
  const d=document.createElement('div'); d.className='dmg-num '+(cls||'player'); d.textContent=txt;
  d.style.left=(x-cr.left)+'px'; d.style.top=(y-cr.top)+'px';
  c.appendChild(d); setTimeout(()=>d.remove(),1000);
}
let pendingHeartCrack=null; // render() 重建血量后消费，给刚熄灭的 ❤️ 加碎裂动画
function markLostHeart(elId, idx){ pendingHeartCrack={elId, idx}; }
const TAUNTS=[
  '你的手在抖。','这枪里，全是你的因果。','子时已过，执念未散。',
  '屏息……我能听见你的心跳。','别急着开枪，陪我耗。','你以为看穿了，就稳了？',
  '因果轮转，该来的躲不掉。','这一局，我还没尽兴。','乖，把命交出来。'
];
const TAUNTS_DOMINANT=[
  '你跪下的姿势，比我想象中好看。','这局结束，你的执念归我。',
  '血条越少，你越诚实。','我在等你自己把枪管塞嘴里。','子时未过，你已输了七分。'
];
const TAUNTS_WORRIED=[
  '……别得意太早。','面具不会裂，但我会记仇。','下一发最好是你自己的。',
  '你靠运气走到现在？','再得意，因果也会反噬。'
];
const IDLE_LINES=[
  '（庄家轻叩桌面，像在数你的心跳。）','（面具后的目光，始终没有离开你的手指。）',
  '（他低声笑了。）','「别急，子时还长。」','（空气里飘着火药和檀香。）',
  '（庄家的影子在烛火里晃了晃。）','「你猜，下一发是因果还是生路？」'
];
const SURVEIL_LINES=[
  '我也在看你的手指……别抖。','你屏息时，我也在数你的节奏。','你的手在抖，我在数。',
  '别以为只有你在看。','这一发，我盯着你开。'
];
function surveillancePulse(){
  if(!S||S.over||S.turn!=='player'||S.peeking)return;
  const L=zlines();
  dealerSay((L.peek_caught&&Math.random()<0.7)?zpick('peek_caught'):SURVEIL_LINES[Math.floor(Math.random()*SURVEIL_LINES.length)], 2600);
  const acts=$('acts'); acts.classList.add('jitter'); setTimeout(()=>acts.classList.remove('jitter'),440);
  $('vignette').style.opacity='1';
  setTimeout(()=>{ if(S&&!S.peeking&&!S.over)$('vignette').style.opacity='0'; }, 240);
}
function currentTaunts(){
  if(!S)return TAUNTS;
  if(S.dhp>S.php+1 || S.php<=1) return TAUNTS_DOMINANT;
  if(S.dhp<S.php-1 || S.dhp<=1) return TAUNTS_WORRIED;
  return TAUNTS;
}
/* ===== 生肖个性对话取词 + 血量情绪曲线 ===== */
const FALLBACK={
  hp_minus:['一颗心，落了。','害怕吗？'], hp_again:['疼吗？'], self_blank:['空包，白赚一回合。'], self_live:['自己打自己？'],
  player_live:['这一发，认了吧。'], player_blank:['啧，空包。算你走运。'], dealer_live:['你竟敢伤我。'], reload:['弹仓空了，重新上膛。'],
  exchange:['第几发了，你我像老相识。'], peek_awaken:['……你看见了？'], peek_caught:['我看得见你在看。'],
  psych:['你赌的从不是概率。'], gameplay:['记住：空包白赚一回合。'], prob:['下一发，红的。'], idle:['庄家盯着你。']
};
function zlines(){ return (RUN.zodiac&&RUN.zodiac.lines)||{}; }
function zpick(key){ const L=zlines(); const a=L[key]; if(a&&a.length) return tr(a[Math.floor(Math.random()*a.length)]); const f=FALLBACK[key]; if(f&&f.length) return tr(f[Math.floor(Math.random()*f.length)]); return tr('…'); }
function zhpMinus(who){
  const L=zlines();
  const count = who==='player'? S.playerHitCount : S.dealerHitCount;
  const a = (count>1 && L.hp_again && L.hp_again.length) ? L.hp_again : (L.hp_minus || []);
  if(a.length) return a[Math.floor(Math.random()*a.length)];
  return zpick('hp_minus');
}
function ztaunt(){
  const L=zlines();
  const base=[].concat(L.player_live||[],L.dealer_live||[],L.self_live||[],L.self_blank||[],L.reload||[],L.exchange||[],L.psych||[],L.gameplay||[],L.prob||[],L.hp_minus||[]);
  const out=[];
  if(S&&S.php<=1) out.push(...(L.player_live||[]).slice(0,2), ...(L.psych||[]).slice(0,2)); // 玩家濒死 → 庄家压制
  if(S&&S.dhp<=2) out.push(...(L.dealer_live||[]).slice(0,2), ...(L.self_live||[]).slice(0,2)); // 庄家低血(≤2) → 慌/暴走，情绪曲线更平滑
  out.push(...base);
  return out.length?out:['…'];
}
function dealerBluff(next){
  const lies = next===LIVE ? [
    '下一发空包的概率……其实不低。','我赌这发打不响。','空包。我说的就是空包。','这发要是实弹，我把面具吃了。'
  ] : [
    '下一发实弹，我闻得到火药味。','这发是红的，你信吗？','实弹。敢对自己开吗？','别赌，这发会响。'
  ];
  return lies[Math.floor(Math.random()*lies.length)];
}
function dealerLine(){
  const L=zlines();
  const rem=S.chamber.slice(S.pos), tot=rem.length;
  const live=rem.filter(s=>s===LIVE).length;
  const p=Math.round(live/tot*100);
  const next=S.chamber[S.pos];
  const bp = S.bluffBoost ? 0.6 : curAI().bluff; // 上一局被识破过 → 本局 bluff 概率翻倍
  if(Math.random()<bp) return dealerBluff(next);
  if(L.prob && Math.random()<0.35) return zpick('prob');
  if(L.player_live && Math.random()<0.25) return zpick('player_live');
  if(Math.random()<0.4){
    let hint='';
    if(p>=70) hint='相当高';
    else if(p>=40) hint='一半一半';
    else if(p>0) hint='不算高';
    else hint='没有';
    return tr('下一发是红的概率……{h}，你赌不赌？',{h:tr(hint)});
  }
  return zpick('psych')||'…';
}
/* ===== Canvas 弹巢渲染（装弹 v16 隐藏排序 + 偷看 v22 长按揭盖 共用） ===== */
const CYL_W=600, CYL_H=600, CYL_CX=300, CYL_CY=300, CYL_RING=150, CYL_CHAM=44, CYL_BODY=215, CYL_N=6;
function cylChamberPos(i, rotDeg){
  const ang=(270 + i*60 + rotDeg)*Math.PI/180; // 270° = 屏幕 12 点钟
  return { x: CYL_CX + CYL_RING*Math.cos(ang), y: CYL_CY + CYL_RING*Math.sin(ang) };
}
function cylDrawBody(ctx){
  let g=ctx.createRadialGradient(CYL_CX-60,CYL_CY-70,20,CYL_CX,CYL_CY,230);
  g.addColorStop(0,'#72727a'); g.addColorStop(0.35,'#4a4a54'); g.addColorStop(0.75,'#25252e'); g.addColorStop(1,'#15151c');
  ctx.beginPath(); ctx.arc(CYL_CX,CYL_CY,CYL_BODY,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  ctx.lineWidth=5; let eg=ctx.createLinearGradient(CYL_CX-200,CYL_CY-200,CYL_CX+200,CYL_CY+200);
  eg.addColorStop(0,'rgba(232,195,119,.45)'); eg.addColorStop(0.5,'rgba(232,195,119,.10)'); eg.addColorStop(1,'rgba(0,0,0,.45)');
  ctx.strokeStyle=eg; ctx.stroke();
  ctx.beginPath(); ctx.arc(CYL_CX,CYL_CY,195,0,Math.PI*2); ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.stroke();
  let cg=ctx.createRadialGradient(CYL_CX-10,CYL_CY-10,6,CYL_CX,CYL_CY,62);
  cg.addColorStop(0,'#5a5a64'); cg.addColorStop(1,'#1e1e26');
  ctx.beginPath(); ctx.arc(CYL_CX,CYL_CY,58,0,Math.PI*2); ctx.fillStyle=cg; ctx.fill();
  ctx.lineWidth=3; ctx.strokeStyle='rgba(232,195,119,.18)'; ctx.stroke();
  let lg=ctx.createRadialGradient(CYL_CX-110,CYL_CY-130,10,CYL_CX-110,CYL_CY-130,300);
  lg.addColorStop(0,'rgba(200,118,46,.32)'); lg.addColorStop(1,'rgba(200,118,46,0)');
  ctx.beginPath(); ctx.arc(CYL_CX,CYL_CY,CYL_BODY,0,Math.PI*2); ctx.globalCompositeOperation='screen'; ctx.fillStyle=lg; ctx.fill(); ctx.globalCompositeOperation='source-over';
}
function cylDrawEmptyChamber(ctx,p){
  ctx.beginPath(); ctx.arc(p.x,p.y,CYL_CHAM,0,Math.PI*2);
  let g=ctx.createRadialGradient(p.x-12,p.y-12,6,p.x,p.y,CYL_CHAM);
  g.addColorStop(0,'#15151b'); g.addColorStop(1,'#0a0a0f'); ctx.fillStyle=g; ctx.fill();
  ctx.lineWidth=4; let rg=ctx.createRadialGradient(p.x,p.y,CYL_CHAM-8,p.x,p.y,CYL_CHAM);
  rg.addColorStop(0,'rgba(232,195,119,.02)'); rg.addColorStop(1,'rgba(232,195,119,.22)'); ctx.strokeStyle=rg; ctx.stroke();
}
function cylDrawNeutralShell(ctx,p,alpha){
  ctx.save(); ctx.globalAlpha=alpha;
  ctx.beginPath(); ctx.arc(p.x,p.y,CYL_CHAM-6,0,Math.PI*2);
  let bg=ctx.createRadialGradient(p.x-10,p.y-10,5,p.x,p.y,CYL_CHAM); bg.addColorStop(0,'#35353d'); bg.addColorStop(1,'#1e1e26'); ctx.fillStyle=bg; ctx.fill();
  ctx.lineWidth=5; let eg=ctx.createRadialGradient(p.x,p.y,CYL_CHAM-14,p.x,p.y,CYL_CHAM-2); eg.addColorStop(0,'#6b5b38'); eg.addColorStop(1,'#3d321d'); ctx.strokeStyle=eg; ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x-10,p.y-10,6,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fill();
  ctx.restore();
}
function cylDrawColoredDot(ctx,p,type,now,alpha){
  ctx.save(); ctx.globalAlpha=alpha;
  const dotR=(CYL_CHAM-6)*0.45; // 红点小于弹径
  if(type===LIVE){
    const pulse=0.45+0.55*Math.sin(now/220);
    ctx.save(); ctx.globalCompositeOperation='screen';
    let hg=ctx.createRadialGradient(p.x,p.y,dotR*0.3,p.x,p.y,dotR+22);
    hg.addColorStop(0,`rgba(230,40,40,${0.35+0.35*pulse})`); hg.addColorStop(1,'rgba(230,40,40,0)');
    ctx.beginPath(); ctx.arc(p.x,p.y,dotR+22,0,Math.PI*2); ctx.fillStyle=hg; ctx.fill(); ctx.restore();
    let bg=ctx.createRadialGradient(p.x-dotR*0.3,p.y-dotR*0.3,2,p.x,p.y,dotR); bg.addColorStop(0,'#ff3b3b'); bg.addColorStop(.7,'#c01010'); bg.addColorStop(1,'#5e0202');
    ctx.beginPath(); ctx.arc(p.x,p.y,dotR,0,Math.PI*2); ctx.fillStyle=bg; ctx.fill();
  } else {
    let bg=ctx.createRadialGradient(p.x-dotR*0.3,p.y-dotR*0.3,2,p.x,p.y,dotR); bg.addColorStop(0,'#5a5a64'); bg.addColorStop(1,'#2a2a30');
    ctx.beginPath(); ctx.arc(p.x,p.y,dotR,0,Math.PI*2); ctx.fillStyle=bg; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(150,150,160,.5)'; ctx.stroke();
  }
  ctx.restore();
}

function playLoad(){ showReloadAnim(); }
function showReloadAnim(){
  if(document.getElementById('loadOverlay')) return;
  S.loading=true;
  const live=S.chamber.filter(s=>s===LIVE).length, blank=S.chamber.filter(s=>s===BLANK).length;
  const total=S.chamber.length;
  const wrap=document.createElement('div'); wrap.id='loadOverlay'; wrap.className='load-overlay';
  wrap.innerHTML=`<div class="load-title">${tr('庄家上膛')}</div>
    <div class="cylinder-wrap"><canvas id="loadCyl" width="600" height="600"></canvas></div>
    <div class="load-count">${tr('实弹')} <b class="live">${live}</b> / ${tr('空包')} <b class="blank">${blank}</b></div>`;
  $('game').appendChild(wrap);
  const canvas=$('loadCyl'); const ctx=canvas.getContext('2d');
  // 点击跳过
  wrap.addEventListener('click',()=>{ const o=document.getElementById('loadOverlay'); if(o){ o.remove(); S.loading=false; } });
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loaded=new Array(total).fill(false);
  let flying=[];
  let lastT=performance.now(), spinAngle=0, targetSpin=0, spinStart=0, phase='loading';
  function frame(now){
    if(!document.getElementById('loadOverlay')) return;
    const dt=now-lastT; lastT=now;
    ctx.clearRect(0,0,CYL_W,CYL_H);
    if(phase==='spin'){ const k=Math.min(1,(now-spinStart)/1400); const e=1-Math.pow(1-k,3); spinAngle=targetSpin*e; }
    else if(phase==='done'){ spinAngle+=dt*0.008; }
    else { spinAngle+=dt*0.002; }
    ctx.save(); ctx.translate(CYL_CX,CYL_CY); ctx.rotate(spinAngle*Math.PI/180); ctx.translate(-CYL_CX,-CYL_CY);
    cylDrawBody(ctx);
    for(let i=0;i<total;i++){ const p=cylChamberPos(i,0); cylDrawEmptyChamber(ctx,p); if(loaded[i]) cylDrawNeutralShell(ctx,p,1); }
    flying=flying.filter(f=>{
      const k=(now-f.born)/f.dur;
      if(k>=1){ loaded[f.i]=true; return false; }
      const p=cylChamberPos(f.i,0); const side=f.i%4; const starts=[[-0.2,0.5],[1.2,0.5],[0.5,-0.2],[0.5,1.2]];
      const sx=starts[side][0]*CYL_W, sy=starts[side][1]*CYL_H; const e=k*k*(3-2*k);
      const x=sx+(p.x-sx)*e, y=sy+(p.y-sy)*e; cylDrawNeutralShell(ctx,{x,y},1); return true;
    });
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 装填（隐藏排序：统一中性弹壳，不按真实类型染色）
  for(let i=0;i<total;i++){ const delay=260+i*150; setTimeout(()=>{ if(!document.getElementById('loadOverlay')) return; flying.push({i,born:performance.now(),dur:420}); }, delay); }
  const spinAt=260+total*150+250;
  setTimeout(()=>{
    if(phase!=='loading'||!document.getElementById('loadOverlay')) return;
    phase='spin'; spinStart=performance.now(); const startA=spinAngle;
    targetSpin= reduce?startA:(startA+720+Math.floor(Math.random()*360));
    sfxSpin();
  }, spinAt);
  const doneAt=spinAt+1200;
  setTimeout(()=>{ if(document.getElementById('loadOverlay')) phase='done'; }, doneAt);
  setTimeout(()=>{ const o=document.getElementById('loadOverlay'); if(!o) return; o.classList.add('done'); setTimeout(()=>{ const o2=document.getElementById('loadOverlay'); if(o2){ o2.remove(); S.loading=false; } }, 520); }, doneAt+200);
}

function chamberLives(){
  // 弹仓恒 6 孔（还原真实左轮）。每个关卡实弹统一 3~4。
  if(RUN.endless){
    // 无尽模式固定 3~4 实弹（与普通模式一致），难度靠血量/道具/伤害倍率爬升，不靠堆实弹数
    return 3 + (Math.random()<0.5?1:0);
  }
  if(RUN.isJoker) return 4;                         // 终局小丑：4 实弹
  return 3 + (Math.random()<0.3?1:0);              // 70% 概率 3 颗实弹，30% 概率 4 颗
}
function loadChamber(){
  const lives=chamberLives();
  const blanks=6-lives;
  const arr=Array(lives).fill(LIVE).concat(Array(blanks).fill(BLANK));
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}
function ambienceLoop(){
  clearTimeout(ambiTimer);
  if(!S||S.over)return;
  ambiTimer=setTimeout(()=>{
    if(!S||S.over)return;
    const r=Math.random();
    if(r<0.55){ const sc=$('scene'); sc.classList.add('flicker'); setTimeout(()=>sc.classList.remove('flicker'),200); }
    else { const m=$('mask'); m.classList.add('twitch'); setTimeout(()=>m.classList.remove('twitch'),350); }
    ambienceLoop();
  }, 4000+Math.random()*6000);
}
function updateDealerIdentity(){
  const s=zDisp(RUN.zodiac);
  $('dname').textContent=/^[\u4e00-\u9fa5]{2}$/.test(s)?s[0]+' '+s[1]:s;
  const z=$('zface'); if(z) z.innerHTML=peekMaskImg(RUN.zodiac);
}
function dealerHp(){
  const ab=hardAbility();
  if(RUN.isJoker) return 7 + (ab?1:0);                   // 终局小丑：7 血（困难 +1）
  let hp = 4 + Math.min(3, Math.floor(RUN.index/4));     // 0-3→4；4-7→5；8-11→6；（12 小丑走上支）
  if(ab && (RUN.zodiac.id==='rabbit' || RUN.zodiac.id==='dragon')) hp+=1;  // 狡兔三窟 / 龙鳞护体
  return hp;
}
function reset(){
  clearTimeout(idleTimer); clearTimeout(ambiTimer);
  document.querySelectorAll('.restart').forEach(b=>b.remove());
  const logList=$('logList'); if(logList) logList.innerHTML=''; // 新局清空旧战报，避免与当前局混淆
  const bonuses=getPlayerBonuses();
  let peekBase=2+bonuses.peekBonus;   // 成就奖励：偷看次数
  if(RUN.giftPeek) peekBase+=1;                                              // 小丑礼物①：本次轮回偷看 +1
  if(RUN.hard && RUN.zodiac.id==='horse') peekBase=Math.max(1, peekBase-1); // 困难·烈蹄夺目
  // 午马关：基础偷看 +1（降低首次过马门槛；困难模式保留减偷看手感，不叠加）
  if(RUN.zodiac.id==='horse' && !RUN.hard) peekBase+=1;
  // 隐性兜底（泛化全生肖 · 普通模式主线）：每次失败让该生肖更易自伤(livePlayer −0.06/次, floor 0.45, 最多计 6 次)；高手无感、无回魂
  const _zd=(!RUN.hard && !RUN.endless && !RUN.isJoker && !RUN.daily)?(STATS.zodiacDeaths[RUN.index]||0):0;
  if(_zd>=1){
    const _baseLP=(ZODIAC_AI[RUN.zodiac.id]||AI_DEFAULT).livePlayer;
    RUN.mercyLivePlayer=Math.max(0.45, _baseLP - Math.min(_zd,6)*0.06);
  } else RUN.mercyLivePlayer=null;
  const initialItems=(RUN.itemsUnlocked?RUN.playerItems||[]:[]);
  const phpMax=4+bonuses.hpBonus;        // 成就奖励：血量上限
  S={php:phpMax,phpMax,dhp:dealerHp(),dhpMax:dealerHp(),lastPhp:phpMax,chamber:loadChamber(),pos:0,turn:'player',over:false,peeking:false,peekCount:0,peekMax:peekBase,revealed:null,bluffBoost:pendingBluffBoost,itemsPlayer:initialItems,itemsDealer:[],playerSaw:false,dealerSaw:false,cuffP:0,cuffD:0,dealerItemCd:0,peekUnlocked:(RUN.index>0||RUN.peekUnlocked||RUN.hard),itemsUnlocked:(RUN.itemsUnlocked||RUN.hard),itemsUsed:false,itemUseCount:0,shots:0,dealerTurns:0,playerHitCount:0,dealerHitCount:0,dealerHoles:0,holeOrder:shuffledHoleOrder(),firstDealerLive:(!RUN.hard&&!RUN.endless&&!RUN.daily&&RUN.index===0),firstSelfBlank:(!RUN.hard&&!RUN.endless&&!RUN.daily&&RUN.index===0),pSelfBlank:0,pSelfLive:0,pDealerLive:0,pDealerBlank:0,dToPlayer:0,dSelfBlank:0,dSelfLive:0,dToPlayerBlank:0,bet:null,betRoundProposed:false,pausedForBet:false,betCooldownUntil:0,itemLock:false,loading:false,_awokePending:false};
  pendingBluffBoost=false;
  document.querySelectorAll('#game .bullet-hole').forEach(e=>e.remove());  // 换庄家：清空上一局弹孔（updateDealerIdentity 重建 zface 也会兜底清掉）
  clearHintBig();   // 防御性清理①：新局开始清掉上一局残留的庄家放大态
  clearShotToast(); // 同理：清掉上一局残留/待出场的每枪 Toast
  _shotBusy=false;  // 保险：跨局残留的演出锁一律解除
  dealItems();
  // 困难模式第一关：取消觉醒与道具栏封锁，直接给 2 件起始道具
  if(RUN.hard && !RUN.endless && RUN.index===0 && S.itemsPlayer.length===0){
    const pool=poolFor(0);
    const n=Math.min(2, pool.length);
    const c=pool.slice(), out=[];
    for(let i=0;i<n;i++){ if(!c.length)break; out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); }
    S.itemsPlayer=out;
  }
  // 困难模式 · 道具类能力（无尽/地狱模式下桌面已摆满，跳过道具增减类，只保留数值类）
  const _ab=hardAbility();
  if(_ab && !RUN.endless){
    const zn=zDisp(RUN.zodiac);
    if(zn==='亥猪'){ const pool=poolFor(RUN.index); for(let i=0;i<2;i++) S.itemsDealer.push(pool[Math.floor(Math.random()*pool.length)]); }
    if(zn==='小丑'){ const pool=poolFor(RUN.index); S.itemsDealer.push(pool[Math.floor(Math.random()*pool.length)]); }
  }
  // 把上一局击败庄家掉落的遗物实际带入道具栏
  if(S.itemsUnlocked && RUN.lastDrop.length){
    const carried=[];
    for(const id of RUN.lastDrop){ if(S.itemsPlayer.length<5){ S.itemsPlayer.push(id); carried.push(`${PROPS[id].emoji}${PROPS[id].name}`); } }
    if(carried.length) log(tr('你握紧上一局捡到的遗物：{c}。', {c: carried.join('、')}));
    RUN.lastDrop=[];
  }
  // （寅虎改为赠送 偷看+1，开局遗物奖励已移除）
  // 降低前期难度：道具栏至少 3 件（玩家侧，所有模式通用）
  if(S.itemsUnlocked && S.itemsPlayer.length<3){
    const pool=poolFor(RUN.index).filter(id=>!S.itemsPlayer.includes(id));
    while(S.itemsPlayer.length<3 && pool.length) S.itemsPlayer.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  }
  // 成就奖励：自动揭示第一发
  if(bonuses.hasReveal && S.chamber.length>0){
    S.revealed=S.chamber[0];
  }
  // RUN.playerItems 已在上一局胜利时保存为剩余道具，这里不再重复覆盖
  // 困难模式 · 依赖玩家道具的能力（须在玩家道具全部就位后执行）
  if(_ab && !RUN.endless){
    const zn=zDisp(RUN.zodiac);
    if(zn==='申猴' && S.itemsPlayer.length){
      const i=Math.floor(Math.random()*S.itemsPlayer.length);
      const sid=S.itemsPlayer.splice(i,1)[0];
      S.itemsDealer.push(sid);
      log(tr('困难 · 顺手牵猴：申猴偷走了你的 {n}！', {n:`${PROPS[sid].emoji}${PROPS[sid].name}`}));
    }
    if(zn==='未羊' && S.itemsPlayer.length){
      for(const id of S.itemsPlayer){ if(S.itemsDealer.length<5) S.itemsDealer.push(id); }
      log(tr('困难 · 披着你皮：未羊复制了你携带的全部道具。'));
    }
  }
  if(_ab) log(tr('<b>⚔️ 困难 · {n}</b>：{d}', {n:_ab.name, d:_ab.desc}));
  updateDealerIdentity(); render(); playLoad();
  shotToast(tr(S.turn==='player'?'toast_reload_p':'toast_reload_d'), S.turn, TOAST_RELOAD_DELAY);   // 开局装弹后给新手弹「轮到你出手」提示（与正常装弹同款，等遮罩走完）
  // 庄家进场淡入
  (function(){ const m=$('mask'); if(m){ m.classList.add('zodiac-fade'); m.style.opacity='0'; requestAnimationFrame(()=>requestAnimationFrame(()=>{ m.style.opacity='1'; })); } })();
  dealerMood('idle');
  $('vignette').style.opacity='0'; $('vignette').style.boxShadow='inset 0 0 50px 20px rgba(255,0,40,0)';
  $('hurt').classList.remove('on');
  log(tr('新一局。{t} 上膛：实弹 {l} / 空包 {b}。轮到你。', {t: tr(RUN.zodiac.title), l: S.chamber.filter(s=>s===LIVE).length, b: S.chamber.filter(s=>s===BLANK).length}));
  startHeart(); scheduleIdleBanter(); ambienceLoop();
  resetFx(); // 防御性清理：新局开始清掉上一局残留的 Canvas 血溅/闪光/震屏特效
}
function fire(target){
  // 教学局：玩家第一次打庄家必中 / 第一次打自己必空。用"交换"来保护实弹/空包总数，避免和装弹预告冲突；没有可换的子弹再兜底改写。
  if(S.turn==='player' && target==='dealer' && S.firstDealerLive){
    S.firstDealerLive=false;
    if(S.chamber[S.pos]!==LIVE){
      const k=S.chamber.indexOf(LIVE, S.pos+1);
      if(k!==-1){ S.chamber[k]=S.chamber[S.pos]; S.chamber[S.pos]=LIVE; }
      else S.chamber[S.pos]=LIVE; // 剩余已无实弹，兜底改写
    }
  }
  if(S.turn==='player' && target==='self' && S.firstSelfBlank){
    S.firstSelfBlank=false;
    if(S.chamber[S.pos]!==BLANK){
      const k=S.chamber.indexOf(BLANK, S.pos+1);
      if(k!==-1){ S.chamber[k]=S.chamber[S.pos]; S.chamber[S.pos]=BLANK; }
      else S.chamber[S.pos]=BLANK; // 剩余已无空包，兜底改写
    }
  }
  const shell=S.chamber[S.pos];
  let dmg = shell===LIVE ? 1 : 0;
  if(shell===LIVE){
    if(S.turn==='player' && target==='dealer' && S.playerSaw) dmg=2;   // 玩家断魂刃，打庄家双倍
    if(S.turn==='dealer' && target==='player' && S.dealerSaw) dmg=2;  // 庄家断魂刃，打玩家双倍
    if(S.turn==='dealer' && target==='dealer' && S.dealerSaw) dmg=2;  // 庄家断魂刃，打自己双倍（之前漏写）
  }
  // 困难模式 · 伤害类能力修正
  if(shell===LIVE && RUN.hard){
    const zn=zDisp(RUN.zodiac);
    const hitDealer=(S.turn==='player' && target==='dealer') || (S.turn==='dealer' && target==='self');
    if(hitDealer){
      if(zn==='丑牛'||zn==='辰龙') dmg=Math.min(dmg,1);   // 铜皮铁骨 / 龙鳞护体：对庄家伤害封顶 1（翻倍无效）
      if(zn==='戌狗' && !S._dogGuardUsed){ S._dogGuardUsed=true; dmg=Math.max(0,dmg-1); log(tr('困难 · 忠犬挡枪：一道残影替庄家挡下了这发子弹的锋芒（伤害 -1）。')); }
    }
    if(S.turn==='dealer' && target==='player' && zn==='寅虎') dmg=2;  // 虎啸裂胆：实弹对你固定 2 伤
  }
  S.pos++;
  const hit=shell===LIVE;
  // 氛围层钩子：每发 → 暗角收缩脉动（节奏拍）；命中实弹 → 暗角红闪
  ambientNextRound();
  if(hit) ambientHitFlash();
  // 射击 FX：枪口闪/火花/弹壳/震屏/血溅（命中时）；替代 dealerHit/playerHit 内的 blackout/redFlash
  shootFx(target, hit);
  if(hit){
    if(S.turn==='player'){
      if(target==='dealer') S.dhp-=dmg;
      else S.php-=dmg; // target==='self'
    }else{
      if(target==='player') S.php-=dmg;
      else S.dhp-=dmg; // target==='self'
    }
  }
  // 断魂刃 buff：只在「开枪方打出实弹」时消耗自己的 buff（下一发实弹翻倍，仅一次）
  if(hit){
    if(S.turn==='player') S.playerSaw=false; else S.dealerSaw=false;
  }
  // 困难 · 蛇毒入骨：巳蛇实弹命中你后，你下回合无法使用道具
  if(hit && RUN.hard && RUN.zodiac.id==='snake' && S.turn==='dealer' && target==='player'){
    S.itemLock=true; log(tr('困难 · 蛇毒入骨：毒液渗入伤口，你下回合无法使用道具。'));
  }
  S.shots=(S.shots||0)+1;
  // 图鉴：累计「本场玩家射向该生肖的子弹数」（仅玩家射击；每换对手自动清零）
  if(S.turn==='player'){
    const _fk = RUN.isJoker ? 'joker' : String(RUN.index);
    if(S.fightKey!==_fk){ S.fightKey=_fk; S.fightPlayerShots=0; }
    S.fightPlayerShots=(S.fightPlayerShots||0)+1;
  }
  let killed=false;
  if(hit){
    if(S.turn==='player'){
      killed = (target==='dealer' && S.dhp<=0) || (target==='self' && S.php<=0);
    }else{
      killed = (target==='player' && S.php<=0) || (target==='self' && S.dhp<=0);
    }
  }
  if(!killed && S.pos>=S.chamber.length){ S.roundBreak=true; S._shooter=S.turn; S._lastTarget=target; S._lastHit=hit; S.chamberSpent=true; log(tr('弹仓打空 —— （稍候，下一轮将重新开始）')); }
  S.revealed=null;
  const justDied = (S.php<=0) || (S.dhp<=0);
  return {shell,hit,dmg};
}
function render(){
  const pm=S.phpMax||4, dm=S.dhpMax||4;
  $('php').innerHTML=Array.from({length:pm},(_,i)=>`<div class="heart ${i<S.php?'':'off'}">${i<S.php?'❤️':'🖤'}</div>`).join('');
  $('dhp').innerHTML=Array.from({length:dm},(_,i)=>`<div class="heart ${i<S.dhp?'':'off'}">${i<S.dhp?'❤️':'🖤'}</div>`).join('');
  const dhpEl=$('dhp'); if(dhpEl) dhpEl.style.display = (S.dhp<=0) ? 'none' : '';
  if(S.chamberSpent || (S.pos>=S.chamber.length && S.chamber.length)){
    $('chamberInfo').innerHTML=`<span><span class="dot live-dot"></span>`+tr('装弹中…')+`</span><span>· ${S.chamber.length}/${S.chamber.length}</span>`;
  } else {
    const remLive=S.chamber.slice(S.pos).filter(s=>s===LIVE).length;
    const remBlank=S.chamber.slice(S.pos).filter(s=>s===BLANK).length;
    $('chamberInfo').innerHTML=`<span><span class="dot live-dot"></span>`+tr('实弹')+` ${remLive}</span><span><span class="dot blank-dot"></span>`+tr('空包')+` ${remBlank}</span><span>· ${S.pos+1}/${S.chamber.length}</span>`;
  }
  const vig=$('vignette'); if(S.php<=1) vig.classList.add('low'); else vig.classList.remove('low');
  const myTurn=S.turn==='player'&&!S.over&&!S.roundBreak&&!betFlowPaused();
  $('bDealer').disabled=!myTurn; $('bSelf').disabled=!myTurn;
  $('bPeek').style.display = S.peekUnlocked ? '' : 'none';
  $('bPeek').disabled=!myTurn||S.peeking||S.peekCount>=(S.peekMax||1);
  updatePeekHint();
  // 情境即时提示（C2）：每个系统首次可用时浮一条极短提示，localStorage 记忆只显示一次
  if(S.peekUnlocked && S.peekCount<(S.peekMax||1) && myTurn) hintOnce('peek', tr('偷看：窥视当前一发是实弹还是空包。次数有限，关键时才用。'));
  if(S.itemsUnlocked && S.itemsPlayer.length>0 && myTurn) hintOnce('item', tr('道具：点击使用。庄家手里有 {n} 样东西（右上角），看清再决定。', {n:S.itemsDealer.length}));
  // 道具栏：玩家按钮 + ❓图鉴 + 庄家小图标
  const ib=$('itembar');
  let itemsHtml;
  if(!S.itemsUnlocked) itemsHtml='<span class="noitem">'+tr('🔒 道具栏 · 击败庄家后开启')+'</span>';
  else if(S.itemsPlayer.length) itemsHtml=S.itemsPlayer.map((id,i)=>`<button class="itembtn" data-i="${i}" title="${PROPS[id].name}"><span class="ie">${PROPS[id].emoji}</span></button>`).join('');
  else itemsHtml='<span class="noitem">'+tr('（无道具）')+'</span>';
  ib.innerHTML = itemsHtml;
  ib.classList.toggle('lit', !RUN.itemPulseDone && S.itemsUnlocked && S.itemsPlayer.length>0 && !S.itemsUsed && myTurn);
  ib.querySelectorAll('.itembtn[data-i]').forEach(btn=>{
    const id=S.itemsPlayer[+btn.dataset.i];
    btn.disabled = !myTurn || S.itemLockActive;
    btn.onclick=()=>useItem('player',id);
  });

  const diEl=$('ditems');
  diEl.innerHTML = S.itemsDealer.map((id,i)=>`<span class="dealer-chip" data-di="${i}" data-id="${id}" title="${PROPS[id].name}">${PROPS[id].emoji}</span>`).join('');
  $('ditems').querySelectorAll('.dealer-chip[data-di]').forEach(el=>attachDitemTip(el, el.dataset.id));
  applyTension(calcTension());
  // 刚熄灭的 ❤️ 加碎裂动画
  if(pendingHeartCrack){ const b=$(pendingHeartCrack.elId); const h=b&&b.children[pendingHeartCrack.idx]; if(h) h.classList.add('shatter'); pendingHeartCrack=null; }
  updateEndlessBar();
}
function updateEndlessBar(){
  const bar=$('endlessBar'); if(!bar) return;
  if(!RUN.endless){ bar.style.display='none'; return; }
  bar.style.display='flex';
  $('ebStreak').textContent=RUN.streak;
  $('ebMult').textContent='×'+endlessMult().toFixed(2);
  $('ebScore').textContent=RUN.score;
  $('ebBest').textContent=RUN.best;
}
function log(t){
  t=tr(t); const list=$('logList'); if(!list) return;
  const d=document.createElement('div'); d.innerHTML=t; d.className='log-row';
  list.appendChild(d);
  const last=$('logLast'); if(last) last.innerHTML=t;
  const panel=$('logPanel'); const body=$('logBody');
  if(body && panel && !panel.classList.contains('collapsed')) body.scrollTop=body.scrollHeight;
}
function checkOver(){
  if(S.over) return true;
  dealerSay('',0); clearTimeout(idleTimer); clearTimeout(ambiTimer);
  if(S.php<=0){ if(!RUN.hard && !RUN.endless && !RUN.isJoker && !RUN.daily){ (STATS.zodiacDeaths[RUN.index]=(STATS.zodiacDeaths[RUN.index]||0)+1); saveStats(); } S.over=true;trackEvent('level_result',{zodiac_idx:RUN.index,result:'lose',mode:modeOf(),hard:!!(RUN&&RUN.hard),player_hp:S.php,player_hp_max:S.phpMax,dealer_hp:S.dhp,dealer_hp_max:S.dhpMax});clearHintBig();clearShotToast();stopHeart();render();dealerMood('win');const h=$('hurt');h.classList.remove('on');void h.offsetWidth;h.classList.add('on');sfxDeath('player');log(tr('<b>你倒下了。</b>'));setTimeout(()=>showResult('death'),400);return true;}
  if(S.dhp<=0){
    S.over=true;trackEvent('level_result',{zodiac_idx:RUN.index,result:'win',mode:modeOf(),hard:!!(RUN&&RUN.hard),player_hp:S.php,player_hp_max:S.phpMax,dealer_hp:S.dhp,dealer_hp_max:S.dhpMax});clearHintBig();clearShotToast();stopHeart();render();dealerMood('lose');
    const r=$('mask').getBoundingClientRect(),z=$('dealerZone').getBoundingClientRect(),zone=$('dealerZone');splatter(r.left-z.left+r.width/2,r.top-z.top+r.height/2,zone);sfxDeath('dealer');
    log(tr('<b>庄家溃散！你赢了这一局。</b>'));
    if(RUN.index===0)RUN.itemsUnlocked=true;
    RUN.playerItems=S.itemsPlayer.slice();
    // 存档点解锁（主线模式击败 5/8/11）：首次解锁时记下「本局新开存档点」，胜利结算末尾弹出提示
    if(!RUN.daily && !RUN.endless && !RUN.isJoker && CK_POINTS.includes(RUN.index)){
      if(!ckUnlocked().includes(RUN.index)) S.newCheckpoint=RUN.index;
      ckUnlock(RUN.index);
      trackEvent('checkpoint',{zodiac_idx:RUN.index});
    }
    // 露脸演出：有 reveal 文本的庄家（兔/狗/羊/龙/小丑），面具碎裂 → 淡出 → 文字浮现 → 再进结算
    const zc=RUN.zodiac;
    if(zc.reveal && !RUN.daily && !RUN.endless){
      setTimeout(()=>playReveal(zc, ()=>showResult('victory')), 900);
    } else {
      setTimeout(()=>showResult('victory'),400);
    }
    return true;
  }
  return false;
}
/* ===== 露脸演出：庄家淡出 + 文字浮现（点击或超时结束） ===== */
function playReveal(zc, done){
  const fr=$('faceReveal'), ft=$('frText'), m=$('mask');
  if(!fr || !ft){ done(); return; }
  if(m){ m.classList.add('zodiac-fade'); m.style.opacity='0'; }
  ft.textContent=tr(zc.reveal);
  fr.style.pointerEvents='auto';
  fr.classList.add('show');
  let finished=false;
  const finish=()=>{
    if(finished) return; finished=true;
    fr.classList.remove('show');
    fr.style.pointerEvents='none';
    fr.onclick=null;
    if(m) m.style.opacity='1';
    setTimeout(done, 500);
  };
  const tm=setTimeout(finish, 9000);
  fr.onclick=()=>{ clearTimeout(tm); finish(); };
}
function makeCrack(){
  const c=$('crack'); c.innerHTML='';
  for(let i=0;i<12;i++){
    const ang=Math.random()*Math.PI*2, len=30+Math.random()*45;
    const l=document.createElement('div'); l.className='crack-line'; l.style.left='50%'; l.style.top='50%'; l.style.width=len+'%';
    l.style.transform=`rotate(${ang*180/Math.PI}deg)`; c.appendChild(l);
    if(i%3===0){
      const b=document.createElement('div'); b.className='crack-line';
      const bang=ang+(Math.random()*1.2-0.6), blen=8+Math.random()*18;
      b.style.left=(50+Math.cos(ang)*len*0.55)+'%'; b.style.top=(50+Math.sin(ang)*len*0.55)+'%'; b.style.width=blen+'%';
      b.style.transform=`rotate(${bang*180/Math.PI}deg)`; c.appendChild(b);
    }
  }
}
/* ===== P2 轻量埋点（本机 localStorage 统计，用于朋友 playtest 收集数据） ===== */
const STATS_KEY='peek_stats';
function loadStats(){ try{ const o=JSON.parse(localStorage.getItem(STATS_KEY)); if(o&&typeof o==='object'){ if(!('hardClear' in o) && o.perIndex && o.perIndex[11] && o.perIndex[11].win>0) o.hardClear=true; return o; } }catch(e){ return null; } }
let STATS = loadStats() || {plays:0,wins:0,losses:0,perIndex:{},hardClear:false,betProposed:0,betAccepted:0,betDeclined:0,peekTotal:0,itemTotal:0,roundTotal:0,zodiacDeaths:{}};
function saveStats(){ try{ localStorage.setItem(STATS_KEY, JSON.stringify(STATS)); }catch(e){} }
function peekRunMode(){ return RUN.endless ? (RUN.hard?'hell':'endless') : (RUN.hard?'hard':'normal'); }
function recordGameEnd(mode){
  STATS.plays++;
  const win = mode==='victory';
  if(win) STATS.wins++; else STATS.losses++;
  // 小丑胜利原先会折叠进 perIndex[11]（辰龙）；现拆为独立桶 STATS.joker。
  // 成就系统靠 unlock('joker') 判定，不依赖 perIndex，故拆分安全。
  const isJoker = !!RUN.isJoker;
  const fresh = ()=>({win:0,lose:0,modes:{normal:0,hard:0,endless:0,hell:0},firstWin:0,bullets:0});
  if(isJoker){
    STATS.joker = STATS.joker || fresh();
  } else {
    const idx=RUN.index;
    STATS.perIndex[idx]=STATS.perIndex[idx]||fresh();
  }
  const b = isJoker ? STATS.joker : STATS.perIndex[RUN.index];
  if(win){
    b.win++;
    if(!b.firstWin) b.firstWin = Date.now();
    const mk = peekRunMode(); b.modes[mk] = (b.modes[mk]||0)+1;
  } else {
    b.lose++;
  }
  b.bullets = (b.bullets||0) + ((S&&S.fightPlayerShots)||0);
  STATS.roundTotal += Math.ceil((S.shots||0)/2);
  STATS.itemTotal += (S.itemUseCount||0);
  saveStats();
}
/* ===== 成就系统（本地「轮回印记」） ===== */
const ACH_KEY='peek_ach';
let ACH = loadAch();
function loadAch(){ try{ const o=JSON.parse(localStorage.getItem(ACH_KEY)); return (o&&typeof o==='object')?(o.unlocked?o:{unlocked:o,betWins:0}):{unlocked:{},betWins:0}; }catch(e){ return {unlocked:{},betWins:0}; } }
function saveAch(){ try{ localStorage.setItem(ACH_KEY, JSON.stringify(ACH)); }catch(e){} }
const ACHIEVEMENTS = (function(){
  const z = ZODIACS.map(z=>({id:'z_'+z.name, group:'生肖征服', emoji:z.emoji, zid:z.id, zname:z.name, ztitle:z.title}));
  const st = _loadArr('achievements');
  return z.concat(st);
})();
function achName(a){ if(a.zname){ const z=ZODIACS.find(z=>z.id===a.zid); return a.emoji+' '+(z?zDisp(z):a.zname); } return a.emoji+' '+a.name; }
function achDesc(a){ if(a.ztitle){ const z=ZODIACS.find(z=>z.id===a.zid); return tr('击败 {t}',{t:z?zDisp(z):a.ztitle}); } return a.desc; }
function unlock(id){
  if(ACH.unlocked[id]) return false;
  ACH.unlocked[id]=Date.now();
  saveAch(); refreshAchBadge(); toastAch(id); updateAchDot();
  return true;
}
/* 成就红点：跨会话记录“已查看过的成就”，有新解锁时在主菜单/游戏内 ⚙️ 与成就入口亮红点 */
const ACH_SEEN_KEY='peek_ach_seen';
let _achSeen=new Set(JSON.parse(localStorage.getItem(ACH_SEEN_KEY)||'[]'));
function updateAchDot(){
  const hasNew = ACHIEVEMENTS.some(a=>ACH.unlocked[a.id] && !_achSeen.has(a.id));
  ['bGear','setAch'].forEach(id=>{
    const btn=document.getElementById(id); if(!btn) return;
    let dot=btn.querySelector('.reddot');
    if(!dot){ dot=document.createElement('span'); dot.className='reddot'; btn.appendChild(dot); }
    dot.style.display=hasNew?'block':'none';
  });
}
function markAchSeen(){
  ACHIEVEMENTS.forEach(a=>{ if(ACH.unlocked[a.id]) _achSeen.add(a.id); });
  try{ localStorage.setItem(ACH_SEEN_KEY, JSON.stringify([..._achSeen])); }catch(e){}
  updateAchDot();
}
function awardVictory(){
  const z=RUN.zodiac;
  unlock('first_win');
  unlock('z_'+z.name);
  if(RUN.isJoker){ unlock('joker'); unlock('story_clear'); }
  if(RUN.isJoker && RUN.hard && !RUN.endless){ try{ localStorage.setItem('peek_hard_clear','1'); }catch(e){} }  // 地狱模式解锁条件：困难通关小丑
  const isFinal = !RUN.endless && !RUN.isJoker && RUN.index===ZODIACS.length-1;
  if(isFinal) unlock('twist');
  if(S.peekCount===0) unlock('no_peek');
  if(S.playerHitCount===0) unlock('flawless');
  if(S.pSelfLive>0) unlock('self_live_win');
  if(RUN.endless && RUN.streak>=5) unlock('endless5');
  if(ZODIACS.every(zz=>ACH.unlocked['z_'+zz.name])) unlock('collector');
}
function toastAch(id){
  // 全部入队，一次只显示一个（避免多个成就同时解锁叠在一起）
  achToastQueue.push(id);
  if(!_achToastBusy) flushAchToast();
}
function _showToast(id){
  const a=ACHIEVEMENTS.find(x=>x.id===id); if(!a){ _achToastBusy=false; return; }
  const g=document.getElementById('game'); if(!g){ _achToastBusy=false; return; }
  const t=document.createElement('div'); t.className='ach-toast';
  const gName=tr('无间轮回 · PEEK');
  t.innerHTML=`<div class="ach-toast-ico">${a.emoji}</div><div class="ach-toast-tx"><div class="ach-toast-k">${tr('成就解锁')}</div><div class="ach-toast-n">${achName(a)}</div></div><div class="ach-toast-gg">${gName}</div>`;
  g.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>{ t.remove(); _achToastBusy=false; flushAchToast(); },420); }, 3200);
}
function flushAchToast(){
  if(_achToastBusy) return;
  if(!achToastQueue.length) return;
  _achToastBusy = true;
  _showToast(achToastQueue.shift());
}
function refreshAchBadge(){
  const btn=document.getElementById('setAch'); if(!btn) return;
  const total=ACHIEVEMENTS.length, got=ACHIEVEMENTS.filter(a=>ACH.unlocked[a.id]).length;
  btn.textContent='🏅 '+tr('查看')+' ('+got+'/'+total+')';
}
function showAch(){
  markAchSeen();   // 打开成就页即视为已读，清除红点
  const total=ACHIEVEMENTS.length, got=ACHIEVEMENTS.filter(a=>ACH.unlocked[a.id]).length;
  const b=getPlayerBonuses();
  let h=`<div class="ach-head"><span>${tr('已解锁 {u} / {t}',{u:got,t:total})}</span><button class="ach-share-all" id="achShareAll">${tr('分享我的进度')}</button></div>`;
  // 里程碑奖励摘要
  h+=`<div class="ach-group"><div class="ach-group-title">${tr('轮回馈赠（击败双数关解锁）')}</div><div class="ach-milestone-summary" style="font-size:11px;color:var(--dim);padding:2px 6px 8px">${tr('当前：{s}',{s:milestoneDesc()})}</div>`;
  h+=MILESTONES.map(m=>{
    const done=!!(STATS.perIndex[m.zodiacIdx]&&STATS.perIndex[m.zodiacIdx].win>0);
    const zname=ZODIACS[m.zodiacIdx]?zDisp(ZODIACS[m.zodiacIdx]):'';
    return `<div class="ach-item ${done?'on':'off'}">
      <div class="ach-ico">${done?ZODIACS[m.zodiacIdx].emoji:'🔒'}</div>
      <div class="ach-meta"><div class="ach-name">${tr(m.nameKey)}（${zname}）</div><div class="ach-desc">${done?tr(m.textKey):tr('击败后解锁')}</div></div>
    </div>`;
  }).join('')+'</div>';
  const groups={};
  ACHIEVEMENTS.forEach(a=>{ (groups[a.group]=groups[a.group]||[]).push(a); });
  h+=Object.keys(groups).map(g=>{
    return `<div class="ach-group"><div class="ach-group-title">${ag(g)}</div>`+groups[g].map(a=>{
      const on=!!ACH.unlocked[a.id];
      return `<div class="ach-item ${on?'on':'off'}">
        <div class="ach-ico">${on?a.emoji:'🔒'}</div>
        <div class="ach-meta"><div class="ach-name">${achName(a)}</div><div class="ach-desc">${on?achDesc(a):tr('未解锁')}</div></div>
        ${on?`<button class="ach-share" data-share="${a.id}">${tr('分享')}</button>`:''}
      </div>`;
    }).join('')+`</div>`;
  }).join('');
  $('achBody').innerHTML=h;
  $('achModal').classList.add('show');
  $('achShareAll').onclick=()=>shareProgress();
  $('achBody').querySelectorAll('[data-share]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); shareAchievement(b.getAttribute('data-share')); });
}
function shareTextFor(id){
  const a=ACHIEVEMENTS.find(x=>x.id===id); if(!a) return '';
  const gName=tr('无间轮回 · PEEK');
  return tr('我在《{game}》解锁了成就「{name}」——{desc}', {game:gName, name:achName(a), desc:achDesc(a)});
}
function shareProgress(){
  const total=ACHIEVEMENTS.length, got=ACHIEVEMENTS.filter(a=>ACH.unlocked[a.id]).length;
  const zc=ZODIACS.filter(z=>ACH.unlocked['z_'+z.name]).length;
  const gName=tr('无间轮回 · PEEK');
  doShare(tr('我在《{game}》已解锁 {got}/{total} 项成就，征服了 {zc}/12 位生肖庄家。来无间轮回赌一把？', {game:gName, got, total, zc}));
}
function shareAchievement(id){ doShare(shareTextFor(id)); }
function doShare(text){
  if(!window.PEEK_FEATURES || !window.PEEK_FEATURES.share) return;  // 平台关闭分享（通用 iframe）时短路
  const url=location.href;
  const gName=tr('无间轮回 · PEEK');
  if(navigator.share){
    navigator.share({title:gName, text:text, url:url}).catch(()=>copyText(text+'\n'+url));
  } else { copyText(text+'\n'+url); }
}
function copyText(t){ try{ navigator.clipboard.writeText(t); }catch(e){} miniToast(tr('链接已复制')); }
function miniToast(msg){
  const g=document.getElementById('game'); if(!g) return;
  let t=document.getElementById('miniToast');
  if(!t){ t=document.createElement('div'); t.id='miniToast'; t.className='mini-toast'; g.appendChild(t); }
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),1800);
}
/* ===== 每枪结果提示 Toast（v2.6.65 新手引导）=====
 * 左滑入→中央停住→右滑出（CSS 动画自收尾）；框色=下一回合是谁：next='player'青 / 'dealer'红。
 * 纯展示层：pointer-events:none 不挡操作、不加锁；单例元素，连枪时 reflow 重置直接打断旧条重播。 */
function shotToast(msg, next, delay){
  const g=document.getElementById('game'); if(!g) return;
  if(shotToast._pend && shotToast._pend.cancel) shotToast._pend.cancel();   // 打断上一条尚未出场的延迟 Toast
  const show=()=>{
    shotToast._pend=null;
    let t=document.getElementById('shotToast');
    if(!t){ t=document.createElement('div'); t.id='shotToast'; t.className='shot-toast'; g.appendChild(t); }
    // 两行版式：key 值内用 \n 分隔——第一行大字=接下来谁出手，第二行小字=原因
    const parts=String(msg).split('\n');
    t.innerHTML=parts[0]+(parts[1]?'<span class="sub">'+parts[1]+'</span>':'');
    t.className='shot-toast';          // 先重置
    void t.offsetWidth;                // 强制 reflow，保证动画可重触发
    t.className='shot-toast go '+(next==='player'?'nextP':'nextD');
  };
  // 默认延迟 650ms：等枪的图片完全降下（定格 200–240ms + 下降 340ms）再滑入，避免被 z25 的 #gunLayer 盖住。
  // 装弹完毕等无枪场景传 0 立即显示。ActorFire 锁屏自动暂停，不会错位。
  const d=(delay===undefined?TOAST_HANDOVER_DELAY:delay);
  if(d>0){ shotToast._pend=ActorFire(show,d); } else { show(); }
}
/* 庄家使出道具等更重要的新事件出现时，立即清掉在场/待出场的 Toast（让位） */
function clearShotToast(){
  if(shotToast._pend && shotToast._pend.cancel) shotToast._pend.cancel();
  shotToast._pend=null;
  const t=document.getElementById('shotToast'); if(t) t.className='shot-toast';
}
/* 庄家空包续打的「放大」提示：挂 .dealer 层（.mask 的 className 被 dealerMood 整串重写、.mask-wrap 有
 * .shake 震动动画，均不可挂）。keyframes 末帧自回 scale(1)，这里只负责触发与防御性清除。 */
function dealerHintBig(){
  const d=document.querySelector('#dealerZone .dealer'); if(!d) return;
  d.classList.remove('hint-big'); void d.offsetWidth;   // reflow 允许连续触发重播
  d.classList.add('hint-big');
  if(d._hb && d._hb.cancel) d._hb.cancel();
  d._hb=ActorFire(()=>{ d.classList.remove('hint-big'); }, 2700);
}
function clearHintBig(){
  const d=document.querySelector('#dealerZone .dealer'); if(!d) return;
  if(d._hb && d._hb.cancel) d._hb.cancel();
  d.classList.remove('hint-big');
}
/* 气泡「金色说明行 + 生肖台词」：dealerSay 走 textContent 无法带 HTML，这里单独拼 innerHTML。
 * 与 dealerSay 同一气泡单例、同一 _t 计时器句柄，互相覆盖不叠加。 */
function dealerSayHint(hint, text, ms){
  if(S && betFlowPaused()) return;
  const b=$('bubble'); if(!b) return;
  b.innerHTML='<span class="hint-line">'+tr(hint)+'</span>'+tr(text);
  b.classList.add('show');
  if(b._t && b._t.cancel) b._t.cancel();
  b._t=ActorFire(()=>{ if(b){ b.classList.remove('show'); b.textContent=''; } }, ms||2600);
}
/* ===== 🏆 成就奖励系统（里程碑天赋） ===== */
// 按固定生肖顺序：击败双数关解锁永久增益，跨局继承
function getPlayerBonuses(){
  let hpBonus=0, peekBonus=0, hasReveal=false;
  const ms=[
    {idx:1, fn:()=>hpBonus=Math.max(hpBonus,1)},
    {idx:3, fn:()=>peekBonus=Math.max(peekBonus,1)},
    {idx:5, fn:()=>peekBonus=Math.max(peekBonus,2)},
    {idx:7, fn:()=>hpBonus=Math.max(hpBonus,2)},
    {idx:9, fn:()=>peekBonus=Math.max(peekBonus,1)},
    {idx:11,fn:()=>{hasReveal=true}}
  ];
  ms.forEach(m=>{ const p=STATS.perIndex[m.idx]; if(p&&p.win>0) m.fn(); });
  return {hpBonus,peekBonus,hasReveal, totalBonus:hpBonus+peekBonus};
}
function milestoneDesc(){
  const b=getPlayerBonuses();
  const r=[];
  if(b.hpBonus>0) r.push(tr('血量上限 +{n}',{n:b.hpBonus}));
  if(b.peekBonus>0) r.push(tr('偷看次数 +{n}',{n:b.peekBonus}));
  if(b.hasReveal) r.push(tr('自动揭示'));
  return r.length ? r.join(' · ') : tr('暂无');
}
// 每个里程碑的叙述（zh key + 永久奖励说明）
const MILESTONES = [
  {zodiacIdx:1, nameKey:'馈赠·马蹄血',  textKey:'午马赠你马蹄血：\n它倒下时咳了一口血在枪管里，你舔干了它。从此你的心脏多跳一拍。\n\n（永久）血量上限 +1（4→5）。'},
  {zodiacIdx:3, nameKey:'馈赠·鼠眼窥',  textKey:'子鼠赠你鼠眼窥：\n它每夜蹲在枪膛旁边偷看，你便也学会了它的眼。下次濒死时，你看得更清。\n\n（永久）偷看次数 +1（2→3）。'},
  {zodiacIdx:5, nameKey:'馈赠·司晨报晓', textKey:'酉鸡赠你司晨报晓：\n鸡叫之前，你的耳朵已经先醒来。再多一次窥视，你看穿黑夜的把握更足。\n\n（永久）偷看次数 +1（3→4）。'},
  {zodiacIdx:7, nameKey:'馈赠·铁牛皮厚', textKey:'丑牛赠你铁牛皮厚：\n它挡住了多少颗实弹？数不清。但你接过来了。下一局开打，你更能扛。\n\n（永久）血量上限 +1（5→6）。'},
  {zodiacIdx:9, nameKey:'馈赠·虎魄叼物', textKey:'寅虎赠你虎魄叼物：\n它伏倒时，一缕虎魄钻进你的眼睛，从此每一次窥视，你都比旁人多看一眼。\n\n（永久）偷看次数 +1。'},
  {zodiacIdx:11,nameKey:'馈赠·龙鳞察微', textKey:'辰龙赠你龙鳞察微：\n它的鳞片飞过你的眼睛，从此第一发子弹在你眼里藏不住。\n\n（永久）每局装弹后，自动揭示第一发类型。'}
];
function showMilestoneModal(idx, after){
  const m = MILESTONES.find(x=>x.zodiacIdx===idx);
  if(!m){ if(after) after(); return; }
  // 已见过的里程碑（含读档重打）直接续走，不再弹出
  if(_milestonesSeen.has(idx)){ if(after) after(); return; }
  const z=ZODIACS[idx];
  const face=$('msFace'), bubble=$('msBubble'), reward=$('msReward');
  if(face && z) face.innerHTML=peekMaskImg(z);
  if(reward) reward.textContent=tr(m.nameKey);
  if(bubble) bubble.innerHTML=tr(m.textKey).replace(/\n/g,'<br>');
  $('milestoneModal').classList.add('show');
  S.pausedForBet=false;  // 简单起见：直接展示
  _milestoneAfter=after;
}
let _milestoneAfter=null;
function milestoneContinue(){
  const after=_milestoneAfter; _milestoneAfter=null;
  // 接受馈赠后才标记“已见”，确保续走逻辑与首次一致
  markMilestoneSeen(RUN.index);
  if(after) after();
  else if(RUN.index===ZODIACS.length-1) showTwist();
  else { nextZodiac(); showIntro(); }
}
$('milestoneBtn').onclick=()=>{
  $('milestoneModal').classList.remove('show');
  milestoneContinue();
};
$('milestoneModal').addEventListener('click', e=>{ if(e.target.id==='milestoneModal'){ $('milestoneModal').classList.remove('show'); milestoneContinue(); } });
/* ===== 存档点已开启提示弹窗（击败 5/8/11 后首次解锁时弹出） ===== */
let _cpUnlockedDone=null;
function showCheckpointUnlocked(idx, done){
  const z=ZODIACS[idx];
  const m=$('cpUnlockedModal'); if(!m){ if(done) done(); return; }
  const reward=`${z.emoji} ${zDisp(z)}`;
  const txt=tr('你击败了 {n}，无间轮回在此留下你的印记。\n日后可从主菜单的「🕯 存档点」继续 —— 已获得的轮回馈赠与印记都会保留。', {n:reward});
  const rEl=$('cpUnlockedReward'); if(rEl) rEl.textContent=reward;
  $('cpUnlockedText').innerHTML=txt.replace(/\n/g,'<br>');
  _cpUnlockedDone=done;
  m.classList.add('show');
  $('cpUnlockedBtn').onclick=()=>{ m.classList.remove('show'); const d=_cpUnlockedDone; _cpUnlockedDone=null; if(d) d(); };
}
$('cpUnlockedModal').addEventListener('click', e=>{ if(e.target.id==='cpUnlockedModal'){ const m=$('cpUnlockedModal'); m.classList.remove('show'); const d=_cpUnlockedDone; _cpUnlockedDone=null; if(d) d(); } });
/* ===== 模式解锁弹窗（困难/无尽/地狱），胜利收尾时逐个弹出 ===== */
const UNLOCK_INFO={
  hard:{ico:'⚔️', title:'困 难 轮 回 · 解 锁', text:'你已逼出辰龙的真容。\n十二生肖各执异能，从今往后，你将戴着他们的面具，把这条不归路再走一遍。'},
  endless:{ico:'♾️', title:'无 尽 轮 盘 · 解 锁', text:'你已掀开真正的庄家。\n无间轮盘不会停——击败小丑后，无限连战开启，每一轮都重新摆满道具，去冲排行榜吧。'},
  hell:{ico:'🔥', title:'地 狱 模 式 · 解 锁', text:'困难模式已被你踏平。\n困难异能 + 无尽连战，分数 ×2——这才是真正的无间。'}
};
let unlockQueue=[];
function flushUnlocks(done){
  if(!unlockQueue.length){ if(done) done(); return; }
  const id=unlockQueue.shift();
  const info=UNLOCK_INFO[id]; if(!info){ flushUnlocks(done); return; }
  const m=$('unlockModal'); if(!m){ if(done) done(); return; }
  const ico=$('unlockIco'), mask=$('unlockMask'), txt=$('unlockText'), tit=$('unlockTitle');
  const isEndless = id==='endless';
  if(mask) mask.classList.toggle('unlock-mask-black', isEndless);   // 无尽：头像显示一片黑色
  if(ico) ico.textContent = isEndless ? '' : info.ico;
  if(tit) tit.textContent=tr(info.title);
  if(txt) txt.innerHTML=tr(info.text).replace(/\n/g,'<br>');
  m.classList.add('show');
  $('unlockBtn').onclick=()=>{ m.classList.remove('show'); flushUnlocks(done); };
}
/* 结果页通用「回主菜单」按钮（无尽/小丑胜利等场景复用） */
function addResultMenuBtn(){
  const card=$('result').querySelector('.result-card');
  if(!card) return;
  let menuBtn=document.getElementById('resultBtnMenu');
  if(!menuBtn){ menuBtn=document.createElement('button'); menuBtn.id='resultBtnMenu'; menuBtn.className='result-btn'; card.appendChild(menuBtn); }
  menuBtn.style.display='block'; menuBtn.style.marginTop='10px'; menuBtn.textContent=tr('回主菜单');
  menuBtn.onclick=()=>{ hideResult(); resetRun(); showIntro(); };
  return menuBtn;
}
/* ===== 存档点馈礼：伪装成「好心人」的小丑，一次性 run buff ===== */
function jokerGiftApply(idx){
  // 返回礼物描述（应用后）
  if(idx===5){ RUN.giftPeek=true; return tr('（本次轮回）偷看次数 +1。'); }
  if(idx===8){
    const pool=poolFor(idx); const id=pool[Math.floor(Math.random()*pool.length)];
    if((RUN.playerItems||[]).length<5){ RUN.playerItems.push(id); return tr('获得 1 件道具：{n}（已放入行囊）。', {n:`${PROPS[id].emoji}${PROPS[id].name}`}); }
    return tr('行囊已满，小丑把东西又收了回去，笑了笑。');
  }
  return tr('（这一次，小丑只是看着你，什么也没留下。）');
}
const JOKER_GIFT_TEXT={
  5:'烛火忽明忽暗。小丑不知何时坐到了下一张桌旁，指间转着一枚骰子。\n\n「打赢酉鸡的人，很久没出现过了。」\n「前面的路，会越来越黑。这份『眼力』送你 —— 别急着谢我。」',
  8:'又是小丑。他好像一直坐在那儿等你，手里把玩着一件小东西。\n\n「又见面了。穷家富路，拿着吧。」\n「反正……也不是我的东西。」'
};
function showJokerGift(idx, done){
  // 困难模式不发放/不弹馈礼；已见过的馈礼只弹一次（跨轮回持久化去重）
  if(RUN.hard || _giftsSeen.has(idx)){ done(); return; }
  RUN.giftsGiven[idx]=true;
  const eff=jokerGiftApply(idx);
  markGiftSeen(idx);
  trackEvent('gift',{zodiac_idx:idx,gift:idx===5?'peek':idx===8?'item':idx===11?'revive':'other'});
  const m=$('jokerGiftModal'); if(!m){ done(); return; }
  const rEl=$('jgReward'); if(rEl) rEl.textContent=eff;
  const jgAvatar=$('jgAvatar'); if(jgAvatar) jgAvatar.innerHTML=peekMaskImg(JOKER);
  $('jgText').innerHTML=tr(JOKER_GIFT_TEXT[idx]).replace(/\n/g,'<br>');
  m.classList.add('show');
  $('jgBtn').onclick=()=>{ m.classList.remove('show'); done(); };
}
/* ===== 全球排行榜（Supabase + 本地 fallback） ===== */
const SB_URL = 'https://dxndvfpselbgohmqbior.supabase.co';

// [已拆分] 云存档 / 排行榜 / 分析模块见 public/cloudSave.js（原 1854–2242 行，含 _bindOn 定义）。
// 按钮绑定(_bindOn)与顶层 initLeaderboard()/trackEvent('app_open') 调用保留在本文件，依赖 cloudSave.js 先加载。

_bindOn('setBind', ()=>{ if(!CLOUD_SAVE_ENABLED) return; $('settings').classList.remove('show'); showBindModal(); });
_bindOn('bindBackdrop', ()=>{ $('bindModal').classList.remove('show'); });
_bindOn('bindClose', ()=>{ $('bindModal').classList.remove('show'); });
_bindOn('bindSend', bindEmailSend);
_bindOn('bindUpload', async()=>{
  const nm=($('bindName')?.value||'').trim(); if(nm) try{ localStorage.setItem(LB_NAME_KEY, nm); }catch(e){}
  const btn=$('bindUpload'); btn.disabled=true; const old=btn.textContent; btn.textContent=tr('上传中…');
  const err=await uploadSave(false);
  btn.disabled=false; btn.textContent=old;
  if(!err) showBindModal();   // 刷新「最后上传时间」（会清空状态行，所以状态要在之后再写）
  setBindStatus(err || tr('已上传（云端以本机为准）'), err?'err':'ok');
});
_bindOn('bindDownload', async()=>{
  if(!confirm(tr('从云端下载会覆盖本机当前进度（战绩/成就/存档点/最高分），确定继续？'))) return;
  const btn=$('bindDownload'); btn.disabled=true; const old=btn.textContent; btn.textContent=tr('下载中…');
  const r=await downloadSave();
  btn.disabled=false; btn.textContent=old;
  if(r && r.ok){ showBindModal(); setBindStatus(tr('已取回云端进度（{n} 项）', {n:r.n}), 'ok'); }
  else setBindStatus((r&&r.err)||tr('下载失败，请检查网络后重试'), 'err');
});
_bindOn('setRecover', ()=>{ if(!CLOUD_SAVE_ENABLED) return; $('settings').classList.remove('show'); showRecoverModal(); });
_bindOn('recoverBackdrop', ()=>{ $('recoverModal').classList.remove('show'); });
_bindOn('recoverClose', ()=>{ $('recoverModal').classList.remove('show'); });
_bindOn('recoverSend', recoverSend);

function showStats(){
  const total=STATS.plays||0;
  const wr = total? Math.round(STATS.wins/total*100):0;
  const avgR = total? Math.round(STATS.roundTotal/total*10)/10 : 0;
  const betTot=STATS.betProposed||0, betAcc=STATS.betAccepted||0;
  const betRate = betTot? Math.round(betAcc/betTot*100):0;
  const perIdx = ZODIACS.map((z,i)=>{
    const r=STATS.perIndex[i]||{win:0,lose:0}; const t=r.win+r.lose;
    const rate = t? Math.round(r.win/t*100):0;
    return `<div class="stats-row"><span>${z.emoji} ${zDisp(z)}</span><span>${tr('{w}胜 / {l}负 · {r}%', {w:r.win, l:r.lose, r:rate})}</span></div>`;
  }).join('');
  $('statsBody').innerHTML =
    `<div class="stats-summary">${tr('总场次 <b>{t}</b> · 胜 {w} / 负 {l} · 胜率 <b style="color:var(--cyan)">{r}%</b>', {t:total, w:STATS.wins, l:STATS.losses, r:wr})}</div>`+
    `<div class="stats-summary">${tr('平均回合 <b>{a}</b> · 累计偷看 <b>{p}</b> 次 · 使用道具 <b>{i}</b> 次', {a:avgR, p:STATS.peekTotal||0, i:STATS.itemTotal||0})}</div>`+
    `<div class="stats-summary">${tr('加码：提出 <b>{p}</b> · 接受 <b>{a}</b>（{r}%）· 拒绝 {d}', {p:betTot, a:betAcc, r:betRate, d:STATS.betDeclined||0})}</div>`+
    `<div class="stats-sub">${tr('各生肖战绩')}</div>`+ perIdx;
  $('statsModal').classList.add('show');
}
/* ===== 面具图鉴（成就图鉴 / 猎人标本室） ===== */
const CW_HOLE_SPOTS=[
  {x:50,y:28},{x:37,y:50},{x:63,y:46},{x:46,y:66},{x:58,y:30},
  {x:33,y:36},{x:67,y:62},{x:50,y:50},{x:42,y:72},{x:60,y:70},
  {x:30,y:60},{x:70,y:34}
];
const CW_HOLE_Y_OFFSET={rabbit:14};  // 图鉴兔子面具：长耳占位使脸偏画布上方，弹孔 y 整体下移对齐兔脸；真机可微调
const CW_HOLES_PER=4;
const CW_MASK_BASE='assets/masks/';
const CW_HOLE_SRC='assets/guns/bullethole.webp';
const CW_TIERS=[
  {name:'未入轮回', cond:'尚未击败任何生肖', color:'#6a5b45'},
  {name:'青铜轮回者', cond:'简单模式击败任意 1 个生肖', color:'#9c6b3f'},
  {name:'白银轮回者', cond:'简单模式集齐 12 生肖', color:'#b9c2cc'},
  {name:'黄金轮回者', cond:'简单模式击败小丑（通关一轮）', color:'#c9a24b'},
  {name:'铂金轮回者', cond:'困难模式集齐 12 生肖', color:'#7fb6c4'},
  {name:'钻石轮回者', cond:'困难模式击败小丑', color:'#6fd0e0'},
  {name:'星耀轮回者', cond:'无尽模式集齐 12 生肖', color:'#b07fe0'},
  {name:'王者轮回者', cond:'地狱模式通关小丑（困难+无尽全通）', color:'#e0563f'}
];
function cwJokerIdx(){ return RAW_ZODIACS.findIndex(z=>z.id==='joker'); }
function cwPlayerSeed(){ try{ let s=localStorage.getItem('peek_cw_seed'); if(!s){ s=String(Math.floor(Math.random()*1e9)); localStorage.setItem('peek_cw_seed',s); } return parseInt(s,10)||1; }catch(e){ return 1; } }
function cwHashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function cwMulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function cwHolesFor(id){
  const rnd=cwMulberry32((cwPlayerSeed()^cwHashStr(id))>>>0);
  const idx=[...CW_HOLE_SPOTS.keys()];
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); const t=idx[i]; idx[i]=idx[j]; idx[j]=t; }
  const oy=CW_HOLE_Y_OFFSET[id]||0;
  return idx.slice(0,CW_HOLES_PER).map(i=>{ const s=CW_HOLE_SPOTS[i]; return {x:s.x, y:Math.min(s.y+oy,90)}; });
}
function cwBucket(i){
  const m=RAW_ZODIACS[i];
  if(m.id==='joker'){ const j=STATS.joker||{}; return {win:j.win||0, lose:j.lose||0, modes:j.modes||{normal:0,hard:0,endless:0,hell:0}, firstWin:j.firstWin||0, bullets:j.bullets||0}; }
  const p=STATS.perIndex[i]||{};
  return {win:p.win||0, lose:p.lose||0, modes:p.modes||{normal:0,hard:0,endless:0,hell:0}, firstWin:p.firstWin||0, bullets:p.bullets||0};
}
function cwUnlocked(i){ return cwBucket(i).win>0; }
function cwComputeTier(){
  let anyN=false, n12=true, h12=true, e12=true, story=false;
  for(let i=0;i<RAW_ZODIACS.length;i++){
    const m=RAW_ZODIACS[i];
    if(m.id==='joker'){ if(cwBucket(i).win>0) story=true; continue; }
    const b=cwBucket(i);
    if(b.win>0) anyN=true;
    if(b.modes.normal<1) n12=false;
    if(b.modes.hard<1) h12=false;
    if(b.modes.endless<1) e12=false;
  }
  if(h12&&e12&&story) return 7;
  if(e12) return 6;
  if(h12&&story) return 5;
  if(h12) return 4;
  if(story) return 3;
  if(n12) return 2;
  if(anyN) return 1;
  return 0;
}
function cwSummary(){
  let n=0, bullets=0, wins=0;
  for(let i=0;i<RAW_ZODIACS.length;i++){ if(!cwUnlocked(i)) continue; const b=cwBucket(i); n++; bullets+=(b.bullets||0); wins+=b.win; }
  return {n,bullets,wins};
}
let cwView='grid', cwCur=0, cwMode='inscript', cwCols=3, cwWired=false;
function cwModeLabel(){ return cwMode==='inscript'?tr('显示：铭文'):(cwMode==='stats'?tr('显示：战绩'):tr('显示：铭文+战绩')); }
function cwHolesHTML(id, locked){ if(locked) return ''; return cwHolesFor(id).map(s=>`<img class="cw-bullet-hole" src="${CW_HOLE_SRC}" style="left:${s.x}%;top:${s.y}%">`).join(''); }
function cwCardHTML(i){
  const m=RAW_ZODIACS[i]; const locked=!cwUnlocked(i);
  const nm=zDisp(m);
  const stageCls='cw-stage'+(locked?' locked':'');
  const maskOrQ = locked ? `<div class="cw-lock">?</div>` : `<div class="cw-maskwrap"><img src="${CW_MASK_BASE}${m.id}.webp" alt="${nm}"></div>`;
  const nameTxt = locked ? '？' : nm;
  let sub='', panel='';
  if(!locked){
    const b=cwBucket(i);
    sub = tr('首次击败 {d}', {d: b.firstWin? new Date(b.firstWin).toISOString().slice(0,10) : '—'});
    let ins='', st='';
    if(cwMode==='inscript'||cwMode==='both') ins=`<div class="cw-inscript">${tr(m.defeat).replace(/\n/g,'<br>')}</div>`;
    if(cwMode==='stats'||cwMode==='both'){
      const md=b.modes;
      st=`<div class="cw-stats">`
        +`<div class="row"><span>${tr('简单模式')} <b>${md.normal}</b></span><span>${tr('困难模式')} <b>${md.hard}</b></span><span>${tr('无尽模式')} <b>${md.endless}</b></span><span>${tr('地狱模式')} <b>${md.hell}</b></span></div>`
        +`<div class="row"><span>${tr('胜')} <b>${b.win}</b></span><span>${tr('负')} <b>${b.lose}</b></span></div>`
        +`<div class="bullet-line">${tr('射向{t}的子弹 {n} 发', {t:nameTxt, n:'{n}'}).replace('{n}', `<b class="bullet-num">${b.bullets||0}</b>`)}</div>`
        +`</div>`;
    }
    panel=`<div class="cw-panel">${st}${ins}</div>`;
    if(m.id==='joker') panel+=`<div class="cw-joker-note">${tr('你打穿了无间轮回，却忘了自己为何而来。')}</div>`;
  } else if(m.id==='joker'){
    panel=`<div class="cw-joker-note">${tr('真正的庄家，击败辰龙后才会现身。')}</div>`;
  }
  return `<div class="cw-card"><div class="${stageCls}">${maskOrQ}<div class="cw-holes">${cwHolesHTML(m.id, locked)}</div></div>`
    +`<div class="cw-info"><div class="cw-name">${nameTxt}</div>${sub?`<div class="cw-sub">${sub}</div>`:''}${panel}</div></div>`;
}
function cwBuildSingle(){ const t=$('cwTrack'); if(t) t.innerHTML=RAW_ZODIACS.map((m,i)=>cwCardHTML(i)).join(''); cwApplyTrack(); }
function cwApplyTrack(){ const t=$('cwTrack'); if(t) t.style.transform='translateX('+(-cwCur*100)+'%)'; }
function cwCellHTML(i){
  const m=RAW_ZODIACS[i]; const locked=!cwUnlocked(i);
  const cls='cw-cell'+(locked?' locked':'')+(m.id==='joker'?' joker':'');
  const body = locked ? `<div class="cw-q">?</div>` : `<div class="cw-thumbwrap"><img src="${CW_MASK_BASE}${m.id}.webp" alt="${zDisp(m)}">${cwHolesHTML(m.id, locked)}</div>`;
  const cap = locked ? '？' : zDisp(m);
  return `<div class="${cls}" data-idx="${i}">${body}<div class="cw-cap">${cap}</div></div>`;
}
function cwRenderGrid(){
  const g=$('cwGridCells'); if(g){ g.style.gridTemplateColumns='repeat('+cwCols+',1fr)'; g.innerHTML=RAW_ZODIACS.map((m,i)=>cwCellHTML(i)).join(''); }
}
function cwRenderSummary(){
  const t=CW_TIERS[cwComputeTier()], s=cwSummary();
  const el=$('cwSummary'); if(el) el.innerHTML=
    `<span class="tier" style="color:${t.color}">${tr(t.name)}</span>`
    +`<span class="s">${tr('已收录 {n}/{total}', {n:s.n, total:RAW_ZODIACS.length})}</span>`
    +`<span class="s">${tr('射向生肖子弹 {n} 发', {n:s.bullets})}</span>`
    +`<span class="s">${tr('总胜场 {n}', {n:s.wins})}</span>`;
}
function cwUpdateHead(){
  const n=RAW_ZODIACS.filter((m,i)=>cwUnlocked(i)).length;
  const c=$('cwCount'); if(c) c.textContent=tr('已收录 {n}/{total}', {n, total:RAW_ZODIACS.length});
  const colsBtn=$('cwCols'); if(colsBtn){ colsBtn.textContent=tr('列数：{n}',{n:cwCols}); colsBtn.style.display=cwView==='single'?'none':''; }
  const viewBtn=$('cwView'); if(viewBtn){ viewBtn.textContent=tr('返回'); viewBtn.style.display=cwView==='single'?'':'none'; }
  const modeBtn=$('cwMode'); if(modeBtn) modeBtn.textContent=cwModeLabel();
  const hint=$('cwHint'); if(hint) hint.textContent = cwView==='single'?tr('← 滑动切换 · 点「返回」看全部 →'):tr('点击面具查看详情');
}
function cwRefresh(){ cwBuildSingle(); cwRenderGrid(); cwRenderSummary(); cwUpdateHead(); }
function cwSetView(v){
  cwView=v;
  const s=$('cwSingle'), g=$('cwGrid'), nl=$('navL'), nr=$('navR');
  if(s) s.style.display=v==='single'?'flex':'none';
  if(g) g.style.display=v==='grid'?'block':'none';
  if(nl) nl.style.display=v==='single'?'flex':'none';
  if(nr) nr.style.display=v==='single'?'flex':'none';
  const vb=$('cwView'); if(vb){ vb.textContent=tr('返回'); vb.style.display=v==='single'?'':'none'; }
  const cb=$('cwCols'); if(cb) cb.style.display=v==='single'?'none':'';
  try{ localStorage.setItem('peek_cw_view',v); }catch(e){}
  if(v==='single') cwBuildSingle(); else { cwRenderGrid(); cwRenderSummary(); }
}
function cwGo(d){ cwCur=(cwCur+d+RAW_ZODIACS.length)%RAW_ZODIACS.length; cwApplyTrack(); }
function cwShowModal(){ const m=$('cwModal'); if(m) m.classList.add('on'); }
function cwHideModal(){ const m=$('cwModal'); if(m) m.classList.remove('on'); }
function cwBuildTierList(){ const el=$('cwTierList'); if(el) el.innerHTML=CW_TIERS.slice(1).map(t=>`<div class="cw-tier-row"><span class="tn" style="color:${t.color}">${tr(t.name)}</span><span class="tc">${tr(t.cond)}</span></div>`).join(''); }
function showCompendium(){
  const el=$('compendium'); if(!el) return;
  el.style.display='flex';
  cwView='grid';                          // 每次进入都预设网格模式
  cwBuildTierList();
  cwRefresh();
  cwSetView(cwView);
  if(!cwWired){
    cwWired=true;
    const nl=$('navL'), nr=$('navR');
    if(nl) nl.onclick=()=>cwGo(-1);
    if(nr) nr.onclick=()=>cwGo(1);
    const bv=$('cwView'); if(bv) bv.onclick=()=>cwSetView(cwView==='single'?'grid':'single');
    const bm=$('cwMode'); if(bm) bm.onclick=function(){ cwMode=cwMode==='inscript'?'stats':(cwMode==='stats'?'both':'inscript'); cwUpdateHead(); if(cwView==='single') cwBuildSingle(); };
    const bc=$('cwCols'); if(bc) bc.onclick=function(){ cwCols=cwCols===3?4:3; cwUpdateHead(); if(cwView==='grid') cwRenderGrid(); };
    const gc=$('cwGridCells');
    if(gc) gc.addEventListener('click', e=>{ const cell=e.target.closest('.cw-cell'); if(!cell) return; cwCur=parseInt(cell.getAttribute('data-idx'),10)||0; cwSetView('single'); });
    const bx=$('cwClose'); if(bx) bx.onclick=()=>hideCompendium();
    const bh=$('cwTierHelp'); if(bh) bh.onclick=cwShowModal;
    const bmc=$('cwModalClose'); if(bmc) bmc.onclick=cwHideModal;
    const cm=$('cwModal'); if(cm) cm.onclick=(e)=>{ if(e.target===cm) cwHideModal(); };
    const bsh=$('cwShare'); if(bsh) bsh.onclick=function(){ const t=CW_TIERS[cwComputeTier()], s=cwSummary(); doShare(tr('🎯 Peek 面具图鉴 · 称号【{t}】\n已收录 {n}/{total} · 射向生肖子弹 {b} 发\n来挑战你的无间轮回 →', {t:tr(t.name), n:s.n, total:RAW_ZODIACS.length, b:s.bullets})); };
    const vp=$('cwViewport'); let sx=0,sy=0,drag=false;
    if(vp){
      const down=(x,y)=>{ sx=x; sy=y; drag=true; };
      const up=(x,y)=>{ if(!drag||cwView!=='single'){ drag=false; return; } drag=false; const dx=x-sx, dy=y-sy; if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)) cwGo(dx<0?1:-1); };
      vp.addEventListener('touchstart', e=>down(e.touches[0].clientX,e.touches[0].clientY), {passive:true});
      vp.addEventListener('touchend', e=>up(e.changedTouches[0].clientX,e.changedTouches[0].clientY));
      vp.addEventListener('mousedown', e=>down(e.clientX,e.clientY));
      vp.addEventListener('mouseup', e=>up(e.clientX,e.clientY));
    }
  }
}
function hideCompendium(){ const el=$('compendium'); if(el) el.style.display='none'; cwHideModal(); }
function showResult(mode){
  RUN.lastResult = mode; // 记录胜负，供分享卡区分「已通关进度」与「止步」
  resetFx(); // 防御性清理：结算弹窗出现时清掉上一局残留的 Canvas 血溅/闪光特效，避免红屏残留在弹窗上
  if(mode==='death') endAnalyticsSession('death');
  if(!S) return;
  // 在 recordGameEnd 更新战绩之前快照「解锁前」状态，用于检测本局新解锁的模式（困难/无尽/地狱）
  const _wasHard=hardUnlocked(), _wasEndless=endlessUnlocked(), _wasHell=hellUnlocked();
  recordGameEnd(mode);   // P2 埋点：记录每局结果（胜/负/关/回合/道具使用）
  scheduleCloudSync();   // 云存档：已绑定邮箱才上传，1.5s 后异步跑，不阻塞结算演出
  autoSubmitLb().catch(()=>{});        // 排行榜：每局结束自动提交（仅无尽/地狱；fire-and-forget，不弹 toast）
  // 结果弹窗出现时，强制关闭所有可能覆盖/冲突的弹窗
  const aM=$('awakenModal'); if(aM) aM.classList.remove('show');
  const dM=$('deathstarModal'); if(dM) dM.classList.remove('show');
  const rb=$('roundbreak'); if(rb) rb.classList.remove('show');
  if(S && S.bet){ S.bet=null; } S.pausedForBet=false;
  const btoast=$('betToast'); if(btoast){ btoast.classList.remove('show'); btoast.style.display='none'; }
  // 每日挑战计分 + 战斗总结
  if(RUN.daily && !dailyDoneToday()){
    const win = mode==='victory';
    const hp = S.php||0, peekMax = S.peekMax||0, peekUsed = S.peekCount||0, itemsLeft = S.itemsPlayer?.length||0;
    const score = win ? hp * 100 + Math.max(0, peekMax - peekUsed) * 50 + Math.max(0, 5 - itemsLeft) * 20 : 0;
    const stat = {
      date: Math.floor(Date.now()/86400000),
      score, win,
      zodiac: RUN.zodiac.id,
      zodiacTitle: tr(RUN.zodiac.title),
      hp, hpMax: S.phpMax||4,
      dealerHp: S.dhp||0, dealerHpMax: S.dhpMax||0,
      peekMax, peekUsed,
      itemsUsed: (S.itemUseCount||0),
      shots: S.shots||0
    };
    try{ localStorage.setItem(DAILY_KEY, JSON.stringify(stat)); }catch(e){}
  }
  const ov=$('result'), t=$('resultTitle'), z=$('resultZodiac'), s=$('resultStory'), l=$('resultLoot'), b=$('resultBtn');
  const mb=document.getElementById('resultBtnMenu'); if(mb) mb.style.display='none';
  ov.classList.add('show');
  if(mode==='victory') sfxVictory();
  if(l){ l.innerHTML=''; l.style.display='none'; }
  t.className='result-title '+(mode==='death'?'death':'victory');
  t.textContent=mode==='death'?tr('死'):tr('破');
  const zc=RUN.zodiac;
  if(mode==='death'){
    if(RUN.endless){
      const prevBest = RUN.best;
      endlessSaveBest();
      const isNewBest = RUN.score > prevBest;
      $('crack').style.display='block'; makeCrack();
      z.textContent=tr('无尽模式 · 终结');
      s.innerHTML='';
      typeText(s, tr('连胜 {s} · 分数 {sc}\n最佳 {best}\n\n无间轮回里，你终究还是倒下了。\n但轮盘不会停——它只是换了个人，继续转。', {s: RUN.streak, sc: RUN.score, best: RUN.best}));
      b.textContent=RUN.hard?tr('再战地狱模式'):tr('再战无尽模式');
      b.onclick=()=>{ hideResult(); enterEndless(RUN.hard); };
      const card=$('result').querySelector('.result-card');
      let menuBtn=document.getElementById('resultBtnMenu');
      if(!menuBtn){ menuBtn=document.createElement('button'); menuBtn.id='resultBtnMenu'; menuBtn.className='result-btn'; card.appendChild(menuBtn); }
      menuBtn.style.display='block'; menuBtn.style.marginTop='10px'; menuBtn.textContent=tr('回主菜单');
      menuBtn.onclick=()=>{ hideResult(); resetRun(); showIntro(); };
      // 排行榜提交按钮（仅在无尽模式且平台开启排行榜时显示）
      if(window.PEEK_FEATURES.leaderboard){
        let lbBtn=document.getElementById('resultLbBtn');
        if(!lbBtn){ lbBtn=document.createElement('button'); lbBtn.id='resultLbBtn'; lbBtn.className='result-btn'; lbBtn.style.marginTop='8px'; card.appendChild(lbBtn); }
        lbBtn.style.display='block'; lbBtn.textContent=tr('🏆 提交排行榜');
        lbBtn.onclick=()=>{ hideResult(); showLeaderboardSubmit(); };
        if(isNewBest){ setTimeout(()=>showLeaderboardSubmit(), 700); } // 新纪录自动弹「上传到全球榜」确认
      }
    } else {
      $('crack').style.display='block'; makeCrack();
      const _lb=document.getElementById('resultLbBtn'); if(_lb) _lb.style.display='none';  // 普通模式不显示排行榜按钮
      z.textContent=tr(zc.title);
      s.innerHTML='';
      const main=RUN.daily
        ? tr('今日挑战 · 你还太弱，没有资格挑战今日守护的我。\n\n{t} 在我的地盘上，被我一招打回原形了。\n\n「你以为这样就完了吗？明天同一时辰，我会在原地等你——只不过，下次你还是会输。」', {t: tr(zc.title)})
        : tr('子时三刻，你的执念散了。\n\n{t} 收走了你的命。\n\n「你以为你死了吗？这里可是无间轮回呀，我等你醒来继续呀，哈哈哈」', {t: tr(zc.title)});
      const amnesia=tr('你醒来的时候会忘记刚刚我们的对局，这才是这个世界可怕的地方呀。');
      typeText(s, main, ()=>{
        const span=document.createElement('span'); span.style.color='var(--dim)'; span.textContent='\n\n'+amnesia; s.appendChild(span);
        const rec=document.createElement('div'); rec.innerHTML=deathRecapHTML(); s.appendChild(rec);
      });
      b.textContent=tr('重新开始');
      b.onclick=()=>{ hideResult(); resetRun(); showIntro(); };
    }
  } else {
    if(!RUN.daily){
      awardVictory();   // 每日挑战独立：不触发生肖成就解锁
      // 苦难模式解锁：仅普通模式击败辰龙（index 11）方计入；今日挑战的龙不解锁（避免绕过正式流程）
      if(!RUN.endless && !RUN.isJoker && RUN.index===11){ STATS.hardClear=true; saveStats(); }
      // 对比「解锁前/后」，将本局新解锁的模式入队，并立即弹出解锁弹窗（覆盖在结果页之上）
      if(hardUnlocked() && !_wasHard) unlockQueue.push('hard');
      if(endlessUnlocked() && !_wasEndless) unlockQueue.push('endless');
      if(hellUnlocked() && !_wasHell) unlockQueue.push('hell');
      if(unlockQueue.length) flushUnlocks();
    }
    $('crack').style.display='none';
    // 无限模式：连胜 + 分数，直接进下一轮（无掉落）
    if(RUN.endless){
      RUN.streak++; RUN.score += Math.round((5 + RUN.endlessTier*2) * endlessMult() * (RUN.hard?2:1));   // 地狱模式（困难+无尽）分数 ×2
      endlessSaveBest();
      z.textContent=tr('已战胜：{t} · 连胜 {s}', {t: tr(zc.title), s: RUN.streak});
      typeText(s, tr('{d}\n\n连胜 {s} · 分数 {sc}（倍率 ×{m}）。\n桌上已重新摆满道具，下一轮庄家更强。', {d: tr(zc.defeat), s: RUN.streak, sc: RUN.score, m: endlessMult().toFixed(2)}));
      b.textContent=tr('下一轮 ▶');
      b.onclick=()=>{ hideResult(); nextZodiac(); reset(); };
      addResultMenuBtn();
    }
    // 小丑：真通关 / 无限轮回
    else if(RUN.isJoker){
      z.textContent=tr('已战胜：{t}', {t: tr(zc.title)});
      typeText(s, tr('{d}\n\n通关？不，这里从来没有什么通关。\n你马上就会忘记所有的一切，然后再重新开始。\n绝望吗？不，你根本不记得，所以你只会无限的重来。。', {d: tr(zc.defeat)}));
      b.textContent=tr('踏入无尽模式');
      b.onclick=()=>{ hideResult(); flushUnlocks(()=>{ try{ enterEndless(RUN.hard); }catch(e){ console.error(e); gmToast && gmToast(tr('进入无尽失败，请刷新')); } }); };
      addResultMenuBtn();
    } else {
      z.textContent=tr('已战胜：{t}', {t: tr(zc.title)});
      const _lb=document.getElementById('resultLbBtn'); if(_lb) _lb.style.display='none';  // 普通模式不显示排行榜按钮
      // 每日挑战：不掉落、不给道具，直接返回主菜单
      if(RUN.daily){
        typeText(s, tr(zc.defeat));
        b.textContent=tr('返回主菜单');
        b.onclick=()=>{ hideResult(); resetRun(); showIntro(); flushUnlocks(); };
        return;
      }
      // 第一段：仅显示 defeat 文案
      typeText(s, tr(zc.defeat));
      b.textContent=tr('你好像发现庄家遗落了什么？');
      b.onclick=()=>{
        // 生成掉落：首关(教学)掉 2 随机；其余关必掉该生肖招牌道具(zodiac.drop) + 随机 1 个
        if(RUN.index===0) RUN.itemsUnlocked=true;
        const zc=RUN.zodiac, pool=poolFor(RUN.index);
        let drops=[];
        if(RUN.index>0 && zc.drop && zc.drop.length){
          drops.push(zc.drop[0]);
          const c=pool.slice(); const ki=c.indexOf(zc.drop[0]); if(ki>=0) c.splice(ki,1);
          if(c.length) drops.push(c.splice(Math.floor(Math.random()*c.length),1)[0]);
        } else {
          const c=pool.slice();
          for(let i=0;i<2;i++){ if(!c.length) break; drops.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); }
        }
        RUN.lastDrop=drops;
        const isFirstUnlock=RUN.index===0;
        const dropText=isFirstUnlock
          ? tr('庄家面具落地，散出几样还带着体温的物件——你忽然明白了它们的用法，道具栏就此开启。从此，你不必赤手空拳地走进无间。')
          : tr('庄家溃散后，留下几件遗物。');
        typeText(s, dropText);
        if(l && drops.length){
          const zName=zDisp(RUN.zodiac);
          l.innerHTML=`<div class="loot-head">${tr('{n} 留下的遗物', {n:zName})}</div>`+drops.map(id=>`<div class="loot-item"><span class="loot-emoji">${PROPS[id].emoji}</span><span class="loot-name">${PROPS[id].name}</span></div>`).join('');
          l.style.display='flex';
        }
        const isFinal=RUN.index===ZODIACS.length-1;
        const msIdx = MILESTONES.find(m=>m.zodiacIdx===RUN.index);
        b.textContent=isFinal?tr('走向出口'):tr('迎战下一生肖');
        // 真正推进到下一关 / 假结局（辰龙）的流程
        const realCont=()=>{
          if(isFinal){ showTwist(); }
          else { nextZodiac(); showIntro(); }
        };
        // 小丑送礼之后：若本局新解锁存档点，弹「存档点已开启」提示，再推进
        const afterCheckpoint=()=>{
          if(S && S.newCheckpoint){
            const cpIdx=S.newCheckpoint; S.newCheckpoint=null;
            showCheckpointUnlocked(cpIdx, realCont);
          } else realCont();
        };
        // 里程碑（轮回馈赠）之后：若是存档点且馈礼未见过，弹小丑送礼；否则直接推进
        const afterMilestone=()=>{
          if(!RUN.hard && JOKER_GIFT_IDX.includes(RUN.index) && !_giftsSeen.has(RUN.index)){ showJokerGift(RUN.index, afterCheckpoint); }
          else afterCheckpoint();
        };
        b.onclick=()=>{
          hideResult();
          // 先弹新解锁模式弹窗（若有），收尾再走 里程碑→小丑→存档点提示→推进
          if(unlockQueue.length){ flushUnlocks(()=>{ if(msIdx) showMilestoneModal(msIdx.zodiacIdx, afterMilestone); else afterMilestone(); }); }
          else if(msIdx){ showMilestoneModal(msIdx.zodiacIdx, afterMilestone); }
          else afterMilestone();
        };
      };
    }
  }
}
function hideResult(){ $('result').classList.remove('show'); flushAchToast(); }
/* ===== 小丑惊吓故障层（移植自 prototypes/peek-joker-fx-preview.html Demo）=====
   仅 showTwist() 假结局弹窗使用：CSS 故障层 + Canvas 撕裂层，触发后约 2.2s 自动衰减回静态暗色。 */
const _jokerGlitch = (() => {
  let canvas=null, ctx=null, GW=0, GH=0, DPR=1;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SETTLE_MS = 2200; // 故障爆发 + 抖动只播约 2.2 秒，之后弹窗恢复静态暗色
  const STATE = { power:0, openT:0, rafId:null, lastT:0, settleTimer:null };
  function resize(){
    if(!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio||1, 2);
    GW = r.width; GH = r.height;
    if(GW<=0||GH<=0) return;
    canvas.width = Math.floor(GW*DPR); canvas.height = Math.floor(GH*DPR);
    canvas.style.width = GW+'px'; canvas.style.height = GH+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  function loop(now){
    try{
      if(!STATE.lastT) STATE.lastT = now;
      const dt = Math.min(64, now-STATE.lastT); STATE.lastT = now;
      const elapsed = now - STATE.openT;
      let target;
      if(elapsed < 500) target = 1;
      else if(elapsed < SETTLE_MS) target = 0.55 * (1 - (elapsed-500)/(SETTLE_MS-500));
      else target = 0;
      STATE.power += (target - STATE.power) * Math.min(1, dt*0.012);
      ctx.clearRect(0,0,GW,GH);
      if(STATE.power > 0.02){
        ctx.fillStyle='rgba(0,0,0,.30)'; ctx.fillRect(0,0,GW,GH);
        ctx.globalAlpha=.06; ctx.fillStyle='#ffffff';
        for(let y=0;y<GH;y+=3) ctx.fillRect(0,y,GW,1);
        ctx.globalAlpha=1;
        const n = Math.floor(STATE.power*7);
        for(let i=0;i<n;i++){
          const y=Math.random()*GH, h=2+Math.random()*9;
          const dx=(Math.random()*2-1)*STATE.power*34;
          const col=Math.random()<.5?'255,40,60':'40,200,255';
          ctx.globalCompositeOperation='screen';
          ctx.fillStyle='rgba('+col+','+(0.22*STATE.power)+')';
          ctx.fillRect(dx, y, GW, h);
        }
        ctx.globalCompositeOperation='source-over';
        const dots=Math.floor(STATE.power*60);
        for(let i=0;i<dots;i++){
          ctx.fillStyle='rgba(255,255,255,'+(Math.random()*0.18*STATE.power)+')';
          ctx.fillRect(Math.random()*GW, Math.random()*GH, 1.5, 1.5);
        }
        if(Math.random()<0.04*STATE.power){
          ctx.fillStyle='rgba(255,40,60,'+(0.10*STATE.power)+')';
          ctx.fillRect(0,0,GW,GH);
        }
      }
      if(STATE.power > 0.001){
        STATE.rafId = requestAnimationFrame(loop);
      } else {
        STATE.rafId = null; ctx.clearRect(0,0,GW,GH);
      }
    }catch(err){
      if(STATE.rafId){ cancelAnimationFrame(STATE.rafId); STATE.rafId=null; }
    }
  }
  function open(twistEl){
    if(!canvas){
      canvas = $('glitchCanvas');
      if(!canvas) return;
      ctx = canvas.getContext('2d');
    }
    resize();
    if(GW<=0||GH<=0) return; // 弹窗尚未布局好则不启动 Canvas（CSS 故障层仍生效）
    STATE.power = reduce ? 0.35 : 1;
    STATE.openT = performance.now();
    STATE.lastT = 0;
    twistEl.classList.add('glitch');
    if(STATE.settleTimer) clearTimeout(STATE.settleTimer);
    STATE.settleTimer = setTimeout(()=>{ twistEl.classList.remove('glitch'); }, SETTLE_MS);
    if(!STATE.rafId) STATE.rafId = requestAnimationFrame(loop);
  }
  function close(){
    if(STATE.settleTimer){ clearTimeout(STATE.settleTimer); STATE.settleTimer=null; }
    STATE.power = 0;
    if(STATE.rafId){ cancelAnimationFrame(STATE.rafId); STATE.rafId=null; }
    if(ctx && canvas) ctx.clearRect(0,0,GW,GH);
    const t=$('twist'); if(t) t.classList.remove('glitch');
  }
  window.addEventListener('resize', resize);
  return { open, close };
})();
function showTwist(){
  const t=$('twist');
  $('twistMask').innerHTML=peekMaskImg(JOKER);
  $('twistText').innerHTML=tr('十二生肖，不过是我换脸的小把戏。<br>真正的庄家，才刚刚落座。');
  $('twistBtn').onclick=()=>{ hideTwist(); nextZodiac(); showIntro(); };
  t.classList.add('show'); sfxTwist();
  _jokerGlitch.open(t);
}
function hideTwist(){ _jokerGlitch.close(); $('twist').classList.remove('show'); flushAchToast(); }
function resetRun(){
  RUN.index=0; RUN.zodiac=ZODIACS[0]; RUN.isJoker=false; RUN.peekUnlocked=false; RUN.itemsUnlocked=false; RUN.itemPulseDone=false; RUN.playerItems=[]; RUN.lastDrop=[]; RUN.betIntroduced={}; RUN.endless=false; RUN.daily=false; RUN.endlessTier=0; RUN.streak=0; RUN.score=0;
  RUN.hard=false; RUN.giftPeek=false; RUN.mercyLivePlayer=null; RUN.giftsGiven={};
}
function nextZodiac(){
  if(RUN.endless){
    // 无限模式：循环 12 生肖；走完一轮(回到 0)则档位 +1
    RUN.index=(RUN.index+1)%ZODIACS.length;
    if(RUN.index===0) RUN.endlessTier++;
    RUN.isJoker=false; RUN.zodiac=ZODIACS[RUN.index];
    return;
  }
  if(!RUN.isJoker && RUN.index===ZODIACS.length-1){
    RUN.isJoker=true;
    RUN.zodiac=JOKER;
  } else {
    RUN.index=(RUN.index+1)%ZODIACS.length;
    RUN.zodiac=ZODIACS[RUN.index];
    RUN.isJoker=false;
  }
}
function endlessSaveBest(){ if(RUN.score>RUN.best){ RUN.best=RUN.score; try{ localStorage.setItem('peek_best_endless', RUN.best); }catch(e){} } }
function enterEndless(hard){
  RUN.endless=true; RUN.endlessTier=0; RUN.streak=0; RUN.score=0;
  RUN.index=0; RUN.isJoker=false; RUN.zodiac=ZODIACS[0]; RUN.betIntroduced={};
  RUN.playerItems=[]; RUN.lastDrop=[]; RUN.peekUnlocked=true; RUN.itemsUnlocked=true;
  RUN.hard=!!hard;   // 地狱模式 = 困难能力 + 无尽连战（普通无尽：生肖无特殊能力）
  RUN.daily=false; RUN.giftPeek=false; RUN.mercyLivePlayer=null;
  hideResult();
  hideIntroToGame();
  reset();
  if(S) S.over=false;
  resetFx(); // 防御性清理：无尽/地狱模式入口清掉上一局残留的 Canvas 特效
}
/* 关闭开场界面并切入战斗 BGM（从主菜单直接进无尽/地狱/存档点时使用） */
function hideIntroToGame(){
  const i=$('intro');
  if(i && i.style.display!=='none'){ i.classList.add('hide'); setTimeout(()=>{ i.style.display='none'; },450); }
  audio(); stopBGM(); setTimeout(()=>startBGM('game', RUN.index), 420);
}

/* ===== 轮间过场（弹仓打空时暂停，让玩家看清刚才那一发打的是谁） ===== */
function zbreak(){
  const arr=ROUND_BREAK[RUN.zodiac.id];
  if(arr&&arr.length) return tr(arr[Math.floor(Math.random()*arr.length)]);
  return tr('没想到你又多活过了一轮，下一轮一定干掉你。');
}
function showRoundBreak(isBlankOnly){
  if(!S || S.over) return;
  clearHintBig();   // 防御性清理②：庄家放大中 → 下一枪打空弹仓 → 轮间卡弹出，避免放大态残留
  const ov=$('roundbreak');
  $('rbAvatar').innerHTML=peekMaskImg(RUN.zodiac);
  $('rbZodiac').textContent=tr(RUN.zodiac.title);
  // 此刻才生成下一轮弹仓（主界面在弹窗出现前仍显示“已空”，悬念保留）
  S.chamber=loadChamber(); S.pos=0; S.chamberSpent=false;
  const liveNext=S.chamber.filter(s=>s===LIVE).length;
  const blankNext=S.chamber.filter(s=>s===BLANK).length;
  const prefix=isBlankOnly?tr('都是空包弹了，我们直接开始下一轮装弹吧，嘿嘿')+'\n\n':'';
  $('rbText').textContent=prefix+zbreak()+'\n\n'+zbreakPreview(liveNext,blankNext);
  // 玩家统计（按目标分块）
  const pToDealer=S.pDealerLive+S.pDealerBlank;
  const pDealerHit=S.pDealerLive;
  const pHitRatio=pToDealer?Math.round(pDealerHit/pToDealer*100):0;
  const pToSelf=S.pSelfLive+S.pSelfBlank;
  const pSelfBlankN=S.pSelfBlank;
  const pSelfLiveN=S.pSelfLive;
  const pShots=pToDealer+pToSelf;
  // 庄家统计（按目标分块）
  const dToPlayerN=S.dToPlayer+S.dToPlayerBlank;
  const dPlayerHit=S.dToPlayer;
  const dHitRatio=dToPlayerN?Math.round(dPlayerHit/dToPlayerN*100):0;
  const dToSelf=S.dSelfLive+S.dSelfBlank;
  const dSelfBlankN=S.dSelfBlank;
  const dSelfLiveN=S.dSelfLive;
  const dShots=dToPlayerN+dToSelf;
  $('rbSummary').innerHTML=`
    <div class="rb-stat">
      <div class="rb-role">${tr('你（玩家）')} · ${tr('开枪 <b>{n}</b> 次', {n:pShots})}</div>
      <div class="rb-row"><span>${tr('朝庄家')}</span><span>${tr('命中 <b>{h}</b>/<b>{t}</b>（<b>{r}%</b>）', {h:pDealerHit, t:pToDealer, r:pHitRatio})}</span></div>
      <div class="rb-row"><span>${tr('朝自己')}</span><span>${tr('空包 <b>{n}</b> · 误伤 <b style="color:var(--red)">{h}</b>', {n:pSelfBlankN, h:pSelfLiveN})}</span></div>
    </div>
    <div class="rb-stat rb-damage">
      <div class="rb-role">${tr('庄家 · {n}', {n: zDisp(RUN.zodiac)})} · ${tr('开枪 <b>{n}</b> 次', {n:dShots})}</div>
      <div class="rb-row"><span>${tr('朝你')}</span><span>${tr('命中 <b>{h}</b>/<b>{t}</b>（<b>{r}%</b>）', {h:dPlayerHit, t:dToPlayerN, r:dHitRatio})}</span></div>
      <div class="rb-row"><span>${tr('朝自己')}</span><span>${tr('空包 <b>{n}</b> · 误伤 <b style="color:var(--red)">{h}</b>', {n:dSelfBlankN, h:dSelfLiveN})}</span></div>
    </div>
  `;
  const rbBtn=$('rbBtn');
  // 加码结算不再嵌入轮间总结，仅在开枪时通过 #betBanner 显示
  const rbBet=$('rbBet'); if(rbBet){ rbBet.style.display='none'; rbBet.innerHTML=''; }
  S._rbBetDetail=null;
  rbBtn.textContent=tr(RB_RETORTS[Math.floor(Math.random()*RB_RETORTS.length)]);
  rbBtn.onclick=()=>{ ov.classList.remove('show'); flushAchToast(); finishRoundBreak(); };
  rbBtn.style.display='';
  ov.classList.add('show');
}
function finishRoundBreak(){
  S.bet=null; S._rbBetDetail=null; S.betRoundProposed=false; // 防御性清理：轮间结束后清空本回合加码并允许新轮再提
  S.betCooldownUntil=performance.now()+5000;                  // 换弹后 5s 内不立即提加码，避免刚装弹就弹窗
  if(RUN.endless) redealEndless();   // 无限模式：每轮(装弹)重新随机摆满道具
  // 困难 · 鼠窃夜行：子鼠每轮装弹后随机补 1 件道具（无尽模式桌面已重摆，跳过）
  if(RUN.hard && !RUN.endless && RUN.zodiac.id==='rat' && S.itemsDealer.length<5){
    const pool=poolFor(RUN.index); const id=pool[Math.floor(Math.random()*pool.length)];
    S.itemsDealer.push(id); log(tr('困难 · 鼠窃夜行：子鼠从暗处又摸出一件 {n}。', {n:`${PROPS[id].emoji}${PROPS[id].name}`}));
  }
  S.roundBreak=false;
  playLoad();   // 装弹动画（玩家要的“慢一点”，现在在弹窗关闭后才播放）
  if(S._shooter==='dealer') dealerSay(zpick('reload'),2200);
  // 装弹后先手：与回合内换手规则一致——只有上一轮最后一发是「打自己空包」才由开枪方继续，其余换手
  const cont = (S._lastTarget==='self' && !S._lastHit);
  S.turn = cont ? S._shooter : (S._shooter==='player' ? 'dealer' : 'player');
  dealerMood('idle'); // 新一局/新一轮开始时重置庄家表情，避免上一枪的 .shoot/.hit 位移盖住名字
  // 换弹后的先手规则藏在行为里，用 Toast 讲明白；玩家将被缚灵锁跳过时不弹（否则立刻被 ⛓ 提示覆盖，白闪一下）
  if(!(S.turn==='player' && S.cuffP>0)) shotToast(tr(S.turn==='player'?'toast_reload_p':'toast_reload_d'), S.turn, TOAST_RELOAD_DELAY);   // 装弹 Toast 延迟到遮罩走完(~3.3s)再飞，避免和装弹动画打架
  render();
  if(S.turn==='dealer') ActorFire(dealerTurn, curAI().thinkMs + DEALER_AFTER_RELOAD); else handToPlayer();   // 庄家回合延到装弹 Toast 飞完(~6.4s)再开始，避免加码弹窗抢在回合提示前弹出
}
// 把回合交还玩家前，先检查玩家是否被缚灵锁锁住；锁住则跳过玩家、直接回到庄家
/* ===== 加码系统（第三个庄家·申猴起；对局中事件触发；随庄家递进；“赢大输轻”原则） ===== */
const itemName=id=>`${PROPS[id].emoji}${PROPS[id].name}`;
function fillItems(n){
  const got=[];
  for(let i=0;i<n;i++){
    if(S.itemsPlayer.length>=5) break;                      // 上限 5 件（与无限模式摆满数一致）
    let id, guard=0;
    do { id=rndItem(); guard++; } while(RUN.endless && S.itemsPlayer.includes(id) && guard<30);  // 无限模式：补发不重复
    S.itemsPlayer.push(id); got.push(itemName(id));
  }
  return got.length?got.join('、'):null;
}
// 三类风格：
//  normal    —— 赢大奖、输轻惩（仅丢 1 道具 / -1 血且不送死）
//  even      —— 对等：赢家通吃。你赢→你得奖励；你输→庄家得奖励（你不受罚，但庄家变强）
//  incentive —— 激励：你怎么都不亏。你赢→大奖励；你输→小奖励（必接型，用来勾引参与）
/* ===== 简化版加码（v3，2026-07-27 重写）=====
   规则（与用户确认）：
   - 只有「庄家回合开始、出手前」才会提出加码（canProposeBet 门控）。
   - 庄家先声明「下一步动作」（有时诈唬），玩家仅能「接受 / 拒绝」二选一；弹窗冻结，选完才继续。
   - 赌约只赌庄家这回合的射击动作：打谁 / 实弹还是空包。
   - 赢 → 送道具 / 回血（封顶）；输 → 丢 1 道具或丢 1 偷看次数（绝不扣血、绝不致死）。
   - 庄家执行完这发后立刻结算（同一回合内，S.bet 为回合内临时变量，不跨轮）。
   - 结算为非阻塞 HUD 横幅（#betBanner）；若此发打空弹仓，同样写入轮间卡 #rbBet。
   - 死亡优先：若 php/dhp<=0，仍结算但让位给结果/胜利弹窗（横幅非阻塞，不冲突）。
*/
const BET_REWARD={
  item:{text:()=>tr('+1 道具'), apply:()=>{ const got=fillItems(1); return got?tr('获得 {n}',{n:got}):tr('道具已满'); }},
  heal:{text:()=>tr('+1 血'), apply:()=>{ const before=S.php; S.php=Math.min(S.phpMax,S.php+1); return tr('回 {n} 血',{n:S.php-before}); }}
};
// 各生肖提出加码的频率（仅在满足「第2次拿枪 + 普通模式申猴起」之后生效）
const BET_FREQ={'monkey':0.6,'horse':0.5,'rat':0.4,'snake':0.5,'rooster':0.45,'dog':0.4,'ox':0.4,'pig':0.5,'tiger':0.5,'goat':0.4,'dragon':0.6,'joker':0.7};
function zodiacBetFreq(z){ return BET_FREQ[z.name]!=null?BET_FREQ[z.name]:0.5; }
// 各生肖诈唬率（声明与实际相反的概率）
const BET_BLUFF={'monkey':0.45,'horse':0.35,'rat':0.4,'snake':0.5,'rooster':0.4,'dog':0.3,'ox':0.3,'pig':0.35,'tiger':0.4,'goat':0.4,'dragon':0.5,'joker':0.6};
function zodiacBluff(z){ return BET_BLUFF[z.name]!=null?BET_BLUFF[z.name]:0.4; }
function betModalOpen(){ return $('betModal').classList.contains('show'); }
function highModalOpen(){
  return $('awakenModal').classList.contains('show')||$('deathstarModal').classList.contains('show')||$('roundbreak').classList.contains('show')||$('result').classList.contains('show')||$('intro').classList.contains('show')||$('twist').classList.contains('show')||betModalOpen();
}
// 弹窗（含设置/帮助?及其所有子弹窗）打开时冻结庄家 ActorSet 调度器（含真正开枪扣血），避免弹窗期间庄家在背景攻击。
// 覆盖：觉醒 / 死兆星 / 轮间 / 结算 / 主菜单 / 假结局 / 加码 / 帮助? / 设置 / 偷看教学 / 开场说明 / 排行榜 / 统计 / 关于 / 常见问题 / 成就 / 绑定 / 取回 / 图鉴。
// 注意：这些弹窗都是「先关 settings/help 再开自己」的写法，若漏进名单，庄家会在切换瞬间解冻继续攻击。
function anyPauseModalOpen(){
  const open=id=>{ const el=$(id); return el && el.classList.contains('show'); };
  const compendiumOpen=()=>{ const el=$('compendium'); return el && el.style.display==='flex'; };
  return open('awakenModal')||open('deathstarModal')||open('roundbreak')||open('result')||open('intro')||open('twist')||open('betModal')||open('helpModal')||open('settings')||open('peekTutorModal')||open('howtoModal')||open('leaderboardModal')||open('statsModal')||open('aboutModal')||open('faqModal')||open('achModal')||open('bindModal')||open('recoverModal')||compendiumOpen();
}
function canProposeBet(){
  if(!S||S.over||S.peeking) return false;
  if(S.dealerTurns < 2) return false;                                  // 全局：第2次拿枪才提
  if(!RUN.endless && !RUN.hard && RUN.index < 2) return false;          // 普通模式需申猴(index>=2)起；无尽/地狱不限
  if(S.bet) return false;                                              // 本回合已有加码
  if(S.betRoundProposed) return false;                                 // 每轮最多一次加码
  if(S.roundBreak || S.chamberSpent || S.pos>=S.chamber.length) return false;
  if(highModalOpen()) return false;
  if(performance.now()<S.betCooldownUntil) return false;
  if(Math.random() > zodiacBetFreq(RUN.zodiac)) return false;
  return true;
}
// 提出加码：庄家声明下一步，玩家接受/拒绝。返回 true 表示已弹窗并冻结。
function proposeDealerBet(){
  const type = Math.random()<0.5 ? 'target' : 'shell';
  const z=RUN.zodiac;
  const next=S.chamber[S.pos];
  const AI=curAI();
  const realTarget = next===BLANK ? (Math.random()<AI.blankSelf?'self':'player') : (Math.random()<AI.livePlayer?'player':'self');
  const realShell = next===LIVE?'live':'blank';
  const bluff = Math.random() < zodiacBluff(z);
  let decl;
  if(type==='target'){ decl = bluff ? (realTarget==='player'?'self':'player') : realTarget; }
  else { decl = bluff ? (realShell==='live'?'blank':'live') : realShell; }
  const rewardType = type==='target' ? 'item' : 'heal';
  S.bet = { type, decl, realTarget, realShell, rewardType, accepted:false, qLabel: betQuestionLabel(type, decl), declText: betDeclText(type, decl) };
  S.betRoundProposed=true;                                             // 本轮已提过加码，防止连续出现
  STATS.betProposed=(STATS.betProposed||0)+1; saveStats();
  showBetModal();
  return true;
}
function betQuestionLabel(type, decl){
  if(type==='target') return tr('庄家下一枪会【{c}】', {c: betChoice(decl==='player'?'player':'self')});
  return tr('庄家下一发是【{c}】', {c: betChoice(decl)});
}
function betDeclText(type, decl){
  const c = decl==='player'?'player':(decl==='self'?'self':decl);
  return tr('庄家声明【{c}】', {c: betChoice(c)});
}
// 显示加码决策弹窗（仅 接受/拒绝），打开即冻结
function showBetModal(){
  const b=S.bet; if(!b) return;
  const z=RUN.zodiac;
  $('betAvatar').innerHTML=peekMaskImg(z);
  $('betDecl').textContent=b.declText;
  const rw=BET_REWARD[b.rewardType];
  $('betStakes').innerHTML =
    `<div class="win-stake">${tr('你赢：')}${rw.text()}</div>`+
    `<div class="lose-stake">${tr('你输：')}${tr('随机失去 1 个道具或 1 次偷看')}</div>`;
  $('betModal').classList.add('show'); sfxRaise();
  S.pausedForBet=true; render();
}
function acceptBet(){
  if(!S.bet) return;
  S.bet.accepted=true;
  STATS.betAccepted=(STATS.betAccepted||0)+1; saveStats();
  log(tr('你应下了 {n} 的加码 —— {l}。', {n: zDisp(RUN.zodiac), l: S.bet.qLabel}));
  $('betModal').classList.remove('show');
  S.pausedForBet=false;
  dealerAct();   // 庄家继续本回合
}
function declineBet(){
  if(!S.bet) return;
  STATS.betDeclined=(STATS.betDeclined||0)+1; saveStats();
  log(tr('你拒绝了 {n} 的加码。', {n: zDisp(RUN.zodiac)}));
  $('betModal').classList.remove('show');
  S.pausedForBet=false;
  S.betCooldownUntil=performance.now()+9000;
  S.bet=null;
  dealerAct();   // 庄家继续本回合（无赌约）
}
// 庄家执行完这发后结算（非阻塞）
function settleDealerBet(){
  const b=S.bet; if(!b) return;
  if(!b.accepted){ S.bet=null; return; }
  S.bet=null;
  let actual, win, q=b.qLabel;
  if(b.type==='target'){
    actual = betChoice(b.realTarget==='player'?'player':'self');
    win = (b.decl===b.realTarget);
  } else {
    actual = betChoice(b.realShell);
    win = (b.decl===b.realShell);
  }
  let effect='';
  if(win){
    effect = BET_REWARD[b.rewardType].apply();
    ACH.betWins=(ACH.betWins||0)+1; saveAch(); if(ACH.betWins>=5) unlock('bet_streak');
  } else {
    effect = loseBetPenalty();
  }
  if(RUN.endless && win){ RUN.score += Math.round(5*endlessMult()); endlessSaveBest(); updateEndlessBar(); }
  const outcomeText = win?tr('你 赢 了'):tr('你 赌 输 了');
  log(tr('<b>加码结果：{o}</b> —— {q}；实际为【{a}】。{e}', {o:outcomeText, q:q, a:actual, e:effect}));
  const detail={question:q, actual:actual, outcomeText, rows:[{label: win?tr('你获得'):'', val:effect, cls: win?'rg-win':'rg-lose'}]};
  showBetBanner(win, detail);
}
function loseBetPenalty(){
  if(S.itemsPlayer.length>0){
    const i=Math.floor(Math.random()*S.itemsPlayer.length);
    const lost=S.itemsPlayer.splice(i,1)[0];
    return tr('失去 {n}', {n: itemName(lost)});
  }
  if(S.peekMax>0){ S.peekMax=Math.max(0,S.peekMax-1); if(S.peekCount>S.peekMax) S.peekCount=S.peekMax; return tr('偷看次数 -1'); }
  return tr('身无长物，作罢');
}
// 非阻塞 HUD 横幅（开枪时即时显示，不再写入轮间总结）
function showBetBanner(win, detail){
  const banner=$('betBanner');
  if(banner){
    banner.textContent=(win?'🏆 ':'💥 ')+detail.outcomeText+' · '+detail.rows.map(r=>r.val).join(' ');
    banner.className='bet-banner show '+(win?'win':'lose');
    clearTimeout(banner._t);
    banner._t=setTimeout(()=>{ banner.classList.remove('show'); }, 2600);
  }
}
function rndItem(){ const p=poolFor(RUN.index); return p[Math.floor(Math.random()*p.length)]; }
const HINT_KEY='peek_hints_seen';
let _hintSeen=new Set(JSON.parse(localStorage.getItem(HINT_KEY)||'[]'));
let _hintTimer=null;
/* 轮回馈赠：跨轮回持久化去重（用户要求“只有一次”）；困难模式不发放 */
const GIFT_KEY='peek_gifts_seen';
let _giftsSeen=new Set(JSON.parse(localStorage.getItem(GIFT_KEY)||'[]'));
function markGiftSeen(idx){ try{ _giftsSeen.add(idx); localStorage.setItem(GIFT_KEY, JSON.stringify([..._giftsSeen])); }catch(e){} }
/* 轮回馈赠（里程碑）：跨轮回持久化去重，避免读档重打已见过的馈赠让玩家误会 */
const MS_KEY='peek_ms_seen';
let _milestonesSeen=new Set(JSON.parse(localStorage.getItem(MS_KEY)||'[]'));
function markMilestoneSeen(idx){ try{ _milestonesSeen.add(idx); localStorage.setItem(MS_KEY, JSON.stringify([..._milestonesSeen])); }catch(e){} }
function hintOnce(key,text){
  if(_hintSeen.has(key)) return;
  _hintSeen.add(key);
  try{ localStorage.setItem(HINT_KEY, JSON.stringify([..._hintSeen])); }catch(e){}
  showHint(text);
}
function showHint(text){
  const t=$('hintToast'); if(!t) return;
  t.textContent=text; t.classList.add('show');
  clearTimeout(_hintTimer);
  _hintTimer=setTimeout(()=>t.classList.remove('show'), 5200);
}
function deathRecapHTML(){
  const hits=S.pDealerLive, blanks=S.pDealerBlank;
  const got=S.dToPlayer, gotB=S.dToPlayerBlank;
  const sLive=S.pSelfLive, sBlank=S.pSelfBlank;
  const dLive=S.dSelfLive, dB=S.dSelfBlank;
  const rate=(hits+blanks)>0?Math.round(hits/(hits+blanks)*100):0;
  const zTitle=tr(RUN.zodiac.title);
  const firstLine = RUN.daily
    ? tr('今日挑战失败 —— 你还太弱，没有资格挑战今日守护的 {n}', {n: zTitle})
    : tr('死在第 {z} 位庄家 · {t}', {z: RUN.index+1, t: zTitle});
  const rows=[
    firstLine,
    tr('你打庄家：实弹 {h} / 空包 {b}（命中率 {r}%）', {h:hits, b:blanks, r:rate}),
    tr('庄家打你：实弹 {g} / 空包 {gb}', {g:got, gb:gotB}),
    tr('你自伤：实弹 {sl} / 空包 {sb}　庄家自伤：实弹 {dl} / 空包 {db}', {sl:sLive, sb:sBlank, dl:dLive, db:dB}),
    tr('使用道具 {n} 次 · 偷看 {a}/{b}', {n: S.itemUseCount||0, a: S.peekCount||0, b: S.peekMax||0})
  ];
  return `<div class="recap"><div class="recap-title">${tr('本局回顾')}</div>${rows.map(r=>`<div class="recap-row">${r}</div>`).join('')}</div>`;
}
function betToast(msg, win){
  const t=$('betToast'); if(!t)return;
  t.textContent=msg; t.className='bet-toast '+(win?'win':'lose'); t.style.display='';
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.style.display='none',300); }, 1900);
}
function handToPlayer(){
  if(betFlowPaused() || S.roundBreak) return;
  if(S.cuffP>0){ S.cuffP--; dealerMood('think'); shotToast(tr('toast_cuff_p'),'dealer'); log(tr('缚灵锁生效 —— 你被跳过。') + (S.cuffP>0?tr('（缚灵锁还剩 {n} 次）',{n:S.cuffP}):'')); ActorFire(dealerTurn,DEALER_AFTER_HANDOVER); return; }   // 延到「你被跳过」Toast 飞完再进庄家回合（避免加码弹窗盖住提示）
  if(S.itemLock){ S.itemLock=false; S.itemLockActive=true; log(tr('加码惩罚生效 —— 你本回合无法使用道具。')); }
  S.turn='player'; render(); log(tr('轮到你。')); scheduleIdleBanter();
}
function betFlowPaused(){ return !!(S && S.pausedForBet && betModalOpen()); }

/* ===== 开枪演出（第一人称枪升起 → 抖动/火光 → 伤害结算 → 落下）=====
 * 只做 4 套枪图（back/front × 举枪/火光）+ 1 张弹孔，按「受害者」归类复用，不按 6 套动作造资源：
 *   - 受害者=庄家（玩家朝庄家开枪）→ Revolver-back + 26vw
 *   - 受害者=玩家（玩家朝自己开枪 / 庄家朝玩家开枪）→ Revolver-front + 35vw
 * 整段走 ActorSet 可暂停调度器（ActorFire），后台 tab / 手机锁屏不卡。
 * 实弹：换火光图 + 抖动；空包：只抖动。打庄家实弹追加持久弹孔；空包打庄家面具小幅惊吓晃动。 */
const REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* 枪支演出参数：默认 dealer:50 / player:58 vh，可被 GM 面板实时覆盖（window.PEEK_DEBUG.gun），调好后把复制配置贴回 PEEK_DEBUG_DEFAULT.gun 烘焙 */
function gunParams(){
  const g=(window.PEEK_DEBUG&&window.PEEK_DEBUG.gun)||{};
  return {
    dealer:g.dealer==null?50:g.dealer,
    player:g.player==null?58:g.player,
    x:g.x==null?0:g.x,
    scale:g.scale==null?1.12:g.scale,
    y:g.y==null?20:g.y,
    rise:g.rise==null?RISE_MS:g.rise
  };
}
function gunH(dealer){ return dealer?gunParams().dealer:gunParams().player; }
const RISE_MS=800, SHAKE_MS=240, LIVE_HOLD_MS=200, BLANK_HOLD_MS=240, LOWER_MS=340;
const BULL={
  back:'assets/guns/Revolver-back.webp', front:'assets/guns/Revolver-front.webp',
  backFire:'assets/guns/bulletbackfire.webp', frontFire:'assets/guns/bulletfrontfire.webp',
  hole:'assets/guns/bullethole.webp'
};
// 预加载 + 预解码：保留引用防止被 GC 取消 fetch，并 decode() 把 bitmap 提前解好，
// 消除「首枪设 src 未解码→旧帧（front）闪现→枪口朝玩家」的竞态（v2.7.9 修）
const _gunPre=[];
try{
  ['back','front','backFire','frontFire','hole'].forEach(k=>{
    const im=new Image(); im.decoding='async'; im.src=BULL[k];
    _gunPre.push(im);                                  // 保留引用，避免 fetch 被回收
    if(im.decode){ try{ im.decode().catch(()=>{}); }catch(e){} }   // 预热 bitmap 解码缓存
  });
}catch(e){}
// 弹孔固定散布点（面具内百分比坐标，避开极边）；按中弹顺序取点，循环复用
const HOLE_SPOTS=[
  {x:50,y:28},{x:37,y:50},{x:63,y:46},{x:46,y:66},{x:58,y:30},
  {x:33,y:36},{x:67,y:62},{x:50,y:50},{x:42,y:72},{x:60,y:70},
  {x:29,y:58},{x:71,y:40}
];
// 高面具（长耳/高冠把脸压到容器下半部）弹孔 y 统一下移（%），缺省 0。
// 调参工具：prototypes/hole-spots-demo.html（13 面具 × 6 弹孔可视化，导出即此表格式）
const HOLE_Y_OFFSET={rabbit:18};  // 卯兔：长耳拉高导致脸偏下，弹孔整体下移对齐眼眶/鼻嘴区
// 每个庄家随机洗牌 12 个散布点索引，避免重复对战同一庄家时弹孔位置固定、且同局内不重叠。
function shuffledHoleOrder(){
  const n=HOLE_SPOTS.length, a=[...Array(n).keys()];
  for(let i=n-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; }
  return a;
}
let _shotBusy=false;   // 防「升起过程中重复点击」导致的双重开枪
function addBulletHole(){
  if(!S) return;
  S.dealerHoles=(S.dealerHoles||0)+1;
  // 挂到真正的面具图片容器 .zmask-wrap（跟随 .mask 呼吸缩放 + .zface 伪3D 转头一起动）；
  // dealerMood 已保证同一庄家不重建 zface（L798 守卫），弹孔可跨情绪/跨轮存活
  const w=$('zface') && $('zface').querySelector('.zmask-wrap'); if(!w) return;
  const order=(S.holeOrder&&S.holeOrder.length)?S.holeOrder:null;
  const idx=(S.dealerHoles-1)%((order||HOLE_SPOTS).length);
  const spot=HOLE_SPOTS[order?order[idx]:idx];
  const oy=(typeof RUN!=='undefined'&&RUN.zodiac&&HOLE_Y_OFFSET[RUN.zodiac.id])||0;  // 方案A：按生肖查表下移
  const img=document.createElement('img');
  img.className='bullet-hole';
  img.src=BULL.hole; img.alt=''; img.setAttribute('decoding','async');
  img.style.left=spot.x+'%'; img.style.top=Math.min(spot.y+oy,90)+'%';
  w.appendChild(img);
}
function flinchDealer(){
  const w=$('maskWrap'); if(!w) return;
  w.classList.remove('flinch'); void w.offsetWidth; w.classList.add('flinch');
  ActorFire(()=>{ if(w) w.classList.remove('flinch'); }, 240);
}
function playShot(target, live, atFire, doneFn){
  const gl=$('gunLayer'), gi=$('gunImg');
  // 兜底：若缺演出层，直接结算，避免卡死
  if(!gl||!gi){ const a=atFire?atFire():undefined; flushAwaken(); if(doneFn) doneFn(a); return; }
  const dealer=(target==='dealer');
  const gp=gunParams();
  const rise=REDUCE?120:gp.rise, shake=REDUCE?120:SHAKE_MS;
  const hold=REDUCE?0:(live?LIVE_HOLD_MS:BLANK_HOLD_MS), lower=REDUCE?120:LOWER_MS;
  gl.style.setProperty('--rise', rise+'ms');
  gl.style.setProperty('--shake', shake+'ms');
  gl.style.setProperty('--gun-h', (dealer?gp.dealer:gp.player)+'vh');   // 高度约束，宽度按图片比例自适应
  gl.style.setProperty('--gun-x', gp.x+'px');
  gl.style.setProperty('--gun-scale', gp.scale);
  gl.style.setProperty('--gun-y', gp.y+'%');
  gi.src = dealer? BULL.back : BULL.front;
  // 等新图解码完成再举枪，避免解码完成前浏览器继续绘制上一帧旧图（首枪 stale-frame 闪现朝玩家的 front）
  const _reveal=()=>{ if(S&&S.over) return; gl.classList.add('show'); };
  if(gi.decode){ try{ gi.decode().then(_reveal).catch(_reveal); }catch(e){ _reveal(); } }
  else _reveal();
  // 注意：_shotBusy 只在玩家入口 playerFire 里管理（庄家回合玩家本就点不了），
  // 此处不再置位——否则庄家开枪后无人复位，玩家回合按钮会被永久锁死
  ActorFire(()=>{
    if(live) gi.src = dealer? BULL.backFire : BULL.frontFire;   // 实弹换火光图
    gl.classList.add('shake');                                  // 空包/实弹都抖一下
    const a = atFire ? atFire() : undefined;
    ActorFire(()=>{ gl.classList.remove('shake'); }, shake);
    ActorFire(()=>{
      gl.classList.remove('show');
      ActorFire(()=>{ gi.src = dealer? BULL.back : BULL.front; gl.classList.remove('shake'); flushAwaken(); }, lower);   // 枪完全降到底、图层收起后，再弹觉醒视窗
    }, hold);
    if(doneFn) doneFn(a);
  }, rise);
}
/* ===== 玩家开枪 ===== */
function playerFire(target){
  if(_shotBusy) return;   // 升起过程中禁止重复点击，避免双重开枪
  if(!S||S.turn!=='player'||S.over||S.peeking||betFlowPaused())return;
  if(S.itemLockActive) S.itemLockActive=false;
  // 教学局保护：必须先于「读取动画 live」改写弹仓，否则第一发打自己播实弹动画、结算却为空包（旧时序 bug）
  if(target==='self' && S.firstSelfBlank){
    S.firstSelfBlank=false;
    if(S.chamber[S.pos]!==BLANK){
      const k=S.chamber.indexOf(BLANK, S.pos+1);
      if(k!==-1){ S.chamber[k]=S.chamber[S.pos]; S.chamber[S.pos]=BLANK; }
      else S.chamber[S.pos]=BLANK;
    }
  }
  if(target==='dealer' && S.firstDealerLive){
    S.firstDealerLive=false;
    if(S.chamber[S.pos]!==LIVE){
      const k=S.chamber.indexOf(LIVE, S.pos+1);
      if(k!==-1){ S.chamber[k]=S.chamber[S.pos]; S.chamber[S.pos]=LIVE; }
      else S.chamber[S.pos]=LIVE;
    }
  }
  const live = S.chamber[S.pos]===LIVE;
  let r=null, awoke=false;
  // 收尾函数：统一处理「换手 / 轮间过场 / 对自己空包白嫖 / 缚灵锁」；tail 内复位 _shotBusy
  const tail=()=>{
    _shotBusy=false;
    // 打空弹仓：不弹 Toast，直接进轮间卡（弹了也会被全屏弹窗盖住，且轮间卡本身就是总结）
    if(S.roundBreak){ dealerMood('idle'); ActorFire(showRoundBreak, 1200); return; }
    if(target==='self' && !r.hit){ shotToast(tr('toast_blank_keep_p'),'player'); log(tr('轮到你（额外回合）。')); render(); scheduleIdleBanter(); return; }
    if(S.cuffD>0){ S.cuffD--; shotToast(tr('toast_cuff_d'),'player'); log(tr('缚灵锁生效 —— 庄家被跳过。') + (S.cuffD>0?tr('（缚灵锁还剩 {n} 次）',{n:S.cuffD}):'')); render(); scheduleIdleBanter(); return; }
    shotToast(tr(r.hit?'toast_live_to_d':'toast_blank_to_d'),'dealer');
    S.turn='dealer'; ActorFire(dealerTurn, curAI().thinkMs + DEALER_AFTER_HANDOVER);   // 延到「换庄家出手」Toast 飞完(~4.05s)再进庄家回合，避免加码弹窗抢在回合提示前弹出（v2.6.70 只修了装弹路径，这条正常换手路径漏了）
  };
  // 开枪瞬间结算：枪口闪/火花/弹壳 + 实际伤害 + 命中弹孔/惊吓演出
  const atFire=()=>{
    sfxShot();
    const sc0=$('scene').getBoundingClientRect();
    muzzleAt(sc0.left+sc0.width/2, sc0.top+sc0.height*0.9);
    shellAt(sc0.left+sc0.width/2, sc0.top+sc0.height*0.9);
    r=fire(target);
    if(target==='dealer'){
      log(tr('你朝庄家开枪：') + '<b>' + (r.hit ? tr('实弹！庄家 -') + r.dmg + (r.dmg===2?tr('（翻倍）'):'') : tr('空包')) + '</b>');
      if(r.hit){ S.pDealerLive++; dealerHit(r.dmg); addBulletHole(); dealerSay(zpick('dealer_live'),2600); }
      else { S.pDealerBlank++; flinchDealer(); }
    } else if(r.hit){
      log(tr('你朝自己开枪：') + '<b>' + (tr('实弹！你 -') + r.dmg + (r.dmg===2?tr('（翻倍）'):'')) + '</b>');
      S.pSelfLive++; awoke=playerHit(r.dmg, tail); dealerMood('win');
      const b=$('bubble'); if(b) b.classList.add('mock'); dealerSay(zpick('self_live'),3600);
      setTimeout(()=>{ if(b) b.classList.remove('mock'); },3600); setTimeout(sfxDealerLaugh,380);
    } else {
      S.pSelfBlank++;
      log(tr('你朝自己开枪：') + '<b>' + tr('空包，安全 —— 白嫖一回合！') + '</b>');
      dealerMood('sweat');
      const m=$('mask'); m.classList.add('pulse'); setTimeout(()=>m.classList.remove('pulse'),640);
      dealerSay(zpick('self_blank'),2600);
    }
    return awoke;
  };
  const done=(a)=>{
    render();
    if(checkOver()){ _shotBusy=false; return; }
    if(a || deathStarPending){ pendingResume=tail; return; } // 觉醒/死兆星弹窗：玩家点「继续」后由 tail 恢复（tail 内复位 _shotBusy）
    tail();
  };
  _shotBusy=true;   // 演出期间锁玩家点击；tail / checkOver 分支复位
  playShot(target, live, atFire, done);
}
$('bDealer').onclick=()=>playerFire('dealer');
$('bSelf').onclick=()=>playerFire('self');
$('betAccept').onclick=acceptBet;
$('betDecline').onclick=declineBet;

function scheduleIdleBanter(){
  clearTimeout(idleTimer);
  if(!S||S.over||S.turn!=='player'||S.peeking||betFlowPaused())return;
  idleTimer=setTimeout(()=>{
    if(!S||S.over||S.turn!=='player'||S.peeking||betFlowPaused())return;
    if(Math.random()<0.38){ surveillancePulse(); }
    else { const L=zlines(); const pool=[].concat(L.idle||IDLE_LINES, L.psych||[], L.gameplay||[]); dealerSay(pool[Math.floor(Math.random()*pool.length)], 2800); }
    scheduleIdleBanter();
  }, 5000+Math.random()*5000);
}
/* ===== 庄家回合(知道枪序, 用概率化策略) ===== */
function dealerTurn(){
  S.dealerTurns=(S.dealerTurns||0)+1;   // 庄家每次「拿到枪」记一次（含空包续打/重新装弹后的再次拿枪）
  if(S.over || S.roundBreak) return;
  clearTimeout(idleTimer);
  dealerMood('think');
  // 庄家被缚灵锁锁住：直接跳过其回合，交还玩家
  if(S.cuffD>0){ S.cuffD--; log(tr('缚灵锁生效 —— 庄家被跳过。') + (S.cuffD>0?tr('（缚灵锁还剩 {n} 次）',{n:S.cuffD}):'')); render(); scheduleIdleBanter(); return; }
  // 无尽模式：每轮都换 5 个新道具，庄家必须尽量消耗手上道具
  maybeDealerItem();
  if(S.over) return; // 道具反噬致死等极端情况
  // 简化加码：仅庄家回合开始、出手前提一次；玩家接受/拒绝后由 dealerAct 续走本回合（接受则庄家照声明执行并结算）
  if(canProposeBet() && proposeDealerBet()) return;
  dealerAct();
}
function dealerAct(){
  if(S.over)return;
  // 说 2~4 句话再开枪
  const lines=[dealerLine()];
  if([3,5,7].includes(S.shots||0)) lines.push(zpick('exchange'));
  const extra=2+Math.floor(Math.random()*2);
  const pool=ztaunt();
  for(let i=0;i<extra;i++) lines.push(pool[Math.floor(Math.random()*pool.length)]);
  let idx=0;
  function sayNext(){
    if(S.over)return;
    dealerSay(lines[idx], 2600); idx++;
    if(idx<lines.length) ActorFire(sayNext, 1000+Math.random()*600);
    else ActorFire(shoot, 800);
  }
  function shoot(){
    if(S.over)return;
    // 假动作: 约 1/3 概率举枪恐吓 + 低语后放下, 制造表演性误导
    if(Math.random()<0.32){
      const mk=$('mask'); mk.className='mask no-avatar-frame shoot lunge'; sfxClick();
      dealerAction('庄家举枪，却迟迟不开 —— 他在骗你的眼神。', 950);
      ActorFire(()=>{
        if(S.over)return;
        dealerMood('think'); dealerSay('',0);
        ActorFire(doFire, 620);
      }, 980);
      return;
    }
    doFire();
      function doFire(){
        if(S.over)return;
        dealerMood('shoot');
        const next=S.chamber[S.pos];
        const AI=curAI();
        // 若玩家接受了「打谁」加码，庄家照声明（已提交）的真实目标执行；否则按 AI 概率
        let target;
        if(S.bet && S.bet.accepted && S.bet.type==='target'){ target=S.bet.realTarget; }
        else { target = next===BLANK ? (Math.random()<AI.blankSelf?'self':'player') : (Math.random()<AI.livePlayer?'player':'self'); }
        if(S.bet && S.bet.accepted){ S.bet.realShell = (next===LIVE?'live':'blank'); }  // 记录实际弹种用于结算
        const live = next===LIVE;
        let r=null, awoke=false;
        // 开枪瞬间结算：原 lunge/火光/弹壳/震屏 + 实际伤害 + 命中弹孔/惊吓演出
        const atFire=()=>{
          sfxShot(); shakeScreen(4,200);
          const mr=$('mask').getBoundingClientRect(), zone=$('dealerZone');
          muzzleAt(mr.left+mr.width/2, mr.top+mr.height/2, zone);
          shellAt(mr.left+mr.width/2, mr.top+mr.height/2, zone);
          dealerSay('',0);
          r=fire(target);
          if(target==='player'){
            log(tr('庄家朝你开枪：') + '<b>' + (r.hit ? tr('实弹！你 -') + r.dmg + (r.dmg===2?tr('（翻倍）'):'') : tr('空包')) + '</b>');
            if(r.hit){ S.dToPlayer++; awoke=playerHit(r.dmg, tail); if(!awoke) dealerSay(zpick('player_live'),2600); }
            else { S.dToPlayerBlank++; dealerSay(zpick('player_blank'),2600); }
          } else {
            log(tr('庄家朝自己开枪：') + '<b>' + (r.hit ? tr('实弹！庄家 -') + r.dmg + (r.dmg===2?tr('（翻倍）'):'') : tr('空包')) + '</b>');
            if(r.hit){ S.dSelfLive++; dealerHit(r.dmg); addBulletHole(); dealerSay(zpick('dealer_live'),2600); }
            else { S.dSelfBlank++; flinchDealer(); dealerSay(zpick('self_blank'),2600); }
          }
          return awoke;
        };
        // 收尾函数（简化：加码结算为非阻塞横幅，不再挂起 pendingResume，从根上消除卡死）
        const tail=()=>{
          // 打空弹仓：不弹 Toast，直接进轮间卡
          if(S.roundBreak){ dealerMood('idle'); ActorFire(showRoundBreak, 1400); return; }
          if(target==='self' && !r.hit){
            // 新手最大困惑点：庄家自打空包 = 枪不换手，可以继续开枪。Toast + 面具放大 + 气泡说明行三重解释
            shotToast(tr('toast_blank_keep_d'),'dealer');
            dealerHintBig();
            log(tr('庄家空包，得意地继续开枪。'));
            dealerMood('think');
            dealerSayHint('hint_dealer_keep', zpick('self_blank'), 2600);
            ActorFire(dealerTurn,900);
            return;
          }
          // 玩家被缚灵锁跳过时不在此弹，交由 handToPlayer 弹专属的 ⛓ 提示，避免两条叠着覆盖
          if(!(S.cuffP>0)) shotToast(tr(r.hit?'toast_live_to_p':'toast_blank_to_p'),'player');
          dealerMood('idle'); handToPlayer();
        };
        const done=(a)=>{
          render();
          if(S.over) return;
          settleDealerBet();          // 非阻塞结算（HUD 横幅）；若打空弹仓，内容并入轮间卡
          if(checkOver()) return;
          if(a || deathStarPending){ pendingResume=tail; return; } // 觉醒/死兆星弹窗：玩家点「继续」后由 tail 恢复
          tail();
        };
        // playShot 按「受害者」选枪图：庄家自爆受害者是庄家 → 'dealer'(back 枪)；打玩家 → 'player'(front 枪)
        playShot(target==='self'?'dealer':'player', live, atFire, done);
      }
  }
  sayNext();
}

/* ===== peek 机制 v3.5 (弹巢展开特写 + 警觉槽 + 画面抖动) ===== */
function stopShake(){ $('scene').style.transform=''; }
let peekRevealRAF=0;
function buildPeekCyl(){
  const canvas=$('peekCyl'); if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const total=S.chamber.length, cur=S.pos, curType=S.chamber[cur];
  const start=performance.now();
  if(peekRevealRAF) cancelAnimationFrame(peekRevealRAF);
  function frame(now){
    if(!$('peekCyl')) return;
    const reveal=Math.min(1,(now-start)/750);   // 放慢扫描：约 750ms 扫到中线
    drawPeekCyl(ctx,total,cur,curType,reveal,now);
    if(reveal<1) peekRevealRAF=requestAnimationFrame(frame);
  }
  peekRevealRAF=requestAnimationFrame(frame);
}
function drawPeekCyl(ctx,total,cur,curType,reveal,now){
  ctx.clearRect(0,0,CYL_W,CYL_H);
  ctx.save();
  cylDrawBody(ctx);
  for(let i=0;i<total;i++){
    const pos=(i-cur+CYL_N)%CYL_N;       // 当前待发膛恒在 12 点钟
    const p=cylChamberPos(pos,0);
    cylDrawEmptyChamber(ctx,p);
    cylDrawNeutralShell(ctx,p,1);          // 隐藏排序：其余膛室只显中性弹壳
  }
  ctx.restore();
  // 当前待发膛金环（世界坐标，不受旋转影响）
  const cp=cylChamberPos(0,0);
  ctx.beginPath(); ctx.arc(cp.x,cp.y,CYL_CHAM+10,0,Math.PI*2); ctx.lineWidth=2; ctx.strokeStyle='rgba(232,195,119,.65)'; ctx.stroke();
  // 扫描揭盖：右→左扫描，但只扫到画面中线（scanX=CYL_CX）就停住 —— 最多只露弹点右半，不看全
  // reveal∈[0,1] 映射 scanX 从右侧远点平滑移到中线；clip 取扫描线右侧，故中心弹点只露右半
  const scanX=CYL_CX + (CYL_RING+CYL_CHAM+18) - reveal*(CYL_RING+CYL_CHAM+18);
  ctx.save(); ctx.beginPath(); ctx.rect(scanX,0,CYL_W-scanX,CYL_H); ctx.clip();
  cylDrawColoredDot(ctx,cp,curType,now,1);
  ctx.restore();
  if(reveal<1){
    const b=0.35+0.4*Math.sin(now/120);
    ctx.save(); ctx.beginPath(); ctx.moveTo(scanX,0); ctx.lineTo(scanX,CYL_H);
    ctx.lineWidth=2; ctx.strokeStyle=`rgba(255,230,170,${b})`; ctx.stroke();
    ctx.lineWidth=8; ctx.strokeStyle=`rgba(255,230,170,${b*0.15})`; ctx.stroke(); ctx.restore();
  }
}
function startPeek(){
  if(!S||S.turn!=='player'||S.over||S.peeking||S.peekCount>=(S.peekMax||1)||!S.peekUnlocked)return;
  if(betFlowPaused() || S.roundBreak){ log(tr('加码 / 轮间过场中，无法偷看。')); return; }  S.peeking=true; $('bPeek').classList.add('pressing');
  const g=$('game'); if(g) g.classList.add('peek-active');
  const m0=$('mask'); if(m0) m0.classList.add('watching');
  STATS.peekTotal++; saveStats();   // P2 埋点：偷看使用计数
  stopHeart();
  S.revealed=S.chamber[S.pos];
  curWin=PEEK_WINDOWS[S.peekCount];
  if(RUN.hard && RUN.zodiac.id==='rooster') curWin=Math.round(curWin/2);   // 困难 · 司晨警觉：警觉槽涨满速度翻倍
  buildPeekCyl();
  $('peek').classList.add('show');
  $('vignette').style.opacity='1'; lastBeat=0; beatPulse=0;
  peekStart=performance.now();
  const loop=t=>{
    if(!S.peeking)return;
    const p=Math.min(1,(t-peekStart)/curWin);
    const eased=Math.pow(p,1.5);
    $('mon').style.width=(eased*100)+'%';
    const pf=$('peekFill'); if(pf) pf.style.width=(eased*100)+'%';
    const interval=720-eased*470;
    if(t-lastBeat>interval){ lastBeat=t; sfxHeart(); beatPulse=1; }
    beatPulse*=0.86;
    const amp=eased*8;
    const dx=(Math.random()*2-1)*amp, dy=(Math.random()*2-1)*amp;
    $('scene').style.transform=`translate(${dx}px,${dy}px) scale(${1+beatPulse*0.03})`;
    $('vignette').style.boxShadow=`inset 0 0 ${40+eased*70}px ${10+eased*50}px rgba(255,0,40,${0.15+eased*0.45})`;
    if(eased>0.72 && navigator.vibrate) navigator.vibrate(8);
    if(p>=1){ timeoutPeek(); return; }
    raf=requestAnimationFrame(loop);
  };
  raf=requestAnimationFrame(loop);
}
function endPeek(){
  if(!S.peeking)return;
  const g=$('game'); if(g) g.classList.remove('peek-active');
  $('mask').classList.remove('watching');
  $('bPeek').classList.remove('awakened');
  $('bPeek').classList.remove('pressing'); const pf=$('peekFill'); if(pf) pf.style.width='0%';
  S.peeking=false; cancelAnimationFrame(raf);
  $('peek').classList.remove('show'); $('mon').style.width='0'; stopShake();
  $('vignette').style.opacity='0'; $('vignette').style.boxShadow='inset 0 0 50px 20px rgba(255,0,40,0)'; beatPulse=0;
  S.peekCount++;
  { const _d=Math.round(performance.now()-peekStart); trackEvent('peek_use',{zodiac_idx:(RUN?RUN.index:0),dwell_ms:_d,saw:_d>=750}); }
  log(tr('你偷看到一发。警觉槽未满，安全松手。'));
  render(); if(!S.over)startHeart(); scheduleIdleBanter();
}
function timeoutPeek(){
  S.peeking=false; cancelAnimationFrame(raf);
  const g=$('game'); if(g) g.classList.remove('peek-active');
  $('bPeek').classList.remove('awakened');
  $('bPeek').classList.remove('pressing'); const pf=$('peekFill'); if(pf) pf.style.width='0%';
  $('peek').classList.remove('show'); $('mon').style.width='0'; stopShake();
  $('vignette').style.opacity='0'; $('vignette').style.boxShadow='inset 0 0 50px 20px rgba(255,0,40,0)'; beatPulse=0;
  $('flash').classList.add('on'); setTimeout(()=>$('flash').classList.remove('on'),400);
  S.php--; S.peekCount++;
  { const _d=Math.round(performance.now()-peekStart); trackEvent('peek_use',{zodiac_idx:(RUN?RUN.index:0),dwell_ms:_d,saw:_d>=750}); }
  markLostHeart('php', S.php);
  const unlocked=ensurePeekUnlocked();
  if(unlocked){
    // 被庄家察觉：先放一发枪响（庄家抓现行），枪响过后再弹觉醒视窗，避免弹窗先于枪出现
    sfxShot(); shakeScreen(4,200);
    const mr=$('mask').getBoundingClientRect(), zone=$('dealerZone');
    muzzleAt(mr.left+mr.width/2, mr.top+mr.height*0.5, zone);
    shellAt(mr.left+mr.width/2, mr.top+mr.height*0.5, zone);
    setTimeout(()=>flushAwaken(), 380);   // 枪响略停再弹窗
  } else {
    checkDeathStar();
  }
  pendingBluffBoost=true; // 记忆性惩罚: 下一局庄家 bluff 概率翻倍
  log(tr('<b>⚠ 警觉槽拉满，被庄家察觉！（>{s}秒）你 -1。</b> 庄家已记下你的贪婪 —— 下一局他会更多骗你。', {s: (curWin/1000)}));
  render();
  if(checkOver())return;
  log(tr('轮到你。')); render(); if(!S.over)startHeart(); scheduleIdleBanter();
}

/* 交互: 仅「偷看」按钮可触发窥视，避免点击庄家/画面误触 */
const pb=$('bPeek');
let peekTouchId=null;
function onPeekStart(e){ if(e && e.cancelable) e.preventDefault(); if(e && e.pointerId!=null && e.target && e.target.setPointerCapture){ try{ e.target.setPointerCapture(e.pointerId); }catch(_){} } startPeek(); }
function onPeekEnd(e){ if(e && e.cancelable) e.preventDefault(); endPeek(); }
pb.addEventListener('pointerdown',onPeekStart);
pb.addEventListener('pointerup',onPeekEnd);
pb.addEventListener('pointerleave',onPeekEnd);
pb.addEventListener('pointercancel',onPeekEnd);
pb.addEventListener('touchstart',e=>{ peekTouchId=e.changedTouches[0].identifier; onPeekStart(e); },{passive:false});
pb.addEventListener('touchend',e=>{ if(peekTouchId===e.changedTouches[0].identifier){ peekTouchId=null; onPeekEnd(e); } },{passive:false});
pb.addEventListener('touchcancel',e=>{ if(peekTouchId===e.changedTouches[0].identifier){ peekTouchId=null; onPeekEnd(e); } },{passive:false});
function updatePeekHint(){
  const rem=Math.max(0, (S?S.peekMax||1:1) - (S?S.peekCount:0));
  const cnt=$('peekCnt'); if(cnt) cnt.textContent = rem>0 ? '×'+rem : '';
  const hint=$('peekHintRow'); if(!hint) return;
  if(S && !S.peekUnlocked){ hint.textContent = ''; return; }
  hint.textContent = tr('按住「偷看」键 · 红条涨满前松手');
}
$('bGear').onclick=()=>{ $('settings').classList.add('show'); };
$('setClose').onclick=()=>{ $('settings').classList.remove('show'); };
$('settingsBackdrop').onclick=()=>{ $('settings').classList.remove('show'); };
$('setMenu').onclick=()=>{
  $('settings').classList.remove('show');
  // 干净退出当前局：先终止回合逻辑、收起枪支、清掉残留计时器与提示，
  // 避免回主菜单后枪还升起 / 局未真正结束（Bug: 设置内回主菜单时枪图层漏收）
  if(S) S.over=true;
  const gl=$('gunLayer'); if(gl) gl.classList.remove('show','shake');
  try{ clearTimeout(idleTimer); clearTimeout(ambiTimer); clearHintBig(); clearShotToast(); stopHeart(); }catch(e){}
  endAnalyticsSession('quit');
  hideResult();
  resetRun();
  showIntro();
};
$('setBgm').onclick=()=>{ setBgmMute(!bgmMuted); };
$('setSfx').onclick=()=>{ setSfxMute(!sfxMuted); };
$('setStats').onclick=()=>{ $('settings').classList.remove('show'); showStats(); };
$('setCompendium').onclick=()=>{ $('settings').classList.remove('show'); showCompendium(); };
$('bCompendium').onclick=()=>showCompendium();
const _setAuto=$('setAuto'); if(_setAuto)_setAuto.onclick=()=>{ setLang('auto'); location.reload(); };
$('setZh').onclick=()=>{ setLang('zh'); location.reload(); };
$('setTw').onclick=()=>{ setLang('zh-TW'); location.reload(); };
$('setEn').onclick=()=>{ setLang('en'); location.reload(); };
$('setJa').onclick=()=>{ setLang('ja'); location.reload(); };
$('setKo').onclick=()=>{ setLang('ko'); location.reload(); };
$('setRu').onclick=()=>{ setLang('ru'); location.reload(); };
$('setEs').onclick=()=>{ setLang('es'); location.reload(); };
$('setFr').onclick=()=>{ setLang('fr'); location.reload(); };
$('setDe').onclick=()=>{ setLang('de'); location.reload(); };
$('statsBackdrop').onclick=()=>{ $('statsModal').classList.remove('show'); };
$('statsClose').onclick=()=>{ $('statsModal').classList.remove('show'); };
$('statsReset').onclick=()=>{ if(confirm('清空本机所有战绩统计？此操作不可撤销。')){ STATS={plays:0,wins:0,losses:0,perIndex:{},betProposed:0,betAccepted:0,betDeclined:0,peekTotal:0,itemTotal:0,roundTotal:0,zodiacDeaths:{}}; saveStats(); showStats(); } };

// ===== 关于 / 常见问题（SEO / AEO 双语资料，文案外置 locales json）=====
const ABOUT = _loadObj('about');
const FAQ = _loadArr('faq');
function showAbout(){
  let h = `<div class="about-hero"><h3>${ABOUT.heroTitle}</h3><div class="about-tag">${ABOUT.tagline}</div></div>`;
  h += ABOUT.sections.map(s=>`<div class="about-sec"><h4>${s.h}</h4><p>${s.p}</p></div>`).join('');
  h += `<div class="about-sec"><h4>${ABOUT.featureTitle}</h4><div class="about-feats">${ABOUT.features.map(f=>`<span>${f}</span>`).join('')}</div></div>`;
  $('aboutBody').innerHTML = h;
  $('aboutModal').classList.add('show');
}
function showFAQ(){
  $('faqBody').innerHTML = FAQ.map((it,i)=>`<div class="faq-item"><div class="faq-q"><span class="qm">Q${i+1}</span><span>${tr(it.q)}</span></div><div class="faq-a">${tr(it.a)}</div></div>`).join('');
  $('faqModal').classList.add('show');
}
function openFeedback(){
  const ver = window.PEEK_APP_VERSION || 'unknown';
  const base = (location.href || '').split('#')[0];
  const ua = navigator.userAgent || '';
  const email = 'zodiacspeek@marconest.cc';
  const subject = tr('[Bug反馈] Peek') + ' ' + ver;
  const body = tr('请描述你遇到的问题：') + '\n\n' + tr('（以下信息自动附带，无需修改）') + '\n' + tr('版本：') + ver + '\n' + tr('页面：') + base + '\n' + tr('UA：') + ua;
  const mail = 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  // 优先唤起邮件客户端
  let left = false;
  const onHide = ()=>{ left = true; };
  document.addEventListener('visibilitychange', onHide, { once:true });
  window.location.href = mail;
  // 兜底：1.2s 内页面未隐藏（邮件客户端未接管，常见于 iOS/微信内置浏览器）→ 复制内容到剪贴板
  setTimeout(()=>{
    document.removeEventListener('visibilitychange', onHide);
    if(left) return;
    const full = tr('收件人：') + email + '\n' + tr('主题：') + subject + '\n\n' + body;
    try { navigator.clipboard.writeText(full); } catch(e) {}
    miniToast(tr('反馈复制提示'));
  }, 1200);
}
$('setAbout').onclick=()=>{ $('settings').classList.remove('show'); showAbout(); };
$('setFaq').onclick=()=>{ $('settings').classList.remove('show'); showFAQ(); };
$('setFeedback').onclick=()=>{ if(!window.PEEK_FEATURES.feedback) return; $('settings').classList.remove('show'); openFeedback(); };
$('aboutClose').onclick=()=>{ $('aboutModal').classList.remove('show'); };
$('aboutBackdrop').onclick=()=>{ $('aboutModal').classList.remove('show'); };
$('faqClose').onclick=()=>{ $('faqModal').classList.remove('show'); };
$('faqBackdrop').onclick=()=>{ $('faqModal').classList.remove('show'); };
$('setAch').onclick=()=>{ $('settings').classList.remove('show'); showAch(); };
$('achClose').onclick=()=>{ $('achModal').classList.remove('show'); };
$('achX').onclick=()=>{ $('achModal').classList.remove('show'); };
$('achBackdrop').onclick=()=>{ $('achModal').classList.remove('show'); };
refreshAchBadge();

/* 庄家道具长按提示 */
let ditemTipTimer=null, ditemTipEl=null;
function attachDitemTip(el,id){
  const show=(e)=>{
    if(ditemTipEl) ditemTipEl.remove();
    const zone=$('dealerZone'); if(!zone) return;
    const r=el.getBoundingClientRect(), zr=zone.getBoundingClientRect();
    const tip=document.createElement('div'); tip.className='ditem-tip';
    tip.innerHTML=`<div class="tip-row"><span class="tip-ie">${PROPS[id].emoji}</span><span class="tip-nm">${PROPS[id].name}</span></div><div class="tip-desc">${tr('长按或点击道具栏右侧 ❓ 查看完整说明')}</div>`;
    tip.style.left=(r.left - zr.left + r.width/2)+'px';
    tip.style.top=(r.top - zr.top - 6)+'px';
    zone.appendChild(tip); ditemTipEl=tip;
  };
  const clear=()=>{ clearTimeout(ditemTipTimer); };
  const remove=()=>{ if(ditemTipEl){ ditemTipEl.remove(); ditemTipEl=null; } };
  el.addEventListener('pointerdown',(e)=>{
    e.preventDefault(); remove(); ditemTipTimer=setTimeout(()=>show(e), 450);
  });
  el.addEventListener('pointerup',()=>{ clear(); setTimeout(remove, 1200); });
  el.addEventListener('pointerleave',()=>{ clear(); remove(); });
  el.addEventListener('pointercancel',()=>{ clear(); remove(); });
}
/* 统一暗色帮助弹窗（规则 / 道具 Tab） */
function renderHelpBody(tab){
  const body=$('helpBody'); if(!body) return;
  if(tab==='peek'){
    body.innerHTML = `
      <div class="help-row"><span class="ie">👁</span><div><div class="nm">${tr('偷看')}</div><div class="desc">${tr('想看真实的偷看画面，了解「警戒线」和下一发子弹怎么读吗？点下面按钮观看。')}</div></div></div>
      <button id="peekTutorBtn" class="itemhelp-close">▶ ${tr('观看偷看教学')}</button>`;
    const b=$('peekTutorBtn'); if(b) b.onclick=()=>{ $('helpModal').classList.remove('show'); showStaticTutorial(); };
    return;
  }
  if(tab==='items'){
    body.innerHTML = Object.keys(PROPS).map(id=>
      `<div class="help-row"><span class="ie">${PROPS[id].emoji}</span><div><div class="nm">${PROPS[id].name}</div><div class="desc">${PROP_DESC[id]}</div></div></div>`
    ).join('');
  } else {
    body.innerHTML = `
    <div class="help-row"><span class="ie">🎯</span><div><div class="desc" style="color:var(--gold);font-weight:600;font-size:13px;line-height:1.7">${tr('howto_goal')}</div></div></div>
    <div class="help-row"><span class="ie">🔫</span><div><div class="nm">${tr('rule_swap_name')}</div><div class="desc">${tr('howto_start')}</div></div></div>
    <div class="help-row"><span class="ie">🔴</span><div><div class="nm">${tr('实弹与空包')}</div><div class="desc">${tr('实弹命中 −1 ❤️，空包安全；弹仓打空会重新装弹。')}</div></div></div>
    <div class="help-row"><span class="ie">🎲</span><div><div class="nm">${tr('可以打自己')}</div><div class="desc">${tr('对自己开枪若是空包，你就能继续出手；若是实弹，照样扣血并换人。')}</div></div></div>
    <div class="help-row"><span class="ie">👁</span><div><div class="nm">${tr('偷看')}</div><div class="desc">${tr('首次濒血后觉醒「偷看」。按住「偷看」键，可在弹巢特写中窥得下一发是实弹还是空包。')}</div></div></div>
    <div class="help-row"><span class="ie">🧿</span><div><div class="nm">${tr('道具')}</div><div class="desc">${tr('击败首个庄家后解锁道具栏。双方最多持 4 个道具；击败庄家后会掉落 2 件遗物。')}</div></div></div>`;
  }
}
/* 开场速览：怎么玩（纯文案，复用 help-row 样式） */
function showHowTo(onClose){
  const modal=$('howtoModal'); if(!modal) return;
  const body=$('howtoBody'); if(body){
    body.innerHTML = `
      <div style="text-align:center;color:var(--gold);font-size:15px;letter-spacing:3px;margin-bottom:14px">${tr('howto_title')}</div>
      <div class="help-row"><span class="ie">🎯</span><div><div class="desc" style="color:var(--gold);font-weight:600;font-size:13px;line-height:1.7">${tr('howto_goal')}</div></div></div>
      <div class="help-row"><span class="ie">🔫</span><div><div class="nm">${tr('rule_swap_name')}</div><div class="desc">${tr('howto_start')}</div></div></div>
      <div class="help-row"><span class="ie">🔴</span><div><div class="nm">${tr('实弹与空包')}</div><div class="desc">${tr('howto_ammo')}</div></div></div>
      <div class="help-row"><span class="ie">👁</span><div><div class="nm">${tr('偷看')}</div><div class="desc">${tr('howto_open')}</div></div></div>
      <div class="help-row"><span class="ie">🧿</span><div><div class="nm">${tr('道具')}</div><div class="desc">${tr('howto_items')}</div></div></div>`;
  }
  modal.classList.add('show');
  const close=()=>{ modal.classList.remove('show'); if(typeof onClose==='function') onClose(); };
  $('howtoClose').onclick=close;
  $('howtoBackdrop').onclick=close;
}
// 教学弹巢直接复用 drawPeekCyl()（现成偷看弹巢画法），不再单独绘制。
function showStaticTutorial(onClose){
  const m=$('peekTutorModal'); if(!m) return;
  const step1=$('tutorStep1'), step2=$('tutorStep2');
  const nav1=$('tutorNavPage1'), nav2=$('tutorNavPage2');
  step1.classList.remove('hidden'); step2.classList.add('hidden');
  $('tutorWarn').classList.remove('hidden'); $('tutorBullet').classList.add('hidden');
  if(nav1){ nav1.classList.remove('hidden'); } if(nav2){ nav2.classList.add('hidden'); }
  m.classList.add('show');
  const close=()=>{ m.classList.remove('show'); try{ localStorage.setItem('peek_tutor_seen','1'); }catch(e){} if(typeof onClose==='function') onClose(); };
  $('peekTutorX').onclick=close;
  $('peekTutorBackdrop').onclick=close;
  const closePage2=$('tutorClosePage2'); if(closePage2) closePage2.onclick=close;
  $('tutorToStep2').onclick=()=>{ step1.classList.add('hidden'); step2.classList.remove('hidden'); const tc=$('tutorCyl'); if(tc){ const tctx=tc.getContext('2d'); drawPeekCyl(tctx, CYL_N, 0, LIVE, 1, performance.now()); } };
  $('tutorToPage2').onclick=()=>{ $('tutorWarn').classList.add('hidden'); $('tutorBullet').classList.remove('hidden'); if(nav1){ nav1.classList.add('hidden'); } if(nav2){ nav2.classList.remove('hidden'); } };
  $('tutorPrevPage').onclick=()=>{ $('tutorWarn').classList.remove('hidden'); $('tutorBullet').classList.add('hidden'); if(nav1){ nav1.classList.remove('hidden'); } if(nav2){ nav2.classList.add('hidden'); } };
}
function maybeShowPeekTutor(){
  if(!S || S.over) return;
  if(!S.peekUnlocked) return;
  try{ if(localStorage.getItem('peek_tutor_seen')) return; }catch(e){}
  showStaticTutorial();
}
let helpOnClose=null;
function showHelp(tab, onClose){
  const modal=$('helpModal'); if(!modal) return;
  helpOnClose = (typeof onClose==='function') ? onClose : null;
  document.querySelectorAll('.help-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  renderHelpBody(tab);
  modal.classList.add('show');
}
function closeHelp(){ const m=$('helpModal'); if(m) m.classList.remove('show'); const fn=helpOnClose; helpOnClose=null; if(fn) fn(); }
$('bHelp').onclick=()=>showHelp('rules');
$('helpClose').onclick=closeHelp;
$('helpBackdrop').onclick=closeHelp;
document.querySelectorAll('.help-tab').forEach(tab=>{
  tab.onclick=()=>{ document.querySelectorAll('.help-tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active'); renderHelpBody(tab.dataset.tab); };
});
/* ===== 开局剧情（按当前生肖变化） ===== */
function typeText(el,text,onDone){
  if(typingInterval){ clearInterval(typingInterval); typingInterval=null; }
  if(typingDone){ const fn=typingDone; typingDone=null; fn(); }
  el.textContent=''; let i=0; let done=false; let skipHandler=null;
  const container=$('intro')||document.body;
  const detachSkip=()=>{
    if(skipHandler){ container.removeEventListener('click', skipHandler); container.removeEventListener('touchstart', skipHandler); skipHandler=null; }
  };
  const finish=()=>{
    if(done) return;
    done=true;
    if(typingInterval){ clearInterval(typingInterval); typingInterval=null; }
    detachSkip();
    el.textContent=text;
    if(typeof onDone==='function') onDone();
  };
  const t=setInterval(()=>{
    el.textContent=text.slice(0,++i);
    if(i>=text.length){ clearInterval(t); typingInterval=null; finish(); }
  },20);
  typingInterval=t; typingDone=finish;
  // 仅在一次逐字显示进行中、玩家主动点击/触摸“开场画面”才跳过（立即显示全文）；不点击则照常逐字显示。
  // 关键：挂载监听必须推迟到当前点击事件冒泡结束之后，否则“点击下一步按钮”这一次的冒泡会被刚挂上的监听捕获，
  // 导致文字瞬间全显（根因：showIntro 由点击触发，typeText 在点击处理内同步挂监听，事件冒泡到 #intro 时误触发 finish）。
  const attachSkip=()=>{
    if(done) return; // 若已自然播完，不再挂监听（避免泄漏）
    skipHandler=(e)=>{ if(!done) finish(); };
    container.addEventListener('click', skipHandler);
    container.addEventListener('touchstart', skipHandler, {passive:true});
  };
  setTimeout(attachSkip, 60);
}
function showIntro(stage=0){
  // 防御性清理：回主菜单/初始加载时清掉上一局残留的 Canvas 特效。
  // 用 try/catch 包：game.js 顶层首次调用 showIntro() 时，SHOOTFX 常量尚未初始化（TDZ），
  // 直接访问会抛 Cannot access 'SHOOTFX' before initialization；捕获后不影响 intro 渲染。
  try{ resetFx(); }catch(e){}
  const z=RUN.zodiac;
  const i=$('intro'); i.classList.remove('hide'); i.style.display='flex';
  const g=$('game'); if(g) g.classList.add('intro-active');
  updateEndlessBar(); // 从无尽/地狱回主菜单时隐藏顶部分数条
  if(stage===0){ audio(); stopBGM(); setTimeout(()=>startBGM('intro'), 420); }
  const eyes=$('introEyes'), body=$('introBody');
  if(z.id==='rabbit'){
    if(stage===0){
      eyes.style.display='block'; body.style.display='none';
      $('introTitle').textContent=tr('窥 局 · 生 死 契');
      $('bEyesNext').onclick=()=>showIntro(1);
      updateEyesButtons();   // 存档点 / 轮回挑战按钮显隐与红点
    }else if(stage===1){
      eyes.style.display='none'; body.style.display='flex';
      setMaskInto($('introMask'), z);
      $('introTitle').textContent=tr(z.title);
      const _iab=hardAbility();
      $('introSign').innerHTML=tr('— 戴生肖面具的庄家，将与你赌上血肉。')+(_iab?('<br><span style="color:var(--gold)">⚔️ '+tr('困难 · {n}：{d}', {n:_iab.name, d:_iab.desc})+'</span>'):'');
      $('introSign').style.display='none';
      $('introChoices').style.display='none';
      $('bStart').style.display='none';
      $('bWho').onclick=()=>showIntro(2);
      $('bWhere').onclick=()=>showIntro(2);
      typeText($('story'), tr(z.intro), ()=>{
        $('introSign').style.display='block';
        $('introChoices').style.display='flex';
      });
    }else if(stage===2){
      eyes.style.display='none'; body.style.display='flex';
      setMaskInto($('introMask'), z);
      $('introTitle').textContent=tr(z.title);
      const _iab=hardAbility();
      $('introSign').innerHTML=(_iab?('<span style="color:var(--gold)">⚔️ '+tr('困难 · {n}：{d}', {n:_iab.name, d:_iab.desc})+'</span>'):'');
      $('introSign').style.display='none';
      $('introChoices').style.display='none';
      $('bStart').style.display='none';
      $('bStart').textContent=tr('▶ 看来我没有选择了，那就开始吧！');
      $('bStart').onclick=()=>{
        if(!localStorage.getItem('peek_howto_seen')){
          try{ localStorage.setItem('peek_howto_seen','1'); }catch(e){}
          showHelp('rules', startGame);
        } else { startGame(); }
      };
      typeText($('story'), tr('「不论你是谁、来自哪里——踏进了这里，就别想轻松离开。」\n\n') + tr(z.rules), ()=>{
        $('bStart').style.display='block';
      });
    }
  }else{
    eyes.style.display='none'; body.style.display='flex';
    setMaskInto($('introMask'), z);
    $('introTitle').textContent=tr(z.title);
    const _iab=hardAbility();
    $('introSign').innerHTML=tr('— ')+tr(z.hint)+(_iab?('<br><span style="color:var(--gold)">⚔️ '+tr('困难 · {n}：{d}', {n:_iab.name, d:_iab.desc})+'</span>'):'');
    $('introSign').style.display='none';
    $('introChoices').style.display='none';
    $('bStart').style.display='none';
    $('bStart').textContent = z.id==='joker' ? tr('▶ 真正的赌局') : tr('▶ 迎战 {n}', {n: zDisp(z)});
    $('bStart').onclick=startGame;
    typeText($('story'), tr(z.intro), ()=>{
      $('introSign').style.display='block';
      $('bStart').style.display='block';
    });
  }
}
function startGame(){
  // 注意：不要在这里 resetRun()。所有 showIntro() 的调用方已经正确设置 RUN：
  // - 初始加载 / 死亡 / 回菜单 / 每日挑战返回：调用 resetRun() 后再 showIntro()
  // - 普通胜利 / 假结局 twist / 里程碑馈赠：调用 nextZodiac() 后再 showIntro()
  // 如果这里 resetRun()，会导致「迎战下一生肖」后 RUN.index 被归零，永远卡在卯兔。
  const i=$('intro'); i.classList.add('hide'); setTimeout(()=>{ i.style.display='none'; },450);
  const g=$('game'); if(g) g.classList.remove('intro-active');
  audio(); stopBGM(); setTimeout(()=>startBGM('game', RUN.index), 420);
  reset();
  startAnalyticsSession();
}

/* ===== 每日挑战 ===== */
const DAILY_KEY='peek_daily';
function dailyZodiacIdx(){ return Math.floor(Date.now()/86400000)%12; }
// 门槛：必须打过第三个庄家（申猴，index 2）后才解锁每日挑战
function dailyUnlocked(){ try{ return !!(STATS.perIndex && STATS.perIndex[2] && STATS.perIndex[2].win>0); }catch(e){ return false; } }
// 门槛：必须打过普通模式的卯兔（首个生肖，RAW_ZODIACS[0]）才显示图鉴入口，避免新手打开全是「?」
function compendiumUnlocked(){ try{ const p=STATS.perIndex && STATS.perIndex[0]; return !!(p && p.modes && p.modes.normal>0); }catch(e){ return false; } }
function dailyDoneToday(){
  try{ const d=JSON.parse(localStorage.getItem(DAILY_KEY)); return d&&d.date===Math.floor(Date.now()/86400000); }catch(e){ return false; }
}
/* 每日挑战：生肖以「今日守关者」口吻说的个性台词（仿游戏内对局画面说辞） */
const DAILY_TAUNT={
  'rabbit':'今日的月光，刚好够照清你的惧意。来，陪我玩一局。',
  'horse':'每日一赛，输的人留下影子。今天，你跑得够快吗？',
  'monkey':'本猴今天心情好，陪你耍两把。输了可别哭鼻子。',
  'rat':'我、我今天当庄……你、你别盯着我看，会慌的。',
  'snake':'每日一题：你觉得自己，读得懂我几成？',
  'rooster':'鸡叫之前，先陪我赌到天亮。赢家，才能走。',
  'dog':'守门人今日当值。想过去？先过我这关。',
  'ox':'今日分量很足，顶得住吗？顶不住就别上。',
  'pig':'吃饱了才有力气赌。今日这局，管够。',
  'tiger':'每日一吼，震碎胆小的。你，敢接吗？',
  'goat':'今日宜试探，忌轻信。我的话，你挑着听。',
  'dragon':'今日真容微露。看清了，可别后悔。'
};
/* 存档点说明卡：伪装成好心人的小丑伏笔，按存档点区分语气 */
const CP_CLOWN={
  '_':'小丑会伪装成「好心人」在这些存档点等你。他送的助力看似好意，却藏着不为人知的目的……',
  5:'一旁的看客轻笑：「这条路，有人一直替你记着呢。存档点，是他留给你的退路。」',
  8:'熟悉的身影又出现了：「穷家富路，他早替你想好了——从这儿续战，省得从头来过。」',
  11:'最后一段路的尽头，他第一次正眼瞧你：「到了这儿，你总算走到他能放心松手的地方了。」'
};
function showDaily(){
  if(!dailyUnlocked()){ miniToast(tr('需先击败申猴，才能解锁每日挑战')); return; }
  const done=dailyDoneToday();
  const z=ZODIACS[dailyZodiacIdx()];
  const goBtn=$('dailyGo');
  const statsEl=$('dailyStats');
  const backBtn=$('dailyBackBtn');
  const faceEl=$('dailyFace'); if(faceEl) faceEl.innerHTML=peekMaskImg(z);
  const lineEl=$('dailyLine');
  if(backBtn) backBtn.textContent = tr('返 回');
  if(done){
    try{
      const raw=JSON.parse(localStorage.getItem(DAILY_KEY))||{};
      // 兼容老数据：若没 win 字段，按 score 推断（>0 即胜）
      const st = {
        win: raw.win===true || (raw.win===undefined && raw.score>0),
        score: raw.score||0,
        zodiacTitle: raw.zodiacTitle || '',
        hp: raw.hp||0, hpMax: raw.hpMax||0,
        peekMax: raw.peekMax||0, peekUsed: raw.peekUsed||0,
        itemsUsed: raw.itemsUsed||0,
        dealerHp: raw.dealerHp||0, dealerHpMax: raw.dealerHpMax||0,
        shots: raw.shots||0
      };
      if(lineEl) lineEl.textContent = st.win ? tr('今日已胜利：「{n}，不过如此。」', {n: zDisp(z)}) : tr('今日已挑战 · 明天再来。{n} 还在原地等你。', {n: zDisp(z)});
      if(goBtn){ goBtn.textContent = st.win ? tr('明天再来') : tr('确定'); goBtn.className='daily-btn '+(st.win?'daily-btn-secondary':'daily-btn-dim'); }
      if(statsEl){
        statsEl.style.display='block';
        const usedItems = Math.max(0, 5 - st.itemsUsed);
        const peekLeft = Math.max(0, st.peekMax - st.peekUsed);
        statsEl.innerHTML=
          `<div class="daily-result-line ${st.win?'win':'lose'}" style="text-align:center;font-weight:700;margin-bottom:8px;${st.win?'color:var(--gold)':'color:var(--red)'}">${st.win?tr('胜利'):tr('失败')} · ${tr('得分 {s}', {s: st.score})}</div>`+
          `<div class="daily-formula" style="font-size:11px;color:var(--dim);line-height:1.7;margin:8px 0 10px;padding:8px;background:#0d0a16;border-radius:8px">`+
          (st.win
            ? tr('血量 ×100 + 未用偷看 ×50 + 未用道具 ×20<br>= <b>{hp}</b>×100 + <b>{pk}</b>×50 + <b>{it}</b>×20 = <b style="color:var(--gold);font-size:13px">{total}</b>', {hp: st.hp, pk: peekLeft, it: usedItems, total: st.score})
            : tr('挑战失败，得分 0。今日守护 {n} 实在太强。', {n: st.zodiacTitle||''})
          )+
          `</div>`+
          `<div class="daily-summary" style="font-size:12px;line-height:1.85;color:var(--txt);text-align:left">`+
            `<div>${tr('你的剩余血量：{h}/{m}', {h: st.hp, m: st.hpMax})}</div>`+
            `<div>${tr('你的偷看：用了 {u} / 共 {m} 次', {u: st.peekUsed, m: st.peekMax})}</div>`+
            `<div>${tr('你的道具使用：{n} 次', {n: st.itemsUsed})}</div>`+
            `<div>${tr('庄家剩余血量：{h}/{m}', {h: st.dealerHp, m: st.dealerHpMax})}</div>`+
            `<div>${tr('本局共开枪：{n} 发', {n: st.shots})}</div>`+
          `</div>`;
      }
    }catch(e){ console.error(e); }
  } else {
    if(lineEl) lineEl.textContent=tr(DAILY_TAUNT[z.id]||'');
    if(statsEl){ statsEl.style.display='none'; statsEl.innerHTML=''; }
    if(goBtn){ goBtn.textContent = tr('开始挑战'); goBtn.className='daily-btn daily-btn-primary'; }
  }
  $('dailyModal').classList.add('show');
}
updatePeekHint();
$('logHead').onclick=()=>{ const p=$('logPanel'); if(!p) return; p.classList.toggle('collapsed'); if(!p.classList.contains('collapsed')){ const b=$('logBody'); if(b) b.scrollTop=b.scrollHeight; } };
setBgmMute(bgmMuted);
const _ver=$('appVer'); if(_ver) _ver.textContent=tr('无间轮回 PEEK')+' v'+APP_VERSION;
setSfxMute(sfxMuted);
showIntro();
/* 启动幕布：intro 已开始淡入（.intro fadeIn .6s），等淡入完成后撤掉纯黑幕布，
 * 避免首帧露出底下 #game 的 ❓ 庄家位默认 UI（「载入闪现 ❓ 页面」问题根因：
 * #intro 是 defer 的 game.js 跑到这里才显示的，且淡入从 opacity:0 开始，盖不住首屏）。 */
(function(){
  const bc=document.getElementById('bootCover'); if(!bc) return;
  setTimeout(()=>{ bc.style.opacity='0'; setTimeout(()=>{ if(bc.parentNode) bc.parentNode.removeChild(bc); },450); }, 650);
})();
if(window.PEEK_FEATURES.cloudSave || window.PEEK_FEATURES.leaderboard) initLeaderboard();
if(window.PEEK_FEATURES.analytics) trackEvent('app_open', {});
updateAchDot();   // 启动时刷新 ⚙️/成就 红点（反映跨会话未读成就）
/* ===== 睁眼菜单：存档点 + 轮回挑战 ===== */
function challengeSeen(){ try{ return JSON.parse(localStorage.getItem('peek_ch_seen')||'{}'); }catch(e){ return {}; } }
function challengeHasNews(){
  const s=challengeSeen();
  if(hardUnlocked() && !s.hard) return true;
  if(endlessUnlocked() && !s.endless) return true;
  if(hellUnlocked() && !s.hell) return true;
  if(dailyUnlocked() && !dailyDoneToday()) return true;
  return false;
}
function markChallengeSeen(){
  try{ localStorage.setItem('peek_ch_seen', JSON.stringify({hard:hardUnlocked(), endless:endlessUnlocked(), hell:hellUnlocked()})); }catch(e){}
}
function updateEyesButtons(){
  const bCk=document.getElementById('bCheckpoint'), bCh=document.getElementById('bChallenge');
  if(bCk) bCk.style.display = ckUnlocked().length ? '' : 'none';
  // 图鉴入口：打过普通模式卯兔后才显示（主菜单按钮 + 设置项整行）
  const bCw=document.getElementById('bCompendium');
  if(bCw) bCw.style.display = compendiumUnlocked() ? '' : 'none';
  const setCw=document.getElementById('setCompendium');
  if(setCw){ const row=setCw.closest('.settings-row'); if(row) row.style.display = compendiumUnlocked() ? '' : 'none'; else setCw.style.display = compendiumUnlocked() ? '' : 'none'; }
  if(bCh){
    bCh.style.display = (hardUnlocked()||endlessUnlocked()||hellUnlocked()||dailyUnlocked()) ? '' : 'none';
    const dot=document.getElementById('chDot');
    if(dot) dot.style.display = challengeHasNews() ? '' : 'none';
  }
}
function showCheckpointModal(){
  const un=ckUnlocked();
  const box=document.getElementById('cpBtns'); if(!box) return;
  box.innerHTML=CK_POINTS.map(i=>{
    const z=ZODIACS[i]; const ok=un.includes(i);
    return `<button class="cp-btn" data-ck="${i}" ${ok?'':'disabled'}><span class="cp-name"><span class="cp-ico">${z.emoji}</span><span class="cp-name-txt">${tr('从 {n} 开始', {n:zDisp(z)})}</span></span><span class="cp-sub">${tr('通关{n}简单模式解锁', {n:zDisp(z)})}</span></button>`;
  }).join('');
  box.querySelectorAll('[data-ck]').forEach(b=>b.onclick=()=>{
    document.getElementById('checkpointModal').classList.remove('show');
    showCheckpointIntro(+b.dataset.ck);
  });
  document.getElementById('checkpointModal').classList.add('show');
}
function startFromCheckpoint(idx){
  resetRun();
  RUN.index=idx; RUN.zodiac=ZODIACS[idx];
  RUN.peekUnlocked=true; RUN.itemsUnlocked=true;
  // 补给：3 件随机道具（相当于此前一路的积累；永久里程碑奖励按战绩自动保留，不重复发放）
  const pool=poolFor(idx).slice(); const out=[];
  for(let i=0;i<3&&pool.length;i++) out.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  RUN.lastDrop=out;
  // 小丑在存档点等你：赠予该点对应的一次性馈礼（同一轮回不重复；困难模式不发放；跨轮回只一次）
  if(!RUN.hard && JOKER_GIFT_IDX.includes(idx) && !_giftsSeen.has(idx)){ jokerGiftApply(idx); RUN.giftsGiven[idx]=true; markGiftSeen(idx); }
  miniToast(tr('存档点 · 从 {n} 开始', {n:zDisp(RUN.zodiac)}));
  showIntro();
}
function showCheckpointIntro(idx){
  const z=ZODIACS[idx];
  const icoEl=document.getElementById('cpIntroZodiac');
  const lineEl=document.getElementById('cpIntroLine');
  const hintEl=document.getElementById('cpIntroHint');
  if(icoEl) icoEl.innerHTML = peekMaskImg(z);
  if(lineEl) lineEl.textContent = tr('对手：{n} / 简单模式', {n: tr(z.title)});
  if(hintEl){
    if(idx===11){
      hintEl.innerHTML = tr('击败辰龙后，你将揭开真正的庄家。');
    } else {
      hintEl.innerHTML = tr('击败 {n} 后，无间轮回将继续推进。', {n: tr(z.title)});
    }
  }
  const clownEl=document.getElementById('cpIntroClown');
  if(clownEl) clownEl.innerHTML = tr(CP_CLOWN[idx]||CP_CLOWN['_']||'').replace(/\n/g,'<br>');
  const back=document.getElementById('cpIntroBack');
  const go=document.getElementById('cpIntroGo');
  if(back) back.onclick = ()=>{
    document.getElementById('checkpointIntroModal').classList.remove('show');
    showCheckpointModal();
  };
  if(go) go.onclick = ()=>{
    document.getElementById('checkpointIntroModal').classList.remove('show');
    startFromCheckpoint(idx);
  };
  document.getElementById('checkpointIntroModal').classList.add('show');
}
function showChallengeModal(){
  const box=document.getElementById('chBtns'); if(!box) return;
  const dailyNews = dailyUnlocked() && !dailyDoneToday();
  const list=[
    {id:'hard',    ico:'⚔️', name:tr('困难模式'), ok:hardUnlocked(),    sub: hardUnlocked()?tr('十二生肖各持异能 · 从头再战'):tr('击败辰龙后解锁')},
    {id:'endless', ico:'♾️', name:tr('无尽模式'), ok:endlessUnlocked(), sub: endlessUnlocked()?tr('无限连战冲分 · 冲击排行榜'):tr('击败小丑后解锁')},
    {id:'hell',    ico:'🔥', name:tr('地狱模式'), ok:hellUnlocked(),    sub: hellUnlocked()?tr('困难异能 + 无尽连战 · 分数 ×2'):tr('通关困难模式后解锁')},
    {id:'daily',   ico:'🌞', name:tr('今日挑战'), ok:dailyUnlocked(),   sub: dailyUnlocked()?(dailyDoneToday()?tr('今日已挑战 · 查看战报'):tr('每天一局 · 用实力证明自己')):tr('击败申猴后解锁'), dot:dailyNews}
  ];
  box.innerHTML=list.map(m=>`<button class="ch-btn" data-ch="${m.id}" ${m.ok?'':'disabled'}>${m.dot?'<span class="reddot"></span>':''}<span class="ch-name">${m.ico} ${m.name}</span><span class="ch-sub">${m.sub}</span></button>`).join('');
  box.querySelectorAll('[data-ch]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.ch;
    document.getElementById('challengeModal').classList.remove('show');
    if(id==='daily'){ showDaily(); return; }
    if(id==='hard'){ resetRun(); RUN.hard=true; miniToast(tr('困难模式 · 生肖异能已觉醒')); showIntro(1); return; }
    if(id==='endless'){ enterEndless(false); return; }
    if(id==='hell'){ enterEndless(true); return; }
  });
  document.getElementById('challengeModal').classList.add('show');
  markChallengeSeen(); updateEyesButtons();
}
const bCheckpoint=document.getElementById('bCheckpoint');
if(bCheckpoint) bCheckpoint.onclick=showCheckpointModal;
const bChallenge=document.getElementById('bChallenge');
if(bChallenge) bChallenge.onclick=showChallengeModal;
const cpClose=document.getElementById('cpClose');
if(cpClose) cpClose.onclick=()=>document.getElementById('checkpointModal').classList.remove('show');
const chClose=document.getElementById('chClose');
if(chClose) chClose.onclick=()=>document.getElementById('challengeModal').classList.remove('show');
const dailyBackdrop=document.getElementById('dailyBackdrop');
const dailyBackBtn=document.getElementById('dailyBackBtn');
if(dailyBackdrop) dailyBackdrop.onclick=()=>{ document.getElementById('dailyModal').classList.remove('show'); };
if(dailyBackBtn) dailyBackBtn.onclick=()=>{ document.getElementById('dailyModal').classList.remove('show'); };
const dailyGo=document.getElementById('dailyGo');
if(dailyGo) dailyGo.onclick=()=>{
  if(dailyDoneToday()){ miniToast(tr('今日已挑战过')); return; }
  document.getElementById('dailyModal').classList.remove('show');
  const idx=dailyZodiacIdx();
  RUN.index=idx; RUN.zodiac=ZODIACS[idx]; RUN.isJoker=false; RUN.endless=false; RUN.daily=true;
  resetRun();
  RUN.index=idx; RUN.zodiac=ZODIACS[idx]; RUN.daily=true;
  RUN.peekUnlocked=true; RUN.itemsUnlocked=true;
  const i=document.getElementById('intro'); if(i) i.classList.add('hide'); setTimeout(()=>{ if(i) i.style.display='none'; },450);
  audio(); stopBGM(); setTimeout(()=>startBGM('game', RUN.index), 420);
  reset();
};


/* ===== GM 实时调参（开发用，避坑指南：频繁改参数看效果太慢，集中到面板）=====
 * window.PEEK_DEBUG 是 GM 面板实时改的全局对象；AMBIENT 各函数每次渲染都读它，
 * 所以拖动滑块即可即时看到烛光/暗角/香灰变化，无需重新部署。
 * mask 类（面具漂浮）走 CSS 变量（见 styles.css :root 的 --mask-float-*），
 * 由 GM 面板直接写 document.documentElement.style，同样实时生效。
 * 默认值即当前手感基准；面板「复制」可导出 JSON 贴回代码，「重置」恢复默认。 */
const PEEK_DEBUG_DEFAULT={
  mask:    { floatY:-12, floatScale:1.1, dur:3.8, size:200, rotY:6, lookX:25, dur3d:12.5 },
  gun:     { dealer:70, player:75, x:0, scale:1.03, y:20, rise:1000 },   // 枪支演出：高度(vh) / 水平偏移(px) / 缩放 / 垂直偏移(%) / 上升时长(ms)—— 手机实测烘焙值
  candle:  { r1:120, r2:145, aBase:0.06, aGain:0.09, y1:0.07, y2:0.08, x1:0.34, x2:0.66, speed:0.9 },
  vignette:{ basePow:0.24, roundGain:0.14, hitGain:0.18, innerR:0.28, outerR:0.72 },
  ash:     { prob:0.07, max:19, sizeMin:5, sizeMax:7, alpha:0.09, color:'255,235,200', vyMin:0.65, vyMax:0.45, vx:0.18, grow:0.32, sway:0.55 }
};
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
window.PEEK_DEBUG = (function(){
  let D;
  try{ const s=localStorage.getItem('peek_gm_params'); D = s?Object.assign(deepClone(PEEK_DEBUG_DEFAULT), JSON.parse(s)):deepClone(PEEK_DEBUG_DEFAULT); }
  catch(e){ D = deepClone(PEEK_DEBUG_DEFAULT); }
  // 兜底：localStorage 缺字段时补默认，避免 undefined
  for(const g in PEEK_DEBUG_DEFAULT){ D[g]=D[g]||deepClone(PEEK_DEBUG_DEFAULT[g]); for(const k in PEEK_DEBUG_DEFAULT[g]){ if(D[g][k]===undefined) D[g][k]=PEEK_DEBUG_DEFAULT[g][k]; } }
  return D;
})();

/* ===== 氛围层 Ambient（Canvas 常驻：烛光呼吸 + 暗角脉动 + 香灰飘落）=====
 * 复用定稿预览 prototypes/peek-ambient-preview.html（v2）。
 * z-index:23（压在 HUD 边缘之上、不挡弹窗文字）。
 * 钩子：fire() 每发 → ambientNextRound()（暗角收缩脉动，给每发一个节奏拍）；命中实弹 → ambientHitFlash()（暗角红闪）。
 * §8 防御：prefers-reduced-motion 只画一帧静态（无动画）；visibilitychange 隐藏页时暂停 rAF 省电；全程 try/catch 防崩。
 * 所有可调参数来自 window.PEEK_DEBUG，供 GM 面板实时调。 */
const AMBIENT=(function(){
  const game=$('game'), cv=$('ambientCanvas');
  if(!game||!cv) return { start(){}, nextRound(){}, hitFlash(){} };
  const ctx=cv.getContext('2d');
  let W=0,H=0,DPR=1,rafId=null,lastT=0;
  const ST={particles:[],roundPulse:0,hitPulse:0};
  const rng=(a,b)=>a+Math.random()*(b-a);
  const reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize(){
    const r=game.getBoundingClientRect();
    DPR=Math.min(window.devicePixelRatio||1,2);
    W=Math.max(1,r.width); H=Math.max(1,r.height);
    cv.width=Math.floor(W*DPR); cv.height=Math.floor(H*DPR);
    cv.style.width=W+'px'; cv.style.height=H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  function addAsh(){
    const A=window.PEEK_DEBUG.ash;
    if(ST.particles.length>=A.max) return;
    ST.particles.push({ x:rng(W*0.12,W*0.88), y:H*0.98,
      vx:rng(-A.vx,A.vx), vy:-rng(A.vyMin,A.vyMax),
      life:1, decay:rng(.0015,.004), size:rng(A.sizeMin,A.sizeMax), grow:rng(.35,.70),
      sway:rng(0,Math.PI*2), swaySpd:rng(.012,.034) });
  }
  function drawCandleGlow(x,y,power,r){
    ctx.save(); ctx.globalCompositeOperation='screen';
    const C=window.PEEK_DEBUG.candle;
    const a=C.aBase+power*C.aGain;
    const g=ctx.createRadialGradient(x,y,6,x,y,r);
    g.addColorStop(0,`rgba(255,210,150,${a})`);
    g.addColorStop(.5,`rgba(255,175,105,${a*0.45})`);
    g.addColorStop(1,'rgba(255,150,80,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
  function drawVignette(rp,hp){
    ctx.save();
    const minD=Math.min(W,H), maxD=Math.max(W,H);
    const V=window.PEEK_DEBUG.vignette;
    const innerR=minD*(V.innerR+rp*0.18);
    const outerR=maxD*V.outerR;
    const basePow=reduce?Math.min(0.35,V.basePow):V.basePow;
    const power=Math.min(0.95, basePow + rp*V.roundGain + hp*V.hitGain);
    const rC=hp>0.02?'255,40,60':'0,0,0';
    const g=ctx.createRadialGradient(W/2,H/2,innerR, W/2,H/2,outerR);
    g.addColorStop(0,`rgba(${rC},0)`);
    g.addColorStop(1,`rgba(${rC},${power})`);
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H); ctx.restore();
  }
  function drawFrame(t){
    ctx.clearRect(0,0,W,H);
    const C=window.PEEK_DEBUG.candle;
    const b1=reduce?0.5:0.5+0.5*Math.sin(t*C.speed);
    const b2=reduce?0.5:0.5+0.5*Math.sin(t*C.speed+2.1);
    drawCandleGlow(W*C.x1,H*C.y1,b1,C.r1);
    drawCandleGlow(W*C.x2,H*C.y2,b2,C.r2);
    const rp=Math.max(0,ST.roundPulse), hp=Math.max(0,ST.hitPulse);
    drawVignette(rp,hp);
  }
  function loop(now){
    try{
      if(!lastT) lastT=now;
      const dt=Math.min(64, now-lastT); lastT=now;
      const t=now/1000;
      const A=window.PEEK_DEBUG.ash;
      drawFrame(t);
      if(ST.roundPulse>0){ ST.roundPulse-=dt*0.0012; if(ST.roundPulse<0) ST.roundPulse=0; }
      if(ST.hitPulse>0){ ST.hitPulse-=dt*0.0022; if(ST.hitPulse<0) ST.hitPulse=0; }
      if(Math.random()<A.prob) addAsh();
      for(let i=ST.particles.length-1;i>=0;i--){
        const p=ST.particles[i];
        p.sway+=p.swaySpd; p.x+=p.vx+Math.sin(p.sway)*A.sway; p.y+=p.vy; p.size+=p.grow*A.grow; p.life-=p.decay;
        if(p.life<=0){ ST.particles.splice(i,1); continue; }
        const a=p.life>0.75?(1-p.life)/0.25:p.life;
        ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,a))*A.alpha;
        const g=ctx.createRadialGradient(p.x,p.y,1,p.x,p.y,p.size);
        g.addColorStop(0,`rgba(${A.color},0.9)`); g.addColorStop(1,`rgba(${A.color},0)`);
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.5,p.size),0,Math.PI*2); ctx.fill(); ctx.restore();
      }
      rafId=requestAnimationFrame(loop);
    }catch(err){
      if(window.__ambErr!==(err&&err.message)){ window.__ambErr=(err&&err.message); console.error(err); }
      if(rafId){ cancelAnimationFrame(rafId); rafId=null; }
    }
  }
  function start(){
    resize();
    window.addEventListener('resize',resize);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){ if(rafId){ cancelAnimationFrame(rafId); rafId=null; } }
      else if(!rafId){ lastT=0; rafId=requestAnimationFrame(loop); }
    });
    if(reduce){ drawFrame(0); return; } // 减少动态：只画一帧静态烛光/暗角，不跑 rAF
    rafId=requestAnimationFrame(loop);
  }
  return {
    start,
    nextRound(){ if(!reduce && ST.roundPulse<1) ST.roundPulse=1; },
    hitFlash(){ if(!reduce && ST.hitPulse<1) ST.hitPulse=1; }
  };
})();
function ambientNextRound(){ if(AMBIENT) AMBIENT.nextRound(); }
function ambientHitFlash(){ if(AMBIENT) AMBIENT.hitFlash(); }
AMBIENT.start(); // 游戏脚本加载即启动氛围层（deferred，DOM 已就绪）

/* ===== 射击 FX（Canvas 瞬时：枪口闪 + 火花 + 弹壳 + 震屏 + 血溅）=====
 * 复用定稿预览 prototypes/peek-shoot-fx-preview.html（v7）。
 * z-index:26（开枪冲击最顶，低于弹窗 35/45）。
 * 钩子：fire() 每发 → shootFx(target, hit)；命中实弹 → 血溅 + 庄家 shake + 黑闪。
 * 替代 dealerHit/playerHit 内的 blackout()/redFlash()（避免双重闪）。
 * §8 防御：prefers-reduced-motion 降粒子/降透明度；visibilitychange 暂停 rAF；全程 try/catch。 */
const SHOOTFX=(function(){
  const game=$('game'), cv=$('fxCanvas');
  if(!game||!cv) return { start(){}, shoot(){} };
  const ctx=cv.getContext('2d');
  let W=0,H=0,DPR=1,rafId=null,lastT=0;
  const ST={particles:[],shakes:0,flash:0,flashType:'white',blood:0,lastTarget:null};
  const reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize(){
    const r=game.getBoundingClientRect();
    DPR=Math.min(window.devicePixelRatio||1,2);
    W=Math.max(1,r.width); H=Math.max(1,r.height);
    cv.width=Math.floor(W*DPR); cv.height=Math.floor(H*DPR);
    cv.style.width=W+'px'; cv.style.height=H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  function rng(a,b){return a+Math.random()*(b-a)}
  function dealerEl(){ return document.querySelector('.dealer-zone .mask-wrap'); }
  function pointOnRect(el){
    if(!el) return {x:W/2,y:H*0.22};
    const r=el.getBoundingClientRect(), p=game.getBoundingClientRect();
    return {x:r.left-p.left+r.width/2, y:r.top-p.top+r.height/2};
  }
  function addSpark(x,y,dir,color){
    color=color||'#ffcf6a';
    const a=dir+rng(-.45,.45), sp=rng(3,9);
    ST.particles.push({type:'spark',x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,decay:rng(.03,.07),size:rng(1.5,3.5),color});
  }
  function addSmoke(x,y,dir){
    const a=dir+rng(-.3,.3);
    ST.particles.push({type:'smoke',x,y,vx:Math.cos(a)*rng(1,3),vy:Math.sin(a)*rng(1,3),life:1,decay:rng(.045,.07),size:rng(3,7),grow:rng(.12,.28),color:'rgba(145,145,155,'});
  }
  function addBloodDrop(cx,cy,scale){
    scale=scale||1;
    const a=rng(-Math.PI,Math.PI), dist=rng(18,95)*scale;
    const tx=cx+Math.cos(a)*dist, ty=cy+Math.sin(a)*dist*0.85+rng(10,36)*scale;
    const sx=cx+Math.cos(a)*rng(6,18), sy=cy+Math.sin(a)*rng(6,18);
    ST.particles.push({type:'blood',x:sx,y:sy,tx,ty,t:0,dur:rng(280,420),size:rng(4,11)*scale,trail:[]});
  }
  function addBloodMist(cx,cy,scale){
    scale=scale||1;
    for(let i=0;i<10;i++){
      const a=rng(0,Math.PI*2);
      ST.particles.push({type:'mist',x:cx+Math.cos(a)*rng(4,22)*scale,y:cy+Math.sin(a)*rng(4,22)*scale,vx:Math.cos(a)*rng(.3,1.6),vy:Math.sin(a)*rng(.3,1.6),life:1,decay:rng(.035,.055),size:rng(13,34)*scale,color:'rgba(195,24,24,'});
    }
  }
  function resetFx(){ ST.particles=[]; ST.flash=0; ST.blood=0; ST.shakes=0; if(ctx) ctx.clearRect(0,0,W,H); }
  function shoot(target,hit){
    resetFx();
    const muzzle={x:W/2, y:H*0.86};
    const targetPt = target==='dealer' ? pointOnRect(dealerEl()) : {x:W/2, y:H*0.88};
    const aimAngle=Math.atan2(targetPt.y-muzzle.y, targetPt.x-muzzle.x);
    ST.lastTarget=target;
    ST.shakes = hit?10:5;
    ST.flash=1; ST.flashType = hit?'white':'gold';
    const sc=reduce?5:14;
    for(let i=0;i<sc;i++) addSpark(muzzle.x,muzzle.y,aimAngle);
    for(let i=0;i<3;i++) addSmoke(muzzle.x,muzzle.y,aimAngle);
    if(hit){
      ST.blood=1;
      if(target==='dealer'){
        const d=dealerEl();
        if(d){ d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); ActorFire(()=>{ if(d) d.classList.remove('shake'); },400); }
        const dc=reduce?8:20;
        for(let i=0;i<dc;i++) addBloodDrop(targetPt.x,targetPt.y,1);
        addBloodMist(targetPt.x,targetPt.y,1);
      }else{
        const dc=reduce?10:26;
        for(let i=0;i<dc;i++) addBloodDrop(targetPt.x,targetPt.y,1.45);
        addBloodMist(targetPt.x,targetPt.y,1.5);
      }
    }
    ST.particles.push({type:'shell',x:muzzle.x,y:muzzle.y,vx:rng(2,5)*(Math.random()<.5?1:-1),vy:rng(-6,-10),rot:rng(0,Math.PI),vr:rng(-.2,.2),life:1,decay:.03,size:14});
  }
  function drawMuzzleFlash(power,type){
    if(power<=0.08) return;
    const cx=W/2, cy=H*0.74;
    ctx.save(); ctx.globalCompositeOperation='screen';
    const color = type==='gold'?'255,195,105':'255,230,205';
    const R=reduce?34:58;
    const g=ctx.createRadialGradient(cx-6,cy-6,2,cx,cy,R);
    g.addColorStop(0,`rgba(${color},${power*.72})`);
    g.addColorStop(.4,`rgba(${color},${power*.22})`);
    g.addColorStop(1,`rgba(${color},0)`);
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
    ctx.translate(cx,cy);
    for(let i=0;i<8;i++){ ctx.rotate(Math.PI/4); ctx.fillStyle=`rgba(${color},${power*.18})`; ctx.beginPath(); ctx.ellipse(0,reduce?-20:-34,reduce?2:4,reduce?8:16,0,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  function drawBlackout(power){
    if(power<=0) return;
    ctx.save(); ctx.globalCompositeOperation='source-over';
    const alpha=power*(reduce?.14:.28);
    ctx.fillStyle=`rgba(255,255,255,${alpha})`; ctx.fillRect(0,0,W,H); ctx.restore();
  }
  function frame(now){
    try{
      if(!lastT) lastT=now;
      const dt=Math.min(64, now-lastT); lastT=now;
      let sx=0,sy=0;
      if(ST.shakes>0){
        const amp=ST.shakes*(reduce?.5:1.2);
        sx=(Math.random()*2-1)*amp; sy=(Math.random()*2-1)*amp;
        ST.shakes-=dt*0.06*(reduce?1.5:1);
        if(ST.shakes<0) ST.shakes=0;
      }
      ctx.clearRect(0,0,W,H);
      ctx.save(); ctx.translate(sx,sy);
      if(ST.flash>0){ drawBlackout(ST.flash); ST.flash-=dt*0.004*(reduce?1.5:1); if(ST.flash<0) ST.flash=0; }
      drawMuzzleFlash(ST.flash*1.1, ST.flashType);
      if(ST.blood>0){
        ctx.save(); ctx.globalCompositeOperation='multiply';
        const pb=(ST.lastTarget==='self')?1.6:1;
        ctx.fillStyle=`rgba(170,0,0,${ST.blood*.2*pb})`; ctx.fillRect(0,0,W,H); ctx.restore();
        ST.blood-=dt*0.006; if(ST.blood<0) ST.blood=0;
      }
      for(let i=ST.particles.length-1;i>=0;i--){
        const p=ST.particles[i];
        if(p.type==='spark'){
          p.x+=p.vx; p.y+=p.vy; p.vy+=.25; p.life-=p.decay;
          ctx.save(); ctx.globalCompositeOperation='screen'; ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,p.life);
          ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.1,p.size*Math.max(0,p.life)),0,Math.PI*2); ctx.fill(); ctx.restore();
          if(p.life<=0) ST.particles.splice(i,1);
        }else if(p.type==='smoke'){
          p.x+=p.vx; p.y+=p.vy; p.size+=p.grow; p.life-=p.decay;
          ctx.save(); ctx.globalCompositeOperation='screen'; ctx.fillStyle=p.color+Math.max(0,p.life*.14)+')';
          ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.1,p.size),0,Math.PI*2); ctx.fill(); ctx.restore();
          if(p.life<=0) ST.particles.splice(i,1);
        }else if(p.type==='blood'){
          p.t+=dt; const k=Math.min(1,p.t/p.dur);
          p.x+=(p.tx-p.x)*.18; p.y+=(p.ty-p.y)*.18; p.y+=.8;
          p.trail.push({x:p.x,y:p.y}); if(p.trail.length>4) p.trail.shift();
          ctx.save(); ctx.fillStyle='#a01010'; ctx.strokeStyle='#a01010'; ctx.lineWidth=p.size*.6; ctx.lineCap='round';
          ctx.beginPath(); if(p.trail.length) ctx.moveTo(p.trail[0].x,p.trail[0].y); for(const t of p.trail) ctx.lineTo(t.x,t.y); ctx.stroke();
          ctx.globalAlpha=Math.max(0,1-k*.6); ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.1,p.size*(1-k*.3)),0,Math.PI*2); ctx.fill(); ctx.restore();
          if(k>=1) ST.particles.splice(i,1);
        }else if(p.type==='mist'){
          p.x+=p.vx; p.y+=p.vy; p.size+=.15; p.life-=p.decay;
          ctx.save(); ctx.globalCompositeOperation='screen'; ctx.fillStyle=p.color+Math.max(0,p.life*.25)+')';
          ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.1,p.size),0,Math.PI*2); ctx.fill(); ctx.restore();
          if(p.life<=0) ST.particles.splice(i,1);
        }else if(p.type==='shell'){
          p.x+=p.vx; p.y+=p.vy; p.vy+=.55; p.rot+=p.vr; p.life-=p.decay;
          ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillStyle='#d4af37'; ctx.strokeStyle='#6b5b38'; ctx.lineWidth=2;
          ctx.fillRect(-6,-3,12,6); ctx.strokeRect(-6,-3,12,6); ctx.fillStyle='#8a7a48'; ctx.fillRect(-2,-3,4,6); ctx.restore();
          if(p.life<=0 || p.y>H+20) ST.particles.splice(i,1);
        }
      }
      ctx.restore();
      if(ST.particles.length===0 && ST.flash<=0.08 && ST.blood<=0 && ST.shakes<=0) ctx.clearRect(0,0,W,H);
    }catch(err){
      if(window.__fxErr!==(err&&err.message)){ window.__fxErr=(err&&err.message); console.error(err); }
      if(rafId){ cancelAnimationFrame(rafId); rafId=null; }
    }
  }
  function start(){
    resize();
    window.addEventListener('resize',resize);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){ if(rafId){ cancelAnimationFrame(rafId); rafId=null; } }
      else if(!rafId){ lastT=0; rafId=requestAnimationFrame(frame); }
    });
    rafId=requestAnimationFrame(frame);
  }
  return { start, shoot, resetFx };
})();
function shootFx(t,hit){ if(SHOOTFX) SHOOTFX.shoot(t,hit); }
function resetFx(){
  // 用 try 包裹 SHOOTFX 访问：showIntro() 等极少数路径可能在 SHOOTFX 初始化前被调用，
  // 此时访问 const 变量会触发 TDZ（Cannot access 'SHOOTFX' before initialization）。
  try{ if(SHOOTFX && SHOOTFX.resetFx){ SHOOTFX.resetFx(); } }
  catch(e){ try{ const cv=$('fxCanvas'); if(cv){ const c=cv.getContext('2d'); c.clearRect(0,0,cv.width,cv.height); } }catch(_e){} }
  try{ document.querySelectorAll('.blood').forEach(el=>el.remove()); }catch(e){}
  const h=$('hurt'); if(h) h.classList.remove('on');
  const rf=$('redFlash'); if(rf) rf.style.opacity='0';
}
SHOOTFX.start();

