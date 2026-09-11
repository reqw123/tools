# CLAUDE.md

Technical notes for `file_search_app` aimed at whoever (human or agent) next
touches this code — not end-user docs, those live in the in-app "❓ 功能介紹"
panel (`file_search_app/ui/widgets/help_bar.py`). Line numbers are as of
2026-08-24; if they've drifted, grep the function name — it's the durable
anchor, the line number is a shortcut on top of it.

For the recurring patterns this codebase uses (three-layer split, atomic
write, worker→queue→poll, JSON-contract + layered fallback parsing, lazy row
building, …) and their names, see `docs/PATTERNS.md`.

## Sticky notes (便利貼) — file map

| Concern | File |
|---|---|
| Data model | `file_search_app/models.py` — `StickyNote` |
| Storage (`.sticky_notes.json`) | `file_search_app/repositories/sticky_note_repository.py` |
| Business logic, AI prompt/parse | `file_search_app/services/sticky_note_service.py` |
| Panel UI | `file_search_app/ui/widgets/sticky_note_panel.py` |
| Add/edit dialog | `file_search_app/ui/dialogs/sticky_note_dialog.py` |
| Batch-delete dialog | `file_search_app/ui/dialogs/sticky_note_bulk_delete_dialog.py` |
| Shared AI calling layer | `file_search_app/services/ai_description_service.py` |
| AI usage counter storage | `file_search_app/repositories/ai_usage_repository.py` |
| Web 便利貼牆 區網／公網共用模式 | `notes-web/server/share.ts`（`SHARE_MODE=lan` 才 import；密碼牆 hook + 危險端點封鎖 + 登入限速 + `/api/session`；**帶 `x-forwarded-for` 的請求不吃 loopback 豁免**——ngrok 隧道靠這個仍過密碼牆）。主牆固定在 `WALL_PATH`＝`/wall`——**根路徑 `/` 故意什麼都不畫**（`src/main.tsx` 的 `knownRoute` 不認根路徑，連密碼牆都不顯示），分享網址／`.bat`/`wallpaper-app` 開的網址都已經帶 `/wall`。啟動器：純區網 `啟動-共用便利貼牆（區網）.bat`；區網＋ngrok 公網 `啟動-便利貼牆（區網＋公網）.bat` → `notes-web/scripts/share-serve.mjs`。**這兩個公用牆啟動器的資料／port 跟個人用的 wallpaper-app 完全分開**（2026-09 加，使用者明確要求「不能共享也不能互相覆蓋與干涉」）：預設 `STICKY_NOTES_FILE` 改指到 `notes-web/public-wall-data/.sticky_notes.json`（不存在就從空的開始，不會帶進 `indexes/` 底下的個人便利貼；`.notes_settings.json`／標籤色／身分／看板／圖片／版本快照全部跟著搬過去，見 `server/store.ts` 開頭註解），預設 port 從 8787 換成 **8790**（`scripts/share-serve.mjs` 的 `PORT_DEFAULT`；wallpaper-app 固定用 8787，見 `wallpaper-app/servers.js`，兩者才能同時開不搶 port）。**這兩個值算完一定要寫回 `process.env` 再 spawn 子行程**（`process.env.API_PORT = String(PORT)`）——子行程自己也讀這兩個環境變數，只算本地變數不寫回去，子行程會用它自己的預設值，兩邊對不起來（真的踩過這個坑，spawn 出來的 server 綁去 8787 撞真正在跑的公用牆）。`.gitignore` 排除 `/notes-web/public-wall-data/`。細節見 README「區網共用模式」開頭的警告段落。**前端要不要收斂遠端限定功能（研究生模式、AI 生成便利貼選資料夾）用 `App.tsx` 的 `isRemoteShare`（`= isShare && !share.loopback`），不是 `isShare`**——`share.loopback` 來自 `GET /api/share-info` 每次連線各自算的 `isLoopback(req)`，不是全域 `mode`。曾經修過的真實 bug：早期只用 `isShare` 判斷，開了共用模式後連 host 自己的 wallpaper-app（loopback）都被鎖住研究生牆，因為前端分不出本機/遠端；後端 `collectionForRequest`／`shareGuardHook` 從頭就有正確的 loopback 豁免，只有前端這層漏了。細節見 `notes-web/README.md` 的「主牆路徑（`/wall`）」「區網共用模式」／「公網共用模式（ngrok）」 |
| Web 便利貼牆 即時同步 | `notes-web/server/events.ts`（SSE `/api/events` + `fs.watch(indexes/)`）＋ `server/change-bus.ts`（store 寫完 `emitChange`，比 fs.watch 快）＋ `src/hooks/useLiveSync.ts`／`<LiveSync>`（收到就 invalidate；**重連補課**；掛在 `main.tsx` 最外層，主牆＋懸浮視窗都涵蓋）＋ `src/lib/liveSync.ts`（連線狀態）。牆面排序 `wall.noteSort` 在 `.notes_settings.json`（共用、會同步；`NoteSort` 型別在 `src/lib/api.ts`）。多人編輯：`NoteForm` 只送改過的欄位、`updateNote` 逐欄 merge；`NoteDialog` 有「別人剛改過／剛刪掉」提示（`NotFoundError` 在 `api.ts`）。細節見 README 的「即時同步（SSE）」「同時開兩邊 / 多人編輯」 |
| Web 便利貼牆 看板（`/card`） | `server/card.ts`（`GET`/`POST /api/card { noteId }`——**持久存檔** `indexes/.sticky_wall_card.json`，跟 activity/presence 的純記憶體不同）＋ `src/components/CardScreen.tsx`（固定網址、深色背景置中放大展示，`transform: scale()` 整塊放大不逐一改字級）。`main.tsx` 用 `location.pathname==='/card'` 分流（不是 query string）；prod 的 SPA fallback 本來就吐 `index.html` 給任何非 `/api/` 路徑，直接訪問不用另開路由。換內容在 `NoteDialog.tsx` 的「📺 設為看板」，SSE `card` topic 推播給所有開著的畫面。細節見 README「看板」 |
| Web 便利貼牆 後台（`/host`） | `server/host-routes.ts`（`GET /api/host/state`、`POST /api/host/open-access`、`POST /api/host/ai`、`DELETE /api/host/people/:name`——**一律只認 loopback**，自己在 `onRequest` 檢查 `isLoopback()`，不管全域 `shareAuthHook`／`openAccess` 怎麼判，遠端知道共用密碼也進不去）＋ `src/components/HostPanel.tsx`（掛載時把 `document.title` 改成「便利貼牆-開發者設定」，離開還原）。管五件事：`share.ts` 的 `openAccess`（純記憶體、**2026-09 改成預設開**、**重開 server 就重置回開**——想維持要密碼自己到 `/host` 關掉）——**2026-09 改**：開著時只免共用密碼，`shareAuthHook`／`GET /session`／`POST /session` 仍要求有效 `identity_session`（名字＋PIN，跟一般模式同一套 `claimOrVerify()`，差別是名字這裡**不能留空匿名**），不再是整關直接放行；`PasswordGate.tsx` 用 `share.openAccess` 切換成只顯示名字／PIN 欄位（不顯示共用密碼欄）且兩者都必填。目的是避免「先不要密碼」被誤解成連身分驗證、防冒充都一起省掉；`share.ts` 的 `isShareAiEnabled()`/`setShareAiEnabled()`（AI 搜尋／生成／語意一起開關，**重開 server 不重置**、回到 `SHARE_AI` 環境變數預設值，切換即時 `emitChange('settings')` 推播，關掉時 `Toolbar.tsx` 顯示灰色「AI 已停用」而不是單純藏按鈕，面板本身重用 `GET /api/ai/target` 唯讀顯示目前實際 provider）；**AI provider 切換**（OpenAI／Ollama 單選鈕，直接重用既有的 `PUT /api/ai/settings`＋`hooks/useAi.ts`，不是另開 host 專用端點——只送 `provider` 欄位，`model`／`base_url`／`api_key` 照抄現有設定，靠 `ai_bridge.py` 的 `cmd_settings_set()` 本來就有的「沒帶到的欄位沿用舊值」合併邏輯，不會動到 API Key。**這支端點會寫真正共用的 `indexes/.ai_settings.json`／API Key 快取，路徑寫死在 `AISettingsRepository`、不吃 `STICKY_NOTES_FILE` 之類的測試環境變數覆寫——測試這段邏輯只能讀（`GET /api/ai/settings`／`/ai/target`）不能真的按下去寫，不然會改到使用者正在用的真實 provider**）；`people.ts` 的 `listPeople()`/`releasePerson()`（忘記 PIN 的自助解法，不用再手動編輯 `.sticky_wall_people.json`）；**訪客紀錄**——`server/visits.ts`（持久化，跟 activity/presence 的純記憶體不同，`.sticky_wall_visits.json`，`people.ts`／`card.ts` 同一套原子寫入）記「誰、什麼時候連線」（`connections.ts` 判定「真的是新連線」那個分支順便呼叫 `recordVisit()`），`GET /api/host/visits` 給 `HostPanel.tsx` 的「訪客紀錄」文字視窗（5 秒輪詢）用，同一支也給 Node-RED 輪詢轉發 Discord（`C:\Users\homec\Downloads\多人牆flow.json` 的「多人牆訪客通知」分頁，打共用牆預設 port 8790，去重邏輯對齊既有「便利貼到期提醒」分頁的 `detectFreshlyDue()` 寫法）。細節見 README「後台管理」 |
| Web 便利貼牆 身分／活動／護欄 | 「你的名字」：`src/lib/identity.ts`（**`x-note-author` 標頭一定要 `encodeURIComponent`**——中文名字不編碼會讓瀏覽器 `fetch()` 直接丟 TypeError，這是踩過的坑）。**簡易認證**：`server/people.ts`（名字＋PIN，PIN 存 sha256、身分靠無狀態 HMAC 簽章 cookie `identity_session`，金鑰＝共用密碼）。**2026-09 收緊**（使用者要求「決定好名稱和 PIN 後不可以任意更換」）：`claimOrVerify()` 現在**名字非空一定要求 PIN**（以前沒填 PIN 也能用、純顯示不保護——這個口子關掉了），牆上完全沒有「改名字」「換 PIN」的功能，要換得請牆主在 `/host` 用 `releasePerson()` 解除保護。連帶補了一個冒用漏洞：`identity.ts` 的 `fromHeader()`（沒有簽章 cookie 時的退回路徑）現在先查 `isProtectedName()`，標頭填到已保護的名字直接當匿名——不然「名字要設 PIN」這條規則可以被沒登入、單純改標頭繞過。同一批收緊也擴到 `openAccess`（見上面「後台」列）：`shareAuthHook`／`POST /session` 現在開著開放模式時一樣要求名字＋PIN（不能留空匿名），只免共用密碼，不然「先不要密碼」的臨時方便會變成連身分都不用驗、放任冒充。`server/identity.ts` 的 `authorFrom()` 優先信簽章 cookie、蓋過前端標頭——已登入的人改不了 `x-note-author` 冒充別人。`share_session`／`identity_session` 都**沒有 maxAge**（session cookie，瀏覽器關掉才失效＝「每次連線都要密碼」）。活動記錄 `server/activity.ts`、在場提示 `server/presence.ts`——都純記憶體、不寫檔、server 重開歸零，只是提示性資訊；身分資料則持久存在 `indexes/.sticky_wall_people.json`。`presence.ts` 的 `noteId → 編輯者` **是集合不是單一值**——同一則支援多人同時顯示（具名用名字當 key，匿名退而求其次用來源 IP，見 `clientIp`，已從 `share.ts` export 出來給它用）。**連線／斷線** `server/connections.ts`——借 `GET /api/events`（SSE）本身的連線生命週期當訊號，用 `identity.ts` 的 `identityKey()` 參照計數（同一人開好幾個分頁只算一次連線，全部關掉才算斷線），斷線有 5 秒寬限（吃掉換頁那種瞬斷瞬連），寫進同一份 `activity.ts`（`action: 'connect'|'disconnect'`）。工具列「📋 動態」＝ `ActivityDialog.tsx`；標題右側常駐面板＝ `ActivityTicker.tsx`（已認證的名字鎖住改不了，要換人得先登出；`connect`/`disconnect` 不接「「標題」」後綴，見 `NO_TARGET`）。遠端護欄（`server/share.ts`）：AI 每日額度（`SHARE_AI_DAILY_LIMIT`，只限 `/ai/search`；AI 整組要先在 `/host` 開，見上面「後台」列）、寫入限速（120 次/分鐘/IP，`/api/session` 除外）、登入限速（密碼錯或 PIN 錯都算同一個計數）。細節見 README「登入 session」「簡易身分記憶與認證」「遠端護欄」 |
| Web 便利貼牆 生活／研究生資料分離＋資料夾整理 | **2026-09 加**（使用者要求，分兩階段）。**階段一**：插圖分開存放——生活牆 `noteImagesDir`（常數，跟桌面版共用，路徑不能動）vs 研究生 `thesisImagesDir()`（函式）；讀寫一律呼叫 `activeImagesDir()`（依 `activeCollection` 挑），`unlinkImage()`／`readImageDataUri()`／`writeImageDataUri()`／`commitNoteImage()`／`DELETE /notes/:id/image` 都改吃這個。縮圖快取（`note-thumb.ts`）的 `resolveThumb()`/`dropThumbs()` 要求呼叫端明確傳 `imagesDir`，不是自己猜。生活牆靜態路由不變（`@fastify/static` 綁死 root）；研究生圖片改走 `index.ts` 的一般路由 `GET /thesis-note-images/:filename`（每次請求當場算路徑，因為研究生資料夾可能變）。前端 `noteImageUrl()`/`noteThumbUrl()`（`src/lib/api.ts`）依 `getApiCollection()` 決定要打 `/note-images/` 還是 `/thesis-note-images/`（縮圖走 `/api/note-thumb/...&collection=thesis`）——**這兩支是給 `<img src>` 直接載入的，瀏覽器載圖不會帶 `x-note-collection` 標頭**，只能靠 URL 本身分辨；`exportHtml.ts` 的 `imageDataUri()` 也改吃 `noteImageUrl()` 組好的完整 URL。**修過一個真實安全漏洞**：新路由一開始沒把 `/thesis-note-images/` 加進 `share.ts` 的 `shareAuthHook` 密碼牆放行清單判斷式，遠端不用密碼就能直接撈研究生便利貼的圖——已補上 `!path.startsWith('/thesis-note-images/')`。**階段二**（使用者反映「研究生便利貼不要再跟著專案資料夾」＋整體資料太雜亂）：`thesisNotesFile()`／`thesisDataDir()` 改成固定回傳 `dirname(LIFE_FILE)/.thesis/notes.json`，**不再依賴 `thesisProjectDir` 設定決定存放位置**——`thesisProjectDir` 這個設定還在，但現在只給「從專案生成」（`ai-routes.ts`）讀論文文件用，跟資料存放位置無關。研究生的 `tag_colors.json`／`images/`／`notes_history/` 全部收進同一個 `.thesis/` 底下（`historyDir()` 因為是從 `activeNotesFile()` 泛用算出來的，換了 `thesisNotesFile()` 的回傳值後自動跟著對，不用特別改）。同時把純 notes-web、桌面版不讀的共用牆持久狀態（`card.ts`／`people.ts`／`visits.ts`）從 `dirname(LIFE_FILE)` 根目錄的 `.sticky_wall_card.json`／`.sticky_wall_people.json`／`.sticky_wall_visits.json` 收進同一層的 `.share/card.json`／`.share/people.json`／`.share/visits.json`（檔名順便簡化，資料夾名稱已經表達了語意）。**生活便利貼本身（JSON／圖片／縮圖／標籤色）刻意沒有搬**——使用者確認要跟桌面版保持相容，固定路徑（`indexes/.sticky_notes.json`、`.sticky_note_images/`、`.sticky_note_thumbs/`、`.sticky_tag_colors.json`）完全沒動。**一次性搬家邏輯**：`store.ts` 的 `migrateLegacyDataLayout()`，`index.ts` 在任何路由掛上之前呼叫一次（跟 `pruneTrash()` 同一種「啟動時做一次」的位置）——只搬「新位置還沒有」的東西（用 `existsSync(to)` 擋），舊位置有殘留就跳過不動，單筆搬移失敗（檔案被鎖）不擋啟動、資料留在原位置等下次啟動重試；也一併把階段一遺留的中繼位置（`dirname(LIFE_FILE)/.thesis_tag_colors.json`）收進 `.thesis/`。**已用隔離測試 server 驗證過**完整搬家流程（含模擬真實舊狀態、重複啟動確認 idempotent 不會誤搬/覆蓋）。 |
| Web 便利貼牆 上方面板收合（手機） | 收合範圍**經過一次擴大**：第一版（使用者原始需求）只收工具列小按鈕那一排；第二版（使用者反映「捲動便利貼時偶爾會不小心捲動到上方主標題和簡介摘要」）把主標題/簡介/統計也併進同一個收合開關。狀態提升到 `App.tsx` 的 `panelCollapsed`（原本是 `Toolbar.tsx` 的本地 state，因為 `<header className="hero">` 在 `App.tsx`、跟 `Toolbar.tsx` 的三排不同元件，收合狀態要共用就得提升上去），透過 `collapsed`/`onToggleCollapsed` props 傳給 `Toolbar`；持久化在 `src/lib/panelCollapse.ts`（`localStorage`，各瀏覽器自己記，不是牆面共用設定）。實作是**兩個獨立的 grid 容器共用同一個布林值**，不是單一 DOM 包起來：`App.tsx` 的 `.hero-collapse`（包 `<header className="hero">`）跟 `Toolbar.tsx` 的 `.panel-collapse`（包 `collection-row`／`bar-row-find`／`bar-row-tools` 這三排全部，不再只有小按鈕列）各自用 `grid-template-rows: 1fr` ↔ `0fr` 做展開/收合動畫（`index.css`），視覺上兩塊一起收合／展開。分界／收合鈕（`.panel-collapse-handle`，在 `Toolbar.tsx` 裡）固定卡在這整塊面板和 `<TagBar>`（標籤篩選列）中間——**收合後只剩一條分界線＋標籤列＋便利貼牆**，標籤列本身跟便利貼牆完全不受影響。 |

