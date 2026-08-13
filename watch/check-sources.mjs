/*
 * ① 出處存活檢查
 *
 * 這個 repo 的核心宣稱是「每條規則都附出處」。宣稱要成立，出處就得
 * 一直活著、而且沒有悄悄改掉。官方文件改版通常沒有公告，唯一能發現的
 * 方式是自己定期比對。
 *
 * 三種監測模式（watch 欄位）：
 *   hash     抓正文、去掉會逐次變動的雜訊後算雜湊 —— 一般 HTML 文件
 *   size     只比對 Content-Length 與 Last-Modified —— PDF（內容雜湊每次下載都可能不同）
 *   version  比對網址裡的版本號 —— arXiv 這類有明確版本的來源
 *
 * 輸出：Markdown 報告（給 GitHub issue 用）。有變動時 exit code 仍為 0
 * ——「有更新」不是錯誤，是待辦。只有腳本自己壞掉才非零。
 *
 * 用法：node watch/check-sources.mjs [--out report.md]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(__dirname, 'sources.json');
const STATE = join(__dirname, 'sources.state.json');

const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? argv[outArg + 1] : null;

const cfg = JSON.parse(readFileSync(SOURCES, 'utf8'));
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};

/*
 * 正規化。兩層處理，順序很重要：
 *
 * ① 先縮到文件正文區（<article> → <main> → <body>）。
 *    我們關心的是「規範內容有沒有改」，不是導覽列、推廣橫幅、
 *    「這篇有幫助嗎」的 A/B 變體。實測 Google 的文件頁在幾分鐘的尺度上
 *    就會因為這些周邊元素而產生不同的雜湊——加再多 denoise 規則也追不完，
 *    正確做法是根本不要把它們納入比對範圍。
 *
 * ② 再去掉逐次變動的雜訊（nonce、時間戳、隨機 build id）。
 */
const mainRegion = (html) => {
  for (const re of [/<article\b[^>]*>([\s\S]*?)<\/article>/i, /<main\b[^>]*>([\s\S]*?)<\/main>/i, /<body\b[^>]*>([\s\S]*)<\/body>/i]) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return html;
};

const denoise = (html) =>
  mainRegion(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\b[0-9a-f]{16,}\b/gi, 'HEX')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, 'TS')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/*
 * 統一帶瀏覽器 User-Agent。
 *
 * 實測：同一個 Google 文件頁，用 PowerShell 的預設 UA 抓得到
 * 「Last updated」標記，用 Node fetch 的預設 UA（node）抓不到
 * ——Google 對不同 UA 送不同的 HTML。
 *
 * 監測工具的原則是**模擬真實使用者看到的東西**；用預設 UA 等於
 * 監測一個沒有人會看到的版本。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const get = (url, init = {}) =>
  fetch(url, { redirect: 'follow', ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) } });
const md5 = (s) => createHash('md5').update(s).digest('hex').slice(0, 12);

const results = [];

for (const s of cfg.sources) {
  if (!s.url) {
    results.push({ ...s, status: 'no-url', detail: '尚未查證到官方位置' });
    continue;
  }

  try {
    /* 先試 HEAD——PDF 與大檔不必整份下載。不支援 HEAD 的站再退回 GET。 */
    let res = await get(s.url, { method: 'HEAD' });
    if (!res.ok && res.status !== 405) {
      results.push({ ...s, status: 'http-error', detail: `HTTP ${res.status}` });
      continue;
    }

    const prev = state[s.id] ?? {};
    const now = { checkedAt: new Date().toISOString().slice(0, 10) };

    if (s.watch === 'size') {
      now.lastModified = res.headers.get('last-modified');
      now.size = res.headers.get('content-length');
      /* HEAD 不一定回 content-length（分塊傳輸、CDN 轉址都可能省略）。
         實測 guidelines.raterhub.com 就是這樣——所以退回 GET 實際數位元組。
         PDF 才 4 MB 左右，一個月抓一次不算浪費。 */
      if (!now.size) {
        const full = await get(s.url);
        now.size = String((await full.arrayBuffer()).byteLength);
        now.lastModified = now.lastModified ?? full.headers.get('last-modified');
      }
      const changed = prev.size && (prev.size !== now.size || prev.lastModified !== now.lastModified);
      results.push({
        ...s, status: changed ? 'changed' : prev.size ? 'same' : 'baseline',
        detail: changed ? `大小 ${prev.size} → ${now.size}` : `${Math.round(Number(now.size) / 1024)} KB`,
      });
      state[s.id] = { ...prev, ...now };
    } else if (s.watch === 'version') {
      /* arXiv 的頁面按時間順序列出所有版本（[v1] … [v2] …），
         **最後一個才是目前版本**——取第一個會永遠停在 v1。 */
      const body = await (await get(s.url)).text();
      const vs = [...body.matchAll(/\[v(\d+)\]/g)].map((m) => Number(m[1]));
      now.version = vs.length ? String(Math.max(...vs)) : '?';
      const changed = prev.version && prev.version !== now.version;
      results.push({
        ...s, status: changed ? 'changed' : prev.version ? 'same' : 'baseline',
        detail: changed ? `v${prev.version} → v${now.version}` : `v${now.version}`,
      });
      state[s.id] = { ...prev, ...now };
    } else if (s.watch === 'updated') {
      /*
       * Google 的 devsite 文件頁自己會印「Last updated YYYY-MM-DD UTC」。
       *
       * 這比雜湊整頁好得多：它**穩定**（不受實驗旗標與個人化影響）、
       * **語意明確**（就是「這份文件改了沒」），而且是 Google 自己的宣告。
       *
       * 走過的彎路：先嘗試雜湊正文，但 devsite 每次請求注入的片段會讓
       * 同一分鐘內的兩次抓取產生不同雜湊——縮到 <article>、去掉 script／
       * 註解／十六進位 token 都追不完。與其猜雜訊長什麼樣，不如換一個
       * 本來就穩定的訊號。
       */
      /* ⚠ 這個標記是**間歇性出現**的：實測同一個網址、同樣的瀏覽器 UA，
         連續兩次抓取有時有、有時沒有——Google 會依請求送不同的 HTML 變體。

         所以「這次沒抓到」不等於「不存在」。重試三次才判定缺失：
         單次觀測的陰性，在訊號本身就不穩定時不構成證據。 */
      let m = null;
      for (let attempt = 0; attempt < 3 && !m; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 700));
        const body = await (await get(s.url)).text();
        m = body.match(/Last updated\s+(\d{4}-\d{2}-\d{2})/i);
      }
      if (!m) {
        results.push({ ...s, status: 'unstable', detail: '三次都抓不到 Last updated 標記——改用 hash 模式或人工確認' });
        continue;
      }
      now.updated = m[1];
      const changed = prev.updated && prev.updated !== now.updated;
      results.push({
        ...s, status: changed ? 'changed' : prev.updated ? 'same' : 'baseline',
        detail: changed ? `${prev.updated} → ${now.updated}` : now.updated,
      });
      state[s.id] = { ...prev, ...now };
      continue;
    } else {
      /*
       * 自我驗證的量測：同一次執行抓兩遍。
       *
       * 為什麼不是「把雜訊 denoise 乾淨就好」——實測 Google 的文件站
       * （JS 驅動的 devsite）每次請求會注入實驗旗標與個人化片段，
       * 縮到 <article> 區、去掉 script/style/註解/十六進位 token 之後，
       * 45 秒內的兩次抓取仍然產生不同雜湊。再加規則是追不完的。
       *
       * 兩遍一致 → 這個來源是穩定的，可以拿去跟基準比對
       * 兩遍不同 → 來源本質上不穩定，報成「無法比對」而不是「有變動」
       *
       * 這個做法的好處是**不需要事先知道雜訊長什麼樣**。
       */
      const h1 = md5(denoise(await (await get(s.url)).text()));
      await new Promise((r) => setTimeout(r, 800));
      const h2 = md5(denoise(await (await get(s.url)).text()));

      if (h1 !== h2) {
        results.push({ ...s, status: 'unstable', detail: `同次兩抓不一致（${h1} / ${h2}）` });
        /* 不寫入 state：不穩定的量測不該變成下次的基準 */
      } else {
        now.hash = h1;
        const changed = prev.hash && prev.hash !== now.hash;
        results.push({
          ...s, status: changed ? 'changed' : prev.hash ? 'same' : 'baseline',
          detail: changed ? `${prev.hash} → ${now.hash}` : now.hash,
        });
        state[s.id] = { ...prev, ...now };
      }
      continue;
    }

  } catch (err) {
    results.push({ ...s, status: 'unreachable', detail: err.message });
  }
}

