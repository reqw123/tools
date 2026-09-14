import { ArrowLeftRight } from 'lucide-react'
import { useShareInfo } from '../hooks/useShareInfo'

/**
 * 工具列上「切換到另一面牆」的鈕——只有透過多人牆閘道（`share-gateway`）
 * 啟動時才出現（`share-info` 的 `otherWall` 欄位由閘道啟動器帶的環境變數
 * 填入，見 `server/share.ts`）。獨立啟動器（沒有閘道）沒有這個欄位，鈕
 * 完全不會出現，不影響現有的單機／獨立共用模式。
 *
 * 點下去是整頁導向閘道自己的 `/switch-wall?to=...`（不是 SPA 內部路由）——
 * 閘道處理完 cookie 就會 302 導回 `/wall`，換一個後端接手同一個網址。
 */
export function SwitchWallButton() {
  const { otherWall } = useShareInfo()
  if (!otherWall) return null
  return (
    <a
      className="toggle"
      href={otherWall.switchUrl}
      title={`切換到${otherWall.label}（同一個網址、同一次登入）`}
    >
      <ArrowLeftRight size={15} strokeWidth={2.2} aria-hidden />
      <span>切換到{otherWall.label}</span>
    </a>
  )
}