## AI search — model constraint (the prompt contract)

`StickyNoteService.build_ai_search_prompt()` — `sticky_note_service.py:121-162`.

The model must answer four question shapes with one response: find-relevant,
content-summary ("每日必做有哪些事項"), count ("有幾個"), category-list
("目前有哪些分類"). A find-only contract (just return matching indices) can't
answer count/summary questions, so the prompt forces a JSON object:

```json
{"answer": "<full natural-language answer, plain text, no Markdown>",
 "ids": [<1-based note indices>],
 "list_tags": <bool>}
```

`ids` is 1-based against the numbered list appended to the same prompt (each
note: title / tag / body truncated to `AI_SEARCH_BODY_SNIPPET_CHARS` = 200
chars, `sticky_note_service.py:18`).

`list_tags: true` signals a category/tag-listing question. When true, the
app does **not** trust the model's own formatting of the tag list — see
next section. The model is told to keep `answer` brief (even empty) in this
case since the real list is appended in code.

**Why JSON and not the earlier plain-text `答案:.../編號:...` format**: that
format shipped first and was intermittently unreliable — models would drop
the `編號` label roughly at random, which parsed as "zero results" even when
the answer text was correct. JSON compliance is meaningfully more consistent.
This was a real user-reported bug ("有時候搜到,有時候沒有"), not a
theoretical concern — don't revert to plain-text-only parsing.

