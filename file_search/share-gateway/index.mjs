/**
 * 多人牆閘道——讓便利貼牆（notes-web）跟索引牆（files-web）共用同一個對外
 * port／同一次登入，靠 `active_wall` cookie（`notes`｜`files`）決定把每個
 * 請求轉給哪個後端。**純 `node:http`，零額外套件**：兩邊後端不用改任何
 * 現有的路徑邏輯（它們看到的請求路徑跟今天一模一樣），閘道只是原封不動把
 * request/response 兩個 stream pipe 過去，SSE、multipart 上傳都直接受惠。
 *
 * 切換牆＝`GET /switch-wall?to=notes|files`——閘道自己處理（不轉發），設好
 * cookie 就 302 導回 `/wall`，換一個後端接手同一個網址。
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
  req.pipe(proxyReq)
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  if (pathname === '/switch-wall') {
    handleSwitchWall(req, res)
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
