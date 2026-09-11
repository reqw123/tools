/**
 * 「區網＋公網」共用便利貼牆的啟動器。
 *
 *   1. 若 SHARE_PUBLIC=on 且這台機器裝了 ngrok（PATH 上找得到）→ 起一條
 *      `ngrok http <PORT>` 隧道，從 ngrok 本機 API（127.0.0.1:4040）抓公網
 *      https 網址，用 SHARE_PUBLIC_URL 傳給 server。抓不到就退回純區網、不擋啟動。
 *   2. 起 Fastify server（`tsx server/index.ts`，NODE_ENV=production）。
 *   3. 印一張同時列出「本機 / 區網 IP / 公網」三種網址的橫幅。
 *   4. 視窗關掉（SIGINT/SIGTERM）或 server 結束 → 一起收掉 ngrok。
 *
 * 「自動偵測並切換」＝同一支 server 同時服務區網 IP 與 ngrok 網址；請求怎麼進來
 * 由 server/share.ts 依 `x-forwarded-for` 自己判斷（隧道進來的一律過密碼牆）。
 * ngrok 只是「有就多開一個對外入口」，區網永遠都在。
 *
 * **port 跟資料檔都刻意跟「個人用」的 wallpaper-app 分開**（2026-09 加）：
 * wallpaper-app 自己 spawn 的 notes-web 固定用 8787、讀 `indexes/.sticky_notes.json`
 * （見 `wallpaper-app/servers.js`）——那是給你自己用的桌面透明板。這支公用牆
 * 啟動器預設換一個 port（見下面 PORT_DEFAULT）、換一份完全獨立的資料檔
 * （見下面 PUBLIC_NOTES_FILE_DEFAULT），兩者才能同時開、不搶 port，公用牆
 * 上遠端的人新增/刪除/亂改也絕對碰不到你自己桌面透明板上的便利貼，反過來
 * 也不會。兩邊「各自維護」是刻意的設計，不是遺漏。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// 從 notes-web/ 底下跑（server/index.ts 等相對路徑靠這個）——這樣 .bat 可以
// 直接 `node <絕對路徑>/scripts/share-serve.mjs`，不必先 cd、也不必經過 npm
// （少兩層行程，關主控台視窗時 CTRL_CLOSE 才傳得到、子行程不會變孤兒）。
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

// 8787 是 wallpaper-app（個人桌面透明板）固定用的 port（見上面說明）——公用牆
// 換一個，兩者才能同時開著、互不干擾。
const PORT_DEFAULT = 8790
const PORT = Number(process.env.API_PORT ?? PORT_DEFAULT)
// 寫回 process.env——下面 spawn 子行程時整包 `...process.env` 轉傳給它，子行程
// 自己也讀 `process.env.API_PORT`（見 server/index.ts），沒有這行子行程會用
// 「它自己」的預設 8787，跟這支 script 算出來的 PORT／banner 對不起來。
process.env.API_PORT = String(PORT)
// 公用牆自己的資料檔——跟桌面版／wallpaper-app 用的 `indexes/.sticky_notes.json`
// 完全分開，預設是空的（不會自動帶進你既有的便利貼）。`.bat` 也會顯式設這個
// 環境變數，這裡的預設值是給直接跑這支 script（不經 .bat）的情況兜底。同樣要
// 寫回 process.env 給子行程讀到。
const PUBLIC_NOTES_FILE_DEFAULT = join(process.cwd(), 'public-wall-data', '.sticky_notes.json')
if (!process.env.STICKY_NOTES_FILE) process.env.STICKY_NOTES_FILE = PUBLIC_NOTES_FILE_DEFAULT
const WANT_PUBLIC = process.env.SHARE_PUBLIC === 'on'
const IS_WIN = process.platform === 'win32'

// 根路徑 `/` 什麼都不畫（見 src/main.tsx）——一定要帶這個路徑才進得去牆。
const WALL_PATH = '/wall'

function lanUrls() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${PORT}${WALL_PATH}`)
    }
  }
  return out
}

/** PATH 上的 ngrok 完整路徑（Windows 用 where、其餘用 which）；找不到回 null。 */
function resolveNgrok() {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', ['ngrok'], { encoding: 'utf8' })
    return out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null
  } catch {
    return null
  }
}

/** 輪詢 ngrok 本機 API 拿公網 https 網址（最多 ~20s）。 */
async function ngrokPublicUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:4040/api/tunnels')
      if (r.ok) {
        const j = await r.json()
        const t = (j.tunnels ?? []).find((x) => typeof x.public_url === 'string' && x.public_url.startsWith('https://'))
        if (t) return t.public_url
      }
    } catch {
      /* ngrok 還沒開好 API，繼續等 */
    }
    await new Promise((s) => setTimeout(s, 500))
  }
  return null
}

