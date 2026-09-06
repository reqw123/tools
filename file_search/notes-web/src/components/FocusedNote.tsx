import { useEffect, useMemo, useState } from 'react'
import { useNotes } from '../hooks/useNotes'
import { Note } from './Note'
import { NoteDialog } from './NoteDialog'

/**
 * 「拖出去變懸浮視窗」的實際內容——wallpaper-app 開的那個小視窗載入的就是
 * 這個網頁本身，只是網址多帶 `?focus=<id>`（見 main.tsx）。不重新做一套
 * 顯示便利貼的邏輯：直接重用跟牆上一樣的 `Note` 卡片＋`NoteDialog` 編輯
 * 視窗，樣式、互動（點開編輯、改標題/標籤/內容、刪除）都跟牆上完全一致。
 *
 * 用 `useNotes()`（跟主視窗共用同一份 query）現抓現找那一則，不是另外呼叫
 * 一次 API 拿單筆——資料庫是同一份 `.sticky_notes.json`，這樣編輯完（不管
 * 是在這個小視窗編輯，還是在別的地方編輯）內容都會是最新的。
 */
export function FocusedNote({ id }: { id: string }) {
  const { data: notes, isSuccess } = useNotes()
  const note = notes?.find((n) => n.id === id)
  const knownTags = useMemo(
    () =>
      [...new Set((notes ?? []).filter((n) => n.tag).map((n) => n.tag))].sort((a, b) =>
        a.localeCompare(b, 'zh-Hant'),
      ),
    [notes],
  )
  const [editing, setEditing] = useState(false)

  // 資料已經抓回來了，裡面卻沒有這個 id——便利貼被刪掉了（不管是在這個懸浮
  // 視窗自己編輯刪的，還是在別的地方刪的）。這種情況要主動收回自己，不然
  // 懸浮狀態存在 settings.json 裡，下次重開 wallpaper-app 又會把一個空的
  // 透明視窗生回來，永遠收不掉。
  useEffect(() => {
    if (isSuccess && !note) window.desktopWall?.unpinSelf()
  }, [isSuccess, note])

  // 還在載入，或這則已經被刪掉——這個小視窗不需要專門的空狀態畫面，
  // 保持透明背景讓桌面牆的視窗看起來像還沒出現一樣，不會閃一個奇怪的畫面。
  if (!note) return null

  return (
    <div className="focused-note">
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
        title="收回到便利貼牆"
        onClick={() => window.desktopWall?.unpinSelf()}
      >
        ↩
      </button>
      <Note note={note} index={0} onOpen={() => setEditing(true)} />
      {editing && (
        <NoteDialog note={note} initialMode="view" knownTags={knownTags} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}
