<!-- English: README.en.md -->
**中文** · [English](README.en.md)

# YAEO — Yet Another Engine Optimization

**又一個引擎優化。差別是：每條規則都附出處。**

SEO → AEO → GEO → LLMO，縮寫每季都在增加。這個 repo 不打算再發明一個，
它只做一件事：**把「網站對搜尋引擎與 AI 引擎的可見度」變成可以逐條檢查、
而且每條都查得到依據的東西。**

> Search Engine Optimization（**SEO**）、Answer Engine Optimization（**AEO**）、
> Generative Engine Optimization（**GEO**）、Large Language Model Optimization（**LLMO**）
> ——四個縮寫講的是同一件事的不同切面：**那台機器看不看得見你的內容、讀不讀得懂、
> 願不願意引用。** 差別只在「那台機器」是搜尋引擎、問答引擎，還是語言模型。

---

## 為什麼再做一個

市面上的 SEO skill 很多，但有兩個常見問題：

**① 無來源的百分比宣稱。** 「加上 FAQ schema 可提升 30% 點擊率」這類數字大量流傳，
往回追常常找不到任何原始研究。本 repo 的規則要嘛來自 Google 官方文件，
要嘛來自同行評審論文，要嘛明白標示「從業共識，證據弱」。
**不確定的規則寧可標弱，不要加數字。**

**② 用英文的門檻檢查中文網站。** `<title>` 60 字元、description 160 字元
是英文的經驗值。套到中文會把一整批正常的標題判成過長——中文的資訊密度不同。
本檢核器偵測中日韓字元比例後切換門檻。

同一個「兩種語言的基準本來就不對稱」也用在別處。`L1-LANG-CONTENT-MISMATCH`
比對「宣告的語言」與「正文實際的語言」，而它的判準刻意單向：宣告英文卻整塊
中日韓可以報，宣告中文卻整塊拉丁**不能報**——中文頁出現品牌名、程式碼、縮寫
是常態，反向套用會整批誤判。

---

## 內容

| 路徑 | 是什麼 |
|---|---|
| `skills/seo-aeo-audit/` | Claude Code skill：四層檢核 ＋ **59 條規則**（L1 13／L2 29／L3 4／SITE 13） |
| `skills/seo-aeo-audit/scripts/seo-check.mjs` | 零相依的靜態檢核器（Node，不需 npm install） |
| `skills/seo-aeo-audit/scripts/psi-check.mjs` | PageSpeed Insights 包裝（需自己的 API key） |
| `skills/seo-aeo-audit/test/` | 回歸測試。只有**判準出過問題**的規則才有，理由見〈哪些規則值得寫測試〉 |
| `watch/` | 定期檢索：出處是否失效、爬蟲清單是否變動、生態是否有新縮寫 |

> **每一條規則的完整索引在 `skills/seo-aeo-audit/SKILL.md` 的〈完整規則索引〉**
> ——代碼、級別、是什麼，一條不漏，不必去讀 45 KB 的腳本。
>
> 「59」數的是不重複的規則代碼，而且**由 `test/rule-index.test.mjs` 守著**——
> 新增規則卻沒補進索引，測試會失敗並指名漏了哪幾條。
>
> ⚠ 這個守衛是補的。索引第一版宣稱「一條不漏」卻漏了 4 條，因為當時的抽取腳本
> 只認 `add('warn', 'CODE'`，把所有**嚴重度隨條件變動**的規則
> （`add(isNoindex ? 'info' : 'warn', 'CODE'`）整類漏掉——而驗證腳本共用同一個
> 假設，於是「雙向驗過」得到的通過毫無意義。**用有相同盲點的工具驗證，等於沒驗。**

## 四層架構

| 層 | 內容 | 判定 |
|---|---|---|
| **L1 技術基礎** | title／description／canonical／OG／lang／sitemap／robots | 全自動 |
| **L2 內容結構** | **正文可見量**、heading 階層、空標題、假標題、alt、內部連結、JSON-LD | 全自動 |
| **L3 AI 可見度** | 站層級可達性（`SITE-*`）＋ 頁層級可引用性（`L3-*`） | 半自動 |
| **L4 YMYL/E-E-A-T** | 作者資訊、專業佐證、共識一致性 | 人工判讀 |

