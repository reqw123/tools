# Context Map · file_search

`file_search` 從一支 Tkinter 桌面工具長出了三個共用資料的前端。這份地圖說明它們
各自負責什麼、怎麼相依。

## Contexts

- **file_search_app**（`file_search_app/`，Python/Tkinter）— 原本的桌面工具：檔案
  索引搜尋 + 便利貼。所有資料的權威寫入端。
- **[便利貼牆 notes-web](./notes-web/README.md)** — 便利貼的網頁版
  （Vite + React + Fastify）。直接讀寫 `indexes/.sticky_notes.json`，跟桌面版共用。
- **[索引牆 files-web](./files-web/CONTEXT.md)** — 檔案索引的網頁檢視器。
  一次看一份 `indexes/*.md`；可維護項目（加入／移除／批次匯入／批次補說明／
  批次刪除，只動 `.md` 表格列、不碰實體檔案）。AI 批次說明、編輯既有列的分類。
  索引集層級：匯入（=建立，見 `docs/adr/0003`）／匯出／新增空白／刪除／
  用系統編輯器開這份 `.md`（後三者見 `docs/adr/0004`）——只差「重新命名」
  （桌面版也沒有）。**區網／公網共用模式**（2026-09 加）架構搬自 notes-web
  同一套（密碼牆、SSE 同步、身分＋PIN、`/host` 後台），**各自一份程式碼、
  各自一份資料**——細節與差異（沒有看板、根路徑不停用、多了唯讀 `viewer`
  身分）見 `files-web/README.md`「區網＋公網共用模式」一節、`CLAUDE.md` 的
  「Index wall (索引牆 files-web)」表。**沒有自己獨立的共用啟動器**——原本
  的 `啟動-共用索引牆（區網）.bat`／`啟動-索引牆（區網＋公網）.bat` 已移除
  （使用者確認不需要「單獨啟動索引牆」這條路），這套機制現在只透過下面的
  「多人牆閘道 share-gateway」啟動。
- **[桌面牆 wallpaper-app](./wallpaper-app/CONTEXT.md)** — Electron 殼，把上面兩個
  網頁牆之一貼成桌面背景（透明、可穿透）。
- **[多人牆閘道 share-gateway](./share-gateway/index.mjs)**（2026-09 加）——
  新增一種共用啟動方式（`啟動-多人牆（區網＋公網）.bat`），讓 notes-web／
  files-web 兩面共用牆**共用一份登入、一個對外網址**，工具列一顆「切換到
  XX」鈕互相跳轉。純 `node:http` 反向代理，靠 `active_wall` cookie 決定
  轉給哪個後端；兩邊後端完全不用改路徑邏輯，只多一個
  `x-gateway-loopback` 信任標頭讓 `isLoopback()` 認得閘道轉發的請求（見
  `notes-web/server/share.ts`／`files-web/server/share.ts`）。跟既有兩支
  獨立共用啟動器**完全平行、不互相影響**——是額外新增的啟動方式，不是取代。

## Port 對照表

同一份 `notes-web`／`files-web` 程式碼，依你怎麼啟動它，會綁在不同 port——
搞混最常見的症狀是「明明有開，網址就是連不上」。

| 啟動方式 | notes-web（便利貼牆） | files-web（索引牆） | 你實際該連的網址 |
|---|---|---|---|
| `wallpaper-app`（桌面透明板，個人用） | 8787 | 8788 | wallpaper-app 自己開視窗，不用手動連 |
| `notes-web`／`files-web` 各自 `npm run dev` | 8787（前端 5273） | 8788（前端 5274） | `http://localhost:5273`／`5274`（Vite dev） |
| 獨立共用牆——`啟動-共用便利貼牆（區網）.bat`／`啟動-便利貼牆（區網＋公網）.bat` | **8790**（對外） | — | `http://localhost:8790/wall` |
| **多人牆**——`啟動-多人牆（區網＋公網）.bat`（見上面「多人牆閘道 share-gateway」） | 8792（**內部**，只綁 loopback，閘道專用） | 8793（**內部**，只綁 loopback，閘道專用） | **`http://localhost:8794/wall`**（閘道，唯一對外的那個）；`/host` 後台也是連這個 port：`http://localhost:8794/host` |

