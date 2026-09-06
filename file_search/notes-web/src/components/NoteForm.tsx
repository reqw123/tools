import { useState } from 'react'
import type { NoteInput } from '../lib/api'
import { colorForTag } from '../lib/color'
import { fromStoredDueAt, toStoredDueAt } from '../lib/format'
import { useClearTagColor, useSetTagColor, useTagColors } from '../hooks/useNotes'
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
  const [dueDate, setDueDate] = useState(fromStoredDueAt(initial?.due_at ?? ''))
  const [touched, setTouched] = useState(false)

  const titleError = touched && !title.trim() ? '標題不能留空' : ''

  const trimmedTag = tag.trim()
  const { data: tagColors } = useTagColors()
  const setTagColor = useSetTagColor()
  const clearTagColor = useClearTagColor()
  const hasColorOverride = !!trimmedTag && !!tagColors?.[trimmedTag]

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!title.trim()) return
        onSubmit({ title: title.trim(), tag: tag.trim(), body, due_at: toStoredDueAt(dueDate) })
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
        分類（可留空；跟既有分類同名會套用同一個顏色，也可以按右邊色塊自訂）
        {defaultTag && tag === defaultTag && !initial && (
          <span className="hint">已帶入預設分類「{defaultTag}」，可改</span>
        )}
        <div className="tag-color-row">
          <TagInput
            value={tag}
            onChange={setTag}
            knownTags={knownTags}
            maxLength={60}
            placeholder="例如：每日、待辦、購物"
            className="tag-color-row-input"
          />
          <input
            type="color"
            className="tag-color-swatch"
            // 空標籤沒有顏色概念可以自訂，用中性灰佔位並停用整顆輸入框。
            value={trimmedTag ? colorForTag(trimmedTag, tagColors) : '#e5e7eb'}
            disabled={!trimmedTag}
            title={trimmedTag ? `自訂「${trimmedTag}」的顏色` : '請先輸入分類名稱'}
            onChange={(e) => {
              if (trimmedTag) setTagColor.mutate({ tag: trimmedTag, color: e.target.value })
            }}
          />
          {hasColorOverride && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => clearTagColor.mutate(trimmedTag)}
            >
              重設
            </button>
          )}
        </div>
      </label>

      <label>
        到期日（可留空；卡片會依到期日標色提醒）
        <div className="due-row">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          {(
            [
              ['今天', 0],
              ['明天', 1],
              ['3天後', 3],
              ['一週後', 7],
            ] as const
          ).map(([label, days]) => (
            <button
              key={label}
              type="button"
              className="btn sm ghost"
              onClick={() => {
                const d = new Date()
                d.setDate(d.getDate() + days)
                setDueDate(
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                )
              }}
            >
              {label}
            </button>
          ))}
          {dueDate && (
            <button type="button" className="btn sm ghost" onClick={() => setDueDate('')}>
              清除
            </button>
          )}
        </div>
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
