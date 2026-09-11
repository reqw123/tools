/**
 * 「這是誰」——共用牆上的輕量身分。兩層：
 *
 * 1. **已認證**：登入時名字被 PIN 保護、且 PIN 對了 → server 發一張簽章 cookie
 *    （`people.ts`）。之後每個請求優先看這張 cookie 認人，前端傳什麼
 *    `x-note-author` 都蓋不掉——已經登入的人沒辦法臨時把標頭改成別人的名字
 *    來冒充，這是「認證」的意義所在。
 * 2. **未認證／匿名**：沒登入這個名字 → 退回舊行為，直接信 `x-note-author`
 *    標頭（前端自由填字，見 lib/identity.ts）——**除非標頭填的剛好是一個已經
 *    被 PIN 保護的名字**，那樣一定是冒用（真正的擁有者會有簽章 cookie，走
 *    第 1 層），直接當匿名，不讓沒 PIN 的人白白冒用已經固定住的名字。
 *
 * 標頭值一定是 `encodeURIComponent` 過的（見前端 lib/identity.ts 的
 * `authorHeaderValue()`）——HTTP 標頭照規格只能塞 ByteString（每個字元碼點
 * ≤ 255），中文名字不編碼的話，瀏覽器的 `fetch()` 設定標頭那一刻就會直接
 * 丟 TypeError，不是傳到這裡才亂碼。
 */
import type { FastifyRequest } from 'fastify'
import { IDENTITY_COOKIE, isProtectedName, verifyIdentityToken } from './people'

const MAX_LEN = 40
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

function fromHeader(req: FastifyRequest): string {
  const raw = req.headers['x-note-author']
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string' || !s) return ''
  let decoded: string
  try {
    decoded = decodeURIComponent(s)
  } catch {
    return '' // 不是合法的 percent-encoding（不是這支前端送的）——當匿名，別讓一個爛標頭炸掉請求
  }
  const name = decoded.replace(CONTROL_CHARS, '').trim().slice(0, MAX_LEN)
  // 會走到這裡，代表沒有有效的簽章 cookie（authorFrom() 優先看 cookie，驗證
  // 成功就直接回傳、不會呼叫這裡）——也就是沒登入，或登入時沒打對這個名字的
  // PIN。這種情況下標頭硬填一個「已經被保護」的名字一定是冒用，直接當匿名，
  // 不讓沒 PIN 的人白白用到已經固定住的名字。
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
 * 「這個人」的 key——具名（通過 PIN 驗證，或哪怕只是自己填的名字）就用名字，
 * 同一人多開視窗／分頁自然合併成一個；**匿名分不出是誰**，退而求其次用來源
 * IP，讓不同人的匿名連線／編輯還是分得開，不會全部擠成同一個「有人」。
 * presence.ts（誰在編輯）、connections.ts（誰上線）共用同一個規則。
 */
export function identityKey(author: string, ip: string): string {
  return author || `anon:${ip}`
}
