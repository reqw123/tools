const KEY = 'sticky-wall-panel-collapsed'

/**
 * 上方面板（主標題／簡介／統計數字＋集合分頁＋搜尋排序新增＋小按鈕列）收合
 * 狀態——手機螢幕小，這塊面板占掉太多高度，便利貼被擠到看不到幾張，捲動
 * 便利貼時也容易不小心捲回這塊。收合只影響這一塊，標籤篩選列跟便利貼牆
 * 本身永遠看得到。純粹是「這個瀏覽器」的顯示偏好，存 localStorage，不是
 * 牆面共用設定（不同人手機/桌機喜好不用互相影響）。App.tsx（主標題那塊）
 * 跟 Toolbar.tsx（集合分頁／搜尋排序新增／小按鈕列那三排）共用同一個狀態，
 * 一起收合／展開。
 */
export function getPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setPanelCollapsed(v: boolean): void {
  try {
    if (v) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* 私密視窗等存不進去——這次 session 用記憶體值就好 */
  }
}
