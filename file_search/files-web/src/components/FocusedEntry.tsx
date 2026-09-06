import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useIndex, useDeleteEntry, useUpdateEntry } from '../hooks/useIndexes'
import { useExists } from '../hooks/useExists'
import { EntryRow } from './EntryRow'

/**
 * 「拖出去變懸浮視窗」的實際內容——wallpaper-app 開的那個小視窗載入的就是
 * 這個網頁本身，只是網址多帶 `?focus=<path>&index=<indexName>`（見
 * main.tsx）。不重新做一套顯示項目的邏輯：直接重用跟列表上一樣的
 * `EntryRow`，樣式、互動（展開/收合、預覽、編輯、開啟、複製路徑、從索引
 * 移除）都跟列表上完全一致——跟 notes-web 的 FocusedNote.tsx 同一
 * 個設計。
 *
 * entry 沒有穩定 id，只有 path，而且只在特定索引集底下查得到，所以要同時
 * 帶 indexName——用 `useIndex(indexName)`（跟主視窗共用同一份 query 快取）
 * 現抓現找那一筆，不是另外呼叫一次 API。
 */
export function FocusedEntry({ indexName, path }: { indexName: string; path: string }) {
  const { data: payload, isSuccess } = useIndex(indexName)
  const entry = payload?.entries.find((e) => e.path === path)
  const categories = useMemo(
    () =>
      [...new Set((payload?.entries ?? []).filter((e) => e.category).map((e) => e.category))].sort(
        (a, b) => a.localeCompare(b, 'zh-Hant'),
      ),
    [payload],
  )
  const [expanded, setExpanded] = useState(false)
  const { stats, request } = useExists()

  useEffect(() => {
    if (entry) request([entry.path])
  }, [entry, request])

  // 資料已經抓回來了，裡面卻沒有這個 path——這一列被從索引移除了（不管是
  // 在這個懸浮視窗自己移除的，還是在別的地方）。這種情況要主動收回自己，
  // 不然懸浮狀態存在 settings.json 裡，下次重開 wallpaper-app 又會把一個
  // 空的透明視窗生回來，永遠收不掉。索引本身讀失敗（例如 .md 被刪了）也是
  // 同樣處理。
  useEffect(() => {
    if (isSuccess && !entry) window.desktopWall?.unpinSelf()
  }, [isSuccess, entry])

  const onOpen = useCallback((select: boolean) => {
    api.open(path, select).catch(() => {})
  }, [path])
  const onCopy = useCallback(() => {
    navigator.clipboard?.writeText(path).catch(() => {})
  }, [path])

  const edit = useUpdateEntry(indexName)
  const del = useDeleteEntry(indexName)

  // 還在載入，或這一列已經被移除——這個小視窗不需要專門的空狀態畫面，
  // 保持透明背景讓桌面牆的視窗看起來像還沒出現一樣，不會閃一個奇怪的畫面。
  if (!entry) return null

  return (
    <div className="focused-entry">
      {/* 四邊都能拖——這個小視窗常常是緊貼著某個螢幕邊界生出來的（拖出去
          變懸浮視窗本來就是靠近邊緣才觸發），只留上緣一條窄窄的拖曳把手，
          萬一那條剛好貼著螢幕邊界，使用者會抓不到、完全動不了它。四邊都給
          一條拖曳區，不管視窗貼在哪一側，一定還有其他邊摸得到。 */}
      <div className="focused-drag-handle" aria-hidden />
      <div className="focused-drag-edge edge-bottom" aria-hidden />
      <div className="focused-drag-edge edge-left" aria-hidden />
      <div className="focused-drag-edge edge-right" aria-hidden />
      <button
        type="button"
        className="focused-unpin"
        title="收回到索引列表"
        onClick={() => window.desktopWall?.unpinSelf()}
      >
        ↩
      </button>
      <div className="list">
        <EntryRow
          entry={entry}
          stat={stats[entry.path]}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          onOpen={onOpen}
          onCopy={onCopy}
          onEdit={(v) => edit.mutate({ serial: entry.serial, path: entry.path, ...v })}
          editing={edit.isPending}
          editError={edit.isError ? (edit.error?.message ?? '更新失敗') : null}
          categories={categories}
          onDelete={() => del.mutate({ serial: entry.serial, path: entry.path })}
          deleting={del.isPending}
          register={() => undefined}
        />
      </div>
    </div>
  )
}
