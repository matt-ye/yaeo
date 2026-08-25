/*
 * noindex 頁的規則降級判準測試。
 *
 * 這份檢核器一直有「noindex 不報成 error」的原則，但套得不均勻：
 * `L2-CLIENT-RENDERED` 會改報 `-NOINDEX` 變體、`L2-THIN-CONTENT` 會降 info、
 * `L1-DESC-SHORT` 也降 info——**可是同一個欄位的 `L1-DESC-MISSING` 仍報 error**。
 * 同一個原則、同一個 meta 欄位，兩套標準。
 *
 * 降級的判準只有一句話：**這條規則的後果是不是只發生在搜尋結果裡。**
 *   · 是 → noindex 頁降 info（它不是沒修，是本來就不適用）
 *   · 否 → 維持原級別
 *
 * ⚠ **這支測試存在的主要理由是下半部的反向斷言：OG 不降。**
 * noindex 擋的是**索引**，不是**分享**。unlisted 頁往往正是靠連結傳播——
 * 貼到 Slack／Threads 的預覽卡長什麼樣，對這種頁反而比對一般頁更重要。
 * 「搜尋看不到 → 分享也不重要」是不成立的推論，但它很順口，
 * 所以下一個看到這段程式碼的人很可能會「順手把 OG 一起降掉」。
 * 沒有斷言守著，這個判斷撐不過一次重構。
 *
 * 另一個要守的是**降級不等於消音**：降成 info 之後那幾條仍然要出現在報告裡。
 * 若哪天有人把它們改成完全不報，「刻意 noindex」與「該修卻沒修」就再也分不開，
 * 而這份檢核器是靠 error 歸零當驗收標準的。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/noindex-downgrade.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-noindex-downgrade-test');

/* 各部件分開，方便逐一抽掉來觸發單一規則 */
const PARTS = {
  desc: '<meta name="description" content="A fixture page for the noindex downgrade check, written long enough that the description-length rule stays quiet and only the rule under test speaks up.">',
  canonical: '<link rel="canonical" href="https://example.com/">',
  og: `<meta property="og:title" content="Noindex downgrade fixture">
<meta property="og:description" content="A fixture page used to verify that Open Graph rules are not downgraded on noindex pages.">
<meta property="og:image" content="https://example.com/og.png">`,
  jsonld: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Noindex downgrade fixture"}</script>',
  links: `<nav><a href="/about/">About</a> <a href="/writing/">Writing</a> <a href="/contact/">Contact</a></nav>`,
};

const BODY_TEXT = `<p>This fixture carries enough ordinary prose that the thin-content rule does not
  fire and drown out the signal we actually care about. The checker is being asked a narrow question:
  when a page declares noindex, which findings stop being real problems, and which ones keep mattering
  exactly as much as before. Search visibility disappears; the ability to share a link does not.</p>`;

