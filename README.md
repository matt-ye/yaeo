# YAEO — Yet Another Engine Optimization

**又一個引擎優化。差別是：每條規則都附出處。**

SEO → AEO → GEO → LLMO，縮寫每季都在增加。這個 repo 不打算再發明一個，
它只做一件事：**把「網站對搜尋引擎與 AI 引擎的可見度」變成可以逐條檢查、
而且每條都查得到依據的東西。**

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

---

## 內容

| 路徑 | 是什麼 |
|---|---|
| `skills/seo-aeo-audit/` | Claude Code skill：四層檢核 ＋ 57 個檢查點（L1 15／L2 25／L3 4／SITE 13） |
| `skills/seo-aeo-audit/scripts/seo-check.mjs` | 零相依的靜態檢核器（Node，不需 npm install） |
| `skills/seo-aeo-audit/scripts/psi-check.mjs` | PageSpeed Insights 包裝（需自己的 API key） |
| `skills/seo-aeo-audit/test/` | 回歸測試。只有兩條規則有，理由見〈為什麼只有兩條規則有測試〉 |
| `watch/` | 定期檢索：出處是否失效、爬蟲清單是否變動、生態是否有新縮寫 |

> **「57」數的是檢查點，不是不重複的規則代碼。**
> 檢查點＝腳本裡實際會報一次的地方（`add()` 呼叫處）；不重複的代碼是 **53**
> （L1 12／L2 24／L3 4／SITE 13）——差別在於同一條規則可能有多個觸發點，
> 例如標題過長與過短是兩個檢查點，量的東西也不同（過長量核心，因為站名後綴
> 會被截掉；過短量全長，因為後綴會顯示、站名也是資訊）。
>
> 這個 repo 要求每個數字都查得到出處，那它自己的頭號數字更該寫明是怎麼數的。
> 兩個數字都可以直接復驗：數 `add(` 的呼叫處，或數其中不重複的代碼字串。

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
node --test skills/seo-aeo-audit/test/*.test.mjs
```

用 Node 內建的 test runner，不需要安裝任何東西。**注意要給 glob，不要只給目錄**
——`node --test <目錄>` 在 Node 24 實測會直接失敗（兩支測試各自單獨跑都是通過的），
症狀看起來像測試壞了，其實是呼叫方式。

若你的 Node 版本不支援 glob，就逐檔列出：

```bash
node --test skills/seo-aeo-audit/test/dead-link.test.mjs \
            skills/seo-aeo-audit/test/bilingual-concat.test.mjs
```

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

### 為什麼只有兩條規則有測試

修「誤判」有一個假解法，**長得和真解法一模一樣**：把規則放寬到不再觸發，
報告上看起來就像修好了，誤判確實消失了。

所以這兩個測試都在每個情境裡**埋一條真的該報的**，斷言「只報這一條」——
少報和多報都會失敗。判斷哪條規則值得寫測試，看的不是它多複雜，是
**它錯的時候會不會讓人不再相信整份報告**。

第二條是 `L2-BILINGUAL-CONCAT`。它報的數字一直是對的，問題在那個數字
**把兩種修法完全不同的狀況混在一起**：

| 狀況 | 性質 | 怎麼辦 |
|---|---|---|
| 同一份內容的中英兩版同時在 DOM 裡 | 架構 | 改成獨立語言 URL |
| 英文頁上還沒翻譯的內容退回中文 | 內容進度 | 翻完自然消失 |

加判準時試錯兩次，兩次都是**靠標記判斷**——「有沒有 `lang` 屬性」會把第一種
一起消掉（常見雙語元件兩半都帶 `lang`）；「兩邊都宣告且語言不同」會漏掉用
`class="zh-only"` 而不帶 `lang` 的手刻頁。最後改成**靠內容**：相鄰兩元素，
前者主要中日韓、後者主要拉丁。所以那個測試的重點不是數字對不對，
是**三種不同的標記方式都要判對**。

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
