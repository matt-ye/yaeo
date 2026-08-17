---
name: seo-aeo-audit
description: 檢核網站的 SEO/AEO 品質並提出修法。四層檢核——技術基礎、內容結構、AI 引擎可見度、YMYL/E-E-A-T。當使用者要求檢查網站 SEO、發佈前檢核、找出空標題或缺 meta、想被 AI 引擎引用、或問「這頁的 SEO 有沒有問題」時使用。也用於寫作階段套用 GEO 戰術。
---

# SEO / AEO 檢核

> **規則帶出處是這個 skill 的核心紀律。** 市面上的 SEO skill 大量流傳無來源的百分比宣稱
> （實測：某 repo 的 GEO 章節整串改善率追不到任何原始研究）。
> 本 skill 的每條規則要嘛來自 Google 官方文件，要嘛來自同行評審論文，要嘛標「從業共識，證據弱」。
> **不確定的規則寧可標弱，不要加數字。**

## 四層架構

| 層 | 內容 | 判定方式 |
|---|---|---|
| L1 技術基礎 | title／description／canonical／OG／lang／sitemap／robots | 腳本全自動 |
| L2 內容結構 | **正文可見量**、heading 階層、空標題、假標題、圖片 alt、內部連結、JSON-LD | 腳本全自動 |
| L3 AI 可見度 | **站層級**：標準檔＋爬蟲分流（`SITE-*`，自動）／**頁層級**：GEO 引用訊號（`L3-*`，自動）、段落自足性與 Q&A 結構（人工） | 半自動 |
| L4 YMYL/E-E-A-T | 作者資訊、專業佐證、共識一致性、AI 內容加值 | 人工判讀 |

## 怎麼跑（L1＋L2＋L3 自動部分）

先 build（檢核的是**爬蟲看到的建置產物**，不是原始碼）：

```bash
npm run build
```

```bash
node scripts/seo-check.mjs --dir ./dist --site https://example.com
```

參數：`--json` 輸出機器可讀格式；`--fail-on warn` 讓警告也算失敗（進 CI 用）。
離開碼：0 通過／1 有問題／2 參數或路徑錯。

> Windows 上要接 `--json` 的輸出時，`Get-Content` 必須加 `-Encoding utf8`，
> 否則中文變亂碼、`ConvertFrom-Json` 直接報錯（Node 輸出的是標準 UTF-8 無 BOM，錯在消費端）。

### 效能層：`psi-check.mjs`

```bash
node scripts/psi-check.mjs --url https://example.com/ --key-env GOOGLE_PSI_API_KEY_MATTYE
```

參數：`--strategy both|mobile|desktop`（預設 both）、`--json`。

**必須自備 API key**（見「已知限制」），從環境變數讀、不接受命令列傳入（避免進 shell 歷史）。

> ⚠ **Windows 坑**：`setx` 寫的是註冊表，**當前 shell 讀不到**（它的環境是啟動時的快照）。
> 要嘛開新 shell，要嘛在跑之前注入：
> ```powershell
> $env:GOOGLE_PSI_API_KEY_MATTYE = [Environment]::GetEnvironmentVariable("GOOGLE_PSI_API_KEY_MATTYE","User")
> ```

> ⚠ **API key 不綁被測網域**——key 只決定配額算在哪個 GCP 專案，任何 key 都能測任何網址。
> 多把 key 的用途是配額分開計費，不是存取控制。

**兩支腳本查的東西不重疊，都要跑**：`seo-check.mjs` 看結構與內容，`psi-check.mjs` 看效能。
Lighthouse 的 SEO 分數（psi 會印）只驗表層——實測某站 **SEO 100 分，但 h2 掛零、
主要內容不在 HTML、LCP 106 秒**。**不要把那個 100 分當作 SEO 沒問題。**

**先讀懂輸出的分級**：`error` 是爬蟲層面的實質損失，`warn` 是品質折損，`info` 是提醒。
不要追求歸零——`noindex`、裝飾性 `alt=""` 這類是刻意設計，出現在 info 是正常的。

### 先看正文在不在，再看結構對不對

**檢核順序有優先級：`L2-CLIENT-RENDERED` 出現時，其他所有結構檢核的結果都要打折看。**
一個頁面可以 title／description／JSON-LD／heading 全部完美，但正文靠 JS 載入——
對爬蟲來說那就是一張空頁。實例：某站的演講頁結構全過，但 61 筆資料零筆在 HTML 裡。

**這是原版腳本漏掉、靠與既有人工盤點對照才發現的缺口**——寫檢核工具時
很容易只檢核「看得到的元素」，而忘了問「該有的內容到底在不在」。

### 這支腳本不執行 JS——這是特性不是限制

它看到的就是爬蟲看到的。**如果某頁的標題靠 JS runtime 填字，腳本會報 `L2-HEADING-EMPTY`，
那不是誤報，那正是 Google 看到的狀態。** 修法是把預設語言的文字寫回 HTML，讓 JS 只負責切換。

## 逐項怎麼修

### L1 常見項

