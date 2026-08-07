// src/i18n.js — 轻量 i18n：中文(zh)为源语言；en/zh-TW/ja/ko/ru/es/fr/de 走 PEEK_STRINGS 查表；缺译回退中文。
// 用户可选「自动」：按浏览器语言智能匹配（zh-TW/zh-HK→繁中；zh-CN/zh-SG→简中；ja/ko/ru/es/fr/de→对应；其他→英文）。
// 多语言地基（v2.7.68）：新增 6 语。ja 已于 v2.7.71 全量翻译并纳入支持；ko/ru/es/fr/de 仍按「即将推出」灰色禁用。
let PEEK_LANG = 'zh';          // 实际生效语言
let PEEK_LANG_PREF = 'auto';   // 用户显式选择（auto + 9 语言）；auto 为后台默认，设置页不暴露
// 已全量翻译（支持）的语言：zh/zh-TW/en/ja。其余仅地基（生肖名）按「即将推出」灰色禁用。
const SUPPORTED_LANGS = ['zh', 'zh-TW', 'en', 'ja'];

// 自动作为后台默认：已支持语言直接用；未支持语言（ja/ko/ru/es/fr/de）回退到英文（已全量、国际通用）。
function resolveLang(pref) {
  const LANGS = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'ru', 'es', 'fr', 'de'];
  if (LANGS.includes(pref)) return SUPPORTED_LANGS.includes(pref) ? pref : 'en';
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (nav.startsWith('zh-TW') || nav.startsWith('zh-HK')) return SUPPORTED_LANGS.includes('zh-TW') ? 'zh-TW' : 'en';
  if (nav.startsWith('zh')) return 'zh';
  const navShort = nav.split('-')[0];
  const matched = ['ja', 'ko', 'ru', 'es', 'fr', 'de'].includes(navShort) ? navShort : 'en';
  return SUPPORTED_LANGS.includes(matched) ? matched : 'en';
}

try {
  PEEK_LANG_PREF = localStorage.getItem('peek_lang') || 'auto';
  PEEK_LANG = resolveLang(PEEK_LANG_PREF);
} catch (e) {}

// 稳定 key 本地化（方案 A）：文案抽到 src/locales/{zh-CN,en}.json，构建时内联为 PEEK_STRINGS。
// 查表顺序：当前语言 → 中文(回退) → key 本身。vars 做 {k} 插值，字面 \n 还原换行。
function t(key, vars) {
  if (key === undefined || key === null) return key;
  const S = (typeof PEEK_STRINGS !== 'undefined') ? PEEK_STRINGS : null;
  let out = key;
  if (S) {
    out = (S[PEEK_LANG] && S[PEEK_LANG][key] !== undefined) ? S[PEEK_LANG][key]
        : (S.zh && S.zh[key] !== undefined) ? S.zh[key] : key;
  }
  if (vars) for (const k in vars) out = String(out).split('{' + k + '}').join(vars[k]);
  if (typeof out === 'string') out = out.replace(/\\n/g, '\n');
  return out;
}

// 中文→英文 / 中文→繁体 查表已外置到 src/locales/{en,zh-TW}.json（构建时内联为 PEEK_STRINGS）。
// tr() 现在查 PEEK_STRINGS：当前语言 → 中文(zh) → key 本身；缺失即回退，绝不破坏中文体验。

// 实弹/空包 文案（随语言切换）
function liveTxt() { return tr('实弹'); }
function blankTxt() { return tr('空包'); }
// 加码赌题中的选择词翻译
const BET_WORD = { live:'实弹', blank:'空包', player:'打你', self:'打自己', yes:'会用道具', no:'不用道具', heal:'回血', hurt:'扣血', single:'单发情报', multi:'多项情报' };
function betChoice(p) { return tr(BET_WORD[p] || p); }

// 翻译：中文为源语言(key)；当前语言(PEEK_STRINGS[lang])查表 → 中文(zh)回退 → key 本身。
// 英文/繁体串都是「中文原文作 key」存在 locales json 里，缺失即回退简体中文，绝不破坏中文体验。
function tr(s, vars) {
  if (!s) return s;
  const S = (typeof PEEK_STRINGS !== 'undefined') ? PEEK_STRINGS : null;
  let out = s;
  if (S) {
    if (S[PEEK_LANG] && S[PEEK_LANG][s] !== undefined) out = S[PEEK_LANG][s];
    else if (S.zh && S.zh[s] !== undefined) out = S.zh[s];
  }
  if (vars) for (const k in vars) out = out.split('{' + k + '}').join(vars[k]);
  out = out.replace(/\\n/g, '\n');   // HTML data-i18n 属性里的字面 \n 还原为真换行
  return out;
}

function getLang() { return PEEK_LANG; }
function getLangPref() { return PEEK_LANG_PREF; }
function setLang(l) {
  const allowed = ['auto', 'zh', 'zh-TW', 'en', 'ja', 'ko', 'ru', 'es', 'fr', 'de'];
  PEEK_LANG_PREF = allowed.includes(l) ? l : 'auto';
  PEEK_LANG = resolveLang(PEEK_LANG_PREF);
  try { localStorage.setItem('peek_lang', PEEK_LANG_PREF); } catch (e) {}
}

// 应用静态文案：扫描 [data-i18n]，并补充少数多行/无属性文案
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.textContent = tr(el.getAttribute('data-i18n'));
  });
  // 语言按钮高亮：仅高亮「当前生效且已支持」的语言（PEEK_LANG）；未支持按钮为 disabled，不高亮。
  const langButtons = {
    'zh': 'setZh', 'zh-TW': 'setTw', 'en': 'setEn',
    'ja': 'setJa', 'ko': 'setKo', 'ru': 'setRu', 'es': 'setEs', 'fr': 'setFr', 'de': 'setDe'
  };
  for (const code in langButtons) {
    const el = document.getElementById(langButtons[code]);
    if (!el) continue;
    el.classList.toggle('active', PEEK_LANG === code && !el.disabled);
  }
  // 标记当前语言到 <body data-lang>，供 CSS 针对长语种（de/fr/es/ru）收缩字号、防溢出
  try { document.body.setAttribute('data-lang', PEEK_LANG); } catch (e) {}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyI18n);
else applyI18n();
