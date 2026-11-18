/*
 * `L2-FAKE-HEADING` 的判準測試。
 *
 * 這條規則抓的是「視覺像標題、語意不是」：`<p class="section-title">標題</p>`。
 * 第一版只看 class 名稱，於是把**包住真正標題的容器**也報成 error：
 *
 *   <div class="section-title"><h3>我的專屬申請清單</h3><span>已收錄 0 項</span></div>
 *
 * 裡面已經是 `<h3>`，結構完全正確。實測在 OpenGSA 上線前的審核裡，
 * 這是整份報告**唯一剩下的 error**——誤判出現在驗收標準（error 歸零）上，
 * 代價是讓人以為網站沒修好，或為了讓工具變綠去改一個本來正確的結構。
 *
 * ⚠ 修誤判最容易的假解法是把規則放寬到不再觸發，所以下半部的反向斷言要守住：
 * 真正冒充標題的 `<p>`／`<div>` 仍然要報 error，卡片標題仍然要報 info。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/fake-heading.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-fake-heading-test');

const BODY_TEXT = `<p>This fixture carries enough ordinary prose that the thin-content rule does not fire.
  The checker is asked one narrow question: does an element that only looks like a heading get
  reported, and does a container that already wraps a real heading stay quiet.</p>`;

function page(fragment) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Fake heading fixture page</title>
</head><body><main><h1>Fake heading fixture</h1>${BODY_TEXT}${fragment}</main></body></html>`;
}

function findingsFor(html) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, 'index.html'), html, 'utf8');
  let out = '';
  try {
    out = execFileSync(process.execPath, [CHECKER, '--dir', ROOT, '--json'], { encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout ?? '') + (err.stderr ?? '');
  }
  try {
    return JSON.parse(out).findings ?? [];
  } catch {
    console.log('      檢核器輸出無法解析為 JSON：', out.slice(0, 300));
    return [];
  }
}

const levelOf = (fs, code) => (fs.find((x) => x.code === code) ?? {}).level ?? null;

const CASES = [
  /* ── 容器裡已經有真正的標題：不報 ── */
  { label: '區塊容器包住 <h3>（實際誤判的樣子）',
    html: '<div class="section-title"><h3>我的專屬申請清單</h3><span class="result-meta">已收錄 0 項方案</span></div>',
    code: 'L2-FAKE-HEADING', want: null },
  { label: '區塊容器包住 <h2>，標籤帶屬性',
    html: '<div class="section-heading"><h2 id="x">Programmes</h2></div>',
    code: 'L2-FAKE-HEADING', want: null },
  { label: '卡片標題容器包住 <h4>',
    html: '<div class="card-title"><h4>Card heading</h4></div>',
    code: 'L2-TITLE-NOT-HEADING', want: null },

  /* ── 反向斷言：真正冒充標題的仍要報 ── */
  { label: '⟲ <p class="section-title"> 純文字仍報 error',
    html: '<p class="section-title">我的專屬申請清單</p>',
    code: 'L2-FAKE-HEADING', want: 'error' },
  { label: '⟲ <div class="section-title"> 純文字仍報 error',
    html: '<div class="section-title">Programmes</div>',
    code: 'L2-FAKE-HEADING', want: 'error' },
  { label: '⟲ 卡片標題純文字仍報 info',
    html: '<div class="card-title">Card heading</div>',
    code: 'L2-TITLE-NOT-HEADING', want: 'info' },
];

let failed = 0;
for (const c of CASES) {
  const got = levelOf(findingsFor(page(c.html)), c.code);
  const ok = got === c.want;
  console.log(`${ok ? '✓' : '✗'} ${c.label}：${c.code} ${c.want ?? '不報'}`);
  if (!ok) {
    failed++;
    console.log(`      實際 ${got ?? '（不報）'}，期望 ${c.want ?? '（不報）'}`);
  }
}

console.log(failed ? `\n${failed} 項失敗` : `\n全部 ${CASES.length} 項通過`);
process.exit(failed ? 1 : 0);
