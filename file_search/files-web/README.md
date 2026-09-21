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

多人共用（不是這裡的個人單機模式）：files-web **沒有自己獨立的共用啟動器**——
`SHARE_MODE=lan` 這套機制只透過 `file_search/啟動-多人牆（區網＋公網）.bat`
（[share-gateway](../share-gateway)）啟動，跟便利貼牆（notes-web）共用一份登入、
一個網址，工具列按鈕互切。細節見「區網＋公網共用模式」一節。

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
| POST | `/api/scan/jobs` | 同 `/api/scan` 的參數，但**背景執行、立刻回 `202 { id }`**——「匯入資料夾」的進度條靠這組。掃描每 30ms 讓出一次事件迴圈（server 與 SSE 不會被大資料夾卡住）。路徑不合法直接 400 |
| GET | `/api/scan/jobs/:id` | 輪詢：`{ state: 'running'\|'done'\|'error'\|'cancelled', progress: { walked, matched, dirs, current, total? }, result?, error? }`。`total` 只有「不含子資料夾」才有（可畫百分比）；遞迴掃描事先不知道總數，前端畫不定長進度條＋即時計數。完成後 `result` 同 `/api/scan` 的回應。工作存記憶體、完成後保留 10 分鐘，server 重開就 404 |
| DELETE | `/api/scan/jobs/:id` | 取消進行中的掃描（關閉對話框／改條件／按取消時前端會呼叫）。回 204 |
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

