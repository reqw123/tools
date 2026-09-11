# 便利貼牆 · notes-web

`file_search_app` 便利貼功能的網頁版。**預設直接讀寫桌面版的
`../indexes/.sticky_notes.json`**——網頁和 Tkinter 桌面版共用同一份資料，
在網頁上新增／編輯／刪除，桌面版重新整理（或重開便利貼面板）就看得到，反之亦然。
這是**個人用途**的預設行為（`npm run dev`、wallpaper-app 的桌面透明板都吃這個）。

⚠️ **多人共用的公用牆是例外**——`啟動-共用便利貼牆（區網）.bat`／
`啟動-便利貼牆（區網＋公網）.bat` 這兩個啟動器會把資料改指到獨立的
`public-wall-data/`，**不會**碰到上面這份個人資料，port 也換成 8790（跟
wallpaper-app 固定的 8787 分開，兩者能同時開）。細節見「區網共用模式」。

前端用 TanStack Query：任何異動成功就讓清單重抓，整面牆、分類 chip、統計數字自動跟著變。

**AI 搜尋**（用一般語句問「有哪些跟○○有關」「○○有幾個」「目前有哪些分類」）走
`server/ai_bridge.py` 子行程，直接呼叫 file_search_app 既有的 `StickyNoteService`
（組 prompt／解析回應）與 `AIDescriptionService`（Provider 連線／記帳）——**沒有重寫任何
AI 邏輯**。AI 設定（Provider、API Key、模型）跟桌面版共用同一份，在網頁改桌面版也生效。
設定視窗的 Ollama 區塊跟桌面版一樣：先選「就在這台電腦」還是「區網裡的另一台電腦」，
選本機時位址欄整個收起（一律用 `http://localhost:11434`）；選區網時是「`http://` [只改中間的 IP]
`:11434`」分段輸入，另有「進階」可切成完整網址（自訂埠／https）。模型欄是可編輯的下拉，
清單來自那台 Ollama 的 `/api/tags`（開視窗自動抓一次、也有「🔄 讀取清單」）。位址／模型
換算移植自 `ollama_provider.py`（`src/lib/ollamaUrl.ts`）。

**匯出**：工具列的 ⬇ 把「目前顯示的」便利貼（有套篩選／分類／AI 結果就是那個子集）匯出成
一份**獨立互動 HTML**——完整內文、依分類配色、**點卡片可跳出大張唯讀檢視**（Esc／點外面關）、
可離線開、可列印。inline CSS+JS、零相依、純前端產生（桌面版是匯出 Markdown）。

**牆面排序**（工具列，搜尋框右邊的下拉）：最新建立／最早建立／標題 A→Z／
未完成待辦最多／未完成待辦最少。**釘選的永遠排最前**（釘選內部也照同一個 key）；
選的值存在共用設定 `wall.noteSort`（`.notes_settings.json`），多人共用時會同步。
「只看快到期」時改成依到期日排、
AI／語意搜尋時改成依相關度排，其餘一律套這個。分欄檢視（沒篩選時）下，每個
分類段落／直欄的內部也照這個排。「未完成待辦」＝內文裡沒打勾的清單行（`parseBody`
把每個非填空欄的行都當一個方框，沒有 `[x]` 就算未完成——跟牆上看到的空框一致）。

**待辦勾記與完成章**（`Body.tsx` / `Note.tsx` / `format.ts` 的 `todoProgress`）：多行
內文的每一行都畫一個 14px 方框、可點切換 `[x]`；打勾的方框填**鮮綠**（`#16a34a`）並用
兩條白邊框畫出勾記。整則便利貼若是「待辦清單」（`todoProgress` 非 null＝內文 ≥2 行且
至少一行是待辦不是填空欄），卡片**右上角**蓋一枚章：**全部勾完 → 綠色 ✓**，
**還有沒完成的 → 紅色 ✗**。章是絕對定位、不進版面流、不溢出卡片；`.note:has(.todo-stamp)`
時標題與釘選星號會讓出右邊空間。

**填空欄**（`format.ts` 的 `FIELD_LINE_RE`）：一行開頭是「不含空白的短標籤 + 冒號」
就當表單欄位畫填空底線（`http://` 網址、`3:30` 這種句子排除掉）。**冒號後面填了值
也一樣是欄位**、底線不會消失（舊版填字會退回當待辦）——值寫在底線上（`.fld-value`），
底線比舊版粗且加深（`.fld-fill` 2px dotted、`paper-ink 66%`）。

**到期／重複提示**在 `Note.tsx` 裡緊貼標題下方（不再排在內文後面被長內文擠到看不見）；
點開放大檢視（`.sheet`）時 `.due-badge` 隱藏，讓那個畫面專心讀內文。

**牆面排版**（全域設定 → 外觀）：欄寬、動態排版開關，以及「看全部」時同分類便利貼的
排法——**直向**（一分類一直行、由左到右，預設）或**橫向**（一分類一橫段、卡片
左到右換行、分類由上到下）。存在 `wall.tagAxis`（`settings.wall`）；有搜尋／篩選時
不受影響，一律大致等高排版。`Wall.tsx` 的 `layout()` 依 `columnPerTag` + `tagAxis`
分三種擺法，其餘（釘選列、拖曳、卡片本身）完全不變。

**便利貼歪斜效果**（全域設定 → 外觀）：預設**關閉**（每張擺正）。打開後 `Note.tsx`
依 `seedOf(title+tag)` 算 `tiltOf(seed, tiltMax)` 給每張一個固定的隨機傾斜（±`tiltMax`
度之間，膠帶反向轉）。存 `wall.tilt`（開關）＋ `wall.tiltMax`（角度，0.5–15、預設
2.5；打開歪斜後才出現滑桿）。關閉時 `rot=0`，`paperVars` 連 `--tape-rot` 也一起歸零。

**批次新增**（工具列 ⧉）：先選分類、數量（1–50）、標題前綴，一次建立 N 張同分類的空白便利貼
（`前綴 1`…`前綴 N`，時間戳相差 1ms 以維持排序）。建完之後那個分類會**記成之後單張「新增便利貼」
的預設分類**（存在 `localStorage`，分類欄仍可改）。

