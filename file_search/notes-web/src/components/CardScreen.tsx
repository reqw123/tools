import { useNotes } from '../hooks/useNotes'
import { useCard } from '../hooks/useCard'
import { Note } from './Note'

/**
 * 「看板」——固定網址 `/card`，畫面內容＝後端目前指定的那一則（`server/card.ts`）。
 * 給投影機／展示螢幕這種「網址設一次、之後只換內容」的場景：別人在自己的
 * 電腦上按「設為看板」換掉指定的便利貼，這台開著 `/card` 的螢幕靠 SSE 的
 * `card` topic 自動換畫面，不用碰它、不用重新整理、更不用改網址。
 *
 * 直接重用牆上同一張 `<Note>` 卡片（樣式、待辦勾選都一致），只是外層換成
 * 「大螢幕展示」的排版——置中、放大、深色背景。用 `useNotes()` 找便利貼
 * 內容，跟主牆共用同一份資料與即時同步，不用另外拉一份。
 */
export function CardScreen() {
  const { data: card, isLoading: cardLoading } = useCard()
  const { data: notes, isLoading: notesLoading } = useNotes()

  if (cardLoading || notesLoading) return <div className="card-screen" />

  const note = card?.noteId ? notes?.find((n) => n.id === card.noteId) : undefined

  if (!note) {
    return (
      <div className="card-screen card-screen-empty">
        <p className="card-screen-hint">
            尚未指定看板內容
          <br />
          在任一則便利貼的放大檢視按「📺 設為看板」
        </p>
      </div>
    )
  }

  return (
    <div className="card-screen">
      {/* key=note.id：換成別則時整個重新掛載，讓進場動畫重播一次，看得出「換內容了」。 */}
      <div className="card-screen-stage" key={note.id}>
        <Note note={note} index={0} onOpen={() => {}} />
      </div>
    </div>
  )
}