寫入（只動索引集 `.md`，**不碰既有硬碟上的實體檔案**；移植自 `IndexRepository`。
唯一例外是下面的「上傳檔案」——那支會新建一個實體檔案，其餘都只動 `.md`）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/indexes/:name/entries` | `{ path, category?, description? }` → 附加一列（`_format_path_code` + `_sanitize_cell`）。路徑已在索引集裡回 409、空白回 422 |
| POST | `/api/indexes/:name/entries/bulk` | `{ paths[], category? }` → 批次附加（整批共用一個分類，說明留空；已收錄的略過）。回 `{ added }`。移植自 `append_rows` |
| POST | `/api/indexes/:name/upload?category=&description=` | `multipart/form-data`（欄位 `file`）→ 把上傳的檔案落地到這份索引集所在資料夾的 `.uploads/`，再附加一列指向它。回 `{ ok: true, path }`；上限 50MB，超過或索引集不存在都會清掉已寫入的檔案再回錯。**共用模式下遠端使用者的「加入索引」替代路徑**——`/browse`、`/scan` 遠端一律 403（只能瀏覽主機硬碟），這支不用瀏覽主機，遠端也能用，見下面「區網＋公網共用模式」。`category`／`description` 是 query string，不是 multipart 欄位，見 `server/upload-routes.ts` 開頭說明 |
| POST | `/api/indexes/:name/upload-batch?category=` | `multipart/form-data`（多個 `file` 欄位，檔名各自帶 `encodeURIComponent` 過的相對路徑）→ 整批上傳，落地到 `.uploads/` 底下**這一批專屬的資料夾**、保留子資料夾結構，一次寫入。回 `{ added, skipped }`——`skipped` 是路徑不合法／超過大小上限被跳過的檔案數，不會讓整批失敗。單檔上限 50MB、整批最多 500 個檔案、整批加總最多 300MB。**「匯入資料夾」的遠端友善版本**（同上，`/scan` 遠端 403），前端 `UploadFolderDialog` 用瀏覽器原生的 `webkitdirectory` 選擇器 |
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

共用模式（`SHARE_MODE=lan`，見「區網＋公網共用模式」；離線單機模式下前三支
一樣存在但不需要驗證，其餘幾支才只在 `lan` 模式掛上）：

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/share-info` | `{ mode: 'off'\|'lan', ai: bool, loopback: bool, publicUrl?: string, openAccess?: bool }`——前端判斷要不要顯示密碼牆／收斂遠端限定功能。`loopback` 是**這次連線本身**是不是從主機本機進來的，不是看全域 `mode`——見「isRemoteShare」段落。不需驗證 |
| GET | `/api/events` | SSE 長連線（`server/events.ts`）。任何一份 `.md` 內容變了推 `index`、新增/刪除/改名推 `index-list`、活動記錄推 `activity`、在場提示推 `presence`、host 切 AI 開關推 `settings`——`data:{"topics":[...]}`（`change-bus.ts` 的 `ChangeTopic`）。同一條連線的生命週期也是「誰連線／斷線」的訊號來源（見 `connections.ts`） |
| GET | `/api/activity` | `?limit=N`。最近的索引集/項目新增、改、刪除，加上連線／斷線記錄，新到舊 → `{ entries: ActivityEntry[] }`。純記憶體，server 重開歸零 |
| GET | `/api/presence` | 目前正在看哪份索引集 → `{ [indexName]: 作者名[] }`（陣列，同一份可以有好幾個人同時開著）；`''`＝匿名 |
| POST | `/api/presence` | `{ indexName, viewing?, clientId? }`——開著這份索引集時的心跳（`viewing` 省略或 `true`）／離開時說「看完了」（`viewing:false`）。204 |
| GET | `/api/entry-presence?index=` | 這份索引集裡目前正在編輯的項目 → `{ [path]: 作者名[] }`；`index` 沒帶回空物件。跟上面「誰正在看整份索引集」是不同粒度——這個對應 `EntryRow.tsx` 的 inline 編輯表單（`editOpen`），見 `server/entry-presence.ts` |
| POST | `/api/entry-presence` | `{ indexName, path, editing?, clientId? }`——`EntryRow` 的編輯表單開著時的心跳／收起時說「編完了」（`editing:false`）。204 |
| GET/POST/DELETE | `/api/session` | 區網共用模式才有。GET → `{ ok, name, role }`；POST `{ password?, name?, pin? }` → 種 `share_session`／`identity_session` cookie（都沒有 `maxAge`，瀏覽器關掉才失效）；`openAccess` 開著時只需要 `name`+`pin`，不用 `password`。有 IP 登入限速（15 分鐘錯 10 次擋 15 分鐘）。DELETE → 登出 |
| GET | `/api/host/state` | 後台狀態 → `{ openAccess, aiEnabled, people: [{name, createdAt, role}] }`。**只認 loopback**，見「後台管理」 |
| POST | `/api/host/open-access` | `{ open }`——開/關「開放模式」。只認 loopback |
| POST | `/api/host/ai` | `{ enabled }`——開/關遠端「批次補說明」用 AI 建議。即時生效、SSE 推播。只認 loopback |
| POST | `/api/host/people/:name/role` | `{ role: 'editor'\|'viewer' }`——把某個已註冊名字設成唯讀或可編輯。只認 loopback |
| DELETE | `/api/host/people/:name` | 解除某個名字的 PIN 保護（忘記 PIN 的自助解法）。只認 loopback |
| GET | `/api/host/visits` | `?limit=N`。誰、什麼時候造訪過（持久化），給 `/host` 的訪客紀錄文字視窗用。只認 loopback |

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
  - **同時最多開 10 個預覽**（`EntryList` 的 `MAX_PREVIEWS`）：開第 11 個時自動收掉最舊的；
    有預覽開著時右下角（捲動鈕左邊）會出現一顆小圓鈕（橡皮擦圖示＋開著的數量），按一下
    「釋放全部預覽資源」全部收起（列本身仍展開，只卸載預覽）。影片／音訊暫停後不吃 CPU 與網路，
    但只要預覽還開著，每個仍占瀏覽器約 25–35 MB 記憶體（實測，720p VP8）——這就是設上限的原因
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
  **這顆共用模式下遠端使用者按不了**（會瀏覽主機硬碟，見「區網＋公網共用
  模式」的 `isRemoteShare`）。
