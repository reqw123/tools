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
| Web 便利貼牆 身分／活動／護欄 | 「你的名字」：`src/lib/identity.ts`（**`x-note-author` 標頭一定要 `encodeURIComponent`**——中文名字不編碼會讓瀏覽器 `fetch()` 直接丟 TypeError，這是踩過的坑）。**簡易認證**：`server/people.ts`（名字＋PIN，PIN 存 sha256、身分靠無狀態 HMAC 簽章 cookie `identity_session`，金鑰＝共用密碼）。**2026-09 收緊**（使用者要求「決定好名稱和 PIN 後不可以任意更換」）：`claimOrVerify()` 現在**名字非空一定要求 PIN**（以前沒填 PIN 也能用、純顯示不保護——這個口子關掉了），牆上完全沒有「改名字」「換 PIN」的功能，要換得請牆主在 `/host` 用 `releasePerson()` 解除保護。連帶補了一個冒用漏洞：`identity.ts` 的 `fromHeader()`（沒有簽章 cookie 時的退回路徑）現在先查 `isProtectedName()`，標頭填到已保護的名字直接當匿名——不然「名字要設 PIN」這條規則可以被沒登入、單純改標頭繞過。同一批收緊也擴到 `openAccess`（見上面「後台」列）：`shareAuthHook`／`POST /session` 現在開著開放模式時一樣要求名字＋PIN（不能留空匿名），只免共用密碼，不然「先不要密碼」的臨時方便會變成連身分都不用驗、放任冒充。`server/identity.ts` 的 `authorFrom()` 優先信簽章 cookie、蓋過前端標頭——已登入的人改不了 `x-note-author` 冒充別人。`share_session`／`identity_session` 都**沒有 maxAge**（session cookie，瀏覽器關掉才失效＝「每次連線都要密碼」）。活動記錄 `server/activity.ts`、在場提示 `server/presence.ts`——都純記憶體、不寫檔、server 重開歸零，只是提示性資訊；身分資料則持久存在 `indexes/.sticky_wall_people.json`。`presence.ts` 的 `noteId → 編輯者` **是集合不是單一值**——同一則支援多人同時顯示（具名用名字當 key，匿名退而求其次用來源 IP，見 `clientIp`，已從 `share.ts` export 出來給它用）。**連線／斷線** `server/connections.ts`——借 `GET /api/events`（SSE）本身的連線生命週期當訊號，用 `identity.ts` 的 `identityKey()` 參照計數（同一人開好幾個分頁只算一次連線，全部關掉才算斷線），斷線有 5 秒寬限（吃掉換頁那種瞬斷瞬連），寫進同一份 `activity.ts`（`action: 'connect'|'disconnect'`）。工具列「📋 動態」＝ `ActivityDialog.tsx`；標題右側常駐面板＝ `ActivityTicker.tsx`（已認證的名字鎖住改不了，要換人得先登出；`connect`/`disconnect` 不接「「標題」」後綴，見 `NO_TARGET`）。遠端護欄（`server/share.ts`）：AI 每日額度（`SHARE_AI_DAILY_LIMIT`，只限 `/ai/search`；AI 整組要先在 `/host` 開，見上面「後台」列）、寫入限速（120 次/分鐘/IP，`/api/session` 除外）、登入限速（密碼錯或 PIN 錯都算同一個計數）。**顯示用匿名名稱**：`share.ts` 的 `displayAuthorFrom()`——完全匿名（沒身分 cookie、沒標頭）且是 loopback 連線時顯示「開發者」而不是空字串／「有人」，只給 log／通知這類顯示用途，不能拿去做身分比對或權限判斷（2026-09 先加在 files-web，這次補齊到 notes-web；`notes.ts` 的新增／編輯便利貼因為同時要做「指派給自己不通知」的身分比對，`author`（真身分）跟 `displayAuthor`（顯示用）分成兩個變數，不能混用）。細節見 README「登入 session」「簡易身分記憶與認證」「遠端護欄」 |
| Web 便利貼牆 生活／研究生資料分離＋資料夾整理 | **2026-09 加**（使用者要求，分兩階段）。**階段一**：插圖分開存放——生活牆 `noteImagesDir`（常數，跟桌面版共用，路徑不能動）vs 研究生 `thesisImagesDir()`（函式）；讀寫一律呼叫 `activeImagesDir()`（依 `activeCollection` 挑），`unlinkImage()`／`readImageDataUri()`／`writeImageDataUri()`／`commitNoteImage()`／`DELETE /notes/:id/image` 都改吃這個。縮圖快取（`note-thumb.ts`）的 `resolveThumb()`/`dropThumbs()` 要求呼叫端明確傳 `imagesDir`，不是自己猜。生活牆靜態路由不變（`@fastify/static` 綁死 root）；研究生圖片改走 `index.ts` 的一般路由 `GET /thesis-note-images/:filename`（每次請求當場算路徑，因為研究生資料夾可能變）。前端 `noteImageUrl()`/`noteThumbUrl()`（`src/lib/api.ts`）依 `getApiCollection()` 決定要打 `/note-images/` 還是 `/thesis-note-images/`（縮圖走 `/api/note-thumb/...&collection=thesis`）——**這兩支是給 `<img src>` 直接載入的，瀏覽器載圖不會帶 `x-note-collection` 標頭**，只能靠 URL 本身分辨；`exportHtml.ts` 的 `imageDataUri()` 也改吃 `noteImageUrl()` 組好的完整 URL。**修過一個真實安全漏洞**：新路由一開始沒把 `/thesis-note-images/` 加進 `share.ts` 的 `shareAuthHook` 密碼牆放行清單判斷式，遠端不用密碼就能直接撈研究生便利貼的圖——已補上 `!path.startsWith('/thesis-note-images/')`。**階段二**（使用者反映「研究生便利貼不要再跟著專案資料夾」＋整體資料太雜亂）：`thesisNotesFile()`／`thesisDataDir()` 改成固定回傳 `dirname(LIFE_FILE)/.thesis/notes.json`，**不再依賴 `thesisProjectDir` 設定決定存放位置**——`thesisProjectDir` 這個設定還在，但現在只給「從專案生成」（`ai-routes.ts`）讀論文文件用，跟資料存放位置無關。研究生的 `tag_colors.json`／`images/`／`notes_history/` 全部收進同一個 `.thesis/` 底下（`historyDir()` 因為是從 `activeNotesFile()` 泛用算出來的，換了 `thesisNotesFile()` 的回傳值後自動跟著對，不用特別改）。同時把純 notes-web、桌面版不讀的共用牆持久狀態（`card.ts`／`people.ts`／`visits.ts`）從 `dirname(LIFE_FILE)` 根目錄的 `.sticky_wall_card.json`／`.sticky_wall_people.json`／`.sticky_wall_visits.json` 收進同一層的 `.share/card.json`／`.share/people.json`／`.share/visits.json`（檔名順便簡化，資料夾名稱已經表達了語意）。**生活便利貼本身（JSON／圖片／縮圖／標籤色）刻意沒有搬**——使用者確認要跟桌面版保持相容，固定路徑（`indexes/.sticky_notes.json`、`.sticky_note_images/`、`.sticky_note_thumbs/`、`.sticky_tag_colors.json`）完全沒動。**一次性搬家邏輯**：`store.ts` 的 `migrateLegacyDataLayout()`，`index.ts` 在任何路由掛上之前呼叫一次（跟 `pruneTrash()` 同一種「啟動時做一次」的位置）——只搬「新位置還沒有」的東西（用 `existsSync(to)` 擋），舊位置有殘留就跳過不動，單筆搬移失敗（檔案被鎖）不擋啟動、資料留在原位置等下次啟動重試；也一併把階段一遺留的中繼位置（`dirname(LIFE_FILE)/.thesis_tag_colors.json`）收進 `.thesis/`。**已用隔離測試 server 驗證過**完整搬家流程（含模擬真實舊狀態、重複啟動確認 idempotent 不會誤搬/覆蓋）。 |
| Web 便利貼牆 上方面板收合（手機） | 收合範圍**經過一次擴大**：第一版（使用者原始需求）只收工具列小按鈕那一排；第二版（使用者反映「捲動便利貼時偶爾會不小心捲動到上方主標題和簡介摘要」）把主標題/簡介/統計也併進同一個收合開關。狀態提升到 `App.tsx` 的 `panelCollapsed`（原本是 `Toolbar.tsx` 的本地 state，因為 `<header className="hero">` 在 `App.tsx`、跟 `Toolbar.tsx` 的三排不同元件，收合狀態要共用就得提升上去），透過 `collapsed`/`onToggleCollapsed` props 傳給 `Toolbar`；持久化在 `src/lib/panelCollapse.ts`（`localStorage`，各瀏覽器自己記，不是牆面共用設定）。實作是**兩個獨立的 grid 容器共用同一個布林值**，不是單一 DOM 包起來：`App.tsx` 的 `.hero-collapse`（包 `<header className="hero">`）跟 `Toolbar.tsx` 的 `.panel-collapse`（包 `collection-row`／`bar-row-find`／`bar-row-tools` 這三排全部，不再只有小按鈕列）各自用 `grid-template-rows: 1fr` ↔ `0fr` 做展開/收合動畫（`index.css`），視覺上兩塊一起收合／展開。分界／收合鈕（`.panel-collapse-handle`，在 `Toolbar.tsx` 裡）固定卡在這整塊面板和 `<TagBar>`（標籤篩選列）中間——**收合後只剩一條分界線＋標籤列＋便利貼牆**，標籤列本身跟便利貼牆完全不受影響。 |

