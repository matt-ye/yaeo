/*
 * ③ 生態掃描
 *
 * ①②檢查的是「已知的依據有沒有壞掉」。這一項問的是不一樣的問題：
 * **有沒有出現我們還不知道的東西**——新的官方指引、新的研究結論、
 * 新的縮寫。這種事沒有可以比對的基準，只能讀。
 *
 * ⚠ 這裡是整個 repo 最危險的一步。這個 repo 的核心紀律是「每條規則都附出處」，
 *   而讓語言模型讀部落格再吐結論，正好是它反對的做法——模型會很樂意
 *   把一篇部落格的宣稱寫成一條規則。
 *
 *   所以本步驟的產物**明確定義為「線索」不是「規則」**：
 *     · 只列出「值得回去讀原文」的項目，一律附原始連結
 *     · 不改任何檔案，不產生規則文字
 *     · 報告裡標明是哪個型號判讀的——判讀要能追溯到判讀者
 *
 * 狀態檔記錄看過的項目，避免同幾篇論文每個月重報一次。
 *
 * 用法：node watch/check-ecosystem.mjs [--out report.md] [--append]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cfCreds, pickModel, runModel } from './cf.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE = join(__dirname, 'ecosystem.state.json');
const INVESTIGATED = join(__dirname, 'investigated.json');
const RULES_SRC = join(__dirname, '..', 'skills', 'seo-aeo-audit', 'scripts', 'seo-check.mjs');

const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? argv[outArg + 1] : null;
const APPEND = argv.includes('--append');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const FEEDS = [
  {
    id: 'gsc-blog',
    name: 'Google Search Central 官方部落格',
    url: 'https://developers.google.com/search/blog/feed.xml',
    why: 'L1／L2 多數規則的依據來源。官方改指引通常先發在這裡。',
  },
  {
    id: 'arxiv-geo',
    name: 'arXiv：生成式引擎最佳化相關論文',
    url: 'http://export.arxiv.org/api/query?search_query=abs:%22generative+engine+optimization%22+OR+abs:%22answer+engine+optimization%22&sortBy=submittedDate&sortOrder=descending',
    why: 'L3-GEO-* 的依據是一篇 2024 的論文。後續研究可能推翻或細化它的結論。',
    /*
     * ⚠ 這裡原本寫死 `max_results=20`（2026-08-17 發現是靜默失效）。
     *
     * 查詢詞沒問題——實測 `2605.25517`、`2607.12056` 都撈得到。問題在視窗：
     * 這個領域現在**五個月就產出 20 篇**，所以每次只拿最新 20 筆時，
     * 比視窗更舊的論文永遠排不進來。而下面的狀態檔會把視窗內容標成「已看過」，
     * 於是首跑之前的存量**進不了視野，也不會有任何跡象**：報告只會印
     * 「本次沒有新項目」。實測狀態檔最舊一筆是 2604.19516（2026-04-21），
     * 而 2603.29979 從未被掃到過。
     *
     * 這和 `SITE-DEAD-INTERNAL-LINK` 是同一個物種：在唯一測過的情況下
     * （領域產出速度低於視窗大小）它本來就是對的。
     *
     * 改成分頁往回撈到底。size 給 100 是因為整個 GEO 語料目前只有數十篇，
     * 一頁就吃得下；maxPages 是防呆上限，不是預期值。
     */
    page: { size: 100, maxPages: 5 },
  },
];

/* 抓一個 feed 的全部項目。有 `page` 設定就往回分頁，直到某頁不滿一頁
   （＝到底了）或撞到 maxPages。沒有 `page` 的照原樣抓一次。 */
async function fetchEntries(f) {
  const get = async (url) => {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text());
  };

  if (!f.page) return get(f.url);

  const { size, maxPages } = f.page;
  const all = [];
  for (let p = 0; p < maxPages; p++) {
    const page = await get(`${f.url}&start=${p * size}&max_results=${size}`);
    all.push(...page);
    if (page.length < size) break;   // 不滿一頁＝已經到底
  }
  return all;
}