- **上傳檔案**（`UploadEntryDialog`，2026-09 加）：工具列「上傳檔案」→ 瀏覽器
  原生的檔案選擇器（不經後端 `/browse`，選的是使用者自己這台裝置上的檔案）→
  填分類＋說明 → 上傳到 server，落地成 `.uploads/` 底下的一個新檔案，再附加
  一列指向它。**這是「加入索引」的遠端友善版本**——共用模式下遠端使用者不能
  瀏覽主機硬碟，但可以把自己的檔案傳上來；這顆按鈕不受 `isRemoteShare`
  限制，離線模式一樣能用（純粹多一種「本機挑檔」以外的來源）。上限 50MB。
- **上傳資料夾**（`UploadFolderDialog`，2026-09 加）：跟「上傳檔案」同一個
  理由，但對應「匯入資料夾」——工具列「上傳資料夾」→ 瀏覽器原生的資料夾
  選擇器（`<input webkitdirectory>`，不經後端 `/scan`）→ 選到的一批檔案先在
  前端濾掉 `node_modules`／`.git`／`dist` 這類產出物資料夾（跟本機掃描的
  `SCAN_SKIP_DIRS` 同一份清單）。**檔案類型篩選**（跟「匯入資料夾」一樣的
  一排色塊按鈕＋類別數量分佈）：因為整批檔案已經在瀏覽器手上，不用像本機
  掃描那樣打 `/scan` API 來回——副檔名分類（`lib/extCategories.ts`，跟
  `server/store.ts` 的 `EXT_CATEGORIES` 同一份）純字串比對，直接在前端即時
  算、即時篩，勾選/取消類型時數量立刻更新，沒有「掃描中」的等待狀態。都不
  選＝收錄全部。篩完 → 填一個共用分類 → 一次上傳，保留子資料夾結構、一次
  寫入 `.md`。同樣不受 `isRemoteShare` 限制。單批最多 500 個檔案、單檔
  50MB、整批 300MB，超過的部分伺服器會跳過並回報 `skipped` 數量，不會讓
  整批失敗。
- **編輯**：展開列裡的「編輯」→ inline 小表單改**分類**（datalist 帶既有分類）
  ＋**說明**，「儲存變更」時只重寫那一列（路徑、在表格裡的位置都不動）。沒改
  就按不下去。對應桌面版「✏️ 編輯所選列」。要換路徑＝移除再重加。**共用模式
  下這個表單開著時，其他人的畫面會在這一列看到藍色「XX 正在編輯」徽章**
  （2026-09 加，見 `server/entry-presence.ts`）——每 5 秒送一次心跳，收起
  表單／12 秒沒心跳就自動消失，SSE 即時推播不用重新整理。跟工具列「動態」
  裡的「XX 編輯了「檔名」」是兩件事：那個是**事後**的異動紀錄，這個是**當下**
  正在改的即時提示。
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

## 區網＋公網共用模式

讓**同一個 Wi-Fi 的其他人**（或開了 ngrok 之後**任何人**）用瀏覽器連進來共用
這份索引牆——各自能瀏覽、搜尋、加入／編輯／刪除項目、批次匯入。跟前面「開始」
提到的個人單機模式是同一支程式碼的兩種執行方式，**不是另一個 app**：離線版
（`SHARE_MODE` 未設）完全不會 import 到 `server/share.ts` 的任何一行、`app`
物件也只綁 `127.0.0.1`。

**啟動方式（2026-09 起只有這一種）**：files-web 沒有自己獨立的共用啟動器，
`SHARE_MODE=lan` 只透過 [share-gateway](../share-gateway)（`啟動-多人牆
（區網＋公網）.bat`）啟動——跟便利貼牆（notes-web）共用一份登入、一個網址，
工具列一顆「切換到索引牆」互切。以前有一支只給索引牆單獨用的 `啟動-索引牆
（區網＋公網）.bat`／`啟動-共用索引牆（區網）.bat`（各自 port 8791、資料夾
`public-index-data/`），使用者確認不需要「單獨啟動索引牆」這條路後已移除；
下面這節描述的仍是同一套 `SHARE_MODE=lan` 機制本身（閘道啟動時會把這套
機制打開，只是換了一組 port／資料夾，見 `share-gateway` 自己的說明），並非
機制被拿掉。

