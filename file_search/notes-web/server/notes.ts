import type { FastifyPluginAsync } from 'fastify'
import {
  advanceRepeat,
  clearTagColor,
  createNote,
  createNotes,
  deleteNote,
  deleteNotes,
  dueSummary,
  dueSummaryAll,
  emptyTrash,
  exportNotesJson,
  getAppSettings,
  getNote,
  getReminderSettings,
  getTagColors,
  importNotesJson,
  listNotes,
  listSnapshots,
  listTrash,
  patchAppSettings,
  pruneTrash,
  purgeNote,
  restoreNote,
  restoreSnapshot,
  setNotePinned,
  setReminderSettings,
  setTagColor,
  tagCounts,
  toggleNoteLine,
  updateNote,
  updateNotesTag,
} from './store'

// due_at 是給桌面版 parse_due_date() 讀的存檔格式——當天 23:59:59 的完整 ISO
// datetime（不是單純 YYYY-MM-DD），或空字串代表沒有到期日。前端 <input
// type="date"> 拿到的 YYYY-MM-DD 由 lib/dueDate.ts 的 toStoredDueAt() 轉成
// 這個格式再送出，兩邊共用同一份 .sticky_notes.json，格式要一致，桌面版
// 才讀得懂、才會照同一套「到期日當天過完才算逾期」邏輯判斷。
const DUE_AT_PATTERN = '^$|^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$'

// 四個到期通知管道開關的 body schema——/reminder-settings 跟 /settings 共用。
const ALARM_CHANNELS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    wallpaperToast: { type: 'boolean' },
    wallpaperBadge: { type: 'boolean' },
    nodeRedAlarm: { type: 'boolean' },
    nodeRedDigest: { type: 'boolean' },
  },
} as const

const noteBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 200 },
    body: { type: 'string', maxLength: 10_000 },
    tag: { type: 'string', maxLength: 60 },
    due_at: { type: 'string', pattern: DUE_AT_PATTERN },
    repeat: { type: 'string', enum: ['', 'daily', 'weekly', 'monthly', 'weekday'] },
  },
} as const

