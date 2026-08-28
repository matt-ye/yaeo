#!/usr/bin/env node
/**
 * agent-check.mjs — agent 可操作性檢核（零依賴，Node 18+）
 *
 * 補 seo-check.mjs 檢核不到的**連線層**。用法：
 *   node agent-check.mjs --site https://example.com [--json] [--fail-on warn]
 *
 * ⚠ 為什麼要另開一支，而不是加進 seo-check.mjs：
 *   seo-check.mjs 是**純檔案系統掃描器**（全檔零 fetch），檢核的是 ./dist 的建置產物。
 *   這裡每一條規則都必須發真實 HTTP 請求才驗得出來——HTTP 狀態碼、內容協商、
 *   線上可取性，建置產物裡通通看不到。把網路塞進 seo-check.mjs 會毀掉它
 *   「離線、可重現、CI 不需連外」的性質。先例：psi-check.mjs 也是這樣分開的。
 *
 * ⚠ 這支檢核的是**已部署的線上網站**，不是 dist。deploy 之後才跑得有意義。
 *
 * 出處：規則對應 Is Agentic（Vercel × Ora，2026-08）公開報告中出現過的檢查項，
 *   以及 RFC 9309（robots.txt）、llmstxt.org。
 *   ⚠ Is Agentic 的**完整檢查清單不公開**（官方稱 127 項，一項名稱都不列），
 *   所以這裡只實作「從公開報告逆推得到、且語意明確」的少數幾條，
 *   **不宣稱涵蓋它的評分**，也不試圖重現它的分數。
 */

import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
const getArg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const SITE = getArg('site');
const AS_JSON = argv.includes('--json');
const FAIL_ON = getArg('fail-on', 'error');

if (!SITE) {
  console.error('用法：node agent-check.mjs --site https://example.com [--json] [--fail-on warn]');
  process.exit(2);
}

let base;
try {
  base = new URL(SITE);
  if (!/^https?:$/.test(base.protocol)) throw new Error('protocol');
} catch {
  console.error(`--site 必須是完整的 http/https 網址，收到：${SITE}`);
  process.exit(2);
}
const origin = base.origin;

/* 表明身分。被檢核的站有權知道這些請求是誰發的，也方便對方在 log 裡辨識。 */
const UA = 'yaeo-agent-check/1.0 (+https://github.com/matt-ye/yaeo)';

const findings = [];
const add = (level, code, message, count = null) =>
  findings.push({ level, code, message, ...(count === null ? {} : { count }) });

/* 請求之間留間隔，不要對被測站造成突發流量。整支跑完個位數請求，不需要並行。 */
const POLITE_DELAY_MS = 300;
let requestCount = 0;

async function probe(path, { accept = '*/*', method = 'GET' } = {}) {
  if (requestCount++) await sleep(POLITE_DELAY_MS);
  const url = new URL(path, origin).href;
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: accept, 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    /* 只讀前 64KB——判斷用不到整頁，也避免把大檔全吃進記憶體 */
    const body = method === 'GET' ? (await res.text()).slice(0, 65536) : '';
    return { ok: true, url, status: res.status, headers: res.headers, body, finalUrl: res.url };
  } catch (err) {
    return { ok: false, url, error: err?.name === 'TimeoutError' ? '逾時（15s）' : String(err?.message || err) };
  }
}

/* ── AGENT-SOFT-404 ─────────────────────────────────────────────────────────
 * 不存在的路徑回 200，是 SPA 與部分靜態託管的預設行為。
 * 對 agent 的實際後果：它探測任何路徑都得到「存在」，於是無法用狀態碼判斷
 * 資源在不在，只能猜。這是 Is Agentic 少數列為 essential 且連 vercel.com
 * 自己都沒過的一條。
 *
 * 用兩條隨機路徑而不是一條：單一路徑可能剛好命中某個萬用路由或被快取。 */