**批次標籤**（工具列 🏷，`BatchTagDialog`）：一顆按鈕、頂端兩個分頁——
- **補上空白的**：列出所有「沒有標籤」的便利貼（有清單、預設全勾、可增減），統一補一個標籤。
- **舊標籤 → 新標籤**：把目前是某標籤（或無標籤）的便利貼整批換成另一個標籤——只是換名字。舊標籤從一排**可點選的晶片**挑（標籤多時上面有篩選框），新標籤是 `<input list=…>`。

跟索引牆的「批次分類」對稱。

**批次刪除**（工具列 🗑）：勾選清單（可搜尋、可全選目前結果），兩段式確認後一次刪掉。前端做
樂觀更新，牆上立刻消失。

**上方面板可收合**（手機用戶需求，2026-09 加，一開始只收小按鈕列，後來使用者
反映捲動便利貼時偶爾會不小心捲回主標題/簡介，改成整塊一起收）：手機螢幕窄，
標題／簡介／統計＋集合分頁＋搜尋排序新增＋那一整排小圖示鈕全部疊在一起，
佔掉太多高度，便利貼被擠到剩沒幾張看得到，捲動時也容易不小心捲回這一大塊。
分界線固定在這整塊面板下面、「標籤篩選列」上面（一顆按鈕，`收合`／`展開`）
——收合的是**面板整塊**（標題／簡介／統計、集合分頁、搜尋排序新增、小按鈕
列），標籤篩選列、便利貼牆本身不受影響，永遠看得到、隨時可用；收合後整頁
只剩一條分界線＋標籤列，就算不小心捲到最頂端也不會看到一大塊內容。純 CSS
`grid-template-rows: 0fr/1fr` 做展開/收合動畫（`src/index.css` 的
`.hero-collapse`／`.panel-collapse`，`App.tsx` 的主標題跟 `Toolbar.tsx` 的
三排各自是獨立的 grid 容器、共用同一個布林值一起動），不用 JS 量高度。收合
狀態存 `localStorage`（`src/lib/panelCollapse.ts`）——**每個瀏覽器自己記**，
不是牆面共用設定，手機收合了不影響你在桌機看到的樣子。

## 技術棧

| 層 | 用什麼 |
|---|---|
| 前端 | Vite 8 · React 19 · TypeScript · Tailwind 4（`@tailwindcss/vite`） |
| 資料同步 | TanStack Query 5 |
| 後端 | Fastify 5 |
| 儲存 | 直接讀寫 `indexes/.sticky_notes.json`（原子寫入，保留 `panel` 欄位） |
| AI | 子行程呼叫 `server/ai_bridge.py` → file_search_app 既有服務（需要 Python，環境變數 `PYTHON` 可指定路徑）。研究生「從專案生成」讀 **PDF** 需要 `pip install pypdf`（沒裝時 PDF 會被略過，其他類型不受影響）；`.docx/.pptx/.xlsx` 純標準庫、`.doc/.ppt/.xls` 走 Windows COM |

## 開始

一次啟動便利貼版 + 索引版：**雙擊 `file_search/啟動-便利貼與索引網頁.bat`**（第一次會自動
`npm install`），或 `cd C:\tools\file_search && npm run dev`。

只跑這一個：

```bash
cd notes-web
npm install
npm run dev
```

- 前端：http://localhost:5273/wall（**主牆固定路徑是 `/wall`，根路徑 `/`
  故意什麼都不畫**——連密碼牆都不顯示，一定要走 `/wall` 才進得去，見下面
  「主牆路徑（`/wall`）」）
- 後端 API：http://localhost:8787 （Vite 把 `/api` 轉發過去）
- 沒有種子步驟——`../indexes/.sticky_notes.json` 裡現有的便利貼就是資料。
  資料檔路徑可用環境變數 `STICKY_NOTES_FILE` 覆寫。

其他指令：

