/**
 * 多人牆閘道——讓便利貼牆（notes-web）跟索引牆（files-web）共用同一個對外
 * port／同一次登入，靠 `active_wall` cookie（`notes`｜`files`）決定把每個
 * 請求轉給哪個後端。**純 `node:http`，零額外套件**：兩邊後端不用改任何
 * 現有的路徑邏輯（它們看到的請求路徑跟今天一模一樣），閘道只是原封不動把
 * request/response 兩個 stream pipe 過去，SSE、multipart 上傳都直接受惠。
 *
 * 切換牆＝`GET /switch-wall?to=notes|files`——閘道自己處理（不轉發），設好
 * cookie 就 302 導回 `/wall`，換一個後端接手同一個網址。`GET
 * /combined-activity?limit=` 也是自己處理（不轉發）：跟兩支後端各要一份
 * `/api/activity`、轉發原始請求的 cookie 讓各自的登入驗證照舊生效，合併
 * 排序後一次回傳——給兩邊前端的「合併動態」用（見 `handleCombinedActivity`）。
 * `GET /combined-online` 同一類，合併兩支後端的「誰在線」（見
 * `handleCombinedOnline`）——單一後端只看得到「開著自己這面牆的人」，只有
 * 閘道同時連著兩邊，能看到全貌。
 *
 * **loopback 信任鏈**：兩邊後端原本靠「這次連線有沒有帶 x-forwarded-for」
 * 判斷是不是主機本人（見 `server/share.ts` 的 `isLoopback()`）。現在所有
 * 流量都先經過這支閘道，後端收到的連線來源永遠是閘道自己（同機
 * 127.0.0.1），原本的判斷方式在閘道前面就已經失真。這裡改成閘道自己在
 * 「第一手」連線上判斷一次，用 `x-gateway-loopback` 標頭（值＝
 * `GATEWAY_SECRET` 或 `not:`+密鑰）明講給後端聽，後端只要密鑰對得上就直接
 * 採用，不用自己再猜。三種情況：
 *
 *   1. 這次連線本身已經帶了 x-forwarded-for（ngrok 轉發進來的）
 *      → 非本機，原樣轉發這個 header
 *   2. 沒有，但連到閘道的 socket 不是 127.0.0.1（區網對等直接連進來）
 *      → 非本機，幫它補一個 x-forwarded-for
 *   3. 沒有，且 socket 就是 127.0.0.1（主機本人的本機瀏覽器）
 *      → 本機，不加任何標頭
 *
 * 這跟兩邊後端原本各自判斷的邏輯是同一套，只是往前挪了一層，所以獨立啟動
 * 器（不經過這支閘道）完全不受影響——那邊沒有 `x-gateway-loopback` 這個
 * 標頭，後端會照舊看 x-forwarded-for／socket 位址。
 */
import http from 'node:http'

// 8790／8791 是便利貼牆／索引牆各自獨立公用啟動器用的 port，8792／8793 是
// 這兩支後端在閘道底下改用的內部 port（見 serve.mjs）——閘道自己再錯開一個
// 全新的 8794，三種啟動方式（獨立便利貼牆／獨立索引牆／這個統一多人牆）
// 才能同時開著，互不搶 port。
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8794)
const GATEWAY_SECRET = (process.env.GATEWAY_SECRET ?? '').trim()
const NOTES_TARGET_PORT = Number(process.env.NOTES_TARGET_PORT ?? 8792)
const FILES_TARGET_PORT = Number(process.env.FILES_TARGET_PORT ?? 8793)

if (!GATEWAY_SECRET) {
  console.error(
    '[gateway] 沒有設定 GATEWAY_SECRET，拒絕啟動——沒有這把密鑰，後端沒辦法分辨\n' +
      '          「這是閘道說的本機」還是任何人偽造的標頭，等於開一個沒鎖的門。',
  )
  process.exit(1)
}

