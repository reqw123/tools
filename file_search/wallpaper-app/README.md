# 桌面牆 · wallpaper-app

把 **便利貼牆**（`notes-web`）或 **檔案索引牆**（`files-web`）貼成
**桌面背景**——全螢幕透明、無邊框、最高置頂，可在兩種模式間切換：

- **背景模式**（預設）：滑鼠穿透到桌面，桌面圖示、其他視窗照常點得到，牆「看得到、點不到」。
- **互動模式**：牆正常吃滑鼠，可以新增／編輯／刪除便利貼、捲動索引清單。

做法跟 `C:\question\desktop-pet` 一致（`transparent + frame:false + skipTaskbar +
setAlwaysOnTop('screen-saver') + setIgnoreMouseEvents`）。內容重用兩個 web 專案的
`dist/` 與 `server/`，不複製前端程式碼——見
[`docs/adr/0001`](./docs/adr/0001-spawn-web-servers-as-child-processes.md)。
詞彙見 [`CONTEXT.md`](./CONTEXT.md)。

## 開始

**一般使用**：直接雙擊專案根目錄的 **`啟動-桌面便利貼牆.bat`**。第一次會自動裝
好三個專案的依賴（wallpaper-app + notes-web + files-web）、build 出兩個
web `dist/`，並在**桌面建立捷徑**（圖示取自 `wallpaper-app/assets/shortcut-icon.jpg`，
換掉那張圖再跑一次就會更新）。之後每次跑都會重建那個桌面捷徑，讓它永遠指向
`.bat` 目前的位置——換電腦或搬資料夾後，把整個 `file_search/` 複製過去、再跑一
次 `.bat` 就好，不必手動修捷徑。需要 Node.js LTS（`.bat` 會先檢查）。

**開發時**：

```bash
cd wallpaper-app
npm install
# 先把兩個 web 專案 build 出 dist/（第一次或它們改過之後）
npm run build:webs
npm start
```

啟動後：畫面出現全螢幕的便利貼牆（背景模式，滑鼠穿透），右下系統匣多一個圖示。

> `.bat` 在兩個 `dist/` 都存在時會**跳過** build。改了 `notes-web` /
> `files-web` 的前端後，刪掉它們的 `dist/` 再跑 `.bat`，或直接
> `npm run build:webs`。桌面捷徑本身（`make-shortcut.ps1`）失敗不會擋啟動。
>
> 重 build 後不用整支關掉重開：系統匣選單 → **「清除快取並重新載入」**——清掉
> Chromium 的 HTTP／code cache、重啟兩個 server 子行程（server 端的改動也生效）、
> 重載牆面與所有懸浮視窗。單純只想重載網頁用「重新載入這面牆」就好。

### 快捷鍵（全域，可自訂）

| 動作 | 預設鍵 |
|---|---|
| 切換 互動 / 背景 模式 | `Shift+Z` |
| 顯示 / 隱藏 | `Shift+X` |
| 切換 便利貼牆 ⇆ 索引牆 | `Shift+C` |
| 開 / 關設定視窗（開關式：已開就關） | `Shift+V` |

按下任一快捷鍵時，畫面正中央（略偏上）會**淡入一行提示**（例如「背景模式：
滑鼠穿透桌面」）再淡出——背景模式下牆是全透明又穿透的，切模式／切牆常常沒有
可見變化，這行字讓你確認「鍵有被收到」。提示視窗永遠不吃焦點、滑鼠一律穿透、
壓在**最上層**（`'screen-saver'` + relativeLevel 2，蓋過牆和設定視窗，全螢幕
應用也看得到），純視覺。（「開 / 關設定視窗」不顯示提示——設定視窗自己跳出來 /
收起來就是回饋；「隱藏」時也不顯示——牆本來就要消失了。）見 `hint.html` /
`main.js` 的 `showHint`。

