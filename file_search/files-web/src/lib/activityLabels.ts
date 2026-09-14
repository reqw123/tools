import {
  ArrowLeftRight,
  Download,
  FilePlus,
  FileX,
  ListPlus,
  ListX,
  Pencil,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import type { ActivityAction } from './api'

/**
 * 動態記錄的中文動詞／圖示對照表——搬自 notes-web 的
 * `ActivityTicker.tsx`／`ActivityDialog.tsx`，但那邊兩個檔案各自複製一份
 * 一模一樣的字典（notes-web 的已知技術債，見 CLAUDE.md）；這裡直接抽成
 * 共用模組，兩個元件都從這裡讀，之後要加新動作只用改一個地方。
 */
export const ACTIVITY_VERB: Record<ActivityAction, string> = {
  create: '加入了',
  update: '編輯了',
  delete: '移除了',
  'bulk-add': '批次加入了',
  'bulk-delete': '批次移除了',
  'index-import': '匯入了索引集',
  'index-create': '新增了索引集',
  'index-delete': '刪除了索引集',
  connect: '已連線',
  disconnect: '已斷線',
}

export const ACTIVITY_ICON: Record<ActivityAction, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  'bulk-add': ListPlus,
  'bulk-delete': ListX,
  'index-import': Download,
  'index-create': FilePlus,
  'index-delete': FileX,
  connect: Wifi,
  disconnect: WifiOff,
}

/** 沒有對應項目的動作——「小明 已連線」不用再接「「XXX」」。 */
export const ACTIVITY_NO_TARGET = new Set<ActivityAction>(['connect', 'disconnect'])

/**
 * notes-web（便利貼牆）自己的動作字典，從
 * `notes-web/src/components/ActivityDialog.tsx` 抄一份過來——只有「合併
 * 動態」（多人牆閘道模式，見 `useCombinedActivity`）需要認得對方的動作
 * 種類，這裡是索引牆完全不會自己產生的一組動作（`assigned`／`restore`），
 * 不併進上面 `ACTIVITY_VERB` 那份（型別上 `ActivityAction` 也不包含這些）。
 */
export const NOTES_ACTIVITY_VERB: Record<string, string> = {
  create: '新增了',
  update: '編輯了',
  delete: '刪除了',
  restore: '復原了',
  'bulk-delete': '批次刪除了',
  assigned: '指派了',
  connect: '已連線',
  disconnect: '已斷線',
}
export const NOTES_ACTIVITY_NO_TARGET = new Set(['connect', 'disconnect'])

/** 中文牆名——「切去了 XX 牆」這類合併動態的中性事件用。 */
export const WALL_LABEL: Record<'notes' | 'files', string> = { notes: '便利貼牆', files: '索引牆' }

/**
 * 以下三個函式給「動態」的兩處顯示（`ActivityDialog.tsx`／
 * `ActivityTicker.tsx`）共用——同一份合併動態資料要在對話框歷史清單、
 * 標題右側常駐面板都顯示一致，2026-09 從各自複製一份的寫法抽出來，避免
 * 兩處各改一次、漏改另一處（notes-web 的 Dialog/Ticker 目前還是各自一份，
 * 是它自己的已知技術債，見上面 `NOTES_ACTIVITY_VERB` 的說明）。傳入的
 * entry 型別故意寫最小需要的形狀（`action`/`wall` 必要，其餘全選填），
 * 這樣 `ActivityEntry`（純自己這面牆）跟 `CombinedActivityEntry`（合併
 * 動態）都能直接傳進來，不用另外轉型。 */
interface AnyActivityLike {
  action: string
  wall?: 'notes' | 'files'
}

/** 這一筆是不是「沒有對象」的動作（連線/斷線）——依 `wall` 挑對的字典，
 *  沒有 `wall` 欄位（一般模式，沒經過閘道）當自己的（'files'）。 */
export function isNoTargetActivity(e: AnyActivityLike): boolean {
  return e.wall === 'notes' ? NOTES_ACTIVITY_NO_TARGET.has(e.action) : ACTIVITY_NO_TARGET.has(e.action as ActivityAction)
}

export function verbOfActivity(e: AnyActivityLike): string {
  return e.wall === 'notes'
    ? (NOTES_ACTIVITY_VERB[e.action] ?? e.action)
    : (ACTIVITY_VERB[e.action as ActivityAction] ?? e.action)
}

/** 圖示——`switch-wall`（閘道合成的切牆中性事件）優先判斷；其餘照 `wall`
 *  挑字典，對方（便利貼牆）獨有的動作（`restore`／`assigned`）這邊沒有
 *  對應圖示，退回 `Pencil`，不特地為了兩三個外來動作另建一份圖示字典。 */
export function iconOfActivity(e: AnyActivityLike): typeof Plus {
  if (e.action === 'switch-wall') return ArrowLeftRight
  return e.wall === 'notes' ? Pencil : (ACTIVITY_ICON[e.action as ActivityAction] ?? Pencil)
}
