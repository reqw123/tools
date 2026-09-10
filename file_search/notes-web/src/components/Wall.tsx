import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Note as NoteT, TagColors } from '../lib/api'
import { colorForTag } from '../lib/color'
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
  tagAxis = 'vertical',
  bandByTag = false,
  tagColors,
}: {
  notes: NoteT[]
  onOpen: (n: NoteT) => void
  floatable?: boolean
  onDragOut?: (note: NoteT, rect: DOMRect) => void
  /** 「全域設定」→ 牆面欄寬；未載入時用預設 240。 */
  minColWidth?: number
  /** false＝關掉 JS 動態排版，交給 index.css 的 CSS grid fallback。 */
  masonry?: boolean
  /** 排序「同分類集中（分類間隔開）」——每個分類自成一「帶」：帶內卡片 row-major
   *  補最矮欄，帶與帶之間硬換行、上面一條分隔標籤。columnPerTag / tagAxis 都不看。
   *  分界從 notes 的 tag 順序推（App 已依分類排好）。 */
  bandByTag?: boolean
  /** band 標籤的色塊要用——沒帶就退回雜湊配色。 */
  tagColors?: TagColors
  /** true＝「看全部」——直向時一個分類佔一（直）行；false＝有篩選（選了分類／
   *  搜尋／AI／只看快到期），直向時單純 column-major。橫向不看這個旗標。 */
  columnPerTag?: boolean
  /** 卡片排的方向：
   *  - 'horizontal'：一張一張放進目前最矮的欄（row-major masonry），等高就是
   *    整齊的一列列，有高矮則後面的卡片自動補洞、不留一塊塊空白。columnPerTag
   *    與否都同一套（差別只在清單有沒有先依分類排，App 那邊處理）。
   *  - 'vertical'：column-major——看全部時一分類一直行，有篩選時一欄由上往下
   *    填到「總高 / 欄數」才換下一欄。
   *  'vertical' 是預設，也是從沒動過這個設定時的行為。 */
  tagAxis?: 'vertical' | 'horizontal'
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
      for (const el of Array.from(wall.children) as HTMLElement[]) {
        if (el.classList.contains('note') || el.classList.contains('band-label')) {
          el.style.width = ''
          el.style.left = ''
          el.style.top = ''
        }
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

    if (bandByTag) {
      // 「同分類集中」：DOM 上是 label, note, note, …, label, note, …（notes 已依
      // 分類排好）。每個 label 一整條、置頂；接著那批同分類的 note 用 row-major
      // 補最矮欄；一批排完硬留一大段空白＋下一條 label，做出分類界線。
      const items = (Array.from(wall.children) as HTMLElement[]).filter(
        (el) => el.classList.contains('note') || el.classList.contains('band-label'),
      )
      for (const el of items) {
        const isLabel = el.classList.contains('band-label')
        el.style.width = isLabel ? `${inner}px` : `${colW}px`
      }
      const hs = items.map((el) => el.offsetHeight)
      const BAND_GAP = GAP * 2 // 帶與帶之間的分割空白
      let y = padT + topOffset
      let contentBottom = y
      let idx = 0
      while (idx < items.length) {
        if (items[idx].classList.contains('band-label')) {
          items[idx].style.left = `${padL}px`
          items[idx].style.top = `${y}px`
          y += hs[idx] + GAP * 0.55
          idx += 1
          continue
        }
        const colBottom = new Array<number>(numCols).fill(y)
        while (idx < items.length && items[idx].classList.contains('note')) {
          let c = 0
          for (let k = 1; k < numCols; k += 1) if (colBottom[k] < colBottom[c]) c = k
          items[idx].style.left = `${padL + c * (colW + GAP)}px`
          items[idx].style.top = `${colBottom[c]}px`
          colBottom[c] += hs[idx] + GAP
          idx += 1
        }
        contentBottom = Math.max(...colBottom) - GAP // 去掉最後一張多算的 GAP
        y = contentBottom + BAND_GAP
      }
      wall.style.height = `${contentBottom + padB}px`
      wall.classList.add('is-masonry')
      if (!readyRef.current) {
        requestAnimationFrame(() => wallRef.current?.classList.add('masonry-ready'))
        readyRef.current = true
      }
      return
    }

    // 先一次寫寬度、再一次讀高度，避免逐張 write→read 造成 layout thrash。
    for (const el of cards) el.style.width = `${colW}px`
    const heights = cards.map((el) => el.offsetHeight)

    const place = (el: HTMLElement, c: number, h: number) => {
      el.style.left = `${padL + c * (colW + GAP)}px`
      el.style.top = `${padT + topOffset + colH[c]}px`
      colH[c] += h + GAP
    }

    if (tagAxis === 'horizontal') {
      // 橫向：卡片照清單順序（「看全部」時 App 已依分類排好，所以同色會相鄰）
      // 一張一張放進「目前最矮」的欄——等高卡片就是整齊的一列一列；有高有矮
      // 時後面的卡片自動補進較淺的欄，不留一塊塊空白（＝回報的「沒有遞補空缺」）。
      cards.forEach((el, i) => {
        let c = 0
        for (let k = 1; k < numCols; k += 1) if (colH[k] < colH[c]) c = k
        place(el, c, heights[i])
      })
    } else if (columnPerTag) {
      // 直向 × 看全部：一個分類一（直）行——把 DOM 上連續、同 data-tag 的卡片
      // 當成一整塊，整塊塞進「當下最矮」的欄。前 numCols 個分類（欄都還空）因此
      // 自然由左到右各佔一欄，置頂的那幾個分類第一張都在同一個畫面裡看得到。
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
      // 直向 × 有篩選（選了分類／搜尋…）：真正的 column-major——第一欄由上往下
      // 疊，疊到夠高才換下一欄。「夠高」取「總高 / 欄數」與「約一個畫面高」的
      // 較大者：篩出來只有幾張時就整疊在第一欄（回報的「沒套用直排、反而攤成
      // 一橫排」就是因為門檻只用 總高/欄數、太小），多到爆才往右擴欄。
      const totalH = heights.reduce((s, h) => s + h + GAP, 0)
      const viewH = ((typeof window !== 'undefined' && window.innerHeight) || 1000) - padT - 40
      const target = Math.max(totalH / numCols, viewH * 0.9)
      let col = 0
      cards.forEach((el, i) => {
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
  }, [MIN_COL_W, masonry, columnPerTag, tagAxis, bandByTag])

  const schedule = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(layout)
  }, [layout])

  // 拖曳結束把卡片收回牆上時要「同步」重排——不能等 rAF，不然清掉 inline
  // 定位到重新定位之間會空一幀，卡片閃到 .wall 左上角再滑回來（見 Note.tsx
  // finish() 的註解）。
  const relayoutNow = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    layout()
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
              onGeometryChange={relayoutNow}
            />
          ))}
        </div>
      )}
      {rest.map((n, i) => (
        <Fragment key={n.id}>
          {bandByTag && (i === 0 || rest[i - 1].tag !== n.tag) && (
            <div
              className="band-label"
              aria-hidden
              style={{ '--band-color': colorForTag(n.tag, tagColors) } as CSSProperties}
            >
              {n.tag || '未分類'}
            </div>
          )}
          <Note
            note={n}
            index={pinned.length + i}
            onOpen={onOpen}
            floatable={floatable}
            onDragOut={onDragOut}
            onGeometryChange={relayoutNow}
          />
        </Fragment>
      ))}
    </main>
  )
}
