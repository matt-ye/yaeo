/*
 * data-i18n ＋ JS 字典這一類雙語機制的判準測試。
 *
 * 為什麼需要：這是第三種雙語機制，前兩種（成對 span、lang 標記）現有規則
 * 都看得到，這種完全看不到。實際漏過一次——某頁英文版主標題整句是中文，
 * 三個月沒被任何檢查抓到，因為它的表現形式是「欄位有填、內容是中文」。
 *
 * 這支測試一半是**反向斷言**，各自防一種很容易被「順手補上」的錯：
 *
 *   ① zh == en 不該報。實測某站兩頁共 5 個相同的鍵，全部是專有名詞或本來
 *      就是英文的標籤（One More Step、AW#33 RFS、DATA、OPINION）——誤報率 100%。
 *      一個全部命中都不用改的訊號不該存在。
 *
 *   ② 中文字典裡有拉丁字母不該報。品牌名、程式碼、縮寫在中文頁是常態，
 *      方向反過來套會整批誤判（同 L1-LANG-CONTENT-MISMATCH 的不對稱判準）。
 *
 *   ③ 字典裡有巢狀物件時，鍵數要算對。這一條是實際踩過的：原本用
 *      /zh:\s*\{([\s\S]*?)\n\s*\},?\s*\n\s*en:/ 抽取，非貪婪遇到巢狀物件會
 *      **提早截斷**，於是憑空生出「鍵集不對稱」的假象——我拿那個假象當成
 *      真問題回報過。所以改用括號配對，並用這個情境把它釘住。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/i18n-dict.test.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const ROOT = join(tmpdir(), 'yaeo-i18n-dict-test');

const page = (bodyKeys, dict) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<title>i18n 字典判準測試</title>
<meta name="description" content="data-i18n 與 JS 字典的判準測試用頁面，描述寫足長度以免其他規則的訊息混進判定。">
<link rel="canonical" href="https://example.com/"></head><body><main>
<h1 data-i18n="heroTitle">預設標題</h1>
${bodyKeys.map((k) => `<p data-i18n="${k}">預設文字</p>`).join('\n')}
<p>一段足夠長的中文正文，讓這一頁不會因為內容太少而觸發其他規則，把判定弄得難讀。</p>
</main><script>
const I = ${dict};
</script></body></html>`;

const good = `{
  zh: { heroTitle: "職涯四公式", secA: "資料", secB: "觀點", backLabel: "One More Step" },
  en: { heroTitle: "Four Career Formulas", secA: "DATA", secB: "OPINION", backLabel: "One More Step" }
}`;

/* en 的值仍是中文——欄位有填，但沒翻 */
const untranslated = `{
  zh: { heroTitle: "職涯四公式", secA: "資料", secB: "觀點", backLabel: "One More Step" },
  en: { heroTitle: "職涯四公式：才幹、人脈、領導與傳承", secA: "DATA", secB: "OPINION", backLabel: "One More Step" }
}`;

/* 中文字典裡大量拉丁字母：品牌名、程式碼。**必須不報** */
const zhWithLatin = `{
  zh: { heroTitle: "用 Astro 與 Cloudflare Pages 建站", secA: "JSON-LD 與 canonical", secB: "GitHub Actions", backLabel: "One More Step" },
  en: { heroTitle: "Building with Astro and Cloudflare Pages", secA: "JSON-LD and canonical", secB: "GitHub Actions", backLabel: "One More Step" }
}`;

/* 字典裡有巢狀物件——括號配對要能跨過它，非貪婪正則會在這裡截斷 */
const nested = `{
  zh: {
    heroTitle: "職涯四公式",
    meta: { author: "作者", date: "日期" },
    secA: "資料",
    secB: "觀點",
    backLabel: "One More Step"
  },
  en: {
    heroTitle: "Four Career Formulas",
    meta: { author: "Author", date: "Date" },
    secA: "DATA",
    secB: "OPINION",
    backLabel: "One More Step"
  }
}`;

/* 鍵集真的不對稱：en 少了 secB */
const asymmetric = `{
  zh: { heroTitle: "職涯四公式", secA: "資料", secB: "觀點", backLabel: "One More Step" },
  en: { heroTitle: "Four Career Formulas", secA: "DATA", backLabel: "One More Step" }
}`;

/* i18next 風格：本規則認不得，必須明說「未檢查」而不是靜默通過 */
const foreignShape = `{
  resources: { translation: { heroTitle: "Four Career Formulas", secA: "DATA", secB: "OPINION" } }
}`;

const CASES = [
  { name: 'en 字典值仍是中文 → 該報 warn（UNTRANSLATED）',
    keys: ['secA', 'secB', 'backLabel'], dict: untranslated,
    expect: { code: 'L2-I18N-DICT-UNTRANSLATED', level: 'warn' } },

  { name: 'data-i18n 用了字典沒有的鍵 → 該報 warn（KEY-MISMATCH）',
    keys: ['secA', 'secB', 'backLabel', 'ghostKey'], dict: good,
    expect: { code: 'L2-I18N-DICT-KEY-MISMATCH', level: 'warn' } },

  { name: '鍵集真的不對稱（en 少一鍵）→ 該報 info（KEY-MISMATCH）',
    keys: ['secA', 'secB', 'backLabel'], dict: asymmetric,
    expect: { code: 'L2-I18N-DICT-KEY-MISMATCH', level: 'info' } },

  { name: '有 data-i18n 但字典格式認不得 → 該明說未檢查（UNCHECKED）',
    keys: ['secA', 'secB', 'backLabel'], dict: foreignShape,
    expect: { code: 'L2-I18N-DICT-UNCHECKED', level: 'info' } },

  { name: '⟲ 反向：zh == en 但值是專有名詞／英文標籤 → 必須不報',
    keys: ['secA', 'secB', 'backLabel'], dict: good, expect: null },

  { name: '⟲ 反向：中文字典裡有品牌名與程式碼 → 必須不報',
    keys: ['secA', 'secB', 'backLabel'], dict: zhWithLatin, expect: null },

  { name: '⟲ 反向：字典含巢狀物件，鍵數要算對、不得誤報不對稱',
    keys: ['secA', 'secB', 'backLabel'], dict: nested, expect: null },
];

let failed = 0;
for (const c of CASES) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, 'index.html'), page(c.keys, c.dict), 'utf8');

  let out = '';
  try {
    out = execFileSync(process.execPath, [CHECKER, '--dir', ROOT, '--json'], { encoding: 'utf8' });
  } catch (err) { out = (err.stdout ?? '') + (err.stderr ?? ''); }

  let hits;
  try {
    hits = (JSON.parse(out).findings ?? []).filter((x) => x.code.startsWith('L2-I18N-DICT'));
  } catch { hits = undefined; }

  let ok;
  if (hits === undefined) ok = false;
  else if (c.expect === null) ok = hits.length === 0;
  else ok = hits.some((h) => h.code === c.expect.code && h.level === c.expect.level);

  console.log(`${ok ? '✅' : '❌'} ${c.name}`);
  if (!ok) {
    failed++;
    console.log(`   預期：${c.expect ? `${c.expect.level} ${c.expect.code}` : '不報'}`);
    console.log(`   實得：${hits === undefined ? 'JSON 解析失敗'
      : hits.length ? hits.map((h) => `${h.level} ${h.code} — ${h.msg.slice(0, 70)}`).join(' ／ ') : '不報'}`);
  }
}

rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `\n${failed} 個情境未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
