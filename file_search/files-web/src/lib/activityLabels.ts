import { Download, FilePlus, FileX, ListPlus, ListX, Pencil, Plus, Trash2, Wifi, WifiOff } from 'lucide-react'
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