/*
 * 守衛：每個「成功量測到」的來源都必須留下狀態。
 *
 * 實際踩過：為了避免重複寫入而把共用的 state 寫入行刪掉，卻只在其中兩個
 * 分支補回去——另外兩個分支從此永遠是 baseline，**永遠偵測不到變動**。
 * 腳本不報錯、報告看起來正常，只是那兩條線根本沒在監測。
 *
 * 這種「靜默失效」在監測系統裡最危險：你以為有人在看門，其實沒有。
 */
const measured = results.filter((r) => ['baseline', 'same', 'changed'].includes(r.status));
const stateless = measured.filter((r) => !state[r.id]);
if (stateless.length) {
  console.error(
    `✗ 這些來源量測成功卻沒有寫入狀態，下次會再次變成 baseline、永遠測不到變動：\n  ` +
      stateless.map((r) => `${r.id}（watch: ${r.watch}）`).join('\n  '),
  );
  process.exit(1);
}

writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');

/* ── 報告 ─────────────────────────────────────────────── */
const ICON = { changed: '🔔', 'http-error': '❌', unreachable: '⚠️', 'no-url': '📌', baseline: '🆕', same: '✅', unstable: '🌀' };
const actionable = results.filter((r) => ['changed', 'http-error', 'unreachable', 'no-url'].includes(r.status));

const lines = [];
lines.push('## ① 出處存活檢查\n');
lines.push(`檢查 ${results.length} 個來源，**${actionable.length} 個需要看一眼**。\n`);
lines.push('| | 來源 | 狀態 | 用在哪 |');
lines.push('|---|---|---|---|');
for (const r of results) {
  lines.push(`| ${ICON[r.status]} | [${r.name}](${r.url ?? '#'}) | ${r.detail} | ${r.usedBy.join('、')} |`);
}

if (actionable.length) {
  lines.push('\n### 要做什麼\n');
  for (const r of actionable) {
    if (r.status === 'changed') lines.push(`- **${r.name} 內容變了** — 開原文比對，確認受影響的規則（${r.usedBy.join('、')}）是否仍成立`);
    if (r.status === 'http-error') lines.push(`- **${r.name} 連不到（${r.detail}）** — 找新網址；官方文件路徑常常搬家`);
    if (r.status === 'unreachable') lines.push(`- **${r.name} 抓取失敗** — 可能是暫時性的，下次仍失敗再處理`);
    if (r.status === 'no-url') lines.push(`- **${r.name} 還沒有可查證的網址** — ${r.note ?? ''}`);
  }
}

const report = lines.join('\n') + '\n';
if (OUT) writeFileSync(OUT, report);
else console.log(report);

/* 給 workflow 用的旗標 */
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `sources_actionable=${actionable.length}\n`, { flag: 'a' });
}
