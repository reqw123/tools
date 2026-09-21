import type { PointerEvent } from 'react'

/**
 * 懸浮視窗的拖曳把手事件——按住把手就讓 Electron 視窗跟著游標走（主行程那端見
 * wallpaper-app/window-drag.js）。
 *
 * 不用 CSS 的 `-webkit-app-region: drag`：那種區域由作業系統處理、網頁收不到滑鼠
 * 事件，`:hover` 高亮跟 `cursor: move` 游標圖案都不會生效（實測游標停在上面仍是
 * 一般箭頭）。改成一般元素收 pointer 事件，游標與 hover 才正常。
 *
 * setPointerCapture：按住後游標移出把手（視窗跟著游標走，快速拖動時常常游標
 * 比視窗快）也還是收得到放開事件，不會卡在「拖曳中」。
 *
 * 「放開」不只靠 pointerup：拖曳中只要看到 pointermove 的 buttons 是 0（其實已經
 * 放開了、只是放開事件沒收到）或視窗失焦，一律當作放開處理——主行程那端是靠這個
 * 訊號才停手，漏掉一次就會變成視窗一直黏著游標。
 */
let dragging = false

function end() {
  if (!dragging) return
  dragging = false
  window.removeEventListener('pointermove', onMove, true)
  window.removeEventListener('blur', end)
  window.desktopWall?.dragWindowEnd?.()
}

function onMove(e: globalThis.PointerEvent) {
  if (e.buttons === 0) end()
}

export const windowDragHandlers = {
  onPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0 || !window.desktopWall?.dragWindowStart) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging = true
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('blur', end)
    window.desktopWall.dragWindowStart()
  },
  onPointerUp: end,
  onPointerCancel: end,
  onLostPointerCapture: end,
}