/* Feed 解析。刻意不引入 XML 套件——這個 repo 的腳本零相依，使用者要能直接
   node 跑。兩個來源結構單純，正則夠用，但**格式不一樣**：
     · arXiv 是 Atom：<entry>、連結在 <link href="...">
     · Google Search Central 是 RSS：<item>、連結是 <link> 的文字節點
   第一版只寫了 Atom，結果 GSC 靜靜地回傳零項目——是下面那個
   「抓到了卻解析不出東西」的檢查把它揪出來的。 */
function parseFeed(xml) {
  const strip = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

  const blocks = [
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/g),
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/g),
  ].map((m) => m[0]);

  return blocks.map((e) => {
    const pick = (tag) => (e.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1];
    /* Atom 把網址放屬性，RSS 放文字節點——兩種都試 */
    const link = (e.match(/<link[^>]*\bhref="([^"]+)"/) ?? [])[1] ?? strip(pick('link') ?? '');
    return {
      id: strip(pick('id') ?? pick('guid') ?? link),
      title: strip(pick('title') ?? ''),
      summary: strip(pick('summary') ?? pick('description') ?? pick('content') ?? '').slice(0, 700),
      date: strip(pick('published') ?? pick('updated') ?? pick('pubDate') ?? '').slice(0, 16),
      link,
    };
  }).filter((x) => x.id && x.title);
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { seen: {} };
state.seen ??= {};

const fresh = [];
const feedNotes = [];

for (const f of FEEDS) {
  try {
    const entries = await fetchEntries(f);
    if (!entries.length) {
      /* 抓到了卻解析不出東西，多半是對方換了格式。這要講出來，
         否則會表現成「這個月沒有新消息」——一個永遠不會被發現的靜默失效。 */
      feedNotes.push(`⚠️ ${f.name}：抓取成功但解析不到任何項目（格式可能變了）`);
      continue;
    }
    const seen = new Set(state.seen[f.id] ?? []);
    const news = entries.filter((e) => !seen.has(e.id));
    fresh.push(...news.map((e) => ({ ...e, feed: f.name })));
    feedNotes.push(`✅ ${f.name}：${entries.length} 項，其中 ${news.length} 項是新的`);
    /*
     * 聯集，不是覆寫。原本寫 `= entries.map(...)`，也就是**用這次抓到的取代
     * 整份紀錄**——視窗一縮（分頁失敗、對方限流、改回小 max_results），
     * 舊 id 就從 seen 掉出去，下一輪又被當成新項目重報一次。
     *
     * 那個失效方向特別壞：它長得像「這個月論文很多」，不像壞掉。
     * 聯集之後，只要看過就永遠算看過，跟這次抓到多少無關。
     *
     * 上限拉到 600（分頁最多 500）並且把這次的排前面，
     * 確保不會把「這次仍然抓到的」擠掉。
     */
    const merged = [...entries.map((e) => e.id), ...(state.seen[f.id] ?? [])];
    state.seen[f.id] = [...new Set(merged)].slice(0, 600);
  } catch (err) {
    feedNotes.push(`⚠️ ${f.name}：${err.message}`);
  }
}

/* 現行規則清單直接從檢核器原始碼抽，不另外維護一份——
   另外維護的那份一定會過期，而且過期時沒有人會發現。

   嚴重度不一定是字面值：有幾條寫成 add(cond ? 'info' : 'warn', 'RULE-ID', …)。
   第一版的正則只認字面值，靜靜漏掉那幾條——送給模型的規則清單就少了，
   模型會把已經涵蓋的主題當成新發現。抓法是不管第一個參數長什麼樣，
   只認第二個位置的規則代號。 */
