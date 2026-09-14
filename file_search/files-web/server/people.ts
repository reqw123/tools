/**
 * 「簡易身分記憶與認證」——搬自 notes-web/server/people.ts，邏輯完全相同
 * （名字＋PIN 一旦定了就不能自己改，忘記 PIN 只能請牆主在 `/host` 解除
 * 保護），只拿掉 `discordWebhook` 欄位——索引牆沒有「到期提醒」這種需要
 * 通知個人 Discord 頻道的概念。
 *
 * - 沒有帳號管理介面，忘記 PIN 就請牆主在 `/host` 解除保護。
 * - 認證用一張**無狀態**的簽章 cookie（HMAC，用共用密碼當金鑰）——換共用
 *   密碼＝所有身分一起失效。
 * - PIN 只在登入當下核對一次；核對過的名字進了簽章 cookie，之後每個請求
 *   靠 cookie 認人（`identity.ts` 的 `authorFrom()` 優先看這個）。
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { indexDir } from './store'
import { atomicWriteFile } from './atomic-write'

// 跟 notes-web 一樣收在 `.share/` 底下——共用模式專屬、桌面版不讀的狀態，
// 跟索引集本身（`.md`）分開放。這是全新資料夾，沒有舊資料要搬。
const PEOPLE_FILE = join(indexDir, '.share', 'people.json')
const MAX_NAME = 40
// 4 碼——防冒充主要靠「PIN 只有打對／打錯兩種結果、沒有改的路徑」＋登入限速
// （15 分鐘錯 10 次擋 15 分鐘），不是靠拉長碼數硬撐。
const MIN_PIN = 4
const MAX_PIN = 20

export type PersonRole = 'editor' | 'viewer'

interface PersonRecord {
  pinHash: string
  createdAt: string
  /** 缺省視為 'editor'——舊資料、沒被 host 特別設過的人都一樣，維持現況
   *  可編輯。只有 host 在 /host 明確設成 'viewer' 才會被鎖唯讀。 */
  role?: PersonRole
}
type PeopleFile = Record<string, PersonRecord>

// 快取檔案內容、用 mtime 判斷有沒有變動，沒變就跳過磁碟讀取（見
// notes-web/server/people.ts 開頭同一段說明——這裡邏輯完全照搬）。
let cache: { mtimeMs: number; raw: string } | null = null

function readPeople(): PeopleFile {
  try {
    const mtimeMs = statSync(PEOPLE_FILE).mtimeMs
    if (!cache || cache.mtimeMs !== mtimeMs) {
      cache = { mtimeMs, raw: readFileSync(PEOPLE_FILE, 'utf-8') }
    }
    const data = JSON.parse(cache.raw) as unknown
    return data && typeof data === 'object' ? (data as PeopleFile) : {}
  } catch {
    cache = null
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
}

/** 目前被 PIN 保護的名字清單（不含 PIN 本身）——給 host.html 的管理面板用。 */
export function listPeople(): PersonSummary[] {
  const people = readPeople()
  return Object.entries(people)
    .map(([name, rec]) => ({ name, createdAt: rec.createdAt, role: rec.role ?? 'editor' }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 這個人現在是不是唯讀——名字為空（匿名）或查不到這個人一律當 'editor'。 */
export function getPersonRole(name: string): PersonRole {
  if (!name) return 'editor'
  return readPeople()[name]?.role ?? 'editor'
}

/** host 專用——設定某個已註冊名字的角色。找不到這個人回 false。 */
export function setPersonRole(name: string, role: PersonRole): boolean {
  const n = name.trim().slice(0, MAX_NAME)
  const people = readPeople()
  if (!people[n]) return false
  people[n].role = role
  writePeople(people)
  return true
}

/**
 * 「有人忘記 PIN 了」的自助解法——host 在管理面板點一下，把這個名字的保護
 * 解除。名字本身不會消失，只是變回「沒設過 PIN」的狀態。
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
 *  「沒登入卻在 `x-index-author` 標頭硬填一個受保護的名字」這種冒用。 */
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
 * 登入時呼叫：name 留空＝匿名，永遠 ok。name 是新名字——一定要順便給 pin
 * （≥{@link MIN_PIN} 碼），當場註冊、保護起來，名字＋PIN 就此固定。
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
const SHARE_TOKEN_FOR_HMAC = (process.env.SHARE_TOKEN ?? '').trim()

function hmac(payload: string): string {
  return createHmac('sha256', SHARE_TOKEN_FOR_HMAC || 'no-share-token')
    .update(payload)
    .digest('hex')
    .slice(0, 32)
}

/**
 * 登入成功後發給前端種進 cookie 的值。把這個名字現在這筆 `PersonRecord` 的
 * `createdAt` 一起簽進去（當「版本號」用）——`releasePerson()` 之後舊 cookie
 * 才會真的失效，不是永遠有效。
 */
export function identityToken(name: string): string {
  const version = readPeople()[name]?.createdAt ?? ''
  return (
    `${Buffer.from(name, 'utf8').toString('base64url')}` +
    `.${Buffer.from(version, 'utf8').toString('base64url')}` +
    `.${hmac(`${name}|${version}`)}`
  )
}

/** 驗證 cookie 值，回傳它綁定的名字；驗證失敗回 ''。 */
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
  const currentVersion = readPeople()[name]?.createdAt ?? ''
  if (currentVersion !== version) return ''
  return name
}

export const IDENTITY_COOKIE = 'identity_session'