## Index wall (索引牆 files-web) — file map

| Concern | File |
|---|---|
| Web 索引牆 區網／公網共用模式 | **2026-09 加**，架構直接搬自上面「便利貼牆」的同一套（`notes-web/server/share.ts` 等），兩邊各自一份程式碼、各自一份資料，不共用。核心檔案跟便利貼牆同名同角色：`files-web/server/share.ts`（密碼牆 hook＋危險端點封鎖＋登入限速＋`/api/session`）、`events.ts`＋`change-bus.ts`（SSE 即時同步）、`identity.ts`／`people.ts`（`x-index-author` 標頭、簽章 cookie `identity_session`）、`activity.ts`／`presence.ts`／`connections.ts`（純記憶體）、`visits.ts`（持久化訪客紀錄）、`host-routes.ts`（`/host`，只認 loopback）。**沒有自己獨立的共用啟動器**——2026-09 一開始有兩個 `.bat`（`啟動-共用索引牆（區網）.bat`／`啟動-索引牆（區網＋公網）.bat`，預設 port 8791、資料夾 `files-web/public-index-data/`），使用者確認不需要「單獨啟動索引牆」這條路後已移除（連同對應的 `files-web/scripts/share-serve.mjs`、`package.json` 的 `npm run share`）；`SHARE_MODE=lan` 這套機制本身沒動，現在只透過下面「多人牆閘道（share-gateway）」啟動。**跟便利貼牆的差異**（其餘都是原封不動移植）：(1) **沒有看板／彈幕**，索引牆沒有對應概念；(2) **根路徑 `/` 沒有停用**——便利貼牆的 `/wall` 是刻意讓 `/` 什麼都不畫，這裡因為要保留桌面版工作流程／`wallpaper-app` 內嵌既有直接開根路徑的用法，**沒有跟進**這個設計，存取控制純靠 `<AppGate>` 密碼牆，任何路徑都會過；(3) **多了唯讀身分 `role: 'editor'\|'viewer'`**（`people.ts`，便利貼牆沒有）——`/host` 可以把某個已註冊 PIN 的名字設成 `viewer`，之後這個人的任何非 `GET` 請求被 `shareGuardHook` 擋 403，給「開放瀏覽但不給改」用；(4) **危險端點清單更長**：`/api/open`（開檔案總管）、`/api/browse`／`/api/scan`（瀏覽/掃描本機任意路徑）、`/api/indexes/:name/edit`（開系統文字編輯器）、`/api/ai/settings`／`/ai/test`／`/ai/models`（改 host 的 AI provider／金鑰）——這些即使密碼登入了也一律只認 loopback，因為 files-web 本身就是靠這幾支操作主機才需要平常鎖 127.0.0.1。**已用隔離測試 server（獨立 port + 獨立資料夾 + `SHARE_AI=off`）驗證過**完整流程：loopback 豁免／`x-forwarded-for` 模擬遠端不豁免、開放模式仍要求名字＋PIN、`/host` 系列端點遠端一律擋、`x-index-author` 標頭冒用已保護名字被正確當匿名。細節見 `files-web/README.md` 的「區網＋公網共用模式」一節。 |
| Web 索引牆／便利貼牆 離線／共用低耦合 | **2026-09 修的真實 bug**：`activityRoutes`／`hostRoutes` 以前不管 `SHARE_MODE` 都會在 `server/index.ts` 註冊，`GET /api/events`（SSE，離線也需要，桌面版寫檔要能推給網頁）的連線生命週期會觸發 `connections.ts` 記一筆訪客，寫進 `indexDir/.share/visits.json`——**離線模式下 `indexDir` 就是真正的個人 `indexes/` 資料夾**，等於單純打開網頁版（不管有沒有開共用）就會side-effect 寫進個人資料夾，使用者發現後要求「確保離線版和連線版是低耦合的」。**修法**：`files-web` 把 `activityRoutes` 和 `hostRoutes` 都改成只在 `SHARE_MODE==='lan'` 才註冊（兩支對索引牆而言離線完全沒有使用情境）；`notes-web` 只把 `hostRoutes` 這樣改——它的 `activityRoutes` 還包了 `/card`（看板）／`/danmaku`／`/people`（指派名字清單），這些離線的個人展示情境（wallpaper-app 桌面板）也合法在用，**不能**跟著鎖，只在 `events.ts` 的 SSE handler 把 `connectionOpened()`/`connectionClosed()`（真正寫 `visits.json` 的那段）包一層 `if (SHARE_MODE==='lan')`，兩邊的 SSE 連線本身（即時同步）都保持離線也能用。前端對應：`files-web` 的 `useActivity`/`usePresence`/`useViewingHeartbeat` 加 `enabled: isShare`（沒有離線用途）；`notes-web` 的同名 hook **維持原樣不加** `enabled`（`Note.tsx`／`NoteDialog.tsx` 離線也會用到，例如自己開兩個視窗編輯同一則的提示）。**已用隔離測試 server 驗證**：離線模式下 `/api/activity`／`/api/host/state`（files-web）跟 `/api/host/state`（notes-web）都正確 404，SSE 仍能連線，且不會建立 `.share/` 資料夾；`SHARE_MODE=lan` 模式下這些端點跟訪客紀錄都正常運作不受影響。 |
| Web 索引牆／便利貼牆 共用牆資料備份／匯出 | **2026-09 加**，使用者反映 `public-wall-data/`／`public-index-data/`／`public-share-data/` 這些共用牆資料夾完全在 `.gitignore` 外、沒有任何備份機制，資料損毀時求助無門。兩邊各自新增 `server/backup.ts`（邏輯完全相同）的 `createBackupZip(dir)`：遞迴走訪整個資料夾、把每個檔案讀進一個 `yazl.ZipFile`，`GET /host/export`（`host-routes.ts`，只認 loopback）把打包好的 Buffer 當 `application/zip` 附件回傳。**選 `yazl` 不是 `archiver`**——只有一個依賴（`buffer-crc32`，本身零依賴），純粹「給一批檔案生一個 zip」，不需要 `archiver` 那種依賴樹龐大、功能也用不到的套件；也沒有手刻 zip／tar 容器格式自己重造輪子（backup 是「資料正確性」要求最高的功能，不是省依賴的地方）。zip 內路徑一律轉成正斜線（Windows `relative()` 給反斜線，直接塞進 zip 會讓 macOS/Linux 解壓縮的人得到一串檔名而不是真的子資料夾）。前端 `HostPanel.tsx`（兩邊都加）用純 `<a href="/api/host/export">` 下載連結，不是 fetch＋blob——讓瀏覽器自己處理下載進度／存檔對話框。`indexDir`（files-web）／`dirname(notesFilePath)`（notes-web）就是目前這個 server 實際在用的資料夾——區網模式下是各自獨立的 `public-*-data/`，多人牆閘道模式下兩邊都指到同一個 `public-share-data/`，不用另外判斷模式、少一種要測的分支。**已用隔離測試 server 驗證**：兩邊各自準備一個含巢狀子資料夾的假資料夾，下載回來的 zip 檔案清單、相對路徑、內容都正確；遠端（模擬 `x-forwarded-for`）打這支端點被擋（`shareAuthHook`／loopback 檢查先擋下，跟其他 `/host/*` 端點行為一致）。 |
| Web 索引牆 遠端上傳檔案 | **2026-09 加**，使用者要求「讓多人索引牆讓連線的使用者上傳自己的文件到牆上」。`加入索引`／`匯入資料夾` 這兩顆遠端一律鎖住（`isRemoteShare`），因為背後是 `/browse`／`/scan`——瀏覽**主機**硬碟，遠端使用者的裝置本來就不該看得到主機檔案系統，這是刻意的邊界不是誤鎖。新增 `POST /api/indexes/:name/upload`（`files-web/server/upload-routes.ts`，`@fastify/multipart`）走反方向：使用者把自己裝置上的檔案傳上來，server 落地到這份索引集所在資料夾的 `.uploads/`（`join(indexDir, '.uploads')`——`SHARE_MODE=lan` 時就是 `public-index-data/.uploads/`，離線時是 `indexes/.uploads/`，兩者都已被上層目錄的 `.gitignore` 規則涵蓋，不用額外加規則），再呼叫既有的 `appendEntry()` 附加一列——完全不需要遠端瀏覽主機硬碟。檔名處理：`basename()` 擋路徑穿越＋洗掉檔案系統不安全字元＋前綴時間戳/隨機碼避免碰撞，原始檔名保留在後半段方便肉眼辨識。`category`／`description` 走 **query string 不走 multipart 欄位**——這是刻意的簡化，`@fastify/multipart` 的 `req.file()` 只保證拿到「第一個檔案 part」，其他欄位有沒有解析完全看它們在原始 multipart body 裡排在檔案前面還是後面，query string 完全避開這個版本行為細節。上限 50MB（比便利貼插圖的 8MB 大很多——PDF/簡報常常好幾 MB），超過或索引集不存在都會 `rmSync` 清掉已寫入的檔案再回錯，不留孤兒檔案。前端 `UploadEntryDialog.tsx`（`Toolbar.tsx` 新按鈕「上傳檔案」）用瀏覽器原生 `<input type=file>`（不是 `FileBrowser` 那個後端 `/browse` 面板），**不吃 `isRemoteShare`**——這是這顆按鈕存在的唯一理由。`src/lib/api.ts` 的 `req()` 原本無條件把有 body 的請求設成 `content-type: application/json`，改成只在 `body` 是字串（`JSON.stringify` 結果）時才設，讓 `FormData` body 能讓瀏覽器自己算 multipart boundary。**已用隔離測試 server 驗證**：loopback 建立索引集＋模擬 `x-forwarded-for` 遠端上傳成功、`viewer` 角色上傳被 `shareGuardHook` 擋 403 且沒有寫入孤兒檔案、上傳到不存在的索引集回 404 且清掉已寫入的檔案、上傳成功的檔案能透過既有 `/api/file` 正常串流回來。**後續加了資料夾版本**（使用者接著要求「除了上傳檔案以外，也想支援上傳資料夾」）：`POST /api/indexes/:name/upload-batch`，前端 `UploadFolderDialog.tsx` 用 `<input webkitdirectory multiple>` 選一整個資料夾，逐檔用 `File.webkitRelativePath` 標出相對路徑（`encodeURIComponent` 過後當 multipart 檔名送出，見 `api.ts` 的 `uploadFolder()`），server（`sanitizeRelPath()`）解碼、拆段、逐段清洗（擋 `..`／控制字元），在 `.uploads/` 底下**這一批專屬的資料夾**重建目錄結構——跟單檔不同，這裡**保留子資料夾結構**（不是全部拍平），這樣「分組：依資料夾」對上傳進來的一批項目才有意義；整批只呼叫一次 `appendEntries()`（單次寫入），不是逐檔各寫一次。限制：單檔沿用 50MB、批次最多 500 個檔案（`MAX_BATCH_FILES`）、批次加總最多 300MB（`MAX_BATCH_TOTAL_BYTES`，單檔限制擋不住「500 個 50MB 疊起來」這種量），超過的部分算 `skipped`（回應 `{added, skipped}`）不會讓整批失敗；`for await` 外層再包一層 try/catch 吞掉 `@fastify/multipart` 的 `FilesLimitError` 之類，已收到的檔案照樣算數。前端額外用 `SCAN_SKIP_DIRS`（跟 `store.ts` 同一份清單）過濾掉 `node_modules`／`.git`／`dist` 這類產出物資料夾，這層純粹是前端體驗優化，**server 端不重複做這層過濾**（它只管路徑安全，不管「這個資料夾是不是產出物」）。**已用隔離測試 server 驗證**：模擬遠端上傳含子資料夾的兩個檔案，磁碟結構與索引集內容都正確保留巢狀路徑；混合一個路徑穿越（`../../evil.txt`）＋一個正常檔案的請求，正常檔案照常加入、穿越那個被跳過且沒有任何檔案逃出 `.uploads/`；viewer 角色批次上傳一樣被 403 擋下且不寫檔；上傳到不存在的索引集時整個批次資料夾被清掉，沒有留下孤兒目錄。**再後續加了類型篩選**（使用者要求「完全參考離線版做法」，指 `BatchImportDialog` 的檔案類型篩選＋分類分佈預覽）：新增 `src/lib/extCategories.ts`，把 `server/store.ts` 的 `EXT_CATEGORIES`（副檔名→分類的純字串對照表）複製一份到前端——因為分類判斷不需要讀檔案內容、只看副檔名，選好的一批 `File` 已經整批在瀏覽器手上，不需要像本機掃描那樣另外打一支 API 來回，可以直接在前端 `useMemo` 就地分類、即時篩選（勾選類型的瞬間數量立刻更新，沒有「掃描中」的等待狀態，這是跟離線版唯一的行為差異，其餘 UI——色塊按鈕、`cat-pills` 分類分佈、都不選＝收錄全部——都直接沿用同一套 CSS class 跟版面）。`UploadFolderDialog.tsx` 重用既有的 `useScanCategories()`（`/api/scan-categories`，純靜態定義，不分模式都能打）拿 icon／color，`categoryOf()` 只回標籤字串。**已實際跑瀏覽器驗證**（Playwright，`setInputFiles` 直接指向一個內含 `node_modules` 垃圾資料夾＋4 種真實檔案類型的測試資料夾）：`node_modules` 正確被排除、4 個檔案的分類分佈跟人工預期完全對上、點選「文字」類型後畫面即時只剩 1 筆且送出按鈕文字同步更新、實際送出後 server 端索引集也確實只多了那一筆、其餘 3 個檔案沒有被上傳。 |
| Web 索引牆 誰正在編輯哪一列 | **2026-09 加**，使用者要求「動態顯示某某正在編輯…某檔案被修改…」——後半段（某檔案被修改）本來就有，`server/activity.ts` 的 `update` 動作＋`ActivityTicker`／`ActivityDialog` 的「動態」已經會顯示「XX 編輯了「檔名」」；缺的是前半段：**當下**正在編輯、不是事後紀錄。既有的 `server/presence.ts`（`GET`/`POST /presence`）追蹤的是「誰開著哪份索引集」，粗一級，不是「誰正在編輯哪一列」。新增 `server/entry-presence.ts`，機制完全搬自 `notes-web/server/presence.ts`（「誰正在編輯這則便利貼」），只是 key 多一層「哪個索引集」：`entryKey(indexName, path)` 用 **NUL 字元**（`String.fromCharCode(0)`）接兩段字串——路徑常常含空白（`C:\Users\John Doe\...`），不能像便利貼那邊只用 noteId 當單一 key，也不能挑一個「看起來安全」的可印字元當分隔符（路徑幾乎什麼字元都可能出現），NUL 是唯一保證不會出現在檔案路徑或索引集檔名裡的字元。`GET /api/entry-presence?index=` 回 `{ [path]: 作者名[] }`（只回這份索引集的）、`POST` 帶 `{indexName, path, editing?, clientId?}` 心跳／收工。前端 `EntryRow.tsx` 的 inline 編輯表單（`editOpen` state）本來就有明確的開/關生命週期——這點原本 `presence.ts` 的說明文件寫「索引牆的編輯是即時單次 PATCH，沒有『開著編輯視窗』這段狀態」，重新檢查後發現**這個假設是錯的**：`editOpen` 就是一段有開關的狀態，跟便利貼牆的編輯 modal 本質相同，只是 inline 不是彈窗，所以完全能套用便利貼牆同一套「開著就心跳、關掉說編完了」的機制（`useEntryEditingHeartbeat`，`hooks/useActivity.ts`）。畫面上是一顆新的 `.badge.editing`（藍色，跟既有的 `.badge.miss` 紅色区分），顯示在 `EntryRow` 的 row-head，**不需要展開這一列就看得到**（跟 missing 徽章同一個位置），SSE 的 `presence` topic 觸發時前端 `entry-presence` query 會被 invalidate（`useLiveSync.ts` 的 `TOPIC_KEYS.presence` 多加了 `['entry-presence']` 前綴，TanStack Query 的 invalidateQueries 預設前綴比對，不用列出每個 indexName 組合）。**已用兩個獨立 Playwright browser context 模擬兩個使用者實測**：A 展開一列、開編輯表單 → 心跳送出後 B 重新整理頁面看到藍色「有人 正在編輯」徽章；A 取消編輯表單 → 不到 2 秒內 B 畫面上的徽章透過 SSE 自動消失，不用手動重新整理，全程 console 無錯誤。 |
| Web 索引牆 新檔案上傳通知 | **2026-09 加**，使用者要求比照便利貼牆的到期提醒，讓索引牆的遠端上傳也能通知 Discord。`people.ts` 補回 `discordWebhook` 欄位（一開始搬便利貼牆那套時拿掉了，理由是「沒有到期提醒這種需要通知的概念」，現在遠端上傳算是對稱的情境）。**跟便利貼牆的關鍵差異**：到期提醒的通知對象是便利貼的 `assignee`（一對一），但上傳檔案沒有「指派給誰」，所以 `GET /host/upload-notifications`（`host-routes.ts`）是**廣播**——每一筆上傳事件對每一個設過 webhook 的人各出現一次（`{at, indexName, title, count?, author, to, webhook}`，`to` 是通知對象名字，純顯示用）。資料來源是 `activity.ts` 的純記憶體活動記錄，新增 `viaUpload?: boolean` 旗標（`ActivityEntry` 上）——`upload-routes.ts` 的兩支 `logActivity()` 呼叫都設成 `true`，藉此跟本機手動「加入索引」（同樣是 `action:'create'`／`'bulk-add'`）區分開來，篩出「真正的上傳事件」；兩種來源在「動態」列表的顯示文字完全相同，這個旗標只有這支新端點在用。端點本身無狀態（沒有設過 webhook 時直接回空陣列），要不要發、要不要 dedupe 全部交給 Node-RED 自己的 flow-context（跟 `due-webhooks` 同一套模式，見上面「Web 便利貼牆 後台」列）。`HostPanel.tsx` 的「身分保護」區塊比照便利貼牆補上每人一格 Discord webhook 輸入框（`POST /host/people/:name/webhook`，失焦存檔、留空清除、格式檢查跟便利貼牆共用同一個 `DISCORD_WEBHOOK_PATTERN`）。**受限於活動記錄本身是純記憶體、最多留 300 筆**，這支端點的可靠度跟 `due-webhooks`（每次都從持久資料重新算）不同等級——正常使用量下 300 筆綽綽有餘，但如果兩次 Node-RED 輪詢之間湧入超過 300 筆其他活動，舊的上傳事件會被擠出緩衝區，這是刻意接受的簡化（不想為了這支通知另外做一份持久化紀錄），已在程式碼註解點明。 |
| Web 索引牆 上方面板收合（手機） | **2026-09 加**，使用者要求「比照便利貼牆的手機摺疊功能」——直接搬便利貼牆已經定案的最終版設計（見上面「Web 便利貼牆 上方面板收合（手機）」那列），不是重新設計一套：收合範圍是**整塊上方面板**（標題/簡介/動態面板 ＋ 工具列全部三排：索引集選擇/檢視切換/動態按鈕、加入索引等操作鈕列、搜尋/篩選/分組/排序），不是只收小按鈕。狀態放在 `App.tsx` 的 `panelCollapsed`（`<header className="hero">` 在這裡、`Toolbar.tsx` 是不同元件，要共用收合狀態就得放在共同的父層），透過 `collapsed`/`onToggleCollapsed` props 傳給 `Toolbar`；持久化在新檔 `src/lib/panelCollapse.ts`（key 用 `index-wall-panel-collapsed`，跟便利貼牆的 `sticky-wall-panel-collapsed` 分開——两個是不同 origin/port 的網頁本來就不會共用 localStorage，用不同名字純粹清楚）。實作跟便利貼牆一樣是**兩個獨立的 grid 容器共用同一個布林值**：`App.tsx` 的 `.hero-collapse`（包整個 `<header className="hero">`，含 `<ActivityTicker />`）跟 `Toolbar.tsx` 的 `.panel-collapse`（包 `bar-row.top`／`bar-row.acts`／依 `view` 顯示的搜尋篩選列，三排全部）各自用 `grid-template-rows: 1fr` ↔ `0fr` 做展開/收合動畫（`index.css` 的 `.panel-collapse`／`.hero-collapse`／`.panel-collapse-handle` 規則，跟便利貼牆同名同寫法，各自一份不共用檔案）。**跟便利貼牆的差異**：便利貼牆收合後 `<TagBar>`（標籤篩選列）留在收合區塊外面、永遠看得到；索引牆沒有對應的「永遠看得到的篩選列」元件（分類／資料夾篩選是下拉選單、混在會收合的搜尋列裡），所以這裡收合後只剩分界列（`.panel-collapse-handle`）＋項目清單本身，沒有中間層。**已用隔離測試 server + 瀏覽器實測**：點「收合」後標題／工具列整塊消失、只留一條「展開」分界列，項目清單完整可見；點「展開」正確還原完整面板，`tsc --noEmit`／`oxlint`／`vite build` 全部通過。 |
| Web 多人牆閘道（share-gateway） | **2026-09 加**，使用者要求「索引md牆與便利貼牆同時存在於多人連線系統中，提供一個按鈕切換，保留所有功能」，並在規劃階段明確選了「共用一份登入／一個網址」（而不是兩邊各自獨立、切換只是導到另一個網址那種較低風險的做法）。新增 `file_search/share-gateway/`（`index.mjs` 閘道本體 + `serve.mjs` 統一啟動器）跟 `啟動-多人牆（區網＋公網）.bat`，三者**完全平行於**既有的兩支獨立共用啟動器，不改動也不影響它們。**設計上排除掉的做法**：(1) 把兩個 app 合併成一個 codebase——工作量最大風險最高，且違反兩者刻意「共用技術棧、不共用程式碼」的分流設計；(2) 依路徑分流的反向代理（`/notes/*`／`/files/*`，兩邊前端加 Vite `base`）——兩邊前端有大量寫死的 root-relative 路徑（`api.ts`/`ai.ts`/`files.ts` 各自的 `BASE='/api'`、`useShareInfo.ts`／`useLiveSync.ts` 直接 `fetch('/api/...')`、`main.tsx` 的 `/wall`／`/card`／`/host` 路徑判斷、圖片靜態路由），要全部加前綴才能同 origin 分流，範圍大、任何一處漏改就會在特定功能上出問題，型別系統也擋不住遺漏，不採用。**採用的做法**：閘道讀一個 `active_wall` cookie（`notes`｜`files`）決定把整個請求原封不動轉給哪個後端（`req.pipe(proxyReq)`／`proxyRes.pipe(res)`，純 `node:http`，零額外套件），兩邊後端完全不用改任何現有路徑邏輯——它們看到的請求路徑跟今天一模一樣。切換牆＝閘道自己的 `GET/POST /switch-wall?to=notes\|files` 端點（不轉發，自己處理）設一下 cookie 再 302 導回 `/wall`。**已知取捨**：`active_wall` cookie 是整個瀏覽器共用，不分頁籤——同一個瀏覽器同時開兩個分頁想一邊看便利貼一邊看索引會互相影響（切換是整個瀏覽器一起換）。多數情境（不同人各自用自己的瀏覽器）不受影響。**核心技術問題：loopback 判斷失真**——兩邊後端的 `share.ts` 原本靠 `isLoopback(req)`（`x-forwarded-for` 有沒有出現）判斷「這是不是主機本人」，`/host`、`/open`、`/browse`、`/scan` 等危險端點、前端 `isRemoteShare` 收斂都靠這個；加了「所有流量都先經過」的閘道之後，後端收到的連線來源永遠是閘道自己（同機 127.0.0.1），原本靠 socket 位址分辨「主機本人 vs. 區網／公網」的方式會完全失真。**解法**：閘道自己在「第一手」連線上判斷一次（三種情況：①已帶 `x-forwarded-for`＝ngrok 轉發進來的，判非本機，原樣轉發標頭；②沒帶但 socket 不是 127.0.0.1＝區網對等直接連到閘道，判非本機，幫它補一個 `x-forwarded-for`；③socket 就是 127.0.0.1 且沒有既有標頭＝主機本人的本機瀏覽器，判本機，不加任何標頭），用一個新的、帶密鑰的 `x-gateway-loopback` 標頭（值＝`GATEWAY_SECRET` 或 `not:`+密鑰）明講給後端聽。兩邊 `isLoopback()`（`notes-web/server/share.ts`、`files-web/server/share.ts`）都加了一段：先看這個標頭跟密鑰對不對得上，對得上就直接採用；標頭沒帶或密鑰對不上（沒有經過這支閘道的獨立啟動器）才照舊看 `x-forwarded-for`／socket 位址——舊行為完全不變，新增的只是多一條可信路徑。`GATEWAY_SECRET` 是統一啟動器每次啟動用 PowerShell `[guid]::NewGuid()` 產生的一次性密鑰，同時傳給閘道和兩支後端。**共用登入／身分**：`serve.mjs` 把兩支後端的資料資料夾都指到同一個新資料夾 `public-share-data/`（notes-web 用 `STICKY_NOTES_FILE=.../public-share-data/.sticky_notes.json`，files-web 用 `INDEX_DIR=.../public-share-data`），兩邊算出來的 `.share/` 剛好落在同一個目錄，`.share/people.json`／`.share/visits.json` 自動變成同一份檔案——已確認兩邊 `PersonRecord` 形狀相容（`{pinHash, createdAt, role?}`，notes-web 多一個可選的 `discordWebhook?`，互相讀取不會炸）。兩邊 `SHARE_TOKEN` 也設成同一組密碼，`identity_session`／`share_session` cookie 因此直接互通。**Port 配置**：兩支獨立共用啟動器維持 8790（notes-web）／8791（files-web）不變；這兩支後端在閘道底下改綁 `127.0.0.1` 的內部 port 8792／8793（files-web 靠新環境變數 `SHARE_BEHIND_GATEWAY=1` 觸發，`server/index.ts` 的 host 判斷從 `SHARE_MODE==='lan' ? '0.0.0.0' : '127.0.0.1'` 改成同時檢查這個旗標；notes-web 本來就有 `API_HOST` 覆寫可以直接用，不用改 host 判斷邏輯，但為了讓它也抑制下面提到的誤導性 banner，一樣設了這個旗標）；閘道自己的對外 port 是全新的 8794，三種啟動方式因此能同時開著、互不搶 port。**踩過的坑（banner 誤導）**：兩支後端原本不管是不是在閘道底下，只要 `SHARE_MODE==='lan'` 就會印「區網：http://<LAN IP>:PORT/wall」——但閘道底下這兩支後端其實綁的是 127.0.0.1，那個網址根本連不進來，只會讓使用者在同一個主控台視窗裡看到三組網址、不知道該用哪個。修法：`SHARE_BEHIND_GATEWAY==='1'` 時兩邊都改印一行「共用模式（lan，閘道模式）：只接受來自閘道的連線」，不印誤導的 LAN 網址，只有閘道自己印出的網址是給使用者用的那個。前端：`useShareInfo.ts`（兩邊）的 `ShareInfo` 型別加 `otherWall?: {label, switchUrl}`，由 `shareInfoPayload()` 讀 `OTHER_WALL_LABEL`／`OTHER_WALL_SWITCH_URL` 這兩個統一啟動器才會設的環境變數填入；新增 `SwitchWallButton.tsx`（兩邊各一份，內容幾乎一樣，只是各自 import 自己的 `useShareInfo`）掛在工具列，`useShareInfo().otherWall` 沒值就整個不渲染（獨立啟動器完全不受影響）。**已用完整隔離測試環境驗證**（兩支後端 + 閘道，全部用非預設 port，共用一份測試資料夾）：閘道預設路由到 notes、`/switch-wall?to=files` 正確切到 files-web、切回來正確切回 notes-web；在閘道本機（loopback）存取 `/host`（兩邊）都拿到完整內容（200）；用 `X-Forwarded-For` 模擬 ngrok 遠端存取閘道，`/host` 正確 401/403（未登入時 401、登入後仍 403，因為 `/host` 永遠只認 loopback）；**用機器真正的 LAN IP 直接連閘道**（真正的非 loopback socket、沒帶 XFF）驗證第②種情況——`loopback:false`、`/host` 正確擋下；**核心需求驗證**：用其中一面牆登入（openAccess，名字＋PIN）後切到另一面牆，`GET /api/session` 直接顯示已登入、不用重新輸入；SSE（`/api/events`）透過閘道兩面牆都正常收到 `topics` 推播；files-web 的 multipart 檔案上傳透過閘道正常寫入且索引集正確多一筆。**Playwright 開瀏覽器實測**：點工具列「切換到索引牆」鈕，畫面正確從「便利貼牆」換成「索引牆」（同一個網址 `http://<gateway>/wall`，`<title>` 也跟著換），按鈕文字同步變成「切換到便利貼牆」；files-web 那面牆的「動態」欄正確顯示稍早用模擬遠端身分（`sharedUser`）新增的索引集與上傳的檔案，證明活動記錄／身分系統在兩面牆之間確實共用同一份。全程 console 無錯誤。**唯一沒有自動化測試到的部分**：`.bat` 本身的互動式提示（要不要開公網、輸入共用密碼）——受限於這個工具鏈對「全形括號檔名＋巢狀 stdin/stdout 轉接」的組合處理得不好，沒能跑通全自動化的互動測試；但 `.bat` 的密碼/公網提示邏輯是逐字複製自既有已經在用的 `啟動-便利貼牆（區網＋公網）.bat`，唯一真正新增的技巧（用 PowerShell `[guid]::NewGuid()` 產生 `GATEWAY_SECRET`）已經用一支獨立測試 `.bat` 直接驗證過可以正常運作。建議使用者實際雙擊 `啟動-多人牆（區網＋公網）.bat` 跑一次確認互動流程順暢。**修過一個真實 bug**：`serve.mjs` 解析到 ngrok 公網網址後，一開始只拿去印自己的 console 橫幅，忘了轉發給 `notesEnv`／`filesEnv` 這兩個子行程——兩邊 `share.ts` 的 `SHARE_WALL_URL`（分享鈕/QR 出不出現的判斷依據）是從 `SHARE_PUBLIC_URL` 環境變數算的，沒收到這個變數就永遠是空字串，導致**閘道模式下開了公網、兩邊分享鈕卻都不會出現**（獨立啟動器沒這問題，因為各自的 `share-serve.mjs` 本來就會把這個環境變數傳給自己唯一的那支後端）。已修：兩邊 `env` 都補上 `SHARE_PUBLIC_URL: publicUrl`。**修過另一個真實 bug（更嚴重）**：`OTHER_WALL_SWITCH_URL` 一開始寫死 `http://127.0.0.1:${GATEWAY_PORT}/switch-wall?to=...`——主機本人點沒事（他自己就是 127.0.0.1），但**遠端使用者（區網／公網）點下去，瀏覽器會去連他們自己電腦的 127.0.0.1:8794**，連不到東西，整個頁面掛掉（使用者回報「遠端玩家切換到索引牆會丟失頁面」）。已修：改成相對路徑 `/switch-wall?to=files`／`/switch-wall?to=notes`，瀏覽器一律照「目前網址列的 origin」解析，主機本人／區網／公網三種情境都對。**這是原始設計就有的 bug，不是後來哪次改動introduce 的**——當初驗證階段的 Playwright 測試是從閘道所在的同一台機器開瀏覽器點按鈕，跟主機本人的 loopback 情境一樣會恰好連得到 127.0.0.1，沒有真正模擬「瀏覽器在另一台機器上」這件事，所以沒測出來；遠端相關的驗證當時做的是 HTTP 層級模擬（`X-Forwarded-For`）打 API，不是「真的從另一個origin 點這個連結」。**教訓**：這類「連結網址要用絕對還是相對」的 bug，用同機模擬（不管是不是加了 XFF 標頭）測不出來，要嘛真的跨機器測，要嘛至少檢查回傳的 URL 字串本身有沒有寫死 host。**合併在線名單**（2026-09 加，使用者要求「連線與斷線也共用」，追問確認要的是「在線人數/是誰在線」這個即時狀態真的合併，不只是動態記錄裡看得到歷史）：兩邊 `connections.ts` 新增 `listOnline()`（`online` Map 裡 `count>0` 且非 `anon:` 開頭的 key 直接當名字回傳，因為具名使用者的 key 本來就等於 `identityKey()` 算出來的 author 本人）、`activity-routes.ts` 補 `GET /online`；閘道新增 `GET /combined-online`（跟 `handleCombinedActivity` 同一套轉發 cookie／loopback 信任標頭、部分失敗容忍的模式，這裡改用 `Set` 去重＋排序）。兩邊 `ActivityDialog.tsx` 同時把「合併動態」從核取方塊**改成閘道模式下預設開**（使用者原話「乾脆統一顯示」），並在清單上方加一行「目前在線」。**修過一個過程中自己測出來的真實 bug（而且第一次修還修出另一個更嚴重的迴歸，也一併記錄）**：一開始測試發現透過閘道連線的人，瀏覽器分頁關掉之後 `combined-online` 永遠還是顯示他在線、`disconnect` 活動記錄也不會出現——原因是 `index.mjs` 的 `proxy()` 從來沒有把「客戶端斷線」這個訊號轉發給後端：對一般短請求沒差（本來就會正常結束），但對 `/api/events`（SSE，長連線）這種請求，瀏覽器分頁關掉只是切斷了瀏覽器↔閘道那一段，閘道↔後端那段的 `proxyReq` 完全不知道，會一直掛著，後端因此永遠不會觸發 `connections.ts` 的斷線計數。**第一次修法（錯的）**：加了 `req.on('close', () => proxyReq.destroy())`——結果連 `POST /api/session` 這種一般短請求登入都變成 502 `socket hang up`，因為 server 端的 `req`（IncomingMessage）在請求正常處理完、回應也送完之後一樣會發出 `close`，不是只有「客戶端提早斷線」才觸發；每個正常請求都在回應送完的瞬間被自己搶先 `destroy()` 掉還沒收尾的 `proxyReq`。**正確修法**：改掛在 `res`（要送回客戶端的 ServerResponse）的 `close` 事件上，且只在 `!res.writableEnded`（回應都還沒寫完就先收到 close＝不正常提早結束）時才動手；正常請求走到 `res` 的 `close` 時 `writableEnded` 早就是 `true`，不會誤觸發。**已用隔離環境完整驗證**：連續 3 個一般短請求全部 200（不再誤觸發）、開 SSE 後 `combined-online` 正確顯示、真的終止客戶端行程（**注意**：Git Bash 背景工作的 `kill` 對它自己 spawn 出來的原生 Windows 執行檔常常殺不掉底層行程，得用 `Get-Process`／`Stop-Process` 或工作管理員確認真的死了，這裡就因為這個坑一開始誤判成「還是修不好」，見 `process-kill-safety` 這條記憶的同一個教訓）＋等過 5 秒斷線寬限期後，`combined-online` 正確變空、活動記錄正確出現配對的 `connect`／`disconnect`。獨立啟動器（沒有這層代理）完全不受影響——斷線本來就是瀏覽器直接跟後端的 socket 斷，沒有中間這層要顧。**切牆造成的斷線/連線合併成中性事件**（同一次會話，使用者接著反映「切牆時動態顯示斷線」，經測試確認是正確、對稱的行為——切牆本身就是真的斷開舊那面牆的 SSE——但使用者指出「有些人看便利貼、有些人看索引牆，彼此不知道對方狀態」的情境下，這種切牆雜訊會跟「真的有人離開/加入」混在一起分不出來）：`index.mjs` 新增 `collapseWallSwitches()`，在 `handleCombinedActivity()` 排序前跑一次——貪婪配對「同一個具名 `author`、不同 `wall`、相反的 `connect`/`disconnect`、時間差在 `WALL_SWITCH_WINDOW_MS`（使用者定 5 秒）內」的事件對，合併成一則 `action:'switch-wall'`（`fromWall`／`toWall`／`wall`＝`toWall`），配不到對的維持原樣。**只處理具名使用者**（`author` 非空字串，含「開發者」）——完全匿名的訪客共用同一個 `''` author，跨牆配對會把兩個不同的匿名訪客誤判成同一人切牆，因此排除。兩邊 `CombinedActivityEntry` 型別加 `fromWall`／`toWall`（只有這個 action 才有值），`ActivityDialog.tsx` 認得這個 action 就顯示「XXX 切去了 OO 牆」，不用自己做配對邏輯。**已用隔離環境驗證**：切牆情境正確合併成一則、時間視窗內只出現一次；真的斷線不重連（沒有配對）依然正常顯示「已斷線」且 `combined-online` 正確變空——兩種情況不會混淆。**合併動態也要顯示在標題右側常駐面板**（同一次使用者要求「除了動態歷史紀錄外，我要真正顯示在即時的動態面板上（標題右方）」——一開始只有 `ActivityDialog.tsx`（工具列按鈕開的完整歷史清單）做了合併，`ActivityTicker.tsx`（`.hero`／標題旁邊常駐、不用點開就看得到的那塊）還是只打自己這面牆的 `useActivity()`）：`otherWall` 有值就改叫 `useCombinedActivity()`，跟 Dialog 同一份資料源。**順手把兩邊 Dialog／Ticker 各自複製一份動詞/圖示字典的技術債一起修了**——files-web 原本已經抽出 `lib/activityLabels.ts`，這次把 `verbOf`／`isNoTarget`／`WALL_LABEL` 也一併移進去、加一個 `iconOfActivity()`（處理 `switch-wall` 用 `ArrowLeftRight` 圖示），兩個元件都改成從這裡 import；notes-web 原本兩個元件各自一份（見 `NOTES_ACTIVITY_VERB` 那條記錄提過的已知技術債），這次新增 `notes-web/src/lib/activityLabels.ts` 比照抽出來，順便把 Ticker 原本「只有 `bulk-delete` 才顯示筆數」的寫法改成通用「有 `count` 就顯示」（跟 Dialog、files-web 一致，`bulk-add` 這種來自對方牆的動作才不會漏顯示數量）。**已實際開瀏覽器驗證**：切牆後標題右側面板正確顯示帶圖示的「開發者 切去了便利貼牆」一行，跟同一份資料源的歷史對話框一致；由於合併資料只有「自己這面牆有新動態」才會觸發即時重抓（見上面「合併在線名單」的說明），切牆當下那零點幾秒可能還看不到剛產生的合併結果，等下一次任一牆有新動態（或重新整理）就會補上，這是既有架構限制下的合理現象，不是這次沒做好。**桌面捷徑**：`share-gateway/make-shortcut.ps1`（機制搬自 `wallpaper-app/make-shortcut.ps1`，圖示來源 `share-gateway/assets/shortcut-icon.jpg`）由 `啟動-多人牆（區網＋公網）.bat` 每次啟動時呼叫，桌面產生「多人牆（索引+便利貼合一）.lnk」，永遠指向這支 `.bat` 目前的實際位置。**合併動態**（2026-09 加，使用者要求「共用身分了，動態能不能不切牆就看得到全貌」）：`GET /combined-activity?limit=`（`index.mjs` 的 `handleCombinedActivity()`）是閘道自己處理的第三支端點（跟 `/switch-wall` 同一類，不轉發），並行打兩支後端各自的 `/api/activity`（轉發原始請求的 `cookie` 讓各自的 `shareAuthHook` 照舊驗證，跟直接打這支 API 走同一套規則），每筆結果標上 `wall:'notes'|'files'` 再依 `at` 合併排序、裁到 `limit`；**部分失敗容忍**——只要有一邊拿得到資料就照樣回，只有兩邊都失敗才回錯（401 或 502）。兩邊前端各自的 `useCombinedActivity()`（`hooks/useActivity.ts`）不走 `lib/api.ts` 的 `BASE='/api'` 前綴，直接打閘道根路徑；`otherWall` 沒值（獨立啟動器）時 `enabled:false`，完全不會打出一支 404。`ActivityDialog.tsx`（兩邊都改）多一個「同時顯示 XX 的動態」核取方塊，勾了才切換成合併資料源；渲染合併回來的項目要看 `wall` 欄位挑對的動詞字典——**兩邊各自把對方的動作字典抄一份小的過來**（files-web 的 `activityLabels.ts` 多出 `NOTES_ACTIVITY_VERB`；notes-web 的 `ActivityDialog.tsx` 內聯多出 `FILES_VERB`），沒有抽成共用檔案，跟這整個專案「共用技術棧、不共用程式碼」的分流慣例一致。 |

