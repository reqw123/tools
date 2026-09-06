# 設計模式清單 · file_search_app

給接手的人（人或 agent）看的「這個 codebase 反覆用了哪些做法、各自叫什麼、
為什麼」。跟 `CONTEXT-MAP.md`（跨專案關係）互補——這份只講桌面版
`file_search_app/` 內部的模式。錨點以「檔案 + 函式名」為準，行號會漂。

標 ⟳ 的模式在近期的重構中被強化或補齊，改動時特別容易破壞。

---

## 一、架構與組裝

### 三層嚴格分工（Repository / Service / UI）
- **Repository**：只做 IO（讀寫檔、算雜湊），不認識別的層，也不認識 Tkinter。
- **Service**：商業邏輯。可在背景執行緒安全呼叫，**不碰任何 Tkinter 物件**；
  `progress_cb` 只收數字／字串。
- **UI**：組畫面、綁事件、管理選取狀態、呼叫 Service、開 Dialog。不解析／寫
  Markdown、不算 SHA-256、不掃描資料夾、不擷取文字。
- 出處：全專案。`ui/main_window.py` 開頭 docstring 明列「不做什麼」。

### 組裝根（Composition Root / 手動 DI）
`app.py::build_app()` 一次 new 出所有 repo / service，用 keyword-only 參數注入
`MainWindow`。沒有 DI 框架，也不要加。

### 延後建構的例外
`MediaController` 需要 Tk root 的 `after` / `after_cancel` 才能排程，這兩個原語
要 Tk 實例存在後才有——所以 `app.py` 只把**類別**傳進去，`MainWindow.__init__`
裡才 `media_controller_cls(self.after, self.after_cancel)`。

### 能力向下、知識不向上
下層不知道上層存在。例：`CacheRepository` 只算 SHA-256 與讀寫快取檔，「何時
重算、擷取文字要呼叫哪個函式」是 `CacheService` 的事。`cache_repository.py`
docstring 明講。

---

## 二、持久化

### 原子寫檔
`repositories/atomic_io.py::atomic_write_text()` — 寫同層資料夾的暫存檔 →
`os.replace()` 原子換掉目標。最底層寫入原語，暫存檔刻意同層，避免跨磁碟區
退化成「複製＋刪除」。

### JSON 讀寫樣板
`repositories/json_store.py::read_json(path, default)` / `write_json(path, obj)`
— 每個 `indexes/.xxx.json` 的 repo 都用這兩個，不各自重寫「不存在／損毀就
回預設」跟「mkdir ＋ 原子寫入 ＋ `ensure_ascii=False, indent=1`」。形狀驗證
（`isinstance`）留給呼叫端，因為每個檔案期望的結構不同。
- 用戶：`ai_usage` / `app_prefs` / `metadata`（`.added_times`）/ `cache` /
  `sticky_note` / `ai_settings`。

### 損毀即預設值（defensive load）
`read_json` 保證「拿到 parse 過的東西，或拿到預設值，永不拋例外」；每個 repo
的 `load` 拿到之後再 `isinstance` 驗證形狀、丟掉形狀不對的項目。理由：便利貼
／偏好／快取是輔助功能，資料壞掉不該讓主視窗開不起來。
- 例：`sticky_note_repository._read_raw`、`cache_repository.load`、
  `app_prefs_repository._section`（手動改壞的 key 對到非 dict 時不炸在
  `MainWindow.__init__`）、`metadata_repository.load_added_times`。

### 點檔名全域設定
不綁定任何一份索引集的狀態，一律存 `indexes/.xxx.json`：
`.ai_settings.json` / `.ai_usage.json` / `.sticky_notes.json` / `.added_times.json`
/ `.cache/<索引檔名>.json`。API Key 這種機密例外——搬到本機快取目錄的
`ai_secrets.json`。

### 讀→改→寫封裝（mutate closure） ⟳
`sticky_note_repository.py::StickyNoteRepository.mutate(fn)` — 讀「磁碟上最新的」
清單 → 交給 `fn` 改 → 寫回，全在同一個同步呼叫內。`fn(notes)` 回新清單就寫、
回 `None` 代表「看過了沒要改」（例如編輯的 id 不存在）就跳過寫檔。
取代舊的「load 一份 → 對話框往返、使用者打字 → 整包寫回」（那個中間的空窗
會讓第二個視窗／另一個行程的變更被蓋掉）。所有便利貼增刪改都走這條。

