'use strict';
// 兩個 web 專案（notes-web / files-web）的 server 子行程管理。
//
// 用 `process.execPath`（＝ electron.exe）+ ELECTRON_RUN_AS_NODE=1 當純 node，跑
// `--import tsx server/index.ts`——不需要另外裝 node，也不用先把 TS 編成 JS。
// NODE_ENV=production 讓那支 server 用 @fastify/static 吐 dist/ + /api，單一埠。
//
// 為什麼是 spawn 子行程、不是把 Fastify require 進主行程：兩個後端要編成能被
// require 的 CJS 函式庫得處理 import.meta、無副檔名 import、路徑常數一堆眉角，
// 風險高。spawn 是 C:\question\control-center/process-manager.js 已驗證的模式，
// 一樣「關掉 Electron 就全部收乾淨」（見 killAll）。

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const WEBS = {
  sticky: { dir: path.join(ROOT, 'notes-web'), port: 8787 },
  index: { dir: path.join(ROOT, 'files-web'), port: 8788 },
};

// key -> child
const running = new Map();

function spawnOne(key, onLog) {
  if (running.has(key)) return running.get(key);
  const web = WEBS[key];
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: web.dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      API_PORT: String(web.port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  running.set(key, child);
  const log = (s) => (chunk) => onLog && onLog(key, chunk.toString('utf8'), s);
  child.stdout.on('data', log('out'));
  child.stderr.on('data', log('err'));
  child.on('exit', (code) => {
    running.delete(key);
    onLog && onLog(key, `— server 行程結束（exit ${code}）—\n`, 'meta');
  });
  child.on('error', (err) => onLog && onLog(key, `— server 行程錯誤：${err.message} —\n`, 'meta'));
  return child;
}

function startAll(onLog) {
  spawnOne('sticky', onLog);
  spawnOne('index', onLog);
}

// TCP 連得上就當作 ready（server 印 "API listening" 之後就 listen 了）。
function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`等 127.0.0.1:${port} 逾時`));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function waitReady() {
  return Promise.all([waitForPort(WEBS.sticky.port), waitForPort(WEBS.index.port)]);
}

// 埠「空出來」＝連不上（跟 waitForPort 相反）。killAll 的 taskkill /f 是非同步的，
// 重啟前要等舊 server 真的死透、埠釋放，不然新 server 撞 EADDRINUSE。
function waitForPortFree(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve();
        else setTimeout(tick, 250);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve();
      });
    };
    tick();
  });
}

// 「清除快取並重新載入」用——把兩個 server 子行程收掉、等埠釋放、重新 spawn，
// 讓 server 端的程式改動也生效（子行程不是 tsx watch，不會自己重載）。
async function restartAll(onLog) {
  const ports = Object.values(WEBS).map((w) => w.port);
  killAll();
  await Promise.all(ports.map((p) => waitForPortFree(p)));
  startAll(onLog);
  await waitReady();
}

function urlFor(key, opts) {
  const q = new URLSearchParams({ surface: 'desktop', wall: String(opts.wallOpacity) });
  return `http://127.0.0.1:${WEBS[key].port}/?${q.toString()}`;
}

function killAll() {
  for (const [key, child] of running) {
    try {
      // Windows：child 底下可能還有孫行程（tsx 的 loader 等），taskkill /t 砍整棵樹。
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      } else {
        child.kill('SIGTERM');
      }
    } catch (err) {
      console.error(`[wallpaper-app] 停止 ${key} server 失敗：`, err.message);
    }
  }
  running.clear();
}

module.exports = { startAll, waitReady, restartAll, urlFor, killAll, WEBS };
