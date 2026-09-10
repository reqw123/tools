# 便利貼牆 · notes-web

`file_search_app` 便利貼功能的網頁版。**直接讀寫桌面版的
`../indexes/.sticky_notes.json`**——網頁和 Tkinter 桌面版共用同一份資料，
在網頁上新增／編輯／刪除，桌面版重新整理（或重開便利貼面板）就看得到，反之亦然。

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
選的值記在 `localStorage`（`lib/noteSort.ts`）。「只看快到期」時改成依到期日排、
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

- 前端：http://localhost:5273
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
| GET | `/api/share-info` | `{ mode: 'off'\|'lan', ai: bool }`——前端判斷要不要顯示密碼牆／隱藏功能。不需驗證 |
| GET/POST/DELETE | `/api/session` | 區網共用模式（`SHARE_MODE=lan`）才有。POST `{ password }` → 種 `share_session` cookie；GET → `{ ok }`；DELETE → 登出 |
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

## 資料模型

跟桌面版的 `StickyNote` 完全一致——`id / title / body / tag / created_at`，
**沒有** `updated_at`。「編輯視同重新建立」：每次編輯都把 `created_at` 設成現在，
所以清單依它由新到舊排時，剛動過的便利貼會浮到最上面。

分類配色是 `sticky_note_service.color_for_tag()` 的移植（`src/lib/color.ts` +
`src/lib/md5.ts`）：`md5(分類)` 當 128-bit 整數 `% 360` 取色環角度，固定
飽和度 55% / 亮度 82%，無分類用中性灰 `#e5e7eb`。

## 注意：同時開兩邊

桌面版和網頁**同時開著**時，兩邊都是「讀整份 → 改 → 寫整份」，剛好同時存會有
「後存的蓋掉先存的」的競態——這是桌面版本來就有的限制（多開視窗也一樣）。
單人正常使用（一次動一邊）不會遇到。

## 區網共用模式（SHARE_MODE）

讓**同一個區網的其他人用瀏覽器**連進來、共用這面生活便利貼牆（各自能新增／編輯／
刪除、上傳圖片）。**雙擊 `file_search/啟動-共用便利貼牆（區網）.bat`**——會編譯前端、
問一組共用密碼、以 `SHARE_MODE=lan` 啟動，並在 log 印出區網網址（`http://<你的IP>:8787`）
給別人連。Windows 防火牆首次會問，選「允許存取」。

一切都在**你這台**：對方讀寫的是你的 `indexes/.sticky_notes.json`、上傳的圖進你的
`.sticky_note_images/`。設計成一個開關，離線行為完全不變：

| | `SHARE_MODE` 未設（預設） | `SHARE_MODE=lan` |
|---|---|---|
| 行為 | 跟以前一模一樣，不掛任何東西 | 額外掛密碼牆 + 危險端點封鎖 |
| **loopback（`127.0.0.1`）一律豁免** | — | 你自己的 wallpaper-app／本機瀏覽器不受影響、不用密碼 |

`lan` 模式下，**非 loopback** 的請求：

- 要先 `POST /api/session` 帶對密碼拿到 `share_session` cookie（`SHARE_TOKEN` 環境變數，
  或 `share-config.txt` 第一行；此檔已被 `.gitignore` 排除）。沒登入 → `401 {needAuth}`，
  前端顯示密碼牆（`components/PasswordGate.tsx` / `AppGate.tsx`）。
- **關閉**：研究生牆（一律鎖生活牆）、`/api/files/browse`＋`/scan`（會攤開你的硬碟）、
  換圖的 `srcPath` 分支（改走 multipart 上傳）、`PUT /api/ai/settings`＋`/ai/test`＋`/ai/models`。
- AI 搜尋／生成／語意預設**關閉**（用你的額度／錢）——要開放設 `SHARE_AI=on`。

前端靠 `GET /api/share-info`（不需驗證）決定要不要顯示密碼牆、隱藏哪些鈕；
多人共用時便利貼清單多一個 8 秒輪詢＋聚焦重抓（`useNotes`），好看到別人的改動；
同一則被多人同時改仍是 last-write-wins（跟桌面版多視窗一致）。

網路相關的東西全集中在 `server/share.ts`（唯一一處），`index.ts` 只有 `lan` 時才 import。

## 檔案

```
server/
  index.ts       Fastify 進入點（dev 只跑 API；prod 也吐 dist/）
  store.ts       讀寫 .sticky_notes.json（原子寫入、只認 5 個欄位、編輯 bump created_at）
  notes.ts       便利貼 REST 路由
  note-image-routes.ts  插圖：srcPath 複製（本機）＋ multipart 上傳（過 sharp）
  share.ts       區網共用模式——密碼牆 hook、危險端點封鎖、/api/session（只有 SHARE_MODE=lan 用）
  ai-routes.ts   AI REST 路由
  ai.ts          子行程呼叫 ai_bridge.py 的小工具
  ai_bridge.py   ← file_search_app 的既有 AI 邏輯（stdin/stdout JSON）
src/
  lib/       api · ai · color（配色移植）· md5 · format · exportHtml（匯出 HTML）·
             noteSort（牆面排序＋未完成待辦計數）·
             scrimClose（點背景關閉，拖曳選字滑出邊界不誤關）
  lib/defaultTag.ts  批次新增選過的分類 → localStorage → 單張新增的預設分類
  hooks/     useNotes（Query + 單張三個 mutation + 批次新增／批次刪除）· useAi（target / settings / test / search）
  components/ Wall · Note · Body · Toolbar · TagBar · NoteDialog · NoteForm
             · ThemeToggle · AiAnswerDialog · AiSettingsDialog
             · BatchCreateDialog · BatchTagDialog（補空白／舊→新）· BatchDeleteDialog
  index.css  Tailwind + 便利貼牆的手寫視覺（紙張、膠帶、圖釘、摺角、明暗主題）
```
