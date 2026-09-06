import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Entry, PathStat } from '../lib/api'
import type { Group } from './Toolbar'
import { EntryRow } from './EntryRow'

interface Bucket {
  key: string
  label: string
  entries: Entry[]
}

export function EntryList({
  entries,
  group,
  stats,
  onVisible,
  onOpen,
  onCopy,
  onEdit,
  editingPath,
  editError,
  categories,
  onDelete,
  deletingPath,
  onPin,
}: {
  entries: Entry[]
  group: Group
  stats: Record<string, PathStat>
  onVisible: (paths: string[]) => void
  onOpen: (path: string, select: boolean) => void
  onCopy: (path: string) => void
  /** 原地編輯一列的分類／說明；未提供＝不顯示編輯鈕。 */
  onEdit?: (entry: Entry, v: { category: string; description: string }) => void
  /** 目前正在送出編輯的那一列路徑（顯示「儲存中…」、鎖住欄位）。 */
  editingPath?: string | null
  editError?: string | null
  /** 分類欄 datalist 的建議值。 */
  categories?: string[]
  /** 移除一列索引項目；未提供＝唯讀，不顯示移除鈕。 */
  onDelete?: (entry: Entry) => void
  deletingPath?: string | null
  /** 把一列變成獨立懸浮視窗（desktop-wall 專屬）；未提供＝不顯示釘選鈕。 */
  onPin?: (entry: Entry, rect: DOMRect) => void
}) {
  // 展開狀態、React key 都以「路徑（同路徑重複出現時加序號）」為準，不用 serial：
  // 刪一列之後 serial 會整份重排，用 serial 當 key 會讓下面的列換成別筆資料、
  // 本地狀態（預覽開著／刪除確認中）殘留，甚至誤刪。路徑穩定，刪別列不受影響。
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>()
    return new Map(
      entries.map((e) => {
        const n = (seen.get(e.path) ?? 0) + 1
        seen.set(e.path, n)
        return [e, n === 1 ? e.path : `${e.path}\x00${n}`]
      }),
    )
  }, [entries])
  const keyOf = (e: Entry) => rowKeys.get(e) ?? e.path

  // ── lazy 存在檢查：用 IntersectionObserver 收集進入視窗附近的列 ──
  // observer 在第一次 register()（來自子元件的 effect）時才建，之後重用。
  // 子元件 effect 早於父元件 effect，所以不能在父的 useEffect 裡才建。
  const ioRef = useRef<IntersectionObserver | null>(null)
  const batch = useRef<Set<string>>(new Set())
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onVisibleRef = useRef(onVisible)
  useEffect(() => {
    onVisibleRef.current = onVisible
  }, [onVisible])

  const getIo = useCallback(() => {
    if (ioRef.current || typeof IntersectionObserver === 'undefined') return ioRef.current
    ioRef.current = new IntersectionObserver(
      (ents) => {
        for (const e of ents) {
          if (e.isIntersecting) {
            const p = (e.target as HTMLElement).dataset.path
            if (p) batch.current.add(p)
          }
        }
        if (batch.current.size && !batchTimer.current) {
          batchTimer.current = setTimeout(() => {
            onVisibleRef.current([...batch.current])
            batch.current.clear()
            batchTimer.current = null
          }, 80)
        }
      },
      { rootMargin: '500px 0px' },
    )
    return ioRef.current
  }, [])

  useEffect(() => {
    const timer = batchTimer
    const ref = ioRef
    return () => {
      ref.current?.disconnect()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const register = useCallback(
    (el: HTMLElement | null, path: string) => {
      const io = getIo()
      if (!io || !el) return
      el.dataset.path = path
      io.observe(el)
      return () => io.unobserve(el)
    },
    [getIo],
  )

  const toggleRow = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const buckets = useMemo<Bucket[]>(() => {
    if (group === 'none') return [{ key: '', label: '', entries }]
    const map = new Map<string, Entry[]>()
    for (const e of entries) {
      const key = group === 'category' ? e.category || '未分類' : e.dir || '（根目錄）'
      const arr = map.get(key)
      if (arr) arr.push(e)
      else map.set(key, [e])
    }
    return [...map.entries()].map(([key, es]) => ({ key, label: key, entries: es }))
  }, [entries, group])

  const rowOf = (e: Entry) => {
    const k = keyOf(e)
    return (
    <EntryRow
      key={k}
      entry={e}
      stat={stats[e.path]}
      expanded={expanded.has(k)}
      onToggle={() => toggleRow(k)}
      onOpen={(select) => onOpen(e.path, select)}
      onCopy={() => onCopy(e.path)}
      onEdit={onEdit ? (v) => onEdit(e, v) : undefined}
      editing={editingPath === e.path}
      editError={editingPath === e.path ? editError : null}
      categories={categories}
      onDelete={onDelete ? () => onDelete(e) : undefined}
      deleting={deletingPath === e.path}
      onPin={onPin ? (rect) => onPin(e, rect) : undefined}
      register={register}
    />
    )
  }

  if (group === 'none') {
    return <div className="list">{entries.map(rowOf)}</div>
  }

  return (
    <div className="list grouped">
      {buckets.map((b) => {
        const shut = collapsed.has(b.key)
        return (
          <section key={b.key} className={`bucket${shut ? ' shut' : ''}`}>
            <button
              className="bucket-head"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(b.key)) next.delete(b.key)
                  else next.add(b.key)
                  return next
                })
              }
              aria-expanded={!shut}
            >
              <ChevronRight size={14} className="chev" aria-hidden />
              <span className="bucket-label">{b.label}</span>
              <span className="bucket-count mono">{b.entries.length}</span>
            </button>
            {!shut && <div>{b.entries.map(rowOf)}</div>}
          </section>
        )
      })}
    </div>
  )
}
