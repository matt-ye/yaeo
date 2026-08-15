/*
 * L1-LANG-CONTENT-MISMATCH 的判準測試。
 *
 * 這條規則補的是一個先前完全沒人看的死角：`L1-LANG-MISSING` 只問「有沒有宣告」，
 * `SITE-LANG-INCONSISTENT` 只比對「同一語言有沒有多種寫法」——兩條都不看正文。
 * 所以一個 <html lang="en"> 卻滿頁中文的頁面，整份報告一個字都不會說。
 *
 * 它值得一個測試的理由，是它的判準**刻意不對稱**，而不對稱的判準最容易被
 * 後人「順手改成對稱」而整批誤判：
 *   · 宣告拉丁語系卻出現整塊中日韓 → 幾乎不會是巧合，可以報
 *   · 宣告中日韓卻出現整塊拉丁    → 不能報。中文頁出現品牌名、程式碼、
 *                                   縮寫是常態，反向套用會整批誤判
 *
 * 另一半判準是**只看介面元件**。實測一個雙語站的英文演講列表頁，純中日韓的
 * 節點有 167 個，依包住它的標籤拆開後：<a> 163 個全是機構名與活動名（專有名詞，
 * 不該翻）、<option> 4 個是排序標籤（介面沒跟著換語言，該修）。
 * 只給一個總數就會是 163 比 4 的雜訊——**噪音比漏報更危險**。
 *
 * 所以下面一半的情境是**反向斷言**：這些狀況規則必須保持安靜。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/lang-content-mismatch.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-lang-content-test');
const CODE = 'L1-LANG-CONTENT-MISMATCH';

const page = (lang, body) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>Language declaration test page</title>
<meta name="description" content="A fixture for the declared-language versus actual-content check, long enough that other rules stay quiet.">
<link rel="canonical" href="https://example.com/"></head><body><main><h1>Heading</h1>${body}</main></body></html>`;

/* 英文散文，用來把拉丁字母數墊高到「這頁確實是英文」的程度 */
const englishProse = `<p>This page exists to exercise the declared-language check with a realistic
  amount of Latin prose, so that the ratio between scripts reflects a genuinely English document
  rather than a stub. The checker compares what the document declares against what it actually
  contains, because the two can drift apart during an incremental translation.</p>`;

/* 中文散文，用來製造「宣告英文但內容其實是中文」 */
const chineseProse = `<p>這一頁的正文其實是中文，但文件開頭宣告的語言是英文。這種狀況在
  漸進式的多語系遷移裡很常見：網址與版型都換好了，內容卻還沒跟上。使用者未必看得出來，
  因為畫面上本來就是中文；但爬蟲讀到的是一個自稱英文、內容卻是中文的文件。</p>`;

/* 專有名詞：機構名、活動名。這些在英文頁上是正常的，**不該被報出來** */
const properNouns = `<ul>
    <li><a href="/a/">晶盛科技股份有限公司</a></li>
    <li><a href="/b/">社團法人起駛簡報表達教育協會</a></li>
    <li><a href="/c/">東吳大學英文學系</a></li>
    <li><a href="/d/">國立臺灣大學寫作教學中心</a></li>
  </ul>`;

/* 介面元件沒跟著換語言：排序下拉選單仍是中文。**該報** */
const uiControls = `<select name="sort">
    <option value="new">日期（最新）</option>
    <option value="old">日期（最早）</option>
    <option value="hot">人次（最多）</option>
  </select>`;

/* 中文技術文章：大量拉丁字母來自程式碼、品牌名與縮寫。**不該報** */
const chineseTechArticle = `<p>這篇談的是前端建置流程。我們用 Astro 產生靜態頁面，
  搭配 Cloudflare Pages 部署，CI 走 GitHub Actions。JSON-LD 與 canonical 由版型統一輸出，
  而 hreflang 的判斷依據放在 lib/i18n.ts 的 MIGRATED_PATHS。</p>
  <pre><code>const config = defineConfig({ site: "https://example.com", integrations: [sitemap()] });
  export function getStaticPaths() { return [{ params: { lang: undefined } }]; }</code></pre>
  <p>選擇 Astro 而不是 Next.js 的理由是輸出純靜態、不需要 Node runtime。</p>`;

/* 下面三個樣本另用一段**短**的英文當基底，不共用上面的 englishProse。
   理由是這三個情境要靠「中文字數落在舊門檻與新門檻之間」才測得出差別，
   英文一長，中文就得跟著寫很長，樣本會變得難讀也難維護。
   這段拉丁字母 112 個（版型的 <h1>Heading</h1> 另加 7 個）。 */
const shortEnglish = `<p>A short paragraph of English prose so the page has some Latin content
  to compare against, but not enough to dominate the counts on its own.</p>`;

/* ① 未翻譯但標記正確：中文遠多於拉丁，但全部包在 lang="zh-TW" 裡。
   這是實際站台上 /en/writing/ 的形狀——文章還沒有英文標題，刻意退回中文並標記語言。
   中文 188、拉丁 125（"BOPPPS" 那 6 個字母也算，第一版就是漏算這個）。 */
