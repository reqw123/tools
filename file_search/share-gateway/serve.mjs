/**
 * 「多人牆」統一啟動器——同時起 notes-web（便利貼牆）、files-web（索引牆）
 * 兩支後端（都改綁 127.0.0.1，不直接對外）＋這個資料夾的閘道
 * （`index.mjs`，唯一對外的那個），讓兩面牆共用一份登入、一個網址，靠
 * 工具列的「切換到 XX」鈕互相跳轉。ngrok（公網模式）只包這個閘道的 port，
 * 不是兩支後端各自一條隧道。
 *
 * 跟兩邊各自的 `share-serve.mjs`（單一 app 的區網＋公網啟動器）是同一種
 * 「.bat 只問密碼/公網開關，實際 spawn 交給這支 script」的分工，這裡只是
 * 多協調兩支後端＋一個閘道，ngrok 偵測那段邏輯是同一套、直接複製過來
 * （這幾支啟動器一直都是各自獨立一份，不共用程式碼，見 CONTEXT-MAP.md）。
 *
 * 共用登入的關鍵：兩支後端拿到的 `SHARE_TOKEN` 是同一組密碼、資料夾都指到
 * 同一個 `public-share-data/`（`.share/people.json` 因此變成同一份），
 * `GATEWAY_SECRET` 也是同一把——這三件事任何一個沒對齊，切換牆就會要求
 * 重新登入。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import crypto from 'node:crypto'

const GATEWAY_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(GATEWAY_DIR, '..')
process.chdir(ROOT)

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8794)
const NOTES_PORT = Number(process.env.NOTES_TARGET_PORT ?? 8792)
const FILES_PORT = Number(process.env.FILES_TARGET_PORT ?? 8793)
// .bat 沒設的話這裡自己生一把——多人牆閘道要求一定要有，見 index.mjs 開頭檢查。
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || crypto.randomBytes(16).toString('hex')
process.env.GATEWAY_SECRET = GATEWAY_SECRET

const SHARE_TOKEN = (process.env.SHARE_TOKEN ?? '').trim()
const WANT_PUBLIC = process.env.SHARE_PUBLIC === 'on'
const IS_WIN = process.platform === 'win32'
const WALL_PATH = '/wall'

// 兩支後端共用同一份資料夾——`.share/people.json`（身分＋PIN）跟
// `.share/visits.json`（訪客紀錄）因此自動變成同一份，這是「共用一份登入」
// 成立的基礎，見檔頭說明。這個資料夾跟兩支各自獨立啟動器用的
// `notes-web/public-wall-data/`／`files-web/public-index-data/` 完全分開，
// 不會互相污染。
const SHARED_DATA_DIR = join(ROOT, 'public-share-data')

function lanUrls() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${GATEWAY_PORT}${WALL_PATH}`)
    }
  }
  return out
}

function resolveNgrok() {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', ['ngrok'], { encoding: 'utf8' })
    return out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null
  } catch {
    return null
  }
}

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
    ngrokChild = spawn(ngrokPath, ['http', String(GATEWAY_PORT)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    ngrokChild.stderr.on('data', (d) => {
      const s = d.toString()
      if (/ERR_NGROK|authtoken|error|failed/i.test(s)) process.stderr.write('[ngrok] ' + s)
    })
    ngrokChild.on('error', () => {})
    publicUrl = (await ngrokPublicUrl()) ?? ''
    if (publicUrl) {
      console.log(`[ngrok] public URL: ${publicUrl}`)
    } else {
      console.log('[ngrok] could not get a public URL - continuing LAN-only.')
      try {
        ngrokChild.kill()
      } catch {
        /* already gone */
      }
      ngrokChild = null
    }
  }
}