## Web 按鈕視覺（notes-web／files-web 共用慣例）

**2026-09 改**：使用者反映兩邊網頁版的 `.btn`（跟 files-web 的 `.toggle`）原本
「框線明顯、正正方方」（notes-web 是 `border-radius: 2px` + 1px 實線邊框，
files-web 已經是 8px 圓角但一樣有邊框），選了「圓臉/pill」方向定案：兩邊都
改成 `border-radius: 999px`、`border: none`，互動回饋從「邊框變色」改成
「底色塊 + hover 時的淡色調（`color-mix`）」。這兩邊的 CSS **各自一份、沒有
共用檔案**（跟其他前端程式碼一樣的分流慣例），改的時候要兩邊都找：
notes-web `src/index.css` 的 `.btn`／`.btn.ghost`／`.btn.danger` 及其在
`.sheet`／`.bd-list`（便利貼紙張背景、深色模式文字要用紙上的深色）裡的
override；files-web `src/index.css` 的 `.btn`／`.btn.primary`／`.btn.danger`
／`.toggle`（分享鈕、切換牆鈕、主題切換、「動態」鈕都是 `.toggle`，跟
`.btn` 视觉上要一致，一起改了）。**刻意沒有動的部分**：`.chip`（時間快捷
鍵、標籤篩選）、`.reaction-btn`、`.coll-tab`（生活/研究生分頁）、
`.ap-logout-btn` 這些不是一般「功能按鈕」，是各自獨立的 UI 慣例（前兩者
本來就已經是 pill），沒有被使用者點名、也怕動了破壞既有視覺語言。已用
Playwright 開瀏覽器兩邊各截圖驗證：對話框裡的 primary/ghost 按鈕組
（例如 files-web「AI 設定」的 測試連線/取消/儲存、notes-web「新增便利貼」
的 新增/取消）都正確變成圓臉形、無邊框，ghost 的 hover 淡色回饋也正常。

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