```bash
npm run build   # tsc + vite build → dist/
npm start       # 正式模式：Fastify 同時吐 dist/ 與 API（單一 8787 埠）
npm run lint    # oxlint
```

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/notes` | 全部便利貼，最後動過的在前 |
| POST | `/api/notes` | `{ title, body?, tag? }` → 建立 |
| POST | `/api/notes/bulk` | `{ count（1–50）, tag?, titlePrefix? }` → 一次建立 N 張，回 `{ created: Note[] }` |
| PATCH | `/api/notes/:id` | 部分更新（會把 `created_at` 更新成現在） |
| DELETE | `/api/notes/:id` | 刪除 |
| POST | `/api/notes/bulk-delete` | `{ ids: string[] }` → 一次刪除，回 `{ deleted: 數量 }` |
| GET | `/api/tags` | `[{ tag, count }]` |
| POST | `/api/notes/:id/image` | 換插圖。JSON `{ srcPath }`＝複製本機路徑；`multipart/form-data`（`file` 欄位）＝上傳、過 sharp（EXIF 轉正、長邊 ≤2400、去中繼資料）。共用模式下遠端只能用 multipart |
| GET | `/api/share-info` | `{ mode: 'off'\|'lan', ai: bool, loopback: bool, publicUrl?: string, openAccess?: bool, loginLogo3d?: bool }`——前端判斷要不要顯示密碼牆／隱藏功能；`publicUrl` 有值＝有開 ngrok 公網通道（「分享」鈕靠這個，網址已含 `/wall`）；`ai` 是 host 在 `/host` 即時開關的結果，不是單純看環境變數；`loopback` 是**這次連線本身**是不是從主機本機進來的（跟後端 `isLoopback()` 同一個判斷），前端用它決定研究生模式／AI 生成便利貼這些「只收斂遠端」的功能要不要隱藏——不能只看 `mode`，見「公網共用模式」段落的說明。不需驗證 |
| GET | `/api/events` | SSE 長連線。`indexes/` 底下的共用檔案一變、或活動記錄／在場提示更新／host 切了 AI 開關就推 `data: {"topics":[...]}`（`notes` / `settings` / `tag-colors` / `activity` / `presence` / `card`）。前端收到就重抓對應 query，即時同步。**這條連線本身也是「誰連線／斷線」的訊號來源**，見下面「誰動了我的牆」。見「即時同步（SSE）」 |
| GET | `/api/activity` | `?limit=N` 可選。最近的新增／編輯／刪除／復原／連線／斷線記錄，新到舊 → `{ entries: ActivityEntry[] }`（`action` 多了 `connect`/`disconnect`）。純記憶體，見「誰動了我的牆」 |
| GET | `/api/presence` | 目前正在編輯中的便利貼 → `{ [noteId]: 作者名[] }`——陣列，同一則可以有好幾個人同時在編輯；''＝匿名（同則可能出現不只一個） |
| POST | `/api/presence` | `{ noteId, editing }`——編輯視窗開著時的心跳（`true`）／關閉時說編完了（`false`）。204 |
| GET | `/api/card` | 「看板」（固定網址 `/card`）目前指定哪一則 → `{ noteId, setAt }`；`noteId: null`＝還沒指定過 |
| POST | `/api/card` | `{ noteId }`——換看板內容；`noteId: null`＝清空。`noteId` 給到不存在的便利貼 → `404`。持久存檔，見「看板」 |
| GET | `/api/host/state` | 後台狀態 → `{ openAccess, aiEnabled, people: [{name, createdAt}] }`。**只認 loopback，遠端一律 403**（不管有沒有密碼、`openAccess` 開著沒有），見「後台管理」 |
| POST | `/api/host/open-access` | `{ open }`——開/關「開放模式」（跳過密碼牆）。只認 loopback |
| POST | `/api/host/ai` | `{ enabled }`——開/關遠端 AI（搜尋／生成／語意全部一起）。即時生效、SSE 推播給所有開著的牆（工具列顯示「AI 已停用」）。只認 loopback |
| DELETE | `/api/host/people/:name` | 解除某個名字的 PIN 保護（忘記 PIN 的自助解法）。只認 loopback；名字不存在 → `404` |
| GET/POST/DELETE | `/api/session` | 區網共用模式（`SHARE_MODE=lan`）才有。POST `{ password, name?, pin? }` → 種 `share_session`（＋ `name` 通過驗證時再種 `identity_session`）cookie，**都沒有 maxAge，瀏覽器關掉就失效**；`name` 非空但沒給 `pin`（新名字或已保護的名字都一樣）→ 401，`name` 已保護時 `pin` 打錯也是 401（密碼算對也一樣）。GET → `{ ok, name }`；DELETE → 登出（兩個 cookie 都清）。POST 有 IP 限速：15 分鐘內連錯 10 次（密碼錯或 PIN 錯都算）→ `429` 擋 15 分鐘 |
| GET | `/api/notes/due-soon` | 到期提醒摘要（給 Node-RED 等排程輪詢）→ `{ generated_at, overdue: DueNote[], soon: DueNote[], alarms }`，`DueNote = { id, title, tag, due_at, collection }`，`alarms = { wallpaperToast, wallpaperBadge, nodeRedAlarm, nodeRedDigest }`（四個通知管道的開關）。預設只看 `x-note-collection` 指到的那份（沒帶＝生活）；`?scope=all` 把生活＋研究生兩份合起來。`?channel=nodeRedAlarm\|nodeRedDigest`：該管道被關掉時直接回空 overdue/soon（給 Node-RED 用，下游 `return null` 即可） |
| GET/PATCH | `/api/reminder-settings` | `{ dueSoonHours, dueAlarmChannels }`。`dueSoonHours`＝到期前幾小時算「快到期」（卡片標色＋due-soon 共用）；`dueAlarmChannels`＝四個到期通知管道的獨立開關（桌面牆系統通知／系統匣角標／Node-RED 即時鬧鐘／Node-RED 6 小時彙整），關掉不影響卡片標色。PATCH 兩個欄位都可選填，`dueAlarmChannels` 可只帶要改的那幾個 key |
| GET | `/api/ai/target` | 目前 AI 去向摘要（provider／model／endpoint／是否離開本機）+ 累計呼叫次數 |
| GET | `/api/ai/settings` | 讀 AI 設定（API Key 只回 `has_key`，不回值） |
| PUT | `/api/ai/settings` | 存 AI 設定；沒帶新 `api_key` 就沿用舊的 |
| POST | `/api/ai/test` | 測連線（可帶未存檔的設定）→ `{ ok, warning, error }`。`warning` 是「連得上但模型有問題」（沒 pull、純文字模型不支援看圖）的提示字串 |
| POST | `/api/ai/models` | 那台 Ollama `/api/tags` 的已安裝模型清單（可帶未存檔的設定）→ `{ models: string[] \| null, error }`，給設定視窗的模型下拉用 |
| POST | `/api/ai/search` | `{ query, tag? }` → AI 搜尋（理解意圖、`matchedIds` 依相關程度排序）→ `{ answer, matchedIds, callCount }` |
| POST | `/api/ai/semantic-search` | `{ query, tag? }` → 本機 embedding 語意搜尋 → `{ ok, results: [{id, score}], model, error, embedded, total, top_score }`。`ok:false` = Ollama 連不上／模型沒下載，前端退回關鍵字搜尋 |
| GET | `/api/ai/semantic-status` | `{ ok, model, installed, error }` — 語意搜尋可用性（給「🌱 語意」開關判斷要不要提示 `ollama pull`） |

語意搜尋要先在那台 Ollama `ollama pull bge-m3`（預設，多語言／中文好，約 1.2GB；
純英文可用 `nomic-embed-text`）。模型名稱存在「全域設定」的 `.notes_settings.json`
（`embedModel`），位址沿用 `.ai_settings.json` 的 `ollama.base_url`。向量算好會
快取在 `indexes/.sticky_notes_embeddings.json`。

AI 設定檔（`indexes/.ai_settings.json`）、用量計數（`indexes/.ai_usage.json`）、
API Key（`%LOCALAPPDATA%\file_search\ai_secrets.json`）都跟桌面版是同一份。
「檔案批次補說明」「選檔案問 AI」那些是針對檔案索引的功能，這個純便利貼的網頁沒有對應項目。

## 主牆路徑（`/wall`）

主牆固定在 `/wall`（`server/share.ts` 的 `WALL_PATH`）——**根路徑 `/` 故意
什麼都不畫**，連密碼牆都不顯示，直接是空白頁（`main.tsx` 的 `knownRoute`
判斷不認得 `/`，`App`／`AppGate` 整棵都不 render）。這跟 `/card`、`/host`
同一套「固定路徑」機制：server 端 prod 的 SPA fallback（`setNotFoundHandler`）
本來就把任何非 `/api/` 路徑吐 `index.html`，路由完全是前端 JS 決定，不用
另外掛 server 端路由。

- 區網／公網的分享網址、`.bat` 啟動器的主控台輸出、`ShareLinkButton.tsx`
  的複製連結／QR 碼、`wallpaper-app` 桌面小工具開的網址，全都已經帶
  `/wall`（`SHARE_WALL_URL = SHARE_PUBLIC_URL + WALL_PATH`）。
- `/card`、`/host` 兩個固定路徑不受影響，本來就各自獨立判斷。
- 這是刻意的模糊化——單純的根路徑很容易被誤連／被掃到，`/wall` 不是什麼
  安全機制（知道路徑的人一樣要過密碼牆），只是讓網址不那麼顯眼。

## 看板（固定網址 `/card`）

給投影機／展示螢幕用：那台裝置開著 `http://<host>:<port>/card` 就不用再碰它
（`<port>` 看你跑的是哪個實例——個人／wallpaper-app 預設 8787，公用牆啟動器
預設 8790，見「主牆路徑」段落），換內容不是改網址，是在任一則便利貼的放大
檢視按「📺 設為看板」（或再按一次「📺 移除看板」清空）——`server/card.ts`
記著「現在指定哪一則」，**持久存檔**在便利貼資料同一個資料夾底下的
`.share/card.json`（跟 activity／presence 不同，這個 server 重開也要
記得，不然展示螢幕重開一次機器畫面就空了）。

