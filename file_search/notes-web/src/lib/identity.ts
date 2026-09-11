/**
 * 「你的名字」——共用牆上的輕量身分，純顯示用（誰新增/改/刪了什麼、誰正在
 * 編輯），不是帳號／驗證。存在這個瀏覽器的 localStorage，每個 API 請求帶
 * `x-note-author` 標頭（見 lib/api.ts 的 req()）。可留空＝匿名，畫面上顯示「有人」。
 *
 * ⚠️ 這裡存的只是「這個瀏覽器顯示什麼名字」，完全不代表拿得到那個名字的
 * PIN 保護——如果這裡存的名字剛好已經被別人（或自己）在密碼牆設過 PIN，
 * server 端（`server/identity.ts` 的 `fromHeader()`）會直接把它當匿名，不會
 * 讓沒有簽章 cookie 的請求冒用已經固定住的名字。真正「被保護的名字」只認
 * `identity_session` cookie，不是這個 localStorage 值——這是刻意的，見
 * `components/PasswordGate.tsx` 的說明。
 */
const KEY = 'sticky-wall-author-name'
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

/**
 * 給 `x-note-author` 標頭用的值——**一定要 `encodeURIComponent`**。HTTP 標頭值
 * 照規格只能是 ByteString（每個字元 ≤ 255），中文名字直接塞進去瀏覽器的
 * `fetch()`/`Headers` 會直接丟 TypeError（「value greater than 255」），不是
 * 送到 server 才發現亂碼。server 端 `identity.ts` 的 `authorFrom()` 對應解碼。
 */
export function authorHeaderValue(): string {
  return encodeURIComponent(readAuthorName())
}

/** 沒填過名字時，活動記錄／在場提示要顯示的字。 */
export const ANONYMOUS_LABEL = '有人'

export function displayAuthor(name: string): string {
  return name || ANONYMOUS_LABEL
}

const CLIENT_ID_KEY = 'sticky-wall-client-id'

/**
 * 這個分頁的隨機識別碼——只給「在場編輯」用（見 `useEditingHeartbeat` /
 * `server/presence.ts`）：匿名（沒填名字）的人 server 端分不出是誰，退而
 * 求其次用來源 IP 當 key，但**同一 IP 下的不同匿名使用者**（同一 Wi-Fi／NAT，
 * 常見於區網共用牆）會因此撞成同一個 key，A 的心跳蓋掉 B、A 關掉編輯視窗
 * 會連帶讓 B 從 presence 消失。帶上這個 id 讓 server 端可以把同 IP 下的不同
 * 分頁分開算。存在 `sessionStorage`（分頁關掉就消失，本來就只是即時提示，
 * 不用更持久）；具名的人不受影響，一律用名字合併（`identityKey()`）。
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
    return '' // private mode 等存不進去——退回沒有 clientId，server 端退回舊的 IP-only key
  }
}
