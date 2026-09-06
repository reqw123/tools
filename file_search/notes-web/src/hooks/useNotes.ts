import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Note, type NoteInput } from '../lib/api'

const KEY = ['notes'] as const
const TRASH_KEY = ['notes-trash'] as const

/** 便利貼清單——單一資料來源。任何新增／編輯／刪除成功後都會讓它重抓，
 *  所以 UI（整面牆、分類 chip、統計數字）會自動跟著資料變。 */
export function useNotes() {
  return useQuery({ queryKey: KEY, queryFn: api.list })
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