| 代碼 | 修法 |
|---|---|
| `L1-TITLE-MISSING` / `SITE-TITLE-DUP` | 每頁給獨立 title。多頁共用同一個 title 等於告訴搜尋引擎「這幾頁是重複內容」 |
| `L1-DESC-MISSING` | 補 meta description。它**不是排名因子，但影響 SERP 上的點擊率**（Google SEO Starter Guide 的「Influence your title links and snippets」一節有述；Google 也可能改用頁面內文自動生成 snippet） |
| `L1-LANG-MISSING` / `SITE-LANG-INCONSISTENT` | 全站統一（繁中用 `zh-TW`，不要 `zh-TW` 與 `zh-Hant` 混用） |
| `L1-CANONICAL-MISSING` | 補 canonical，尤其有查詢參數的頁面 |

**hreflang 什麼時候才加**：只有中英是**獨立 URL** 時才有意義。
若同一 URL 用 CSS/JS 切語言，加 hreflang 反而給錯訊號——不要加。

### L2 常見項（投報率最高的一層）

| 代碼 | 修法 |
|---|---|
| `L2-FAKE-HEADING` | `<p class="section-heading">` → `<h2>`，**class 原封不動，視覺零變動**。這是最便宜的修復：一個標籤名換掉，頁面立刻從「只有一個標題」變成「有結構」 |
| `L2-HEADING-EMPTY` | 預設文字寫回 HTML，JS 只做切換 |
| `L2-TITLE-NOT-HEADING` | info 級，數量通常很大（卡片標題）。**不要全改**——挑「文章列表」「課程列表」這類真的需要被爬蟲讀成清單的地方包 `<h3>` 就好 |
| `L2-CLIENT-RENDERED` | **最嚴重的一類**。核心內容由瀏覽器端 fetch，爬蟲與 LLM 看到的是「載入中…」。修法：把 fetch 搬到 build 期寫進 HTML（並準備資料源掛掉時的 fallback，別讓 build 紅）。**這種頁面可能其他檢核全過——結構完美但沒有內容** |
| `L2-BILINGUAL-CONCAT` | 同頁雙語 DOM，爬蟲讀到「數字看見By the Numbers」這類混雜字串。小修無用，根治要拆成獨立語言 URL |
| `L2-NO-INTERNAL-LINKS` | 孤島頁。加相關文章／系列導覽／麵包屑。**若內容有 series 或 category 欄位，用它自動生成 prev/next 是一次修好全部的做法** |
| `L2-BREADCRUMB-MISSING` | 補 BreadcrumbList JSON-LD，路徑越深收益越大 |
| `L2-ARTICLE-NO-DATE` | Article 型必填 datePublished |
| `L2-H1-MULTIPLE` / `L2-H1-MISSING` | 一頁恰好一個 h1 |
| `L2-IMG-ALT-MISSING` | 補 alt。**裝飾性圖片用 `alt=""`**（那是刻意的，會歸到 info） |
| `L2-JSONLD-INVALID` | JSON-LD 語法錯誤——整段會被搜尋引擎忽略，等於沒寫 |
| `L2-ARTICLE-NO-AUTHOR` | Article 補 `author`。**YMYL 的第一要件是「誰寫的」** |
| `L2-FUTURE-DATE` | `datePublished` 在未來＝頁面已上線卻宣稱未發佈。多半是把「排程日」當發佈日 |
| `SITE-DEAD-INTERNAL-LINK` | 站內連結指向不存在的路徑。**會處理 clean URL**——連結寫 `/gallery`、輸出檔是 `gallery.html` 不算死連結（見下） |
| `SITE-SITEMAP-NOINDEX-CONFLICT` | sitemap 邀請爬蟲來看一個標了 `noindex` 的頁——矛盾訊號 |
| `SITE-ROBOTS-MISSING` / `SITE-SITEMAP-MISSING` | 兩個最基本的站層級檔案 |
| `SITE-TITLE-DUP` | 多頁共用同一個 `<title>`＝告訴搜尋引擎這幾頁是重複內容 |

> 上面兩張表是**策展過的**：只列最常遇到、且修法需要判斷的。
> **每一條規則的完整索引見〈完整規則索引〉**（本文件末段），不必去讀腳本。

### L3 AI 可見度

這一層有兩個不同的問題，報告裡也分成兩組代碼：

| 問題 | 代碼 | 白話 |
|---|---|---|
| **可達性** | `SITE-*` | AI **拿不拿得到**你的內容 |
| **可引用性** | `L3-*` | 拿到之後**會不會被引用** |

兩者不互相取代：擋掉檢索蟲，寫得再好也不會被引用；開放了但內容沒有可引用的
東西，也一樣不會。

#### 站層級（可達性）

自動檢的：robots.txt／sitemap／llms.txt／RSS 存在性，以及**爬蟲分流**。

**訓練蟲與檢索蟲是兩件不衝突的事**，這是最多人搞混的一點：

