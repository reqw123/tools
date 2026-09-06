# Electron 主行程 spawn 兩個 web server 子行程，不 in-process require

桌面牆需要 `notes-web` / `files-web` 的 Fastify 後端在跑（便利貼要讀寫
`.sticky_notes.json`、索引牆要解析 `.md` 與串流檔案）。原本規劃是把兩個後端
`require` 進 Electron 主行程直接跑（一個行程、關掉全收）。

改成 **spawn 子行程**：`servers.js` 用 `process.execPath`（＝ electron.exe）+
`ELECTRON_RUN_AS_NODE=1` 當純 node，跑各自的 `node --import tsx server/index.ts`
（`NODE_ENV=production`，固定埠 8787 / 8788），關 Electron 時 `taskkill /pid /t /f`
連整棵樹收掉。

理由：兩個後端是用 ESM + `verbatimModuleSyntax` 寫的 TS，要編成能被 `require` 的
CJS 函式庫得處理 `import.meta.dirname`、無副檔名 import、模組級路徑常數——一堆
眉角、而且會動到兩個正在正常運作的專案。spawn 子行程正是隔壁
`C:\question\control-center/process-manager.js` 已驗證的模式，同樣達到「一鍵啟動、
關掉全收乾淨」，而且**兩個 web 專案幾乎不用改**（只加了一段 `?surface=desktop`
的 CSS，是純前端、附加性質）。

代價：固定埠 8787 / 8788——如果使用者另外 `npm run dev` 開著同一個 web 專案，
桌面牆這邊的 server 子行程會 `EADDRINUSE` 起不來。`waitReady()` 逾時會在終端機
印錯誤，牆載入失敗。單人正常使用（不會同時跑 dev server 又開桌面牆）不會遇到。

`?surface=desktop` 讓 `body` 變透明、`--wall-opacity` 控制牆面蓋在桌布上的濃度——
一般瀏覽器開網頁不帶這個參數，完全不受影響，桌面模式的樣式也進版本控制看得到。