const markedUntranslated = shortEnglish + `<ul>
    <li><a href="/a/"><span lang="zh-TW">四位評審教我的事——職能治療師在商業競賽決賽現場的筆記</span></a></li>
    <li><a href="/b/"><span lang="zh-TW">通貨膨脹的本質：為什麼你的錢每年都變薄</span></a></li>
    <li><a href="/c/"><span lang="zh-TW">矽光子與量子電腦：一份給非工程師的趨勢地圖</span></a></li>
    <li><a href="/d/"><span lang="zh-TW">把簡報當成一種職能：硬核簡報專欄的起點與方法</span></a></li>
    <li><a href="/e/"><span lang="zh-TW">給家人的投資課：從時間價值到護城河的二十六週</span></a></li>
    <li><a href="/f/"><span lang="zh-TW">教學設計手冊：BOPPPS 六大模組與它的工作坊起源</span></a></li>
    <li><a href="/g/"><span lang="zh-TW">從評審提問反推提案缺口的四個原型與五道生死題</span></a></li>
    <li><a href="/h/"><span lang="zh-TW">一個職能治療師的跨界筆記：把臨床推理搬到商業提案</span></a></li>
    <li><a href="/i/"><span lang="zh-TW">簡報表達的底層邏輯：先問誰在聽再決定怎麼說</span></a></li>
  </ul>`;

/* ② 語言選擇器：各語言用自己的文字、各自宣告 lang。這是正確寫法，不是缺陷。 */
const languagePicker = shortEnglish + `<select name="lang">
    <option value="en" lang="en">English</option>
    <option value="zh" lang="zh-TW">中文</option>
    <option value="ja" lang="ja">日本語</option>
    <option value="ko" lang="ko">한국어</option>
  </select>`;

/* ③ 勉強過半：中文 134、拉丁 119。> 119（舊判準會報）但 < 142.8（新判準不報）。
   實際踩過的案例是 1401 vs 1381 差 1.4%——翻十篇文章標題就從有到無。 */
const marginal = shortEnglish + `<p>這一段中文沒有標記語言，字數刻意落在剛好比拉丁字母多、
  但還沒有多到一點二倍的區間，用來測試邊界。舊版的判準是勉強過半就報，
  新版要求明顯差距才報，所以這個樣本應該只有舊版會叫。這個情境存在的理由是：
  一個警告級的結論不應該由百分之一點四的差距決定，否則內容每次微調都會讓它
  在有和無之間跳動。</p>`;

const CASES = [
  {
    name: '宣告 en、正文其實是中文 → 該報 warn（整頁層級）',
    lang: 'en',
    body: chineseProse,
    expect: 'warn',
  },
  {
    name: '宣告 en、正文是英文，但下拉選單仍是中文 → 該報 info（介面元件）',
    lang: 'en',
    body: englishProse + uiControls,
    expect: 'info',
  },
  {
    name: '⟲ 反向：宣告 en、正文是英文，中文只出現在連結裡的機構名 → 必須不報',
    lang: 'en',
    body: englishProse + properNouns,
    expect: null,
  },
  {
    name: '⟲ 反向：宣告 zh-TW 的技術文章，大量拉丁來自程式碼與品牌名 → 必須不報',
    lang: 'zh-TW',
    body: chineseTechArticle,
    expect: null,
  },
  {
    name: '⟲ 反向：宣告 en、通篇英文 → 必須不報',
    lang: 'en',
    body: englishProse + englishProse,
    expect: null,
  },
  {
    name: '宣告 zh-TW、正文卻幾乎沒有中文 → 該報 warn（另一個方向的極端）',
    lang: 'zh-TW',
    body: englishProse + englishProse,
    expect: 'warn',
  },

  /* ── 以下是判準改看 lang 作用域之後補的（原本的判準會在這三個情境誤報）──
     ⚠ 每個樣本的字數都是**量出來的**，不是估的。第一版靠估，結果情境 ① 在
     舊判準上也通過——一個在壞掉的版本上也會通過的測試，什麼都沒證明。
     驗收方式：把同一份測試跑在改動前的檢核器上，① ② ③ 必須失敗。 */
  {
    name: '① 未翻譯但已用 lang="zh-TW" 標記 → 必須不報（作者標對了，那不是缺陷）',
    lang: 'en',
    body: markedUntranslated,
    expect: null,
  },
  {
    name: '② 語言選擇器（各語言用自己的文字，且各自宣告 lang）→ 必須不報',
    lang: 'en',
    body: languagePicker,
    expect: null,
  },
  {
    name: '③ 未宣告中文勉強過半、但未達 1.2 倍 → 必須不報（避免結論在門檻上跳動）',
    lang: 'en',
    body: marginal,
    expect: null,
  },
  {
    name: '對照：同樣的內容拿掉 lang 標記 → 仍要報 warn',
    lang: 'en',
    body: markedUntranslated.replace(/ lang="zh-TW"/g, ''),
    expect: 'warn',
  },
  {
    name: '對照：語言選擇器沒有宣告 lang → 仍要報 info',
    lang: 'en',
    body: languagePicker.replace(/ lang="(zh-TW|ja|ko)"/g, ''),
    expect: 'info',
  },
];

let failed = 0;
for (const c of CASES) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, 'index.html'), page(c.lang, c.body), 'utf8');

  let out = '';
  try {
    out = execFileSync(process.execPath, [CHECKER, '--dir', ROOT, '--json'], { encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout ?? '') + (err.stderr ?? '');
  }

  let hit = null;
  try {
    hit = (JSON.parse(out).findings ?? []).find((x) => x.code === CODE) ?? null;
  } catch {
    hit = undefined; // 解析失敗與「沒報」要分得開
  }

  const ok = hit === undefined ? false : (c.expect === null ? hit === null : hit?.level === c.expect);
  console.log(`${ok ? '✅' : '❌'} ${c.name}`);
  if (!ok) {
    failed++;
    console.log(`   預期：${c.expect === null ? '不報' : c.expect}`);
    console.log(`   實得：${hit === undefined ? 'JSON 解析失敗' : hit ? `${hit.level} — ${hit.msg}` : '不報'}`);
  }
}

rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `\n${failed} 個情境未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