所有開著 `/card` 的畫面靠 SSE 的 `card` topic 即時換內容，不用重新整理。
`src/components/CardScreen.tsx` 重用牆上同一張 `<Note>` 卡片（樣式、待辦勾選
都一致），外層用 `transform: scale()` 整塊放大置中，深色背景——沒指定內容
時顯示「尚未指定看板內容」的提示畫面。網址判斷是路徑（`main.tsx` 檢查
`location.pathname==='/card'`），不是 `?focus=id` 那種 query string，方便當
一個固定地址記在展示裝置上；prod 模式的 SPA fallback（`index.ts` 的
`setNotFoundHandler`）本來就會把任何非 `/api/` 路徑吐 `index.html`，所以
直接訪問 `/card`（不是從牆面點進去）本來就吃得到，不用另外設路由。

跟區網共用模式一樣的認證規則——`/card` 沒有另外開後門，一樣要先過密碼牆。

## 後台管理（固定網址 `/host`）

跟 `/card` 同一套「固定路徑」機制，但反過來——**一律只認 loopback**，不管有
沒有共用密碼、`openAccess` 開著沒有：`http://localhost:<port>/host` 這樣直接在
跑 server 的這台電腦本機開。遠端開這個網址會看到「只能在主機本機開啟」，看
不到、也連不到背後的 `/api/host/*`——這裡能做的事（關掉整道密碼牆、解除別人
的身分保護）不該透過共用密碼那層就放行，所以是**額外**的一道邊界，不是密碼
牆的一部分（`server/host-routes.ts` 自己在 `onRequest` 做 `isLoopback()` 檢查，
不管全域的 `shareAuthHook`／`openAccess` 怎麼判）。

分頁標題固定是「便利貼牆-開發者設定」（`HostPanel.tsx` 掛載時設
`document.title`，離開這個路徑會還原成原本的標題），跟主牆／`/card` 的
「便利貼牆」區分開，方便分頁多開時一眼認出哪個是後台。

管五件事：

- **開放模式**（`server/share.ts` 的 `openAccess`）：開著的時候不用共用密碼
  就能進牆，但**仍然要求名字＋PIN**——`shareAuthHook`／`GET`／`POST /session`
  一樣會檢查有效的 `identity_session`，不是整關直接放行，身分驗證／防冒充
  沒有一起省掉，只是省了共用密碼那一關（見前面「簡易身分記憶與認證」）。
  **純記憶體、2026-09 改成預設開、每次重開 server 都重置回開**——想維持要
  共用密碼，開機後自己到 `/host` 關掉即可。
- **AI 開關**（`server/share.ts` 的 `isShareAiEnabled`/`setShareAiEnabled`）：
  控制遠端能不能用 AI 搜尋／AI 生成／語意搜尋——三個一起開關，不細分哪個
  花錢（語意搜尋本身不計費，但也跟著關，介面「要不要看到 AI 這排功能」單純
  一點）。切換**即時生效**、SSE 推播給所有開著的牆——關掉時工具列不是單純
  把按鈕藏起來，會改顯示灰色「AI 已停用」提示。跟 `openAccess` 不同：
  **重開 server 不會重置**，回到 `SHARE_AI` 環境變數的預設值（沿用舊行為）。
  面板同時唯讀顯示目前 AI 實際打去哪個 provider／模型（重用
  `GET /api/ai/target`）——共用牆的人問 AI，走的是**這台主機設定的
  provider**，不是固定的本機模型；這個人若設的是 OpenAI，遠端 AI 搜尋一樣
  會把問題內容送到 OpenAI（雲端），語意搜尋則永遠是本機 Ollama、不出這台機器。
- **AI provider**（要打 OpenAI 還是本機／區網 Ollama）：跟上面的 AI 開關是
  兩件事——開關決定「准不准打」，這個決定「打去哪」。單選鈕直接切，重用
  既有的 `PUT /api/ai/settings`（跟牆面「⚙️ 全域設定 → AI」共用同一份
  `.ai_settings.json`），但**只送 `provider` 欄位**，`model`／`base_url`／
  `api_key` 照抄目前設定原封不動——server 端 `cmd_settings_set`
  （`ai_bridge.py`）本來就是「沒帶到的欄位沿用舊值」的合併邏輯，這裡只是
  刻意只帶 provider，不去動其他欄位。要調 API Key／模型／連線位址（例如
  換一台區網 Ollama）還是得去牆面的全域設定，這裡只做「換條路走」。
- **身分保護**：列出目前被 PIN 保護的名字（`GET /api/host/state` 的
  `people`，只有名字＋建立時間，不含 PIN）；有人忘記 PIN，按「解除保護」
  （`DELETE /api/host/people/:name`）就從 `.share/people.json` 刪掉那筆
  ——名字回到沒設過 PIN 的狀態，不用再手動開檔案編輯。
- **訪客紀錄**（`server/visits.ts`）：誰、什麼時候連上這面牆，**持久化**存檔
  （跟前面幾項純記憶體不同），文字視窗形式（`GET /api/host/visits`，5 秒
  輪詢更新）。同一支資料也給 Node-RED 輪詢轉發 Discord（見「公網對外開放」
  附近或 Downloads 那份「多人牆flow.json」新增的「多人牆訪客通知」分頁）。