### 序號定位而非路徑定位
同一路徑可能在一份索引裡重複出現，所以精確編輯／刪除靠
`IndexEntry.row_index`（只計可解析資料列的 0-based 序號），不靠路徑比對。
- 出處：`index_repository.update_row_by_occurrence` /
  `remove_rows_by_occurrences`。⟳ 近期刪掉了會「連帶改到所有同路徑列」的舊
  `update_row_by_path` / `remove_rows_by_paths`。

### 批次＝一讀一寫（避免 O(n²)） ⟳
資料夾匯入一次上千筆時，逐列 read+write 成長中的 `.md` 是 O(n²)，明顯拖慢。
批次入口整份檔案只讀一次、只寫一次：
- `index_repository.append_rows`（單列的 `append_row` 現在委派給它）
- `metadata_repository.record_added_times`
- `index_service.add_entries`（`import_service.import_folder` 走這條）

### 路徑正規化單一入口 ⟳
`services/import_service.py::path_key(path)` = `os.path.normcase(os.path.abspath(...))`。
所有「這個路徑收錄過了沒」的判斷都必須走這個 key——先前拖曳／匯入資料夾／
找出未收錄各自用 `str(Path)`、`p.resolve()`、或完全不正規化，Windows 上大小寫
／斜線不同的同一個檔案會判錯。刻意用 `abspath` 不用 `resolve()`（後者每個檔
都要 stat 解 symlink，索引一大就慢）。
- 呼叫端：`scan_service.find_unindexed`、`main_window`（匯入資料夾 / 找出未收錄）、
  `import_dialogs`、`scan_dialogs`。

---

## 三、併發

### Worker → Queue → after() 輪詢
`ui/async_task.py::start_worker(work, q)` ＋ `poll_queue(widget, q, on_message)`
— UI 非同步的標準骨架。`work()` 把 `("progress"|"done"|"error", …)` 塞進 queue；
`on_message(msg)` 回傳 True＝收工。`poll_queue` 自己啟動迴圈、每 tick 排空佇列、
widget 銷毀就停。
- 用戶：`main_window`（轉錄、AI 批次說明）、`sticky_note_panel`（AI 搜尋）、
  `sticky_note_dialog`（用檔案生成）。
- 還沒收編（形狀不同、跟 transient 進度視窗或 `seq` 作廢綁在一起）：
  `main_window` 的「更新快取」「批次補說明」「選檔案問 AI」、`preview_panel`
  非同步擷取、`ai_settings_dialog` 的模型清單／測試連線。

### 佇列兜底
`start_worker` 的外層 `except Exception` → `("error", exc)` 是安全網——worker 少
接一種例外也不會讓 `poll_queue` 每 100ms 空轉、送出鈕永遠停用。手抄版曾因此
出過兩種 bug：漏寫啟動輪詢那行、漏接非 `AIProviderError` 例外。

### 序號作廢（generation token） ⟳
`ui/widgets/preview_panel.py::PreviewPanel._extract_seq` — 每次 `show_entry()` +1。
背景擷取文字的結果回來時比對序號，選取已經換過就直接丟掉，不會把 A 檔內容
貼到現在選的 B 檔上。搭配 `after(120, ...)` 延遲：用方向鍵連續掃過好幾個
`.doc`（走 COM 子行程）時不會同時冒出好幾個 `WINWORD.EXE`。

### 合作式取消（threading.Event）
`cancel_event` 傳進 worker 當 `cancel_check`；使用者關視窗 / 按取消時 `set()`。
背景端每處理完一筆檢查一次、提前收工。已送出的那幾筆仍會計費，但不再往下燒。
- 出處：`ai_description_dialog.destroy()` → `_on_ai_regenerate_batch`；轉錄。

### 行程內單鎖
`repositories/ai_usage_repository.py::AIUsageRepository._lock` — AI 批次說明在背景
執行緒逐筆記帳、便利貼 AI 搜尋在它自己的執行緒記帳，共用一顆計數器。讀→+1→
寫用一把 `threading.Lock` 就夠（跨行程幾乎不會同時呼叫 AI，而且這本來就是
「僅供參考」的估算）。不上檔案鎖。

### 子行程隔離（crash-prone native code）
Python 的 try/except 攔不住 native segfault，也管不好會卡死的 COM。丟獨立子
行程，崩了只死子行程，主 App 偵測到非正常結束、回傳成一般錯誤訊息。
- `services/_transcription_worker.py` — faster-whisper 底層 ctranslate2 在部分機器
  載入模型直接 segfault。
