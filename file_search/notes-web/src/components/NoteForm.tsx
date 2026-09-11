import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { REPEAT_LABELS, type NoteInput, type TagColors } from '../lib/api'
import { colorForTag } from '../lib/color'
import { fromStoredDueAt, timeFromStoredDueAt, toStoredDueAt } from '../lib/format'
import {
  TAG_COLORS_KEY, useClearTagColor, useSetTagColor, useTagColors,
} from '../hooks/useNotes'
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
  /** 編輯時 input 只帶「跟開啟當下相比真的改過」的欄位（多人共用：別人同時改
   *  同一則的其他欄位就不會被蓋掉，server 端 updateNote 逐欄 merge）。新增時帶滿。 */
  onSubmit: (input: Partial<NoteInput>) => void
  onCancel: () => void
}) {
  const isNew = !initial
  const [title, setTitle] = useState(initial?.title ?? '')
  const [tag, setTag] = useState(initial?.tag ?? defaultTag ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [dueDate, setDueDate] = useState(fromStoredDueAt(initial?.due_at ?? ''))
  const [dueTime, setDueTime] = useState(timeFromStoredDueAt(initial?.due_at ?? ''))
  const [repeat, setRepeat] = useState(initial?.repeat ?? '')
  const [touched, setTouched] = useState(false)

  // 開啟當下的原始值——送出時比對，只送改過的欄位。跟上面各 state 的初值一致。
  const baseline = useMemo<NoteInput>(
    () => ({
      title: initial?.title ?? '',
      tag: initial?.tag ?? defaultTag ?? '',
      body: initial?.body ?? '',
      due_at: initial?.due_at ?? '',
      repeat: initial?.repeat ?? '',
    }),
    // 只在掛載時算一次；prop 之後變了也不動（那是「別人改的」，不該當成 baseline）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const titleError = touched && !title.trim() ? '標題不能留空' : ''

  const trimmedTag = tag.trim()
  const { data: tagColors } = useTagColors()
  const setTagColor = useSetTagColor()
  const clearTagColor = useClearTagColor()
  const hasColorOverride = !!trimmedTag && !!tagColors?.[trimmedTag]

  // <input type="color"> 的 React onChange 對應的是 `input` 事件，使用者在
  // 原生調色盤裡拖曳時會連續觸發——直接在那裡 mutate 會對後端狂送 PATCH、
  // 狂重寫 .sticky_tag_colors.json。折衷：拖曳時「只」更新本地的 tag-colors
  // query 快取（樂觀更新），牆上同分類的便利貼就能即時跟著變色；真正的 PATCH
  // 只在原生 `change`（關閉調色盤）或欄位失焦時送出一次。
  const qc = useQueryClient()
  const swatchRef = useRef<HTMLInputElement>(null)
  const [draftColor, setDraftColor] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const resolvedColor = trimmedTag ? colorForTag(trimmedTag, tagColors) : '#e5e7eb'

  // 拖曳中：本地即時預覽（swatch 自己 + 牆上同分類卡片）。
  const previewTagColor = (color: string) => {
    setDraftColor(color)
    if (!trimmedTag) return
    pendingRef.current = color
    qc.setQueryData<TagColors>(TAG_COLORS_KEY, (old) => ({ ...(old ?? {}), [trimmedTag]: color }))
  }

  // 把還沒送出的顏色真的寫回後端。呼叫點：原生 change（關閉調色盤）、
  // swatch 失焦、切換分類/卸載時的 effect cleanup。
  const commitTagColor = () => {
    const color = pendingRef.current
    pendingRef.current = null
    setDraftColor(null)
    if (color && trimmedTag) setTagColor.mutate({ tag: trimmedTag, color })
  }

  useEffect(() => {
    setDraftColor(null)
    pendingRef.current = null
    const el = swatchRef.current
    if (!el) return
    el.addEventListener('change', commitTagColor)
    return () => {
      el.removeEventListener('change', commitTagColor)
      commitTagColor()
    }
    // setTagColor.mutate 在 react-query 裡跨 render 穩定，只需要跟著 trimmedTag 重掛。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedTag])

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!title.trim()) return
        const full: NoteInput = {
          title: title.trim(),
          tag: tag.trim(),
          body,
          due_at: toStoredDueAt(dueDate, dueTime),
          repeat: dueDate ? repeat : '', // 沒有到期日就沒有「重複」概念
        }
        if (isNew) {
          onSubmit(full)
          return
        }
        // 編輯：只送改過的欄位
        const patch: Partial<NoteInput> = {}
        for (const k of ['title', 'tag', 'body', 'due_at', 'repeat'] as const) {
          if (full[k] !== baseline[k]) patch[k] = full[k]
        }
        onSubmit(patch)
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
            ref={swatchRef}
            type="color"
            className="tag-color-swatch"
            // 空標籤沒有顏色概念可以自訂，用中性灰佔位並停用整顆輸入框。
            value={trimmedTag ? (draftColor ?? resolvedColor) : '#e5e7eb'}
            disabled={!trimmedTag}
            title={trimmedTag ? `自訂「${trimmedTag}」的顏色` : '請先輸入分類名稱'}
            // 拖曳中只做即時預覽（含牆上同分類卡片）；實際 PATCH 交給
            // effect 掛的原生 `change`，或這裡的 onBlur。
            onChange={(e) => previewTagColor(e.target.value)}
            onBlur={commitTagColor}
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
        到期日（可留空；填了時間就精確到分提醒，時間留空＝當天內到期）
        <div className="due-row">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <input
            type="time"
            value={dueTime}
            disabled={!dueDate}
            title={dueDate ? '到期時間（可留空＝當天內）' : '先選日期'}
            onChange={(e) => setDueTime(e.target.value)}
          />
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
          {(dueDate || dueTime) && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                setDueDate('')
                setDueTime('')
                setRepeat('')
              }}
            >
              清除
            </button>
          )}
        </div>
        {dueDate && (
          <span className="due-repeat">
            🔁 重複
            <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              {Object.entries(REPEAT_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            {repeat && (
              <span className="hint">
                之後在便利貼上按「這次完成」，到期日就自動排下一次、清單重新開始。
              </span>
            )}
          </span>
        )}
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
