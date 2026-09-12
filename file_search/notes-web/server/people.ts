/**
 * 「簡易身分記憶與認證」——填了名字就一定要順便設一個 PIN，之後只有知道 PIN
 * 的人能再用這個名字登入。**名字＋PIN 一旦定了就不能自己改**——牆上沒有
 * 「改名字」「換 PIN」的功能，想換得先請牆主在 `/host` 把這個名字的保護解除
 * （`releasePerson()`），名字才會變回沒人用過的狀態。匿名（名字留空）不受
 * 這條限制，永遠可以直接進、每次都能重新選要不要具名。
 *
 * 設計成「簡易」：
 * - 沒有帳號管理介面，忘記 PIN 就請牆主在 `/host` 解除保護，或直接開
 *   `.sticky_wall_people.json` 刪掉那一筆。
 * - 認證用一張**無狀態**的簽章 cookie（HMAC，用共用密碼當金鑰）——不用另外維護
 *   一份「誰現在登入」的 session 表，server 重開也不影響已經核發的 cookie
 *   （除非共用密碼跟著換，換密碼＝所有身分一起失效，這是刻意的「全部重置」）。
 * - PIN 只在登入當下核對一次；核對過的名字進了簽章 cookie，之後每個請求靠
 *   cookie 認人（`identity.ts` 的 `authorFrom()` 優先看這個，蓋過前端自己填的
 *   標頭）——這樣「已經登入的人」沒辦法臨時把標頭改成別人的名字來冒充。
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { notesFilePath } from './store'
import { atomicWriteFile } from './atomic-write'

// 2026-09 搬進 .share/（純 notes-web 概念、桌面版不讀——見 store.ts 的
// migrateLegacyDataLayout() 負責把舊位置的檔案一次性搬過來）。
const PEOPLE_FILE = join(dirname(notesFilePath), '.share', 'people.json')
const MAX_NAME = 40
// 4 碼——使用者要求改回來（原本一度拉高到 6 碼）。防冒充主要靠「PIN 只有打
// 對／打錯兩種結果、沒有改的路徑」＋登入限速（15 分鐘錯 10 次擋 15 分鐘），
// 不是靠拉長碼數硬撐，4 碼配這兩層防護已經夠用、也比較好記。
const MIN_PIN = 4
const MAX_PIN = 20

export type PersonRole = 'editor' | 'viewer'

interface PersonRecord {
  pinHash: string
  createdAt: string
  /** 缺省視為 'editor'——舊資料、沒被 host 特別設過的人都一樣，維持現況
   *  可編輯。只有 host 在 /host 明確設成 'viewer' 才會被鎖唯讀。 */
  role?: PersonRole
  /** 這個人自己的 Discord webhook——**由 host 手動輸入**（使用者私下把
   *  webhook 網址給 host，不是自助填寫；沒有開放給一般使用者自己改的端點，
   *  只有 `/host` 這個 loopback-only 的管理面板能設），指派給他的便利貼快
   *  到期／已逾期時，Node-RED 用這個推播到他自己的 Discord 頻道（見
   *  `GET /host/due-webhooks`）。''＝沒設過。 */
  discordWebhook?: string
}
type PeopleFile = Record<string, PersonRecord>

function readPeople(): PeopleFile {
  try {
    const data = JSON.parse(readFileSync(PEOPLE_FILE, 'utf-8')) as unknown
    return data && typeof data === 'object' ? (data as PeopleFile) : {}
  } catch {
    return {}
  }
}

function writePeople(data: PeopleFile): void {
  atomicWriteFile(PEOPLE_FILE, JSON.stringify(data, null, 1))
}

function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}

export interface PersonSummary {
  name: string
  createdAt: string
  role: PersonRole
  discordWebhook: string
}

