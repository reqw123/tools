import { useState } from 'react'
import type { NoteInput } from '../lib/api'
import { TagInput } from './TagInput'

export function NoteForm({
  initial,
  defaultTag,
  knownTags,
  submitLabel,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<NoteInput>
  /** 新增便利貼時，分類欄預設帶這個（批次新增選過的分類）。 */
  defaultTag?: string
  knownTags: string[]
  submitLabel: string
  submitting: boolean
  serverError?: string
  onSubmit: (input: NoteInput) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [tag, setTag] = useState(initial?.tag ?? defaultTag ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [touched, setTouched] = useState(false)

  const titleError = touched && !title.trim() ? '標題不能留空' : ''

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!title.trim()) return
        onSubmit({ title: title.trim(), tag: tag.trim(), body })
      }}
    >
      <label>
        標題
        <input
          value={title}
          autoFocus
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {titleError && <span className="err">{titleError}</span>}
      </label>

      <label>
        分類（可留空；跟既有分類同名會套用同一個顏色）
        {defaultTag && tag === defaultTag && !initial && (
          <span className="hint">已帶入預設分類「{defaultTag}」，可改</span>
        )}
        <TagInput
          value={tag}
          onChange={setTag}
          knownTags={knownTags}
          maxLength={60}
          placeholder="例如：每日、待辦、購物"
        />
      </label>

      <label>
        內容（可多行；一行一項會顯示成清單，以「：」結尾的行會變成填空欄）
        <textarea value={body} maxLength={10_000} onChange={(e) => setBody(e.target.value)} />
      </label>

      {serverError && <span className="err">{serverError}</span>}

      <div className="sheet-actions">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? '儲存中…' : submitLabel}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={submitting}>
          取消
        </button>
      </div>
    </form>
  )
}
