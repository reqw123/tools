# 索引牆 · files-web

`file_search_app` 的**檔案索引網頁版**。一次挑一份 `indexes/*.md`，把裡面的
索引項目用網頁 UI 攤開來看——搜尋、依分類／資料夾篩選、標示已遺失的檔案、
一鍵開啟檔案或所在資料夾。也能維護項目（**只動 `.md`，不碰硬碟上的實體檔案**）：
加入單筆、**原地編輯分類／說明**、移除單筆、**批次匯入資料夾**、
**批次補說明（可用 AI）**、**批次分類**（補空白／舊→新）、**批次刪除**。

跟便利貼版 [`notes-web`](../notes-web) 是**同層的兩個獨立分流**：
共用技術棧、各自一個資料夾、不共用程式碼。改**路徑**、在網頁 UI 裡直接編輯
前言 prose、**重新命名索引集**、AI 全文搜尋等仍只在桌面版 `file_search.py`
（重新命名桌面版也沒有）。索引集層級的其他動作都做了：**匯入（=建立）／
匯出**（見 `docs/adr/0003`）、**新增空白 `.md`／刪除整份／用系統文字編輯器開
這份 `.md`**（見 `docs/adr/0004`），對應桌面版索引集選單那幾個按鈕。
「批次補說明」的 AI 模式跟便利貼牆一樣：透過 `server/ai_bridge.py` 子行程呼叫
桌面版的 `AIDescriptionService`，不重寫 AI 邏輯（需要環境有 Python +
`file_search_app`；缺了只有 `/api/ai/*` 回 502，其餘照常）。

- 為什麼另開 app、把 parser 重寫成 TS：見
  [`docs/adr/0001-…`](./docs/adr/0001-separate-readonly-app-with-ported-parser.md)
- 為什麼後來放寬成允許「項目層級」增刪：見
  [`docs/adr/0002-…`](./docs/adr/0002-allow-entry-level-editing.md)
- 為什麼索引集層級的匯入／匯出也放寬：見
  [`docs/adr/0003-…`](./docs/adr/0003-allow-index-set-create-import.md)
- 為什麼新增空白／刪除／開編輯器也搬上網頁：見
  [`docs/adr/0004-…`](./docs/adr/0004-allow-index-set-create-blank-delete-edit.md)
- 詞彙（索引集／索引項目／分類／說明／前言／遺失項目）：見 [`CONTEXT.md`](./CONTEXT.md)

## 技術棧

| 層 | 用什麼 |
|---|---|
| 前端 | Vite 8 · React 19 · TypeScript · Tailwind 4（`@tailwindcss/vite`） |
| 資料同步 | TanStack Query 5 |
| 後端 | Fastify 5（只綁 `127.0.0.1`，因為有「開啟／寫入本機任意路徑」的能力） |
| 索引解析 | ~10 行 TS 正則，移植自 `IndexRepository._ROW_RE`，不走 Python |
| AI 補說明 | `server/ai_bridge.py` 子行程呼叫桌面版 `AIDescriptionService`（不重寫 AI 邏輯；需 Python + `file_search_app`） |
| 前言 render | `marked` |

## 開始

兩個網頁分流可以一次啟動：

- **雙擊 `file_search/啟動-便利貼與索引網頁.bat`** — 第一次會自動 `npm install`（根目錄 +
  兩個子專案），之後每次就是起 4 個 dev server（2 API + 2 Vite）並開兩個瀏覽器分頁。
- 或手動：

  ```bash
  cd C:\tools\file_search
  npm install      # 只需第一次（裝根目錄的 concurrently）
  npm run dev      # 便利貼 5273 + 索引 5274，四條 log 分開標色
  ```

或只跑這一個：

```bash
cd files-web
npm install
npm run dev
```

- 前端：http://localhost:5274
- 後端 API：http://localhost:8788 （Vite 把 `/api` 轉發過去）
- 索引來源：`../indexes/*.md`（跟桌面版共用那一份）。用環境變數 `INDEX_DIR`
  覆寫（測試用，別指到真的 `indexes/`）。
- AI 補說明需要環境有 Python 且能 `import file_search_app`（用 `PYTHON` 環境
  變數指定直譯器，預設 `python`）。沒有的話 UI 其餘功能照常，只有 AI 相關的
  按鈕會回錯誤。

其他指令：

```bash
npm run build   # tsc + vite build → dist/
npm start       # 正式模式：Fastify 同時吐 dist/ 與 API（單一 8788 埠，仍只綁 127.0.0.1）
npm run lint    # oxlint
```

