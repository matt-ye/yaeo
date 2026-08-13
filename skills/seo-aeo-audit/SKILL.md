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
| `SITE-DEAD-INTERNAL-LINK` | 站內連結指向不存在的路徑 |
| `SITE-SITEMAP-NOINDEX-CONFLICT` | sitemap 邀請爬蟲來看一個標了 `noindex` 的頁——矛盾訊號 |
| `SITE-ROBOTS-MISSING` / `SITE-SITEMAP-MISSING` | 兩個最基本的站層級檔案 |
| `SITE-TITLE-DUP` | 多頁共用同一個 `<title>`＝告訴搜尋引擎這幾頁是重複內容 |

> 其餘代碼（`L1-OG-*`、`L2-HEADING-SKIP`、`L2-NO-ARTICLE-TAG` 等）多為 warn/info，
> 訊息本身已說明修法。完整清單見 `scripts/seo-check.mjs`。

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

**llms.txt**：Google 2026-06 官方明確表示不使用它。成本是幾分鐘，放無妨，
但**不要期待排名或引用率提升**，也不要在提案裡把它講成必做項。

#### 頁層級（可引用性）

`L3-GEO-SIGNALS-NONE` / `L3-GEO-SIGNALS-THIN` 只對 **Article 型頁面**檢查，
數三件事：**外部引用網域數、統計數據處數、直接引言處數**。

這三項是下面「GEO 五戰術」裡唯一機械可偵測的部分（權威語氣與流暢度是語意判斷）。

**三件刻意的克制**，也是使用這條規則時該有的態度：

1. **只報 `info`。** 論文說的是「加了會提升可見度」，不是「沒加就是錯」
   ——把弱訊號寫成 error 正是本 skill 反對的做法
2. **不給目標數字。** 論文沒有提供閾值，我們也不編一個出來
3. **只對 Article 檢查。** 列表頁、工具頁沒有引用來源是正常的

> 實測一個站的 51 個 Article 頁：0 頁完全沒有訊號，12 頁偏少。
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

## 出處

- Google SEO Starter Guide（最後更新 2025-12-10）
- Google Search Quality Rater Guidelines 2025-09-11 版（182 頁）——L4 全部頁碼依據
- GEO 論文（Princeton 等，KDD 2024）——五戰術
- Google 官方 llms.txt 立場（2026-06-15 changelog）