## AI search — response parsing (the enforcement side)

`StickyNoteService.parse_ai_search_response()` — `sticky_note_service.py:163-211`,
helper `_try_parse_json()` at `:227-241`.

**Tag-list formatting is done in Python, not trusted to the model**:
`_append_numbered_tag_list()` at `:214-224`. Observed failure mode — asking
"目前有哪些類別" got a correct but unusably-formatted answer (tags run
together on one line, no numbering, no line breaks). Rather than iterate on
prompt wording again, `list_tags: true` in the JSON response makes the app
build the enumerated list itself with a plain `for i, tag in
enumerate(known_tags(), start=1)` loop — guarantees consistent formatting
*and* that the list exactly matches live data (`known_tags()` reads current
notes fresh every call, no caching to invalidate when tags are added/removed).

**Gotcha fixed here**: when `answer` is a valid-but-empty string (expected
when `list_tags` is true, since the model was told brevity is fine), do not
fall back to dumping the raw JSON response as the answer text — only use
that fallback path when JSON parsing itself failed. An earlier version of
this method used `str(data.get("answer","")).strip() or response`, which
leaked the raw `{"answer": "", ...}` JSON into the user-facing dialog
whenever the model complied by leaving `answer` blank.

Three-layer fallback, in order: (1) parse the whole response as JSON, (2)
regex out the first `{...}` span and parse that (handles ```` ```json ````
fences and chatty prefixes/suffixes), (3) fall back to the old `答案:/編號:`
label regex. If all three fail, `answer` is the raw response text and `ids`
is empty — never raises, never silently drops the answer text.

If you change the prompt's output contract, update all three layers or the
fallback chain silently degrades.

## Cost/usage awareness (shared by AI search + AI batch describe)

Added because sticky notes send the *entire* note collection to the model on
every search with no size cap, and the user flagged (correctly) that this
scales with note count and is invisible to them — no token math, no running
total, and — before this — no confirmation dialog at all for local/Ollama
calls.

- **Call counter**: `AIDescriptionService.record_call()` /
  `.get_call_count()` — `ai_description_service.py:45-53`. Persisted via
  `AIUsageRepository` → `indexes/.ai_usage.json` (`ai_usage_repository.py`).
  One shared counter across sticky AI search *and* AI batch describe — not
  per-feature. `record_call()` fires once per actual outbound API request,
  counted even on failure (many providers still bill/consume quota on a
  failed call). Call sites: `ai_description_service.py:172,184` (inside
  `_generate_one`, one per file in a batch) and
  `sticky_note_panel.py:531` (one per search).
- **Size estimate**: `AIDescriptionService.estimate_prompt_size()` (static,
  `ai_description_service.py:55-64`) returns a character count, explicitly
  labeled "約...非精確 token 數". Deliberate choice not to integrate a real
  tokenizer — OpenAI and Ollama use different tokenizers per model, so a
  precise count would need a per-provider dependency for a number that's
  still just an estimate of *their* cost, not a guarantee. Character count is
  the honest, provider-agnostic proxy.
- **Consent dialog fires for every provider now**, not just OpenAI/cloud —
  that was the actual gap (Ollama/local previously had zero pre-call
  visibility). See `sticky_note_panel.py:508-527` (AI search) and
  `main_window.py:1172-1206` (`_on_ai_regenerate_batch`, AI batch describe).
  Batch describe's size estimate is a cheap upper bound
  (`text_count × CACHE_TEXT_CHARS`, from `cache_repository.py`) rather than
  actually reading every selected file — reading up front to get an exact
  number would slow down opening the confirm dialog, especially for legacy
  Office formats that shell out to COM automation.
- **Tag-filter pre-scoping** (`sticky_note_panel.py:497-501`): AI search now
  respects whatever tag filter is currently selected in the panel before
  building the prompt — previously it always sent every note regardless of
  the visible filter. This is the main user-facing lever for keeping cost
  down as notes grow: filter by tag, then ask.
- Threshold for the "you have a lot of notes, consider narrowing" hint:
  `STICKY_AI_SEARCH_LARGE_NOTE_COUNT = 30` in `config.py:71`.

None of this computes real currency cost. It cannot — that requires
provider+model pricing tables this app has no source for. Don't imply
otherwise in UI copy; every string here is deliberately hedged ("僅供參考",
"以 Provider 帳單為準").

## Ollama — local vs LAN host

Pointing Ollama at another machine on the LAN (`http://192.168.1.50:11434`)
is a supported config. `.ai_settings.json` still stores a single full
`base_url` string — the split UI is presentation only. Helpers in
`ollama_provider.py`:

- `normalize_base_url()` — trims, drops trailing `/`, prepends `http://`
  when the user typed a bare `host:port`. Used for the advanced (full-URL)
  input path.
- `split_standard_url(base_url) -> (host, is_standard)` /
  `build_standard_url(host) -> "http://<host>:11434"` — the segmented
  input's parse/rebuild pair. `is_standard` is False for any https / custom
  port / path / userinfo URL.
- `is_local_endpoint()` — true only for loopback hosts (`localhost`,
  `127.0.0.0/8`, `::1`, `0.0.0.0`, empty). Anything else — LAN IP, mDNS
  name, remote hostname — is treated as "content leaves this machine".

**Settings dialog — "在哪裡執行" radio + segmented address input**
(`ai_settings_dialog.py`). Layered so a non-technical user never has to know
what `localhost` means, and can't get stranded after editing the IP:

1. **`_ollama_where_var` radio** ("🖥️ 就在這台電腦" / "🌐 區網裡的另一台電腦")
   — `_sync_ollama_where()`. "本機" hides the whole address block (label,
   segmented row, 進階 checkbox, full-URL entry) behind one grey line and
   `_collect_ollama_base_url()` returns `DEFAULT_BASE_URL` verbatim,
   ignoring whatever is left in the host box. **This is the "undo" path** —
   a user who typed a LAN IP and forgot how to go back just clicks "就在這台
   電腦" again. Initial value is "local" only when
   `is_local_endpoint(saved) and is_standard`; a local-but-custom-port URL
   (rare) loads as "lan" + 進階 so it's still visible/editable, never
   silently normalised away.
2. **Segmented host box** (shown only under "另一台電腦"): `http://`
   (readonly, grey) · **host box** (blue focus ring, auto-focused +
   text-selected via `_focus_ollama_host`, which now no-ops in local mode) ·
   `:11434` (readonly, grey). `_collect_ollama_base_url()` rebuilds with
   `build_standard_url()`. Switching local→lan clears a leftover
   loopback host so "另一台電腦" never points at itself.
3. **"進階" checkbox** (`_ollama_advanced_var`) swaps in a single full-URL
   `Entry` for the custom-port / https case; `_sync_ollama_addr_mode()`
   moves the value across on every toggle so nothing typed is lost.

`.ai_settings.json` still stores a single full `base_url` string — all of
the above is presentation only.

**Model name — editable dropdown** (`_ollama_model_combo`, a `ttk.Combobox`,
`state="normal"`). Values are the installed models from that box's
`/api/tags`, fetched off-thread by `_refresh_ollama_models()` /
`_poll_ollama_models()` (via `AIDescriptionService.list_ollama_models()` →
`ollama_provider.list_models()`), and refreshed on the 🔄 button, on opening
the dialog with Ollama selected, and on switching into the Ollama section
with an empty list. Stays free-text so an un-`pull`ed model or a pre-tags
Ollama isn't a dead end; the hint line flags a typed model that isn't in
the fetched list. `initial=True` fetches fail quietly (user may just not
have Ollama running yet); the manual button surfaces the error.

**Model readiness checks — `test_connection()` returns a warning string.**
The old contract was `-> None`, raise on failure. Now it's
`-> str | None`: still raises on "can't connect", but returns a warning
string for "connected fine, but the picked model won't actually work". Two
cases, both real user reports:
- Model name not in the remote's `/api/tags` list (typo, or not `pull`ed on
  that box). `_model_installed()` normalises bare names to `:latest` on both
  sides before comparing.