`src/components/HostPanel.tsx` 是頁面殼，`api.ts` 的 `host` namespace 是五支
呼叫（`getState` / `setOpenAccess` / `setAiEnabled` / `releasePerson` /
`getVisits`），AI provider 切換則直接重用既有的 `hooks/useAi.ts`
（`useAiSettings` / `useSaveAiSettings`），沒有另外開 host 專用的 API。

## 資料模型

跟桌面版的 `StickyNote` 完全一致——`id / title / body / tag / created_at`，
**沒有** `updated_at`。「編輯視同重新建立」：每次編輯都把 `created_at` 設成現在，
所以清單依它由新到舊排時，剛動過的便利貼會浮到最上面。（編輯視窗若「沒有任何改動」
就直接關掉、不打 API——不會平白把便利貼推到最上面、也不會通知其他人。）

`PATCH /api/notes/:id` 收部分欄位，`updateNote` 逐欄 merge（帶到的才覆寫，沒帶的
沿用檔案裡的現值）。編輯視窗（`NoteForm`）只送改過的欄位，就是靠這個讓多人改
同一則的不同欄位時不會互相蓋。

分類配色是 `sticky_note_service.color_for_tag()` 的移植（`src/lib/color.ts` +
`src/lib/md5.ts`）：`md5(分類)` 當 128-bit 整數 `% 360` 取色環角度，固定
飽和度 55% / 亮度 82%，無分類用中性灰 `#e5e7eb`。

## 注意：同時開兩邊 / 多人編輯

桌面版和網頁**同時開著**、或多個網頁使用者同時用時：

- **網頁 vs 網頁**：`server/store.ts` 全同步 IO、Fastify 一次跑一個 handler，所以每個
  請求都是「讀最新 → 改 → 寫」的完整循環，**不會互相蓋**。編輯視窗更進一步——
  `NoteForm` 送出時只帶「跟開啟當下相比真的改過」的欄位，`updateNote` 逐欄 merge：
  A 改標題、B 同時改內文，兩個都留得住（改到同一欄才是 last-write-wins）。
- **編輯途中被別人動到**：SSE 推來這則變了 → 編輯視窗跳提示，可「用最新版本重填」。
- **編輯途中被別人刪掉**：不報錯，改成「按儲存＝另存成新的便利貼」，打的東西不丟。
- **桌面版 vs 網頁**：桌面版是另一個行程、編輯對話框可能開著 30 秒才存，那 30 秒內
  網頁的改動會被它整份蓋掉。這是桌面版本來就有的限制，SSE 幫不上。一次動一邊。

### 登入 session（每次連線都要密碼）

`share_session`／`identity_session` 兩個 cookie **都沒有 `maxAge`／`expires`**
（`server/share.ts`）——是純 session cookie，瀏覽器一關就失效。所以「連線」＝
瀏覽器重新開、或分頁背後那個瀏覽階段結束，下次都要重新走一次密碼牆，不是像
以前那樣登入一次記 30 天。同一個瀏覽器階段裡（沒關瀏覽器）重新整理頁面不用
重登入，這是 session cookie 本來的行為，不是漏洞。

### 簡易身分記憶與認證（`server/people.ts`）

共用模式的密碼牆多問「你的名字」＋「PIN」（`components/PasswordGate.tsx`）：

- **名字留空**＝匿名，永遠可以直接進，每次都能重新選要不要具名。
- **填了名字就一定要順便給 PIN（≥4 碼）**——2026-09 起收緊：以前名字沒填 PIN
  也能用（純顯示、誰都能借），現在**只要決定要具名，就一定要順便設 PIN 才能
  進**，設定當下這個名字就順便註冊、**保護起來**。這是使用者明確要求的：
  「使用者決定好它的名稱和 PIN 後，進入便利貼牆時就不可以任意更換名稱和
  PIN」——牆上沒有「改名字」「換 PIN」的功能，也沒有讓人不用 PIN 就借用已保護
  名字的後門（見下面）。防冒充主要靠「PIN 沒有改的路徑，只有打對／打錯」＋
  登入限速（15 分鐘錯 10 次擋 15 分鐘），不是靠拉長碼數。**PIN 忘記＝這個
  名字自己救不回來**——`PasswordGate`
  的畫面跟 server 的錯誤訊息都刻意把這個後果講清楚，只有牆主能在 `/host` 解除
  保護，沒有「忘記 PIN」的自助流程。
- **名字已經被保護**：一定要打對 PIN 才登入得進去（密碼算對也一樣擋）；PIN 錯
  也算一次登入失敗，跟密碼共用同一套限速（15 分鐘錯 10 次擋 15 分鐘）。PIN
  本身**沒有任何路徑可以被改掉**——沒有「換 PIN」的功能，PIN 只有打對／打錯兩種結果。
- 登入成功、且名字通過驗證 → server 發一張**簽章 cookie**（`identity_session`，
  HMAC 用共用密碼當金鑰，換密碼＝所有身分一起失效）。**之後每個請求的「作者」
  優先看這張 cookie**，前端傳什麼 `x-note-author` 標頭都蓋不掉——已登入的人
  沒辦法臨時把標頭改成別人的名字來冒充，這是「認證」的意義所在。
- **沒有簽章 cookie 的請求（沒登入、或還沒決定要不要具名）標頭可以隨便填**
  ——**除了已經被保護的名字**：`server/identity.ts` 的 `fromHeader()` 會先查
  `isProtectedName()`，標頭填到一個已經被保護的名字就直接當匿名，不讓沒 PIN
  的人繞過密碼牆、單純改標頭就冒用別人已經固定住的名字（這道關卡補在這裡，
  不然「填了名字要設 PIN」這條規則形同虛設——沒登入照樣能在別的地方偷填同一
  個名字）。
- **無狀態**：cookie 本身帶著簽章，server 不用另外維護一份「誰現在登入」的表，
  重開 server 不影響已經核發的 cookie。身分資料存在
  `indexes/.share/people.json`（PIN 只存 sha256 雜湊，不是明文），忘記
  PIN 就請牆主在 `/host` 解除保護（見「後台管理」），或直接開這個檔案手動刪
  掉那一筆——沒有帳號管理介面，刻意保持「簡易」。