/** 目前被 PIN 保護的名字清單（不含 PIN 本身）——給 host.html 的管理面板用。 */
export function listPeople(): PersonSummary[] {
  const people = readPeople()
  return Object.entries(people)
    .map(([name, rec]) => ({
      name,
      createdAt: rec.createdAt,
      role: rec.role ?? 'editor',
      discordWebhook: rec.discordWebhook ?? '',
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 只回名字（不含 createdAt／PIN）——給指派便利貼的下拉建議清單用。這些名字
 *  本來就會出現在動態記錄／在場提示裡，不是新的資訊外洩。 */
export function listPersonNames(): string[] {
  return Object.keys(readPeople())
}

/** 這個人現在是不是唯讀——名字為空（匿名）或查不到這個人一律當 'editor'，
 *  對齊「匿名預設可編輯」的決策；只有 host 明確設成 'viewer' 才會被鎖。 */
export function getPersonRole(name: string): PersonRole {
  if (!name) return 'editor'
  return readPeople()[name]?.role ?? 'editor'
}

/** host 專用——設定某個已註冊名字的角色。找不到這個人回 false。不動
 *  `createdAt`（那是簽進身分 cookie 的版本號，改角色不該讓現有 session 失效；
 *  角色本身是即時查live 的，不用重新登入就生效）。 */
export function setPersonRole(name: string, role: PersonRole): boolean {
  const n = name.trim().slice(0, MAX_NAME)
  const people = readPeople()
  if (!people[n]) return false
  people[n].role = role
  writePeople(people)
  return true
}

const MAX_WEBHOOK = 300
/** Discord webhook 網址的形狀檢查——只收 discord.com／discordapp.com 底下的
 *  `/api/webhooks/...` 路徑。這不是防禦不信任輸入（這個值只有 host 自己在
 *  `/host` 才填得進去，不是遠端使用者能碰到的欄位），單純是「貼錯連結」的
 *  防呆——host 手動轉貼使用者傳來的網址，打錯或貼到別的東西時立刻擋下來，
 *  總比讓 Node-RED 之後對著一個錯的網址狂送請求好。 */
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/

/** 這個人現在設定的 Discord webhook——查不到這個人或沒設過一律回 ''。 */
export function getPersonDiscordWebhook(name: string): string {
  if (!name) return ''
  return readPeople()[name]?.discordWebhook ?? ''
}

/** host 專用——設定或清除某個已註冊名字的 Discord webhook。webhook 留空是
 *  「清除」；非空但格式不像 Discord webhook 網址就拒絕（見上面
 *  DISCORD_WEBHOOK_PATTERN），回傳錯誤訊息。找不到這個人也算錯誤。 */
export function setPersonDiscordWebhook(
  name: string,
  webhook: string,
): { ok: true } | { ok: false; error: string } {
  const n = name.trim().slice(0, MAX_NAME)
  const people = readPeople()
  if (!people[n]) return { ok: false, error: '找不到這個名字' }
  const w = webhook.trim().slice(0, MAX_WEBHOOK)
  if (w && !DISCORD_WEBHOOK_PATTERN.test(w)) {
    return { ok: false, error: '看起來不是 Discord webhook 網址（要是 https://discord.com/api/webhooks/... 這種格式）' }
  }
  people[n].discordWebhook = w
  writePeople(people)
  return { ok: true }
}

/**
 * 「有人忘記 PIN 了」的自助解法——host 在管理面板點一下，把這個名字的保護
 * 解除（從 `.sticky_wall_people.json` 刪掉那一筆）。名字本身不會消失，只是
 * 變回「沒設過 PIN」的狀態：下次任何人都能重新用這個名字登入、順便設新 PIN。
 */
export function releasePerson(name: string): boolean {
  const n = name.trim().slice(0, MAX_NAME)
  const people = readPeople()
  if (!people[n]) return false
  delete people[n]
  writePeople(people)
  return true
}

/** 這個名字現在是不是被 PIN 保護中——`identity.ts` 的 `fromHeader()` 用來擋掉
 *  「沒登入（沒有簽章 cookie）卻在 `x-note-author` 標頭硬填一個受保護的名字」
 *  這種冒用：沒有這一關，任何人都能不用 PIN、單純改標頭就假冒已經被保護的
 *  名字，PIN 保護形同虛設。 */
export function isProtectedName(name: string): boolean {
  const n = name.trim().slice(0, MAX_NAME)
  if (!n) return false
  return !!readPeople()[n]
}

export interface ClaimResult {
  ok: boolean
  error?: string
}

/**
 * 登入時呼叫：name 留空＝匿名，永遠 ok。name 是新名字——**一定要順便給 pin**
 * （≥{@link MIN_PIN} 碼），當場註冊、保護起來，名字＋PIN 就此固定，牆上沒有
 * 「改名字」「換 PIN」的功能（要換得請牆主在 `/host` 解除保護）。name 已經
 * 被註冊過——一定要給對 pin，PIN 本身不可能被「改掉」（沒有任何路徑允許用
 * 新 pin 覆蓋舊的）。**PIN 忘記＝這個名字自己救不回來**，只有牆主能在
 * `/host` 解除；錯誤訊息刻意把這個後果講清楚，不要讓人抱著「應該還能找回來」
 * 的僥倖心態隨便亂設 PIN。
 */
export function claimOrVerify(name: string, pin: string): ClaimResult {
  const n = name.trim().slice(0, MAX_NAME)
  if (!n) return { ok: true }
  const p = pin.trim().slice(0, MAX_PIN)
  const people = readPeople()
  const rec = people[n]

  if (!rec) {
    if (!p) {
      return {
        ok: false,
        error: `想用「${n}」這個名字要順便設一個 PIN（至少 ${MIN_PIN} 碼）——設定後這組名字＋PIN 就固定了，之後不能自己改。請務必記住：PIN 忘記的話這個名字你自己救不回來，只有牆主能在 /host 解除保護，在那之前這個名字你進不來。`,
      }
    }
    if (p.length < MIN_PIN) return { ok: false, error: `PIN 至少要 ${MIN_PIN} 碼` }
    people[n] = { pinHash: hashPin(p), createdAt: new Date().toISOString() }
    writePeople(people)
    return { ok: true }
  }

  if (!p) {
    return {
      ok: false,
      error: `「${n}」這個名字已經被保護，需要輸入 PIN——忘記的話沒有辦法自己救回，只能請牆主到 /host 解除保護，或換一個沒人用過的名字`,
    }
  }
  const a = Buffer.from(hashPin(p))
  const b = Buffer.from(rec.pinHash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: `PIN 不對——忘記的話一樣是請牆主到 /host 解除保護，這裡沒有「忘記 PIN」的自助流程` }
  }
  return { ok: true }
}

// ── 身分 cookie：無狀態簽章 ───────────────────────────────────────────
// 金鑰用共用密碼——換密碼＝所有已核發的身分 cookie 一起失效，等於「全部重置」，
// 不用另外管一份 secret 檔案。跟 share.ts 的 SHARE_TOKEN 分開讀，避免兩個
// module 互相 import 造成循環相依。
const SHARE_TOKEN_FOR_HMAC = (process.env.SHARE_TOKEN ?? '').trim()

function hmac(payload: string): string {
  return createHmac('sha256', SHARE_TOKEN_FOR_HMAC || 'no-share-token')
    .update(payload)
    .digest('hex')
    .slice(0, 32)
}

/**
 * 登入成功後發給前端種進 cookie 的值。把這個名字**現在這筆** `PersonRecord`
 * 的 `createdAt` 一起簽進去（當「版本號」用）——不然光靠 HMAC 簽章是無狀態
 * 的，`releasePerson()` 從檔案裡刪掉那筆紀錄，舊 cookie 光看簽章照樣驗得過，
 * 「解除保護」等於沒發生：舊 cookie 持有者可以一直冒充到瀏覽器關掉為止。
 * 綁進 createdAt 之後，release（紀錄消失）或换新 PIN 重新註冊（createdAt
 * 換新的）都會讓舊 cookie 驗證失敗，真正達到撤銷的效果。
 */
export function identityToken(name: string): string {
  const version = readPeople()[name]?.createdAt ?? ''
  return (
    `${Buffer.from(name, 'utf8').toString('base64url')}` +
    `.${Buffer.from(version, 'utf8').toString('base64url')}` +
    `.${hmac(`${name}|${version}`)}`
  )
}

/** 驗證 cookie 值，回傳它綁定的名字；驗證失敗（沒帶／格式壞／簽章不對／這個
 *  名字現在的保護狀態跟簽章當時對不上——已經被 release 或換過新 PIN）回 ''。 */
export function verifyIdentityToken(token: string | undefined): string {
  if (!token) return ''
  const parts = token.split('.')
  if (parts.length !== 3) return ''
  const [b64name, b64version, mac] = parts
  let name: string
  let version: string
  try {
    name = Buffer.from(b64name, 'base64url').toString('utf8')
    version = Buffer.from(b64version, 'base64url').toString('utf8')
  } catch {
    return ''
  }
  if (!name) return ''
  const expect = hmac(`${name}|${version}`)
  const a = Buffer.from(mac)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return ''
  // 簽章本身沒問題，但要現在這個名字的保護狀態（createdAt）還跟簽的時候一樣
  // ——release 把紀錄刪掉、或名字被重新註冊拿到新的 createdAt，都要讓舊 cookie
  // 失效，不能只信一張簽好就永遠有效的紙。
  const currentVersion = readPeople()[name]?.createdAt ?? ''
  if (currentVersion !== version) return ''
  return name
}

export const IDENTITY_COOKIE = 'identity_session'