## API

唯讀：

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/indexes` | `indexes/` 最上層所有 `.md` 檔名（非遞迴，跟桌面版 `list_index_files()` 一致） |
| GET | `/api/indexes/:name` | 解析後的一份索引集：`{ name, entries[], preamble, raw, skipped }`（`raw` = 整份 .md 原文，給「文件檢視」用） |
| POST | `/api/exists` | `{ paths[] }` → `{ stats: { <path>: { exists, size?, mtime? } } }`，前端拿目前可見的列來批次查 |
| POST | `/api/open` | `{ path, select? }` → 用系統檔案總管開啟（`select:true` 開資料夾並選中該檔）。非絕對路徑回 400 |
| POST | `/api/preview` | `{ path }` → `{ kind, text?, truncated?, bytes? }`。純文字／markdown 檔案回內容（上限 256 KB，超過 8 MB 不讀）；其他回 `kind:"unsupported"` |
| GET | `/api/file?path=…` | 串流被索引的檔案本身（圖片／影音／PDF）。支援 `Range`（影音拖進度），非絕對路徑 400、找不到 404 |
| GET | `/api/browse?path=…` | 選檔／選資料夾視窗用。`path` 空 → 磁碟機／根目錄清單；否則列該目錄的子資料夾與檔案（上限 4000 筆）。回 `{ path, parent, dirs[], files[], truncated }` |
| POST | `/api/scan` | `{ dir, recursive?, categories? }` → 遞迴掃描資料夾（`categories` 是類型標籤，空 = 全部）。回 `{ files[], truncated, categoryCounts[] }`；超過 1000 筆 `truncated:true`（不該拿去匯入）。移植自 `scan_service.py` |
| GET | `/api/scan-categories` | 檔案類型篩選按鈕的 `{ label, icon, color }`（跟 `scan` 同一份 `EXT_CATEGORIES`；**跟便利貼牆「AI 生成便利貼」的掃描分類同一份**——含「程式碼」「設定與資料」「筆記本」，「其他」也可選）|
| GET | `/api/indexes/:name/blank-suggestions` | 「批次補說明」步驟 1：說明是空的、檔案還在的項目 + 內容擷取建議。回 `{ items[], truncated }`。移植自 `find_blank_entries` + `build_suggestion` |

AI（「批次補說明」的 AI 模式 + AI 設定；全部透過 `server/ai_bridge.py` 子行程
呼叫桌面版 `AIDescriptionService`／`PreviewService`，不重寫 AI 邏輯）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/ai/target` | 目前 AI 去向摘要（`label` / `model` / `endpoint` / `lan` / `leaves_machine`）+ 累計呼叫次數 + 是否已設定。送出前確認視窗用 |
| GET | `/api/ai/settings` | 讀 AI 設定（API Key 只回 `has_key`） |
| PUT | `/api/ai/settings` | 存 AI 設定（沒帶新 `api_key` 就沿用舊的）。跟桌面版／便利貼牆共用同一份 `.ai_settings.json` |
| POST | `/api/ai/test` | 測連線（可帶未存檔的設定）→ `{ ok, warning, error }` |
| POST | `/api/ai/models` | 那台 Ollama 已安裝的模型清單（可帶未存檔的設定）→ `{ models: string[]\|null, error }` |
| POST | `/api/ai/suggest` | `{ path, category? }` → 單一檔案 AI 產生一段說明 → `{ suggestion, error, skipped }`。前端對每個勾選項目各呼叫一次、顯示進度。對應桌面版 `AIDescriptionService._generate_one` 一筆 |

Python 不在（`PYTHON` 環境變數或 `python` 找不到、`file_search_app` 匯不進來）時
這幾個端點回 502；非 AI 的功能全部不受影響。