/** 組一個頁面，omit 裡列到的部件會被拿掉 */
function page({ noindex = false, omit = [] } = {}) {
  const part = (k) => (omit.includes(k) ? '' : PARTS[k]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Noindex downgrade fixture page</title>
${noindex ? '<meta name="robots" content="noindex">' : ''}
${part('desc')}
${part('canonical')}
${part('og')}
${part('jsonld')}
</head><body><main><h1>Noindex downgrade fixture</h1>${BODY_TEXT}${part('links')}</main></body></html>`;
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

/*
 * 每一列：拿掉某個部件，比對「一般頁」與「noindex 頁」上同一條規則的級別。
 * downgraded: true  → noindex 時應為 info
 * downgraded: false → noindex 時應**維持原級別**（反向斷言）
 */
const CASES = [
  { code: 'L1-DESC-MISSING', omit: ['desc'], indexed: 'error', downgraded: true,
    why: 'description 只作用於 SERP，noindex 頁不會出現在 SERP' },
  { code: 'L1-CANONICAL-MISSING', omit: ['canonical'], indexed: 'warn', downgraded: true,
    why: 'canonical 是合併索引訊號用的，noindex 頁沒有訊號要合併' },
  { code: 'L2-JSONLD-MISSING', omit: ['jsonld'], indexed: 'warn', downgraded: true,
    why: '複合式結果與 AI 引用都以「已被索引」為前提' },
  { code: 'L2-NO-INTERNAL-LINKS', omit: ['links'], indexed: 'error', downgraded: true,
    why: '孤島頁的索引面傷害消失，只剩讀者動線（UX 不在本檢核器範圍）' },

  /* ── 反向斷言：以下三條在 noindex 頁上**必須維持 warn** ── */
  { code: 'L1-OG-TITLE-MISSING', omit: ['og'], indexed: 'warn', downgraded: false,
    why: '⟲ noindex 擋索引不擋分享；unlisted 頁靠連結傳播，預覽卡反而更重要' },
  { code: 'L1-OG-DESC-MISSING', omit: ['og'], indexed: 'warn', downgraded: false,
    why: '⟲ 同上' },
  { code: 'L1-OG-IMAGE-MISSING', omit: ['og'], indexed: 'warn', downgraded: false,
    why: '⟲ 同上' },
];

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failed++; if (detail) console.log(detail); }
};

for (const c of CASES) {
  const want = c.downgraded ? 'info' : c.indexed;
  const gotIndexed = levelOf(findingsFor(page({ noindex: false, omit: c.omit })), c.code);
  const gotNoindex = levelOf(findingsFor(page({ noindex: true, omit: c.omit })), c.code);

  check(gotIndexed === c.indexed,
    `${c.code}：一般頁報 ${c.indexed}`,
    `      實際 ${gotIndexed ?? '（完全沒報）'} —— 樣本可能沒觸發到這條規則，先確認樣本`);

  check(gotNoindex === want,
    `${c.code}：noindex 頁${c.downgraded ? `降 ${want}` : `**維持 ${want}**`} —— ${c.why}`,
    `      實際 ${gotNoindex ?? '（完全沒報）'}，期望 ${want}` +
    (c.downgraded ? '' : '\n      ⚠ OG 被降級了。noindex 擋的是索引，不是分享——這條降級不成立，請還原。'));
}

/* 降級 ≠ 消音：降成 info 的那幾條仍必須出現在報告裡 */
const noindexAll = findingsFor(page({ noindex: true, omit: ['desc', 'canonical', 'jsonld', 'links'] }));
const silenced = CASES.filter((c) => c.downgraded).map((c) => c.code)
  .filter((code) => !noindexAll.some((x) => x.code === code));
check(silenced.length === 0,
  '降級不等於消音：四條降級規則在 noindex 頁上仍然出現在報告裡',
  `      消失了：${silenced.join('、')}\n      ——「刻意 noindex」與「該修卻沒修」必須還分得開，否則 error 歸零就不再是有效的驗收標準`);

/* noindex 頁本身仍要留下一筆紀錄 */
check(noindexAll.some((x) => x.code === 'L1-NOINDEX'),
  'noindex 頁仍報 L1-NOINDEX（唯一提示「這頁刻意不進索引」的訊號）',
  '      L1-NOINDEX 不見了——降級之後它是報告上唯一還在提醒 noindex 的東西');

/*
 * 站層級的補位：SITE-NOINDEX-UNLISTED。
 *
 * 降級之後 noindex 頁不再產生 error，被**誤標**的頁面因此沒有警訊——
 * 除非它同時還留在 sitemap 裡（那由 SITE-SITEMAP-NOINDEX-CONFLICT 接住）。
 * 兩者都不成立時就是缺口，這條補的就是它。
 *
 * 它**刻意不帶閾值**：不問「多少比例算異常」，只把清單攤開讓人逐一確認。
 * 所以級別是 info——它報的是正常狀態，不是叫人去修。
 * 反向斷言同樣重要：一般頁不可以誤報，否則每份報告都會多一條無意義的雜訊。
 */
const UNLISTED = 'SITE-NOINDEX-UNLISTED';
const noindexSite = findingsFor(page({ noindex: true }));
const indexedSite = findingsFor(page({ noindex: false }));

check(levelOf(noindexSite, UNLISTED) === 'info',
  `${UNLISTED}：noindex 且不在 sitemap 的頁面報 info（降級後唯一還看得到它們的地方）`,
  `      實際 ${levelOf(noindexSite, UNLISTED) ?? '（完全沒報）'}，期望 info`);

check(levelOf(indexedSite, UNLISTED) === null,
  `⟲ 反向：一般頁不報 ${UNLISTED}（否則每份報告都多一條雜訊）`,
  `      實際報了 ${levelOf(indexedSite, UNLISTED)} —— 這條只該對 noindex 頁說話`);

/* 訊息裡要有實際路徑：這條的全部價值就是「能一眼掃過去」，
   只給數字等於沒補這個缺口 */
const unlistedMsg = (noindexSite.find((x) => x.code === UNLISTED) ?? {}).msg ?? '';
check(/index\.html|\/(?=[^\s])|\//.test(unlistedMsg) && unlistedMsg.length > 20,
  `${UNLISTED} 的訊息帶出實際頁面路徑，不是只給一個數字`,
  `      訊息：${unlistedMsg || '（空）'}`);

console.log(failed ? `\n${failed} 項未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
