import { useEffect, useRef } from 'react'

type Rect = { x: number; y: number; width: number; height: number }

function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/**
 * 拖框裁切主視窗——在空白處拖曳畫出一個選取框，放開後把框到的便利貼 id
 * 交給 `onCrop`，呼叫端（App.tsx）負責篩出這幾則、要求桌面牆把視窗縮小/
 * 搬移到框選範圍。這裡只管「畫框＋判斷框到誰」，不碰 Electron IPC、不管
 * 篩選結果怎麼呈現——跟 `Note.tsx` 的拖出去手勢是同一種分工。
 *
 * `active` 應該只在 `window.desktopWall` 存在、目前沒有對話框開著、也還
 * 沒有裁切中的時候才是 true——這幾個排除條件由呼叫端決定，這裡不重複判斷。
 */
export function CropOverlay({
  active,
  onCrop,
}: {
  active: boolean
  onCrop: (ids: string[], rect: Rect) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!active) return

    const paint = (r: Rect) => {
      const el = boxRef.current
      if (!el) return
      el.style.display = 'block'
      el.style.left = r.x + 'px'
      el.style.top = r.y + 'px'
      el.style.width = r.width + 'px'
      el.style.height = r.height + 'px'
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      // 便利貼／工具列／標題區／任何對話框／裁切用的按鈕上按下，都不算
      // 「拉框」的起點——不然點便利貼、點按鈕都會順便畫出一個框。
      if (target.closest('.note, .bar, .hero, .scrim, .toggle, .crop-restore')) return
      start.current = { x: e.clientX, y: e.clientY }
      paint(rectOf(start.current, start.current))
    }

    const onMove = (e: MouseEvent) => {
      if (!start.current) return
      paint(rectOf(start.current, { x: e.clientX, y: e.clientY }))
    }

    const onUp = (e: MouseEvent) => {
      if (!start.current) return
      const r = rectOf(start.current, { x: e.clientX, y: e.clientY })
      start.current = null
      if (boxRef.current) boxRef.current.style.display = 'none'
      if (r.width < 24 || r.height < 24) return // 太小＝誤觸（單純點一下），忽略

      const ids: string[] = []
      document.querySelectorAll<HTMLElement>('.note[data-note-id]').forEach((el) => {
        const nr = el.getBoundingClientRect()
        const overlap =
          nr.left < r.x + r.width && nr.right > r.x && nr.top < r.y + r.height && nr.bottom > r.y
        if (overlap && el.dataset.noteId) ids.push(el.dataset.noteId)
      })
      if (ids.length === 0) return // 框到空白，不動作
      onCrop(ids, r)
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [active, onCrop])

  if (!active) return null
  return <div ref={boxRef} className="crop-marquee" style={{ display: 'none' }} />
}
