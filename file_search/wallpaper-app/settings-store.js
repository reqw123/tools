'use strict';
// wallpaper-app 自己的設定檔——app.getPath('userData') 會依這個行程的 package.json
// name（"wallpaper-app"）算路徑，跟 desktop-pet / control-center 各自獨立，不會混。
// 讀取失敗（ENOENT = 首次啟動，正常；JSON 壞掉 = 值得留意）一律退回預設值，不讓
// 設定壞掉卡住啟動。

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 全域快捷鍵——action id -> Electron accelerator 字串。使用者可在設定視窗改，
// 「回復預設」直接把 shortcuts 整包還原成這個。
const DEFAULT_SHORTCUTS = Object.freeze({
  toggleMode: 'Shift+Z', // 切換 互動 / 背景
  toggleVisible: 'Shift+X', // 顯示 / 隱藏
  switchWall: 'Shift+C', // 切換牆
  openSettings: 'Shift+V', // 開設定視窗
});
const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS);

const DEFAULTS = Object.freeze({
  wall: 'sticky', // 'sticky' | 'index'——目前貼哪一面牆
  startMode: 'background', // 'background'（穿透）| 'interactive'——每次啟動的初始模式
  wallOpacity: 0.00, // 0~1，牆面/底色的不透明度，0 = 只剩卡片
  // 到期鬧鐘的通知音效——'chime' 短提示音（Windows 預設）｜'loop' 循環鬧鈴
  // （Notification.Looping.Alarm，響到按掉為止）｜'silent' 只跳卡片不出聲。
  // 到期通知本身要不要發，是 notes-web「⏰ 提醒設定」的 wallpaperToast 開關管的。
  alarmSound: 'chime',
  autostart: false, // 開機自動啟動
  displayId: null, // 指定顯示在哪個螢幕（Electron display.id）；null = 主螢幕
  shortcuts: { ...DEFAULT_SHORTCUTS },
  // 便利貼「拖出去變懸浮視窗」目前還開著的那幾則——noteId -> 螢幕座標系的
  // 視窗位置/大小。重開 wallpaper-app 時要把它們原樣重新開出來，見 main.js
  // 的 restorePinnedNotes()。
  pinnedNotes: {},
  // 索引牆版的同一件事——key 是 `${indexName}::${path}`（entry 沒有穩定 id，
  // 只有 path，且同一個 path 只在特定索引集底下查得到，兩個都要記）。
  pinnedEntries: {},
  // 「拖框裁切」目前的檢視狀態——null＝沒有在裁切。ids 是框到的那幾則
  // noteId，x/y/width/height 是牆視窗當下（裁切後）的螢幕座標系尺寸/位置。
  // 只有 wall === 'sticky' 才有意義；切牆／按恢復都要記得清掉，見 main.js。
  crop: null,
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[wallpaper-app] settings.json 讀取失敗，已退回預設值：', err.message);
    }
  }
  return { ...DEFAULTS, ...sanitize(saved) };
}

// pinnedNotes 跟 pinnedEntries 是同一種形狀（key -> 螢幕座標系 rect），
// 共用同一套驗證，不寫兩次。
function sanitizeRectMap(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const [id, r] of Object.entries(o)) {
    if (
      typeof id === 'string' && id &&
      r && typeof r === 'object' &&
      Number.isFinite(r.x) && Number.isFinite(r.y) &&
      Number.isFinite(r.width) && Number.isFinite(r.height)
    ) {
      out[id] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
  }
  return out;
}

function sanitize(o) {
  const out = {};
  if (o.wall === 'sticky' || o.wall === 'index') out.wall = o.wall;
  if (o.startMode === 'background' || o.startMode === 'interactive') out.startMode = o.startMode;
  if (typeof o.wallOpacity === 'number' && o.wallOpacity >= 0 && o.wallOpacity <= 1) {
    out.wallOpacity = Math.round(o.wallOpacity * 100) / 100;
  }
  if (o.alarmSound === 'chime' || o.alarmSound === 'loop' || o.alarmSound === 'silent') {
    out.alarmSound = o.alarmSound;
  }
  if (typeof o.autostart === 'boolean') out.autostart = o.autostart;
  if (o.displayId === null || Number.isInteger(o.displayId)) out.displayId = o.displayId;
  if (o.shortcuts && typeof o.shortcuts === 'object') {
    // 只認識的 action、值必須是非空字串；沒填 / 壞掉的那一個 action 退回預設。
    const sc = {};
    for (const action of SHORTCUT_ACTIONS) {
      const v = o.shortcuts[action];
      sc[action] = typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_SHORTCUTS[action];
    }
    out.shortcuts = sc;
  }
  if (o.pinnedNotes !== undefined) {
    const pn = sanitizeRectMap(o.pinnedNotes);
    if (pn) out.pinnedNotes = pn;
  }
  if (o.pinnedEntries !== undefined) {
    const pe = sanitizeRectMap(o.pinnedEntries);
    if (pe) out.pinnedEntries = pe;
  }
  if (o.crop === null) {
    out.crop = null;
  } else if (o.crop && typeof o.crop === 'object' && Array.isArray(o.crop.ids)) {
    const ids = o.crop.ids.filter((id) => typeof id === 'string' && id);
    const valid =
      ids.length > 0 &&
      Number.isFinite(o.crop.x) && Number.isFinite(o.crop.y) &&
      Number.isFinite(o.crop.width) && Number.isFinite(o.crop.height);
    out.crop = valid
      ? { ids, x: o.crop.x, y: o.crop.y, width: o.crop.width, height: o.crop.height }
      : null;
  }
  return out;
}

function write(patch) {
  const next = { ...read(), ...sanitize(patch) };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('[wallpaper-app] settings.json 寫入失敗：', err.message);
  }
  return next;
}

function resetShortcuts() {
  return write({ shortcuts: { ...DEFAULT_SHORTCUTS } });
}

// pinnedNotes 存的是整包 map，write() 只會整包替換（不會深層合併），所以
// 加一則/拿掉一則都要先讀現有的、改那一個 key、再整包寫回去。
function setPinnedNote(id, rect) {
  const cur = read().pinnedNotes;
  return write({ pinnedNotes: { ...cur, [id]: rect } });
}

function removePinnedNote(id) {
  const cur = { ...read().pinnedNotes };
  delete cur[id];
  return write({ pinnedNotes: cur });
}

// 索引項目沒有穩定 id，用 `${indexName}::${path}` 當 key——Windows 檔名/路徑
// 都不可能含 `::`（`:` 只會出現在磁碟機代號，不會連續兩個），拆 key 用
// 第一個 `::` 切開一定安全。
function setPinnedEntry(indexName, entryPath, rect) {
  const key = `${indexName}::${entryPath}`;
  const cur = read().pinnedEntries;
  return write({ pinnedEntries: { ...cur, [key]: rect } });
}

function removePinnedEntry(indexName, entryPath) {
  const key = `${indexName}::${entryPath}`;
  const cur = { ...read().pinnedEntries };
  delete cur[key];
  return write({ pinnedEntries: cur });
}

function setCrop(ids, rect) {
  return write({ crop: { ids, ...rect } });
}

function clearCrop() {
  return write({ crop: null });
}

module.exports = {
  read, write, resetShortcuts,
  setPinnedNote, removePinnedNote, setPinnedEntry, removePinnedEntry,
  setCrop, clearCrop,
  DEFAULTS, DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, settingsPath,
};
