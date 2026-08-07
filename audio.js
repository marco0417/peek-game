function audio(){ if(!AC){ try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){} } if(AC&&AC.state==='suspended')AC.resume(); return AC; }
/* iOS/WebKit 自动播放策略：必须在首次用户手势内解锁 AudioContext。
   初始化时 showIntro() 在页面加载即跑（不在手势内），AC 会被 iOS 永久挂起 → 全程无声音。
   这里加全局「触碰唤醒」：首个 touchstart/click/pointerdown 内 resume 已创建的 AC，
   并播放 1 帧静音缓冲真正打通 iOS 音频渲染通道（仅 resume 在部分 iOS 上不够）。 */
let _audioUnlocked=false;
function unlockAudio(){
  if(_audioUnlocked) return; _audioUnlocked=true;
  const ac=audio(); if(!ac) return;
  if(ac.state==='suspended'){ try{ ac.resume(); }catch(e){} }
  try{ const buf=ac.createBuffer(1,1,ac.sampleRate); const src=ac.createBufferSource(); src.buffer=buf; src.connect(ac.destination); src.start(0); }catch(e){}
  ['touchstart','click','pointerdown'].forEach(ev=>window.removeEventListener(ev, unlockAudio, {capture:true}));
}
['touchstart','click','pointerdown'].forEach(ev=>window.addEventListener(ev, unlockAudio, {capture:true, passive:true}));
function sfxShot(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime, dur=0.22;
  // 噪声主体（枪口爆破）
  const buf=ac.createBuffer(1,Math.floor(ac.sampleRate*dur),ac.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,1.6);
  const src=ac.createBufferSource(); src.buffer=buf;
  const hp=ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.setValueAtTime(180,t);
  const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(2600,t); lp.frequency.exponentialRampToValueAtTime(280,t+dur);
  const g=ac.createGain(); g.gain.setValueAtTime(0.85,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ac.destination); src.start(t);
  // 尖锐瞬态（火药 snap）
  const cbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.04),ac.sampleRate), cd=cbuf.getChannelData(0);
  for(let i=0;i<cd.length;i++) cd[i]=(Math.random()*2-1)*(1-i/cd.length);
  const cs=ac.createBufferSource(); cs.buffer=cbuf;
  const clp=ac.createBiquadFilter(); clp.type='bandpass'; clp.frequency.value=3200; clp.Q.value=0.7;
  const cg=ac.createGain(); cg.gain.setValueAtTime(0.5,t); cg.gain.exponentialRampToValueAtTime(0.001,t+0.04);
  cs.connect(clp); clp.connect(cg); cg.connect(ac.destination); cs.start(t);
  // 低频冲击（身子一震）
  const o=ac.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(42,t+0.18);
  const og=ac.createGain(); og.gain.setValueAtTime(0.6,t); og.gain.exponentialRampToValueAtTime(0.001,t+0.2);
  o.connect(og); og.connect(ac.destination); o.start(t); o.stop(t+0.22);
}
function sfxHeart(v=1){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  const th=(at,f,vol)=>{ const o=ac.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(f,at); o.frequency.exponentialRampToValueAtTime(f*0.5,at+0.12); const g=ac.createGain(); g.gain.setValueAtTime(vol,at); g.gain.exponentialRampToValueAtTime(0.001,at+0.13); o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at+0.14); };
  th(t,60,0.45*v); th(t+0.14,50,0.28*v);
}
function sfxClick(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  const o=ac.createOscillator(); o.type='square'; o.frequency.setValueAtTime(900,t); o.frequency.exponentialRampToValueAtTime(1800,t+0.05);
  const g=ac.createGain(); g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.08);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+0.09);
}
function sfxSpin(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime, dur=0.85;
  // 转轮刮擦
  const buf=ac.createBuffer(1,Math.floor(ac.sampleRate*dur),ac.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length)*0.5;
  const src=ac.createBufferSource(); src.buffer=buf;
  const bp=ac.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(900,t); bp.frequency.linearRampToValueAtTime(1700,t+dur*0.7); bp.Q.value=1.2;
  const g=ac.createGain(); g.gain.setValueAtTime(0.18,t); g.gain.linearRampToValueAtTime(0.05,t+dur);
  src.connect(bp); bp.connect(g); g.connect(ac.destination); src.start(t); src.stop(t+dur);
  // 两声金属锁止咔哒
  [dur-0.06, dur+0.02].forEach((off,i)=>{
    const o=ac.createOscillator(); o.type='square'; o.frequency.setValueAtTime(i?2400:1600,t+off); o.frequency.exponentialRampToValueAtTime(i?500:300,t+off+0.05);
    const og=ac.createGain(); og.gain.setValueAtTime(0.16,t+off); og.gain.exponentialRampToValueAtTime(0.001,t+off+0.07);
    o.connect(og); og.connect(ac.destination); o.start(t+off); o.stop(t+off+0.08);
  });
}
function sfxHurt(who){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime, dur=0.32;
  const f1=who==='player'?540:170, f2=who==='player'?200:55;
  const o=ac.createOscillator(); o.type='sawtooth'; o.frequency.setValueAtTime(f1,t); o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  const g=ac.createGain(); g.gain.setValueAtTime(who==='player'?0.34:0.28,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  // 痛呼声叠加一点噪声
  const buf=ac.createBuffer(1,Math.floor(ac.sampleRate*dur),ac.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length)*0.5;
  const src=ac.createBufferSource(); src.buffer=buf;
  const ng=ac.createGain(); ng.gain.setValueAtTime(0.12,t); ng.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g); src.connect(ng); g.connect(ac.destination); ng.connect(ac.destination);
  o.start(t); o.stop(t+dur); src.start(t);
}
function stopBGM(){
  if(!BGM||!BGM.master)return;
  const ac=audio(); if(!ac){BGM=null;return;}
  const t=ac.currentTime;
  BGM.master.gain.setTargetAtTime(0,t,0.25);
  setTimeout(()=>{
    if(!BGM)return;
    BGM.nodes.forEach(n=>{ try{ n.o.stop(); n.o.disconnect(); if(n.g)n.g.disconnect(); }catch(e){} });
    try{ BGM.master.disconnect(); BGM.tg.disconnect(); }catch(e){}
    BGM=null;
  },420);
}
function startBGM(mode='game', zodiacIdx=0){
  // v2.7.64：BGM 已整体移除。Peek 现在只保留程序化音效（SFX），不含任何背景音乐音轨。
  // 目的：① 彻底规避 Newgrounds 的 AI/算法音乐禁令（无音乐即无违规源）；② 符合「只留音效」的设计意图。
  // 说明：SFX（枪声/受伤/心跳/转轮等）是手写 Web Audio 振荡器合成，属正常游戏开发，
  // 既不是 AI 模型生成、也不是第三方采样，不在 Newgrounds 音乐版权审查范围内。
  // 所有 startBGM 调用点保留不动（安全 no-op），将来若重新加音乐只需复原本函数即可。
  return;
}
function setBgmMute(mute){
  bgmMuted=mute;
  if(BGM) applyTension(TENSION);
  const sb=$('setBgm');
  if(sb){ sb.textContent=mute?tr('🎵 关'):tr('🎵 开'); sb.classList.toggle('mute',mute); }
  try{ localStorage.setItem('peek_bgm_mute', mute?'1':'0'); }catch(e){}
}
function setSfxMute(mute){
  sfxMuted=mute;
  const sb=$('setSfx');
  if(sb){ sb.textContent=mute?tr('🔇 关'):tr('🔊 开'); sb.classList.toggle('mute',mute); }
  try{ localStorage.setItem('peek_sfx_mute', mute?'1':'0'); }catch(e){}
}
function calcTension(){
  if(!S||S.over)return 0;
  const remTotal=S.chamber.length, remPos=remTotal-S.pos;
  const remRatio=remPos/remTotal;               // 弹仓越空越紧张
  const hpDiff=(S.php-S.dhp)/4;                 // 落后(负数)更紧张
  let tn=(1-remRatio)*0.4 + (0.5-S.php/8)*0.4 + (S.turn==='player'?0.1:0.05) + Math.max(0,-hpDiff)*0.2;
  return Math.max(0,Math.min(1,tn));
}
function applyTension(tn){
  TENSION=tn;
  heartInterval=720-tn*470;                      // 心跳 720ms→250ms 随紧张提速
  if(!BGM||!BGM.master)return;
  const ac=audio();
  BGM.tg.gain.setTargetAtTime(bgmMuted?0:0.7+tn*0.5, ac.currentTime, 0.3);
  if(BGM.discG) BGM.discG.gain.setTargetAtTime(bgmMuted?0:tn*tn*0.05, ac.currentTime, 0.3); // 紧张时刺耳层渐入
  if(BGM.lfo) BGM.lfo.frequency.setTargetAtTime(0.08+tn*0.22, ac.currentTime, 0.3);          // 呼吸加快
}
function sfxDeath(who){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime, dur=who==='player'?1.1:1.5;
  const f=who==='player'?320:70;
  const o=ac.createOscillator(); o.type=who==='player'?'sawtooth':'triangle'; o.frequency.setValueAtTime(f,t); o.frequency.exponentialRampToValueAtTime(f*0.2,t+dur);
  const g=ac.createGain(); g.gain.setValueAtTime(who==='player'?0.3:0.35,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  const buf=ac.createBuffer(1,Math.floor(ac.sampleRate*dur),ac.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length)*0.3;
  const src=ac.createBufferSource(); src.buffer=buf;
  const ng=ac.createGain(); ng.gain.setValueAtTime(0.16,t); ng.gain.exponentialRampToValueAtTime(0.001,t+dur);
  // 低通让死亡声更沉
  const lp=ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(who==='player'?1200:500,t); lp.frequency.exponentialRampToValueAtTime(200,t+dur);
  o.connect(g); g.connect(lp); lp.connect(ac.destination);
  src.connect(ng); ng.connect(lp);
  o.start(t); o.stop(t+dur); src.start(t);
}
function sfxDealerLaugh(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  // 三声低沉阴险的"哈"，模拟幸灾乐祸
  [0,230,460].forEach((off,i)=>{
    const f0=150+Math.random()*30, f1=100+Math.random()*25;
    const o=ac.createOscillator(); o.type='triangle'; o.frequency.setValueAtTime(f0,t+off/1000); o.frequency.exponentialRampToValueAtTime(f1,t+off/1000+0.18);
    const g=ac.createGain(); g.gain.setValueAtTime(0,t+off/1000); g.gain.linearRampToValueAtTime(0.24,t+off/1000+0.04); g.gain.exponentialRampToValueAtTime(0.001,t+off/1000+0.24);
    o.connect(g); g.connect(ac.destination); o.start(t+off/1000); o.stop(t+off/1000+0.32);
  });
}
/* ===== 关键 stinger（觉醒 / 加码 / 假结局惊吓 / 胜利）—— 程序化合成，零资源、免费 ===== */
function sfxAwaken(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  // 三音上行 + 泛音，像"眼睛睁开"
  [523.25, 659.25, 783.99].forEach((f,i)=>{
    const at=t+i*0.09;
    const o=ac.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(f,at); o.frequency.exponentialRampToValueAtTime(f*1.5,at+0.5);
    const g=ac.createGain(); g.gain.setValueAtTime(0,at); g.gain.linearRampToValueAtTime(0.22,at+0.03); g.gain.exponentialRampToValueAtTime(0.001,at+0.6);
    o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at+0.65);
    const o2=ac.createOscillator(); o2.type='triangle'; o2.frequency.setValueAtTime(f*2,at); o2.frequency.exponentialRampToValueAtTime(f*3,at+0.5);
    const g2=ac.createGain(); g2.gain.setValueAtTime(0,at); g2.gain.linearRampToValueAtTime(0.08,at+0.03); g2.gain.exponentialRampToValueAtTime(0.001,at+0.5);
    o2.connect(g2); g2.connect(ac.destination); o2.start(at); o2.stop(at+0.55);
  });
}
function sfxRaise(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  // 下行小调跳进 + 金属泛音，挑逗/危险
  [[440,0],[415.30,0.08],[349.23,0.16]].forEach(([f,off])=>{
    const at=t+off;
    const o=ac.createOscillator(); o.type='sawtooth'; o.frequency.setValueAtTime(f,at); o.frequency.exponentialRampToValueAtTime(f*0.98,at+0.18);
    const f1=ac.createBiquadFilter(); f1.type='lowpass'; f1.frequency.value=2200;
    const g=ac.createGain(); g.gain.setValueAtTime(0,at); g.gain.linearRampToValueAtTime(0.18,at+0.02); g.gain.exponentialRampToValueAtTime(0.001,at+0.22);
    o.connect(f1); f1.connect(g); g.connect(ac.destination); o.start(at); o.stop(at+0.24);
  });
  const o2=ac.createOscillator(); o2.type='triangle'; o2.frequency.setValueAtTime(1318.51,t+0.26);
  const g2=ac.createGain(); g2.gain.setValueAtTime(0,t+0.26); g2.gain.linearRampToValueAtTime(0.12,t+0.28); g2.gain.exponentialRampToValueAtTime(0.001,t+0.5);
  o2.connect(g2); g2.connect(ac.destination); o2.start(t+0.26); o2.stop(t+0.52);
}
function sfxTwist(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  // 低频轰鸣
  const o=ac.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(90,t); o.frequency.exponentialRampToValueAtTime(38,t+0.9);
  const g=ac.createGain(); g.gain.setValueAtTime(0.5,t); g.gain.exponentialRampToValueAtTime(0.001,t+1.0);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+1.05);
  // 失谐高频尖叫（小丑揭面）
  const o2=ac.createOscillator(); o2.type='sawtooth'; o2.frequency.setValueAtTime(1760,t); o2.frequency.linearRampToValueAtTime(990,t+0.5);
  const o3=ac.createOscillator(); o3.type='sawtooth'; o3.frequency.setValueAtTime(1860,t); o3.frequency.linearRampToValueAtTime(1040,t+0.5);
  const g2=ac.createGain(); g2.gain.setValueAtTime(0.0,t); g2.gain.linearRampToValueAtTime(0.16,t+0.02); g2.gain.exponentialRampToValueAtTime(0.001,t+0.6);
  o2.connect(g2); o3.connect(g2); g2.connect(ac.destination); o2.start(t); o3.start(t); o2.stop(t+0.62); o3.stop(t+0.62);
  // 噪声爆破
  const nbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.3),ac.sampleRate), nd=nbuf.getChannelData(0);
  for(let i=0;i<nd.length;i++) nd[i]=(Math.random()*2-1)*(1-i/nd.length);
  const ns=ac.createBufferSource(); ns.buffer=nbuf;
  const ng=ac.createGain(); ng.gain.setValueAtTime(0.3,t); ng.gain.exponentialRampToValueAtTime(0.001,t+0.3);
  ns.connect(ng); ng.connect(ac.destination); ns.start(t);
}
function sfxVictory(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  // 大调上行琶音
  [523.25, 659.25, 783.99, 1046.50].forEach((f,i)=>{
    const at=t+i*0.11;
    const o=ac.createOscillator(); o.type='triangle'; o.frequency.setValueAtTime(f,at);
    const g=ac.createGain(); g.gain.setValueAtTime(0,at); g.gain.linearRampToValueAtTime(0.26,at+0.02); g.gain.exponentialRampToValueAtTime(0.001,at+0.5);
    o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at+0.55);
  });
  // 持续和弦尾音
  const at=t+0.44;
  [523.25,659.25,783.99].forEach(f=>{
    const o=ac.createOscillator(); o.type='sine'; o.frequency.value=f;
    const g=ac.createGain(); g.gain.setValueAtTime(0,at); g.gain.linearRampToValueAtTime(0.14,at+0.04); g.gain.exponentialRampToValueAtTime(0.001,at+0.9);
    o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at+0.95);
  });
}
/* ===== 环境音 / 持续心跳 / 黑屏 ===== */
function sfxDrip(){
  if(sfxMuted)return;
  const ac=audio(); if(!ac)return; const t=ac.currentTime;
  const f=820+Math.random()*620;
  const o=ac.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(f,t); o.frequency.exponentialRampToValueAtTime(f*0.4,t+0.13);
  const g=ac.createGain(); g.gain.setValueAtTime(0.0,t); g.gain.linearRampToValueAtTime(0.07,t+0.01); g.gain.exponentialRampToValueAtTime(0.001,t+0.16);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+0.18);
}
function blackout(){ const b=$('blackout'); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
function loopHeart(){
  if(!sfxMuted){
    sfxHeart(0.5);
    if(Math.random()<TENSION*0.35) setTimeout(sfxDrip, 200+Math.random()*500);
  }
  heartTimer=setTimeout(loopHeart, heartInterval);
}
function startHeart(){ if(heartTimer)return; loopHeart(); }
function stopHeart(){ clearTimeout(heartTimer); heartTimer=null; }