**離線／共用兩邊低耦合**（2026-09 修正過一次真實 bug）：`server/index.ts`
的 `activityRoutes`（`/api/activity`、`/api/presence`）跟 `hostRoutes`
（`/api/host/*`）**只在 `SHARE_MODE==='lan'` 才註冊**；離線模式下這兩支
整組不存在（前端對應的 `useActivity`/`usePresence`/`useViewingHeartbeat`
也用 `enabled: isShare` 擋住，不會打出一支 404）。踩過的坑：這三支以前不管
模式都會註冊，`GET /api/events`（SSE，離線也需要，見下面「即時同步」）的
連線生命週期會觸發 `connections.ts` 記一筆「訪客」，寫進
`indexDir/.share/visits.json`——**離線模式下 `indexDir` 就是你真正的個人
`indexes/` 資料夾**，等於單純打開 files-web（不管是不是共用模式）就會在
你的個人資料夾裡多寫一個檔案。現在 `events.ts` 的 SSE handler 只在
`SHARE_MODE==='lan'` 才呼叫 `connectionOpened()`/`connectionClosed()`，
離線模式下這條 SSE 一樣正常連線、正常做即時同步，只是不再側寫連線紀錄。
（`notes-web` 也有這個修正——但它的 `activityRoutes` 額外包了 `/card`／
`/danmaku`／`/people`，這些離線的個人展示情境也合法在用，所以**沒有**
跟著鎖進 `SHARE_MODE==='lan'`，只鎖了 `hostRoutes`；細節見它自己的
`server/index.ts` 註解。）

架構直接搬自便利貼牆 [`notes-web`](../notes-web) 的同款機制（見它的 README／
CLAUDE.md），只是**兩邊各自一份程式碼、各自一份資料，不共用**——這裡先列
跟 notes-web 不同的地方，其餘（loopback 豁免判斷、登入限速、SSE 即時同步、
簽章身分 cookie）原封不動：

- **沒有看板（`/card`）、彈幕**——索引牆沒有對應的展示情境。
- **根路徑 `/` 沒有停用**——notes-web 的 `/wall` 是刻意讓根路徑什麼都不畫，
  這裡**沒有這樣做**：files-web 既有的桌面版工作流程、`npm run dev`、
  `wallpaper-app` 內嵌（`wallpaper-app/servers.js` 的 `urlFor()`）都是直接開
  根路徑，改成根路徑清空會破壞這些既有用法。存取控制完全靠 `<AppGate>` 的
  密碼牆（任何路徑都會經過），所以共用啟動器印出來的網址仍然是
  `http://<ip>:8791/wall`（`WALL_PATH` 常數還在，只是不是唯一入口，純粹沿用
  便利貼牆的「固定分享網址」慣例，方便 QR／複製連結有個好記的路徑）。
- **多了「唯讀身分」（`editor` / `viewer`）**——notes-web 沒有這個概念。
  `/host` 可以把某個已註冊 PIN 的名字設成 `viewer`：登入後看得到牆，但任何
  非 `GET` 請求（加入／編輯／刪除／批次操作）一律 `403`（`shareGuardHook` 的
  `getPersonRole(...) === 'viewer'` 判斷）。沒特別設過的人（含匿名）維持
  `editor`，行為跟以前一樣。給「想開放給別人瀏覽索引，但不想讓對方亂改」的
  情境用。
