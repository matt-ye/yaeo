/*
 * ② 爬蟲清單檢查
 *
 * SITE-AI-* 那組規則依賴一份 User-Agent 清單。清單會過期：廠商新增爬蟲
 * （OpenAI 從 GPTBot 一支變成三支）、改名、或停用。
 *
 * **過期的症狀是靜默的**——檢核器照跑、報告照出，只是漏掉新的爬蟲。
 * 使用者以為自己的 robots.txt 設定完整，其實有一半的 AI 爬蟲不在管轄範圍。
 *
 * 檢查兩個方向：
 *   ① 清單裡的名稱，是否仍出現在廠商官方文件裡（消失 = 可能改名或停用）
 *   ② 官方文件裡出現、但清單沒有的疑似爬蟲名稱（= 可能新增）
 *
 * ② 用保守的樣式比對，寧可漏報也不要每次吐一堆雜訊——這份報告是要人看的，
 * 誤報一多就沒人看了。
 *
 * 用法：node watch/check-crawlers.mjs [--out report.md] [--append]
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cfCreds, browserContent } from './cf.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, 'crawlers.json'), 'utf8'));

const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? argv[outArg + 1] : null;
const APPEND = argv.includes('--append');

/* 與 check-sources.mjs 同樣的理由：用預設 UA 抓到的是沒有人會看到的版本 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const get = (url) => fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });

/* 疑似爬蟲名稱的樣式。保守取向：
   - 必須含 Bot／bot／Crawler／spider／-User／-SearchBot 之類的字尾或字根
   - 長度 4–40，避免抓到零散字串
   刻意不做「所有駝峰字」那種寬鬆比對——那會把整頁的產品名都當成爬蟲。 */
const CANDIDATE = /\b([A-Za-z][\w.-]{2,38}(?:Bot|bot|Crawler|crawler|[Ss]pider|-User|-Extended|-SearchBot))\b/g;

/* 這些是常見的誤判：一般網頁術語、其他廠商的非 AI 爬蟲、樣板文字 */
const IGNORE = new Set([
  'robots.txt', 'user-agent', 'Googlebot', 'Googlebot-Image', 'Googlebot-News',
  'Googlebot-Video', 'Storebot', 'Storebot-Google', 'AdsBot', 'AdsBot-Google',
  'Mediapartners-Google', 'APIs-Google', 'FeedFetcher-Google', 'Google-Safety',
  'GoogleOther', 'Bingbot', 'bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider',
  'YandexBot', 'facebookexternalhit', 'Twitterbot', 'crawler', 'Crawler', 'bot', 'Bot',
]);

const creds = cfCreds();
const rows = [];

for (const v of cfg.vendors) {
  if (!v.docUrl) {
    rows.push({ vendor: v.name, status: 'no-doc', detail: v.note ?? '尚未查證到官方文件', crawlers: v.crawlers.map((c) => c.ua) });
    continue;
  }
  let html;
  try {
    if (v.fetch === 'browser') {
      /* 缺金鑰時不靜默跳過——少跑一項卻顯示綠燈，比檢查失敗更糟。 */
      if (!creds) {
        rows.push({ vendor: v.name, status: 'needs-browser', detail: '這家要真瀏覽器才抓得到，但沒有 CF_ACCOUNT_ID／CF_API_TOKEN，本次未檢查', crawlers: [] });
        continue;
      }
      html = await browserContent(creds, v.docUrl);
    } else {
      const res = await get(v.docUrl);
      if (!res.ok) { rows.push({ vendor: v.name, status: 'http-error', detail: `HTTP ${res.status}`, crawlers: [] }); continue; }
      html = await res.text();
    }
  } catch (err) {
    rows.push({ vendor: v.name, status: 'unreachable', detail: err.message, crawlers: [] });
    continue;
  }

  /*
   * 抽取前要先確定自己在讀的是**內容**，不是標記。
   * 第一版直接對原始 HTML 比對，結果把網址 slug（web-and-how-can-site-owners-
   * block-the-crawler）、Unicode 跳脫（u003eBot）、屬性值都當成候選爬蟲名。
   */
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\\?u00[0-9a-f]{2}/gi, ' ')      // JSON 裡的 Unicode 跳脫
    .replace(/https?:\/\/\S+/g, ' ')          // 內文裡的完整網址
    .replace(/<[^>]+>/g, ' ');                // 標籤（含所有屬性值）

  /* 大小寫不敏感：文件正文常寫 Meta-WebIndexer，robots.txt 的 token 卻是
     meta-webindexer。比對名稱時大小寫的差異沒有意義，只會製造假的「消失了」。 */
  const lowerText = text.toLowerCase();
  const missing = v.crawlers.filter((c) => !lowerText.includes(c.ua.toLowerCase())).map((c) => c.ua);

  /* 反向：文件裡有、清單沒有的 */
  const known = [...new Set(cfg.vendors.flatMap((x) => x.crawlers.map((c) => c.ua.toLowerCase())))];
  const ignoreLower = new Set([...IGNORE].map((x) => x.toLowerCase()));

  const candidates = [...new Set([...text.matchAll(CANDIDATE)].map((m) => m[1]))].filter((n) => {
    const low = n.toLowerCase();
    if (ignoreLower.has(low)) return false;
    /* 含 . 或 / 的是片段（geo.googlebot、directives.Amzn-User），不是爬蟲名 */
    if (/[./]/.test(n)) return false;
    /* 與已知名稱互為子字串的，是同一支的變形寫法，不算新發現 */
    if (known.some((k) => low.includes(k) || k.includes(low))) return false;
    /* 只有字尾沒有主體（bot、crawler、searchbot）——那是通用詞 */
    if (/^(bot|crawler|spider|searchbot|adsbot|extended)$/i.test(n)) return false;
    return true;
  });

  rows.push({
    vendor: v.name,
    status: missing.length ? 'missing' : candidates.length ? 'new-candidates' : 'ok',
    detail: missing.length
      ? `清單裡有、文件裡找不到：${missing.join('、')}`
      : candidates.length
        ? `文件裡出現但清單沒有：${candidates.slice(0, 6).join('、')}${candidates.length > 6 ? ` …等 ${candidates.length} 個` : ''}`
        : `${v.crawlers.length} 個全部確認`,
    crawlers: v.crawlers.map((c) => c.ua),
  });
}