const ruleIds = [...new Set(
  [...readFileSync(RULES_SRC, 'utf8').matchAll(/\badd\([^,]+,\s*'([A-Z][A-Z0-9-]+)'/g)].map((m) => m[1]),
)];

/* 已查證過、結論是不加規則的主題。餵給模型是為了它不要把同一件事
   每個月當成新發現重報一次——規則代號那份清單管不到這些，因為
   「查過了但沒有變成規則」在規則清單裡剛好長得像「還沒涵蓋」。

   缺檔不靜默跳過：少了這份清單，判讀會退回到會重報的狀態，
   而報告上看不出差別。 */
let investigated = [];
if (existsSync(INVESTIGATED)) {
  investigated = JSON.parse(readFileSync(INVESTIGATED, 'utf8')).topics ?? [];
} else {
  feedNotes.push(`⚠️ 找不到 ${INVESTIGATED}，本次判讀沒有「已查證主題」清單，可能重報舊主題`);
}

const lines = ['\n## ③ 生態掃描\n'];
lines.push(feedNotes.map((n) => `- ${n}`).join('\n') + '\n');

let actionable = 0;

if (!fresh.length) {
  lines.push('本次沒有新項目，未呼叫模型。\n');
} else {
  const creds = cfCreds();
  if (!creds) {
    /* 缺金鑰不靜默跳過。新項目照列，只是沒有判讀——人還是看得到東西。 */
    lines.push(`⚠️ 有 ${fresh.length} 項新內容，但缺少 \`CF_ACCOUNT_ID\`／\`CF_API_TOKEN\`，本次未做判讀。以下為原始清單：\n`);
    for (const e of fresh) lines.push(`- [${e.title}](${e.link})（${e.feed}，${e.date}）`);
    actionable = fresh.length;
  } else {
    try {
      const { model, how } = await pickModel(creds);

      const prompt = [
        '你在維護一份「網站對搜尋引擎與 AI 引擎可見度」的檢核規則清單。',
        '任務：判斷以下新內容，哪些**值得回去讀原文**，因為可能新增、修改或推翻現有規則。',
        '',
        '嚴格要求：',
        '1. 只根據下面提供的標題與摘要判斷，不要引入你記憶中的任何其他資訊。',
        '2. 不要寫出任何規則文字或建議的門檻數字——你的產物是「線索」，不是規則。',
        '3. 每一項都必須附上提供給你的原始連結。',
        '4. 不相關的就不要列。若全部都不相關，第一行只輸出「無」，不要再寫別的。',
        '5. 用繁體中文，每項一行，格式：`- [標題](連結) — 為什麼值得讀（一句）`',
        '6. 下面「已查證過的主題」裡的東西不要再列，除非這一篇提供的是**新的實證**',
        '   （例如逐特徵的對照實驗），而不是同一個主張的又一次轉述。',
        '',
        `現行規則代號（共 ${ruleIds.length} 條，只給代號供你判斷涵蓋範圍）：`,
        ruleIds.join('、'),
        '',
        ...(investigated.length
          ? ['已查證過、結論是不加規則的主題（連同否決理由）：',
             ...investigated.map((t) => `- ${t.topic}｜結論：${t.conclusion}｜要重看的條件：${t.recheckWhen}`),
             '']
          : []),
        '新內容：',
        ...fresh.map((e, i) => `${i + 1}. 【${e.feed}｜${e.date}】${e.title}\n   連結：${e.link}\n   摘要：${e.summary}`),
      ].join('\n');

      const answer = (await runModel(creds, model, [
        { role: 'system', content: '你是嚴謹的技術文獻篩選助手。寧可漏列，不要臆測。' },
        { role: 'user', content: prompt },
      ])).trim();

      const nothing = /^無[\s。.]*$/.test(answer.split('\n')[0].trim());
      lines.push(`本次有 ${fresh.length} 項新內容送判讀。判讀型號：\`${model}\`（${how}）。\n`);
      if (nothing) {
        lines.push('模型判定：沒有值得回去讀原文的項目。\n');
      } else {
        /* 判讀結果原樣輸出，不做解析。小型號的輸出格式不穩，硬解析會把
           「格式沒對上」變成「沒有發現」——那是最不該發生的失敗方向。 */
        lines.push('> ⚠️ 以下是**機器判讀的線索，未經查證**。要改規則必須先讀原文。\n');
        lines.push(answer + '\n');
        actionable = 1;
      }
    } catch (err) {
      /* 判讀失敗也要把新項目列出來，人才有東西可看。 */
      lines.push(`⚠️ 判讀失敗：${err.message}\n\n以下為未判讀的新項目原始清單：\n`);
      for (const e of fresh) lines.push(`- [${e.title}](${e.link})（${e.feed}，${e.date}）`);
      actionable = fresh.length;
    }
  }
}

writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');

const report = lines.join('\n') + '\n';
if (OUT) (APPEND ? appendFileSync : writeFileSync)(OUT, report);
else console.log(report);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `ecosystem_actionable=${actionable}\n`);
}
