/*
 * SKILL.md〈連線層〉規則表與 agent-check.mjs 的一致性守衛。
 *
 * 為什麼要有：這個 repo 的文件數字漂過三次（規則索引漏 4 條、小節標題與總計互相矛盾、
 * 出處筆數停在 18）。教訓寫在 rule-index.test.mjs 的檔頭：
 * **文件裡有幾個地方寫了數字，就要驗幾個地方。** 新增一支會報規則代碼的腳本，
 * 就得同時新增守著它的測試，否則第四次照樣會發生。
 *
 * ⚠ 抽取方式刻意**不看 add() 的引數位置**。rule-index.test.mjs 的前一版
 * 只認 add() 第一個引數是字面值的形狀，於是條件式嚴重度的規則整類隱形，
 * 而驗證腳本共用同一個盲點——「雙向驗過」得到的通過毫無意義。
 *
 * 這裡改成掃**所有被引號包住的 AGENT-* 字面值**：不管它出現在 add() 裡、
 * 陣列常數裡、還是日後某種新寫法裡都抓得到。註解裡的代碼沒有引號，不會誤計。
 *
 * 零相依，直接跑：node skills/seo-aeo-audit/test/agent-check-rules.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, '..', 'scripts', 'agent-check.mjs');
const SKILL = join(HERE, '..', 'SKILL.md');

const src = readFileSync(CHECKER, 'utf8');
const skill = readFileSync(SKILL, 'utf8');

/* 只認被引號包住的代碼——註解裡的 ── AGENT-SOFT-404 ── 沒有引號，不會混進來 */
const emitted = new Set([...src.matchAll(/['"`](AGENT-[A-Z0-9-]+)['"`]/g)].map((m) => m[1]));

const section = skill.match(/### 連線層：([\s\S]*?)(?=\n## |\n### |$)/)?.[1] ?? '';
if (!section) {
  console.log('❌ 在 SKILL.md 找不到〈連線層〉小節');
  process.exit(1);
}
const listed = new Set([...section.matchAll(/`(AGENT-[A-Z0-9-]+)`/g)].map((m) => m[1]));

const missing = [...emitted].filter((c) => !listed.has(c)).sort();
const ghost = [...listed].filter((c) => !emitted.has(c)).sort();

/* 小節裡寫的條數也要對得上 */
const claimed = section.match(/\*\*(\d+)\s*條規則\*\*/);

let failed = 0;
const check = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok && detail) console.log(detail);
};

check(missing.length === 0, `檢核器會報的規則都在〈連線層〉表裡（${emitted.size} 條）`,
  `   漏列：\n${missing.map((c) => `     ${c}`).join('\n')}`);
check(ghost.length === 0, '表裡沒有幽靈條目（列了但檢核器不會報）',
  `   幽靈：\n${ghost.map((c) => `     ${c}`).join('\n')}`);
check(Boolean(claimed) && +claimed[1] === emitted.size, '小節宣稱的條數與實際相符',
  `   SKILL.md 寫：${claimed ? claimed[0] : '(找不到「N 條規則」)'}\n   實際：${emitted.size} 條`);

/* agent-check.mjs 絕對不可以被搬進 seo-check.mjs 的離線世界，反之亦然。
   這條守的是分家的理由本身：seo-check 必須維持零 fetch。 */
const OFFLINE = join(HERE, '..', 'scripts', 'seo-check.mjs');
const offlineSrc = readFileSync(OFFLINE, 'utf8');
check(!/\bfetch\s*\(/.test(offlineSrc),
  'seo-check.mjs 仍然零 fetch（離線可重現，CI 不需連外）',
  '   有人把網路請求加進離線掃描器了——連線層的檢核屬於 agent-check.mjs');

console.log(failed ? `\n${failed} 項失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