export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notes', async () => ({ notes: listNotes() }))

  app.get('/tags', async () => ({ tags: tagCounts() }))

  // 給外部排程/自動化拉取的到期提醒摘要（例如 Node-RED 定時輪詢，自己接
  // 後面要發 Discord/LINE 或其他通知）——純讀取，這支 app 不主動推播任何
  // 東西。回應格式見 store.ts 的 DueSummary。「快到期」的門檻讀自
  // reminder-settings，Node-RED 不需要另外知道這個設定存在。
  //
  // 預設只看「這個 request 的 x-note-collection」指到的那份（沒帶標頭＝生活）。
  // `?scope=all`＝生活＋研究生兩份合起來（桌面牆的角標／鬧鐘用這個），每則多一個
  // collection 欄位。回應一律夾帶 `alarms`（四個通知管道目前的開關）。
  //
  // `?channel=nodeRedAlarm|nodeRedDigest`＝便利參數給 Node-RED：那個管道被關掉時
  // server 直接回空的 overdue/soon，下游 function「都是空的就 return null」的既有
  // 邏輯就等於整條靜音，flow 不用自己判 flag。桌面牆兩個管道（toast/badge）由
  // wallpaper-app 自己讀 `alarms` 判斷（一個 request 對兩個管道，沒法用參數切）。
  app.get<{ Querystring: { scope?: string; channel?: string } }>(
    '/notes/due-soon',
    async (req) => {
      const summary = req.query.scope === 'all' ? dueSummaryAll() : dueSummary()
      const ch = req.query.channel
      if ((ch === 'nodeRedAlarm' || ch === 'nodeRedDigest') && !summary.alarms[ch]) {
        return { ...summary, overdue: [], soon: [] }
      }
      return summary
    },
  )

  // 「快到期」門檻——使用者在設定視窗調整，卡片標色跟 due-soon 都用同一份。
  app.get('/reminder-settings', async () => getReminderSettings())

  app.patch<{
    Body: {
      dueSoonHours?: number
      dueAlarmChannels?: Partial<{
        wallpaperToast: boolean
        wallpaperBadge: boolean
        nodeRedAlarm: boolean
        nodeRedDigest: boolean
      }>
    }
  }>(
    '/reminder-settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dueSoonHours: { type: 'number', minimum: 1, maximum: 720 },
            // 四個到期通知管道的開關（true＝開）；卡片紅／黃標色不受影響
            dueAlarmChannels: ALARM_CHANNELS_SCHEMA,
          },
        },
      },
    },
    async (req) => setReminderSettings(req.body),
  )

  // 全域設定（標籤排序、預設便利貼顏色、牆面版面）——dueSoonHours 也在裡面，
  // 但保留 /reminder-settings 舊路由不動，這支給「全域設定」對話框用。
  app.get('/settings', async () => getAppSettings())

  app.patch<{
    Body: {
      dueAlarmChannels?: Partial<{
        wallpaperToast: boolean
        wallpaperBadge: boolean
        nodeRedAlarm: boolean
        nodeRedDigest: boolean
      }>
      tagSort?: { mode?: 'count' | 'manual' | 'recent'; order?: string[] }
      defaultNoteColor?: string
      wall?: { minColWidth?: number; masonry?: boolean }
      embedModel?: string
      trashRetentionDays?: number
      trashMaxCount?: number
      thesisProjectDir?: string
      thesisSeedPerFileChars?: number
      thesisSeedTotalChars?: number
      thesisSeedMaxFiles?: number
    }
  }>(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dueAlarmChannels: ALARM_CHANNELS_SCHEMA,
            tagSort: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mode: { type: 'string', enum: ['count', 'manual', 'recent'] },
                order: { type: 'array', maxItems: 300, items: { type: 'string', maxLength: 60 } },
              },
            },
            defaultNoteColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            // 空字串是合法的「恢復預設」意圖；上限給寬一點，coerce 會再夾成 120
            embedModel: { type: 'string', maxLength: 200 },
            // 0＝關掉那道門檻；coerce 會夾範圍
            trashRetentionDays: { type: 'number', minimum: 0, maximum: 3650 },
            trashMaxCount: { type: 'number', minimum: 0, maximum: 100000 },
            thesisProjectDir: { type: 'string', maxLength: 500 },
            thesisSeedPerFileChars: { type: 'number', minimum: 1000, maximum: 60000 },
            thesisSeedTotalChars: { type: 'number', minimum: 2000, maximum: 300000 },
            thesisSeedMaxFiles: { type: 'number', minimum: 1, maximum: 40 },
            wall: {
              type: 'object',
              additionalProperties: false,
              properties: {
                minColWidth: { type: 'number', minimum: 160, maximum: 520 },
                masonry: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    async (req) => patchAppSettings(req.body),
  )

  // 標籤自訂顏色——沒自訂過的標籤不會出現在回應裡，前端 colorForTag() 拿不
  // 到就照舊退回雜湊配色。
  app.get('/tag-colors', async () => getTagColors())

  app.patch<{ Body: { tag?: string; color?: string } }>(
    '/tag-colors',
    {
      schema: {
        body: {
          type: 'object',
          required: ['tag', 'color'],
          properties: {
            tag: { type: 'string', minLength: 1, maxLength: 60 },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          },
        },
      },
    },
    async (req) => setTagColor(req.body.tag ?? '', req.body.color ?? ''),
  )

  // Fastify 的路由器本來就會先解碼路徑參數，這裡不用再 decodeURIComponent
  // 一次——標籤名稱含 % 的話再解一次反而會壞掉（雙重解碼）。
  app.delete<{ Params: { tag: string } }>('/tag-colors/:tag', async (req) =>
    clearTagColor(req.params.tag),
  )

  app.get<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const note = getNote(req.params.id)
    if (!note) return reply.code(404).send({ error: 'not found' })
    return { note }
  })

  app.post<{
    Body: { title?: string; body?: string; tag?: string; due_at?: string; repeat?: string }
  }>(
    '/notes',
    { schema: { body: { ...noteBody, required: ['title'] } } },
    async (req, reply) => {
      const title = (req.body.title ?? '').trim()
      if (!title) return reply.code(422).send({ error: '標題不能留空' })
      const note = createNote({
        title,
        body: req.body.body,
        tag: req.body.tag,
        due_at: req.body.due_at,
        repeat: req.body.repeat,
      })
      return reply.code(201).send({ note })
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { title?: string; body?: string; tag?: string; due_at?: string; repeat?: string }
  }>(
    '/notes/:id',
    { schema: { body: noteBody } },
    async (req, reply) => {
      if (req.body.title !== undefined && !req.body.title.trim()) {
        return reply.code(422).send({ error: '標題不能留空' })
      }
      const note = updateNote(req.params.id, req.body)
      if (!note) return reply.code(404).send({ error: 'not found' })
      return { note }
    },
  )

  app.delete<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const ok = deleteNote(req.params.id)
    if (!ok) return reply.code(404).send({ error: 'not found' })
    return reply.code(204).send()
  })

  // 釘選／取消釘選——排到清單最上面。獨立端點（不是 PATCH /notes/:id）：
  // 釘選是排序偏好，不算「編輯」，不更新 created_at（見 store.ts setNotePinned）。
  app.post<{ Params: { id: string }; Body: { pinned?: boolean } }>(
    '/notes/:id/pin',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pinned'],
          properties: { pinned: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const note = setNotePinned(req.params.id, req.body.pinned ?? false)
      if (!note) return reply.code(404).send({ error: 'not found' })
      return { note }
    },
  )

  // 「這次完成」——把重複便利貼的 due_at 滾到下一次、內文 [x] 清回 [ ]。
  // 獨立端點，不算「編輯」，不更新 created_at（見 store.ts advanceRepeat）。
  app.post<{ Params: { id: string } }>('/notes/:id/advance-repeat', async (req, reply) => {
    const note = advanceRepeat(req.params.id)
    if (!note) return reply.code(404).send({ error: 'not found' })
    return { note }
  })

  // 牆上／詳細視窗直接點便利貼裡的待辦方框——切換那一行的 [x] 勾選。
  // 走獨立端點（不是 PATCH /notes/:id）是因為打勾不算「編輯」，不更新
  // created_at、不把便利貼推回牆頂（見 store.ts toggleNoteLine）。
  app.post<{ Params: { id: string }; Body: { srcIndex?: number } }>(
    '/notes/:id/toggle-line',
    {
      schema: {
        body: {
          type: 'object',
          required: ['srcIndex'],
          properties: { srcIndex: { type: 'integer', minimum: 0, maximum: 9999 } },
        },
      },
    },
    async (req, reply) => {
      const note = toggleNoteLine(req.params.id, req.body.srcIndex ?? 0)
      if (!note) return reply.code(404).send({ error: 'not found' })
      return { note }
    },
  )

  // ── 垃圾桶（靜態路徑 /notes/trash*，Fastify 會排在 /notes/:id 前面比對，
  //    不會被吃掉）── 「刪除」上面已經改成移到這裡，這幾支負責復原／永久刪除。

  app.get('/notes/trash', async () => {
    pruneTrash() // 開垃圾桶前先套一次自動清理（過期／超量的最舊那批永久刪）
    return { notes: listTrash() }
  })

  app.post<{ Params: { id: string } }>('/notes/trash/:id/restore', async (req, reply) => {
    const note = restoreNote(req.params.id)
    if (!note) return reply.code(404).send({ error: 'not found' })
    return { note }
  })

  app.delete<{ Params: { id: string } }>('/notes/trash/:id', async (req, reply) => {
    const ok = purgeNote(req.params.id)
    if (!ok) return reply.code(404).send({ error: 'not found' })
    return reply.code(204).send()
  })

  app.delete('/notes/trash', async () => ({ removed: emptyTrash() }))

  // ── 版本記錄（時光機）──（靜態路徑，排在 /notes/:id 前面比對）
  // 每次便利貼有實質變動就自動存一份時間戳快照，可整份還原到某個版本
  // （連垃圾桶）——給垃圾桶救不回來的情況用。見 store.ts 的 snapshotHistory。

  app.get('/notes/history', async () => ({ snapshots: listSnapshots() }))

  app.post<{ Params: { id: string } }>('/notes/history/:id/restore', async (req, reply) => {
    const ok = restoreSnapshot(req.params.id)
    if (!ok) return reply.code(404).send({ error: 'not found' })
    return { ok: true }
  })

  // ── 批次 ──（靜態路徑，Fastify 會排在 /notes/:id 前面比對，不會被吃掉）

  app.post<{ Body: { tag?: string; count?: number; titlePrefix?: string } }>(
    '/notes/bulk',
    {
      schema: {
        body: {
          type: 'object',
          required: ['count'],
          properties: {
            tag: { type: 'string', maxLength: 60 },
            count: { type: 'integer', minimum: 1, maximum: 50 },
            titlePrefix: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const tag = (req.body.tag ?? '').trim()
      const n = req.body.count ?? 1
      const prefix = (req.body.titlePrefix ?? '').trim() || tag || '便利貼'
      const items = Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1}`, tag }))
      return reply.code(201).send({ created: createNotes(items) })
    },
  )

  app.post<{ Body: { ids?: string[]; tag?: string } }>(
    '/notes/bulk-recategorize',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, maxItems: 2000 },
            tag: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
    async (req) => ({ updated: updateNotesTag(req.body.ids ?? [], req.body.tag ?? '') }),
  )

  app.post<{ Body: { ids?: string[] } }>(
    '/notes/bulk-delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, maxItems: 2000 },
          },
        },
      },
    },
    async (req) => ({ deleted: deleteNotes(req.body.ids ?? []) }),
  )

  // ── 匯出／匯入（搬家／備份用，JSON，跟桌面版格式互通）──────────────

  app.get('/notes/export', async () => ({ content: exportNotesJson() }))

  app.post<{ Body: { content?: string } }>(
    '/notes/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: { content: { type: 'string', maxLength: 50_000_000 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return importNotesJson(req.body.content ?? '')
      } catch (err) {
        return reply.code(422).send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )
}