- **危險端點清單更長**——files-web 平常只綁 loopback 是因為它能 shell 出
  Explorer、開系統文字編輯器、瀏覽/掃描整台硬碟，這幾支即使密碼登入了也
  不能對遠端開放（`shareGuardHook` 擋下）：
  - `POST /api/open`（開檔案總管）
  - `POST /api/browse`、`POST /api/scan` 與 `/api/scan/*`（瀏覽/遞迴掃描本機任意路徑，含背景掃描工作）
  - `POST /api/indexes/:name/edit`（開系統文字編輯器）
  - `PUT /api/ai/settings`、`POST /api/ai/test`、`POST /api/ai/models`（改
    host 的 AI provider／金鑰、連線測試——這些留給 `/host` 的 AI provider
    單選鈕，不留原始設定介面給遠端）
  - AI 開關關著時，其餘 `/api/ai/*`（含批次補說明的 `/ai/suggest`）整組 403

**遠端使用者想貢獻自己的檔案怎麼辦（2026-09 加）**：「加入索引」「匯入資料夾」
被鎖住是因為它們要瀏覽**主機**的硬碟，遠端使用者的裝置跟主機是兩台不同的
機器，讓遠端瀏覽主機硬碟本身就是要擋的事，不是誤鎖。真正的解法是反過來：
`POST /api/indexes/:name/upload`（工具列「上傳檔案」）／`/upload-batch`
（工具列「上傳資料夾」）讓使用者把**自己裝置上**的檔案（或整個資料夾）傳
上來，server 收下 bytes、落地到這份索引集所在資料夾的 `.uploads/`（資料夾
版本保留子資料夾結構），再照一般「加入索引」流程附加一列——完全不需要遠端
瀏覽主機硬碟，這兩顆按鈕都不受 `isRemoteShare` 限制。上傳的檔案物理上就在
主機的 `.uploads/` 資料夾裡，跟本機挑選既有檔案的「加入索引」（只記路徑、
不複製檔案）不同，這是目前僅有的**會新建實體檔案**的兩支寫入端點。

啟動：雙擊 `file_search/啟動-多人牆（區網＋公網）.bat`（見
[share-gateway](../share-gateway) 的說明）。閘道會把兩支後端（notes-web／
files-web）都設成 `SHARE_MODE=lan`，各自綁一個只給閘道用的內部 port，只有
閘道自己對外——密碼、ngrok 公網、共用密鑰的提示流程都在那支 `.bat` 裡問，
files-web 本身不再單獨處理這些。

**port 與資料夾**：閘道模式下 files-web 內部綁 port 8793（只給閘道連，見
`share-gateway/serve.mjs`），資料夾是 `public-share-data/`——跟 notes-web
共用同一個父資料夾，`.share/people.json`／`.share/visits.json` 因此變成
同一份，這是「共用一份登入」成立的基礎（細節見 `share-gateway` 的說明）。
跟個人用的 wallpaper-app／桌面版（固定 8788、讀 `../indexes`）完全分開，
互不干涉。

**loopback 豁免＋ ngrok 隧道判斷**（`isLoopback()`）：帶了 `x-forwarded-for`
標頭的請求一律不算 loopback——那是經 ngrok／反向代理進來的，socket 雖是
`127.0.0.1` 但真正來源在外網，這條規則讓「區網＋公網」用同一支 server 成立。
本機瀏覽器／wallpaper-app 直連不會有這個標頭，永遠豁免、功能完全不收斂。

⚠️ **前端判斷「該不該收斂遠端限定功能」要用 `isRemoteShare`
（`= share.mode==='lan' && !share.loopback`），不要只看 `share.mode`**——
`loopback` 是 `GET /api/share-info` 逐請求算出來的，這是 notes-web 踩過的坑
（早期只用 `isShare` 判斷，開了共用模式後連 host 自己本機都被誤鎖），這裡
`App.tsx` 直接沿用正確版本。目前只有「操作主機本身」的按鈕（加入索引、匯入
資料夾、編輯索引集——見 `Toolbar.tsx`）吃這個判斷，其餘功能不分本機/遠端。

