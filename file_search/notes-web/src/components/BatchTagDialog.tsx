import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Tags } from 'lucide-react'
import type { Note } from '../lib/api'
import { colorForTag } from '../lib/color'
import { stamp } from '../lib/format'
import { useBulkRecategorizeNotes, useTagColors } from '../hooks/useNotes'
import { scrimClose } from '../lib/scrimClose'

// 「舊標籤」欄裡代表「沒有標籤」的值——直接用這個人看得懂的字串當哨兵。
const NO_TAG = '（無標籤）'

/**
 * 批次標籤——一顆按鈕、兩種用法：
 *   • **補上空白的**：列出「沒有標籤」的便利貼（具體項目清單、可增減勾選），
 *     統一補一個標籤下去。
 *   • **舊標籤 → 新標籤**：把目前是某個標籤（或無標籤）的便利貼整批換成另一個
 *     標籤——只是換名字，不用逐則挑，所以沒有清單。
 * 兩種都只動標籤欄，標題／內容不動。
 */
export function BatchTagDialog({
  notes,
  knownTags,
  onClose,
}: {
  notes: Note[]
  knownTags: string[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const recat = useBulkRecategorizeNotes()
  const { data: tagColors } = useTagColors()
  const [tab, setTab] = useState<'fill' | 'change'>('fill')
  const [confirming, setConfirming] = useState(false)

  // ── 補上空白的 ──
  const untagged = useMemo(() => notes.filter((n) => !n.tag), [notes])
  const [checked, setChecked] = useState<Set<string>>(() => new Set(untagged.map((n) => n.id)))
  const [fillTag, setFillTag] = useState('')
  const [query, setQuery] = useState('')
  const shownFill = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return untagged
    return untagged.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  }, [untagged, query])

  // ── 舊標籤 → 新標籤 ──
  const [oldTag, setOldTag] = useState('') // '' = 尚未選；NO_TAG = 無標籤；其餘 = 標籤名
  const [newTag, setNewTag] = useState('')
  const [oldFilter, setOldFilter] = useState('')
  const oldChoices = useMemo(() => {
    const f = oldFilter.trim().toLowerCase()
    const all = [NO_TAG, ...knownTags]
    return f ? all.filter((t) => t.toLowerCase().includes(f)) : all
  }, [knownTags, oldFilter])
  const changeHits = useMemo(() => {
    if (!oldTag) return []
    const w = oldTag === NO_TAG ? '' : oldTag
    return notes.filter((n) => n.tag === w)
  }, [notes, oldTag])

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

  const switchTab = (t: 'fill' | 'change') => {
    setTab(t)
    setConfirming(false)
  }
  const toggle = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const checkShown = () => setChecked((s) => new Set([...s, ...shownFill.map((n) => n.id)]))
  const clearAll = () => setChecked(new Set())

  const n = checked.size
  const oldLabel = oldTag === NO_TAG ? '無標籤' : oldTag
  const newLabel = newTag.trim() ? `「${newTag.trim()}」` : '清空標籤'

  const submitFill = () => {
    if (!n || recat.isPending) return
    recat.mutate({ ids: [...checked], tag: fillTag.trim() }, { onSuccess: onClose })
  }
  const submitChange = () => {
    if (!changeHits.length || recat.isPending) return
    recat.mutate({ ids: changeHits.map((x) => x.id), tag: newTag.trim() }, { onSuccess: onClose })
  }

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="批次標籤"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>批次標籤</h2>

        <div className="tab-row" role="tablist" aria-label="用法">
          <button role="tab" aria-selected={tab === 'fill'} className={`tab${tab === 'fill' ? ' on' : ''}`} onClick={() => switchTab('fill')}>
            補上空白的{untagged.length > 0 && `（${untagged.length}）`}
          </button>
          <button role="tab" aria-selected={tab === 'change'} className={`tab${tab === 'change' ? ' on' : ''}`} onClick={() => switchTab('change')}>
            舊標籤 → 新標籤
          </button>
        </div>

        {tab === 'fill' ? (
          untagged.length === 0 ? (
            <p className="bd-empty">目前沒有「沒標籤」的便利貼</p>
          ) : (
            <>
              <p className="dim">
                已幫你勾好所有「沒有標籤」的便利貼，統一補一個標籤下去（也可自己增減勾選）。
                <b> 只動標籤欄，標題／內容都不動。</b>
              </p>

              <div className="bd-controls">
                <input
                  className="bd-search"
                  type="search"
                  value={query}
                  placeholder="搜尋標題、內容…"
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="dim mono">
                  {query ? `符合 ${shownFill.length} / ${untagged.length}` : `共 ${untagged.length}`}　·　已勾選 {n}
                </span>
                <button type="button" className="btn ghost sm" onClick={checkShown}>
                  勾選目前顯示
                </button>
                <button type="button" className="btn ghost sm" onClick={clearAll}>
                  全部取消
                </button>
              </div>

              <ul className="bd-list">
                {shownFill.map((note) => (
                  <li key={note.id} style={{ background: colorForTag(note.tag, tagColors) }}>
                    <label>
                      <input type="checkbox" checked={checked.has(note.id)} onChange={() => toggle(note.id)} />
                      <span className="bd-title">{note.title || '(無標題)'}</span>
                      <span className="bd-meta">{stamp(note.created_at)}</span>
                    </label>
                  </li>
                ))}
                {shownFill.length === 0 && <li className="bd-empty">沒有符合的便利貼</li>}
              </ul>

              <div className="field-block">
                <label htmlFor={`${listId}-fill`}>
                  補上標籤 <span className="dim">可留空，或從既有標籤挑一個</span>
                </label>
                <input
                  id={`${listId}-fill`}
                  value={fillTag}
                  list={listId}
                  maxLength={60}
                  onChange={(e) => setFillTag(e.target.value)}
                  placeholder="例如：每日、待辦、購物"
                />
                <datalist id={listId}>
                  {knownTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </>
          )
        ) : (
          <div className="bt-change">
            <p className="dim">
              把目前是某個標籤（或無標籤）的便利貼<b>整批</b>換成另一個標籤——只是換名字，不用逐則挑。
            </p>
            <div className="field-block">
              <span>目前標籤是</span>
              {knownTags.length > 8 && (
                <input
                  type="search"
                  className="bd-search"
                  value={oldFilter}
                  placeholder="篩選現有標籤…"
                  onChange={(e) => setOldFilter(e.target.value)}
                />
              )}
              <div className="bt-chips">
                {oldChoices.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="bt-chip"
                    aria-pressed={oldTag === t}
                    onClick={() => setOldTag((cur) => (cur === t ? '' : t))}
                  >
                    {t !== NO_TAG && (
                      <span className="bt-chip-dot" style={{ background: colorForTag(t, tagColors) }} />
                    )}
                    {t === NO_TAG ? '（無標籤）' : t}
                  </button>
                ))}
                {oldChoices.length === 0 && <span className="bt-chips-empty">沒有符合的標籤</span>}
              </div>
            </div>
            <p className="dim mono">
              {oldTag ? `已選「${oldLabel}」· 符合 ${changeHits.length} 則` : '　'}
            </p>
            <label className="field-block">
              <span>全部改成 <span className="dim">可留空＝清空標籤</span></span>
              <input
                value={newTag}
                list={`${listId}-known`}
                maxLength={60}
                placeholder="例如：每日、待辦、購物"
                onChange={(e) => setNewTag(e.target.value)}
              />
              <datalist id={`${listId}-known`}>
                {knownTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
          </div>
        )}

        {recat.error && <span className="err">{recat.error.message}</span>}

        <div className="sheet-actions">
          {tab === 'fill' ? (
            confirming ? (
              <>
                <button className="btn" disabled={recat.isPending} onClick={submitFill}>
                  {recat.isPending ? '更新中…' : `確定補上${fillTag.trim() ? `「${fillTag.trim()}」` : '（空的）'}（${n} 則）`}
                </button>
                <button className="btn ghost" onClick={() => setConfirming(false)} disabled={recat.isPending}>
                  取消
                </button>
              </>
            ) : (
              <>
                <button className="btn" disabled={n === 0} onClick={() => setConfirming(true)}>
                  <Tags size={14} aria-hidden /> 套用到勾選的 {n} 則
                </button>
                <button className="btn ghost" onClick={onClose}>
                  關閉
                </button>
              </>
            )
          ) : confirming ? (
            <>
              <button className="btn" disabled={recat.isPending} onClick={submitChange}>
                {recat.isPending ? '更新中…' : `確定把「${oldLabel}」${changeHits.length} 則改成${newLabel}`}
              </button>
              <button className="btn ghost" onClick={() => setConfirming(false)} disabled={recat.isPending}>
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="btn"
                disabled={changeHits.length === 0}
                onClick={() => setConfirming(true)}
              >
                <Tags size={14} aria-hidden /> 把「{oldTag ? oldLabel : '…'}」改成新標籤
              </button>
              <button className="btn ghost" onClick={onClose}>
                關閉
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
