import { ArrowLeftRight, Pencil, Plus, RotateCcw, Trash2, UserPlus, Wifi, WifiOff } from 'lucide-react'

/**
 * 動態記錄的中文動詞／圖示對照表——2026-09 從 `ActivityDialog.tsx`／
 * `ActivityTicker.tsx` 各自複製一份的寫法（舊的已知技術債，見 CLAUDE.md）
 * 抽成這個共用模組，做法比照 files-web 同名檔案。觸發原因：新增「合併
 * 動態」（多人牆閘道模式）跟「切牆合併成中性事件」時，兩個元件都要認得
 * 同一套對方（索引牆）的動作字典，繼續各自複製一份只會讓下次改東西漏改
 * 另一邊，這次順便一起抽出來。
 */
export const ACTIVITY_VERB: Record<string, string> = {
  create: '新增了',
  update: '編輯了',
  delete: '刪除了',
  restore: '復原了',
  'bulk-delete': '批次刪除了',
  assigned: '指派了',
  connect: '已連線',
  disconnect: '已斷線',
}
export const ACTIVITY_ICON: Record<string, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  restore: RotateCcw,
  'bulk-delete': Trash2,
  assigned: UserPlus,
  connect: Wifi,
  disconnect: WifiOff,
}
/** 沒有對應便利貼的動作——「小明 已連線」不用再接「「XXX」」。 */
export const ACTIVITY_NO_TARGET = new Set(['connect', 'disconnect'])

/** 對方（索引牆）自己的動作字典，從 `files-web/src/lib/activityLabels.ts`
 *  抄一份過來——只有「合併動態」（多人牆閘道模式）需要認得，便利貼牆完全
 *  不會自己產生這幾種動作。 */
export const FILES_ACTIVITY_VERB: Record<string, string> = {
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
export const FILES_ACTIVITY_NO_TARGET = new Set(['connect', 'disconnect'])

/** 中文牆名——「切去了 XX 牆」這類合併動態的中性事件用。 */
export const WALL_LABEL: Record<'notes' | 'files', string> = { notes: '便利貼牆', files: '索引牆' }

interface AnyActivityLike {
  action: string
  wall?: 'notes' | 'files'
}

/** 這一筆是不是「沒有對象」的動作（連線/斷線）——依 `wall` 挑對的字典，
 *  沒有 `wall` 欄位（一般模式，沒經過閘道）當自己的（'notes'）。 */
export function isNoTargetActivity(e: AnyActivityLike): boolean {
  return e.wall === 'files' ? FILES_ACTIVITY_NO_TARGET.has(e.action) : ACTIVITY_NO_TARGET.has(e.action)
}

export function verbOfActivity(e: AnyActivityLike): string {
  return e.wall === 'files' ? (FILES_ACTIVITY_VERB[e.action] ?? e.action) : (ACTIVITY_VERB[e.action] ?? e.action)
}

/** 圖示——`switch-wall`（閘道合成的切牆中性事件）優先判斷；其餘照 `wall`
 *  挑字典，對方（索引牆）獨有的動作這邊沒有對應圖示，退回 `Pencil`。 */
export function iconOfActivity(e: AnyActivityLike): typeof Plus {
  if (e.action === 'switch-wall') return ArrowLeftRight
  return e.wall === 'files' ? Pencil : (ACTIVITY_ICON[e.action] ?? Pencil)
}