**簡易身分（名字＋PIN）**：共用密碼牆多問「你的名字」＋「PIN」
（`PasswordGate.tsx`）。名字留空＝匿名，永遠可以直接進；一旦決定具名，就要
順便設一組 PIN（≥4 碼），從此這組名字＋PIN 固定、**沒有「改名字」「換 PIN」
的功能**——PIN 忘記只能請牆主到 `/host` 解除保護。已登入的人，之後每個請求
的「作者」優先看簽章 cookie（`identity_session`，HMAC 金鑰＝共用密碼），
蓋過前端 `x-index-author` 標頭；沒有簽章 cookie 的請求標頭可以隨便填，
**除非填到一個已經被保護的名字**——那樣直接當匿名，不讓沒登入的人繞過密碼
牆冒用別人固定住的名字（`server/identity.ts` 的 `fromHeader()`）。

**開放模式**（host 手動開關，暫時跳過共用密碼）：`/host` 的「開放模式」開著
時不用共用密碼就能進牆，但**仍然要求名字＋PIN**，不是整關直接放行——身分
驗證、防冒充沒有一起省掉。純記憶體、預設開、每次重開 server 都重置回開。

**AI 護欄**：批次補說明的 AI 建議預設對遠端關閉（`SHARE_AI=off`），要開放
在 `/host` 即時切換；開著時走誰的 provider／額度也在 `/host` 唯讀顯示
（重用 `GET /api/ai/target`）。額度／寫入限速跟便利貼牆同一套純記憶體
sliding-window：AI 建議每天 30 次（`SHARE_AI_DAILY_LIMIT`）、每個非 `GET`
請求同一 IP 一分鐘 120 次上限。

**後台管理**（固定路徑 `/host`，`HostPanel.tsx`）：**一律只認 loopback**
（`host-routes.ts` 自己在 `onRequest` 檢查，不管 `openAccess` 或共用密碼
cookie 怎樣）——遠端開這個網址進不去背後的 `/api/host/*`，這裡能做的事
（關掉密碼牆、解除別人的身分保護）不該透過共用密碼那層就放行。管五件事：
開放模式開關、
AI 開關、AI provider（OpenAI/Ollama 單選，重用牆面「AI 設定」同一支
`PUT /api/ai/settings`，只送 `provider` 欄位）、身分保護（列出被 PIN 保護的
名字、可設角色 `editor`/`viewer`、可解除保護）、訪客紀錄（持久化，5 秒
輪詢）。

**分享鈕**：工具列的「分享」（`ShareLinkButton.tsx`）只有 `share-info` 回了
`publicUrl` 才出現，點開跳出網址＋複製鈕＋QR（`lib/qr.ts`，
`qrcode-generator`，純前端產生不打外部服務）。免費 ngrok 網址每次重啟就換。

