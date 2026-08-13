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
| `skills/seo-aeo-audit/` | Claude Code skill：四層檢核 ＋ 55 條規則 |
| `skills/seo-aeo-audit/scripts/seo-check.mjs` | 零相依的靜態檢核器（Node，不需 npm install） |
| `skills/seo-aeo-audit/scripts/psi-check.mjs` | PageSpeed Insights 包裝（需自己的 API key） |
| `watch/` | 定期檢索：出處是否失效、爬蟲清單是否變動、生態是否有新縮寫 |

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

---

## 三個設計立場

**① 檢核建置產物，不是原始碼。**
兩者可以完全不同。實例：某頁的經歷描述用字串插值輸出，HTML 裡是
`&lt;a href=...&gt;` 的字面文字——使用者看得到正常的連結（JS 載入後重繪過），
但爬蟲拿到的是轉義後的純文字，9 個外連對它們等於不存在。

**② 這支腳本不執行 JS——這是特性不是限制。**
爬蟲與 LLM 多數也不執行。腳本看到空的，它們就看到空的。

**③ 弱訊號不寫成 error。**
`L3-GEO-*` 只報 `info`，而且不給目標數字——論文說的是「加了會提升可見度」，
不是「沒加就是錯」，也沒有提供閾值。

---

## 出處

| 來源 | 用在哪 |
|---|---|
| [Google Search Quality Rater Guidelines](https://guidelines.raterhub.com/searchqualityevaluatorguidelines.pdf)（2025-09-11 版） | L4 全部頁碼依據 |
| [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735)（Aggarwal et al., KDD 2024） | 五戰術與 `L3-GEO-*` |
| Google Search Central 官方文件 | L1／L2 多數規則 |

`watch/sources.json` 是機器可讀的完整清單，由 GitHub Actions 定期檢查是否失效。

---

## 授權

MIT。規則的**出處**各有其授權，引用時請依原始來源標註。
