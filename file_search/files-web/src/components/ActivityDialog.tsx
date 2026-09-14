import { useEffect, useRef } from 'react'
import { useActivity, useCombinedActivity, useCombinedOnline } from '../hooks/useActivity'
import { useShareInfo } from '../hooks/useShareInfo'
import { displayAuthor } from '../lib/identity'
import { timeAgo } from '../lib/format'
import { scrimClose } from '../lib/scrimClose'
import { WALL_LABEL, isNoTargetActivity, verbOfActivity } from '../lib/activityLabels'

/**
 * 「誰動了這份索引」——最近的新增／編輯／移除記錄。純記憶體（見
 * server/activity.ts），server 重開就清空；只是提示性資訊，不是稽核紀錄。
 * 搬自 notes-web/src/components/ActivityDialog.tsx，改用 files-web 既有的
 * `.modal` 對話框慣例（不是 notes-web 的 `.sheet`）。
 *
 * **合併動態**（2026-09 加，使用者要求「共用身分了，動態能不能不切牆就看
 * 得到全貌」；一開始做成要手動勾選的核取方塊，使用者接著要求「乾脆統一
 * 顯示」，改成閘道模式下預設就是合併好的一份，不用另外勾）：只要透過多人
 * 牆閘道（`otherWall` 有值）就直接叫 `useCombinedActivity()`（打閘道自己的
 * `/combined-activity`，見 `share-gateway/index.mjs`）取代平常的
 * `useActivity()`。合併回來的每一筆多一個 `wall` 欄位，渲染文字要看這個
 * 欄位挑「自己的」還是「便利貼牆的」動詞字典（見 `lib/activityLabels.ts`
 * 的 `verbOfActivity`／`isNoTargetActivity`，跟 `ActivityTicker.tsx` 共用
 * 同一份，便利貼牆多了 `assigned`／`restore` 這兩種索引牆沒有的動作）。
 * 獨立啟動器（沒有 `otherWall`）完全不受影響，看起來跟改之前一樣。
 *
 * **合併在線名單**（同一次使用者要求「連線/斷線也共用」，追問後確認要的
 * 是「在線人數/是誰在線」這個即時狀態真的合併，不只是動態記錄裡看得到對方
 * 的連線/斷線歷史）：`useCombinedOnline()` 打閘道的 `/combined-online`，
 * 列在動態清單上方一行「目前在線」。
 *
 * **切牆合併成中性事件**（使用者測完發現切牆本身會產生一則斷線＋一則
 * 連線，反映「這人真的離開了另一面牆的 SSE」是正確的，但使用者接著指出
 * 「有些人看便利貼、有些人看索引牆，彼此不知道對方狀態」時，這種切牆雜訊
 * 會跟「真的有人離開/加入」混在一起分不出來）：閘道端（`collapseWallSwitches()`）
 * 偵測到就直接把這對事件合併成 `action==='switch-wall'` 送過來，這裡只要
 * 認得這個 action、用 `toWall` 顯示「切去了 XX 牆」，不用自己做配對。
 */
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const otherWall = useShareInfo().otherWall
  const own = useActivity(100)
  const combined = useCombinedActivity(100)
  const online = useCombinedOnline()
  const { data: entries, isLoading, isError } = otherWall ? combined : own

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="動態"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>動態</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">
            最近誰新增／改／移除了什麼、誰連線／斷線——只記這台 server 開著這段
            期間的（重開就清空），純提示用，不是完整稽核紀錄。桌面版的改動不會
            出現在這裡。
          </p>

          {otherWall && (
            <p className="sub">
              {online.isLoading
                ? '// 目前在線：讀取中…'
                : online.data && online.data.length > 0
                  ? `目前在線：${online.data.map(displayAuthor).join('、')}`
                  : '目前沒有具名使用者在線。'}
            </p>
          )}

          {isLoading ? (
            <p className="sub">// 讀取中…</p>
          ) : isError ? (
            <p className="err">讀取動態失敗。</p>
          ) : (
            <ul className="activity-list">
              {(entries ?? []).map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className="activity-line">
                    {e.action === 'switch-wall' && 'toWall' in e && e.toWall ? (
                      <>
                        {displayAuthor(e.author)} 切去了{WALL_LABEL[e.toWall]}
                      </>
                    ) : (
                      <>
                        {'wall' in e && e.wall === 'notes' && <span className="activity-wall-tag">便利貼牆</span>}
                        {displayAuthor(e.author)} {verbOfActivity(e)}
                        {isNoTargetActivity(e)
                          ? ''
                          : e.count
                            ? ` ${e.count} 筆`
                            : `「${e.title || e.indexName || '(無標題)'}」`}
                        {'target' in e && e.target && ` 給 ${displayAuthor(e.target)}`}
                      </>
                    )}
                  </span>
                  <span className="activity-time">{timeAgo(e.at)}</span>
                </li>
              ))}
              {(entries ?? []).length === 0 && <li className="sub">目前沒有任何記錄</li>}
            </ul>
          )}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