寫入（只動索引集 `.md`，**絕不碰硬碟上的實體檔案**；移植自 `IndexRepository`）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/indexes/:name/entries` | `{ path, category?, description? }` → 附加一列（`_format_path_code` + `_sanitize_cell`）。路徑已在索引集裡回 409、空白回 422 |
| POST | `/api/indexes/:name/entries/bulk` | `{ paths[], category? }` → 批次附加（整批共用一個分類，說明留空；已收錄的略過）。回 `{ added }`。移植自 `append_rows` |
| DELETE | `/api/indexes/:name/entries/:serial?expect=<path>` | 移除第 `serial`（1-based 原始列序）列。`expect` 不符回 409、序號超範圍回 404 |
| POST | `/api/indexes/:name/entries/bulk-delete` | `{ items: [{ serial, path? }] }` → 一次移除多列（都對原始列序，一次寫入）。回 `{ removed }`。移植自 `remove_rows_by_occurrences` |
| PATCH | `/api/indexes/:name/entries` | `{ updates: [{ serial, path?, category?, description? }] }` → 原地改既有列的分類／說明（省略的欄位沿用原值，路徑與位置不動），一次寫入。回 `{ updated }`。移植自 `update_row_by_occurrence`。單列「編輯」送一筆；「批次補說明」步驟 2 送一批（只帶 `description`） |

索引集層級（見 `docs/adr/0003`、`0004`）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/indexes/import` | `{ name, content }` → 把一份既有 `.md` 的內容存成新索引集。撞名／不合法檔名回 422。`validateIndexName()` 對齊桌面版 `validate_name()` |
| POST | `/api/indexes` | `{ name }` → 建立一份**空白**索引集（內建範本＝桌面版 `_DEFAULT_INDEX_TEMPLATE`）。回 `{ name }`。對應桌面版「🗂 新增索引集」 |
| DELETE | `/api/indexes/:name` | 刪掉整份 `.md` 索引集（**不碰實體檔案**）。找不到回 404。二次確認在前端 `DeleteIndexDialog`。對應桌面版「🗑️ 刪除索引集」 |
| POST | `/api/indexes/:name/edit` | 在跑 server 的那台電腦用系統文字編輯器（VS Code → 記事本／`open -t`／`xdg-open`）開啟這份 `.md`。對應桌面版「編輯索引檔案」 |

`:name` 只接受單一 `.md` 檔名，含 `/` `\` `..` 一律 404（擋路徑穿越）。所有寫入
走原子替換（暫存檔 + rename，對應桌面版 `atomic_io.py`）；`DELETE` 是直接
`unlink`。

### 索引集解析

一份 `.md` = 前言（prose）+ 一張 `| \`路徑\` | 分類 | 說明 |` 表格。

- 表格列用移植的 `_ROW_RE` 逐行比對；分隔線 `|---|` 跳過。
- 表格以外、表格之前的行 → `preamble`（原文，前端用 `marked` render，預設折疊）。
- 開頭是 `|`、含反引號、但格式不符的列 → 計入 `skipped`（前端在底部顯示
  「已略過 N 列」，讓「共 M 項」不說謊）。純表頭那類沒有反引號的行靜默忽略。
- `entries[].serial` 是 1-based 原始列序；`dir` 是完整上層路徑（原始分隔符），
  `parent` 是直接父資料夾名，`ext` 是小寫副檔名。

## 前端行為

- **對話框關閉**：Esc、右上 ×、或**點背景**。「點背景關閉」用 `lib/scrimClose.ts`
  ——只有滑鼠按下＋放開都落在背景本身才算，所以從對話框裡的輸入框往外拖曳
  選字（右到左框選容易滑出邊界）放開時不會誤關。
- **清單 / 文件 切換**（頂部右側）：「清單」是可搜尋篩選的項目瀏覽器；「文件」把
  整份索引集的 `.md`（前言 + 表格）用 `marked` render 成一頁看。文件模式下只保留
  一個搜尋框——輸入後**只留下符合的表格列**（不符合的列、以及前言等非項目區塊都
  收起來，套 `.dv-hide`），符合的文字高亮，右下角小徽章顯示符合筆數；清空搜尋字
  就恢復整份文件（`DocView` 走訪 DOM 自己加 class／包 `<mark>`，不重打 `marked`）。
  （這顆鈕原本叫「原文」，會被誤會成「看某個索引項目的原始內容」，已改名。）
- **看被索引的檔案本身**：展開一列後，可預覽的類型會多一顆「預覽內容」，直接在
  網頁上看：
  - 圖片 → `<img>`；影音（`.mp4` `.mp3`…）→ `<video>`／`<audio>`，可拖進度（後端支援 Range）
  - PDF → 內嵌檢視
  - `.md` → render 成 HTML；`.txt` / `.json` / 程式碼 → 等寬字顯示（上限 256 KB）
  - Office（`.docx` `.pptx` `.xlsx`）、壓縮檔等 → 不預覽，請「開啟檔案」
  - `.mkv` / `.mov` 之類瀏覽器可能沒有解碼器，`<video>` 會顯示錯誤——那也請「開啟檔案」
  - 文字／markdown 預覽框上方有字級縮放（`−` `N%` `+`）；滑鼠移到框上時
    `Ctrl`/`⌘` + `+` / `−` / `0`、或 `Ctrl`＋滾輪也能縮，只縮這個框、不動整頁
    瀏覽器縮放，倍率記在 `localStorage`（`usePreviewZoom`）