// ── notes-web（便利貼牆）後端 ────────────────────────────────────────
const notesEnv = {
  ...process.env,
  SHARE_MODE: 'lan',
  API_HOST: '127.0.0.1', // 不對外，閘道才對外——見 notes-web/server/index.ts 的 HOST
  SHARE_BEHIND_GATEWAY: '1', // 純粹讓 index.ts 抑制誤導的區網網址 log（見那邊）
  API_PORT: String(NOTES_PORT),
  SHARE_TOKEN,
  SHARE_AI: process.env.SHARE_AI ?? 'off',
  NODE_ENV: 'production',
  STICKY_NOTES_FILE: join(SHARED_DATA_DIR, '.sticky_notes.json'),
  GATEWAY_SECRET,
  OTHER_WALL_LABEL: '索引牆',
  // **相對路徑，不能寫死 127.0.0.1**——瀏覽器點下去是照「目前網址列的
  // origin」解析：主機本人是 http://localhost:8794，區網/公網訪客是
  // LAN IP 或 ngrok 網域，各自都不一樣。曾經寫死 `http://127.0.0.1:${GATEWAY_PORT}`，
  // 主機本人點沒事（他自己就是 127.0.0.1），但遠端使用者的瀏覽器會去連
  // *他們自己電腦*的 127.0.0.1:8794——連不到東西，頁面整個掛掉。這是真實
  // 使用者回報的 bug（「遠端玩家切換到索引牆會丟失頁面」）。
  OTHER_WALL_SWITCH_URL: '/switch-wall?to=files',
  // 分享鈕/QR（ShareLinkButton）靠 share.ts 的 SHARE_WALL_URL 才會出現，那個
  // 又是從這個環境變數算的——閘道自己解析到的 ngrok 網址一定要往下傳，不然
  // 公網模式下兩邊都不會顯示分享鈕（這裡曾經漏掉，只拿 publicUrl 印自己的
  // console 橫幅，忘了轉發給子行程）。WALL_PATH 由各自的 share.ts 自己接上
  // 去，這裡只傳網域本身。
  SHARE_PUBLIC_URL: publicUrl,
}
const notesChild = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: join(ROOT, 'notes-web'),
  stdio: 'inherit',
  env: notesEnv,
})

// ── files-web（索引牆）後端 ──────────────────────────────────────────
const filesEnv = {
  ...process.env,
  SHARE_MODE: 'lan',
  SHARE_BEHIND_GATEWAY: '1', // 不對外，閘道才對外——見 files-web/server/index.ts 的 host 判斷
  API_PORT: String(FILES_PORT),
  SHARE_TOKEN,
  SHARE_AI: process.env.SHARE_AI ?? 'off',
  NODE_ENV: 'production',
  INDEX_DIR: SHARED_DATA_DIR,
  GATEWAY_SECRET,
  OTHER_WALL_LABEL: '便利貼牆',
  // 見 notesEnv 同一個欄位的註解——相對路徑，不能寫死 127.0.0.1。
  OTHER_WALL_SWITCH_URL: '/switch-wall?to=notes',
  // 見 notesEnv 同一個欄位的註解——閘道解析到的 ngrok 網址要往下傳，兩邊
  // 分享鈕才會在公網模式下正常出現。
  SHARE_PUBLIC_URL: publicUrl,
}
const filesChild = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: join(ROOT, 'files-web'),
  stdio: 'inherit',
  env: filesEnv,
})

// ── 閘道（唯一對外的那個）────────────────────────────────────────────
const gatewayEnv = {
  ...process.env,
  GATEWAY_PORT: String(GATEWAY_PORT),
  GATEWAY_SECRET,
  NOTES_TARGET_PORT: String(NOTES_PORT),
  FILES_TARGET_PORT: String(FILES_PORT),
}
const gatewayChild = spawn(process.execPath, ['index.mjs'], {
  cwd: GATEWAY_DIR,
  stdio: 'inherit',
  env: gatewayEnv,
})

// ── banner ──────────────────────────────────────────────────────────
setTimeout(() => {
  const lan = lanUrls()
  const lines = [
    '',
    '='.repeat(64),
    '  Multi-wall share mode - sticky notes + index wall, one login',
    `  You (this PC):     http://localhost:${GATEWAY_PORT}${WALL_PATH}   (no password)`,
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
    '  Use the "switch wall" button in the top toolbar to flip between the',
    '  two walls - same login carries over, no need to sign in again.',
    '  Close this window to stop everything.',
    '='.repeat(64),
    '',
  )
  console.log(lines.join('\n'))
}, 3000)

// ── teardown ────────────────────────────────────────────────────────
function killTree(child) {
  if (!child || child.killed) return
  try {
    if (IS_WIN && child.pid) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
    } else {
      child.kill()
    }
  } catch {
    /* gone */
  }
}
const allChildren = [notesChild, filesChild, gatewayChild, ngrokChild]
function killAll() {
  for (const c of allChildren) killTree(c)
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
if (process.stdin.isTTY) {
  try {
    process.stdin.resume()
    process.stdin.on('end', shutdown)
  } catch {
    /* 靠 signal 就好 */
  }
}
process.on('exit', () => {
  if (!IS_WIN) return
  for (const c of allChildren) {
    if (c?.pid && !c.killed) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(c.pid)], { stdio: 'ignore' })
    }
  }
})
for (const [child, name] of [
  [notesChild, 'notes-web'],
  [filesChild, 'files-web'],
  [gatewayChild, 'gateway'],
]) {
  child.on('error', (err) => {
    console.error(`[${name}] failed to start:`, err.message)
    killAll()
    process.exit(1)
  })
  child.on('exit', (code) => {
    if (tearingDown) return
    console.error(`[${name}] exited unexpectedly (code ${code}) - stopping everything else`)
    killAll()
    process.exit(code ?? 1)
  })
}
