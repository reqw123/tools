import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 原子寫入：先寫到暫存檔、成功後才 rename 換掉目標檔案——寫到一半崩潰／
 * 斷電不會留下半截 JSON（讀取端會 catch 成空值 → 設定或資料整份遺失）。
 * 對應桌面版 `repositories/atomic_io.py`。
 *
 * 抽出這支之前，`store.ts`／`card.ts`／`people.ts`／`visits.ts` 各自手刻了
 * 一份幾乎一樣的版本（自己的 `tmpSeq` 計數器、同樣的 try/catch/rmSync 清理）
 * ——四份程式碼要同步維護（例如處理 Windows 檔案鎖住時的重試），也容易像
 * `store.ts` 那樣，重構時漏改而不自知。只有 `store.ts` 需要額外的
 * `topicForFile`/`emitChange` 廣播（見那邊的 `writeSharedFile()`），其餘三個
 * 呼叫端自己決定要不要、用什麼 topic 廣播。
 */
let tmpSeq = 0

export function atomicWriteFile(target: string, text: string): void {
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`
  try {
    writeFileSync(tmp, text, 'utf-8')
    renameSync(tmp, target)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 暫存檔清不掉就算了，不掩蓋原本的寫入錯誤 */
    }
    throw err
  }
}
