# 放寬唯讀範圍：允許「項目層級」的增刪與批次

`0001` 把「唯讀、不做編輯」定為明確範圍。使用者後來要求在網頁版直接維護索引
項目（不想每次都開桌面版）。這份 ADR 放寬那個範圍，放到**索引項目層級**：

- **加入**：從本機挑一個檔案 → 填分類／說明 → 附加一列到目前這份 `.md`。
- **移除**：把某一列從 `.md` 拿掉。
- **編輯**：展開一列 →「編輯」→ 原地改**分類／說明**（路徑、在表格裡的位置
  都不動），確認後只重寫那一列。對應桌面版「✏️ 編輯所選列」（`_on_edit_selected`
  → `IndexService.update_entry`）。透過既有的 `PATCH /indexes/:name/entries`
  （原本只給「批次補說明」用、只吃 `description`，現在也吃 `category`）。
- **批次匯入資料夾**：掃描一整個資料夾（可含子資料夾、依類型篩選）→ 整批共用
  一個分類、說明留空 → 一次寫入。對應桌面版「匯入資料夾…」。
- **批次補說明**：對「說明是空的、檔案還在」的項目，用內容擷取（純文字／
  markdown 取前 1200 字）產生建議 → 逐筆看過／改／取消勾選 → 一次寫入。
  也能對勾選的項目**改用 AI 產生建議**：逐檔透過 `server/ai_bridge.py`
  子行程呼叫桌面版既有的 `AIDescriptionService._generate_one`，送目前設定的
  Provider（OpenAI／本機或區網 Ollama）。送出前有確認視窗（去向、模型、
  位址、累計呼叫次數、雲端計費警告）。AI 回來的建議一樣回到清單逐筆看過，
  「套用」時才寫進 `.md`。
- **AI 設定**：工具列「AI 設定」→ Provider 二選一、Ollama 本機／區網雙選、
  可自填 IP、測試連線、讀取已安裝模型清單。設定檔（`.ai_settings.json` /
  `ai_secrets.json` / `.ai_usage.json`）跟桌面版與便利貼牆網頁共用同一份。
- **批次刪除**：搜尋＋勾選多筆 → 一次移除。

上述所有「移除」都**只動 `.md` 表格列，絕不碰硬碟上的實體檔案**（對應桌面版
`_on_delete_selected` / `delete_entries` 的鐵則）。

**不做**的部分（維持 `0001` 的範圍決定，那些仍是桌面版的職責）：
索引集本身的建立／刪除（`.md` 檔）、改**路徑**（要換路徑＝移除再重加）、
前言（preamble）prose 的編輯、
全文快取、重複偵測、清除失效項目（「批次刪除」的「只看路徑遺失」已能涵蓋）、
音訊／影片轉錄（`ai_bridge.py` 的 transcription 傳 `None`，那類檔案會走
「沒有可摘要的內容」而略過）。

## 後果

- `_ROW_RE` 的兩份實作問題（`0001` 已記）現在**擴大**：桌面版寫入路徑
  （`_sanitize_cell` / `_format_path_code` / `append_row` / `append_rows` /
  `remove_rows_by_occurrences` / `update_row_by_occurrence` / `atomic_write_text`）
  ＋掃描（`scan_service.py`）＋內容擷取建議（`description_service.py` 的
  `build_suggestion`）都多了一份 TS 移植，在 `server/store.ts`。索引表格格式
  若變動，桌面版 + 這裡都要改。`CONTEXT.md` 的「索引項目」定義仍是單一事實來源。
- 後端多了 `/browse`（選檔視窗）、`/scan`（資料夾掃描）、
  `/indexes/:name/entries` 的 `POST`/`PATCH`/`DELETE` 與 `.../bulk`、
  `.../bulk-delete`、`.../blank-suggestions`。這個 server 本來就能對全硬碟
  `stat` / `open` / 串流任意路徑（`0001` 就靠只綁 `127.0.0.1` 把關），列目錄／
  遞迴掃描不是新的安全邊界。
- 桌面拿不到作業系統原生選檔視窗（瀏覽器限制），所以選檔／選資料夾改成
  後端逐層列目錄、前端自繪的 `FileBrowser`（`mode='file' | 'dir'`）。
  「加入索引」是單檔、可重複；整批走「匯入資料夾」。
- 所有「移除」「更新」（含單列編輯）都用 1-based 原始列序（`serial`）定位，
  並帶上該列預期路徑（`?expect=` / body 裡的 `path`）：載入後 `.md` 被外部
  改動、序號對到別列時整批擋下，比桌面版多一層保護。批次操作一次讀、一次寫
  （所有 occurrence 都對原始檔案編號，不受彼此影響）。單列編輯就是「一批只有
  一筆」的 `PATCH`，`updateRowsByOccurrences` 對省略的欄位（`category` 或
  `description`）沿用原值，所以「批次補說明」不帶 `category` 也不會清掉分類。
- 「批次補說明」的內容擷取只涵蓋純文字／markdown（沿用既有的 `previewFile`）；
  桌面版還能靠 COM / python 套件讀 docx / pdf / xlsx，這裡讀不到的就回空字串
  讓使用者自己填（對應桌面版對圖片的處理）。
- **AI 模式讓這個 server 多一個 Python 執行期依賴**（`0001` 原本標榜「不需要
  Python」）：`server/ai.ts` 用 `process.env.PYTHON ?? 'python'` 開子行程，
  沒有 Python／`file_search_app` 時只有 AI 那幾個端點回 502，其餘（含非 AI 的
  批次補說明）照常。跟便利貼牆網頁 (`sticky-wall-web`) 同款橋接。AI 邏輯本身
  （Provider 連線、記帳、Ollama URL 正規化、模型能力檢查）**不移植**，一律走
  子行程呼叫桌面版的 `AIDescriptionService`；只有 Ollama 位址的分段輸入 UI
  正規化（`src/lib/ollamaUrl.ts`）是第三份 TS 複製，跟便利貼牆那份一致。
