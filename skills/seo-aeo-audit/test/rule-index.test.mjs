/*
 * SKILL.md〈完整規則索引〉與檢核器的一致性守衛。
 *
 * 為什麼需要它：索引第一版宣稱「一條不漏」，實際漏了 4 條
 * （L1-DESC-SHORT、L2-THIN-CONTENT、L2-TEMPLATE-NOT-RENDERED、L2-ICON-LIGATURE-TEXT）。
 *
 * 漏得有系統性——四條全都是**嚴重度隨條件變動**的規則：
 *     add(isNoindex ? 'info' : 'warn', 'L1-DESC-SHORT', …)
 * 當時的抽取腳本寫成 add\('(error|warn|info)',\s*'CODE'，只認字面值的第一引數，
 * 於是整類條件式規則對它是隱形的。**而驗證腳本共用同一個假設**，
 * 所以「雙向驗過、零漏列」得到的通過毫無意義。
 *
 * > 用有相同盲點的工具去驗證，等於沒驗。
 *
 * 所以這支測試**不預設第一個引數的形狀**：依括號深度切出 add() 的頂層引數，
 * 只看第二個。新增規則卻沒補進索引時，它會失敗並指名漏了哪幾條。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/rule-index.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'seo-check.mjs');
const SKILL = join(HERE, '..', 'SKILL.md');

/** 從 add( 之後開始，依括號深度與引號狀態切出頂層引數 */
function topLevelArgs(text, start) {
  let depth = 0, cur = '', out = [], quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if ('([{'.includes(c)) { depth++; cur += c; continue; }
    if (')]}'.includes(c)) {
      if (depth === 0) { out.push(cur); return out; }
      depth--; cur += c; continue;
    }
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  return out;
}

const src = readFileSync(CHECKER, 'utf8');
const skill = readFileSync(SKILL, 'utf8');

