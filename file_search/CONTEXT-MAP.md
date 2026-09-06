# Context Map · file_search

`file_search` 從一支 Tkinter 桌面工具長出了三個共用資料的前端。這份地圖說明它們
各自負責什麼、怎麼相依。

## Contexts

- **file_search_app**（`file_search_app/`，Python/Tkinter）— 原本的桌面工具：檔案
  索引搜尋 + 便利貼。所有資料的權威寫入端。
- **[便利貼牆 sticky-wall-web](./sticky-wall-web/README.md)** — 便利貼的網頁版
  （Vite + React + Fastify）。直接讀寫 `indexes/.sticky_notes.json`，跟桌面版共用。
- **[索引牆 index-wall-web](./index-wall-web/CONTEXT.md)** — 檔案索引的網頁檢視器。
  一次看一份 `indexes/*.md`；可維護項目（加入／移除／批次匯入／批次補說明／
  批次刪除，只動 `.md` 表格列、不碰實體檔案）。AI 批次說明、編輯既有列的分類、
  索引集（`.md` 檔）增刪仍是桌面版的事。
- **[桌面牆 desktop-wall](./desktop-wall/CONTEXT.md)** — Electron 殼，把上面兩個
  網頁牆之一貼成桌面背景（透明、可穿透）。

## Relationships

- **file_search_app ↔ sticky-wall-web**：共用 `indexes/.sticky_notes.json`（原子
  寫入、只認 5 個欄位、保留 `panel` 鍵）。「編輯視同重新建立」——兩邊 `update` 都
  把 `created_at` 設成現在。
- **file_search_app → index-wall-web**：不共用程式碼——index-wall-web 把
  `IndexRepository` 的表格解析（`_ROW_RE`）＋寫入（`append_row(s)` /
  `remove_rows_by_occurrences` / `update_row_by_occurrence` / `_sanitize_cell` /
  `_format_path_code` / `atomic_io`）＋掃描（`scan_service`）＋內容擷取建議
  （`description_service.build_suggestion`）各自移植成一份 TS。格式若變，兩邊都要改。
  項目層級的增／刪／改（單列編輯分類說明＝桌面版「✏️ 編輯所選列」）都做，
  改路徑／前言 prose／索引集本身仍只在桌面版。
- **sticky-wall-web → file_search_app**（AI 搜尋）：`server/ai_bridge.py` 子行程
  呼叫 file_search_app 既有的 `StickyNoteService` / `AIDescriptionService`，AI 設定
  與用量計數也共用。
- **index-wall-web → file_search_app**（AI 批次補說明）：同款 `server/ai_bridge.py`
  子行程，呼叫 `AIDescriptionService._generate_one` / `PreviewService` 逐檔產生說明，
  外加 `test` / `models` / `target` / settings。AI 邏輯不重寫；`.ai_settings.json` /
  `ai_secrets.json` / `.ai_usage.json` 三邊共用。只有 Ollama 位址正規化
  （`src/lib/ollamaUrl.ts`）是跟 sticky-wall-web 一致的第三份 TS 複製。
- **desktop-wall → sticky-wall-web / index-wall-web**：spawn 它們的 `server/`
  子行程（固定埠 8787 / 8788），視窗載入其 `dist` 加 `?surface=desktop`。不複製
  前端；兩個 web 專案只多了一段 `[data-surface=desktop]` 的 CSS。

## 詞彙差異（重要）

- 索引項目的分類欄：桌面版 / index-wall-web 叫「**分類**（category）」；便利貼叫
  「**標籤 / tag**」。是類似但不同的概念，各自的 context 不要混用。
- desktop-wall 的「**背景模式 / 互動模式**」＝滑鼠穿不穿透；「**牆面透明度**」
  數值語意是「不透明度」（0 = 只剩卡片）。
