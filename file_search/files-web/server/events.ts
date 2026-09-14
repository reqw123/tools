/**
 * 即時同步——一支 SSE 端點 `GET /api/events`，加上對 `indexDir` 的
 * `fs.watch`。任何一份索引集 `.md`（不管是這個 web server 自己寫、還是
 * Tkinter 桌面版寫）被改，就推一則訊息給所有連著的瀏覽器，前端收到就把
 * 對應的 TanStack Query 標記過期、立刻重抓。機制搬自
 * `notes-web/server/events.ts`；**差異**：notes-web 只看 4 個固定檔名，這裡
 * `indexDir` 底下是任意數量、任意檔名的 `.md`，所以用副檔名＋事件類型判斷，
 * 不是精確比對檔名——`rename` 事件（新增/刪除/改名）兩個 topic 都發，
 * `change` 事件（一般編輯/批次操作）只發內容變了那個。
 *
 * SSE 斷線時前端會自己重連（`retry:`），並在斷線期間退回慢速輪詢當備援。
 */
import { watch, type FSWatcher } from 'node:fs'
import type { FastifyPluginAsync } from 'fastify'
import type { ServerResponse } from 'node:http'
import { onChange, type ChangeTopic } from './change-bus'
import { indexDir } from './store'
import { identityKey } from './identity'
import { SHARE_MODE, clientIp, displayAuthorFrom } from './share'
import { connectionClosed, connectionOpened } from './connections'

const CATEGORY_COLORS_FILE = '.index_category_colors.json'

const clients = new Set<ServerResponse>()

// 一次原子寫入會觸發好幾個 watch 事件（tmp 建立、rename…），連續操作更多——
// 收攏成一則，60ms 沒有新變動才送出。
const pending = new Set<ChangeTopic>()
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

function note(topic: ChangeTopic): void {
  pending.add(topic)
  if (!flushTimer) flushTimer = setTimeout(broadcast, 60)
}

// 這個 server 自己的寫入——直接廣播，不必等 fs.watch。
onChange(note)

let watcher: FSWatcher | null = null

function startWatching(): void {
  if (watcher) return
  try {
    watcher = watch(indexDir, { persistent: false }, (evt, filename) => {
      if (!filename) return
      const name = filename.toString()
      if (name === CATEGORY_COLORS_FILE) {
        note('index') // 分類顏色是跨索引集的設定，粗粒度併進 'index' 就好
        return
      }
      if (!name.toLowerCase().endsWith('.md')) return // 忽略 .tmp 暫存檔、`.share/` 子資料夾本身的事件等
      note('index')
      if (evt === 'rename') note('index-list') // 新增/刪除/改名——清單也要重抓
    })
    watcher.on('error', () => {
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

  app.get<{ Querystring: { deviceId?: string } }>('/events', (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    res.write(': connected\n\n')
    clients.add(res)

    // 「誰連上了」的追蹤（連帶寫 .share/visits.json）只在共用模式才有意義；
    // 離線版一樣開這條 SSE 做即時同步，但不記連線——不然離線也會往
    // indexDir（＝真正的 indexes/）底下寫東西，破壞離線／共用兩邊低耦合。
    const author = displayAuthorFrom(req)
    const key = identityKey(author, clientIp(req), req.query.deviceId)
    if (SHARE_MODE === 'lan') connectionOpened(key, author)

    const keepAlive = setInterval(() => {
      try {
        res.write(': ka\n\n')
      } catch {
        /* 下面 close 會清掉 */
      }
    }, 25_000)

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      clearInterval(keepAlive)
      clients.delete(res)
      if (SHARE_MODE === 'lan') connectionClosed(key, author)
    }
    req.raw.on('close', cleanup)
    req.raw.on('error', cleanup)
  })
}
