'use strict';
const {
  app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, screen, ipcMain, shell,
} = require('electron');
const path = require('path');
const store = require('./settings-store.js');
const servers = require('./servers.js');

// 純本機個人工具，同時開兩個沒意義（會兩邊各自管一份子行程）。
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null; // 桌面牆視窗
let settingsWin = null;
let hintWin = null; // 快捷鍵提示視窗（畫面中央淡入淡出）
let hintHideTimer = null;
let quitWin = null; // 右上角「結束程式」懸浮按鈕——獨立視窗，見 createQuitButton()
let tray = null;
let mode = 'background'; // 'background'（滑鼠穿透）| 'interactive'（可操作卡片）
// app.quit() 會把每個視窗都真的關掉一輪（觸發各自的 'closed'）才真正結束
// 行程——懸浮便利貼視窗的 'closed' 處理常式要分得出「使用者按收回」跟
// 「程式正在關閉」，不然每次結束程式都會把剛存的 pinnedNotes 又清空，
// 下次啟動等於沒存過（實測回報過的 bug）。before-quit 比 will-quit 早，
// 視窗開始關之前就會先設好這個旗標。
let appQuitting = false;
// 「拖框裁切」目前是不是啟用中——啟用時 positionWall() 要整個跳過，不然
// 螢幕解析度變動之類的事件一觸發，裁切中的小視窗會被硬拉回全螢幕。
let wallCropped = false;
// 「拖出去變懸浮視窗」——noteId -> 那則獨立開出來的 BrowserWindow。
const pinnedWindows = new Map();

// 1x1 透明 PNG——tray-icon.png 讀不到時的最後退路，至少 Tray 不會建構失敗。
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  return img.isEmpty() ? nativeImage.createFromDataURL(FALLBACK_ICON) : img;
}

// ── 目標螢幕 ──────────────────────────────────────────────────────────
function targetDisplay() {
  const { displayId } = store.read();
  const all = screen.getAllDisplays();
  if (displayId != null) {
    const found = all.find((d) => d.id === displayId);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

function positionWall() {
  if (!win) return;
  if (wallCropped) return; // 裁切檢視中，不要被螢幕變動事件打斷成全螢幕
  const { x, y, width, height } = targetDisplay().workArea;
  win.setBounds({ x, y, width, height });
}

// ── 模式（穿透 / 互動）───────────────────────────────────────────────
function applyMode() {
  if (!win) return;
  // background：滑鼠事件穿透到桌面（forward:true 讓 hover 仍能送到 renderer，
  //   跟 desktop-pet 同款）。interactive：正常吃滑鼠，可以點便利貼新增/編輯。
  win.setIgnoreMouseEvents(mode === 'background', { forward: true });
  // 兩種模式都維持最高置頂，確保牆一直看得到（點別的視窗不會被蓋掉）。
  win.setAlwaysOnTop(true, 'screen-saver');
  // 牆剛搶回最上層——如果設定視窗開著，把它再抬回牆之上，不然會被蓋掉；
  // 「結束程式」按鈕同理，它本來就該永遠浮在牆上面。
  raiseSettings();
  raiseQuitButton();
  refreshTray();
  pushSettingsState();
}

function setMode(next) {
  mode = next === 'interactive' ? 'interactive' : 'background';
  // 使用者透過任何方式（系統匣選單／全域快捷鍵／設定視窗「目前模式」）切換
  // 即時模式時，一併記成下次啟動的預設模式——不用另外再去設定視窗調「每次
  // 啟動時」那組獨立選項，目前在用的模式本來就是下次想要的模式，這是最
  // 直覺的預期行為。「每次啟動時」那組獨立控制還留著，事後想覆寫成別的
  // 啟動預設值一樣改得了。
  store.write({ startMode: mode });
  applyMode();
}

function toggleMode() {
  setMode(mode === 'background' ? 'interactive' : 'background');
}

// ── 顯示 / 隱藏 ──────────────────────────────────────────────────────
function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    if (quitWin) quitWin.hide();
  } else {
    win.show();
    if (quitWin) quitWin.show();
  }
  refreshTray();
}

// ── 切換牆 / 牆面透明度 ─────────────────────────────────────────────
function currentUrl() {
  const s = store.read();
  const url = new URL(servers.urlFor(s.wall, { wallOpacity: s.wallOpacity }));
  // 裁切選中哪幾則是便利貼牆網頁自己的 React state，重開/reload 都會沒了
  // ——上次還在裁切檢視中的話，用網址參數把選中的 id 帶回去，網頁載入時
  // 用這個初始化 croppedIds（見 notes-web 的 App.tsx）。視窗本身的
  // 尺寸/位置是 createWall() 那邊照同一份 store.read().crop 直接設定的，
  // 不用網頁再呼叫一次 cropTo。
  if (s.wall === 'sticky' && s.crop && s.crop.ids.length) {
    url.searchParams.set('crop', s.crop.ids.join(','));
  }
  // 已經拖出去變懸浮視窗的那幾則／筆——網頁的 floatedIds/floatedPaths 是它
  // 自己的 React state，重開/reload 都會歸零；restorePinnedWindows() 只把
  // 懸浮視窗還原回來，沒有人告訴主牆網頁「這幾筆已經在外面漂著了」，結果
  // 同一筆會主清單＋懸浮視窗兩邊都看得到。比照 crop，用網址參數把清單帶回
  // 去讓網頁初始化時就濾掉（見兩個 App.tsx 的 floated* 初始值）。
  // - sticky：key 就是 noteId。
  // - index：key 是 `${indexName}::${path}`，這裡只帶 path——網頁的
  //   floatedPaths 本來就只認 path（畫面一次只顯示一份索引集，跨索引集的
  //   同名 path 也本來就想一起濾掉），且 currentUrl() 這裡無從得知網頁稍後
  //   會載入哪一份索引集。路徑可能含逗號，用 JSON 陣列而不是逗號串。
  const floatedKeys =
    s.wall === 'sticky'
      ? Object.keys(store.read().pinnedNotes)
      : Object.keys(store.read().pinnedEntries).map((k) => {
          const sep = k.indexOf('::');
          return sep < 0 ? k : k.slice(sep + 2);
        });
  if (floatedKeys.length) {
    url.searchParams.set('floated', JSON.stringify(floatedKeys));
  }
  return url.toString();
}