- Model is text-only. `_vision_support()` reads `capabilities` from
  `/api/show` (cached per provider instance — `_show_cache` — so a 50-image
  batch does one `/api/show`, not 50). Returns `True`/`False`, or `None`
  when `capabilities` is absent (pre-2024 Ollama) — `None` never blocks.
`generate_image_description()` hard-raises when `_vision_support() is False`
*before* sending, because a text-only Ollama model given `images:` often
doesn't error — it silently ignores the image and hallucinates a
description from the prompt alone, which is worse than a clean failure.
Callers: `ai_settings_dialog._test_connection` shows the warning instead of
the green "✅ 連線成功"; batch/analyze surface the raised error through the
existing `_summarize_ai_errors` / `messagebox` paths. OpenAI's
`test_connection` still just returns `None`.

`current_target_summary()` (`ai_description_service.py`) uses that to set
`leaves_machine` / `lan` and the label ("Ollama（本機）" vs
"Ollama（區網主機）"). **`leaves_machine` means literally "the bytes left
this computer"** — it's true for LAN Ollama, and `ai_analyze_dialog.py`
relies on that原義 ("內容已離開這台電腦"). It is NOT a proxy for "is the
cloud/OpenAI provider": code that wants *that* distinction must check
`provider == "openai"` (fixed at `main_window.py:1186` and in
`target_disclosure_lines()`), otherwise LAN Ollama wrongly gets the
"雲端、會計費" warning or the "送到 OpenAI 分析" button.

