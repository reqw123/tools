import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useAppSettings, useNotes, usePatchAppSettings, useTagColors } from '../hooks/useNotes'
import { colorForTag } from '../lib/color'
import { orderTags, tagRecency, type LiveTag } from '../lib/tagOrder'
import type { TagSortMode } from '../lib/api'

const MODES: { id: TagSortMode; label: string; hint: string }[] = [
  { id: 'count', label: '依便利貼數量', hint: '沒有手動釘的分類，數量多的排前面。' },
  { id: 'recent', label: '依最近使用', hint: '沒有手動釘的分類，最近有便利貼異動的排前面。' },
  { id: 'manual', label: '完全手動', hint: '只照下面排好的順序；沒排到的新分類先擺最後，再自己調。' },
]

export function TagSortSettings() {
  const { data: notes } = useNotes()
  const { data: settings } = useAppSettings()
  const { data: tagColors } = useTagColors()
  const patch = usePatchAppSettings()

  const list = useMemo(() => notes ?? [], [notes])
  const recency = useMemo(() => tagRecency(list), [list])

  const live = useMemo<LiveTag[]>(() => {
    const m = new Map<string, number>()
    for (const n of list) if (n.tag) m.set(n.tag, (m.get(n.tag) ?? 0) + 1)
    return [...m.entries()].map(([tag, count]) => ({ tag, count }))
  }, [list])
  const counts = useMemo(() => new Map(live.map((t) => [t.tag, t.count])), [live])

  const tagSort = useMemo(
    () => settings?.tagSort ?? { mode: 'count' as TagSortMode, order: [] },
    [settings],
  )

  // 目前實際生效的完整順序；前段＝手動釘住的（照 order），後段＝其餘自動排序。
  const effective = useMemo(
    () => orderTags(live, tagSort, recency),
    [live, tagSort, recency],
  )
  const pinnedSet = useMemo(
    () => new Set(tagSort.order.filter((t) => counts.has(t))),
    [tagSort.order, counts],
  )
  const pinned = effective.filter((t) => pinnedSet.has(t))
  const rest = effective.filter((t) => !pinnedSet.has(t))

  // order 裡可能有目前沒有便利貼的分類（季節性標籤清空後又會回來）——UI 只
  // 顯示、只排「目前存在」的，但寫回時要把那些暫時消失的接在後面保留，不然
  // 動一下順序就把它們的釘選狀態弄丟了。
  const staleOrder = useMemo(
    () => tagSort.order.filter((t) => !counts.has(t)),
    [tagSort.order, counts],
  )
  const saveOrder = (livePinned: string[]) =>
    patch.mutate({ tagSort: { order: [...livePinned, ...staleOrder] } })
  const saveMode = (mode: TagSortMode) => patch.mutate({ tagSort: { mode } })

  const move = (tag: string, dir: -1 | 1) => {
    const i = pinned.indexOf(tag)
    const j = i + dir
    if (i < 0 || j < 0 || j >= pinned.length) return
    const next = [...pinned]
    ;[next[i], next[j]] = [next[j], next[i]]
    saveOrder(next)
  }
  const pin = (tag: string) => saveOrder([...pinned, tag])
  const unpin = (tag: string) => saveOrder(pinned.filter((t) => t !== tag))

  const dot = (tag: string): CSSProperties => ({ background: colorForTag(tag, tagColors) })

  if (!settings || !notes) return <p className="dim mono">載入中…</p>

  return (
    <div className="form tag-sort">
      <p className="dim">
        「全部 / 旅遊 / 運動…」那條橫向分類列的排列方式。這個順序也決定牆面在沒有
        篩選時的分欄——一個分類一直行，不同分類由左到右，所以排在前面（或釘在最前）
        的分類會並排在最左邊、一眼看得到。目前共 <b>{live.length}</b> 種分類。
      </p>

      <fieldset className="mode-row">
        <legend>排序方式</legend>
        {MODES.map((m) => (
          <label key={m.id} className="radio">
            <input
              type="radio"
              name="tag-sort-mode"
              checked={tagSort.mode === m.id}
              onChange={() => saveMode(m.id)}
            />
            <span>
              {m.label}
              <span className="hint">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="tag-sort-list">
        <p className="list-head">
          釘在最前面（依序，可調）
          {pinned.length === 0 && <span className="dim">　— 還沒釘任何分類</span>}
        </p>
        <ul>
          {pinned.map((tag, i) => (
            <li key={tag}>
              <span className="tag-dot" style={dot(tag)} aria-hidden />
              <span className="tag-name">{tag}</span>
              <span className="tag-n">{counts.get(tag) ?? 0}</span>
              <span className="row-actions">
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={i === 0}
                  onClick={() => move(tag, -1)}
                  aria-label={`「${tag}」往前`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={i === pinned.length - 1}
                  onClick={() => move(tag, 1)}
                  aria-label={`「${tag}」往後`}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => unpin(tag)}
                  aria-label={`取消釘選「${tag}」`}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>

        <p className="list-head">
          其餘分類（{tagSort.mode === 'recent' ? '依最近使用' : '依數量'}自動排）
        </p>
        <ul>
          {rest.map((tag) => (
            <li key={tag} className="rest">
              <span className="tag-dot" style={dot(tag)} aria-hidden />
              <span className="tag-name">{tag}</span>
              <span className="tag-n">{counts.get(tag) ?? 0}</span>
              <span className="row-actions">
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => pin(tag)}
                  aria-label={`把「${tag}」釘到最前`}
                >
                  ⤒ 釘到最前
                </button>
              </span>
            </li>
          ))}
          {rest.length === 0 && <li className="dim">（沒有了）</li>}
        </ul>
      </div>

      {(pinned.length > 0 || staleOrder.length > 0) && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => patch.mutate({ tagSort: { order: [] } })}
        >
          清除自訂順序{staleOrder.length > 0 ? `（含 ${staleOrder.length} 個目前沒有便利貼的）` : ''}
        </button>
      )}
      {patch.error && <span className="err">{patch.error.message}</span>}
    </div>
  )
}
