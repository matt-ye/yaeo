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
