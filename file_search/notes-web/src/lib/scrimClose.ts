import type { MouseEvent } from 'react'

/**
 * 「點對話框外面的背景關閉」——只在滑鼠**按下**與**放開**都落在背景本身時
 * 才生效。這樣從對話框裡的輸入框往外拖曳選字（右到左框選時很容易滑出視窗
 * 邊界）放開時，不會誤觸關閉。
 *
 * 用法：`<div className="scrim" {...scrimClose(onClose)}>`。
 *
 * `armed` 放模組層級就夠：mousedown → click 是同步發生的，同一時間也只有一個
 * 背景在被互動（巢狀的確認框那層 scrim 不呼叫這個）。
 */
let armed = false

export function scrimClose(onClose: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      armed = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      const hit = armed && e.target === e.currentTarget
      armed = false
      if (hit) onClose()
    },
  }
}
