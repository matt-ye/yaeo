#!/usr/bin/env node
/**
 * psi-check.mjs — PageSpeed Insights 檢核（零依賴，Node 18+）
 *
 * 補 seo-check.mjs 檢核不到的效能層。用法：
 *   node psi-check.mjs --url https://example.com/ [--key-env GOOGLE_PSI_API_KEY_MATTYE]
 *                      [--strategy both|mobile|desktop] [--json]
 *
 * ⚠ 必須自備 API key：不帶 key 走 Google 公共匿名配額池，實測直接回 429。
 *   key 從環境變數讀，不接受命令列傳入——避免 key 進 shell 歷史。
 *
 * ⚠ API key 不綁被測網域：key 只決定配額算在哪個 GCP 專案，任何 key 都能測任何網址。
 *   多把 key 的用途是「配額分開計費」，不是存取控制。
 */

const argv = process.argv.slice(2);
const getArg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const URL_ = getArg('url');
const KEY_ENV = getArg('key-env', 'GOOGLE_PSI_API_KEY_MATTYE');
const STRATEGY = getArg('strategy', 'both');
const AS_JSON = argv.includes('--json');

if (!URL_) {
  console.error('用法：node psi-check.mjs --url https://example.com/ [--key-env VAR] [--strategy both|mobile|desktop]');
  process.exit(2);
}
const KEY = process.env[KEY_ENV];
if (!KEY) {
  console.error(`環境變數 ${KEY_ENV} 沒有值。\n先設定：setx ${KEY_ENV} "你的金鑰"（設定後要開新 shell 才讀得到）`);
  process.exit(2);
}

// Core Web Vitals 官方門檻（good / needs-improvement 分界）
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000, unit: 'ms', label: '最大內容繪製' },
  CLS: { good: 0.1, poor: 0.25, unit: '', label: '累計版面配置位移' },
  TBT: { good: 200, poor: 600, unit: 'ms', label: '總阻塞時間（INP 的實驗室代理指標）' },
  FCP: { good: 1800, poor: 3000, unit: 'ms', label: '首次內容繪製' },
};
const verdict = (metric, v) => {
  const t = THRESHOLDS[metric];
  if (!t) return '';
  return v <= t.good ? 'good' : v <= t.poor ? 'needs-improvement' : 'POOR';
};

async function run(strategy) {
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', URL_);
  api.searchParams.set('strategy', strategy);
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) api.searchParams.append('category', c);
  api.searchParams.set('key', KEY);

  const res = await fetch(api, { signal: AbortSignal.timeout(180_000) });
  const data = await res.json();
  if (data.error) throw new Error(`${strategy}: HTTP ${data.error.code} ${data.error.message}`);

  const lr = data.lighthouseResult;
  const a = lr.audits;
  const num = (id) => a[id]?.numericValue ?? null;

  const metrics = {
    LCP: num('largest-contentful-paint'),
    CLS: num('cumulative-layout-shift'),
    TBT: num('total-blocking-time'),
    FCP: num('first-contentful-paint'),
    SI: num('speed-index'),
  };

  // 慢請求：build 期該解決的外部依賴通常在這裡現形
  const reqs = (a['network-requests']?.details?.items ?? [])
    .map((r) => ({ url: r.url, ms: Math.round((r.networkEndTime ?? 0) - (r.networkRequestTime ?? 0)) }))
    .filter((r) => r.ms > 0)
    .sort((x, y) => y.ms - x.ms)
    .slice(0, 5);

  // 整齊的逾時值（≥9.9 秒且彼此接近）＝外部資源在慢速網路下逾時，不是「有點慢」
  const timeouts = reqs.filter((r) => r.ms >= 9900);

  return {
    strategy,
    scores: Object.fromEntries(['performance', 'seo', 'accessibility', 'best-practices']
      .filter((c) => lr.categories[c])
      .map((c) => [c, Math.round(lr.categories[c].score * 100)])),
    metrics,
    field: data.loadingExperience?.overall_category ?? null, // CrUX 真實使用者資料
    slowest: reqs,
    timeouts,
  };
}

const strategies = STRATEGY === 'both' ? ['mobile', 'desktop'] : [STRATEGY];
const results = [];
for (const s of strategies) {
  try { results.push(await run(s)); }
  catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}

if (AS_JSON) {
  console.log(JSON.stringify({ url: URL_, keyEnv: KEY_ENV, results }, null, 2));
} else {
  console.log(`\nPageSpeed Insights：${URL_}　（配額計入 ${KEY_ENV}）`);
  for (const r of results) {
    console.log(`\n── ${r.strategy} ──`);
    console.log('  分數：' + Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join('｜'));
    for (const [k, v] of Object.entries(r.metrics)) {
      if (v == null) continue;
      const shown = k === 'CLS' ? v.toFixed(3) : `${(v / 1000).toFixed(1)}s`;
      const vd = verdict(k, v);
      const mark = vd === 'POOR' ? '✗' : vd === 'good' ? '✓' : '!';
      console.log(`  ${mark} ${k.padEnd(4)} ${shown.padStart(8)}  ${vd ? `[${vd}]` : ''} ${THRESHOLDS[k]?.label ?? ''}`);
    }
    console.log(`  真實使用者資料（CrUX）：${r.field ?? '無——流量不足，屬正常，此時只能看實驗室數據'}`);
    if (r.timeouts.length) {
      console.log(`  ⚠ ${r.timeouts.length} 個外部請求逾時（≈10 秒整）——這是逾時不是「慢」：`);
      for (const t of r.timeouts.slice(0, 3)) console.log(`      ${t.ms}ms  ${t.url.slice(0, 76)}`);
      console.log('      修法：把這類 client-side fetch 搬到 build 期（同時解掉爬蟲看不到內容的問題）');
    } else if (r.slowest.length) {
      console.log(`  最慢請求：${r.slowest[0].ms}ms  ${r.slowest[0].url.slice(0, 66)}`);
    }
  }
  console.log('\n⚠ Lighthouse 的 SEO 分數只看表層（meta／robots／可爬性）——');
  console.log('  它不會告訴你「內容根本不在 HTML 裡」或「h2 掛零」。那些跑 seo-check.mjs。\n');
}
