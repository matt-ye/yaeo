/*
 * SITE-DEAD-INTERNAL-LINK 的回歸測試。
 *
 * 為什麼這條規則值得一個測試，而其他 56 條沒有：
 * 它曾經在採 clean URL 的靜態主機（Cloudflare Pages、Netlify、GitHub Pages）
 * 上誤判率 67%——連結寫 /gallery、輸出檔是 gallery.html，永遠對不上。
 * 而它是 **error** 級。一條 error 整批誤判，使用者會開始不相信整份報告。
 *
 * 它潛伏很久是因為開發時用的網站是 directory 輸出（/a/b/index.html），
 * 那個模式從第一版就是對的。**測試涵蓋的輸出模式比規則本身更重要。**
 *
 * 每個情境都埋一條真的死連結：修「誤判」最容易的假解法是把規則放寬到
 * 不再觸發，而那在報告上看起來和真正修好一模一樣。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/dead-link.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-deadlink-test');

const page = (title, body) => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${title}</title><meta name="description" content="SITE-DEAD-INTERNAL-LINK 回歸測試用頁面，描述寫足長度以免其他規則的訊息混進判定裡。">
<link rel="canonical" href="https://example.com/"></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

const put = (rel, html) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html, 'utf8');
};

const CASES = [
  {
    name: 'file 輸出 ＋ clean URL 連結',
    why: '回報的原始誤判：連結 /gallery、輸出檔 gallery.html',
    files: () => {
      put('index.html', page('首頁', `
        <a href="/gallery">clean URL</a>
        <a href="/gallery.html">完整檔名</a>
        <a href="/gallery/">尾斜線</a>
        <a href="/about">另一頁</a>
        <a href="/missing">真死連結</a>`));
      put('gallery.html', page('作品集', '<a href="/">回首頁</a>'));
      put('about.html', page('關於', '<a href="/">回首頁</a>'));
    },
    expect: ['/missing'],
  },
  {
    name: 'directory 輸出',
    why: '第一版唯一正確的模式，不能因為修 clean URL 而弄壞',
    files: () => {
      put('index.html', page('首頁', `
        <a href="/writing/hello/">尾斜線</a>
        <a href="/writing/hello">無尾斜線</a>
        <a href="/writing/hello/index.html">完整檔名</a>
        <a href="/nope/">真死連結</a>`));
      put('writing/hello/index.html', page('文章', '<a href="/">回首頁</a>'));
    },
    /* 注意是 /nope 不是 /nope/——內部連結在**收集階段**就把尾斜線剝掉了
       （見 seo-check.mjs 的 uniqueInternal）。第一版測試在這裡預期錯，
       是測試抓到我對程式的理解有誤，不是程式有問題。 */
    expect: ['/nope'],
  },
  {
    name: '混合輸出 ＋ 靜態檔 ＋ 百分比編碼路徑',
    why: '網址是編碼的、檔名不是——解碼要在比對檔案系統之前做',
    files: () => {
      put('index.html', page('首頁', `
        <a href="/doc.pdf">靜態檔</a>
        <a href="/caf%C3%A9">編碼路徑，目錄是 café</a>
        <a href="/notes">notes.html</a>
        <a href="/gone">真死連結</a>`));
      put('notes.html', page('筆記', '<a href="/">回首頁</a>'));
      put('café/index.html', page('咖啡', '<a href="/">回首頁</a>'));
      writeFileSync(join(ROOT, 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
    },
    expect: ['/gone'],
  },
];

let failed = 0;
for (const c of CASES) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  c.files();

  let out = '';
  try {
    out = execFileSync(process.execPath, [CHECKER, '--dir', ROOT], { encoding: 'utf8' });
  } catch (err) {
    /* 有 error 級發現時檢核器會以非零碼結束——那是預期行為，輸出仍要讀 */
    out = (err.stdout ?? '') + (err.stderr ?? '');
  }

  const line = out.split('\n').find((l) => l.includes('個站內連結指向')) ?? '';
  const found = [...line.matchAll(/(\/[^\s（]*)（\d+ 處）/g)].map((m) => m[1]).sort();
  const want = [...c.expect].sort();
  const ok = found.length === want.length && found.every((v, i) => v === want[i]);

  console.log(`${ok ? '✅' : '❌'} ${c.name}`);
  console.log(`   ${c.why}`);
  if (!ok) {
    failed++;
    console.log(`   預期：${want.join('、') || '(無)'}`);
    console.log(`   實得：${found.join('、') || '(無)'}`);
    console.log(`   原始行：${line.trim()}`);
  }
}

rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `\n${failed} 個情境未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