const TARGET_PORT = { notes: NOTES_TARGET_PORT, files: FILES_TARGET_PORT }
const COOKIE_NAME = 'active_wall'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** cookie 沒有／值不是這兩個之一 → 預設 `notes`（第一次進來的人看便利貼牆）。 */
function activeWallFrom(req) {
  const v = parseCookies(req.headers.cookie)[COOKIE_NAME]
  return v === 'files' ? 'files' : 'notes'
}

/** 見檔頭「loopback 信任鏈」說明——這裡只算，不改 req，呼叫端負責套用。 */
function computeTrust(req) {
  const existingXff = req.headers['x-forwarded-for']
  if (existingXff != null) {
    return { xff: existingXff, loopbackHeader: `not:${GATEWAY_SECRET}` }
  }
  const addr = req.socket.remoteAddress ?? ''
  if (!LOOPBACK.has(addr)) {
    return { xff: addr, loopbackHeader: `not:${GATEWAY_SECRET}` }
  }
  return { xff: undefined, loopbackHeader: GATEWAY_SECRET }
}

/**
 * 跟某一支後端要 `/api/activity`——轉發原始請求的 cookie（讓後端的
 * `shareAuthHook` 照舊判斷這個瀏覽器有沒有登入，跟直接打這支 API 完全
 * 一樣的規則）＋跟 `proxy()` 同一套 loopback 信任標頭。這是**閘道自己
 * 對內發的請求**，不是轉發——所以走 `fetch()`，不是 `http.request` 的
 * pipe 模式。
 */
