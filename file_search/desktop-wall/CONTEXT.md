# 桌面牆 · desktop-wall

把便利貼牆或檔案索引牆貼成桌面背景的 Electron 殼。全螢幕透明、frameless、最高
置頂，可在「背景模式」（滑鼠穿透，只能看）和「互動模式」（正常吃滑鼠，可以
操作卡片）之間切換。前端內容重用 `sticky-wall-web` / `index-wall-web` 的 `dist/`
與 `server/`，不複製程式碼。

## Language

**桌面牆（Desktop Wall）**：
這個 Electron 全螢幕透明視窗本身。一次只貼一面牆（便利貼 或 檔案索引），可切換。
_Avoid_: 桌布, wallpaper, overlay, 掛件

**背景模式（Background mode）**：
滑鼠事件穿透到桌面（`setIgnoreMouseEvents(true, {forward:true})`）——桌面圖示、
其他視窗照常點得到，牆只是「看得到、點不到」。預設狀態。
_Avoid_: 穿透模式（口語可以，正式文件用「背景模式」）, ghost mode

**互動模式（Interactive mode）**：
牆正常吃滑鼠，可以點便利貼新增／編輯／刪除、捲動索引清單。跟背景模式二選一，
一個開關（`Ctrl+Alt+W` / 系統匣 / 設定視窗）切換。
_Avoid_: 編輯模式, active mode

**牆面透明度（Wall opacity）**：
`--wall-opacity`（0~1），控制牆的底色／紋理蓋在桌布上的不透明度。0 = 只剩卡片，
1 = 完整牆面。由 Electron 透過網址參數 `?wall=` 帶入、之後改 CSS 變數即時更新。
_Avoid_: 不透明度以外的「透明度」講法混用（數值語意是「不透明度」）

**這面牆 / 切換牆（current wall / switch wall）**：
`settings.wall` = `'sticky'` | `'index'`。切換＝改設定 + `win.loadURL` 到另一個
server 的網址。
_Avoid_: 頁面, 分頁, tab