function loadWall() {
  if (win) win.loadURL(currentUrl());
}

function switchWall(which) {
  const w = which === 'index' ? 'index' : 'sticky';
  if (store.read().wall === w) return;
  // 切牆等於整頁換掉——裁切狀態是便利貼牆網頁自己那邊的 React state，換頁
  // 就跟著沒了。但裁切這件事使用者是當成「便利貼牆自己記住的檢視設定」在
  // 用的（跟重開程式後會自動還原是同一套預期）：切去檔案索引牆只是暫時看
  // 不到、視窗要先恢復全螢幕（索引牆網頁沒有裁切/懸浮那套機制，也沒有
  // 「恢復完整畫面」按鈕，不能留著小視窗給它用），但存檔裡的裁切紀錄不能
  // 清掉；等使用者切回便利貼牆，再照存檔把裁切範圍原樣套回去——跟
  // createWall() 開機還原用的是同一份資料、同一個 clampCropToDisplay()。
  // 真的要甩掉裁切紀錄，只能靠便利貼牆自己那顆「恢復完整畫面」（會呼叫
  // wall-restore-crop，那裡才會 store.clearCrop()）。
  if (w === 'index') {
    if (wallCropped) {
      wallCropped = false;
      positionWall();
    }
  } else {
    const crop = store.read().crop;
    if (crop && crop.ids.length) {
      wallCropped = true;
      if (win) win.setBounds(clampCropToDisplay(crop));
    }
  }
  store.write({ wall: w });
  loadWall();
  raiseSettings();
  raiseQuitButton();
  refreshTray();
  pushSettingsState();
}

function toggleWall() {
  switchWall(store.read().wall === 'sticky' ? 'index' : 'sticky');
}

function setWallOpacity(v) {
  const clamped = Math.min(1, Math.max(0, Number(v) || 0));
  store.write({ wallOpacity: clamped });
  // 不用整頁 reload——直接改 CSS 變數即可即時生效。
  if (win) {
    win.webContents
      .executeJavaScript(
        `document.documentElement.style.setProperty('--wall-opacity','${clamped}')`,
      )
      .catch(() => {});
  }
}

// ── 開機自動啟動 ────────────────────────────────────────────────────
function applyAutostart() {
  const { autostart } = store.read();
  app.setLoginItemSettings({ openAtLogin: autostart });
}

// ── 系統匣 ──────────────────────────────────────────────────────────
function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  const s = store.read();
  const visible = win ? win.isVisible() : false;
  return Menu.buildFromTemplate([
    { label: mode === 'background' ? '● 背景模式（滑鼠穿透）' : '● 互動模式（可操作卡片）', enabled: false },
    { type: 'separator' },
    { label: `切換 互動 / 背景  (${accelLabel('toggleMode')})`, click: toggleMode },
    { label: `${visible ? '隱藏' : '顯示'}  (${accelLabel('toggleVisible')})`, click: toggleVisible },
    { type: 'separator' },
    {
      label: '這面牆',
      submenu: [
        { label: '便利貼', type: 'radio', checked: s.wall === 'sticky', click: () => switchWall('sticky') },
        { label: '檔案索引', type: 'radio', checked: s.wall === 'index', click: () => switchWall('index') },
      ],
    },
    { label: `切換牆  (${accelLabel('switchWall')})`, click: toggleWall },
    { type: 'separator' },
    { label: `設定 / 自訂快捷鍵…  (${accelLabel('openSettings')})`, click: openSettings },
    { label: '重新載入這面牆', click: loadWall },
    { type: 'separator' },
    { label: '結束', click: () => app.quit() },
  ]);
}

// ── 設定視窗 ────────────────────────────────────────────────────────
function raiseSettings() {
  if (!settingsWin) return;
  if (settingsWin.isMinimized()) settingsWin.restore();
  // 牆本身釘在 'screen-saver'（最高層），設定視窗要用同一層 + 更高的 relativeLevel
  // 才不會被整片全螢幕的牆蓋掉——不然使用者根本看不到、也點不到設定視窗。
  settingsWin.setAlwaysOnTop(true, 'screen-saver', 1);
  settingsWin.show();
  settingsWin.moveTop();
  settingsWin.focus();
}

function openSettings() {
  if (settingsWin) {
    raiseSettings();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 760,
    title: '桌面牆設定',
    resizable: true,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: true,
    // 設定視窗是一般可互動視窗（不像牆會切穿透）——這裡明確標一下意圖。
    focusable: true,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'settings-preload.js'),
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.setAlwaysOnTop(true, 'screen-saver', 1);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', raiseSettings);
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// 設定視窗的快捷鍵是「開關式」：已經開著就關掉，沒開就開。（系統匣選單那顆
// 仍然是單純「開／帶到最前」——從選單點通常是想看它，不是想關。）
function toggleSettings() {
  if (settingsWin) settingsWin.close();
  else openSettings();
}

function displayChoices() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `螢幕 ${i + 1}（${d.size.width}×${d.size.height}）${d.id === primaryId ? ' · 主螢幕' : ''}`,
  }));
}

