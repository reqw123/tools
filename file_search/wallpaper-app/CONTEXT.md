# 桌面牆 · wallpaper-app

把便利貼牆或檔案索引牆貼成桌面背景的 Electron 殼。全螢幕透明、frameless、最高
置頂，可在「背景模式」（滑鼠穿透，只能看）和「互動模式」（正常吃滑鼠，可以
操作卡片）之間切換。前端內容重用 `notes-web` / `files-web` 的 `dist/`
與 `server/`，不複製程式碼。

## Language

**桌面牆（wallpaper-app）**：
這個 Electron 全螢幕透明視窗本身。一次只貼一面牆（便利貼 或 檔案索引），可切換。
_Avoid_: 桌布, wallpaper, overlay, 掛件

**背景模式（Background mode）**：
滑鼠事件穿透到桌面（`setIgnoreMouseEvents(true, {forward:true})`）——桌面圖示、
其他視窗照常點得到，牆只是「看得到、點不到」。預設狀態。
_Avoid_: 穿透模式（口語可以，正式文件用「背景模式」）, ghost mode

**互動模式（Interactive mode）**：
牆正常吃滑鼠，可以點便利貼新增／編輯／刪除、捲動索引清單。跟背景模式二選一，
一個開關（`Shift+Z` / 系統匣 / 設定視窗）切換。
_Avoid_: 編輯模式, active mode

**牆面透明度（Wall opacity）**：
`--wall-opacity`（0~1），控制牆的底色／紋理蓋在桌布上的不透明度。0 = 只剩卡片，
1 = 完整牆面。由 Electron 透過網址參數 `?wall=` 帶入、之後改 CSS 變數即時更新。
_Avoid_: 不透明度以外的「透明度」講法混用（數值語意是「不透明度」）

**這面牆 / 切換牆（current wall / switch wall）**：
`settings.wall` = `'sticky'` | `'index'`。切換＝改設定 + `win.loadURL` 到另一個
server 的網址。
_Avoid_: 頁面, 分頁, tab

## 前端更新模型（重要）

`servers.js` 用 `NODE_ENV=production` spawn 兩個 web 的 server，Fastify 靠
`@fastify/static` 吐 **已 build 的 `dist/`**——**不是 dev server、沒有 HMR**。
所以 `notes-web` / `files-web` 的前端改動要 `vite build` 後才會出現在牆上。

- **`啟動-桌面便利貼牆.bat`** 每次啟動跑 `rebuild-if-stale.ps1`：比對各自的
  `src\` ＋ `index.html` ＋ vite/tsconfig/tailwind/postcss/package.json 對
  `dist\index.html` 的 mtime，**較新（或缺 `dist/`）就只重 build 那一個**。
  用桌面捷徑開就會自動同步，不用手動 `build:webs`。
- **系統匣「清除快取並重新載入」**（`main.js` `clearCacheAndReload`）只清
  Chromium cache ＋ 重啟 server 子行程，**不會 `vite build`**——它是為了讓
  `server\` / `ai_bridge.py` 的改動生效。前端改動要先自己 build（或關掉用
  捷徑重開）。
- `npm start` 直接跑（不經 `.bat`）也不會做 staleness 檢查。