- `services/_legacy_office_worker.py` — `.doc/.ppt/.xls` 走 Office COM 自動化，
  偶爾卡在沒人會點的彈窗，逾時 30 秒強制放棄。

---

## 四、AI 子系統

### Provider 介面 ＋ 例外漏斗
`ai/base.py::AIProvider` — OpenAI / Ollama 實作同一個介面。所有 urllib / json
失敗（連線、逾時、HTTP 錯誤、回應不是合法 JSON）統一包成 `AIProviderError`，
呼叫端只接這一種。`post_json` / `get_json` 是共用的 HTTP 小工具；
`unexpected_response_error(data)` 是「回應缺欄位／型別不對」的統一錯誤（兩個
provider 共用，訊息截 300 字元）。Ollama 的 `/api/tags` 解析共用
`parse_model_names(tags)`。

### 零 SDK
不裝 `openai` / `ollama`，只用 stdlib `urllib.request`。跟整個工具「不依賴外部
套件、能撐則撐」一致，使用者不用 `pip install` 才能用 AI 功能。`ai/__init__.py`
docstring 明講。

### JSON 契約 ＋ 三層降級解析
prompt 強制模型回一個 JSON 物件（不是純文字 `答案:.../編號:...`——那個格式
會隨機漏 `編號` 標籤，被使用者回報過）。解析 `parse_ai_search_response`：
1. 整段當 JSON parse
2. regex 抓第一個 `{...}` span 再 parse（吃掉 ```json 圍欄、多話的前後綴）
3. 退回舊版 `答案:/編號:` 標籤 regex

**改 prompt 的輸出契約就要三層一起改**，否則降級鏈會靜默失效。
- 出處：`sticky_note_service.build_ai_search_prompt` / `parse_ai_search_response`
  / `_try_parse_json`。
- 例外：`parse_document_to_note_response`（⟳ 這次新增）**只有兩層**——JSON
  契約是新設計的，沒有純文字歷史包袱，解析不出來就當這筆失敗。

### 可插拔 prompt_builder ⟳
`ai_description_service.generate_suggestions(..., prompt_builder=, image_prompt_builder=)`
——內容怎麼變成送給 AI 的東西（文字擷取／圖片縮圖／音訊轉錄／逐筆呼叫／
計次／錯誤處理）完全一樣，只有 prompt 契約換掉。便利貼「🤖 用檔案生成」用
`StickyNoteService.build_document_to_note_prompt`（回 title/tag/body JSON），
簽章刻意對齊 `AIDescriptionService.build_prompt(entry, text)` 才能原樣傳進去。

### 警語回傳而非只拋例外
`AIProvider.test_connection() -> str | None`：連不上才 raise；「連得上、但選的
模型沒下載 / 是純文字模型」回一段警語字串，呼叫端照樣顯示、不用綠字「成功」
蓋掉。OpenAI 版仍只回 `None`。

### 「離開本機」照字面
`current_target_summary()` 的 `leaves_machine` = 位元組真的離開這台電腦——區網
Ollama 也是 `True`。它**不是**「是不是雲端 OpenAI」的代名詞。要那個區分必須
另外查 `provider == "openai"`（`ai_analyze_dialog` 依賴 `leaves_machine` 的原義）。

### 呼叫前用量確認
`ui/dialogs/ai_confirm_dialog.py::ask_ai_confirm()` — 每個 provider、每次 AI 呼叫
前都跳。字元數估算明說「非精確 token 數」（不整合真 tokenizer——每個 provider
／模型不同，精確值也還是估算），累計呼叫次數，所有文案留退路（「僅供參考」
「以 Provider 帳單為準」）。不計算真實金額。

---

## 五、UI

### 自刻對話框取代 messagebox
Windows 上 `tkinter.messagebox` 是系統原生 MessageBox，吃不到 Tk 的 font 設定
（沒法比照其他對話框放大字），也不能捲動／選取。自刻 `tk.Toplevel`，但保留
**同步阻塞、回傳值**的 API，呼叫端不用改寫成 callback。骨架共用
`styles.make_modal(parent, title, bg=, size=, minsize=)` ＋
`styles.run_modal(dlg, parent)`（置中 ＋ `wait_window`）。
- `ask_ai_confirm()` 取代 `askyesno()`
- `show_scrollable_message()` 取代 `showinfo()`（便利貼「AI 回答」可能很長）

### 共用樣式工具
`ui/styles.py` — `styled_button` / `icon_for`（副檔名→emoji，全畫面一致）/
`lighten` / `darken`（往白／黑混合）/ `bind_wheel_recursive`（Tk 滾輪事件不冒泡）
/ `center_over_parent` / `make_modal` / `run_modal`。避免每個檔案各自重寫。

### 按鈕配色常數按語意命名
`config.py` 的 `BTN_*` 一律語意名（`BTN_CREATE` / `BTN_EDIT` / `BTN_AI` /
`BTN_IMPORT` / `BTN_REFRESH` / `BTN_DETECT` / `BTN_COPY` / `BTN_PRIMARY` /
`BTN_SECONDARY` / `BTN_WARN` / `BTN_DANGER`），不用色相名——換調色盤時名字
才不會說謊。目前的 hex 寫在該常數的註解裡。

### 搜尋去抖動 ⟳
搜尋框每個按鍵都重跑 `filter_entries`（掃全部 entries）＋整個清單砍掉重建，
索引一大就頓。打字走 `_schedule_*`（`after(150~180ms)` ＋ 取消重排），**其他
觸發點（分類／標籤下拉、增刪改之後）要即時，直接呼叫 `_refresh` / `_apply_filter`**。
關視窗時要 `after_cancel` 清掉待觸發的計時器。
- 出處：`main_window._schedule_apply_filter`、`sticky_note_panel._schedule_refresh`、
  `delete_dialogs`、`ai_description_dialog`。

### 懶建列 ＋ 上限提示
索引可到幾十萬筆，開對話框當下就把每列建成 widget 會卡好幾秒、吃大量記憶體。
- 勾選狀態存每列自己的 `BooleanVar`（很輕，全部先建好）。
- 列 widget 依「目前篩選結果」現建，重篩時整批 `destroy` 再重建。
- `max_visible` 上限，超過用一行提示帶過。
- **全域操作（`check_visible()` / `selected_items()`）走 `records`，不受畫面上限影響。**
- 「批次刪除」（`delete_dialogs`）與「AI 批次說明」（`ai_description_dialog`）
  的搜尋框＋去抖動篩選＋捲動清單＋懶建列＋全選 已抽成
  `ui/widgets/filtered_checklist.py::FilteredChecklist`；呼叫端只給
  `haystack_of(item)` 跟 `build_row(row, item, var)`，額外篩選維度（批次刪除的
  「只看路徑遺失」）用 `extra_match` 疊上去。
- `scan_dialogs` / `duplicate_dialog` 是較簡單的獨立變體，還沒收編。

### 物件當識別權威
`ui/widgets/index_tree.py::IndexTree._entries_by_iid` — iid → `IndexEntry` 的 dict，
拿選取列的資料一律透過 `selected_entry()`，不用 `values[4]` / `values[5]`（加欄位
就位移出錯）。批次刪除也記整個 `IndexEntry`（含 `row_index`），不記路徑。

### 顯示層不重新編號
`serial` 由 `IndexService` 載入整份清單時一次指定（每份索引集從 1 開始、全部
索引模式依合併順序）。`SearchService` / `IndexTree` 只決定要不要顯示，不重編。

### AI 結果＝暫時覆蓋態 ⟳
`sticky_note_panel` 的 `_ai_result_ids` / `_ai_query_snapshot` 是「暫時覆蓋一般
關鍵字搜尋」的狀態，不是永久模式。失效條件：搜尋框文字被改過 **或** 便利貼
被增刪改（⟳ 後者是這次補的 `_invalidate_ai_results()`——那批編號是對「送出
當下那份清單」算的，清單一動就對不上）。

---

## 六、貫穿全專案的原則

- **輔助功能不得拖垮主視窗** — 便利貼、偏好、快取檔壞掉一律靜默退預設值。
  多個 repo docstring 明講。
- **樂觀退化的可選相依** — `tkinterdnd2` / Pillow / faster-whisper / py7zr /
  pywin32 全是 `try: import ... except ImportError` ＋ 功能降級，不是硬相依。
- **註解記錄「為什麼」＋踩過的雷** — 見 `CLAUDE.md` 的 Gotchas 區：`hash()`
  per-process 隨機化不能拿來配色、emoji variation selector 破壞置中、`pack()`
  cavity order 決定誰被擠。同一個雷不要再踩第二次。
- **失敗訊息往上拋，UI 決定怎麼講** — `platform/file_actions.py` 不顯示
  messagebox，例外往上拋，由呼叫端決定字眼。