async function checkSoft404() {
  const paths = ['/yaeo-probe-nonexistent-a1b2c3/', '/yaeo-probe-nonexistent-d4e5f6.html'];
  const results = [];
  for (const p of paths) {
    const r = await probe(p);
    if (!r.ok) {
      add('warn', 'AGENT-PROBE-FAILED', `探測 ${p} 失敗（${r.error}）——這條無法判定，不是通過`);
      return null;
    }
    results.push(r);
  }
  const soft = results.filter((r) => r.status === 200);
  if (soft.length) {
    add('error', 'AGENT-SOFT-404',
      `不存在的路徑回 HTTP 200（${soft.map((r) => new URL(r.url).pathname).join('、')}）`
      + '——agent 探測任何路徑都會得到「存在」，無法用狀態碼判斷資源在不在。'
      + '修法：讓未知路徑回真正的 404（或 410）', soft.length);
    return results;
  }
  const wrong = results.filter((r) => ![404, 410].includes(r.status));
  if (wrong.length) {
    add('warn', 'AGENT-404-STATUS',
      `不存在的路徑回 ${wrong.map((r) => r.status).join('／')}，既不是 200 也不是 404/410`
      + '——確認這是刻意的（例如整站導向）', wrong.length);
    return results;
  }

  /* 狀態碼對了，再看 404 頁本身有沒有給 agent 下一步。
     這是加分項不是必要項，所以 info。 */
  const body = results[0].body;
  const hasPointer = /sitemap|llms\.txt|\/docs|首頁|home/i.test(body);
  if (!hasPointer) {
    add('info', 'AGENT-404-NO-POINTER',
      '404 回應正確，但頁面沒有指向 sitemap／llms.txt／首頁之類的入口'
      + '——agent 走到死路時沒有下一步。加一兩個連結即可，非必要');
  }
  return results;
}

/* ── AGENT-ROBOTS-UNREACHABLE / AGENT-LLMSTXT-UNREACHABLE ───────────────────
 * seo-check.mjs 驗的是「dist 裡有沒有這個檔」，驗不到「上線後取不取得到」。
 * 這兩件事會分岔：檔案在 dist 裡，但被 redirect 規則吃掉、被 WAF 擋、
 * 或根本沒被部署上去。 */
async function checkMachineFiles() {
  const required = [
    { path: '/robots.txt', code: 'AGENT-ROBOTS-UNREACHABLE', level: 'error', label: 'robots.txt' },
    { path: '/llms.txt', code: 'AGENT-LLMSTXT-UNREACHABLE', level: 'warn', label: 'llms.txt' },
  ];
  for (const f of required) {
    const r = await probe(f.path);
    if (!r.ok) { add('warn', 'AGENT-PROBE-FAILED', `探測 ${f.path} 失敗（${r.error}）`); continue; }
    if (r.status !== 200) {
      add(f.level, f.code,
        `${f.label} 線上取不到（HTTP ${r.status}）`
        + '——dist 裡有檔案不代表部署後取得到，可能被 redirect 規則或 WAF 吃掉');
      continue;
    }
    /* 取得到還要確認不是被 SPA 萬用路由換成 HTML */
    const ctype = r.headers.get('content-type') || '';
    if (/text\/html/i.test(ctype)) {
      add(f.level, f.code,
        `${f.label} 回 200 但 Content-Type 是 ${ctype}`
        + '——多半是萬用路由回了 HTML 空殼，agent 拿到的不是這個檔');
    }
  }
}

/* ── AGENT-SITEMAP-PROBE-GAP ────────────────────────────────────────────────
 * /sitemap.xml 404、真正的在 /sitemap-index.xml，是 Astro 等框架的預設產物形狀。
 * robots.txt 有正確宣告時**這不是錯誤**，所以只報 info：多數自動檢查器
 * 直接探測 /sitemap.xml，會因此誤報。要不要為了迎合探測習慣加 redirect，
 * 是網站自己的取捨，這裡只把事實講出來，不給目標。 */
async function checkSitemapProbeGap() {
  const plain = await probe('/sitemap.xml');
  if (!plain.ok) { add('warn', 'AGENT-PROBE-FAILED', `探測 /sitemap.xml 失敗（${plain.error}）`); return; }
  if (plain.status === 200) return;

  const index = await probe('/sitemap-index.xml');
  if (!index.ok || index.status !== 200) {
    add('error', 'AGENT-SITEMAP-UNREACHABLE',
      `/sitemap.xml 與 /sitemap-index.xml 線上都取不到（${plain.status}／${index.ok ? index.status : index.error}）`);
    return;
  }
  const robots = await probe('/robots.txt');
  const declared = robots.ok && robots.status === 200 && /^\s*Sitemap:\s*\S*sitemap-index\.xml/im.test(robots.body);
  add('info', 'AGENT-SITEMAP-PROBE-GAP',
    `/sitemap.xml 回 ${plain.status}，實際 sitemap 在 /sitemap-index.xml`
    + (declared
      ? '（robots.txt 已正確宣告，**這不是錯誤**）——但直接探測 /sitemap.xml 的檢查器會誤報'
      : '，且 robots.txt 沒有宣告它——agent 找不到 sitemap'));
  if (!declared) {
    findings[findings.length - 1].level = 'warn';
  }
}

/* ── AGENT-MD-NEGOTIATION ───────────────────────────────────────────────────
 * 帶 Accept: text/markdown 時回 markdown，是 Is Agentic 的 bonus 訊號
 * （bonus 上限 +5，**沒有不扣分**），所以這裡是 info，不是待辦。
 *
 * 它真正的價值不在分數，在**傳輸量**：HTML 版面佔掉的位元組，
 * 對只要正文的 agent 全是浪費。所以順便把兩者的體積差報出來——
 * 有數字才知道值不值得做。 */
