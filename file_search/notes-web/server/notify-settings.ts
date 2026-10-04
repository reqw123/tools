import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { projectRoot } from './store'

/**
 * 通知設定（Discord webhook）——在便利貼牆的「全域設定 → Discord 通知」填，Node-RED 來讀。
 *
 * 以前 webhook 寫死在 Node-RED 的「設定全域變數（Discord/LINE 金鑰）」節點裡，換一次要進 Node-RED 改。
 * 現在由牆保管：Node-RED 定時 GET /api/host/notify-config，放進同一個 global `discordWebhookUrl`，
 * 原本讀這個變數的節點都不用改。
 *
 * - 檔案固定在桌面版的 indexes/.notify_settings.json（不跟 STICKY_NOTES_FILE 走）——桌面牆（8787）和
 *   多人牆（8792，資料在別的資料夾）讀寫同一份，Node-RED 打哪個 port 都拿得到。測試可用 NOTIFY_SETTINGS_FILE 換掉。
 * - webhook 網址等同密碼：所有端點都在 host-routes（一律只認 loopback）；給設定畫面看的只有遮罩後的樣子，
 *   完整網址只有 /host/notify-config（給同一台電腦上的 Node-RED）會回。
 */
const FILE = process.env.NOTIFY_SETTINGS_FILE ?? join(projectRoot, '..', 'indexes', '.notify_settings.json')
const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/(\d+)\/([\w-]+)$/

interface NotifySettings {
  discordWebhookUrl: string
  updatedAt: string
}

function read(): NotifySettings {
  try {
    if (!existsSync(FILE)) return { discordWebhookUrl: '', updatedAt: '' }
    const o = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<NotifySettings>
    return { discordWebhookUrl: typeof o.discordWebhookUrl === 'string' ? o.discordWebhookUrl : '', updatedAt: o.updatedAt ?? '' }
  } catch {
    return { discordWebhookUrl: '', updatedAt: '' }
  }
}

export function getDiscordWebhook(): string {
  return read().discordWebhookUrl
}

/** 給畫面看的遮罩版：只露頻道 id 前 4 碼與 token 末 4 碼。 */
export function maskWebhook(url: string): string {
  const m = WEBHOOK_RE.exec(url)
  if (!m) return url ? '（格式不正確）' : ''
  return `discord.com/api/webhooks/${m[1].slice(0, 4)}…/…${m[2].slice(-4)}`
}

export function discordStatus(): { configured: boolean; masked: string; updatedAt: string } {
  const s = read()
  return { configured: !!s.discordWebhookUrl, masked: maskWebhook(s.discordWebhookUrl), updatedAt: s.updatedAt }
}

/** 設定或清除（空字串＝清除）。格式不對回錯誤訊息。 */
export function setDiscordWebhook(url: string): string | null {
  const u = url.trim()
  if (u && !WEBHOOK_RE.test(u)) return '這不像 Discord webhook 網址（應該是 https://discord.com/api/webhooks/數字/一串英數）'
  atomicWriteFile(FILE, JSON.stringify({ discordWebhookUrl: u, updatedAt: new Date().toISOString() }, null, 1))
  return null
}

/** 用目前設定的 webhook 發一則測試訊息（server 直接打 Discord，不經 Node-RED）。 */
export async function sendDiscordTest(): Promise<{ ok: boolean; error?: string }> {
  const url = getDiscordWebhook()
  if (!url) return { ok: false, error: '還沒設定 webhook' }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: '便利貼牆',
        content: `🔔 測試訊息：便利貼牆的 Discord 通知設定成功（${new Date().toLocaleString('zh-TW', { hour12: false })}）`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (r.ok) return { ok: true }
    return { ok: false, error: r.status === 404 ? 'Discord 說這個 webhook 不存在（可能被刪掉了）' : `Discord 回應 ${r.status}` }
  } catch (err) {
    return { ok: false, error: `連不到 Discord：${err instanceof Error ? err.message : String(err)}` }
  }
}