async function fetchActivity(port, limit, req) {
  const { xff, loopbackHeader } = computeTrust(req)
  const headers = { 'x-gateway-loopback': loopbackHeader }
  if (xff !== undefined) headers['x-forwarded-for'] = xff
  if (req.headers.cookie) headers.cookie = req.headers.cookie
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/activity?limit=${limit}`, { headers })
    if (!res.ok) return { ok: false, status: res.status, entries: [] }
    const body = await res.json()
    return { ok: true, status: 200, entries: Array.isArray(body?.entries) ? body.entries : [] }
  } catch {
    return { ok: false, status: 502, entries: [] }
  }
}

/**
 * 「兩面牆合併的動態」——使用者要求「共用身分了，動態能不能不要切牆才看
 * 得到全貌」。**只有閘道自己知道兩支後端各自的位址**，所以合併邏輯放在
 * 這裡最自然，不是任何一支後端的職責；兩邊前端各自一份小元件負責顯示
 * （見 `notes-web`／`files-web` 的 `useCombinedActivity`），這支端點只管
 * 把資料併好排序好。**部分失敗容忍**：兩支後端理論上共用同一份登入（見
 * `serve.mjs`），正常不會一邊過一邊沒過，但只要有一邊拿得到資料就照樣
 * 回，只有兩邊都失敗才回錯——比起「其中一個還沒完全啟動就整個掛掉」更
 * 對使用者友善。 */
// 「切牆」判定窗——同一個具名使用者，斷線／連線發生在彼此這段時間內，就
// 認定是同一次切牆，不是真的離開又有新的人連進來。使用者要求的數字（比
// 斷線寬限期 5 秒再寬一點點，涵蓋切牆當下瀏覽器換頁需要的時間）。
const WALL_SWITCH_WINDOW_MS = 5_000

/**
 * 把「同一個人從一面牆斷線、幾秒內在另一面牆連上」這一對事件合併成一則
 * 中性的「切去了 XX 牆」——使用者要求的：多人同時各自看不同牆時，切牆
 * 產生的斷線/連線容易跟「真的有人離開/加入」混在一起分不清楚。**只處理
 * 具名使用者**（`author` 非空字串）：完全匿名的訪客共用同一個 `''`
 * author，跨牆配對會把「兩個不同的匿名訪客」誤判成「同一個人切牆」，見
 * `displayAuthorFrom()` 對「開發者」也算具名（loopback 本人切牆一樣會被
 * 正確合併）。貪婪比對：每筆事件最多配對一次，且只跟「不同牆」「相反動作」
 * 「同名字」「時間差在窗內」的第一筆候選配對，不追求全域最佳解——這裡是
 * 提示性資訊，不是要精確稽核。
 */
function collapseWallSwitches(entries) {
  const used = new Array(entries.length).fill(false)
  const out = []
  for (let i = 0; i < entries.length; i++) {
    if (used[i]) continue
    const e = entries[i]
    if (!e.author || (e.action !== 'connect' && e.action !== 'disconnect')) {
      out.push(e)
      continue
    }
    const wantAction = e.action === 'disconnect' ? 'connect' : 'disconnect'
    const eTime = Date.parse(e.at)
    let matchIdx = -1
    for (let j = 0; j < entries.length; j++) {
      if (j === i || used[j]) continue
      const o = entries[j]
      if (o.action !== wantAction || o.wall === e.wall || o.author !== e.author) continue
      if (Math.abs(Date.parse(o.at) - eTime) > WALL_SWITCH_WINDOW_MS) continue
      matchIdx = j
      break
    }
    if (matchIdx === -1) {
      out.push(e)
      continue
    }
    used[i] = true
    used[matchIdx] = true
    const disc = e.action === 'disconnect' ? e : entries[matchIdx]
    const conn = e.action === 'connect' ? e : entries[matchIdx]
    out.push({
      at: conn.at,
      author: e.author,
      action: 'switch-wall',
      fromWall: disc.wall,
      toWall: conn.wall,
      wall: conn.wall,
    })
  }
  return out
}

async function handleCombinedActivity(req, res) {
  const limit = Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 100
  const [notes, files] = await Promise.all([
    fetchActivity(NOTES_TARGET_PORT, limit, req),
    fetchActivity(FILES_TARGET_PORT, limit, req),
  ])
  if (!notes.ok && !files.ok) {
    const status = notes.status === 401 || files.status === 401 ? 401 : 502
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '兩邊後端都讀不到動態' }))
    return
  }
  const merged = [
    ...notes.entries.map((e) => ({ ...e, wall: 'notes' })),
    ...files.entries.map((e) => ({ ...e, wall: 'files' })),
  ]
  const entries = collapseWallSwitches(merged)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ entries }))
}

/** 跟某一支後端要 `/api/online`——同一套轉發 cookie／loopback 信任標頭，
 *  見 `fetchActivity()` 的說明。 */
async function fetchOnline(port, req) {
  const { xff, loopbackHeader } = computeTrust(req)
  const headers = { 'x-gateway-loopback': loopbackHeader }
  if (xff !== undefined) headers['x-forwarded-for'] = xff
  if (req.headers.cookie) headers.cookie = req.headers.cookie
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/online`, { headers })
    if (!res.ok) return { ok: false, names: [] }
    const body = await res.json()
    return { ok: true, names: Array.isArray(body?.names) ? body.names : [] }
  } catch {
    return { ok: false, names: [] }
  }
}

/**
 * 「兩面牆合併的在線名單」——使用者要求「連線與斷線也共用」，不只是動態
 * 記錄裡看得到對方連線/斷線的歷史，而是「誰現在在線」這個即時狀態要真的
 * 合併：一個人只開著便利貼牆（沒切去索引牆），索引牆那邊也要看得到他在線
 * ——因為每個人同一時間只會對其中一支後端開著 SSE（`active_wall` cookie
 * 決定流量去哪），單一後端自己的 `connections.ts` 天生看不到「開著另一面
 * 牆的人」，只有閘道同時知道兩邊，所以合併邏輯放在這裡。跟
 * `handleCombinedActivity` 同一套「部分失敗容忍」：只要有一邊拿得到名單就
 * 照樣回，兩邊都要就用 Set 去重（同一個人正好兩面牆都開著也只算一次）。 */
