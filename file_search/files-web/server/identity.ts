/**
 * 「這是誰」——共用索引牆上的輕量身分。搬自 notes-web/server/identity.ts，
 * 邏輯完全相同，只把標頭名稱從 `x-note-author` 換成 `x-index-author`（見
 * 前端 `lib/identity.ts` 的 `authorHeaderValue()`）。兩層：
 *
 * 1. **已認證**：登入時名字被 PIN 保護、且 PIN 對了 → server 發一張簽章 cookie
 *    （`people.ts`）。之後每個請求優先看這張 cookie 認人，前端傳什麼
 *    `x-index-author` 都蓋不掉。
 * 2. **未認證／匿名**：沒登入這個名字 → 退回舊行為，直接信 `x-index-author`
 *    標頭——**除非標頭填的剛好是一個已經被 PIN 保護的名字**，那樣一定是
 *    冒用，直接當匿名。
 *
 * 標頭值一定是 `encodeURIComponent` 過的——HTTP 標頭照規格只能塞 ByteString
 * （每個字元碼點 ≤ 255），中文名字不編碼的話，瀏覽器的 `fetch()` 設定標頭
 * 那一刻就會直接丟 TypeError。
 */
import type { FastifyRequest } from 'fastify'
import { IDENTITY_COOKIE, isProtectedName, verifyIdentityToken } from './people'

const MAX_LEN = 40
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

function fromHeader(req: FastifyRequest): string {
  const raw = req.headers['x-index-author']
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string' || !s) return ''
  let decoded: string
  try {
    decoded = decodeURIComponent(s)
  } catch {
    return '' // 不是合法的 percent-encoding——當匿名，別讓一個爛標頭炸掉請求
  }
  const name = decoded.replace(CONTROL_CHARS, '').trim().slice(0, MAX_LEN)
  if (name && isProtectedName(name)) return ''
  return name
}

/** 這次請求算誰做的；沒帶／解碼失敗／全空白都回 ''（＝匿名，畫面上顯示「有人」）。 */
export function authorFrom(req: FastifyRequest): string {
  const verified = verifyIdentityToken(req.cookies?.[IDENTITY_COOKIE])
  if (verified) return verified
  return fromHeader(req)
}

/**
 * 「這個人」的 key——具名就用名字，同一人多開視窗／分頁自然合併成一個；
 * 匿名分不出是誰，退而求其次用來源 IP。`deviceId` 是選填的第三個區分依據，
 * 分辨「同一個公網 IP 後面的不同匿名訪客」（見前端 `lib/identity.ts` 的
 * `getDeviceId()`）。
 */
export function identityKey(author: string, ip: string, deviceId?: string): string {
  if (author) return author
  return deviceId ? `anon:${ip}:${deviceId}` : `anon:${ip}`
}
