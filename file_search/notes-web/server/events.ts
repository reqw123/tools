/**
 * 即時同步——一支 SSE（Server-Sent Events）端點 `GET /api/events`，加上對
 * `indexes/` 資料夾的 `fs.watch`。任何一份共用檔案被改（不管是這個 web server
 * 自己寫、還是 Tkinter 桌面版寫），就推一則訊息給所有連著的瀏覽器，前端收到
 * 就把對應的 TanStack Query 標記過期、立刻重抓。把「最多等 8 秒輪詢」變成
 * 「~100~300ms 推播」。
 *
 * SSE 斷線時前端會自己重連（`retry:`），並在斷線期間退回慢速輪詢當備援。
 */
import { watch, type FSWatcher } from 'node:fs'
import { dirname } from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import type { ServerResponse } from 'node:http'
import { onChange } from './change-bus'
import { notesFilePath } from './store'
import { authorFrom, identityKey } from './identity'
import { clientIp } from './share'
import { connectionClosed, connectionOpened } from './connections'

/** 監看的資料夾——生活便利貼、`.notes_settings.json`、標籤顏色都在這裡。 */
const WATCH_DIR = dirname(notesFilePath)

/** 檔名 → 前端要重抓的「主題」。原子寫入是「寫 .tmp 再 rename」，所以精確比對
 *  檔名即可（`.tmp` 暫存檔不會命中）。 */
const FILE_TOPIC: Record<string, string> = {
  '.sticky_notes.json': 'notes',
  '.thesis_notes.json': 'notes',
  '.notes_settings.json': 'settings',
  '.sticky_tag_colors.json': 'tag-colors',
}

const clients = new Set<ServerResponse>()

// 一次原子寫入會觸發好幾個 watch 事件（tmp 建立、rename…），連續操作更多——
// 收攏成一則，120ms 沒有新變動才送出。
const pending = new Set<string>()
let flushTimer: NodeJS.Timeout | null = null

function broadcast(): void {
  flushTimer = null
  if (pending.size === 0 || clients.size === 0) {
    pending.clear()
    return
  }
  const topics = [...pending]
  pending.clear()
  const payload = `data: ${JSON.stringify({ topics })}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

function note(topic: string): void {
  pending.add(topic)
  // 短 debounce：一次原子寫入／連續操作收攏成一則，又不至於讓人感覺得到延遲。
  if (!flushTimer) flushTimer = setTimeout(broadcast, 60)
}

/**
 * 彈幕——跟上面 `note()`/`broadcast()` 那條「檔案變了、去重抓」的路徑不一樣：
 * 彈幕**不寫檔**（純粹飄過去就消失，跟問答遊戲那套 DanmakuSystem 同樣定位），
 * 沒有對應的 query 可以重抓，所以直接用具名 SSE 事件（`event: danmaku`）把
 * 訊息本體推給所有連著的分頁，前端收到就播放，不進一般的 topic debounce。
 * 每則各自一次 write，不集中——集中的話連續兩則彈幕會被收成一則，內容就丟了。
 */
export function broadcastDanmaku(payload: { id: string; author: string; text: string; at: number }): void {
  if (clients.size === 0) return
  const data = `event: danmaku\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(data)
    } catch {
      clients.delete(res)
    }
  }
}

// 這個 server 自己的寫入——直接廣播，不必等 fs.watch。
onChange(note)

let watcher: FSWatcher | null = null

function startWatching(): void {
  if (watcher) return
  try {
    watcher = watch(WATCH_DIR, { persistent: false }, (_evt, filename) => {
      if (!filename) return
      const topic = FILE_TOPIC[filename.toString()]
      if (topic) note(topic)
    })
    watcher.on('error', () => {
      // 監看掛了（資料夾被刪之類）——關掉，前端會退回輪詢，不讓 server 崩。
      try {
        watcher?.close()
      } catch {
        /* ignore */
      }
      watcher = null
    })
  } catch {
    watcher = null
  }
}

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  startWatching()

  app.get('/events', (req, reply) => {
    reply.hijack() // 這條由我們自己寫 raw response、長連線不結束
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // 別讓中間的反向代理（nginx 等）緩衝
    })
    res.write('retry: 3000\n\n')
    res.write(': connected\n\n')
    clients.add(res)

    // 這條 SSE 本身就是「這個人現在開著牆」的訊號——借來記連線／斷線，見
    // connections.ts（同一人開好幾個分頁只算一次連線；換頁那種瞬斷瞬連有寬限）。
    const author = authorFrom(req)
    const key = identityKey(author, clientIp(req))
    connectionOpened(key, author)

    // 25 秒一次 keep-alive 註解行——擋掉 proxy / 瀏覽器的閒置逾時。
    const keepAlive = setInterval(() => {
      try {
        res.write(': ka\n\n')
      } catch {
        /* 下面 close 會清掉 */
      }
    }, 25_000)

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return // close 和 error 都可能觸發，只收一次
      cleaned = true
      clearInterval(keepAlive)
      clients.delete(res)
      connectionClosed(key, author)
    }
    req.raw.on('close', cleanup)
    req.raw.on('error', cleanup)
  })
}