**多人牆模式下 8792／8793 不是給你連的**——那是這兩支後端改綁 127.0.0.1
給閘道專用的內部 port（見 `share-gateway/index.mjs`），直接連（例如
`http://localhost:8792/wall`）雖然技術上也連得到（它本來就是 loopback），
但看到的只是「便利貼牆」單獨一面、沒有切換鈕、也不會跟 8794 共用登入
session；閘道會把你導到目前 `active_wall` cookie 指定的那一面，兩支後端
都認得閘道發的信任標頭，所以 `8794` 才是「兩面牆共用一份登入」這個功能
真正生效的入口。

兩種共用啟動方式（獨立便利貼牆 8790、多人牆閘道 8794）可以同時開著，port
完全不衝突。索引牆已經沒有自己獨立的共用啟動器，只能透過多人牆閘道啟動
（見上一段）。

## Relationships

- **file_search_app ↔ notes-web**：共用 `indexes/.sticky_notes.json`（原子
  寫入、只認 5 個欄位、保留 `panel` 鍵）。「編輯視同重新建立」——兩邊 `update` 都
  把 `created_at` 設成現在。
- **file_search_app → files-web**：不共用程式碼——files-web 把
  `IndexRepository` 的表格解析（`_ROW_RE`）＋寫入（`append_row(s)` /
  `remove_rows_by_occurrences` / `update_row_by_occurrence` / `_sanitize_cell` /
  `_format_path_code` / `atomic_io`）＋掃描（`scan_service`；類型分類清單改跟
  **便利貼牆**的一致，不是桌面版那份）＋內容擷取建議
  （`description_service.build_suggestion`）各自移植成一份 TS。格式若變，兩邊都要改。
  項目層級的增／刪／改（單列編輯分類說明＝桌面版「✏️ 編輯所選列」）都做，
  索引集層級的匯入（建立）／匯出／新增空白／刪除／「開系統編輯器改這份 .md」
  也都做了（見 `files-web/docs/adr/0003`、`0004`）。改路徑、在網頁 UI 裡直接
  編輯前言 prose、重新命名索引集仍不做（重新命名桌面版也沒有）。
- **notes-web → file_search_app**（AI 搜尋）：`server/ai_bridge.py` 子行程
  呼叫 file_search_app 既有的 `StickyNoteService` / `AIDescriptionService`，AI 設定
  與用量計數也共用。
- **files-web → file_search_app**（AI 批次補說明）：同款 `server/ai_bridge.py`
  子行程，呼叫 `AIDescriptionService._generate_one` / `PreviewService` 逐檔產生說明，
  外加 `test` / `models` / `target` / settings。AI 邏輯不重寫；`.ai_settings.json` /
  `ai_secrets.json` / `.ai_usage.json` 三邊共用。只有 Ollama 位址正規化
  （`src/lib/ollamaUrl.ts`）是跟 notes-web 一致的第三份 TS 複製。
- **wallpaper-app → notes-web / files-web**：spawn 它們的 `server/`
  子行程（固定埠 8787 / 8788），視窗載入其 `dist` 加 `?surface=desktop`。不複製
  前端；兩個 web 專案只多了一段 `[data-surface=desktop]` 的 CSS。

## 詞彙差異（重要）

- 索引項目的分類欄：桌面版 / files-web 叫「**分類**（category）」；便利貼叫
  「**標籤 / tag**」。是類似但不同的概念，各自的 context 不要混用。
- wallpaper-app 的「**背景模式 / 互動模式**」＝滑鼠穿不穿透；「**牆面透明度**」
  數值語意是「不透明度」（0 = 只剩卡片）。