- **索引集**：頂部下拉切換，一次一份。記住上次開的（`localStorage`），下次直接
  載入；那份不在了就退回清單第一份。切換時清掉篩選、捲回頂部。**不做**「全部
  索引」聚合。
- **清單**：緊湊列，一列一項。收合列 = 類型色點 · 序號 · 檔名 · 父資料夾名 ·
  分類 chip · 說明 · 遺失徽章 · 檔案大小。點列 → inline 展開：完整路徑（可選取
  複製）· 類型／副檔名／大小／修改時間 · `複製路徑`／`開啟所在資料夾`／`開啟檔案`／
  `編輯`／`從索引移除`。
- **加入索引**：工具列「＋ 加入索引」→ 選檔視窗（後端 `/browse` 逐層列目錄，
  記住上次瀏覽到的資料夾）挑一個檔案 → 填分類（可留空／datalist 帶既有分類）＋
  說明 → 附加一列到目前這份 `.md`。單檔、可重複。對應桌面版「新增檔案…」＋
  `AddEntryDialog`，差別只在瀏覽器拿不到原生選檔視窗，選檔改由後端＋自繪面板。
- **編輯**：展開列裡的「編輯」→ inline 小表單改**分類**（datalist 帶既有分類）
  ＋**說明**，「儲存變更」時只重寫那一列（路徑、在表格裡的位置都不動）。沒改
  就按不下去。對應桌面版「✏️ 編輯所選列」。要換路徑＝移除再重加。
- **從索引移除**：展開列裡的紅色按鈕，兩段確認。**只把那一列從 `.md` 拿掉，
  硬碟上的實體檔案完全不動**。用 1-based 原始列序定位並帶上該列預期路徑，
  索引檔被外部改過時會擋下。
- **批次（工具列第二排）**——都只動 `.md`，不碰實體檔案：
  - **匯入資料夾**：選資料夾 →「包含子資料夾」＋類型篩選（每個類型一個色＋
    圖示的按鈕；分類清單跟便利貼牆「AI 生成便利貼」同一份，含程式碼／設定與
    資料／筆記本，「其他」也可選）→ 掃描看筆數／各類別分佈（彩色藥丸，0 筆
    淡化）→ 填一個共用分類 → 一次匯入。遞迴時 `node_modules`／`.git`／`dist`
    這類產出物資料夾整個略過（`SCAN_SKIP_DIRS`）。對應「匯入資料夾…」。
  - **批次補說明**：對「說明是空的、檔案還在」的項目擷取內容（純文字／markdown
    取前 1200 字）當建議，逐筆看過／改／取消勾選 → 只寫說明欄。也能對勾選的
    項目改按「🤖 用 AI 產生」：送出前的確認視窗列出去向／模型／位址／累計呼叫
    次數（雲端 Provider 另有計費警告），確認後逐檔跑、顯示進度、可中途停止；
    AI 回來的建議一樣回清單逐筆看過，「套用」時才寫進 `.md`。
  - **批次分類**（`BatchCategoryDialog`）——一顆按鈕、頂端兩個分頁：
    - **補上空白的**：對「分類是空的」項目逐筆帶一個建議分類（預設**上層資料夾
      名**，可切換成**檔案類型**：圖片／文件／PDF…），逐筆看過／改／取消勾選。
      要看到具體項目所以有清單。純前端算建議（`Entry.parent` ＋ `kindOf`）。
    - **舊分類 → 新分類**：把目前是某分類（或未分類）的項目整批換成另一個分類
      ——只是換名字，不用逐筆挑。舊分類從一排**可點選的晶片**挑（分類多時上面有
      篩選框）、新分類是 `<input list=…>`，看「符合 N 筆」後套用。
    兩者都只寫分類欄，套用走既有的 `PATCH .../entries`，不需要 AI／新後端。
  - **AI 設定**（工具列）：Provider 二選一、Ollama 本機／區網雙選、可自填 IP、
    測試連線、讀取已安裝模型清單。跟桌面版與便利貼牆共用同一份設定檔。
  - **批次刪除**：搜尋＋「只看路徑遺失」＋勾選，兩段確認 → 一次移除多列。