在**設定視窗 → 快捷鍵**可以逐一改：點該動作的鍵、直接按新的組合，`Esc` 取消。
有「↺ 全部回復預設」一鍵還原。字母 / 數字 / 符號鍵要至少含一個
`Ctrl` / `Alt` / `Shift`；`F1`–`F24` 可以單獨用。

**保留鍵**——`Ctrl+C/V/X/A/Z/Y`、`Ctrl+S/P/F`、`Alt+F4`、`Alt+Tab`、
`Ctrl+Alt+Delete`、`Ctrl+Shift+Esc`、`Win+L/D/E/R` 等會蓋掉全系統功能的組合，
**一律擋下不給註冊**（`globalShortcut` 是 OS 層攔截，綁了每個 app 都沒得用）。
其他情況（格式無效 / 被別的程式佔用 / 兩個動作綁同一組鍵）也會擋下並標紅，
那個動作暫時改用系統匣選單。系統匣選單標籤會顯示目前生效的鍵、失敗標 ⚠。

> 誤綁了會卡住的鍵（例如舊版沒擋、手動改壞 `settings.json`）：設定視窗按
> **「↺ 全部回復預設」**（純滑鼠），或系統匣 → **結束**，就會 `unregisterAll` 放回去。

結束只走系統匣選單的「結束」（避免手滑關掉）。

### 設定視窗

- **這面牆** — 便利貼 / 檔案索引
- **目前模式** + **每次啟動的初始模式**
- **牆面透明度** — 0（只剩卡片）～ 1（完整牆面蓋在桌布上），即時預覽
- **快捷鍵** — 逐一自訂 + 一鍵回復預設，失敗會標紅
- **顯示在哪個螢幕** — 多螢幕時指定；那個螢幕不在了退回主螢幕
- **開機自動啟動** — `app.setLoginItemSettings`
- **設定檔位置** — `%APPDATA%\wallpaper-app\settings.json`（含 `shortcuts` 欄位）

## 架構

```
main.js            Electron 主行程：視窗、模式、系統匣、快捷鍵、設定 IPC
servers.js         spawn / 等待就緒 / kill 兩個 web server 子行程
settings-store.js  settings.json 讀寫（容錯，壞掉退回預設）
settings.html      設定視窗（vanilla，透過 settings-preload.js 的 IPC）
settings-preload.js
hint.html          快捷鍵提示視窗（畫面中央淡入淡出，透過 hint-preload.js 收 IPC）
hint-preload.js
make-shortcut.ps1  由 .bat 每次啟動時呼叫：assets/shortcut-icon.jpg → .ico、（重）建桌面捷徑
assets/            shortcut-icon.jpg（桌面捷徑圖示來源，可自行替換）
tray-icon.png
```

- **server 子行程**：`process.execPath` + `ELECTRON_RUN_AS_NODE=1` 跑
  `node --import tsx server/index.ts`（`NODE_ENV=production`），固定埠
  **8787**（便利貼）/ **8788**（索引）。不需要另外裝 node、不用先編 TS。
  關 Electron → `will-quit` → `taskkill /pid /t /f` 收乾淨。
- **桌面模式**：視窗載入 `http://127.0.0.1:<port>/?surface=desktop&wall=<0..1>`。
  兩個 web 專案的 `main.tsx` 讀到 `surface=desktop` 就在 `<html>` 掛
  `data-surface="desktop"`，`index.css` 有對應的一小段（`body` 透明化 +
  `--wall-opacity`）。一般瀏覽器開網頁不帶參數，完全不受影響。
- **固定埠的代價**：另外 `npm run dev` 開著同一個 web 專案時，這邊 server 會
  `EADDRINUSE`；`waitReady()` 逾時在終端機印錯誤。單人正常使用不會遇到。

## 打包

```bash
npm run dist    # 先 build 兩個 web dist，再 electron-builder --win portable
```

產出的 `wallpaper-app.exe` **要放在 `file_search/` 底下**（跟 `notes-web` /
`files-web` 同層），`servers.js` 才找得到它們（`path.join(__dirname, '..',
'notes-web')`）。web 專案的 `dist/` 不打進 exe——它們會自己更新。