| 類型 | 代表 | 擋了會怎樣 |
|---|---|---|
| 檢索／引用蟲 | `OAI-SearchBot`、`PerplexityBot`、`Claude-SearchBot`、`Google-Extended` | **AI 引擎無法引用你**——想被 AI 提及就不能擋 |
| 訓練蟲 | `GPTBot`、`ClaudeBot`、`CCBot` | 內容不進模型訓練；不影響被引用 |

（`Google-Extended` 的作用範圍隨 Google 政策調整過，設定前回查官方文件當日說明。）

**llms.txt**：Google [官方明確表示不使用它](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)（逐字聲明見文末「出處」）。成本是幾分鐘，放無妨，
但**不要期待排名或引用率提升**，也不要在提案裡把它講成必做項。

#### 頁層級（可引用性）

**先確認資格，再談訊號。** `L3-AI-SNIPPET-BLOCKED` 檢查 meta robots 有沒有
`nosnippet` 或 `max-snippet:0`。Google 官方明載：

> "To be eligible to be shown in generative AI features on Google Search,
> a page must be indexed and eligible to be shown in Google Search **with a snippet**"

快照資格是**前提**不是加分項。這條與 `L1-NOINDEX` 分開，因為後果不同——
noindex 是不進索引，nosnippet 是進了索引但 AI Overviews／AI Mode 用不了。
已經 noindex 的頁不重複報。元素層級的 `data-nosnippet` 只報 `info`
（`L3-AI-SNIPPET-PARTIAL`），它常被整個套在正文容器上，作用範圍比作者以為的大。

---

`L3-GEO-SIGNALS-NONE` / `L3-GEO-SIGNALS-THIN` 只對 **Article 型頁面**檢查，
數三件事：**外部引用網域數、統計數據處數、直接引言處數**。

這三項是下面「GEO 五戰術」裡唯一機械可偵測的部分（權威語氣與流暢度是語意判斷）。