function settingsState() {
  const s = store.read();
  return {
    settings: s,
    mode,
    visible: win ? win.isVisible() : false,
    displays: displayChoices(),
    settingsPath: store.settingsPath(),
    shortcutStatus,
    shortcutErrors,
    shortcutDefaults: store.DEFAULT_SHORTCUTS,
    shortcutLabels: Object.fromEntries(
      Object.entries(SHORTCUT_META).map(([k, v]) => [k, v.label]),
    ),
  };
}

function pushSettingsState() {
  if (settingsWin) settingsWin.webContents.send('state', settingsState());
}

ipcMain.handle('dw-get-state', () => settingsState());
ipcMain.handle('dw-set-wall', (_e, w) => {
  switchWall(w);
  return settingsState();
});
ipcMain.handle('dw-set-mode', (_e, m) => {
  setMode(m);
  return settingsState();
});
ipcMain.handle('dw-set-opacity', (_e, v) => {
  setWallOpacity(v);
  return settingsState();
});
ipcMain.handle('dw-set-start-mode', (_e, m) => {
  store.write({ startMode: m === 'interactive' ? 'interactive' : 'background' });
  return settingsState();
});
ipcMain.handle('dw-set-autostart', (_e, on) => {
  store.write({ autostart: !!on });
  applyAutostart();
  return settingsState();
});
ipcMain.handle('dw-set-display', (_e, id) => {
  store.write({ displayId: id === null ? null : Number(id) });
  positionWall(); // 內部會 win.setAlwaysOnTop()，在 Windows 上會把設定視窗／
  positionHint(); // 結束程式按鈕蓋過去（見 raiseQuitButton() 註解那段實測），
  positionQuitButton(); // 換螢幕之後兩個都要重新搶回最上層，不然要等下次按
  raiseSettings(); // 快捷鍵才會補救回來。
  raiseQuitButton();
  return settingsState();
});
ipcMain.on('dw-open-userdata', () => shell.openPath(path.dirname(store.settingsPath())));

// 獨立的「結束程式」懸浮按鈕視窗（quit-button.html）按下時觸發——見
// createQuitButton()。直接 app.quit()，跟系統匣「結束」同一條路徑
// （will-quit 會清乾淨子行程）。
ipcMain.on('dw-quit', () => app.quit());

// ── 便利貼牆：拖框裁切 / 拖出去變懸浮視窗 ─────────────────────────────
// 兩個手勢的畫面/判斷邏輯都在 notes-web 那邊（見它的 App.tsx /
// Note.tsx），這裡只負責「真的動視窗」這件事——resize/reposition 現有視窗
// （裁切），或另外開一個新視窗（懸浮），這些是網頁內容本身辦不到的。