- **虛擬化**：靠 CSS `content-visibility: auto`，不設筆數上限、不引虛擬清單套件。
- **存在檢查**：`IntersectionObserver` 收集進入視窗附近的列 → 批次打 `/exists`，
  結果前端快取；工具列 🔄「重新檢查全部」清掉快取重查目前結果。
- **分組**：不分組 ∕ 依分類 ∕ 依資料夾（每組可折疊、顯示筆數）。
  **排序**：原順序 ∕ 檔名。搜尋比對檔名／分類／說明／完整路徑／序號。
- **主題**：三態（跟系統 ∕ 淺 ∕ 深），右上角切換，記在 `localStorage`。

## 檔案

```
server/
  index.ts     Fastify 進入點（dev 只跑 API；prod 也吐 dist/），只綁 127.0.0.1
  store.ts     讀 indexes/*.md、解析表格、fs.stat、shell 出檔案總管；
               寫入（append_row(s) / remove_rows_by_occurrences /
               update_row_by_occurrence / atomic_write_text 的 TS 移植）；
               目錄瀏覽（browseDir）、資料夾掃描（scanFolder）、內容擷取建議
               （suggestDescription / blankSuggestions）
  routes.ts    唯讀端點 + 項目增刪改（含 bulk / bulk-delete / PATCH）
               + 索引集層級（import／POST 建空白／DELETE／edit）+ /browse + /scan + blank-suggestions
  ai.ts        runBridge()：把 server/ai_bridge.py 當子行程叫（stdin JSON / stdout JSON）
  ai-routes.ts /api/ai/*（target · settings · test · models · suggest）
  ai_bridge.py Node ↔ file_search_app 的 AI 橋接（AIDescriptionService / PreviewService）
src/
  lib/       api · ai（aiApi）· ollamaUrl（Ollama 位址正規化，跟便利貼牆同一份）·
             format（類型分組／大小／時間）· lastIndex／lastDir（localStorage）·
             scrimClose（點背景關閉，拖曳選字滑出邊界不誤關）
  hooks/     useIndexes（清單＋單份＋useImportIndex／useCreateIndex／useDeleteIndex／useEditIndex／
             useBrowse／useAddEntry／useUpdateEntry／useDeleteEntry／
             useScan／useBulkAdd／useBlankSuggestions／useBulkDescribe／useBulkDelete）·
             useAi（useAiTarget／useAiSettings／useSaveAiSettings／useTestConnection／useOllamaModels）· useExists
  components/ App · Toolbar · Preamble · DocView · EntryList · EntryRow（含「編輯」「從索引移除」）·
             FilePreview · FileBrowser（選檔／選資料夾，mode='file'|'dir'）· AiSettingsDialog ·
             AddEntryDialog · BatchImportDialog · BatchDescribeDialog（含 AI 模式）·
             BatchCategoryDialog（批次分類：補空白／舊→新）· BatchDeleteDialog ·
             ImportIndexDialog · CreateIndexDialog · DeleteIndexDialog（索引集層級）· ThemeToggle
  index.css  Tailwind + 「檔案室 / 索引卡」手寫視覺（冷調紙面、鋼藍標記色、
             等寬字排路徑、三態主題）
```

## 跟桌面版 / 便利貼版的關係

- **索引檔案**：跟桌面版 `file_search.py` 共用 `indexes/*.md`。這裡會寫，但只
  在「索引項目層級」（加入／編輯分類說明／移除／批次匯入／批次補說明／
  批次刪除），且只動表格列、不碰實體檔案（見
  [`docs/adr/0002`](./docs/adr/0002-allow-entry-level-editing.md)）。
- **AI 補說明**：跟桌面版共用 `.ai_settings.json` / `ai_secrets.json` /
  `.ai_usage.json`（在這裡改設定，桌面版與便利貼牆也生效），且不重寫 AI 邏輯——
  `server/ai_bridge.py` 子行程直接呼叫桌面版的 `AIDescriptionService`。
  網頁版不做音訊／影片轉錄（那類檔案會被當「沒有可摘要的內容」略過）。
- **AI 全文搜尋、改路徑、在網頁 UI 裡編輯前言 prose、重新命名索引集、
  全文快取、重複偵測、清除失效項目**：一律不做——那些是桌面版的職責
  （重新命名桌面版也沒有；前言 prose 現在的答案是「編輯索引集」按鈕開系統
  編輯器自己改）。索引集層級的**匯入（=建立）／匯出**（`docs/adr/0003`）、
  **新增空白 `.md`／刪除整份／開系統編輯器**（`docs/adr/0004`）都做了，
  對應工具列「匯出索引集」右邊那排正方形小按鈕。
