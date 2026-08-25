/*
 * L3-GEO-SIGNALS-* 裡「直接引言」的偵測判準測試。
 *
 * 這條規則原本只認 blockquote／q 標籤與中文引號「」『』（8 字以上）。
 * 拉丁引號 "…" 完全不算，於是踩到一個很有代表性的盲區：
 *
 *   同一門課的投資週次頁，中文版引言 18–27 處、英文版 0 處。
 *   內容是同一份，翻譯時把「」換成 "…"，整批訊號就消失了。
 *   26 頁英文課程頁裡 24 頁被誤報成「缺直接引言」，
 *   而它們其實各有 21–23 處引言。
 *
 * > **同一份內容的兩個語言版本結果差這麼多，該先懷疑量測而不是內容。**
 *
 * 這支測試守兩件事，而**第二件比第一件重要**：
 *   ① 拉丁引號要算得到（正向）
 *   ② 長度門檻分中西兩套，且**短引號不可以算**（反向）
 *
 * ② 是因為門檻不能共用：中文一字一義，8 字已是短句；8 個拉丁字元只有
 * 一兩個單字。若有人「順手把中文那個 8 拿來用」，`"the fund"`、`"risk-free"`
 * 這種強調用法會全部變成引言，這條規則就再也沒有訊號可言——
 * 而它是 info 級，壞掉不會有人立刻發現。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/geo-quote-detection.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-geo-quote-test');

/* 頁面必須是 Article 型才會進 GEO 區塊；外部引用與統計都備齊，
   讓「缺直接引言」成為唯一可能的缺項——這樣斷言才指向引言本身。 */
const LD = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Article',
  headline: 'Quote detection fixture', datePublished: '2026-08-26',
  author: { '@type': 'Person', name: 'Fixture Author' },
});

const CITATIONS = '<p>Sources: <a href="https://ocw.mit.edu/x/">MIT OpenCourseWare</a> and <a href="https://www.khanacademy.org/y/">Khan Academy</a>.</p>';
const STATS = '<p>報酬率 12.5%，樣本 1,200 人，追蹤 36 個月，成長 3 倍。</p>';

const page = (bodyExtra) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Quote detection fixture page</title>
<meta name="description" content="A fixture for the direct-quote detection check, long enough that the description rules stay quiet while the quote signal is isolated.">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Quote detection fixture">
<meta property="og:description" content="Fixture">
<meta property="og:image" content="https://example.com/og.png">
<script type="application/ld+json">${LD}</script>
</head><body><main><h1>Quote detection fixture</h1>
${CITATIONS}${STATS}${bodyExtra}
</main></body></html>`;

/* 40 字元以上的英文引言（實際 90 字元左右）——該算 */
const LONG_EN = `<p>As the report put it, "compounding is the mechanism that turns an ordinary savings rate into an extraordinary outcome over decades".</p>`;

/* 全部都是短引號的強調用法，最長 12 字元——**不該算** */
const SHORT_EN = `<p>The terms "the fund", "risk-free", "a drawdown" and "beta" appear throughout the chapter without being quotations of anyone.</p>`;

/* 撇號：don't / isn't / it's。兩兩配對會產生假引言——**不該算** */
const APOSTROPHES = `<p>It isn't obvious, and it doesn't have to be, that the market's behaviour can't be predicted from last year's returns alone by anyone who hasn't studied it.</p>`;

/* 中文長引言（8 字以上）——既有行為，該算 */
const LONG_ZH = `<p>報告寫著「複利是把平凡的儲蓄率變成不平凡結果的機制」，值得記住。</p>`;

/* 中文短引號（強調用法，未滿 8 字）——既有行為，不該算 */
const SHORT_ZH = `<p>本章反覆出現「基金」「無風險」「回檔」這幾個詞，都不是引述誰。</p>`;

const BLOCKQUOTE = `<blockquote>An explicit blockquote element.</blockquote>`;

function thinFinding(body) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, 'index.html'), page(body), 'utf8');
  let out = '';
  try {
    out = execFileSync(process.execPath, [CHECKER, '--dir', ROOT, '--site', 'https://example.com', '--json'], { encoding: 'utf8' });
  } catch (err) { out = (err.stdout ?? '') + (err.stderr ?? ''); }
  let findings = [];
  try { findings = JSON.parse(out).findings ?? []; }
  catch { console.log('      輸出無法解析：', out.slice(0, 200)); }
  return findings.find((x) => /^L3-GEO-SIGNALS-(THIN|NONE)$/.test(x.code)) ?? null;
}

/** 引言有沒有被算到：沒有 GEO finding ＝ 三項齊備 ＝ 引言算到了 */
const quotesDetected = (body) => {
  const hit = thinFinding(body);
  if (!hit) return true;
  return !/缺[^；]*直接引言/.test(hit.msg);
};

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failed++; if (detail) console.log(detail); }
};

const CASES = [
  { name: '英文長引言（90 字元）→ 算得到', body: LONG_EN, want: true,
    hint: '      拉丁引號沒被算到——這正是中英兩版結果不同的原因' },
  { name: '中文長引言（8 字以上）→ 算得到（既有行為不可退化）', body: LONG_ZH, want: true },
  { name: 'blockquote 標籤 → 算得到（既有行為不可退化）', body: BLOCKQUOTE, want: true },

  { name: '⟲ 反向：英文短引號（最長 12 字元的強調用法）→ 不可算', body: SHORT_EN, want: false,
    hint: '      門檻太鬆。若把中文的 8 直接套到拉丁字元，強調用法會全變成引言，這條規則就沒有訊號了' },
  { name: '⟲ 反向：中文短引號（未滿 8 字）→ 不可算（既有行為）', body: SHORT_ZH, want: false },
  { name: '⟲ 反向：撇號（isn\'t／doesn\'t／market\'s）→ 不可配對成假引言', body: APOSTROPHES, want: false,
    hint: '      單引號被算進去了——英文撇號會兩兩配對，整篇散文都會變成「引言」' },
];

for (const c of CASES) {
  const got = quotesDetected(c.body);
  check(got === c.want, c.name, c.hint || `      實際 ${got ? '算到了' : '沒算到'}，期望 ${c.want ? '算到' : '不算'}`);
}

/*
 * 中英對照：同一份內容、只換引號形式，結論必須一致。
 * 這是整支測試的核心——盲區就是從這個不對稱被發現的。
 */
const zhVersion = `<p>報告寫著「複利是把平凡的儲蓄率變成不平凡結果的機制，值得每個投資人記住」。</p>`;
const enVersion = `<p>The report says, "compounding is the mechanism that turns an ordinary savings rate into an extraordinary outcome, worth remembering".</p>`;
const zhOk = quotesDetected(zhVersion), enOk = quotesDetected(enVersion);
check(zhOk === enOk && zhOk === true,
  '中英對照：同一句引言換成另一種引號形式，判定結果一致',
  `      中文版 ${zhOk ? '算到' : '沒算到'}、英文版 ${enOk ? '算到' : '沒算到'}\n      ——不一致代表判準綁在書寫系統上，同一份內容會因語言得到不同結論`);

console.log(failed ? `\n${failed} 項未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