const emitted = new Set();
const templated = [];
for (const m of src.matchAll(/\badd\(/g)) {
  const args = topLevelArgs(src, m.index + 4);
  if (args.length < 2) continue;
  const lit = args[1].trim().match(/^['"`]([A-Z][A-Z0-9-]+)['"`]$/);
  if (lit) { emitted.add(lit[1]); continue; }
  /* 樣板字串組成的代碼（`${code}-MISSING`）無法靜態展開，另外列出提醒人工確認 */
  if (/\$\{/.test(args[1])) templated.push(args[1].trim().slice(0, 60));
}

const indexSection = skill.match(/## 完整規則索引([\s\S]*?)\n## /)?.[1] ?? '';
if (!indexSection) {
  console.log('❌ 在 SKILL.md 找不到〈完整規則索引〉章節');
  process.exit(1);
}
const listed = new Set(
  [...indexSection.matchAll(/`((?:L1|L2|L3|SITE)-[A-Z0-9-]+)`/g)].map((m) => m[1]),
);

const missing = [...emitted].filter((c) => !listed.has(c)).sort();
const ghost = [...listed].filter((c) => !emitted.has(c)).sort();

/* 索引開頭宣稱的數字也要對得上——那是 README 引用的來源 */
const claimed = indexSection.match(/\*\*(\d+)\s*條規則\*\*：L1\s*(\d+)／L2\s*(\d+)／L3\s*(\d+)／SITE\s*(\d+)/);
const actual = { L1: 0, L2: 0, L3: 0, SITE: 0 };
for (const c of emitted) actual[c.split('-')[0]]++;
const countOk = claimed
  && +claimed[1] === emitted.size
  && +claimed[2] === actual.L1 && +claimed[3] === actual.L2
  && +claimed[4] === actual.L3 && +claimed[5] === actual.SITE;

let failed = 0;
const check = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok && detail) console.log(detail);
};

check(missing.length === 0, `檢核器會報的規則都在索引裡（${emitted.size} 條）`,
  `   漏列：\n${missing.map((c) => `     ${c}`).join('\n')}`);
check(ghost.length === 0, '索引沒有幽靈條目（列了但檢核器不會報）',
  `   幽靈：\n${ghost.map((c) => `     ${c}`).join('\n')}`);
check(Boolean(countOk), '索引開頭的計數與實際相符',
  `   索引寫：${claimed ? claimed[0] : '(找不到計數那一行)'}\n`
  + `   實際：**${emitted.size} 條規則**：L1 ${actual.L1}／L2 ${actual.L2}／L3 ${actual.L3}／SITE ${actual.SITE}`);

/* 小節標題也帶數字（### L2 內容結構（29）），一樣會漂。
   這一條是補的：上一版只驗開頭那行總計，於是總計改成 56、小節標題還留著
   「L2 內容結構（23）」——索引裡同時存在兩個互相矛盾的數字，而守衛說通過。
   **文件裡有幾個地方寫了數字，就要驗幾個地方。** */
const SECTION = /^### (L1|L2|L3|SITE)\s[^（(]*[（(](\d+)[）)]/gm;
const badSections = [];
for (const m of indexSection.matchAll(SECTION)) {
  if (+m[2] !== actual[m[1]]) badSections.push(`${m[0].trim()} → 實際 ${actual[m[1]]}`);
}
check(badSections.length === 0, '各層小節標題的計數與實際相符',
  badSections.map((s) => `      ${s}`).join('\n'));

/*
 * 出處與已查證主題的筆數，文件裡也寫了——一樣會漂。
 *
 * 這一段是補的（2026-08-18）：加了一筆 spam-policies 之後 sources.json 變成
 * 19 筆，而中英 README 都還寫著「18 筆」。規則索引漂過一次、小節標題漂過
 * 一次、現在是出處筆數，**同一類錯誤第三次**。所以照上面那句話辦：
 * 文件裡有幾個地方寫了數字，就要驗幾個地方。
 *
 * 找不到宣稱時**判失敗，不是跳過**。有人改寫句子而守衛靜靜失效，
 * 比守衛報錯糟得多——那正是這支測試存在的原因。
 */
const ROOT = join(HERE, '..', '..', '..');
const ledgers = [
  { file: join(ROOT, 'watch', 'sources.json'), key: 'sources', label: 'sources.json' },
  { file: join(ROOT, 'watch', 'investigated.json'), key: 'topics', label: 'investigated.json' },
];
const counts = {};
for (const l of ledgers) counts[l.label] = JSON.parse(readFileSync(l.file, 'utf8'))[l.key].length;

const claims = [
  { doc: 'README.md', ledger: 'sources.json', re: /sources\.json[^\n]*?有\s*(\d+)\s*筆/ },
  { doc: 'README.md', ledger: 'investigated.json', re: /investigated\.json[^\n]*?\n?[^\n]*?（目前\s*(\d+)\s*筆）/ },
  { doc: 'README.en.md', ledger: 'sources.json', re: /sources\.json[^\n]*?holds all\s*(\d+)/ },
  { doc: 'README.en.md', ledger: 'investigated.json', re: /investigated\.json[^\n]*?\n?[^\n]*?\((\d+) so far\)/ },
];
const badClaims = [];
for (const c of claims) {
  const text = readFileSync(join(ROOT, c.doc), 'utf8');
  const m = text.match(c.re);
  if (!m) { badClaims.push(`${c.doc}：找不到 ${c.ledger} 的筆數宣稱（句子被改寫了？守衛要一起更新）`); continue; }
  if (+m[1] !== counts[c.ledger]) badClaims.push(`${c.doc}：${c.ledger} 寫 ${m[1]} 筆，實際 ${counts[c.ledger]} 筆`);
}
check(badClaims.length === 0,
  `文件宣稱的出處筆數與實際相符（sources ${counts['sources.json']}／investigated ${counts['investigated.json']}）`,
  badClaims.map((s) => `      ${s}`).join('\n'));

/*
 * 測試檔清單也要對得上。
 *
 * SKILL.md〈測試〉那節原本只列 2 支並寫「所有檢查點裡只有這兩條有測試」，
 * 而目錄裡已經有 5 支——其中兩支還是同一天加的。那句話從描述變成錯誤陳述，
 * 而它偏偏是在解釋「哪些規則值得寫測試」的判準，讀者最容易當真的地方。
 */
const testFiles = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort();
/* ⚠ 檔名含數字：`i18n-dict.test.mjs`。第一版寫 [a-z-]+ 就把它漏掉了，
   於是守衛報「SKILL.md 沒列 i18n-dict」而 SKILL.md 明明列了——
   **一支專門抓漏配的測試，自己犯了漏配。** 字元類要含 0-9。 */
const listedTests = [...new Set(
  [...skill.matchAll(/test\/([a-z0-9-]+)\.test\.mjs/g)].map((m) => `${m[1]}.test.mjs`),
)].sort();
const unlisted = testFiles.filter((f) => !listedTests.includes(f));
check(unlisted.length === 0, `SKILL.md 列出了全部 ${testFiles.length} 支測試`,
  `      未列出：${unlisted.join('、')}`);

if (templated.length) {
  console.log(`\nℹ 有 ${templated.length} 處代碼由樣板字串組成，無法靜態展開，請人工確認已列入索引：`);
  [...new Set(templated)].forEach((t) => console.log(`     ${t}`));
}

console.log(failed ? `\n${failed} 項未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
