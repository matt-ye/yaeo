#!/usr/bin/env node
/**
 * seo-check.mjs — 靜態 SEO/AEO 檢核（零依賴，Node 18+）
 *
 * 掃描建置產物（dist/）或任何靜態 HTML 目錄，輸出 L1（技術基礎）與 L2（內容結構）
 * 的機械可判定項目。L3/L4 需人工判讀，見 SKILL.md。
 *
 * 用法：
 *   node seo-check.mjs --dir ./dist [--site https://example.com] [--json] [--fail-on error]
 *
 * 設計取捨：用正則而非 DOM 解析，因為不允許安裝依賴。
 * 代價是無法處理巢狀奇異結構；好處是「不執行 JS」——爬蟲看到什麼，這支就看到什麼。
 * 對 JS runtime 填字的頁面，本工具回報「空 heading」是正確行為，不是誤報。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── 參數 ────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const DIR = getArg('dir');
const SITE = (getArg('site') || '').replace(/\/$/, '');
const AS_JSON = hasFlag('json');
const FAIL_ON = getArg('fail-on', 'error');

if (!DIR || !existsSync(DIR)) {
  console.error('用法：node seo-check.mjs --dir ./dist [--site https://example.com] [--json]');
  process.exit(2);
}

// ── 門檻 ────────────────────────────────────────────────
// SERP 截斷看的是像素寬度不是字元數。CJK 字元約佔兩倍寬、但資訊密度也高，
// 所以中文為主的字串要用不同門檻——直接套英文門檻會把正常的中文描述誤判為過短。
// CJK 門檻放寬到 40／90：中文標題慣用「核心資訊｜系列名 · 站名」，
// 後綴被 SERP 截掉不影響理解。門檻設太嚴會把正常標題全報成警告，
// 那種噪音會讓人直接忽略整份報告——比漏報更糟。
const LIMITS_EN = { titleMax: 60, titleMin: 10, descMax: 160, descMin: 50 };
const LIMITS_CJK = { titleMax: 40, titleMin: 6, descMax: 90, descMin: 20 };
const MIN_INTERNAL_LINKS = 1; // 出站內部連結為 0 ＝ 孤島頁

const cjkRatio = (s) => (s.match(/[㐀-鿿豈-﫿]/g) || []).length / Math.max(s.length, 1);
const limitsFor = (s) => (cjkRatio(s) > 0.3 ? LIMITS_CJK : LIMITS_EN);

// ── 收集檔案 ────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

// ── 正則工具 ────────────────────────────────────────────
// 先去標籤再解 entity（順序反了會把 &lt;script&gt; 解成真標籤）。
// 不解 entity 就算長度會虛報——實測 `&amp;` 讓某頁 title 從 62 被算成 66 字元。
const decodeEntities = (s) =>
  s.replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0?39;/gi, "'")
    .replace(/&amp;/gi, '&'); // &amp; 必須最後解，否則 &amp;lt; 會被二次解碼
const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/[​ ]/g, ' ').trim();
/* 屬性取值：雙引號與單引號要分開處理。
   ⚠ 不能寫成 ["']([^"']*)["'] —— 那個字元類同時排除兩種引號，
   值裡只要有一個撇號（Matt's、it's）就會在那裡截斷，
   把 108 字元的 description 讀成 30 字元，觸發假的「過短」警告。 */
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2];
};
const metaContent = (html, key, prop = 'name') => {
  const re = new RegExp(`<meta[^>]*${prop}\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? attr(m[0], 'content') : null;
};

/**
 * 結構檢核前必須剝掉 <script>/<style>——否則 JS 樣板字串（`<div class="${x}-title">`）
 * 會被當成真實 DOM 抓進來。實測誤報來源，別拿掉這一步。
 * JSON-LD 另外處理，所以這裡連它一起剝沒關係。
 */
const stripScripts = (html) =>
  html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');

// ── 單頁檢核 ────────────────────────────────────────────
function auditPage(rawHtml, page) {
  const f = [];
  const add = (level, code, msg, hits = 1) => f.push({ level, code, page, msg, hits });
  // meta/JSON-LD 用原文；所有「結構」檢核用剝掉 script/style 的版本
  const html = rawHtml;
  const dom = stripScripts(rawHtml);

  // ---- L1 技術基礎 ----
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : null;
  if (!title) add('error', 'L1-TITLE-MISSING', '<title> 缺失或為空');
  else {
    /* SERP 從尾端截斷，所以真正該量的是「資訊核心」的長度——站名後綴被截掉
       不損失資訊。這條規則原本量含後綴的總長，卻在訊息裡寫「截掉站名後綴無妨」
       ——警告一件自己說沒關係的事。實測某站 18 個超標標題，**核心全部合格**，
       超標的清一色是後綴。那不是內容問題，是量錯了東西。

       判定後綴：最後一個分隔符之後、且長度 ≤ 24 的片段。上限是為了不把
       「主標 · 一句完整的副標」的副標當成後綴切掉。 */
    const SUFFIX_SEP = /\s*[·|｜]\s*/;
    const segs = title.split(SUFFIX_SEP);
    const tail = segs.length > 1 ? segs[segs.length - 1] : '';
    const core = tail && tail.length <= 24 ? segs.slice(0, -1).join(' · ') : title;

    /* 「太長」與「太短」要量不同的東西，因為截斷永遠發生在尾端：
         太長 → 後綴會被截掉  → 量核心（後綴超出無妨）
         太短 → 後綴會顯示出來 → 量全長（站名也是資訊，也有品牌價值）
       不這樣分的話，「關於作者 · 葉淨維 Matt Ye」的核心只有 4 字元，
       會被誤判成資訊量不足。 */
    if (core.length > limitsFor(core).titleMax) {
      add('warn', 'L1-TITLE-LONG', `<title> 的資訊核心 ${core.length} 字元 > ${limitsFor(core).titleMax}（全長 ${title.length}）——SERP 從尾端截斷，核心本身就過長表示會掉資訊`);
    } else if (title.length < limitsFor(title).titleMin) {
      add('warn', 'L1-TITLE-SHORT', `<title> 僅 ${title.length} 字元，資訊量可能不足`);
    }

    /* 站名重複：頁面自己的 title 帶了站名、版型又補一次後綴，就會出現
       「… — Matt Ye · 葉淨維 Matt Ye」。純浪費 SERP 的字元額度，而且長度
       檢查抓不到（各段分開看都不長）。

       用「包含」而不是「相等」比對：實際案例是「Matt Ye」與「葉淨維 Matt Ye」
       ——同一個名字的兩種寫法，字串不相等但語意重複。 */
    const segments = segs
      .flatMap((s) => s.split(/\s*[—–]\s*/))
      .map((s) => s.trim())
      .filter((s) => s.length >= 3);
    let dupe = null;
    for (let i = 0; i < segments.length && !dupe; i++) {
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        if (segments[j].includes(segments[i])) { dupe = segments[i]; break; }
      }
    }
    if (dupe) add('warn', 'L1-TITLE-REPEATED', `<title> 裡「${dupe}」重複出現——多半是頁面自己帶了站名、版型又加一次後綴`);
  }

  const desc = metaContent(html, 'description');
  if (!desc) add('error', 'L1-DESC-MISSING', 'meta description 缺失');
  else {
    const L = limitsFor(desc);
    if (desc.length > L.descMax) add('warn', 'L1-DESC-LONG', `meta description ${desc.length} 字元，超過 ${L.descMax}`);
    /* description 的作用是提高 SERP 點擊率——noindex 的頁面不會出現在 SERP，
       所以「說服力不足」對它不成立。降成 info，讓 warn 只留下真的該修的。 */
    else if (desc.length < L.descMin) {
      const noindexHere = /noindex/i.test(metaContent(html, 'robots') || '');
      add(noindexHere ? 'info' : 'warn', 'L1-DESC-SHORT', `meta description 僅 ${desc.length} 字元，說服力不足（決定 SERP 點擊率）${noindexHere ? '——本頁已 noindex，不會出現在 SERP' : ''}`);
    }
  }

  if (!/<link[^>]*rel\s*=\s*["']canonical["']/i.test(html)) add('warn', 'L1-CANONICAL-MISSING', '無 canonical');

  for (const [key, prop, code] of [
    ['og:title', 'property', 'L1-OG-TITLE'],
    ['og:description', 'property', 'L1-OG-DESC'],
    ['og:image', 'property', 'L1-OG-IMAGE'],
  ]) {
    if (!metaContent(html, key, prop)) add('warn', `${code}-MISSING`, `缺 ${key}`);
  }
  if (!metaContent(html, 'twitter:card')) add('info', 'L1-TWITTER-CARD-MISSING', '缺 twitter:card');
  /* 有 creator 沒有 site 是常見疏漏：creator 標作者、site 標網站帳號，
     X/Twitter 的卡片歸屬會少一半 */
  if (metaContent(html, 'twitter:creator') && !metaContent(html, 'twitter:site')) {
    add('info', 'L1-TWITTER-SITE-MISSING', '有 twitter:creator 但缺 twitter:site（兩者用途不同：作者 vs 網站帳號）');
  }

  const langM = html.match(/<html[^>]*>/i);
  const lang = langM ? attr(langM[0], 'lang') : null;
  if (!lang) add('warn', 'L1-LANG-MISSING', '<html> 無 lang 屬性');

  const robotsMeta = metaContent(html, 'robots');
  if (robotsMeta && /noindex/i.test(robotsMeta)) add('info', 'L1-NOINDEX', `此頁標記 noindex（${robotsMeta}）—— 確認是刻意的`);

  /* 快照資格是生成式 AI 功能的**前提**，不是加分項。Google 官方原文：
       "To be eligible to be shown in generative AI features on Google Search,
        a page must be indexed and eligible to be shown in Google Search with
        a snippet, fulfilling the Search technical requirements."
       — developers.google.com/search/docs/fundamentals/ai-optimization-guide

     這是這份檢核器裡少數「一個屬性直接決定能不能被 AI 引用」的地方，
     所以獨立成規則而不是併進 L1-NOINDEX——後果不一樣：noindex 是不進索引，
     nosnippet 是進了索引但 AI Overviews／AI Mode 用不了。

     已經 noindex 的頁不報：它本來就不會出現，再講一次 AI 看不到是廢話。 */
  if (robotsMeta && !/noindex/i.test(robotsMeta)) {
    const zeroSnippet = /\bmax-snippet\s*:\s*0\b/i.test(robotsMeta);
    if (/\bnosnippet\b/i.test(robotsMeta) || zeroSnippet) {
      add('warn', 'L3-AI-SNIPPET-BLOCKED',
        `meta robots 含 ${zeroSnippet ? 'max-snippet:0' : 'nosnippet'}（${robotsMeta}）——本頁雖然進得了索引，但不具快照資格，Google 官方明載這是生成式 AI 功能的前提。若非刻意（如付費牆），等於自願退出 AI Overviews／AI Mode`);
    }
  }
  /* 元素層級的 data-nosnippet 只擋部分內容，不影響整頁資格，所以只記錄。
     值得記錄是因為它常被套在正文容器上，作用範圍比作者以為的大。 */
  const dataNosnippet = (dom.match(/\bdata-nosnippet\b/gi) ?? []).length;
  if (dataNosnippet) {
    add('info', 'L3-AI-SNIPPET-PARTIAL', `有 ${dataNosnippet} 處 data-nosnippet——這些區塊不會被摘錄，確認沒有蓋到想被引用的正文`, dataNosnippet);
  }

  // ---- L2 內容結構 ----
  const headings = [...dom.matchAll(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map((m) => ({ tag: m[1].toLowerCase(), level: +m[1][1], inner: m[3], text: stripTags(m[3]) }));

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 0) add('error', 'L2-H1-MISSING', '沒有 h1');
  else if (h1s.length > 1) add('warn', 'L2-H1-MULTIPLE', `有 ${h1s.length} 個 h1`);

  // 空 heading —— 不執行 JS，所以 runtime 填字的頁面會（正確地）被抓出來
  const empties = headings.filter((h) => h.text === '');
  if (empties.length) {
    const tags = [...new Set(empties.map((h) => h.tag))].join('/');
    add('error', 'L2-HEADING-EMPTY', `空 heading（${tags}）—— 若靠 JS 填字，爬蟲看到的就是空的`, empties.length);
  }

  // 階層跳級（h2 之後直接 h4）
  const nonEmpty = headings.filter((h) => h.text !== '');
  for (let i = 1; i < nonEmpty.length; i++) {
    const jump = nonEmpty[i].level - nonEmpty[i - 1].level;
    if (jump > 1) {
      add('warn', 'L2-HEADING-SKIP', `階層跳級：${nonEmpty[i - 1].tag} → ${nonEmpty[i].tag}（「${nonEmpty[i].text.slice(0, 24)}」）`);
      break; // 一頁報一次就夠
    }
  }

  // 「p/div 冒充 heading」—— 視覺像標題、語意不是。這是本專案實際踩過的坑。
  // 只掃 dom（剝過 script），否則會抓到 JS 樣板字串。
  const titleish = [...dom.matchAll(/<(p|div|span)\b([^>]*class\s*=\s*["'][^"']*(heading|title)[^"']*["'][^>]*)>([\s\S]{0,200}?)<\/\1>/gi)]
    .map((m) => ({ tag: m[1].toLowerCase(), cls: attr(`<x ${m[2]}>`, 'class') || '', text: stripTags(m[4]) }))
    .filter((x) => x.text.length > 0 && x.text.length < 120);

  // 分兩級：class 明說「區塊/頁面標題」的是高信心（該修）；
  // 其他含 title 的多半是卡片/列表項標題，數量大但性質不同——混報會淹沒真正的問題。
  const SECTION_TITLE = /(^|[\s_-])(section|page|block|group|hero)[-_]?(heading|title)([\s_-]|$)|(^|\s)(heading|subheading)(\s|$)/i;
  const blockFake = titleish.filter((x) => x.tag !== 'span' && SECTION_TITLE.test(x.cls));
  const weakFake = titleish.filter((x) => !(x.tag !== 'span' && SECTION_TITLE.test(x.cls)));
  if (blockFake.length) {
    const cls = [...new Set(blockFake.map((x) => x.cls))].slice(0, 3).join('、');
    add('error', 'L2-FAKE-HEADING', `用 <p>/<div class="${cls}"> 當區塊標題（例：「${blockFake[0].text.slice(0, 26)}」）—— 改成 <h2>，class 與 CSS 都不必動`, blockFake.length);
  }
  if (weakFake.length) {
    const cls = [...new Set(weakFake.map((x) => x.cls))].slice(0, 2).join('、');
    add('info', 'L2-TITLE-NOT-HEADING', `卡片/列表標題不是 heading（class="${cls}" 等，例：「${weakFake[0].text.slice(0, 20)}」）—— 包進 <h3> 可讓清單對爬蟲有結構；量大時挑重要清單改即可`, weakFake.length);
  }

  // ---- 正文可見量：最重要也最常被漏掉的一項 ----
  // 結構檢核全過、但正文根本不在 HTML 裡，是 client-side fetch 網站的典型死角。
  // 判準組合拳：正文量少 ＋ 有「載入中」佔位 ＝ 高信心（單看字數會誤傷本來就短的頁）
  const chrome = /<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi;
  const bodyM = dom.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  /* mainDom 保留標籤（L1-LANG-CONTENT-MISMATCH 要逐個文字節點看），
     mainText 是它剝完標籤的版本。兩者都已去掉 nav/header/footer/aside。 */
  const mainDom = (bodyM ? bodyM[1] : dom).replace(chrome, '');
  const mainText = stripTags(mainDom);
  /* 佔位語要抓「構詞法」而不是「字串清單」。
     中文的載入提示是「動詞＋（受詞）＋中」：載入中／載入資料中／載入留言中／
     讀取設定中……列舉清單只能命中想得到的組合。實際踩過的雷是「載入留言中」
     ——中間插了受詞，「載入中」這個連續字串不存在，整條規則就靜默失效。

     `[^<]{0,6}` 的上限是刻意的：不設上限的話，「載入」和幾百字之後某個「中」
     字會被配成一次命中。用 [^<] 而不是 . 是為了不跨越標籤邊界。 */
  const LOADING_CJK = '(?:載入|讀取|載運|處理|同步|抓取)[^<]{0,6}中';
  const LOADING_EN = '(?:Loading|Fetching|Please wait)';
  const placeholders = [
    ...dom.matchAll(new RegExp(`>[^<]{0,20}(${LOADING_CJK}|${LOADING_EN})[.．…\\s]*[^<]{0,10}<`, 'gi')),
  ];
  /* noindex 的頁面不報成 error：它本來就不進索引，「爬蟲看不到內容」不構成問題。
     但仍然值得留一筆紀錄，讓「刻意 noindex」與「該修卻沒修」在報表上分得開
     ——把兩者混在同一個數字裡，就沒辦法用 error 歸零當驗收標準。 */
  const isNoindex = Boolean(robotsMeta && /noindex/i.test(robotsMeta));
  /* 這裡真的要用「組合拳」——只看佔位會把兩種完全不同的情況混為一談：
       ① 整頁是空殼，核心內容全靠 fetch      → 嚴重，爬蟲什麼都拿不到
       ② 正文完整，只有某一區動態載入（留言板、
          即時報價、需要登入的內容）           → 常見且往往是刻意的
     實際案例：一個紀念頁有 11,097 字元的生平、課程回饋與紀念文章都在 HTML 裡，
     只有留言板維持即時抓取（留言含個資，刻意不寫進版控）。那不該和空殼
     算同一級——把兩者混在一起，error 歸零就永遠做不到，這個指標也就失去意義。

     門檻沿用下方 thin-content 的同一組值，避免兩條規則各有一套標準。 */
  const clientThin = mainText.length < (cjkRatio(mainText) > 0.3 ? 150 : 300);
  if (placeholders.length && isNoindex) {
    add('info', 'L2-CLIENT-RENDERED-NOINDEX', `偵測到 ${placeholders.length} 處載入佔位，但本頁已 noindex——不影響索引，僅記錄`, placeholders.length);
  } else if (placeholders.length && clientThin) {
    add('error', 'L2-CLIENT-RENDERED', `偵測到 ${placeholders.length} 處「載入中」佔位，且正文僅 ${mainText.length} 字元——核心內容由瀏覽器端 fetch，**爬蟲與 LLM 完全看不到**。修法：改在 build 期抓取並寫進 HTML`, placeholders.length);
  } else if (placeholders.length) {
    add('warn', 'L2-CLIENT-RENDERED-PARTIAL', `偵測到 ${placeholders.length} 處載入佔位，但正文有 ${mainText.length} 字元——應為局部動態區塊（留言、即時資料等）。確認那一區的內容是否需要被搜尋引擎看到`, placeholders.length);
  }
  /* 空的模板佔位元素——比字數更直接的「內容由 JS 填」證據。
     實際踩到的案例：一頁有 44 個 data-i18n 元素全部是空的、正文只有 176 字元，
     卻剛好擦過中文 150 字的門檻，三條規則（載入佔位、字數、空 heading）
     只有空 heading 報了 8 處，完全反映不出「整頁對爬蟲是空的」。

     字數門檻的根本限制：176 字的空殼與 176 字的短文，在字數上完全一樣。
     要分辨這兩者，得看有沒有「等著被填、但還沒填」的坑。 */
  const TEMPLATE_ATTR = /\b(data-i18n(?:-html)?|data-bind|data-text|v-text|v-html|ng-bind)\s*=\s*["'][^"']*["']/i;
  const emptySlots = [...dom.matchAll(/<(\w+)\b([^>]*)>\s*<\/\1>/g)].filter((m) => TEMPLATE_ATTR.test(m[2]));
  /* 未被取代的樣板語法（{{ x }}）同樣代表渲染沒發生在 build 期 */
  const rawMustache = [...stripTags(dom).matchAll(/\{\{\s*[\w.$]+\s*\}\}/g)];
  if (emptySlots.length + rawMustache.length >= 5) {
    const detail = [
      emptySlots.length ? `${emptySlots.length} 個空的模板佔位元素` : '',
      rawMustache.length ? `${rawMustache.length} 處未取代的 {{ }}` : '',
    ].filter(Boolean).join('、');
    add(isNoindex ? 'info' : 'error', 'L2-TEMPLATE-NOT-RENDERED',
      `${detail}——內容由瀏覽器端填入，爬蟲拿到的是空殼。修法：在 build 期把資料渲染進 HTML，JS 仍可載入後重畫`,
      emptySlots.length + rawMustache.length);
  }

  /* 門檻同樣要分中英：中文資訊密度高，240 字的中文是兩段完整內容，
     套英文的 300 字元門檻會誤判為「內容過少」。 */
  const thinLimit = cjkRatio(mainText) > 0.3 ? 150 : 300;
  if (mainText.length < thinLimit) {
    add(placeholders.length ? 'info' : 'warn', 'L2-THIN-CONTENT', `扣掉 nav/header/footer 後正文僅 ${mainText.length} 字元${placeholders.length ? '（已由 L2-CLIENT-RENDERED 說明原因）' : ''}`);
  }

  /* 雙語同頁的黏連字串：中文緊接英文，爬蟲會讀成一團。
     只數這一個數字的問題是**它把兩種修法完全不同的狀況混在一起**：

       ① <x lang="zh-TW">頁</x><y lang="en">Home</y>
          相鄰、兩邊都宣告語言、而且語言不同 → 同一份內容的兩個版本同時在 DOM 裡。
          這是**架構問題**，根治要改成獨立語言 URL。

       ② <span lang="zh-TW">未翻譯的標題</span><time>Jul 5, 2026</time>
          只有一邊宣告語言 → 英文頁上還沒翻譯的內容退回中文。
          這是**內容進度**，翻完自然消失，不需要改架構。

     實測一個做到一半的 i18n 網站：英文列表頁被報 27 處，全部是 ②；
     而同站 36 個未遷移頁的是 ①。同一個數字、兩種完全不同的待辦。

     ⚠ 判準**不能靠標記**。試過兩種都不行：
       · 「有沒有 lang 屬性」——常見雙語元件（如 T.astro）兩半都帶 lang，
         會把 ① 這種真正該修的一起消掉
       · 「兩邊都宣告且語言不同」——漏掉用 class="zh-only"／"en-only"
         而不帶 lang 的手刻頁，那些也是 ①

     可靠的訊號是**內容本身**：相鄰兩個元素，前者主要是中日韓、後者主要是拉丁
     ——那就是同一份內容的兩個語言版本並排。與標記方式完全無關。 */
  /* 圖示字型的 ligature 名稱會被當成正文讀走。
     Material Symbols／Material Icons 這類字型，**圖示名就是元素的文字內容**——
     Google 官方文件逐字寫著「你在 HTML 裡寫 arrow_forward」，瀏覽器再把它
     替換成圖示向量。也就是說任何做文字抽取的一方（爬蟲、LLM、螢幕閱讀器）
     讀到的都是 arrow_back、dark_mode 這些字。

     實測一個用了 18 個圖示的頁面：正文抽取的**開頭第一句**是
     「arrow_back One More Step AW#32 創投現場 translate EN dark_mode…」
     ——LLM 讀這頁時最先看到的就是這串雜訊。

     ⚠ 這與「字型有沒有載入」無關。字型沒載入是人眼看到英文單字（視覺問題）；
     這條講的是**不管字型載不載入，那些字都在 HTML 裡**（抽取問題）。
     兩者常被混為一談，但只有後者關 SEO／AEO 的事。

     補救是給裝飾性圖示加 aria-hidden="true"，讓輔助技術與抽取器跳過。
     ⚠ **這是從業共識，沒有官方出處**——Google Fonts 的文件只講機制不講無障礙，
     W3C WAI 的裝飾圖片指引講的是 <img> 的空 alt，沒有涵蓋 ligature。
     所以只報 info，且訊息裡標明證據等級。 */
  const iconEls = [...dom.matchAll(
    /<(\w+)\b([^>]*\bclass="[^"]*\bmaterial-(?:symbols|icons)[\w-]*[^"]*"[^>]*)>([^<]{2,40})<\/\1>/gi,
  )];
  const exposed = iconEls.filter((m) => !/\baria-hidden\s*=\s*["']true["']/i.test(m[2]));
  if (exposed.length) {
    add('info', 'L2-ICON-LIGATURE-TEXT',
      `${exposed.length}／${iconEls.length} 個圖示字型元素沒有 aria-hidden（例：「${exposed[0][3].trim()}」）——ligature 的圖示名就是元素的文字內容，會被爬蟲與 LLM 當成正文讀走。補救（aria-hidden="true"）屬從業共識，無官方出處`,
      exposed.length);
  }

  const concat = [...stripTags(dom).matchAll(/[㐀-鿿][A-Z][a-z]{2,}/g)];
  if (concat.length >= 3) {
    const cjkN = (s) => (s.match(/[㐀-鿿]/g) ?? []).length;
    const latN = (s) => (s.match(/[A-Za-z]/g) ?? []).length;
    const dualPairs = [...dom.matchAll(
      /<(\w+)\b[^>]*>([^<]{2,})<\/\1>\s*<(\w+)\b[^>]*>([^<]{2,})<\/\3>/g,
    )].filter((m) => cjkN(m[2]) > latN(m[2]) && latN(m[4]) > cjkN(m[4])).length;

    const kind = dualPairs === 0
      ? '——**沒有偵測到雙語並存的元素對**，多半是英文頁上還沒翻譯的內容退回中文；翻完就會消失，不必改架構'
      : `——其中偵測到 ${dualPairs} 組雙語並存的元素對（同一份內容的中英兩版同時在 DOM 裡），根治要改成獨立語言 URL`;
    add('info', 'L2-BILINGUAL-CONCAT', `${concat.length} 處中英黏連（例：「${concat[0][0]}…」）${kind}`, concat.length);
  }

  /* 宣告的語言與正文實際的語言不符。
     `L1-LANG-MISSING` 只問「有沒有宣告」，`SITE-LANG-INCONSISTENT` 只比對
     「同一語言有沒有多種寫法」——兩條都不看正文。所以一個 <html lang="en">
     卻滿頁中文的頁面，先前整份報告一個字都不會說。

     實際案例：i18n 遷移時，下拉選單的選項用 data-* 屬性存兩種語言、靠執行期
     JS 抽換，build 產物裡的文字仍然是中文。使用者看到的是對的（腳本會換），
     爬蟲拿到的是一個宣告英文卻塞滿中文選項的頁面。**不看正文就永遠報不出來。**

     ⚠ 判準必須不對稱，這是這條規則最重要的設計決定：
       · 宣告拉丁語系（en…）卻出現整塊中日韓文字 → 幾乎不會是巧合，可以報
       · 宣告中日韓卻出現整塊拉丁字母 → **不能報**。中文頁出現品牌名、程式碼、
         縮寫是常態（「用 React 寫」「canonical 源頭」），反向套用會整批誤判

     所以下面兩個方向分開處理，而不是用同一個對稱的比例門檻。
     這與 title/description 門檻分中英兩套是同一個理由：**中文與英文的基準
     本來就不對稱，用同一把尺量會錯。** */
  if (lang && mainText.length >= 80) {
    const primary = lang.toLowerCase().split('-')[0];
    const declaredIsCJK = ['zh', 'ja', 'ko'].includes(primary);
    const cjkN2 = (mainText.match(/[㐀-鿿]/g) ?? []).length;
    const latN2 = (mainText.match(/[A-Za-z]/g) ?? []).length;

    if (!declaredIsCJK && cjkN2 > latN2) {
      /* 整頁層級：宣告拉丁語系，中日韓字元卻比拉丁字母還多。
         這不是零星未翻譯，是宣告錯了或整頁根本沒翻。 */
      add('warn', 'L1-LANG-CONTENT-MISMATCH',
        `<html lang="${lang}"> 但正文的中日韓字元（${cjkN2}）多於拉丁字母（${latN2}）——宣告的語言與實際內容不符`);
    } else if (!declaredIsCJK) {
      /* 整頁沒問題，但可能有零星沒跟著換語言的東西。
         只數「整塊都是中日韓」的文字節點——中英並列（「類型學 Typology」）不算，
         那本來就雙語。長度門檻 2 是為了略過語言切換鈕的「中」這種單字。

         ⚠ 這裡**不能只給一個總數**，那會犯下與 L2-BILINGUAL-CONCAT 同樣的錯：
         把兩種修法完全不同的狀況混在一起。實測一個雙語站的英文演講列表頁，
         純中日韓的節點有 167 個，但依包住它的標籤拆開之後：

           <a>      163 個  晶盛科技股份有限公司、東吳大學英文學系 → **專有名詞，不該翻**
           <option>   4 個  日期（最新）、人次（最多）             → **介面沒跟著換語言，該修**

         所以只報介面元件。內容區塊的中日韓文字絕大多數是機構名、人名、活動名，
         報出來會是 163 比 4 的雜訊——而**噪音比漏報更危險**：
         一份充滿「其實不用改」的報告，讀者會連真的那 4 個一起忽略。
         整頁層級真的不對勁的情況，上面那條 warn 已經涵蓋。 */
      const UI_TAGS = new Set(['option', 'button', 'label', 'th', 'summary', 'legend', 'optgroup']);
      const uiForeign = [...mainDom.matchAll(/<(\w+)\b[^>]*>([^<]{2,})</g)]
        .map((m) => ({ tag: m[1].toLowerCase(), text: decodeEntities(m[2]).trim() }))
        .filter((n) => UI_TAGS.has(n.tag) && n.text.length >= 2
          && /[㐀-鿿]/.test(n.text) && !/[A-Za-z]/.test(n.text));
      if (uiForeign.length) {
        add('info', 'L1-LANG-CONTENT-MISMATCH',
          `${uiForeign.length} 個介面元件是純中日韓文字，但本頁宣告 lang="${lang}"`
          + `（例：<${uiForeign[0].tag}>「${uiForeign[0].text.slice(0, 20)}」）`
          + '——介面文字沒有跟著網址換語言。內容裡的專有名詞不算在內',
          uiForeign.length);
      }
    } else if (cjkN2 < 10 && latN2 > 200) {
      /* 宣告中日韓、正文卻幾乎沒有中日韓字元。只在這種極端情況報，
         理由見上面的不對稱說明——這個方向的誤判成本高得多。 */
      add('warn', 'L1-LANG-CONTENT-MISMATCH',
        `<html lang="${lang}"> 但正文只有 ${cjkN2} 個中日韓字元（拉丁字母 ${latN2}）——宣告的語言與實際內容不符`);
    }
  }

  // 圖片 alt
  const imgs = [...dom.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => attr(t, 'alt') === null);
  const emptyAlt = imgs.filter((t) => attr(t, 'alt') === '');
  if (noAlt.length) add('error', 'L2-IMG-ALT-MISSING', `${noAlt.length}/${imgs.length} 張圖片沒有 alt 屬性`, noAlt.length);
  if (emptyAlt.length) add('info', 'L2-IMG-ALT-EMPTY', `${emptyAlt.length} 張 alt=""（僅裝飾性圖片才該如此）`, emptyAlt.length);

  // 內部連結（導流）
  const hrefs = [...dom.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const internal = hrefs.filter((h) => {
    if (h.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(h)) return false;
    if (h.startsWith('/')) return true;                       // 絕對路徑
    if (/^https?:\/\//i.test(h)) return SITE && h.startsWith(SITE); // 完整網址：比對站台
    if (/^\/\//.test(h)) return false;                        // protocol-relative 外連
    return true;                                              // 其餘視為相對路徑（../x/、x.html）
  });
  const uniqueInternal = new Set(internal.map((h) => h.split('#')[0].replace(/\/$/, '')));
  if (uniqueInternal.size < MIN_INTERNAL_LINKS) {
    add('error', 'L2-NO-INTERNAL-LINKS', '沒有任何出站內部連結（孤島頁）—— 讀者與爬蟲都走不到下一頁');
  } else if (uniqueInternal.size < 3) {
    add('info', 'L2-FEW-INTERNAL-LINKS', `僅 ${uniqueInternal.size} 個不重複內部連結`);
  }

  // JSON-LD
  const ldBlocks = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set();
  let hasDatePublished = false;
  let hasDateModified = false;
  let hasAuthor = false;
  let futureDate = null;
  const TODAY = new Date().toISOString().slice(0, 10);
  for (const b of ldBlocks) {
    try {
      const parsed = JSON.parse(b[1].trim());
      const nodes = [];
      const collect = (n) => {
        if (Array.isArray(n)) n.forEach(collect);
        else if (n && typeof n === 'object') {
          nodes.push(n);
          if (n['@graph']) collect(n['@graph']);
        }
      };
      collect(parsed);
      for (const n of nodes) {
        if (n['@type']) [].concat(n['@type']).forEach((t) => types.add(t));
        if (n.datePublished) {
          hasDatePublished = true;
          /* 未來的發佈日等於宣告「這頁還沒發佈」——但頁面明明已經在 dist 裡。
             這種矛盾的時間訊號會讓搜尋引擎不信任整站的日期。 */
          const d = String(n.datePublished).slice(0, 10);
          if (d > TODAY) futureDate = d;
        }
        if (n.dateModified) hasDateModified = true;
        if (n.author) hasAuthor = true;
      }
    } catch {
      add('error', 'L2-JSONLD-INVALID', 'JSON-LD 區塊解析失敗（語法錯誤）');
    }
  }
  if (ldBlocks.length === 0) add('warn', 'L2-JSONLD-MISSING', '沒有 JSON-LD 結構化資料');
  /* 首頁不需要麵包屑——它就是路徑的起點，「首頁 > 首頁」沒有意義，
     Google 的結構化資料文件也只把 BreadcrumbList 用在有上層路徑的頁面。
     語言前綴的首頁（/en/）同理。 */
  const isHome = /^(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?index\.html$/i.test(page);
  if (!types.has('BreadcrumbList') && !isHome) add('warn', 'L2-BREADCRUMB-MISSING', '缺 BreadcrumbList（路徑越深越該有）');
  const articleish = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle'].some((t) => types.has(t));
  if (articleish && !hasDatePublished) add('error', 'L2-ARTICLE-NO-DATE', 'Article 型 JSON-LD 缺 datePublished');
  /* 更新日期是新鮮度訊號。只有 datePublished 而沒有 dateModified，
     等於告訴搜尋引擎「這頁自發佈以來沒動過」——即使你其實一直在更新。
     ⚠ 判斷要看解析後的 JSON-LD 物件，不能用 /dateModified/.test(html)：
     那會把「正文剛好提到 dateModified 這個字」也算成有（寫 SEO 教學的站必踩）。 */
  if (articleish && hasDatePublished && !hasDateModified && !/article:modified_time/i.test(html)) {
    add('info', 'L2-NO-MODIFIED-DATE', '有 datePublished 但無 dateModified——更新過的內容看起來像從未更新');
  }
  /* 發佈日在未來 = 頁面已經上線卻宣稱還沒發佈。多半是把「排程日」當成發佈日。 */
  if (futureDate) {
    add('warn', 'L2-FUTURE-DATE', `datePublished 是未來日期（${futureDate}）——頁面已可存取卻宣稱尚未發佈，時間訊號矛盾`);
  }
  /* YMYL 的第一要件就是「誰寫的」。author 存不存在是純機械可判定的，
     不該全部丟給人工判讀（L4 的其餘條目才需要人看）。 */
  if (articleish && !hasAuthor) {
    add('warn', 'L2-ARTICLE-NO-AUTHOR', 'Article 型 JSON-LD 缺 author——YMYL 主題下「內容由誰撰寫」是評分的第一要件');
  }

  /* ── L3 頁層級：被生成式引擎引用的訊號 ──────────────────────────────
     L3 的站層級（SITE-AI-*／LLMSTXT／RSS）問的是「AI 拿不拿得到你的內容」；
     這一段問的是「拿到之後會不會被引用」。

     依據：Aggarwal et al., GEO: Generative Engine Optimization（KDD 2024）。
     論文實驗出的五項戰術裡，只有前三項是機械可偵測的：
       引用來源 / 統計數據 / 直接引言   → 這裡檢查
       權威語氣 / 流暢度                 → 語意判斷，交給人

     ⚠ 三件刻意的克制：
     ① 只報 info。論文說的是「加了會提升可見度」，不是「沒加就是錯」——
        把弱訊號寫成 error 正是本 skill 反對的做法。
     ② 不給目標數字。論文沒有提供閾值，我們也不編一個出來。
     ③ 只對 Article 型頁面檢查。列表頁、工具頁沒有引用來源是正常的，
        對它們報這條只會製造雜訊。

     ⚠ 2026-08 補記——證據強度要往下調。
     一篇回顧 45 篇研究（2023-11～2026-07）的批判性綜述指出，KDD 2024 那些
     被廣泛引用的增益「在其實驗設定內成立，但**以來源已經出現在固定脈絡中
     為前提**；既未證實自然可發現性，也未證實持久的流量效果」，而且
     「以被引用為目標的改寫**可能損害檢索表現**」。
     — arXiv 2607.14035《Optimizing Visibility in Generative Engines》

     也就是說：這三項訊號影響的是「已經被撈進來之後會不會被引用」，
     不是「會不會被撈進來」。原本的訊息寫「唯一有同行評審實驗支持的槓桿」
     說過頭了——有實驗支持是真的，但支持的範圍比那句話窄。
     克制的做法本來就對（info、不給數字），這次只調措辭，不改嚴重度。 */
  if (articleish) {
    const mainHtml = (bodyM ? bodyM[1] : dom).replace(chrome, '');
    const text = stripTags(mainHtml);

    /* 外部引用：連到別的網域才算。站內互連是導覽，不是引用。
       沒給 --site 時退化成「所有絕對網址都算外部」——會略微高估，
       但不給的情境本來就是單頁檢查，不影響整體判讀。 */
    let ownHost = '';
    try { ownHost = SITE ? new URL(SITE).hostname.replace(/^www\./, '') : ''; } catch { /* SITE 格式不對就當沒給 */ }
    const outbound = new Set(
      [...mainHtml.matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"/gi)]
        .map((m) => { try { return new URL(m[1]).hostname.replace(/^www\./, ''); } catch { return null; } })
        .filter((h) => h && h !== ownHost),
    );

    /* 統計數據：百分比、帶單位的數量、年份以外的多位數。
       刻意排除 4 位數年份——「2026 年」不是統計數據。 */
    const stats = [
      ...text.matchAll(/\d+(?:\.\d+)?\s*[%％]/g),
      ...text.matchAll(/\d{1,3}(?:,\d{3})+/g),
      ...text.matchAll(/(?<!\d)\d+(?:\.\d+)?\s*(?:倍|萬|億|兆|人|次|件|項|個月|年增|年減|bps|kg|km)/g),
    ].length;

    /* 直接引言：blockquote／q 標籤，或中文引號包住的較長句子
       （短的「」多半是強調用法，不是引言，所以要求 8 字以上） */
    const quotes =
      (mainHtml.match(/<(blockquote|q)\b/gi) || []).length +
      (text.match(/[「『][^」』]{8,}[」』]/g) || []).length;

    const missing = [
      outbound.size === 0 ? '外部引用' : null,
      stats === 0 ? '統計數據' : null,
      quotes === 0 ? '直接引言' : null,
    ].filter(Boolean);

    if (missing.length === 3) {
      add('info', 'L3-GEO-SIGNALS-NONE',
        `這頁沒有外部引用、統計數據與直接引言——這三項有實驗支持能提高「被撈到之後獲得引用」的機率（GEO, KDD 2024），但 2026 綜述指出該效果以來源已進入脈絡為前提，不等於提升被發現的機會`);
    } else if (missing.length) {
      add('info', 'L3-GEO-SIGNALS-THIN',
        `GEO 訊號偏少（缺${missing.join('、')}；現有 外部引用 ${outbound.size} 個、統計 ${stats} 處、引言 ${quotes} 處）`);
    }
  }

  // 語意標籤
  if (articleish && !/<article\b/i.test(dom)) add('info', 'L2-NO-ARTICLE-TAG', '標為 Article 但沒有 <article> 標籤');
  if (articleish && !/<time\b[^>]*datetime\s*=/i.test(dom)) add('info', 'L2-NO-TIME-TAG', '沒有帶 datetime 的 <time>（日期只是純文字）');

  return {
    findings: f,
    meta: {
      title, desc, lang, types: [...types],
      noindex: Boolean(robotsMeta && /noindex/i.test(robotsMeta)),
      internalHrefs: [...uniqueInternal],
    },
  };
}

/**
 * robots.txt 要以「群組」為單位解析：連續的 User-agent 行共用其後的規則，
 * 直到下一個 User-agent 群組開始。
 *
 * ⚠ 不要用「User-agent: X 附近有沒有 Disallow」這種模糊比對——
 * 那個「附近」會跨進下一個群組，把別人的 Disallow 算到 X 頭上。
 * （實測踩過：OAI-SearchBot 明明是 Allow，卻因為下一組有 Disallow 而誤報。）
 */
function parseRobots(text) {
  const groups = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      // 連續的 User-agent 行屬於同一組；出現過規則後再遇到就是新的一組
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if (cur) {
      cur.rules.push({ type: key, path: val });
    }
  }
  return groups;
}

/**
 * 某個 user-agent 是否被全站封鎖。
 *
 * 沒有專屬群組時要 fallback 到 `*` 群組——這正是「預設全擋＋白名單放行」
 * 寫法（`User-agent: * / Disallow: /` 再逐一 Allow）能不能被正確判讀的關鍵。
 * 少了這段，那種站會被誤報成「全部開放」。
 */
function isBlocked(groups, agent) {
  const own = groups.find((x) => x.agents.includes(agent.toLowerCase()));
  const g = own ?? groups.find((x) => x.agents.includes('*'));
  if (!g) return false;
  const disallowAll = g.rules.some((r) => r.type === 'disallow' && r.path === '/');
  const allowAll = g.rules.some((r) => r.type === 'allow' && r.path === '/');
  return disallowAll && !allowAll;
}

// ── 站層級檢核 ──────────────────────────────────────────
function auditSite(pages, root) {
  const f = [];
  const add = (level, code, msg, page = '(site)') => f.push({ level, code, page, msg });

  /* sitemap 與 noindex 互相矛盾：被 sitemap 邀請爬、又被 meta 擋下。
     常見於 build 流程忘了把草稿/儀表板頁排除，會浪費爬蟲預算並送出矛盾訊號。 */
  const sitemapFile = ['sitemap-0.xml', 'sitemap.xml', 'sitemap-index.xml']
    .map((n) => join(root, n)).find((p) => existsSync(p));
  if (sitemapFile) {
    const xml = readFileSync(sitemapFile, 'utf8');
    const listed = new Set([...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
      .map((m) => m[1].replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '')));
    const conflict = pages
      .filter((p) => p.meta.noindex)
      .map((p) => '/' + p.page.replace(/index\.html$/, '').replace(/\/$/, ''))
      .filter((path) => listed.has(path) || listed.has(path.replace(/\/$/, '')));
    if (conflict.length) {
      add('warn', 'SITE-SITEMAP-NOINDEX-CONFLICT', `${conflict.length} 個 noindex 頁面仍列在 sitemap 裡（${conflict.slice(0, 3).join('、')}）——等於邀請爬蟲來看一個叫它別看的頁`);
    }
  }

  /* 內部連結指向不存在的頁面。這裡只驗站內絕對路徑，外連交給專門的連結健檢。

     ⚠ 這條規則的第一版在採 clean URL 的靜態主機上會**全面誤判**。
     成因是「輸出檔名」與「使用者看到的網址」不是同一件事，而兩者的對應
     取決於主機：

       dist/gallery.html        Cloudflare Pages／Netlify／GitHub Pages
                                都讓 /gallery 直接到得了
       dist/gallery/index.html  /gallery/ 與 /gallery 都到得了

     第一版只認目錄形式，於是在 file 輸出的站上，每一條寫成 /gallery 的
     連結都會被報成死連結——一條 error 級規則整批誤判，比漏報更糟：
     使用者會開始不相信整份報告。

     改法是把方向倒過來。不要「猜連結該長什麼樣」，而是**先算出每個輸出檔
     實際到得了的所有網址形式**，再看連結有沒有命中其中之一。 */
  const resolvable = new Set();
  for (const { page } of pages) {
    const abs = '/' + page;                                   // /gallery.html｜/a/b/index.html
    resolvable.add(abs);
    if (abs.endsWith('/index.html')) {
      const dir = abs.slice(0, -'index.html'.length);         // /a/b/
      resolvable.add(dir);
      resolvable.add(dir.replace(/\/$/, '') || '/');          // /a/b（無尾斜線）
    } else if (abs.endsWith('.html')) {
      const bare = abs.slice(0, -'.html'.length);             // /gallery
      resolvable.add(bare);
      resolvable.add(bare + '/');                             // 有些主機會導向這個
    }
  }

  const dead = new Map();
  for (const { page, meta } of pages) {
    for (const href of meta.internalHrefs ?? []) {
      const clean = href.split('#')[0].split('?')[0];
      if (!clean.startsWith('/')) continue;              // 相對路徑無法在此可靠還原
      const bare = clean.replace(/\/+$/, '') || '/';
      const forms = [
        clean,
        bare,
        bare === '/' ? '/' : `${bare}/`,
        bare === '/' ? '/index.html' : `${bare}.html`,
        `${bare === '/' ? '' : bare}/index.html`,
      ];
      if (forms.some((f) => resolvable.has(f))) continue;
      /* 靜態檔（pdf、圖片等）。網址可能是百分比編碼而檔名不是——
         解碼失敗就退回原字串，不要讓一個壞掉的網址炸掉整份檢核。 */
      let fsPath = clean.replace(/^\//, '');
      try { fsPath = decodeURIComponent(fsPath); } catch { /* 保留原樣 */ }
      if (existsSync(join(root, fsPath))) continue;
      dead.set(clean, (dead.get(clean) ?? 0) + 1);
      if (!dead.__firstPage) dead.__firstPage = page;
    }
  }
  if (dead.size) {
    const sample = [...dead.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([h, n]) => `${h}（${n} 處）`).join('、');
    add('error', 'SITE-DEAD-INTERNAL-LINK', `${dead.size} 個站內連結指向 dist 裡不存在的路徑：${sample}`);
  }

  const byTitle = new Map();
  const byDesc = new Map();
  const langs = new Map();
  for (const { page, meta } of pages) {
    if (meta.title) byTitle.set(meta.title, [...(byTitle.get(meta.title) || []), page]);
    if (meta.desc) byDesc.set(meta.desc, [...(byDesc.get(meta.desc) || []), page]);
    if (meta.lang) langs.set(meta.lang, (langs.get(meta.lang) || 0) + 1);
  }
  for (const [t, ps] of byTitle) if (ps.length > 1) add('error', 'SITE-TITLE-DUP', `${ps.length} 頁共用同一個 <title>：「${t.slice(0, 40)}」→ ${ps.slice(0, 3).join(', ')}${ps.length > 3 ? ' …' : ''}`);
  for (const [d, ps] of byDesc) if (ps.length > 1) add('warn', 'SITE-DESC-DUP', `${ps.length} 頁共用同一段 description → ${ps.slice(0, 3).join(', ')}${ps.length > 3 ? ' …' : ''}`);
  /* 這條要抓的是「同一個語言的兩種寫法」（zh-TW vs zh-Hant），不是「網站有兩種語言」。
     多語網站本來就會有 zh-TW 與 en，那是正確狀態不是錯誤——原本的實作只看
     langs.size > 1，於是把「做對了 i18n」報成問題。

     判準改成：**主語言子標籤相同、完整標籤卻不同** → 不一致。
     zh-TW vs zh-Hant 命中；zh-TW vs en 不命中。 */
  const byPrimary = new Map();
  for (const [tag, n] of langs) {
    const primary = tag.toLowerCase().split('-')[0];
    if (!byPrimary.has(primary)) byPrimary.set(primary, new Map());
    byPrimary.get(primary).set(tag, n);
  }
  for (const [primary, variants] of byPrimary) {
    if (variants.size > 1) {
      add('warn', 'SITE-LANG-INCONSISTENT',
        `「${primary}」用了 ${variants.size} 種寫法：${[...variants].map(([k, v]) => `${k}(${v}頁)`).join('、')}——同一語言請統一成一個標籤`);
    }
  }

  // 站層級標準檔（L3 AEO 的機械可判定部分）
  if (!existsSync(join(root, 'robots.txt'))) add('error', 'SITE-ROBOTS-MISSING', '沒有 robots.txt');
  if (!existsSync(join(root, 'sitemap-index.xml')) && !existsSync(join(root, 'sitemap.xml'))) add('error', 'SITE-SITEMAP-MISSING', '沒有 sitemap');
  if (!existsSync(join(root, 'llms.txt'))) add('info', 'SITE-LLMSTXT-MISSING', '沒有 llms.txt（Google 明言不使用；成本低可放，但別期待排名效果）');
  const rssNames = ['rss.xml', 'feed.xml', 'atom.xml', 'index.xml'];
  if (!rssNames.some((n) => existsSync(join(root, n)))) add('warn', 'SITE-RSS-MISSING', '沒有 RSS feed');

  // robots.txt 的 AI 爬蟲分流（訓練蟲 vs 檢索蟲是兩件事）
  const robotsPath = join(root, 'robots.txt');
  if (existsSync(robotsPath)) {
    const robots = readFileSync(robotsPath, 'utf8');
    const groups = parseRobots(robots);

    /* 分類依各公司官方文件（查證 2026-08-12）。
       ⚠ Google-Extended 常被誤歸為檢索蟲——它其實是「訓練／grounding」控制，
         Google 官方明講它不影響搜尋收錄與排名，也不是 AI Overviews 的開關。 */
    const RETRIEVAL = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Applebot', 'meta-webindexer', 'Amzn-SearchBot'];
    const TRAINING = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'Amazonbot', 'Bytespider'];
    /* 使用者貼網址請 AI 讀取時觸發。OpenAI 與 Perplexity 官方都說這類「通常忽略
       robots.txt」，但 Anthropic 沒有這句——Claude-User 擋了是真的會被擋住。 */
    const USER_TRIGGERED = ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'Amzn-User', 'meta-externalfetcher'];

    const named = (b) => groups.some((g) => g.agents.includes(b.toLowerCase()));
    const blockedRetrieval = RETRIEVAL.filter((b) => isBlocked(groups, b));
    if (blockedRetrieval.length) {
      /* 分辨「明確點名擋掉」與「被 * 的預設規則掃到」——後者多半是無心的，
         提示要講清楚，否則使用者會找不到自己哪裡擋了它。 */
      const viaWildcard = blockedRetrieval.filter((b) => !named(b));
      const why = viaWildcard.length === blockedRetrieval.length
        ? '（不是逐一擋的，是 `User-agent: *` 的預設規則掃到——要放行得逐一寫 Allow）'
        : '';
      add('error', 'SITE-AI-RETRIEVAL-BLOCKED', `robots.txt 擋掉檢索型爬蟲 ${blockedRetrieval.join('、')}${why}——AI 引擎將無法引用本站，與「擋訓練」是兩回事`);
    }
    const blockedUser = USER_TRIGGERED.filter((b) => isBlocked(groups, b));
    /* 與 RETRIEVAL-BLOCKED 同為 error：後果一樣確定——Anthropic 是三家中
       唯一會遵守此規則的，擋了就是真的讀不到，不是「可能有影響」。 */
    if (blockedUser.includes('Claude-User')) {
      add('error', 'SITE-CLAUDE-USER-BLOCKED', 'robots.txt 擋掉 Claude-User——Anthropic 是唯一會遵守此規則的，擋了會讓使用者貼本站網址請 Claude 讀取時真的失敗');
    }

    const mentioned = [...RETRIEVAL, ...TRAINING].some((b) => named(b));
    /* 只有在「沒點名、也沒被 * 擋到」時才提示表態——
       若已經被 * 擋掉，上面的 RETRIEVAL-BLOCKED 才是該看的訊息，
       兩條同時出現會自相矛盾（一條說沒表態、一條說擋掉了）。 */
    if (!mentioned && !blockedRetrieval.length) {
      add('info', 'SITE-AI-CRAWLER-UNSPECIFIED', 'robots.txt 未對任何 AI 爬蟲表態——「不進訓練」與「能被引用」可以分開設定');
    } else if (mentioned) {
      const blockedTraining = TRAINING.filter((b) => isBlocked(groups, b));
      add('info', 'SITE-AI-POLICY', `AI 爬蟲政策：擋訓練 ${blockedTraining.length}／${TRAINING.length}，開放檢索 ${RETRIEVAL.length - blockedRetrieval.length}／${RETRIEVAL.length}`);
    }
  }
  return f;
}

// ── 執行 ────────────────────────────────────────────────
const htmlFiles = walk(DIR);
if (!htmlFiles.length) {
  console.error(`在 ${DIR} 找不到任何 .html —— 是不是還沒 build？`);
  process.exit(2);
}

const pageResults = [];
let allFindings = [];
for (const file of htmlFiles) {
  const rel = relative(DIR, file).replace(/\\/g, '/');
  const html = readFileSync(file, 'utf8');
  const { findings, meta } = auditPage(html, rel);
  pageResults.push({ page: rel, meta });
  allFindings = allFindings.concat(findings);
}
allFindings = allFindings.concat(auditSite(pageResults, DIR));

// ── 輸出 ────────────────────────────────────────────────
const rank = { error: 0, warn: 1, info: 2 };
allFindings.sort((a, b) => rank[a.level] - rank[b.level] || a.code.localeCompare(b.code) || a.page.localeCompare(b.page));
const counts = { error: 0, warn: 0, info: 0 };
allFindings.forEach((f) => counts[f.level]++);

if (AS_JSON) {
  console.log(JSON.stringify({ scanned: htmlFiles.length, counts, findings: allFindings }, null, 2));
} else {
  console.log(`\nSEO/AEO 檢核：${htmlFiles.length} 頁　${counts.error} error / ${counts.warn} warn / ${counts.info} info\n`);
  const byCode = new Map();
  for (const f of allFindings) byCode.set(f.code, [...(byCode.get(f.code) || []), f]);
  for (const [code, list] of byCode) {
    const icon = { error: '✗', warn: '!', info: '·' }[list[0].level];
    const totalHits = list.reduce((s, x) => s + (x.hits || 1), 0);
    const scope = list[0].page === '(site)' ? '站層級'
      : totalHits > list.length ? `${list.length} 頁，共 ${totalHits} 處`
      : `${list.length} 頁`;
    console.log(`${icon} ${code}（${scope}）`);
    // 同一 code 的訊息可能因頁而異（例如長度數字），標「例：」避免被當成全體事實
    const variants = new Set(list.map((x) => x.msg));
    console.log(`  ${variants.size > 1 ? '例：' : ''}${list[0].msg}`);
    const pages = list.map((x) => x.page).filter((p) => p !== '(site)');
    if (pages.length) console.log(`  → ${pages.slice(0, 5).join(', ')}${pages.length > 5 ? ` …等 ${pages.length} 頁` : ''}`);
    console.log('');
  }
  console.log('L3 部分項目與 L4（YMYL/E-E-A-T）需人工判讀，見 SKILL.md。\n');
}

const threshold = FAIL_ON === 'warn' ? counts.error + counts.warn : counts.error;
process.exit(threshold > 0 ? 1 : 0);