## 怎麼用

先 build（**檢核的是爬蟲看到的建置產物，不是原始碼**）：

```bash
npm run build
```

```bash
node skills/seo-aeo-audit/scripts/seo-check.mjs --dir ./dist --site https://example.com
```

在 Claude Code 裡則把 `skills/seo-aeo-audit/` 放進 `~/.claude/skills/`，
之後說「檢查這個網站的 SEO」就會自動觸發。

### 跑測試

```bash
node skills/seo-aeo-audit/test/dead-link.test.mjs
node skills/seo-aeo-audit/test/bilingual-concat.test.mjs
node skills/seo-aeo-audit/test/lang-content-mismatch.test.mjs
node skills/seo-aeo-audit/test/rule-index.test.mjs
node skills/seo-aeo-audit/test/i18n-dict.test.mjs
```

零相依、直接跑，輸出是給人看的（每個情境印出在測什麼）。

也可以用 Node 內建的 test runner 拿彙總數字（`node --test <檔案>`），
但**別給目錄**——`node --test <目錄>` 在 Node 24 實測會直接失敗，
而各支測試單獨跑都是通過的。症狀看起來像測試壞了，其實是呼叫方式。

---

## 四個設計立場

**① 檢核建置產物，不是原始碼。**
兩者可以完全不同。實例：某頁的經歷描述用字串插值輸出，HTML 裡是
`&lt;a href=...&gt;` 的字面文字——使用者看得到正常的連結（JS 載入後重繪過），
但爬蟲拿到的是轉義後的純文字，9 個外連對它們等於不存在。

**② 這支腳本不執行 JS——這是特性不是限制。**
爬蟲與 LLM 多數也不執行。腳本看到空的，它們就看到空的。

**③ 弱訊號不寫成 error。**
`L3-GEO-*` 只報 `info`，而且不給目標數字——論文說的是「加了會提升可見度」，
不是「沒加就是錯」，也沒有提供閾值。

**④ 誤判要回頭修腳本，不是把門檻調寬到不再觸發。**
`SITE-DEAD-INTERNAL-LINK` 曾在採 clean URL 的靜態主機上誤判率 67%：連結寫
`/gallery`、輸出檔是 `gallery.html`，永遠對不上。Cloudflare Pages、Netlify、
GitHub Pages **全部**預設支援 clean URL——而它是 **error** 級。
**一條 error 整批誤判比漏報更糟**：漏報只是少看到一個問題，整批誤判會讓使用者
不再相信整份報告。

它潛伏那麼久的原因值得記下來：開發時用的網站是 directory 輸出
（`/a/b/index.html`），**那是唯一它本來就正確的模式**。
在唯一測過的環境裡，它從第一版起就是對的。

> **一條規則能潛伏多久，取決於你只在一種環境測它。**

改法是把方向倒過來：原本猜「連結該長什麼樣」（把 `/gallery` 正規化再比對），
改成**先算出每個輸出檔實際到得了的所有網址形式**，再看連結有沒有命中。
前者要窮舉使用者的寫法，後者只要窮舉主機的行為——後者的集合小得多，
而且是查得到的事實。

### 哪些規則值得寫測試

不是每條規則都有測試，判準是：**它錯的時候，會不會讓人不再相信整份報告，
或把人導向錯誤的修法。** 看的不是規則多複雜。

而且修「誤判」有一個假解法，**長得和真解法一模一樣**：把規則放寬到不再觸發，
報告上看起來就像修好了，誤判確實消失了。所以每個測試都在各情境**埋一條真的
該報的**，斷言「只報這一條」——少報和多報都會失敗。

目前有測試的三條，各自出過不同的事：

| 規則 | 出過什麼事 |
|---|---|
| `SITE-DEAD-INTERNAL-LINK` | 在 clean URL 主機上整批誤判，而它是 **error** 級 |
| `L2-BILINGUAL-CONCAT` | 數字一直是對的，但**把兩種修法完全不同的狀況混在一起** |
| `L1-LANG-CONTENT-MISMATCH` | 判準刻意**不對稱**，最容易被後人「順手改成對稱」 |

`L2-BILINGUAL-CONCAT` 混在一起的是這兩種：

