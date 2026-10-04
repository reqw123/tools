import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ListTodo } from 'lucide-react'
import type { Note, TagColors } from '../lib/api'
import { colorForTag } from '../lib/color'
import { dueLabel, dueStatus, parseBody } from '../lib/format'
import { useReminderSettings, useToggleNoteLine } from '../hooks/useNotes'
import { scrimClose } from '../lib/scrimClose'

/**
 * 待辦總表：把所有便利貼裡的待辦（內容裡每一行、填空欄除外——規則同卡片，見 lib/format.ts 的
 * parseBody）集中成一張清單，依便利貼分組。直接在這裡勾，走跟卡片一樣的 useToggleNoteLine，
 * 會同步回原本的便利貼。
 *
 * - 預設只列未完成；這次打開後剛勾掉的會留在原位（劃線、淡出），不會一勾就消失——勾錯了還能取消。
 * - 排序：已逾期 → 快到期 → 其他有到期日的（由早到晚）→ 沒有到期日的（未完成多的在前）。順序在打開時
 *   定下來，勾的過程中不重排（不然勾一項、整組就跳走）。
 * - 可以只看某個分類（便利貼多半是筆記時，每一行都算待辦，清單會很長）。
 * - 點便利貼標題＝打開那則便利貼（關掉總表）。
 */
interface Item {
  srcIndex: number
  text: string
  checked: boolean
}
interface Group {
  note: Note
  items: Item[]
  open: number
  total: number
}

function buildGroups(notes: Note[]): Group[] {
  const out: Group[] = []
  for (const note of notes) {
    const p = parseBody(note.body)
    if (!('lines' in p)) continue
    const items = p.lines
      .filter((l) => l.kind === 'task')
      .map((l) => ({ srcIndex: l.srcIndex, text: l.text, checked: !!l.checked }))
    if (items.length) out.push({ note, items, open: items.filter((i) => !i.checked).length, total: items.length })
  }
  return out
}

/** 打開當下的分組順序（便利貼 id → 名次）。 */
function initialOrder(groups: Group[], soonHours?: number): Map<string, number> {
  const rank = (g: Group) => {
    const s = dueStatus(g.note.due_at, soonHours)
    return s === 'overdue' ? 0 : s === 'soon' ? 1 : g.note.due_at ? 2 : 3
  }
  const sorted = [...groups].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.note.due_at && b.note.due_at ? a.note.due_at.localeCompare(b.note.due_at) : 0) ||
      b.open - a.open ||
      b.note.created_at.localeCompare(a.note.created_at),
  )
  return new Map(sorted.map((g, i) => [g.note.id, i]))
}

export function TodoOverviewDialog({
  notes,
  tagColors,
  onOpenNote,
  onClose,
}: {
  notes: Note[]
  tagColors?: TagColors
  onOpenNote: (n: Note) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const toggle = useToggleNoteLine()
  const { data: reminder } = useReminderSettings()
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [tag, setTag] = useState('')
  // 打開當下的分組順序——之後勾選讓未完成數變了也不重排；新出現的組排在最後
  const [order] = useState(() => initialOrder(buildGroups(notes), reminder?.dueSoonHours))
  // 這次打開後勾／取消過的項目——就算已完成也先留在清單上
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // 全部便利貼 → 有待辦的分組（不看搜尋，用來算總數），照打開當下的順序
  const all = useMemo<Group[]>(
    () => buildGroups(notes).sort((a, b) => (order.get(a.note.id) ?? Infinity) - (order.get(b.note.id) ?? Infinity)),
    [notes, order],
  )

  const tags = useMemo(
    () => [...new Set(all.map((g) => g.note.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [all],
  )

  const totalOpen = all.reduce((n, g) => n + g.open, 0)
  const totalDone = all.reduce((n, g) => n + g.items.length - g.open, 0)
  const notesWithOpen = all.filter((g) => g.open > 0).length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((g) => !tag || g.note.tag === tag)
      .map((g) => {
        const noteHit = !!q && (g.note.title.toLowerCase().includes(q) || g.note.tag.toLowerCase().includes(q))
        const items = g.items.filter(
          (i) =>
            (showDone || !i.checked || touched.has(`${g.note.id}:${i.srcIndex}`)) &&
            (!q || noteHit || i.text.toLowerCase().includes(q)),
        )
        return { ...g, items }
      })
      .filter((g) => g.items.length > 0)
  }, [all, query, showDone, touched, tag])

  const flip = (note: Note, item: Item) => {
    setTouched((s) => new Set(s).add(`${note.id}:${item.srcIndex}`))
    toggle.mutate({ id: note.id, srcIndex: item.srcIndex })
  }

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="sheet plain wide todo-overview"
        role="dialog"
        aria-modal="true"
        aria-label="待辦總表"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2 className="todo-head">
          <ListTodo size={24} strokeWidth={2} aria-hidden /> 待辦總表
        </h2>
        <p className="todo-stats">
          未完成 <b>{totalOpen}</b> 項 · 分佈在 <b>{notesWithOpen}</b> 則便利貼 · 已完成 {totalDone} 項
        </p>

        <div className="todo-controls">
          <input
            className="bd-search"
            type="search"
            value={query}
            placeholder="搜尋待辦、便利貼標題、分類…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="todo-tagpick" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="只看某個分類">
            <option value="">全部分類</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="todo-showdone">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            顯示已完成
          </label>
        </div>

        <div className="todo-groups">
          {shown.map((g) => {
            const due = dueStatus(g.note.due_at, reminder?.dueSoonHours)
            return (
              <section
                key={g.note.id}
                className="todo-group"
                style={{ '--todo-chip': colorForTag(g.note.tag, tagColors) } as CSSProperties}
              >
                <header>
                  <button type="button" className="todo-note" onClick={() => onOpenNote(g.note)} title="打開這則便利貼">
                    {g.note.title || '（無標題）'}
                  </button>
                  {g.note.tag && <span className="todo-tag"># {g.note.tag}</span>}
                  {g.note.due_at && (
                    <span className={`todo-due ${due}`}>
                      {due === 'overdue' ? '⏰ 已逾期 ' : due === 'soon' ? '⏳ ' : ''}
                      {dueLabel(g.note.due_at)}
                    </span>
                  )}
                  <span className={`todo-count${g.open ? '' : ' all-done'}`}>
                    {g.open ? `${g.open} 項未完成` : '全部完成'} · 共 {g.total}
                  </span>
                </header>
                <ul>
                  {g.items.map((it) => (
                    <li key={it.srcIndex} className={it.checked ? 'done' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={it.checked}
                          onChange={() => flip(g.note, it)}
                          aria-label={it.text || '待辦項'}
                        />
                        <span>{it.text || '（空白）'}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {shown.length === 0 && (
            <p className="todo-empty">
              {query.trim()
                ? '沒有符合的待辦'
                : all.length === 0
                  ? '還沒有待辦——便利貼內容寫成多行，每一行就是一個待辦'
                  : '全部完成了 🎉'}
            </p>
          )}
        </div>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