**即時同步**：跟便利貼牆同一套機制——`GET /api/events`（SSE）+
`fs.watch(indexes/)` + 行程內 `change-bus.ts`（自己的寫入 ~1ms 廣播）。SSE
斷線退回輪詢、重連時補一次全部同步中的 query。

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
  upload-routes.ts POST /indexes/:name/upload（單檔）＋ /upload-batch（整個
               資料夾，保留子結構、一次寫入）——遠端使用者上傳自己的檔案，
               落地到 `.uploads/` 再附加一列（不受 isRemoteShare 限制，見
               「區網＋公網共用模式」的「遠端使用者想貢獻自己的檔案怎麼辦」）
  share.ts     區網／公網共用模式——密碼牆 hook、危險端點封鎖、登入限速、
               openAccess／AI 開關兩個 host 可即時切換的 runtime toggle
               （只有 SHARE_MODE=lan 用；搬自 notes-web/server/share.ts，見
               「區網＋公網共用模式」列出的差異）
  events.ts    即時同步——SSE /api/events + fs.watch(indexDir)；同一條連線的
               生命週期也拿來記連線／斷線（見 connections.ts）
  change-bus.ts 行程內事件匯流排——store 寫完就 emitChange，events.ts 訂閱
  identity.ts  這次請求算誰做的——先看 identity_session cookie，沒有才退回
               x-index-author 標頭；也提供 identityKey()
  people.ts    簡易身分：名字＋PIN 註冊／驗證、簽章身分 cookie、角色
               （editor/viewer，files-web 特有）
  activity.ts  活動記錄（純記憶體）——誰新增/改/刪/連線/斷線了什麼
  presence.ts  在場提示（純記憶體，支援同一份多人）——誰正在看哪份索引集
  entry-presence.ts 在場提示（純記憶體，支援同一列多人）——誰正在編輯哪一列
               （EntryRow 的 inline 編輯表單），跟 presence.ts 不同粒度
  connections.ts 連線／斷線追蹤（純記憶體，參照計數＋5秒斷線寬限）
  visits.ts    訪客紀錄（持久化，`.share/visits.json`）——誰、什麼時候連上
  activity-routes.ts GET /activity、GET+POST /presence
  host-routes.ts GET /host/state、POST /host/open-access、POST /host/ai、
               POST /host/people/:name/role、DELETE /host/people/:name、
               GET /host/visits（一律只認 loopback）
  sweep.ts     共用的「定期清掉過期 Map 項目」小工具（登入限速／寫入限速用）
  atomic-write.ts 原子寫入（暫存檔 + rename），people.ts／visits.ts 共用
src/
  lib/       api · ai（aiApi）· ollamaUrl（Ollama 位址正規化，跟便利貼牆同一份）·
             format（類型分組／大小／時間）· lastIndex／lastDir（localStorage）·
             scrimClose（點背景關閉，拖曳選字滑出邊界不誤關）·
             identity（你的名字：localStorage 讀寫＋ x-index-author 標頭編碼）·
             liveSync（SSE 連線狀態的小型外部 store）·
             activityLabels（活動記錄的動作 → 顯示文字／圖示）·
             extCategories（副檔名 → 分類，跟 server 的 EXT_CATEGORIES 同一份，
             上傳資料夾的類型篩選在前端就地分類用）·
             qr（qrcode-generator → SVG，公網分享 QR）
  hooks/     useIndexes（清單＋單份＋useImportIndex／useCreateIndex／useDeleteIndex／useEditIndex／
             useBrowse／useAddEntry／useUpdateEntry／useDeleteEntry／
             useScan／useBulkAdd／useBlankSuggestions／useBulkDescribe／useBulkDelete）·
             useAi（useAiTarget／useAiSettings／useSaveAiSettings／useTestConnection／useOllamaModels）· useExists ·
             useShareInfo（mode / ai / loopback / publicUrl）·
             useLiveSync / <LiveSync>（SSE → 收到就 invalidate；重連補課）·
             useActivity（活動列表／在場心跳）
  components/ App · Toolbar · Preamble · DocView · EntryList · EntryRow（含「編輯」「從索引移除」）·
             FilePreview · FileBrowser（選檔／選資料夾，mode='file'|'dir'）· AiSettingsDialog ·
             AddEntryDialog · UploadEntryDialog（上傳檔案，遠端友善版的加入索引）·
             UploadFolderDialog（上傳資料夾，遠端友善版的匯入資料夾）·
             BatchImportDialog · BatchDescribeDialog（含 AI 模式）·
             BatchCategoryDialog（批次分類：補空白／舊→新）· BatchDeleteDialog ·
             ImportIndexDialog · CreateIndexDialog · DeleteIndexDialog（索引集層級）· ThemeToggle ·
             AppGate（掛在最外層，決定要不要畫密碼牆）· PasswordGate（名字＋PIN／共用密碼輸入）·
             ShareLinkButton（公網「分享」鈕＋QR）· ActivityDialog（工具列「動態」完整列表）·
             ActivityTicker（誰在看／最近動態）· HostPanel（固定網址 `/host`，只認 loopback）
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