| 狀況 | 性質 | 怎麼辦 |
|---|---|---|
| 同一份內容的中英兩版同時在 DOM 裡 | 架構 | 改成獨立語言 URL |
| 英文頁上還沒翻譯的內容退回中文 | 內容進度 | 翻完自然消失 |

加判準時試錯兩次，兩次都是**靠標記判斷**——「有沒有 `lang` 屬性」會把第一種
一起消掉（常見雙語元件兩半都帶 `lang`）；「兩邊都宣告且語言不同」會漏掉用
`class="zh-only"` 而不帶 `lang` 的手刻頁。最後改成**靠內容**：相鄰兩元素，
前者主要中日韓、後者主要拉丁。所以那個測試的重點不是數字對不對，
是**三種不同的標記方式都要判對**。

`L1-LANG-CONTENT-MISMATCH` 的測試有一半是**反向斷言**：機構名出現在英文頁的
連結裡、中文技術文章含大量程式碼與品牌名、通篇英文——這三種都必須保持安靜。
不對稱的判準沒有反向斷言守著，遲早會被改成對稱，然後整批誤判。

---

## 出處

| 來源 | 用在哪 |
|---|---|
| [Google Search Quality Rater Guidelines](https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf)（2025-09-11 版） | L4 全部頁碼依據 |
| [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735)（Aggarwal et al., KDD 2024） | 五戰術與 `L3-GEO-*` |
| Google Search Central 官方文件 | L1／L2 多數規則 |

`watch/sources.json` 是機器可讀的完整清單，由 GitHub Actions 每月檢查是否失效。

### 定期檢查在檢查什麼

規則會過期，而**過期的症狀是靜默的**——檢核器照跑、報告照出，只是依據已經不成立了。
所以 `watch/` 每月做兩件事，結果開成 issue，**只報告、不自動改規則**
（要不要跟著改是需要讀原文判斷的事）：

| | 檢查 | 怎麼偵測 |
|---|---|---|
| ① | 出處還在不在、有沒有悄悄改版 | 依來源性質分三種模式：PDF 比檔案大小、arXiv 比版本號、Google devsite 比頁面自帶的 `Last updated` |
| ② | AI 爬蟲清單有沒有變 | 正向：清單裡的名稱是否仍在官方文件裡；反向：文件裡有沒有清單外的新爬蟲 |
| ③ | 有沒有出現我們還不知道的東西 | 掃 Google Search Central 部落格與 arXiv 的 GEO／AEO 論文，交給模型篩出「值得回去讀原文」的項目 |

②的反向檢查在 2026-08 首跑時抓到三支清單外的爬蟲（`OAI-AdsBot`、
`Google-CloudVertexBot`、`meta-externalads`）。三支都經查證後**刻意不納入規則**——
前兩支只抓站長自己提交或要求的內容，第三支屬廣告生態，都不影響 AI 回答的引用
與訓練同意。理由逐支記在 `watch/crawlers.json`，這樣下個月不會再被當成新發現重報。

③是整個 repo 最危險的一步——讓語言模型讀部落格再吐結論，**正好是這個 repo
反對的做法**。所以它的產物明確定義為「線索」不是「規則」：只列出值得回去讀
原文的項目、一律附原始連結、不產生任何規則文字、不改任何檔案，並且**在報告裡
標明是哪個型號判讀的**——判讀要能追溯到判讀者。

型號也不寫死：`CF_AI_MODEL` 優先，沒設就查當下的型號清單自動挑，並印出實際
用了哪一個。寫死等於埋一個「供應商下架那天才會炸」的地雷。

需要的環境變數（都是選填，沒設時對應的檢查會標成「本次未檢查」而不是顯示綠燈）：

| 變數 | 用途 |
|---|---|
| `CF_ACCOUNT_ID`／`CF_API_TOKEN` | Browser Rendering（Meta 的爬蟲文件對一般抓取回 400，要真瀏覽器）＋ Workers AI（③的判讀） |
| `CF_AI_MODEL` | 覆寫自動挑選。建議留空 |

Token 權限：`Workers AI · Read`＋`Workers AI · Edit`＋`Browser Rendering · Edit`。

---

## 授權

MIT。規則的**出處**各有其授權，引用時請依原始來源標註。