const ICON = { ok: '✅', missing: '🔔', 'new-candidates': '🆕', 'no-doc': '📌', 'http-error': '❌', unreachable: '⚠️', 'needs-browser': '🔑' };
const actionable = rows.filter((r) => ['missing', 'new-candidates', 'no-doc', 'http-error', 'needs-browser', 'unreachable'].includes(r.status));

const all = cfg.vendors.flatMap((v) => v.crawlers);
const outOfScope = all.filter((c) => c.inRules === false);

const lines = [];
lines.push('\n## ② 爬蟲清單檢查\n');
lines.push(`檢查 ${cfg.vendors.length} 家廠商、${all.length} 個 User-Agent（其中 ${all.length - outOfScope.length} 個納入 SITE-AI-* 規則），**${actionable.length} 項需要看一眼**。\n`);
lines.push('| | 廠商 | 結果 |');
lines.push('|---|---|---|');
for (const r of rows) lines.push(`| ${ICON[r.status]} | ${r.vendor} | ${r.detail} |`);

if (outOfScope.length) {
  lines.push('\n<details><summary>已知但刻意不納入規則的 ' + outOfScope.length + ' 支</summary>\n');
  /* 排除理由逐支列，不寫一句通則——「只抓站長提交的內容」對 OAI-AdsBot 成立，
     對自主爬取的 meta-externalads 就是錯的。一句通則會把正確的紀錄變成假話。 */
  lines.push('列在清單裡是為了不要每月被當成新發現重報。排除理由各不相同：\n');
  for (const c of outOfScope) lines.push(`- \`${c.ua}\`（${c.type}）— ${c.note ?? '未載理由'}`);
  lines.push('\n</details>');
}

if (actionable.length) {
  lines.push('\n### 要做什麼\n');
  for (const r of actionable) {
    if (r.status === 'missing') lines.push(`- **${r.vendor}：${r.detail}** — 確認是改名還是停用，同步更新 \`seo-check.mjs\` 的 RETRIEVAL／TRAINING／USER_TRIGGERED 與 \`crawlers.json\``);
    if (r.status === 'new-candidates') lines.push(`- **${r.vendor} 文件裡有清單外的名稱** — 逐一確認是不是 AI 爬蟲（樣式比對會有誤判），是的話補進清單並分類`);
    if (r.status === 'no-doc') lines.push(`- **${r.vendor} 還沒有可查證的官方文件** — ${r.detail}`);
    if (r.status === 'http-error') lines.push(`- **${r.vendor} 文件連不到（${r.detail}）** — 找新網址`);
    if (r.status === 'needs-browser') lines.push(`- **${r.vendor} 本次未檢查** — ${r.detail}`);
    if (r.status === 'unreachable') lines.push(`- **${r.vendor} 抓取失敗** — ${r.detail}`);
  }
}

const report = lines.join('\n') + '\n';
if (OUT) (APPEND ? appendFileSync : writeFileSync)(OUT, report);
else console.log(report);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `crawlers_actionable=${actionable.length}\n`);
}