- 已通過 PIN 驗證的名字，工具列旁動態面板／全域設定裡都會**鎖住改不了**（避免
  「明明登入是小明，卻能臨時把顯示名稱點成小華」這種認證形同虛設的漏洞），
  要換身分得先按「登出」（清掉兩個 cookie）、重新走一次密碼牆——但重新登入
  想用一個新名字，一樣得順便設一組新 PIN，原本那個名字＋PIN 不會被動到、
  還是只有它自己的 PIN 打得開。

**標頭編碼**：`x-note-author` 一定要 `encodeURIComponent`——HTTP 標頭值照 Fetch
規格只能是 ByteString（每個字元碼點 ≤ 255），中文名字不編碼會讓瀏覽器
`fetch()` 直接丟 `TypeError`；`server/identity.ts` 對應 `decodeURIComponent`。

- **活動記錄**（`server/activity.ts`）：新增／編輯／刪除／復原／批次刪除／
  **連線／斷線**會記一筆 `{author, action, title, at}`。**純記憶體、不寫檔**
  ——server 重開就清空，純粹是提示性資訊，不是稽核紀錄；換共用密碼後新的人
  也看不到舊使用者的痕跡。
  **`ActivityTicker.tsx` 常駐在牆主標題右側**（`.hero` 用 flex 分兩欄，`.hero-main`
  吃掉標題／簡介／統計數字的固定寬度，剩下的空間全給這個面板；窄螢幕自動摺到
  標題下方）——你目前顯示的名字（點一下可改，不用挖到「全域設定 → 外觀」）、
  現在有誰正在編輯（脈動圓點）、最近 12 筆動態（新增綠／編輯藍／刪除紅／復原青／
  連線綠／斷線灰 色分圖示，新的一筆會滑入＋短暫高亮），SSE 推播即時更新，不用
  點開任何對話框。工具列「📋 動態」則是完整 100 筆列表；便利貼的放大檢視 footer
  顯示這一則「最後動過：X」；垃圾桶列表顯示「X 刪除」。**桌面版的改動不會出現**
  （桌面版不打這支 API，這一套完全是網頁端獨立的）。
  - **連線／斷線**（`server/connections.ts`）：借用 `GET /api/events`（SSE）
    本身的生命週期當訊號——「開著這條連線」＝「開著這面牆」。用
    `identityKey`（具名用名字、匿名用來源 IP）做**參照計數**：同一人開好幾個
    分頁只在第一個分頁連上時記一次「已連線」，最後一個分頁關掉才記「已斷線」，
    不會每開一個分頁就洗一筆。斷線有 **5 秒寬限**——SSE 斷線重連（換頁、網路
    抖動）那種瞬斷瞬連不會被誤判成「斷線又連線」洗版。
- **在場提示**（`server/presence.ts`）：編輯視窗開著時每 5 秒送心跳
  （`POST /api/presence {noteId, editing:true}`），關掉時說「編完了」；沒心跳
  超過 12 秒自動視為編完。**同一則支援多人同時顯示**——`noteId → 編輯者集合`
  不是單一值，A、B 兩人同時編同一則會一起出現「✏️ A、B 編輯中」，不會互相蓋掉。
  具名（通過 PIN 驗證）的人用名字當 key、多開視窗自然合併成一個；**匿名**分不出
  是誰，退而求其次用來源 IP 當 key，讓不同人的匿名編輯還是分得開，不會全部擠
  成一個「有人」。牆上卡片、放大檢視、標題面板的「正在編輯」都吃這份資料。
- 兩者都靠 SSE 的 `activity` / `presence` topic 推播，跟便利貼本身同一套機制。

## 遠端護欄：AI 每日額度 + 寫入限速

`server/share.ts`，跟登入限速同一套純記憶體 sliding-window，非 loopback 才管、
一律不擋本機／`SHARE_MODE` 未開：

- **AI 每日額度**：AI 開關開著時才有意義（開關預設看 `SHARE_AI` 環境變數，
  之後可在 `/host` 即時切換，見「後台管理」）。只限 `POST /api/ai/search`
  ——真正花 host 錢／額度的那支；語意搜尋是本機 Ollama、不計費，不算進這個
  額度（但整組 AI 開關關掉時語意搜尋也一起停用）。預設每天 30 次，環境變數
  `SHARE_AI_DAILY_LIMIT` 調整。超過回 `429`。
- **寫入限速**：遠端每個非 `GET` 請求都算一次，同一 IP 一分鐘超過 120 次擋
  （`/api/session` 有自己更嚴的，不重複算）。這道很寬鬆——正常手動操作（含
  批次新增 50 則那種「一次請求」）完全撞不到，抓的是跑腳本／失控迴圈狂打
  API、把 `.sticky_notes.json` 洗爆、版本快照灌爆的情況。

讓**同一個區網的其他人用瀏覽器**連進來、共用這面公用便利貼牆（各自能新增／編輯／
刪除、上傳圖片）。**雙擊 `file_search/啟動-共用便利貼牆（區網）.bat`**——會編譯前端、
問一組共用密碼、以 `SHARE_MODE=lan` 啟動，並在 log 印出區網網址（`http://<你的IP>:8790`）
給別人連。Windows 防火牆首次會問，選「允許存取」。

⚠️ **這面公用牆有自己獨立的一份便利貼資料，跟桌面版／wallpaper-app 完全分開**
（2026-09 加）——啟動器把 `STICKY_NOTES_FILE` 改指到
`notes-web/public-wall-data/.sticky_notes.json`（不存在就從空的開始，**不會**
自動帶進你原本 `indexes/` 底下的個人便利貼），連帶 `.notes_settings.json`／
`.sticky_tag_colors.json`／`.share/`（people.json／card.json／visits.json）／
`.sticky_note_images/`／版本快照全部都在這個獨立資料夾裡（這些檔案都跟著
`STICKY_NOTES_FILE` 所在的資料夾走，見 `server/store.ts`）。同一份程式碼、
兩份完全獨立的資料，對方在公用牆新增/刪除/亂改，絕對碰不到你自己桌面透明
板上的便利貼；反過來你自己的編輯也不會出現在公用牆上。port 也刻意跟
wallpaper-app（固定 8787）分開，預設 **8790**，兩者才能同時開著。想找回舊的
「跟桌面版共用同一份」行為（例如你就是想拿這個啟動器暫時給區網的人看你自己
的真實便利貼）——執行前自己設環境變數
`set STICKY_NOTES_FILE=<file_search 路徑>\indexes\.sticky_notes.json` 蓋掉預設值即可，
但這樣遠端的人就能改到你的真資料了，一般不建議。

