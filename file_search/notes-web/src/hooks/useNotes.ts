import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AppSettings, type AppSettingsPatch, type Note, type NoteInput } from '../lib/api'
import { toggleBodyLine } from '../lib/format'
import { useLiveConnected } from '../lib/liveSync'
import { useShareInfo } from './useShareInfo'

const KEY = ['notes'] as const
const TRASH_KEY = ['notes-trash'] as const

/** 便利貼清單——單一資料來源。任何新增／編輯／刪除成功後都會讓它重抓，
 *  所以 UI（整面牆、分類 chip、統計數字）會自動跟著資料變。
 *  即時同步靠 SSE（`useLiveSync`）推播；SSE 斷線時，共用模式退回 8 秒輪詢當備援。 */
export function useNotes() {
  const share = useShareInfo()
  const shared = share.mode === 'lan'
  const live = useLiveConnected()
  return useQuery({
    queryKey: KEY,
    queryFn: api.list,
    refetchInterval: live ? false : shared ? 8_000 : false,
    refetchOnWindowFocus: shared,
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NoteInput) => api.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<NoteInput> }) =>
      api.update(id, patch),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old) =>
        old?.map((n) => (n.id === note.id ? note : n)),
      )
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useSetNoteImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, srcPath }: { id: string; srcPath: string }) => api.setImage(id, srcPath),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old) => old?.map((n) => (n.id === note.id ? note : n)))
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

/** 從瀏覽器上傳圖片檔換圖（區網共用模式；一般模式用 useSetNoteImage 選本機路徑）。 */
export function useUploadNoteImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.uploadImage(id, file),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old) => old?.map((n) => (n.id === note.id ? note : n)))
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

/** 牆上／詳細視窗點便利貼裡的待辦方框——切換那一行的 [x]。樂觀更新：先在
 *  本地翻好，回應/失敗再校正。打勾不算「編輯」，不動 created_at、牆上位置
 *  不變（見 server/store.ts toggleNoteLine）。 */
export function useToggleNoteLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, srcIndex }: { id: string; srcIndex: number }) =>
      api.toggleLine(id, srcIndex),
    onMutate: async ({ id, srcIndex }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Note[]>(KEY)
      qc.setQueryData<Note[]>(KEY, (old) =>
        old?.map((n) => (n.id === id ? { ...n, body: toggleBodyLine(n.body, srcIndex) } : n)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
    },
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old) => old?.map((n) => (n.id === note.id ? note : n)))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** 釘選／取消釘選——排到牆頂。樂觀更新：本地先翻 pinned 並照 server 同一套
 *  規則重排，失敗再還原。釘選不算「編輯」，不動 created_at。 */
export function useSetNotePinned() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.setPinned(id, pinned),
    onMutate: async ({ id, pinned }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Note[]>(KEY)
      qc.setQueryData<Note[]>(KEY, (old) =>
        old
          ?.map((n) => (n.id === id ? { ...n, pinned } : n))
          .sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0),
          ),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** 「這次完成」——重複便利貼的 due_at 滾到下一次、內文 [x] 清回 [ ]。不算
 *  「編輯」，不動 created_at、牆上位置不變（見 server/store.ts advanceRepeat）。 */
export function useAdvanceRepeat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.advanceRepeat(id),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old) => old?.map((n) => (n.id === note.id ? note : n)))
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useRemoveNoteImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeImage(id),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(KEY, (old) => old?.map((n) => (n.id === note.id ? note : n)))
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    // 「刪除」現在是移到垃圾桶（見 server/store.ts deleteNote），不是真的消失。
    mutationFn: (id: string) => api.remove(id),
    // 樂觀更新：先從畫面拿掉，失敗再還原。
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Note[]>(KEY)
      qc.setQueryData<Note[]>(KEY, (old) => old?.filter((n) => n.id !== id))
      return { prev }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: TRASH_KEY })
    },
  })
}

// ── 垃圾桶 ───────────────────────────────────────────────────────

export function useTrash() {
  return useQuery({ queryKey: TRASH_KEY, queryFn: api.trash })
}

export function useRestoreNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: TRASH_KEY })
    },
  })
}

export function usePurgeNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.purge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRASH_KEY }),
  })
}

export function useEmptyTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.emptyTrash(),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRASH_KEY }),
  })
}

// ── 版本記錄（時光機）─────────────────────────────────────────────

const HISTORY_KEY = ['notes-history'] as const

export function useHistory() {
  return useQuery({ queryKey: HISTORY_KEY, queryFn: api.history })
}

export function useRestoreSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.restoreHistory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: TRASH_KEY })
      qc.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}

const REMINDER_SETTINGS_KEY = ['reminder-settings'] as const

/** 「快到期」門檻——卡片標色跟 dueOnly 篩選都讀這個。staleTime 給長一點，
 *  這種偏好設定不太可能被別的視窗同時改，沒必要每次切換分類/搜尋都重抓。 */
