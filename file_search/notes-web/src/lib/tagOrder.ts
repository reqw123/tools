import type { AppSettings, Note } from './api'

export interface LiveTag {
  tag: string
  count: number
}

/** 每個標籤最近一次有便利貼異動的時間（便利貼 created_at＝「最後動過的時間」，
 *  ISO 字串可直接字典序比較）。沒有便利貼的標籤不會出現。 */
export function tagRecency(notes: Note[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of notes) {
    if (!n.tag) continue
    const cur = m.get(n.tag)
    if (cur === undefined || n.created_at > cur) m.set(n.tag, n.created_at)
  }
  return m
}

/**
 * 把目前實際存在的標籤照「全域設定」的 tagSort 排好，回傳排序後的標籤名稱。
 *
 * - `order` 裡列到、且目前還存在的標籤永遠排最前，順序照 `order`（＝使用者
 *   手動釘的流水號）。
 * - 其餘標籤（含日後新增、還沒被手動排過的）依 `mode` 遞補在後：
 *   `count`＝便利貼多的在前；`recent`＝最近有異動的在前；`manual`＝比照
 *   `count`（手動模式下使用者本來就該把想排的都加進 `order`）。
 */
export function orderTags(
  live: LiveTag[],
  tagSort: AppSettings['tagSort'],
  recency: Map<string, string>,
): string[] {
  const counts = new Map(live.map((t) => [t.tag, t.count]))
  const prefix = tagSort.order.filter((t) => counts.has(t))
  const pinned = new Set(prefix)
  const rest = [...counts.keys()].filter((t) => !pinned.has(t))

  const byCount = (a: string, b: string) =>
    (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, 'zh-Hant')
  const byRecent = (a: string, b: string) => {
    const ra = recency.get(a) ?? ''
    const rb = recency.get(b) ?? ''
    return ra === rb ? byCount(a, b) : ra < rb ? 1 : -1
  }

  rest.sort(tagSort.mode === 'recent' ? byRecent : byCount)
  return [...prefix, ...rest]
}