一切都在**你這台**：對方讀寫的是上面這份獨立資料檔、上傳的圖也在它旁邊的
`.sticky_note_images/`（不是你桌面版用的那份）。設計成一個開關，離線行為
完全不變：

| | `SHARE_MODE` 未設（預設） | `SHARE_MODE=lan` |
|---|---|---|
| 行為 | 跟以前一模一樣，不掛任何東西 | 額外掛密碼牆 + 危險端點封鎖 |
| **loopback（`127.0.0.1`）一律豁免** | — | 你自己連這個公用牆網址（本機瀏覽器）不用密碼、**功能完全不收斂**（研究生模式、AI 生成便利貼選資料夾都還在，見下面）——但看到的還是這面公用牆自己的資料，不是你桌面版的 |

`lan` 模式下，**非 loopback** 的請求：

- 要先 `POST /api/session` 帶對密碼拿到 `share_session` cookie（`SHARE_TOKEN` 環境變數，
  或 `share-config.txt` 第一行；此檔已被 `.gitignore` 排除）。沒登入 → `401 {needAuth}`，
  前端顯示密碼牆（`components/PasswordGate.tsx` / `AppGate.tsx`）。
- **關閉**：研究生牆（一律鎖生活牆）、`/api/files/browse`＋`/scan`（會攤開你的硬碟）、
  換圖的 `srcPath` 分支（改走 multipart 上傳）、`PUT /api/ai/settings`＋`/ai/test`＋`/ai/models`。
- AI 搜尋／生成／語意預設**關閉**（用你的額度／錢）——要開放設 `SHARE_AI=on`，之後可在
  `/host` 即時切換（見「後台管理」）。

前端靠 `GET /api/share-info`（不需驗證）決定要不要顯示密碼牆、隱藏哪些鈕；
同一則被多人同時改仍是 last-write-wins（跟桌面版多視窗一致）。

⚠️ **`share-info` 的 `loopback` 欄位要照這次連線實際判斷，不能只看全域
`mode`**——`App.tsx` 的 `isRemoteShare`（`= isShare && !share.loopback`）才是
「該不該收斂遠端限定功能」的正確判斷，單純的 `isShare`（`mode==='lan'`）
不夠精確。這是修過的一個真實 bug：早期版本只用 `isShare` 判斷要不要藏研究
生模式／AI 生成便利貼，沒有分本機/遠端——一開共用模式，**host 自己用
wallpaper-app 都會被自己開的共用模式鎖住研究生牆**，因為前端分不出「這是
遠端連進來的」還是「這就是本機」。後端（`collectionForRequest`／
`shareGuardHook`）從一開始就有正確的 `isLoopback()` 豁免，只有前端這層漏
了，純粹是 UI 顯示邏輯的 bug，不是安全性問題（遠端請求該擋的後端一直都
擋著）。之後任何新的「共用模式要收斂 XX 功能」邏輯，前端都要用
`isRemoteShare`，不要直接用 `isShare`。

網路相關的東西全集中在 `server/share.ts`（唯一一處），`index.ts` 只有 `lan` 時才 import。

### 即時同步（SSE）

`GET /api/events` 是一條 SSE 長連線（`server/events.ts`）。server 用 `fs.watch` 盯
`indexes/` 資料夾——**任何一份共用檔案被改**（這個 web server 寫、或 Tkinter 桌面版
寫）就推一則 `{topics:[...]}` 給所有連著的瀏覽器，前端（`hooks/useLiveSync.ts`）收到
就把對應的 query 標記過期、立刻重抓：

| 檔案 | topic | 前端重抓 |
|---|---|---|
| `.sticky_notes.json` | `notes` | 便利貼清單／垃圾桶／版本記錄（分類 chip、統計數字跟著算） |
| `.notes_settings.json` | `settings` | 全域設定（**牆面排序、欄寬、直向／橫向、歪斜**）、提醒設定 |
| `.sticky_tag_colors.json` | `tag-colors` | 標籤自訂顏色 |

延遲約 100~200ms（`server/change-bus.ts`：這個 server 自己的寫入 ~1ms 就廣播、
不必等 fs.watch；桌面版寫的靠 fs.watch，多幾百 ms）。**牆面排序（`wall.noteSort`）
現在也存在 `.notes_settings.json`**（以前是各瀏覽器的 localStorage），所以「A 換排序
→ B 的牆也跟著換」。**分類篩選、搜尋字、明暗主題仍是各看各的**（那些留在前端
state／localStorage，沒進共用設定）。

SSE 斷線時 EventSource 會自己依 `retry:` 重連；斷線期間 `useNotes` 退回 8 秒輪詢
當備援（`lib/liveSync.ts` 記連線狀態）。**重連成功時把所有同步中的 query 重抓一次**
（補上斷線期間漏掉的變動）。`<LiveSync/>` 掛在 `main.tsx` 最外層，主牆和拖出去的
懸浮便利貼視窗都涵蓋。單機（沒開共用）也照樣連 SSE——順便讓「桌面版＋網頁同時開」
也即時同步。

### 公網共用模式（ngrok）

