/**
 * 「你的名字」——共用索引牆上的輕量身分，純顯示用（誰新增/改/移除了什麼、
 * 誰正在看哪份索引集），不是帳號／驗證。搬自 notes-web/src/lib/identity.ts，
 * 只把 storage key／標頭名稱換成索引牆自己的（`x-note-author` →
 * `x-index-author`），機制完全相同。
 *
 * ⚠️ 這裡存的只是「這個瀏覽器顯示什麼名字」，完全不代表拿得到那個名字的
 * PIN 保護——如果這裡存的名字剛好已經被別人（或自己）在密碼牆設過 PIN，
 * server 端（`server/identity.ts` 的 `fromHeader()`）會直接把它當匿名。
 */
const KEY = 'index-wall-author-name'
const MAX_LEN = 40

export function readAuthorName(): string {
  try {
    return (localStorage.getItem(KEY) ?? '').slice(0, MAX_LEN)
  } catch {
    return ''
  }
}

export function saveAuthorName(name: string): void {
  try {
    const v = name.trim().slice(0, MAX_LEN)
    if (v) localStorage.setItem(KEY, v)
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode 等存不進去——這次 session 用記憶體值就好，不擋主要功能 */
  }
}

/** 給 `x-index-author` 標頭用的值——一定要 `encodeURIComponent`（見
 *  server/identity.ts 開頭的說明）。 */
export function authorHeaderValue(): string {
  return encodeURIComponent(readAuthorName())
}

/** 沒填過名字時，活動記錄／在場提示要顯示的字。 */
export const ANONYMOUS_LABEL = '有人'

export function displayAuthor(name: string): string {
  return name || ANONYMOUS_LABEL
}

const CLIENT_ID_KEY = 'index-wall-client-id'

/**
 * 這個分頁的隨機識別碼——只給「在場提示」用（見 `server/presence.ts`）：
 * 匿名（沒填名字）的人 server 端分不出是誰，退而求其次用來源 IP 當 key，
 * 但同一 IP 下的不同匿名使用者會撞成同一個 key。帶上這個 id 讓 server 端
 * 可以把同 IP 下的不同分頁分開算。存在 `sessionStorage`（分頁關掉就消失）。
 */
export function getClientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(CLIENT_ID_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

const DEVICE_ID_KEY = 'index-wall-device-id'

/**
 * 這個瀏覽器的隨機識別碼——只給「連線／斷線統計」用（見 `useLiveSync.ts`
 * 開 SSE 時帶的 query string／`server/connections.ts`）。故意跟上面的
 * `getClientId()` 分開存：這裡要的是「同一人開好幾個分頁合併算一次連線」，
 * 存在 `localStorage`（同一瀏覽器的所有分頁共用一份、重整不會變）。
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}