// rect 是 wall 視窗座標系（左上角是 (0,0)）——換成螢幕座標才能餵給
// setBounds。使用者畫框畫多大，視窗就照多大——不額外套最小尺寸的下限；
// CropOverlay 那邊本來就會把小於 24x24 的框當成誤觸擋掉，這裡不用重複防。
// ids 一併存進 store，重開 wallpaper-app 時才知道要把哪幾則帶回裁切視窗
// （見 createWall() / currentUrl()）。
ipcMain.handle('wall-crop-to', (_e, ids, rect) => {
  if (!win) return;
  const b = win.getBounds();
  const abs = {
    x: Math.round(b.x + rect.x),
    y: Math.round(b.y + rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  wallCropped = true;
  win.setBounds(abs);
  store.setCrop(ids, abs);
});

ipcMain.handle('wall-restore-crop', () => {
  wallCropped = false;
  store.clearCrop();
  positionWall(); // 同 dw-set-display：win.setAlwaysOnTop() 可能把設定視窗／
  raiseSettings(); // 結束程式按鈕蓋過去，回復全螢幕後要重新搶最上層。
  raiseQuitButton();
});

// 裁切檢視中，讓「恢復完整畫面」那顆按鈕兼職當拖曳把手——按住不放拖動時
// 移動的是裁切出來的那個小視窗本身（不是視窗裡的網頁內容），放開時如果
// 全程沒什麼位移才當成一次「點擊」去真的觸發恢復（判斷邏輯在網頁那邊，
// 見 App.tsx；這裡只管把位移量真的套到視窗座標上）。win 建立時
// movable: false 只擋使用者用系統原生方式拖，setBounds 這種程式化的移動
// 不受影響。只在裁切中才動作——不是裁切狀態時網頁本來就不會送這個。
ipcMain.on('wall-move-by', (_e, dx, dy) => {
  if (!win || !wallCropped) return;
  const b = win.getBounds();
  win.setBounds({
    x: Math.round(b.x + dx),
    y: Math.round(b.y + dy),
    width: b.width,
    height: b.height,
  });
});

// 拖曳結束（放開滑鼠）時才把移動後的新位置寫回存檔——不要每個 mousemove
// 都寫一次（一次拖曳幾十上百個事件，沒必要每次都真的寫磁碟）。網頁那邊
// 只在真的判定為「拖過」時才會送這個（見 App.tsx 的 onRestoreMouseUp）。
ipcMain.on('wall-move-end', () => {
  if (!win || !wallCropped) return;
  const cur = store.read().crop;
  if (!cur) return;
  const b = win.getBounds();
  store.setCrop(cur.ids, { x: b.x, y: b.y, width: b.width, height: b.height });
});

// 同一則便利貼只給開一個懸浮視窗——網頁那邊已經會把「已經拖出去的」從主
// 清單濾掉，理論上不會對同一個 id 重複呼叫，這裡還是防一手。視窗內容直接
// 載入便利貼牆自己那個 server 的網址，帶 `focus=<id>` 讓網頁只畫那一則
// （見 notes-web 的 main.tsx / FocusedNote.tsx）——不用另外做一套
// 渲染邏輯，也不用把便利貼內容整包塞過 IPC，網頁自己用既有的
// GET /api/notes 拿最新資料。
//
// 拖出去的當下，游標常常已經很貼近螢幕邊緣（就是靠近邊緣才會觸發彈出），
// 換算出來的視窗座標可能有一部分甚至整個落在螢幕外——尤其游標離左/上邊緣
// 很近、但使用者是抓著便利貼中/右側在拖時，換算出的 x/y 可以是負值。視窗
// 卡在螢幕外，使用者就沒有任何畫面可以抓來把它拖回來。夾在「游標所在那個
// 螢幕」的工作區範圍內，確保整個視窗一定完整落在畫面上。
function clampToDisplay(rect) {
  const width = Math.max(200, Math.round(rect.width));
  const height = Math.max(140, Math.round(rect.height));
  const center = { x: Math.round(rect.x) + width / 2, y: Math.round(rect.y) + height / 2 };
  const { workArea } = screen.getDisplayNearestPoint(center);
  const x = Math.min(Math.max(Math.round(rect.x), workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(Math.round(rect.y), workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

// 裁切視窗還原用——跟上面 clampToDisplay() 幾乎一樣，但沒有強制最小尺寸：
// 使用者畫框畫多大，重開程式後也該是原本那個大小，不該被硬拉大。只在存檔
// 當下所在的那個螢幕，這次啟動解析度變了／螢幕被拔掉時，把位置/尺寸夾回
// 現在還存在的工作區內，避免視窗還原到畫面完全看不到的地方。
function clampCropToDisplay(rect) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const { workArea } = screen.getDisplayNearestPoint(center);
  const width = Math.min(Math.round(rect.width), workArea.width);
  const height = Math.min(Math.round(rect.height), workArea.height);
  const x = Math.min(Math.max(Math.round(rect.x), workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(Math.round(rect.y), workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

// AlwaysOnTop 等級要跟牆本身同一階（'screen-saver'），不能用比較低的
// 'floating'——牆（含滿版的便利貼卡片）本身就是 screen-saver 等級，用較低
// 等級的懸浮視窗會被牆蓋住，使用者得先把牆藏起來才看得到，等於「拖出去」
// 這個動作看起來像沒反應（實測回報過的 bug）。relativeLevel 2 跟提示疊層
// 同層，蓋過牆(0)/設定/結束鈕(1)。
//
// 便利貼、索引項目兩種「拖出去變懸浮視窗」共用這個——差別只在載入哪個
// url、關掉時要清哪份持久化紀錄，用一個字串 key（呼叫端自己決定命名空間，
// 例如 `note:<id>` / `entry:<indexName>::<path>`）跟一個 onClosed callback
// 抽象掉，不用各自維護一份幾乎一樣的視窗建立/清理邏輯。
function createPinnedWindow(key, url, rect, onClosed) {
  if (!win || pinnedWindows.has(key)) return;
  // 還原上次存檔時也要重夾一次——存檔當下所在的螢幕，下次啟動時解析度
  // 變了、或那台螢幕根本被拔掉了都有可能，不能直接信任存的座標。
  const r = clampToDisplay(rect);
  const w = new BrowserWindow({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'wall-preload.js'), // 給懸浮視窗自己「收回」用（unpinSelf）
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver', 2);
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.loadURL(url);
  pinnedWindows.set(key, w);
  w.on('closed', () => {
    pinnedWindows.delete(key);
    // 程式正在關閉（app.quit() 會把每個視窗都走一輪 'closed'）不算「使用者
    // 收回」——這時候不能清持久化紀錄，不然下次啟動就等於沒存過，見上面
    // appQuitting 的說明。
    if (!appQuitting) onClosed();
  });
}

function pinNoteWindow(id, rect) {
  const url = new URL(servers.urlFor('sticky', { wallOpacity: store.read().wallOpacity }));
  url.searchParams.set('focus', id);
  createPinnedWindow(`note:${id}`, url.toString(), rect, () => {
    store.removePinnedNote(id);
    if (win && !win.isDestroyed()) win.webContents.send('note-unpinned', id);
  });
}

// entry 沒有穩定 id，靠 indexName + path 兩個一起認——同一個 path 只在特定
// 索引集底下查得到（見 notes-web/files-web 的 useIndex() 快取）。
function pinEntryWindow(indexName, entryPath, rect) {
  const url = new URL(servers.urlFor('index', { wallOpacity: store.read().wallOpacity }));
  url.searchParams.set('focus', entryPath);
  url.searchParams.set('index', indexName);
  createPinnedWindow(`entry:${indexName}::${entryPath}`, url.toString(), rect, () => {
    store.removePinnedEntry(indexName, entryPath);
    if (win && !win.isDestroyed()) {
      win.webContents.send('entry-unpinned', { indexName, path: entryPath });
    }
  });
}

ipcMain.handle('wall-pin-note', (_e, note, rect) => {
  if (!win || pinnedWindows.has(`note:${note.id}`)) return;
  const b = win.getBounds();
  // 存檔跟實際開窗要用同一組（已經夾在螢幕內的）座標，不然重開之後 restore
  // 用的是沒夾過的原始值，又要重新算一次——直接在這裡夾好，兩邊一致。
  const abs = clampToDisplay({
    x: b.x + rect.x,
    y: b.y + rect.y,
    width: rect.width,
    height: rect.height,
  });
  store.setPinnedNote(note.id, abs);
  pinNoteWindow(note.id, abs);
});

ipcMain.handle('wall-pin-entry', (_e, entry, rect) => {
  // entry: { indexName, path }——見 files-web 的 App.tsx onPin。
  if (!win || pinnedWindows.has(`entry:${entry.indexName}::${entry.path}`)) return;
  const b = win.getBounds();
  const abs = clampToDisplay({
    x: b.x + rect.x,
    y: b.y + rect.y,
    width: rect.width,
    height: rect.height,
  });
  store.setPinnedEntry(entry.indexName, entry.path, abs);
  pinEntryWindow(entry.indexName, entry.path, abs);
});

// 懸浮視窗自己按「收回」時觸發（見 wall-preload.js 的 unpinSelf /
// FocusedNote.tsx / FocusedEntry.tsx）。直接關掉這個視窗就好——清
// pinnedWindows、清持久化、通知牆把這則/這筆放回清單，都在
// createPinnedWindow() 裡 'closed' 事件已經處理，不用在這裡重複一次。
ipcMain.on('wall-unpin-self', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.close();
});

// 上次關閉時還開著的懸浮便利貼／索引項目——app 剛啟動、server 就緒之後
// 呼叫一次，見 app.whenReady()。不管目前牆面顯示的是便利貼牆還是檔案索引
// 牆都要復原，懸浮視窗本來就是獨立於 `win` 顯示內容之外的。
function restorePinnedWindows() {
  for (const [id, rect] of Object.entries(store.read().pinnedNotes)) pinNoteWindow(id, rect);
  for (const [key, rect] of Object.entries(store.read().pinnedEntries)) {
    const sep = key.indexOf('::');
    if (sep < 0) continue; // 存檔壞掉/格式對不上，跳過這筆，不要整個炸掉
    pinEntryWindow(key.slice(0, sep), key.slice(sep + 2), rect);
  }
}

// 設一個 action 的快捷鍵。回傳 { ok, error?, state }——error 有值代表沒存
// （格式無效 / 跟其他 action 撞），畫面顯示紅字、舊的那組維持有效。
ipcMain.handle('dw-set-shortcut', (_e, action, accel) => {
  if (!store.SHORTCUT_ACTIONS.includes(action)) return { ok: false, error: '未知的動作' };
  const trimmed = typeof accel === 'string' ? accel.trim() : '';
  const invalid = validateAccelerator(trimmed);
  if (invalid) return { ok: false, error: invalid, state: settingsState() };
  const cur = store.read().shortcuts;
  const norm = normalizeAccel(trimmed);
  const clash = Object.entries(cur).find(([a, v]) => a !== action && normalizeAccel(v) === norm);
  if (clash) {
    return { ok: false, error: `這組鍵已經綁在「${SHORTCUT_META[clash[0]].label}」`, state: settingsState() };
  }
  store.write({ shortcuts: { ...cur, [action]: trimmed } });
  registerShortcuts();
  const st = shortcutStatus[action];
  return {
    ok: st === 'ok',
    error: st === 'ok' ? undefined : shortcutErrors[action] || '無法設定',
    state: settingsState(),
  };
});

ipcMain.handle('dw-reset-shortcuts', () => {
  store.resetShortcuts();
  registerShortcuts();
  return settingsState();
});

// ── 全域快捷鍵 ──────────────────────────────────────────────────────
// label：設定視窗顯示 / 衝突訊息用的固定名稱（一定是字串）。
// hint：按下時在畫面中央閃一下的字。可以是字串、或一個在 fn() 跑完後才求值
//   的函式（切換型動作要看「切換後」的狀態才知道該說什麼）；回傳空值＝不顯示
//   （例如「隱藏桌面牆」時牆本來就要消失了、開設定視窗本身就是明顯的回饋）。
const SHORTCUT_META = {
  toggleMode: {
    fn: () => toggleMode(),
    label: '切換 互動 / 背景',
    hint: () => (mode === 'interactive' ? '互動模式：可以操作卡片' : '背景模式：滑鼠穿透桌面'),
  },
  toggleVisible: {
    fn: () => toggleVisible(),
    label: '顯示 / 隱藏',
    hint: () => (win && win.isVisible() ? '顯示桌面牆' : null),
  },
  switchWall: {
    fn: () => toggleWall(),
    label: '切換牆',
    hint: () => (store.read().wall === 'index' ? '切換到：檔案索引牆' : '切換到：便利貼牆'),
  },
  // 開關式：已開就關、沒開就開（見 toggleSettings）。不顯示中央提示——
  // 設定視窗自己跳出來 / 收起來就是最直接的回饋。
  openSettings: { fn: () => toggleSettings(), label: '開 / 關設定視窗', hint: null },
};

// 快捷鍵觸發：先跑動作本身，再依 hint（可能是函式，求值時動作已生效）在畫面
// 中央閃一下提示。hint 求值丟錯不能影響動作已經執行的事實。
function runShortcut(action, meta) {
  try {
    meta.fn();
  } finally {
    let text = null;
    try {
      text = typeof meta.hint === 'function' ? meta.hint() : meta.hint;
    } catch (err) {
      console.warn(`[wallpaper-app] 快捷鍵提示求值失敗（${action}）：`, err.message);
    }
    if (text) showHint(text);
  }
}

// action -> 'ok' | 'failed' | 'invalid' | 'conflict' | 'unset'
let shortcutStatus = {};
// action -> 具體錯誤訊息（status 非 ok/unset 時）
let shortcutErrors = {};

const MOD_CANON = {
  control: 'Control', ctrl: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control',
  command: 'Control', cmd: 'Control', meta: 'Control', super: 'Super',
  alt: 'Alt', option: 'Alt', altgr: 'Alt', shift: 'Shift',
};
const MOD_ORDER = { Control: 0, Alt: 1, Shift: 2, Super: 3 };

// 把 accelerator 正規化成「修飾鍵固定順序 + 大寫單鍵」的字串，用來比對保留鍵清單。
function normalizeAccel(accel) {
  const mods = [];
  let key = '';
  for (const raw of String(accel).split('+')) {
    const p = raw.trim();
    if (!p) continue;
    const canon = MOD_CANON[p.toLowerCase()];
    if (canon) {
      if (!mods.includes(canon)) mods.push(canon);
    } else {
      key = p.length === 1 ? p.toUpperCase() : p;
    }
  }
  mods.sort((a, b) => MOD_ORDER[a] - MOD_ORDER[b]);
  return [...mods, key].filter(Boolean).join('+');
}

// 會蓋掉「全系統」通用功能的組合——一律擋掉，不給註冊（globalShortcut 是 OS 層
// 攔截，綁了就每個 app 都沒得用）。剪貼簿 / 復原 / 全選 / 視窗切換這幾類是每個
// 輸入框都靠肌肉記憶在用的，被搶走幾乎等於系統壞掉。
const RESERVED_ACCELS = new Set([
  'Control+C', 'Control+V', 'Control+X', 'Control+A', 'Control+Z', 'Control+Y',
  'Control+S', 'Control+P', 'Control+F',
  'Alt+F4', 'Alt+Tab', 'Alt+Escape', 'Alt+Space',
  'Control+Escape', 'Control+Alt+Delete', 'Control+Shift+Escape',
  'Super+L', 'Super+D', 'Super+E', 'Super+R',
]);

const IS_MODIFIER = /^(Control|Ctrl|CommandOrControl|Command|Cmd|Alt|Option|AltGr|Shift|Super|Meta)$/i;

function acceleratorHasModifier(accel) {
  return String(accel).split('+').some((p) => IS_MODIFIER.test(p.trim()));
}

function validateAccelerator(accel) {
  if (typeof accel !== 'string' || !accel.trim()) return '快捷鍵不能是空的';
  const norm = normalizeAccel(accel);
  const last = norm.split('+').pop();
  if (IS_MODIFIER.test(last)) return '結尾要是一個實際按鍵，不能只有修飾鍵';
  // F1–F24 可以單獨用（沒有 app 靠它們打字）；其他鍵一定要配修飾鍵。
  const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(last);
  if (!isFKey && !acceleratorHasModifier(accel)) {
    return '字母 / 數字 / 符號鍵要至少加一個 Ctrl / Alt / Shift（F1–F24 可單獨用）';
  }
  if (RESERVED_ACCELS.has(norm)) {
    return '這是系統 / 通用快捷鍵（剪貼簿、視窗切換等），綁了會蓋掉全系統的功能，換一組';
  }
  return null;
}

// action -> 顯示用字串（Control+Alt+W -> Ctrl+Alt+W）
function accelLabel(action) {
  const accel = store.read().shortcuts[action] || '';
  const shown = accel.replace(/CommandOrControl|Command|Cmd|Meta/gi, 'Ctrl').replace(/Control/gi, 'Ctrl');
  const st = shortcutStatus[action];
  if (st === 'ok') return shown;
  if (st === 'unset') return '未設定';
  return `${shown || '?'} ⚠ 註冊失敗`;
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutStatus = {};
  shortcutErrors = {};
  const sc = store.read().shortcuts;
  const seen = new Map(); // 正規化 accel -> action（同一組鍵被綁到兩個 action 時擋掉）

  for (const [action, meta] of Object.entries(SHORTCUT_META)) {
    const accel = sc[action];
    if (!accel) {
      shortcutStatus[action] = 'unset';
      continue;
    }
    const bad = validateAccelerator(accel);
    if (bad) {
      shortcutStatus[action] = 'invalid';
      shortcutErrors[action] = bad;
      console.warn(`[wallpaper-app] 快捷鍵「${accel}」（${meta.label}）：${bad}`);
      continue;
    }
    const norm = normalizeAccel(accel);
    if (seen.has(norm)) {
      shortcutStatus[action] = 'conflict';
      shortcutErrors[action] = `和「${SHORTCUT_META[seen.get(norm)].label}」綁到同一組鍵`;
      console.warn(`[wallpaper-app] 快捷鍵「${accel}」重複（${seen.get(norm)} / ${action}）`);
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => runShortcut(action, meta));
    } catch (err) {
      console.warn(`[wallpaper-app] 快捷鍵「${accel}」註冊丟錯：`, err.message);
    }
    shortcutStatus[action] = ok ? 'ok' : 'failed';
    if (ok) {
      seen.set(norm, action);
    } else {
      shortcutErrors[action] = '註冊失敗——可能被其他程式佔用，改用系統匣選單或換一組';
      console.warn(`[wallpaper-app] 快捷鍵「${accel}」（${meta.label}）註冊失敗`);
    }
  }
  refreshTray();
  pushSettingsState();
}

// ── 桌面牆視窗 ──────────────────────────────────────────────────────
function createWall() {
  // 上次結束程式時如果還在裁切檢視中，直接照存的尺寸/位置開窗，不要先開
  // 全螢幕再縮——網址那邊 currentUrl() 會帶 ?crop=<ids> 讓網頁初始化時
  // 就知道要濾出哪幾則，兩邊要在同一輪 createWall() 裡對齊，不然會先閃一下
  // 全螢幕再跳成小視窗。
  const s = store.read();
  let bounds;
  if (s.wall === 'sticky' && s.crop && s.crop.ids.length) {
    bounds = clampCropToDisplay(s.crop);
    wallCropped = true;
  } else {
    bounds = targetDisplay().workArea;
  }
  const { x, y, width, height } = bounds;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'wall-preload.js'),
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  // 專案持續開發，dist 隨時會重建——強制這個視窗永遠拿最新版，別被 Chromium
  // 磁碟快取卡住（跟 desktop-pet main.js 的 Cache-Control 防護同一類風險）。
  // 但便利貼插圖（/note-images/... 底下的 image 資源）例外：它們的檔名帶
  // 時間戳、內容不會就地改，強加 no-store 只會讓每次切牆/reload 把所有插圖
  // 重抓一遍，牆上便利貼一多會看到圖閃一下重載。
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    if (details.resourceType === 'image') return cb({});
    details.responseHeaders = details.responseHeaders || {};
    details.responseHeaders['Cache-Control'] = ['no-store'];
    cb({ responseHeaders: details.responseHeaders });
  });

  mode = store.read().startMode === 'interactive' ? 'interactive' : 'background';
  applyMode();

  win.webContents.session.clearCache().finally(loadWall);

  win.on('closed', () => {
    win = null;
  });
}

// ── 快捷鍵提示視窗 ─────────────────────────────────────────────────
// 背景模式下牆是全透明又滑鼠穿透的，按全域快捷鍵切模式／切牆時畫面常常沒有
// 任何可見變化，使用者無從得知「剛剛那個鍵到底有沒有被收到」。這個獨立的小
// 視窗就補那層回饋：收到 IPC 就在目標螢幕正中央（略偏上）淡入一行字、停一下
// 再淡出。永遠不搶焦點、永遠滑鼠穿透，只是純視覺。做成獨立視窗（不是往牆的
// webContents 注入 DOM）是因為「切換牆」會整頁 reload，注入的節點會被沖掉。
const HINT_W = 560;
const HINT_H = 200;

function positionHint() {
  if (!hintWin || hintWin.isDestroyed()) return;
  const { x, y, width, height } = targetDisplay().workArea;
  hintWin.setBounds({
    x: Math.round(x + (width - HINT_W) / 2),
    y: Math.round(y + (height - HINT_H) / 2 - height * 0.1), // 略偏上，不壓在正中
    width: HINT_W,
    height: HINT_H,
  });
}

function createHintOverlay() {
  hintWin = new BrowserWindow({
    width: HINT_W,
    height: HINT_H,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 提示視窗永遠不吃焦點
    fullscreenable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'hint-preload.js'),
    },
  });
  // 純視覺，任何時候都讓滑鼠穿透（forward:true 跟牆一致）。
  hintWin.setIgnoreMouseEvents(true, { forward: true });
  // 一律壓在最上層：牆是 'screen-saver'（relativeLevel 0）、設定視窗是
  // 'screen-saver', 1，提示視窗用 relativeLevel 2，永遠蓋過這兩者，連全螢幕
  // 應用也照樣看得到（visibleOnFullScreen）。反正它穿透又只閃 1 秒多。
  hintWin.setAlwaysOnTop(true, 'screen-saver', 2);
  hintWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hintWin.loadFile(path.join(__dirname, 'hint.html'));
  hintWin.on('closed', () => {
    hintWin = null;
  });
}

function showHint(text) {
  if (!hintWin || hintWin.isDestroyed()) return;
  clearTimeout(hintHideTimer);
  positionHint();
  // showInactive：顯示但不搶焦點——使用者當下可能正在別的視窗打字。
  if (!hintWin.isVisible()) hintWin.showInactive();
  // 每次都重新宣告最上層 + 拉到最前：切牆會 loadURL 重排、設定視窗剛
  // raiseSettings() 過⋯⋯這幾種情況下同層視窗的先後可能被動過，這裡強制蓋回去。
  hintWin.setAlwaysOnTop(true, 'screen-saver', 2);
  hintWin.moveTop();
  hintWin.webContents.send('hint', String(text));
  // renderer 動畫 ≈ 150ms 淡入 + 900ms 停留 + 340ms 淡出；收尾多留一點再收起。
  hintHideTimer = setTimeout(() => {
    if (hintWin && !hintWin.isDestroyed()) hintWin.hide();
  }, 1650);
}

// ── 結束程式按鈕 ───────────────────────────────────────────────────
// 右上角常駐一顆小小的「✕」，直接 app.quit()——理由：背景模式滑鼠會直接
// 穿透到桌面、互動模式又整片蓋在桌面上，使用者很容易忘記自己還在這個殼
// 裡、也不見得記得系統匣藏在哪才能結束。
//
// **刻意做成獨立視窗，不是畫在牆的網頁內容裡**：牆的滑鼠穿透是靠
// `win.setIgnoreMouseEvents(true, …)` 蓋住整個視窗生效的，沒有「這塊區域
// 例外」這種局部設定——背景模式下就算按鈕畫在網頁上、CSS 也做出 hover 效果
// （因為 forward:true 讓 mousemove 還是會送進來），滑鼠「點擊」事件照樣穿透
// 到桌面，按了完全沒反應，反而是比沒有按鈕更糟的體驗（看得到、點不到）。
// 獨立視窗完全不呼叫 setIgnoreMouseEvents，永遠正常吃滑鼠，不管牆現在是
// 哪種模式都保證點得到——這是它存在的唯一理由，不能省。
//
// visibleOnFullScreen 特地設 true（跟牆本身的 false 不一樣）：這顆按鈕的
// 定位就是「不管在幹嘛都要能結束程式」的最後防線，包含別的視窗開了全螢幕
// 的情況。
const QUIT_W = 64;
const QUIT_H = 64;
const QUIT_MARGIN = 8; // 離螢幕邊緣留一點距離，不要卡到系統邊角手勢

function positionQuitButton() {
  if (!quitWin || quitWin.isDestroyed()) return;
  const { x, y, width } = targetDisplay().workArea;
  quitWin.setBounds({
    x: Math.round(x + width - QUIT_W - QUIT_MARGIN),
    y: Math.round(y + QUIT_MARGIN),
    width: QUIT_W,
    height: QUIT_H,
  });
}

// 牆重新搶最上層（切模式／切牆／設定視窗開關）時，把這顆按鈕的視窗跟著
// 拉回最前——不然視覺上會被剛置頂的牆蓋掉，看不到也點不到。
function raiseQuitButton() {
  if (!quitWin || quitWin.isDestroyed()) return;
  quitWin.setAlwaysOnTop(true, 'screen-saver', 1);
  quitWin.moveTop();
}

function createQuitButton() {
  quitWin = new BrowserWindow({
    width: QUIT_W,
    height: QUIT_H,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true, // 要能收到滑鼠點擊，不能跟提示視窗一樣設 false
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'quit-button-preload.js'),
    },
  });
  positionQuitButton();
  quitWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quitWin.loadFile(path.join(__dirname, 'quit-button.html'));
  // 剛建好視窗時呼叫 setAlwaysOnTop 不保證這個視窗會立刻排到同層（screen-saver）
  // 最上面——Windows 上實測會被剛建好、也設了 always-on-top 的牆視窗蓋過去，
  // 點下去打到牆而不是這顆按鈕，直到使用者按了任一全域快捷鍵（間接呼叫
  // raiseQuitButton() 的 moveTop()）才補救回來。開窗當下就主動呼叫一次
  // raiseQuitButton()，剛啟動就是可點的狀態，不用等第一次按快捷鍵。
  raiseQuitButton();
  quitWin.on('closed', () => {
    quitWin = null;
  });
}

// ── 生命週期 ────────────────────────────────────────────────────────
app.on('second-instance', () => {
  if (settingsWin) settingsWin.focus();
  else openSettings();
});

app.whenReady().then(async () => {
  tray = new Tray(trayIcon());
  tray.setToolTip('桌面牆');
  refreshTray();

  applyAutostart();
  registerShortcuts();

  servers.startAll((key, text) => process.stdout.write(`[${key}] ${text}`));
  try {
    await servers.waitReady();
  } catch (err) {
    console.error('[wallpaper-app] web server 沒能就緒：', err.message);
  }
  createWall();
  createHintOverlay();
  createQuitButton();
  restorePinnedWindows();

  const repositionAll = () => {
    positionWall(); // 螢幕解析度/插拔顯示器事件——跟 dw-set-display 同一個
    positionHint(); // 理由：positionWall() 內部的 win.setAlwaysOnTop() 在
    positionQuitButton(); // Windows 上會把設定視窗／結束程式按鈕蓋過去，
    raiseSettings(); // 這類事件使用者自己不會主動觸發任何快捷鍵去補救，
    raiseQuitButton(); // 不重新搶最上層就會卡住點不到（這正是回報過的
    // 「右上角叉叉偶爾點不到」在 quit-button 建立當下修過一次之後，換螢幕
    // /接投影機這種情境又會重現的原因——漏了這三個呼叫點）。
  };
  screen.on('display-metrics-changed', repositionAll);
  screen.on('display-added', repositionAll);
  screen.on('display-removed', repositionAll);

  // 冒煙測試用：DW_SMOKE=1 時，視窗一載完就自己收掉（驗證啟動→spawn→就緒→
  // 建窗→關閉時 killAll 這條路徑，不用真的把全螢幕透明視窗留在使用者桌面上）。
  if (process.env.DW_SMOKE) {
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] wall loaded:', win.webContents.getURL());
      setTimeout(() => app.quit(), 1500);
    });
  }
});

// 視窗全關不退出——這是常駐工具，靠系統匣「結束」或全域快捷鍵才收。
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  appQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  servers.killAll();
});

// preload 載入失敗轉印到終端機，不用特地開設定視窗的 DevTools 找。
app.on('preload-error', (_e, p, err) => {
  console.error('[wallpaper-app] preload 載入失敗：', p, '\n', err);
});