同一個 `lan` 模式，多開一條 [ngrok](https://ngrok.com/) 隧道就能讓**不在同個 Wi-Fi
的人**也連得進來。**雙擊 `file_search/啟動-便利貼牆（區網＋公網）.bat`**，回答「Also
open to the public internet?」選 `y`——啟動器（`scripts/share-serve.mjs`）會：

1. `where ngrok` 找得到才起 `ngrok http 8790`，從 ngrok 本機 API（`127.0.0.1:4040`）
   抓公網 `https://…` 網址，用環境變數 `SHARE_PUBLIC_URL` 傳給 server。找不到 ngrok
   ／抓不到網址就**退回純區網、不擋啟動**。
2. 起同一支 Fastify server（區網 IP 和 ngrok 網址由**同一個 8790 埠**服務——跟
   wallpaper-app 的 8787 分開，兩者能同時開，見上面「區網共用模式」）。
3. 視窗關掉時一起收掉 ngrok。

「自動偵測並切換」＝ server 不分模式，靠**請求怎麼進來**判斷：ngrok（或任何反向
代理）進來的請求一定帶 `x-forwarded-for`，`isLoopback()` 看到這個標頭就**不給
loopback 豁免**（不然整條隧道繞過密碼牆）。所以區網直連、ngrok 隧道、本機 loopback
三種同時成立，各自套對的規則。

公網模式額外收緊：

- `SHARE_PUBLIC=on` 時共用密碼要 **≥ 8 字**（`assertShareConfig()`），少於就不啟動。
- `POST /api/session` 加**登入限速**：同一來源 IP 15 分鐘內連錯 10 次就擋 15 分鐘
  （純記憶體，重開 server 歸零）。
- 經 HTTPS（`x-forwarded-proto: https`）登入才發 `secure` cookie。
- 前端所有 `/api`、`/note-images` 請求帶 `ngrok-skip-browser-warning`（`main.tsx` 包
  `window.fetch`），跳過 ngrok 免費版對 XHR 的攔截頁。**首次用瀏覽器打開網址**仍會
  看到一頁 ngrok 提醒，按「Visit Site」即可（每台裝置一次）。

工具列右上多一顆「分享」鈕（`components/ShareLinkButton.tsx`）——只有 `share-info`
回了 `publicUrl` 才出現，點開跳出網址 + 複製鈕 + QR 碼（`lib/qr.ts`，
`qrcode-generator`，純前端產生不打外部服務）。`publicUrl` 已經帶 `/wall`
（`SHARE_WALL_URL`，見「主牆路徑（`/wall`）」），分享出去的網址可以直接連。

免費 ngrok 的網址每次重啟就換；要固定網址得用 ngrok 付費方案或保留 domain，
在 `ngrok config` 設好後 `scripts/share-serve.mjs` 照樣抓得到。

## 檔案

```
server/
  index.ts       Fastify 進入點（dev 只跑 API；prod 也吐 dist/）
  store.ts       讀寫 .sticky_notes.json（原子寫入、只認 5 個欄位、編輯 bump created_at）
  notes.ts       便利貼 REST 路由
  note-image-routes.ts  插圖：srcPath 複製（本機）＋ multipart 上傳（過 sharp）
  share.ts       區網／公網共用模式——密碼牆 hook、危險端點封鎖、登入限速、/api/session、
                 openAccess／AI 開關兩個 host 可即時切換的 runtime toggle、WALL_PATH（/wall）
                 （只有 SHARE_MODE=lan 用；SHARE_PUBLIC / SHARE_PUBLIC_URL 由啟動器帶入）
  events.ts      即時同步——SSE /api/events + fs.watch(indexes/)，檔案一變就推播；
                 同一條連線的生命週期也拿來記連線／斷線（見 connections.ts）
  change-bus.ts  行程內事件匯流排——store 寫完就 emitChange，events.ts 訂閱（比 fs.watch 快）
  identity.ts    這次請求算誰做的——先看 identity_session cookie（已認證），沒有才退回 x-note-author 標頭；
                 也提供 identityKey()（presence.ts／connections.ts 共用的「誰是誰」判斷）
  people.ts      簡易身分：名字＋PIN 註冊／驗證、簽章身分 cookie（HMAC，金鑰是共用密碼）
  activity.ts    活動記錄（純記憶體）——誰新增/改/刪/復原/連線/斷線了什麼
  presence.ts    在場提示（純記憶體，支援同一則多人）——誰正在編輯哪一則
  connections.ts 連線／斷線追蹤（純記憶體，參照計數＋5秒斷線寬限）——誰開著／關掉這面牆
  card.ts        「看板」（持久存檔）——固定網址 /card 目前指定哪一則
  activity-routes.ts  GET /activity、GET+POST /presence、GET+POST /card
  host-routes.ts GET /host/state、POST /host/open-access、POST /host/ai、
                 DELETE /host/people/:name（一律只認 loopback）
  ai-routes.ts   AI REST 路由
  ai.ts          子行程呼叫 ai_bridge.py 的小工具
  ai_bridge.py   ← file_search_app 的既有 AI 邏輯（stdin/stdout JSON）
scripts/
  share-serve.mjs  「區網＋公網」啟動器：偵測 ngrok → 起隧道抓公網網址 → 起 server → 收尾。
                   預設 port 8790（跟 wallpaper-app 的 8787 分開）＋預設
                   STICKY_NOTES_FILE 指到 public-wall-data/（跟桌面版分開）
public-wall-data/  公用牆自己的資料（.gitignore 排除）——啟動器預設把
                   STICKY_NOTES_FILE 指到這裡的 .sticky_notes.json，`.notes_settings.json`
                   ／標籤色／身分／看板／圖片／版本快照全部跟著長在這裡，
                   結構跟 indexes/ 一樣，純粹是換一個資料夾、完全獨立
src/
  lib/       api · ai · color（配色移植）· md5 · format · exportHtml（匯出 HTML）·
             qr（qrcode-generator → SVG，公網分享 QR）·
             noteSort（牆面排序邏輯＋未完成待辦計數；NoteSort 型別在 api.ts）·
             liveSync（SSE 連線狀態的小型外部 store）·
             identity（你的名字：localStorage 讀寫＋ x-note-author 標頭編碼）·
             scrimClose（點背景關閉，拖曳選字滑出邊界不誤關）
  lib/defaultTag.ts  批次新增選過的分類 → localStorage → 單張新增的預設分類
  lib/panelCollapse.ts  上方面板（標題/簡介/統計＋工具列三排）的收合狀態 → localStorage（手機省空間用，各瀏覽器自己記）
  hooks/     useNotes（Query + 單張三個 mutation + 批次新增／批次刪除）· useAi（target / settings / test / search）
             · useShareInfo（mode / ai / publicUrl）
             · useLiveSync / <LiveSync>（SSE → 收到就 invalidate；重連補課）
             · useActivity / usePresence / useEditingHeartbeat
             · useCard / useSetCard
  components/ Wall · Note · Body · Toolbar · TagBar · NoteDialog · NoteForm
             · ThemeToggle · ShareLinkButton（公網「分享」鈕＋QR）
             · ActivityDialog（工具列「📋 動態」完整列表）
             · ActivityTicker（牆主標題下常駐：你的名字／誰在編輯／最近動態）
             · CardScreen（固定網址 `/card`，見「看板」一節）
             · HostPanel（固定網址 `/host`，只認 loopback，見「後台管理」一節）
             · AiAnswerDialog · AiSettingsDialog
             · BatchCreateDialog · BatchTagDialog（補空白／舊→新）· BatchDeleteDialog
  index.css  Tailwind + 便利貼牆的手寫視覺（紙張、膠帶、圖釘、摺角、明暗主題）
```