let ngrokChild = null
let publicUrl = ''

if (WANT_PUBLIC) {
  const ngrokPath = resolveNgrok()
  if (!ngrokPath) {
    console.log('[ngrok] not found on PATH - continuing LAN-only.')
    console.log('        Install ngrok, then run: ngrok config add-authtoken <your token>')
  } else {
    console.log('[ngrok] starting public tunnel ...')
    ngrokChild = spawn(ngrokPath, ['http', String(PORT)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    ngrokChild.stderr.on('data', (d) => {
      const s = d.toString()
      if (/ERR_NGROK|authtoken|error|failed/i.test(s)) process.stderr.write('[ngrok] ' + s)
    })
    ngrokChild.on('error', () => {}) // ENOENT 等 → 下面 ngrokPublicUrl() 會逾時退回區網
    publicUrl = (await ngrokPublicUrl()) ?? ''
    if (publicUrl) {
      console.log(`[ngrok] public URL: ${publicUrl}`)
    } else {
      console.log('[ngrok] could not get a public URL - continuing LAN-only.')
      console.log('        Check: is another ngrok already running? is the authtoken set?')
      try {
        ngrokChild.kill()
      } catch {
        /* already gone */
      }
      ngrokChild = null
    }
  }
}

// ── server ──────────────────────────────────────────────────────────
// `node --import tsx server/index.ts`——跟 package.json 的 "start" 等價，但不經
// npx/shell（避免 DEP0190、也讓子行程能乾淨地被 kill）。
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    ...(publicUrl ? { SHARE_PUBLIC_URL: publicUrl } : {}),
  },
})

// ── banner ──────────────────────────────────────────────────────────
setTimeout(() => {
  const lan = lanUrls()
  const lines = [
    '',
    '='.repeat(64),
    '  Sticky notes wall - share mode',
    '  This is a SEPARATE set of notes from your desktop / wallpaper-app wall',
    '  (own data file, own port) - edits here never touch your personal notes.',
    `  You (this PC):     http://localhost:${PORT}${WALL_PATH}   (no password)`,
    '  Same Wi-Fi / LAN:',
    ...(lan.length ? lan.map((u) => `      ${u}`) : ['      (no LAN address found)']),
  ]
  if (publicUrl) {
    lines.push(
      '  Public (anywhere):',
      `      ${publicUrl}${WALL_PATH}`,
      '      ^ first visit on each device: click "Visit Site" on the ngrok page',
    )
  } else if (WANT_PUBLIC) {
    lines.push('  Public: NOT active (ngrok unavailable) - LAN only this run')
  }
  lines.push(
    '  Everyone except this PC needs the shared password.',
    '  Close this window to stop everything.',
    '='.repeat(64),
    '',
  )
  console.log(lines.join('\n'))
}, 2500)

// ── teardown ────────────────────────────────────────────────────────
// `tsx` 起真正的 server 是孫行程；Windows 上 child.kill() 只收到直接子行程，
// 用 taskkill /T 連整棵樹一起收（關主控台視窗時 CTRL_CLOSE 本來就會全殺，這是
// 給「從外面 kill 這支 script」的情況兜底）。
function killTree(child) {
  if (!child || child.killed) return
  try {
    if (IS_WIN && child.pid) {
      // spawnSync：handler 常接著 process.exit()，async spawn 會來不及跑。
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
    } else {
      child.kill()
    }
  } catch {
    /* gone */
  }
}
function killAll() {
  killTree(server)
  killTree(ngrokChild)
}
let tearingDown = false
function shutdown() {
  if (tearingDown) return
  tearingDown = true
  killAll()
  process.exit(0)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, shutdown)
}
// 互動主控台限定：關視窗（X）→ TTY stdin 收到 EOF，當關站訊號用，SIGHUP 沒傳到
// 時的兜底。非 TTY（管線／背景／npm run）stdin 一開始就 EOF，不能拿來判斷，靠 signal。
if (process.stdin.isTTY) {
  try {
    process.stdin.resume()
    process.stdin.on('end', shutdown)
  } catch {
    /* 靠 signal 就好 */
  }
}
// 最後一道：exit 只能做同步事，硬收殘留的樹。
process.on('exit', () => {
  if (!IS_WIN) return
  for (const c of [server, ngrokChild]) {
    if (c?.pid && !c.killed) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(c.pid)], { stdio: 'ignore' })
    }
  }
})
server.on('error', (err) => {
  console.error('[server] failed to start:', err.message)
  killAll()
  process.exit(1)
})
server.on('exit', (code) => {
  killTree(ngrokChild)
  process.exit(code ?? 0)
})