The serving machine still needs `OLLAMA_HOST=0.0.0.0` (Ollama binds
127.0.0.1 by default) and its firewall opened on 11434 — that's the remote
box's config, nothing this app can set. The settings dialog hint and
`ollama_provider.py`'s module docstring both say so; keep them in sync.

## Gotchas hit while building this (worth not re-discovering)

- **Emoji variation selectors break pixel-centering.** `🗑️` is two code
  points (`U+1F5D1` + `U+FE0F`); the invisible selector adds ~23px to a
  Tk `Label`'s layout box, which then renders off-center inside a
  `place(relx=0.5, anchor="center")` container. Fix: use the bare glyph
  (`🗑`, one code point) for anything pixel-centered. See
  `sticky_note_panel.py` around the bulk-delete icon button.
- **Tk `pack()` cavity order, not just `side=`, decides who gets squeezed.**
  A `fill="both", expand=True` sibling packed *before* a `side="bottom"`
  status/button bar will starve it of space regardless of its own `side`
  value — `pack` shrinks the cavity in packing-call order, not by side. Fix
  is `before=<the expand widget>` on the bottom-anchored one. Hit this twice:
  the add/edit dialog's confirm buttons (`sticky_note_dialog.py`) and the
  "copied" toast (`sticky_note_panel.py`, `_copy()`).
- **Python's `hash()` is randomized per-process** (hash seed changes every
  interpreter start) — unusable for the tag→color mapping, which must be
  stable across restarts. Use `hashlib.md5` instead
  (`sticky_note_service.py`, `color_for_tag`).
- Icon buttons in the panel header are hand-rolled (`Frame` + centered
  `Label`, not `tk.Button`) specifically because `tk.Button` sizes itself to
  its text/glyph width, and the four emoji glyphs have different natural
  widths — a `Button`-based row renders visibly uneven. See `_icon_button()`
  at the top of `sticky_note_panel.py`.