async function checkMarkdown() {
  const html = await probe('/', { accept: 'text/html' });
  const md = await probe('/', { accept: 'text/markdown' });
  if (!html.ok || !md.ok) {
    add('warn', 'AGENT-PROBE-FAILED', `首頁內容協商探測失敗（${html.ok ? md.error : html.error}）`);
    return;
  }
  const ctype = (md.headers.get('content-type') || '').toLowerCase();
  if (/text\/(markdown|plain)/.test(ctype)) {
    add('info', 'AGENT-MD-NEGOTIATION', `Accept: text/markdown 已回 ${ctype}——內容協商有做`);
    return;
  }

  /* 沒有內容協商時，看看有沒有靜態的 .md 分身可用（link rel=alternate 或 /index.md）。
     兩者都能讓 agent 拿到 markdown，只是發現方式不同。 */
  const altLink = /<link[^>]+rel=["']alternate["'][^>]+type=["']text\/markdown["']/i.test(html.body)
    || /<link[^>]+type=["']text\/markdown["'][^>]+rel=["']alternate["']/i.test(html.body);

  const bytes = Buffer.byteLength(html.body, 'utf8');
  const textOnly = html.body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ratio = bytes ? Math.round((1 - Buffer.byteLength(textOnly, 'utf8') / bytes) * 100) : 0;

  add('info', 'AGENT-MD-NEGOTIATION',
    `Accept: text/markdown 回 ${ctype || '(無 Content-Type)'}，沒有內容協商`
    + (altLink ? '；但首頁有 link rel="alternate" type="text/markdown"，agent 仍取得到 markdown' : '')
    + `。首頁 HTML ${(bytes / 1024).toFixed(1)}KB，其中約 ${ratio}% 不是正文`
    + '——這是加分項不是必要項，值不值得做看這個比例');
}

/* ── AGENT-MACHINE-CATALOG ──────────────────────────────────────────────────
 * .well-known 的機器可讀目錄（RFC 9727 api-catalog、ai-catalog.json、
 * MCP server.json、openapi.json）只有在網站**真的有 API 或 MCP** 時才有意義。
 *
 * ⚠ 沒有 API 的內容站，這些檔案缺席是正確的，Is Agentic 也判 N/A 不扣分。
 * 所以這條**永遠是 info，而且明講不要為了分數補空殼**——
 * 一個指向不存在端點的 api-catalog，比沒有還糟。 */
async function checkMachineCatalog() {
  const candidates = [
    '/.well-known/api-catalog',
    '/.well-known/ai-catalog.json',
    '/openapi.json',
    '/.well-known/mcp/server-card.json',
  ];
  const present = [];
  for (const p of candidates) {
    const r = await probe(p, { method: 'HEAD' });
    if (r.ok && r.status === 200) present.push(p);
  }
  add('info', 'AGENT-MACHINE-CATALOG',
    present.length
      ? `找到機器可讀目錄：${present.join('、')}`
      : '沒有 .well-known/api-catalog、ai-catalog.json、openapi.json 或 MCP server-card'
        + '——**若本站沒有 API 或 MCP，這是正確狀態**（Is Agentic 判 N/A 不扣分）。'
        + '不要為了分數補空殼檔案：指向不存在端點的目錄比沒有更糟',
    present.length);
}

/* ── 執行 ──────────────────────────────────────────────────────────────── */
await checkSoft404();
await checkMachineFiles();
await checkSitemapProbeGap();
await checkMarkdown();
await checkMachineCatalog();

const counts = { error: 0, warn: 0, info: 0 };
for (const f of findings) counts[f.level]++;

if (AS_JSON) {
  console.log(JSON.stringify({ site: origin, requests: requestCount, counts, findings }, null, 2));
} else {
  const ICON = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };
  console.log(`\nagent 可操作性檢核：${origin}（${requestCount} 個請求）\n`);
  for (const level of ['error', 'warn', 'info']) {
    for (const f of findings.filter((x) => x.level === level)) {
      console.log(`${ICON[level]} ${f.code}`);
      console.log(`   ${f.message}\n`);
    }
  }
  console.log(`error ${counts.error}／warn ${counts.warn}／info ${counts.info}`);
  console.log('\n⚠ 這不是 Is Agentic 的分數，也不試圖重現它——它的完整清單不公開，分數不可審計。');
}

const failed = counts.error > 0 || (FAIL_ON === 'warn' && counts.warn > 0);
process.exit(failed ? 1 : 0);
