/*
 * L2-BILINGUAL-CONCAT 的判準測試。
 *
 * 這條規則本身很久沒問題——它報的數字一直是對的。有問題的是**那個數字
 * 把兩種修法完全不同的狀況混在一起**：
 *   ① 同一份內容的中英兩版同時在 DOM 裡 → 架構問題，要改成獨立語言 URL
 *   ② 英文頁上還沒翻譯的內容退回中文     → 內容進度，翻完自然消失
 *
 * 加判準時試錯兩次，兩次都是**靠標記判斷**：
 *   · 「有沒有 lang 屬性」→ 常見雙語元件兩半都帶 lang，會把 ① 一起消掉
 *   · 「兩邊都宣告且語言不同」→ 漏掉用 class="zh-only" 而不帶 lang 的手刻頁
 * 最後改成靠**內容**：相鄰兩元素，前者主要中日韓、後者主要拉丁。
 *
 * 所以這個測試的重點不是「數字對不對」，是**三種不同的標記方式都要判對**。
 *
 * 零相依：node skills/seo-aeo-audit/test/bilingual-concat.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-bilingual-test');

const page = (body) => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>雙語黏連判準測試</title><meta name="description" content="L2-BILINGUAL-CONCAT 判準測試用頁面，描述寫足長度以免其他規則的訊息混進判定。">
<link rel="canonical" href="https://example.com/"></head><body><main><h1>測試</h1>${body}</main></body></html>`;

/* 同一份內容的中英兩版並排——三種常見標記方式，全都該判成「架構」 */
const dualLang = `<p><span lang="zh-TW">首頁</span><span lang="en">Home</span></p>
  <p><span lang="zh-TW">演講</span><span lang="en">Speeches</span></p>
  <p><span lang="zh-TW">培訓</span><span lang="en">Coaching</span></p>`;
const dualClass = `<p><span class="zh-only">首頁</span><span class="en-only">Home</span></p>
  <p><span class="zh-only">演講</span><span class="en-only">Speeches</span></p>
  <p><span class="zh-only">培訓</span><span class="en-only">Coaching</span></p>`;
const dualBare = `<p><span>首頁</span><span>Home</span></p>
  <p><span>演講</span><span>Speeches</span></p>
  <p><span>培訓</span><span>Coaching</span></p>`;

/* 未翻譯的 fallback：中文標題後面接的是**不同的內容**（日期），不是它的英文版。
   中間隔著結束標籤，不是相鄰的兄弟元素。 */
const fallback = `<ul>
    <li><h2><a href="/a/"><span lang="zh-TW">競賽決賽現場的筆記</span></a></h2><span><time datetime="2026-07-05">Jul 5, 2026</time></span></li>
    <li><h2><a href="/b/"><span lang="zh-TW">四位評審教我的事</span></a></h2><span><time datetime="2026-06-05">Jun 5, 2026</time></span></li>
    <li><h2><a href="/c/"><span lang="zh-TW">通貨膨脹的本質</span></a></h2><span><time datetime="2026-05-05">May 5, 2026</time></span></li>
  </ul>`;

const CASES = [
  { name: 'lang 屬性標記的雙語 DOM', body: dualLang, expectArch: true },
  { name: 'class 標記的雙語 DOM（手刻頁，無 lang）', body: dualClass, expectArch: true },
  { name: '完全沒有標記的雙語 DOM', body: dualBare, expectArch: true },
  { name: '未翻譯的 fallback（中文標題 ＋ 英文日期）', body: fallback, expectArch: false },
];

let failed = 0;
for (const c of CASES) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, 'index.html'), page(c.body), 'utf8');

  let out = '';
  try {
    out = execFileSync(process.execPath, [CHECKER, '--dir', ROOT], { encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout ?? '') + (err.stderr ?? '');
  }

  const line = out.split('\n').find((l) => l.includes('處中英黏連')) ?? '';
  const sawArch = line.includes('雙語並存的元素對（');
  const sawContent = line.includes('沒有偵測到雙語並存的元素對');
  const ok = line && (c.expectArch ? sawArch : sawContent);

  console.log(`${ok ? '✅' : '❌'} ${c.name}`);
  if (!ok) {
    failed++;
    console.log(`   預期判成：${c.expectArch ? '架構（雙語 DOM）' : '內容進度（fallback）'}`);
    console.log(`   實得：${line.trim() || '(沒有觸發 L2-BILINGUAL-CONCAT)'}`);
  }
}

rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `\n${failed} 個情境未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