> ⚠ **2026-08 證據強度下修。** 一篇回顧 45 篇研究（2023-11～2026-07）的批判性綜述
> （[arXiv 2607.14035](https://arxiv.org/abs/2607.14035)）指出，KDD 2024 那些被廣泛
> 引用的增益「在其實驗設定內成立，但**以來源已經出現在固定脈絡中為前提**；
> 既未證實自然可發現性，也未證實持久的流量效果」，而且「以被引用為目標的改寫
> **可能損害檢索表現**」。
>
> 也就是說這三項影響的是「**被撈到之後**會不會被引用」，不是「會不會被撈到」。
> 原本的訊息寫「唯一有同行評審實驗支持的槓桿」說過頭了，已改。
> 嚴重度不變——本來就只報 `info`、本來就不給數字，克制的做法是對的。

### 一個證據衝突，以及為什麼它不動規則（2026-08-17）

兩篇 2026 年的論文對「結構／格式改動有沒有用」給出相反的答案：

| 論文 | 設計 | 結論 |
|---|---|---|
| [2605.25517](https://arxiv.org/abs/2605.25517) What Gets Cited | 252,000 次試驗、6 個模型、18 個因子逐一配對、mixed-effects，品牌匿名＋來源順序對消 | topical relevance 與 list position 最強，**純格式改動影響極小** |
| [2603.29979](https://arxiv.org/abs/2603.29979) GEO-SFE | 6 個引擎 | 結構特徵帶來引用率 **+17.3%** |

**處置：不新增規則，也不改嚴重度。** 兩篇都不是差的研究，但方向相反，
而本 repo 的門檻是「規則要有站得住的依據」，不是「有一篇支持就寫進去」。

值得注意的是這個衝突落在哪一邊：前者的結論**支持現行做法**——既然純格式
改動影響極小，`L3-GEO-*` 那三項就不該升級成硬規則、也不該給閾值。
所以這次查證的產物是「原本的克制是對的」，不是一條新規則。
這種結果一樣要寫下來，否則下一個人會以為這個主題沒人查過。

> ⚠ 同時記下**沒有**拿來用的東西：2605.25517 也發現「時間戳新」有一致的
> 正面效果。這**不能**用來加強 `L2-NO-MODIFIED-DATE`——「有 `dateModified`
> 標記」不等於「內容是新的」，是兩個不同的主張。要做成規則需要一個
> 「多舊算舊」的閾值，論文沒給。這種跳躍正是本 skill 反對的。

**三件刻意的克制**，也是使用這條規則時該有的態度：

1. **只報 `info`。** 論文說的是「加了會提升可見度」，不是「沒加就是錯」
   ——把弱訊號寫成 error 正是本 skill 反對的做法
2. **不給目標數字。** 論文沒有提供閾值，我們也不編一個出來
3. **只對 Article 檢查。** 列表頁、工具頁沒有引用來源是正常的

> 實測一個站的 51 個 Article 頁（2026-08-14 快照，數字會隨該站內容變動）：
> 0 頁完全沒有訊號，12 頁偏少。
> 其中 8 篇投資專欄的模式最值得注意——**統計數據 11～24 處，外部引用 0 個**。
> 大量引用數字卻不標出處，這同時是 GEO 缺口與 YMYL 扣分項。

#### 人工判讀的

- **段落自足性**——每個段落抽出來單獨看，還讀得懂嗎？AI 是以 chunk 為單位擷取的
- **Q&A 結構**——標題用真實問句，答案緊接在標題下第一段
- **Bing 收錄**——ChatGPT Search 高度依賴 Bing 索引，只顧 Google 會漏掉這條路

### L4 YMYL / E-E-A-T（人工判讀，財經、醫療、法律內容必做）

依據：Google Search Quality Rater Guidelines 2025-09-11 版（頁碼標於各條）。
**注意 §3.4.1 的框架是「主張類型 × 佐證等級」的配對，不是「作者有沒有證照」：**

1. **具體操作建議**（存多少、怎麼配置、幾歲前要達成什麼）必須有對應等級的專業佐證，
   不能只用個人經驗帶過（p.28）
2. **個人心得／使用經驗**可以用第一手經驗撐 E-E-A-T，不必偽裝成專家建議（p.26, p.28）
3. 每篇要有**清楚的內容創作者資訊**：作者是誰、相關學經歷（p.25, p.62-63）
4. 涉及付費交易的頁面需要**令人滿意的客服/聯絡資訊**，只有一個 email 會被判 Low（p.63）
5. **聲譽佐證要來自獨立第三方**，不能只有自我宣稱「我是專家」（p.27, p.63）
6. **內容須與 well-established expert consensus 一致**——不一致會被判不可信甚至 Lowest（p.21, p.48）
7. **免責聲明不是萬靈丹**（指南未給明文豁免效力）；未揭露的利益衝突則會獨立拖累 Trust（p.27, p.57）
8. **AI 輔助寫作沒問題，但每篇要有實質人工加值與原創觀點**。
   ⚠ 精確表述是「AI 生成 ＋ 低努力／低原創／無附加價值 ＝ Lowest」（p.42-43），
   **不是「用 AI 就低分」**——指南明白反駁了那個簡化讀法
9. **避免模板化批量產出**（把常見問題清單餵 AI 生成填充頁）——這正是 Scaled Content Abuse 的示範手法（p.55）
10. 小型個人網站查無第三方聲譽**不算扣分**，但 YMYL 主題下其他品質指標會被更嚴格檢視（p.25）

> ⚠ 第 1、2 條的「教育型內容 vs 個別化建議」二分，是從 §3.4.1 的 Experience-vs-Expertise
> 框架**推論**出來的，指南並無此明文條款。引用時要標明這層推論落差。

## 寫作階段：GEO 五戰術

唯一有同行評審實驗支持的 AEO 戰術（Princeton 等，KDD 2024；論文報告最高約 40% 可見度提升，
單項最強為加入統計數據）：

1. 引用來源
2. 加入統計數據
3. 直接引言
4. 權威語氣
5. 流暢度優化

**這五項本質上就是學術寫作紀律**——先寫好內容，這五項會自然滿足，不需要當成額外工序。

## 檢核報告怎麼寫給人看

跑完腳本後，**不要把原始輸出貼給使用者**。整理成：

1. **先給三行結論**：掃了幾頁、幾個 error、最該修的是哪一件
2. **依「修一次影響幾頁」排序**，不是依嚴重度排序——29 處假標題改標籤名，比逐頁補 description 划算得多
3. **每項附具體修法與 file:line**，能給出「改哪一個字」最好
4. L4 的判讀分開寫，標明哪些是推論、哪些有頁碼依據

## 別被 SEO 工具的「missing」嚇到

瀏覽器 SEO 擴充（SEO Meta in 1 Click、Ahrefs Toolbar 等）會列出一長串 missing。
**其中有一半以上不該修**——工具的檢查清單多年沒更新，或檢查的是它自己那套偏好。

先把這些刷掉，剩下的才值得看：

| 工具報的 | 真相 |
|---|---|
| **Keywords is missing** | `meta keywords` **Google 2009 年就公開宣布不再使用**。填了不會加分，只會讓競爭者看到你的關鍵字策略 |
| **Robots meta tag is not defined** | 沒有 robots meta ＝ 預設 `index, follow`，這**正是你要的**。特地加一行 `index,follow` 是多餘的 |
| **Images without TITLE** | `title` 屬性對 SEO **無作用**，圖片靠 `alt`。而且 title 對可及性**有害**：螢幕閱讀器行為不一致、觸控裝置根本看不到。**alt 有就夠了** |
| **Links without TITLE** | 同上。連結的語意靠 anchor text，不是 title 屬性 |
| **No Schema.org (itemtype only)** | 那個檢查只認 **microdata**（`itemtype=` 屬性）。若你用 **JSON-LD**——那是 **Google 官方推薦的格式**——它就報 missing。去看工具的 structured data 分頁，通常會正確列出你的 JSON-LD |
| **Hreflang missing** | 只有「同一內容有多個語言 URL」時才需要。中英同頁切換的站加了反而給錯訊號 |
| **Domain Rating 低** | 新站本來就低，那是外部連結累積的結果，不是網站本身的缺陷。**別把它當待辦事項** |

**判準**：工具報 missing 時先問「這個訊號現在還有人在讀嗎？誰讀？」
答不出來就不要修——每一項「為了讓工具變綠」的修改都是技術債。

### 反過來說，這些工具最該看的一欄

**標題階層**。擴充的 H1–H6 計數表是最誠實的一欄：`H2 = 0` 直接證明頁面沒有結構
（見 `L2-FAKE-HEADING`）。工具在這裡不會誤報，因為它數的是實際標籤。

## 架構級建議：自動產生的產物要自我驗證

凡是**自動產生、不經過人眼**的東西——sitemap、RSS、JSON-LD、自動內部連結——
都該在 build 期驗證自己。理由：人看得到的東西壞了會有人回報，這些不會，只會安靜地漏。

值得照抄的模式（實例）：RSS 在 build 期檢查「feed 非空／每個連結在 dist 有對應頁／
網址是絕對路徑」，任一不符就讓 build 結束碼 1，部署直接被擋。
同時把內容來源抽成單一模組，讓列表頁與 feed 讀同一份——
避免「兩邊各抄一份，日後新增來源只改了一邊」。

## 調整門檻時的原則

`title`／`description` 長度門檻分中英兩套（CJK 佔比 >30% 走中文門檻），
因為中文資訊密度高，套英文門檻會把正常的中文標題全部報成過短或過長。

**噪音比漏報更危險**——一份 40 條警告的報告會被整份忽略，1 條真警告才看得見
（這條紀律與 `PROMPT_連結驗證與來源查核SOP.md` 的「降噪本身就是修復」同源）。
所以：如果某個檢核項在正常內容上大量觸發，先懷疑門檻設錯，不要叫使用者去改一百頁。

## 已知限制

- 正則解析，不是 DOM 解析：巢狀異常結構可能誤判。發現誤判時回頭修腳本的正則，不要改結論遷就工具
- **`<script>`／`<style>` 一律先剝掉再做結構檢核**——否則 JS 樣板字串裡的 `<div class="${x}-title">`
  會被當成真實 DOM（實測踩過）。JSON-LD 例外，它需要從原文解析
- 不執行 JS（見上方說明，這是刻意的）
- 不檢核效能（Core Web Vitals 走 PageSpeed Insights API）。
  ⚠ **PSI API 必須自備 API key**：不帶 key 走 Google 公共匿名配額池，實測（2026-08-11）
  直接回 `429 Quota exceeded`。文件寫的每日 25,000 次是**有 key 之後**的配額
- 不檢核實際排名與收錄狀態（走 Google Search Console API；2026-06 起含 AI Overview 曝光數據）
- **外部連結是否還活著不在檢核範圍**——`SITE-DEAD-INTERNAL-LINK` 只驗站內路徑。
  外連要另外跑連結健檢，判準見 `PROMPT_連結驗證與來源查核SOP.md`（非 2xx ≠ 失效）

  > ⚠ **這條規則修過一次大誤判（2026-08-14），值得當成教材。**
  > 第一版只認「目錄形式」的輸出（`/a/b/index.html` → `/a/b/`），
  > 於是在採 clean URL 的靜態主機上——Cloudflare Pages、Netlify、GitHub Pages
  > 都是——連結寫 `/gallery`、輸出檔是 `gallery.html`，**每一條都被報成死連結**。
  > 實測誤判率 67%（3 條裡 2 條是誤判），而且它是 **error** 級。
  >
  > 它潛伏很久，是因為開發時用的網站剛好是目錄輸出，那個模式從第一版就對。
  > **測試涵蓋的輸出模式，比規則本身寫得多漂亮更重要。**
  >
  > 改法是把方向倒過來：不要猜連結該長什麼樣，而是先算出每個輸出檔
  > 實際到得了的所有網址形式，再看連結有沒有命中。回歸測試在
  > `test/dead-link.test.mjs`，三種輸出模式各埋一條真死連結——
  > 因為修誤判最容易的假解法，就是把規則放寬到不再觸發。

## 測試

```bash
node skills/seo-aeo-audit/test/dead-link.test.mjs
node skills/seo-aeo-audit/test/bilingual-concat.test.mjs
```

零相依，直接跑。所有檢查點裡只有這兩條有測試——**不是因為別條不重要，
是因為只有這兩條的「判準」出過問題**：

| 規則 | 出過什麼事 |
|---|---|
| `SITE-DEAD-INTERNAL-LINK` | 在 clean URL 主機上整批誤判（誤判率 67%），而它是 error 級 |
| `L2-BILINGUAL-CONCAT` | 數字一直是對的，但**把兩種修法完全不同的狀況混在一起** |

> 判斷哪條規則值得寫測試，看的不是它多複雜，是**它錯的時候會不會讓人
> 不再相信整份報告**，或**會不會把人導向錯誤的修法**。

### `L2-BILINGUAL-CONCAT` 的判準為什麼不能靠標記

這條會報「N 處中英黏連」，但那個數字底下有兩種完全不同的狀況：

| | 樣子 | 該怎麼修 |
|---|---|---|
| ① 雙語 DOM | 同一份內容的中英兩版同時在 DOM 裡 | **架構**：改成獨立語言 URL |
| ② 未翻譯 fallback | 英文頁上還沒翻譯的內容退回中文 | **內容**：翻完自然消失 |

加判準時試錯兩次，兩次都是靠標記：

- **「有沒有 `lang` 屬性」** → 常見的雙語元件兩半都會帶 `lang`，
  這樣會把①這種真正該修的一起消掉
- **「兩邊都宣告且語言不同」** → 漏掉用 `class="zh-only"`／`"en-only"`
  而不帶 `lang` 的手刻頁，那些也是①

最後改成靠**內容**：相鄰兩個元素，前者主要是中日韓、後者主要是拉丁
——那就是同一份內容的兩個語言版本並排，**與標記方式完全無關**。

> 通則：**判準要描述「要達成什麼」，不是「長什麼樣」。**
> 綁在特定寫法上的判準，換一種寫法就失效，而且失效時是靜默的。
> 測試的三個雙語情境（`lang` 屬性／`class`／完全沒標記）就是在釘這件事。
- **效能診斷要「先看總量，再看時序」**。
  第一個該問的是「**這頁到底多大**」（`total-byte-weight`），不是「哪個環節慢」。
  ⚠ **PSI 的「最慢請求」不能拿來排除網路因素**——`network-requests` 記的是
  實際採集時間，而 LCP／SI 是採集後才套用 4G 節流模型算出來的，
  兩者是不同座標系的數字。

  實測案例（走了三步才找對）：某站 LCP 106 秒，CPU 只用 1.1 秒、最慢請求 490ms，
  於是先後懷疑「外部 fetch 逾時」與「輪播污染指標」——**兩個假設都被實測推翻**。
  真正原因是三張 hero 照片共 20.8 MB（`total-byte-weight` 一直都在報告裡）。
  壓縮後 **106.1s → 4.4s**。

- **Astro 專案的圖片位置決定會不會被最佳化**：`public/` 原樣送出，
  `src/assets/` 才會經過 `<Image>` 轉 WebP 並產生響應式尺寸。
  相機直出的照片放錯地方，就是幾 MB 直接送到瀏覽器
- **內部連結判定**：`/` 開頭、相對路徑、與 `--site` 同網域的完整網址都算內部；
  未傳 `--site` 時，指向自站的完整網址會被誤判為外連——跨網域檢核時記得傳
- 結構化資料只驗語法與必填欄位，**不驗 rich result 資格**——那要到 Google 官方網頁版工具，無 API

## 完整規則索引

**59 條規則**：L1 13／L2 29／L3 4／SITE 13。
上面〈逐項怎麼修〉是策展過的常見項，這裡是全部。

> 這份索引由 `test/rule-index.test.mjs` 守著：新增規則卻沒補進來，測試會失敗並
> 指名漏了哪幾條。**建立這份索引時漏了 4 條就是因為當時沒有這個守衛**——
> 抽取腳本只認 `add('warn', 'CODE'`，於是把所有「嚴重度隨條件變動」的規則
> （`add(isNoindex ? 'info' : 'warn', 'CODE'`）整類漏掉，而驗證腳本共用同一個假設。

> 級別的意思：`error` = 幾乎必然有害且判準明確；`warn` = 該看但可能有正當理由；
> `info` = 訊號弱或數量大，**不必清零**。調整級別前先讀〈調整門檻時的原則〉。

### L1 技術基礎（13）

| 代碼 | 級別 | 是什麼 |
|---|---|---|
| `L1-TITLE-MISSING` | error | `<title>` 缺失或為空 |
| `L1-TITLE-LONG` | warn | 標題的**資訊核心**過長。量核心不量全長——SERP 從尾端截斷，站名後綴被截掉不損失資訊 |
| `L1-TITLE-SHORT` | warn | 標題**全長**過短。這裡量全長，因為後綴會顯示出來，站名也是資訊 |
| `L1-TITLE-REPEATED` | warn | 標題裡站名重複（頁面自己帶了一次、版型又補一次後綴）。長度檢查抓不到，各段分開看都不長 |
| `L1-DESC-MISSING` | error | 缺 meta description |
| `L1-DESC-LONG` | warn | description 超過門檻。**中文 90／英文 160**，依 CJK 佔比自動切換 |
| `L1-DESC-SHORT` | warn／info | description 過短，說服力不足（它決定 SERP 點擊率）。noindex 頁降 info |
| `L1-CANONICAL-MISSING` | warn | 缺 canonical，有查詢參數的頁面尤其重要 |
| `L1-LANG-MISSING` | warn | `<html>` 沒有 `lang` 屬性 |
| `L1-LANG-CONTENT-MISMATCH` | warn／info | 宣告的語言與正文實際語言不符。**只計算沒有用 `lang` 標記的外語**——已標記代表作者知道也標對了，那不是缺陷。warn＝未標記的外語明顯多於本文語言；info＝介面元件（`<option>`／`<button>` 等）沒跟著換語言 |
| `L1-NOINDEX` | info | 此頁標了 `noindex`——確認是刻意的 |
| `L1-TWITTER-CARD-MISSING` | info | 缺 `twitter:card` |
| `L1-TWITTER-SITE-MISSING` | info | 有 `twitter:creator` 但缺 `twitter:site`（作者帳號 vs 網站帳號，用途不同） |

### L2 內容結構（29）

| 代碼 | 級別 | 是什麼 |
|---|---|---|
| `L2-CLIENT-RENDERED` | error | 正文由瀏覽器端 fetch，爬蟲看到「載入中…」。**結構可能全過但沒有內容** |
| `L2-CLIENT-RENDERED-PARTIAL` | warn | 正文量正常，但有局部動態區塊（留言、即時資料）。確認那一區需不需要被看到 |
| `L2-CLIENT-RENDERED-NOINDEX` | info | 同上但該頁已 `noindex`——讓「刻意的」與「該修沒修」分開計數 |
| `L2-THIN-CONTENT` | warn／info | 扣掉 nav/header/footer 後正文過少。有載入佔位（原因已由 `CLIENT-RENDERED` 說明）或該頁 `noindex`（如 404，本來就該短）時降 info |
| `L2-TEMPLATE-NOT-RENDERED` | error／info | 模板佔位元素是空的。**比字數更直接的證據**——176 字的空殼與 176 字的短文，字數上完全一樣。noindex 頁降 info |
| `L2-ICON-LIGATURE-TEXT` | info | 圖示字型（Material Symbols 等）的 ligature 名稱就是元素的文字內容，會被爬蟲與 LLM 當成正文讀走（`arrow_back dark_mode…`）。⚠ 補救方式（`aria-hidden="true"`）**屬從業共識，無官方出處**，所以只報 info |
| `L2-FAKE-HEADING` | error | `<p class="section-heading">` 這類假標題。改標籤即可，**class 不動、視覺零變動** |
| `L2-HEADING-EMPTY` | error | 標題元素是空的（文字由 JS 填）。預設文字寫回 HTML |
| `L2-H1-MISSING` | error | 沒有 `h1` |
| `L2-H1-MULTIPLE` | warn | 多個 `h1` |
| `L2-HEADING-SKIP` | warn | 標題階層跳級。**根因常在缺的那一層，不是被報的那一層** |
| `L2-TITLE-NOT-HEADING` | info | 卡片標題不是 heading。數量通常很大，**不要全改**——挑真的需要被讀成清單的地方 |
| `L2-NO-INTERNAL-LINKS` | error | 孤島頁，讀者與爬蟲都走不到下一頁 |
| `L2-FEW-INTERNAL-LINKS` | info | 不重複內部連結少於 3 個 |
| `L2-IMG-ALT-MISSING` | error | 圖片沒有 `alt` 屬性 |
| `L2-IMG-ALT-EMPTY` | info | `alt=""`——僅裝飾性圖片才該如此 |
| `L2-JSONLD-INVALID` | error | JSON-LD 語法錯誤，整段會被忽略，等於沒寫 |
| `L2-JSONLD-MISSING` | warn | 完全沒有結構化資料 |
| `L2-ARTICLE-NO-DATE` | error | Article 型缺 `datePublished` |
| `L2-ARTICLE-NO-AUTHOR` | warn | Article 型缺 `author`。**YMYL 的第一要件是「誰寫的」** |
| `L2-FUTURE-DATE` | warn | `datePublished` 在未來＝頁面已上線卻宣稱未發佈。多半是把排程日當發佈日 |
| `L2-NO-MODIFIED-DATE` | info | 有 `datePublished` 無 `dateModified`。⚠ **不要為了消這條而填假日期**——沒有機制與刻意留空是兩回事，見〈調整門檻時的原則〉 |
| `L2-NO-TIME-TAG` | info | 日期只是純文字，沒有帶 `datetime` 的 `<time>` |
| `L2-NO-ARTICLE-TAG` | info | 標為 Article 卻沒有 `<article>` 元素 |
| `L2-BREADCRUMB-MISSING` | warn | 缺 BreadcrumbList JSON-LD。路徑越深收益越大（首頁不報） |
| `L2-BILINGUAL-CONCAT` | info | 同頁雙語 DOM 造成的中英黏連。**訊息會分辨兩種狀況**：架構問題 vs 翻譯進度 |
| `L2-I18N-DICT-UNTRANSLATED` | warn | `data-i18n` 字典裡，非中日韓語言的值仍是中日韓文字。**欄位有填但沒翻**——「有沒有填」的檢查抓不到。方向不對稱：中文字典裡有拉丁字母（品牌名、程式碼）不報 |
| `L2-I18N-DICT-KEY-MISMATCH` | warn／info | warn＝`data-i18n` 用了字典沒有的鍵（切語言時那個位置會是空的）；info＝各語言字典的鍵集合不一致 |
| `L2-I18N-DICT-UNCHECKED` | info | 有 `data-i18n` 但找不到可解析的字典（只認得 `zh:{…}, en:{…}` 這類物件字面值）。**明說未檢查，不是通過**——多數站用 i18next 或別的格式 |

### L3 AI 可見度（4）

| 代碼 | 級別 | 是什麼 |
|---|---|---|
| `L3-AI-SNIPPET-BLOCKED` | warn | 頁面設定使 AI 快照不可用 |
| `L3-AI-SNIPPET-PARTIAL` | info | 快照資格受限 |
| `L3-GEO-SIGNALS-NONE` | info | Article 完全沒有可引用訊號（統計、引述、出處） |
| `L3-GEO-SIGNALS-THIN` | info | 可引用訊號偏少。**刻意不給目標數字**——論文沒有提供閾值 |

### SITE 站層級（13）

| 代碼 | 級別 | 是什麼 |
|---|---|---|
| `SITE-ROBOTS-MISSING` | error | 沒有 robots.txt |
| `SITE-SITEMAP-MISSING` | error | 沒有 sitemap |
| `SITE-SITEMAP-NOINDEX-CONFLICT` | warn | sitemap 邀請爬蟲來看一個標了 `noindex` 的頁——矛盾訊號 |
| `SITE-TITLE-DUP` | error | 多頁共用同一個 `<title>`＝告訴搜尋引擎這幾頁是重複內容 |
| `SITE-DESC-DUP` | warn | 多頁共用同一段 description |
| `SITE-LANG-INCONSISTENT` | warn | 同一語言用了多種寫法（`zh-TW` 與 `zh-Hant` 混用）。**不是「站上有多種語言」**——那是雙語站該有的樣子 |
| `SITE-DEAD-INTERNAL-LINK` | error | 站內連結指向不存在的路徑。**會處理 clean URL 與百分比編碼**（見〈已知限制〉） |
| `SITE-RSS-MISSING` | warn | 沒有 RSS feed——那是 LLM 抓內容的常用管道 |
| `SITE-LLMSTXT-MISSING` | info | 沒有 `llms.txt`。**證據弱**：尚無搜尋引擎官方表態支持 |
| `SITE-AI-POLICY` | info | robots.txt 對 AI 爬蟲的分流現況（擋訓練／開放檢索各幾支） |
| `SITE-AI-CRAWLER-UNSPECIFIED` | info | 有 AI 爬蟲未被明確允許或拒絕 |
| `SITE-AI-RETRIEVAL-BLOCKED` | error | 擋掉了**檢索型**爬蟲——那會讓 AI 回答時無法引用本站 |
| `SITE-CLAUDE-USER-BLOCKED` | error | robots.txt 擋掉 `Claude-User`。⚠ Anthropic 是唯一會遵守這條的，擋了會讓使用者貼本站網址請 Claude 讀取時**真的失敗** |

## 出處

**出處要能被解析成可驗證的位置，不能只寫名稱。** 只寫名稱的話，
「這條規則還成立嗎」沒辦法回查，也沒辦法自動監測它有沒有悄悄改版。

| 來源 | 用在哪 |
|---|---|
| [Google Search Quality Rater Guidelines](https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf)（2025-09-11 版，182 頁） | L4 全部頁碼依據 |
| [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735)（Aggarwal et al., KDD 2024；arXiv 現為 v3） | 五戰術與 `L3-GEO-*` |
| [A Critical Survey of GEO (2023-2026)](https://arxiv.org/abs/2607.14035)（回顧 45 篇） | `L3-GEO-*` 的證據強度限定 |
| [What Gets Cited: Competitive GEO in AI Answer Engines](https://arxiv.org/abs/2605.25517)（252,000 次試驗、6 個模型、18 因子） | `L3-GEO-*` 的「不給目標數字」立場 |
| [Structural Feature Engineering for GEO](https://arxiv.org/abs/2603.29979) | 不是任何規則的依據——記錄證據衝突，見下 |
| [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) | L1 多數規則 |
| [Google robots.txt 規範](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt) | `SITE-ROBOTS-*`、`SITE-AI-*` |
| [Google 結構化資料總覽](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) | `L2-JSONLD-*`、`L2-ARTICLE-*` |
| [Google AI 功能與你的網站](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | `SITE-LLMSTXT-MISSING` 的措辭 |

最後一條的逐字聲明（段落「Mythbusting generative AI search: what you don't need to do」）：

> "You don't need to create new machine readable files, AI text files, markup, or
> Markdown to appear in Google Search (including its generative AI capabilities),
> as Google Search itself doesn't use them... Doing so will neither harm nor help
> your site's visibility or rankings in Google Search, as Google Search ignores them."

這份清單的機器可讀版在 [`watch/sources.json`](https://github.com/matt-ye/yaeo/blob/main/watch/sources.json)，
由 GitHub Actions 每月檢查是否失效或改版。