async function handleCombinedOnline(req, res) {
  const [notes, files] = await Promise.all([fetchOnline(NOTES_TARGET_PORT, req), fetchOnline(FILES_TARGET_PORT, req)])
  if (!notes.ok && !files.ok) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '兩邊後端都讀不到在線名單' }))
    return
  }
  const names = [...new Set([...notes.names, ...files.names])].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ names }))
}

function handleSwitchWall(req, res) {
  const raw = new URL(req.url, 'http://x').searchParams.get('to')
  const to = raw === 'files' || raw === 'notes' ? raw : null
  if (!to) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('bad "to" — must be "notes" or "files"')
    return
  }
  res.writeHead(302, {
    'set-cookie': `${COOKIE_NAME}=${to}; Path=/; SameSite=Lax`,
    location: '/wall',
  })
  res.end()
}

function proxy(req, res) {
  const wall = activeWallFrom(req)
  const port = TARGET_PORT[wall]
  const { xff, loopbackHeader } = computeTrust(req)

  const headers = { ...req.headers }
  if (xff !== undefined) headers['x-forwarded-for'] = xff
  headers['x-gateway-loopback'] = loopbackHeader

  const proxyReq = http.request(
    { host: '127.0.0.1', port, path: req.url, method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`[gateway] 轉發到 ${wall} 後端失敗：${err.message}`)
  })
  // 客戶端斷線（關分頁、網路斷掉、瀏覽器背景分頁被系統砍掉）一定要把這個
  // 訊號往後端傳——不然 `/api/events`（SSE，長連線）這種請求，後端從頭到尾
  // 不會知道對方已經不在了：`connections.ts` 的「誰在線」／連線/斷線活動
  // 記錄會一路卡在「還連著」，只有主動關閉才會觸發（真的測出來過：透過
  // 閘道連線後把瀏覽器分頁關掉，`combined-online` 永遠顯示這個人在線）。
  // `proxyReq.destroy()` 讓後端那頭的 socket 也跟著斷，後端自己的
  // `res.raw`／`req` close handler 才會正常觸發。直連的獨立啟動器不會有
  // 這個問題（沒有中間這層代理，瀏覽器斷線直接就是後端 socket 斷線）。
  //
  // **踩過的坑**：一開始寫在 `req.on('close', ...)`——結果連一般的短請求
  // （例如 `POST /api/session` 登入）都變成 502「socket hang up」，因為
  // server 端的 `req`（IncomingMessage）在請求正常處理完、回應也送完之後
  // 一樣會發出 'close'，不是只有「客戶端提早斷線」才會觸發；每一個正常
  // 請求都在回應送完的瞬間被自己搶先 destroy 掉還沒收尾的 proxyReq。改成
  // 掛在 `res`（要送回客戶端的那個 ServerResponse）上，並且只在
  // `!res.writableEnded`（我們自己都還沒把回應寫完，卻先收到 close）時才
  // 動手——這才是「不正常提早結束」的正確判斷式，正常請求走到這裡
  // `writableEnded` 早就是 true 了，不會誤觸發。
  res.on('close', () => {
    if (!res.writableEnded) proxyReq.destroy()
  })
  req.pipe(proxyReq)
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  if (pathname === '/switch-wall') {
    handleSwitchWall(req, res)
    return
  }
  if (pathname === '/combined-activity') {
    handleCombinedActivity(req, res)
    return
  }
  if (pathname === '/combined-online') {
    handleCombinedOnline(req, res)
    return
  }
  proxy(req, res)
})

// SSE 是長連線——閒置逾時關掉會害正在等推播的分頁被斷線，兩個都關掉。
server.keepAliveTimeout = 0
server.headersTimeout = 0

server.listen(GATEWAY_PORT, '0.0.0.0', () => {
  console.log(`[gateway] 監聽 http://0.0.0.0:${GATEWAY_PORT}`)
  console.log(`[gateway] notes → 127.0.0.1:${NOTES_TARGET_PORT}，files → 127.0.0.1:${FILES_TARGET_PORT}`)
})
