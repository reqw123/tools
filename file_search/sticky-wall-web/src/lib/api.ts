export interface Note {
  id: string
  title: string
  body: string
  tag: string
  /** 插圖檔名（後端 `.sticky_note_images/` 底下）；'' = 沒有圖。用 `noteImageUrl()` 轉成 URL。 */
  image: string
  /** 建立時間；「編輯視同重新建立」，所以其實是「最後動過的時間」。插圖不算「動過」，設圖不會更新它。 */
  created_at: string
}

/** note.image → 原圖 URL（點開的編輯視窗 `sheet-img` 用這個）；沒有圖回 null。 */
export function noteImageUrl(note: Pick<Note, 'image'>): string | null {
  return note.image ? `/note-images/${encodeURIComponent(note.image)}` : null
}

/**
 * 牆上的卡片 / 懸浮視窗用的縮圖 URL——server 現生現快取的 webp（見
 * `server/note-thumb.ts`）。`w` 只有 400 / 800 兩檔，搭 `srcSet` 讓瀏覽器
 * 依實際顯示寬與 DPR 自己挑。牆上一張圖顯示寬 ~220px，800 就夠 2x。
 */
export function noteThumbUrl(note: Pick<Note, 'image'>, w: 400 | 800): string | null {
  return note.image ? `/api/note-thumb/${encodeURIComponent(note.image)}?w=${w}` : null
}

export interface NoteInput {
  title: string
  body: string
  tag: string
}

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export const api = {
  list: () => req<{ notes: Note[] }>('/notes').then((r) => r.notes),
  create: (input: NoteInput) =>
    req<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.note,
    ),
  update: (id: string, patch: Partial<NoteInput>) =>
    req<{ note: Note }>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
      (r) => r.note,
    ),
  remove: (id: string) => req<void>(`/notes/${id}`, { method: 'DELETE' }),
  setImage: (id: string, srcPath: string) =>
    req<{ note: Note }>(`/notes/${id}/image`, {
      method: 'POST',
      body: JSON.stringify({ srcPath }),
    }).then((r) => r.note),
  removeImage: (id: string) =>
    req<{ note: Note }>(`/notes/${id}/image`, { method: 'DELETE' }).then((r) => r.note),
  bulkCreate: (input: { tag: string; count: number; titlePrefix?: string }) =>
    req<{ created: Note[] }>('/notes/bulk', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.created),
  bulkDelete: (ids: string[]) =>
    req<{ deleted: number }>('/notes/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }).then((r) => r.deleted),
}