export function useReminderSettings() {
  return useQuery({
    queryKey: REMINDER_SETTINGS_KEY,
    queryFn: api.getReminderSettings,
    staleTime: 60_000,
  })
}

export function useSetReminderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.setReminderSettings>[0]) =>
      api.setReminderSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData(REMINDER_SETTINGS_KEY, settings)
      // dueSoonHours / dueAlarmChannels 跟「全域設定」其餘欄位同一份
      // .notes_settings.json——那份快取也一起帶上新值，「提醒」分頁跟讀
      // useAppSettings 的地方才不會顯示過期的值。
      qc.setQueryData<AppSettings>(APP_SETTINGS_KEY, (old) =>
        old ? { ...old, ...settings } : old,
      )
    },
  })
}

export const APP_SETTINGS_KEY = ['app-settings'] as const

/** 「全域設定」——標籤排序、預設便利貼顏色、牆面版面。staleTime 給長一點，
 *  理由同 reminder-settings：偏好設定不太會被別的視窗同時改。 */
export function useAppSettings() {
  return useQuery({
    queryKey: APP_SETTINGS_KEY,
    queryFn: api.getSettings,
    staleTime: 60_000,
  })
}

export function mergeAppSettings(old: AppSettings | undefined, patch: AppSettingsPatch) {
  if (!old) return old
  return {
    ...old,
    ...(patch.defaultNoteColor ? { defaultNoteColor: patch.defaultNoteColor } : {}),
    ...(patch.tagSort ? { tagSort: { ...old.tagSort, ...patch.tagSort } } : {}),
    ...(patch.wall ? { wall: { ...old.wall, ...patch.wall } } : {}),
    ...(patch.embedModel !== undefined ? { embedModel: patch.embedModel } : {}),
    ...(patch.trashRetentionDays !== undefined
      ? { trashRetentionDays: patch.trashRetentionDays }
      : {}),
    ...(patch.trashMaxCount !== undefined ? { trashMaxCount: patch.trashMaxCount } : {}),
    ...(patch.thesisProjectDir !== undefined
      ? { thesisProjectDir: patch.thesisProjectDir }
      : {}),
    ...(patch.thesisSeedPerFileChars !== undefined
      ? { thesisSeedPerFileChars: patch.thesisSeedPerFileChars }
      : {}),
    ...(patch.thesisSeedTotalChars !== undefined
      ? { thesisSeedTotalChars: patch.thesisSeedTotalChars }
      : {}),
    ...(patch.thesisSeedMaxFiles !== undefined
      ? { thesisSeedMaxFiles: patch.thesisSeedMaxFiles }
      : {}),
  }
}

/** 樂觀更新：牆面/橫向列跟著設定即時變（重排標籤、換預設色…），失敗再還原。 */
export function usePatchAppSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api.patchSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: APP_SETTINGS_KEY })
      const prev = qc.getQueryData<AppSettings>(APP_SETTINGS_KEY)
      qc.setQueryData<AppSettings>(APP_SETTINGS_KEY, (old) => mergeAppSettings(old, patch))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(APP_SETTINGS_KEY, ctx.prev)
    },
    onSuccess: (settings) => qc.setQueryData(APP_SETTINGS_KEY, settings),
  })
}

export const TAG_COLORS_KEY = ['tag-colors'] as const

/** 標籤自訂顏色對照表——colorForTag()/paperVars() 都要帶這個當覆寫來源。
 *  staleTime 給長一點，理由同 reminder-settings：偏好設定不太會被別的視窗
 *  同時改，沒必要每次切換分類/搜尋都重抓。 */
export function useTagColors() {
  return useQuery({
    queryKey: TAG_COLORS_KEY,
    queryFn: api.getTagColors,
    staleTime: 60_000,
  })
}

export function useSetTagColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tag, color }: { tag: string; color: string }) => api.setTagColor(tag, color),
    onSuccess: (colors) => qc.setQueryData(TAG_COLORS_KEY, colors),
  })
}

export function useClearTagColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tag: string) => api.clearTagColor(tag),
    onSuccess: (colors) => qc.setQueryData(TAG_COLORS_KEY, colors),
  })
}

export function useBulkCreateNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { tag: string; count: number; titlePrefix?: string }) =>
      api.bulkCreate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useImportNotesJson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => api.importJson(content),
    onSuccess: (r) => {
      if (r.added) qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useBulkRecategorizeNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, tag }: { ids: string[]; tag: string }) => api.bulkRecategorize(ids, tag),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useBulkDeleteNotes() {
  const qc = useQueryClient()
  return useMutation({
    // 「刪除」現在是移到垃圾桶（見 server/store.ts deleteNotes），不是真的消失。
    mutationFn: (ids: string[]) => api.bulkDelete(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Note[]>(KEY)
      const drop = new Set(ids)
      qc.setQueryData<Note[]>(KEY, (old) => old?.filter((n) => !drop.has(n.id)))
      return { prev }
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: TRASH_KEY })
    },
  })
}
