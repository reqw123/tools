const KEY = 'index-wall-panel-collapsed'

/**
 * 上方面板（主標題／簡介＋動態面板＋工具列全部：索引集選擇/檢視切換/動態按鈕、
 * 加入索引等操作鈕、搜尋/篩選/分組/排序）收合狀態——跟便利貼牆同一套設計
 * （見 notes-web/src/lib/panelCollapse.ts）：手機螢幕小，這塊面板占掉太多
 * 高度，索引項目被擠到看不到幾筆，捲動項目時也容易不小心捲回這塊。收合只
 * 影響這一塊，項目清單本身永遠看得到。純粹是「這個瀏覽器」的顯示偏好，存
 * localStorage，不是牆面共用設定（不同人手機/桌機喜好不用互相影響）。
 * App.tsx（主標題那塊）跟 Toolbar.tsx（工具列那幾排）共用同一個狀態，一起
 * 收合／展開。key 跟便利貼牆的 `sticky-wall-panel-collapsed` 分開，兩個是
 * 不同網頁（不同 origin/port），本來就不會互相干擾，用不同名字只是清楚。
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
