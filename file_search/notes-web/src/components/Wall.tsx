import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Note as NoteT } from '../lib/api'
import { Note } from './Note'

// 一欄至少這麼寬才多開一欄（可被「全域設定」覆寫）；欄距。跟 index.css 的
// .wall grid fallback（minmax(240px,…) / gap:1.9rem）對齊。
const DEFAULT_MIN_COL_W = 240
const GAP = 30 // ≈ 1.9rem @ 16px root

export function Wall({
  notes,
  onOpen,
  floatable,
  onDragOut,
  minColWidth,
  masonry = true,
  columnPerTag = false,
}: {
  notes: NoteT[]
  onOpen: (n: NoteT) => void
  floatable?: boolean
  onDragOut?: (note: NoteT, rect: DOMRect) => void
  /** 「全域設定」→ 牆面欄寬；未載入時用預設 240。 */
  minColWidth?: number
  /** false＝關掉 JS 動態排版，交給 index.css 的 CSS grid fallback。 */
  masonry?: boolean
  /** true＝一個分類一（直）行、不同分類由左到右（「看全部」時用）；
   *  false＝忽略分類、單純 column-major 大致等高（搜尋／篩選時用）。 */
  columnPerTag?: boolean
}) {
  const MIN_COL_W = minColWidth && minColWidth > 0 ? minColWidth : DEFAULT_MIN_COL_W
  const wallRef = useRef<HTMLElement>(null)
  const rafRef = useRef(0)
  const readyRef = useRef(false)

  // 釘選的排成頂端一列（.pinned-row，一般的 flex 換行），其餘走下面的
  // column-major 版面。分開兩塊而不是把釘選也塞進 column-major，是因為要
  // 「由左到右」而不是「疊在最左欄」。
  const pinned = useMemo(() => notes.filter((n) => n.pinned), [notes])
  const rest = useMemo(() => notes.filter((n) => !n.pinned), [notes])

  // column-major「大致等高」填充——照順序把第一欄從上疊到接近目標高度才換
  // 下一欄（跟以前 CSS `columns` 同一個行為，但用 JS 做才能精準控制、沒有
  // CSS 分欄那種破口）。每欄內部完全緊貼、上下便利貼一路銜接，不留空白。
  // 「看全部」時 App 已把 rest 依分類排好序，所以同色系會一段段落在同一
  // 直行。位置寫成 inline style，不走 React re-render（跟 Note.tsx 拖曳時
  // 直接改 el.style 同一招）。
  const layout = useCallback(() => {
    const wall = wallRef.current
    if (!wall) return
    // 只排 .wall 的「直接子」.note（釘選的包在 .pinned-row 裡，不動它）。
    const cards = (Array.from(wall.children) as HTMLElement[]).filter((el) =>
      el.classList.contains('note'),
    )
    const pinnedRow = wall.querySelector<HTMLElement>('.pinned-row')
    // 「全域設定」關掉動態排版 → 清掉所有 inline 定位，交給 index.css 的 CSS
    // grid fallback（.wall 沒有 .is-masonry 時就是等寬格線）。
    if (!masonry) {
      wall.style.height = ''
      wall.classList.remove('is-masonry', 'masonry-ready')
      readyRef.current = false
      for (const el of cards) {
        el.style.width = ''
        el.style.left = ''
        el.style.top = ''
      }
      return
    }
    if (!cards.length && !pinnedRow) {
      wall.style.height = ''
      wall.classList.remove('is-masonry', 'masonry-ready')
      readyRef.current = false
      return
    }
    const cs = getComputedStyle(wall)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const padT = parseFloat(cs.paddingTop) || 0
    const padB = parseFloat(cs.paddingBottom) || 0
    const inner = wall.clientWidth - padL - padR
    if (inner <= 1) return // 還沒排到版（display:none 之類）——之後 ResizeObserver 會再叫

    // 釘選列的高度（含底下的一段間距）——其餘便利貼從這條線下方開始。
    const topOffset = pinnedRow ? pinnedRow.offsetHeight + GAP : 0

    const numCols = Math.max(1, Math.floor((inner + GAP) / (MIN_COL_W + GAP)))
    const colW = (inner - GAP * (numCols - 1)) / numCols
    const colH = new Array<number>(numCols).fill(0)

    // 先一次寫寬度、再一次讀高度，避免逐張 write→read 造成 layout thrash。
    for (const el of cards) el.style.width = `${colW}px`
    const heights = cards.map((el) => el.offsetHeight)

    const place = (el: HTMLElement, c: number, h: number) => {
      el.style.left = `${padL + c * (colW + GAP)}px`
      el.style.top = `${padT + topOffset + colH[c]}px`
      colH[c] += h + GAP
    }

    if (columnPerTag) {
      // 一個分類一（直）行：把 DOM 上連續、同 data-tag 的卡片當成一整塊，
      // 整塊塞進「當下最矮」的欄。前 numCols 個分類（欄都還空）因此自然由
      // 左到右各佔一欄——使用者置頂的那幾個分類就能並排、各自的第一張都在
      // 同一個畫面裡看得到，而不是全部疊在最左欄。塊與塊、卡與卡之間仍然
      // 完全緊貼，不留空白。
      let i = 0
      while (i < cards.length) {
        const tag = cards[i].dataset.tag ?? ''
        let j = i
        while (j < cards.length && (cards[j].dataset.tag ?? '') === tag) j += 1
        let c = 0
        for (let k = 1; k < numCols; k += 1) if (colH[k] < colH[c]) c = k
        for (let k = i; k < j; k += 1) place(cards[k], c, heights[k])
        i = j
      }
    } else {
      const totalH = heights.reduce((s, h) => s + h + GAP, 0)
      const target = totalH / numCols // 每欄的理想高度
      let col = 0
      cards.forEach((el, i) => {
        // 這一欄已經裝到接近目標高度就換下一欄（最後一欄吸收餘量）。h/2 讓
        // 換欄的決策點落在「加上這張後離目標最近」的地方。
        if (col < numCols - 1 && colH[col] > 0 && colH[col] + heights[i] / 2 > target) {
          col += 1
        }
        place(el, col, heights[i])
      })
    }
    const bodyH = cards.length ? Math.max(...colH) - GAP : 0
    wall.style.height = `${padT + topOffset + bodyH + padB}px`
    wall.classList.add('is-masonry')
    if (!readyRef.current) {
      // 第一次定位不要有 left/top 過場動畫（不然會從 (0,0) 滑進來）；
      // 下一個 frame 才開啟過場，之後的重排（釘選、縮放）才平滑移動。
      requestAnimationFrame(() => {
        wallRef.current?.classList.add('masonry-ready')
      })
      readyRef.current = true
    }
  }, [MIN_COL_W, masonry, columnPerTag])

  const schedule = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(layout)
  }, [layout])

  // 資料變動（新增／刪除／釘選重排／勾選改高度…）→ 立刻重排。useLayoutEffect
  // 讓定位在瀏覽器 paint 前完成，不閃。
  useLayoutEffect(() => {
    layout()
  }, [notes, layout])

  // 視窗縮放、任一張卡片高度變化（圖片載入、字型載入、內容改動）→ 重排。
  useEffect(() => {
    const wall = wallRef.current
    if (!wall) return
    const ro = new ResizeObserver(schedule)
    ro.observe(wall)
    for (const el of Array.from(wall.querySelectorAll('.note'))) ro.observe(el)
    const pinnedRow = wall.querySelector('.pinned-row')
    if (pinnedRow) ro.observe(pinnedRow)
    window.addEventListener('resize', schedule)
    let alive = true
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
    void fonts?.ready.then(() => {
      if (alive) schedule()
    })
    return () => {
      alive = false
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(rafRef.current)
    }
  }, [notes, schedule])

  return (
    <main
      className="wall enter"
      ref={wallRef}
      style={{ '--wall-min-col': `${MIN_COL_W}px` } as CSSProperties}
    >
      {pinned.length > 0 && (
        <div className="pinned-row">
          {pinned.map((n, i) => (
            <Note
              key={n.id}
              note={n}
              index={i}
              onOpen={onOpen}
              floatable={floatable}
              onDragOut={onDragOut}
              onGeometryChange={schedule}
            />
          ))}
        </div>
      )}
      {rest.map((n, i) => (
        <Note
          key={n.id}
          note={n}
          index={pinned.length + i}
          onOpen={onOpen}
          floatable={floatable}
          onDragOut={onDragOut}
          onGeometryChange={schedule}
        />
      ))}
    </main>
  )
}
