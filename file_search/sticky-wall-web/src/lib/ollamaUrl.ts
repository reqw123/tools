/**
 * Ollama 服務位址的處理——移植自 file_search_app/ai/ollama_provider.py 的
 * normalize_base_url / split_standard_url / build_standard_url / is_local_endpoint /
 * model_in_list。設定視窗用這些把「本機 / 區網另一台」的雙選＋分段輸入呈現出來，
 * 但 .ai_settings.json 存的仍是單一完整 base_url 字串（跟桌面版共用同一份）。
 */

export const DEFAULT_BASE_URL = 'http://localhost:11434'
export const DEFAULT_MODEL = 'llama3.1'
const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = '11434'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', ''])

/** 去頭尾空白與尾端斜線；沒帶 scheme 就補 http://；空字串退回預設。 */
export function normalizeBaseUrl(s: string): string {
  let url = (s || '').trim().replace(/\/+$/, '')
  if (!url) return DEFAULT_BASE_URL
  if (!url.includes('://')) url = `http://${url}`
  return url
}

/**
 * 把位址拆成 { host, isStandard }：
 * - host：中間可改的那段（IP／主機名），空的話回 localhost。
 * - isStandard：整個位址就是 `http://<host>:11434` 的標準樣子 → 可用分段輸入；
 *   有 https／自訂埠／路徑／帳密時為 false → 要退回完整網址輸入框。
 */
export function splitStandardUrl(base: string): { host: string; isStandard: boolean } {
  let u: URL
  try {
    u = new URL(normalizeBaseUrl(base))
  } catch {
    return { host: DEFAULT_HOST, isStandard: false }
  }
  const host = u.hostname || DEFAULT_HOST
  const isStandard =
    u.protocol === 'http:' &&
    u.port === DEFAULT_PORT &&
    (u.pathname === '' || u.pathname === '/') &&
    !u.search &&
    !u.hash &&
    !u.username &&
    !u.password
  return { host, isStandard }
}

/** 分段輸入的反向操作：把中間那段 host 組回 `http://<host>:11434`。 */
export function buildStandardUrl(host: string): string {
  let h = (host || '').trim().replace(/^\/+|\/+$/g, '')
  if (h.includes('://')) {
    try {
      h = new URL(h).hostname || DEFAULT_HOST
    } catch {
      h = DEFAULT_HOST
    }
  }
  if (!h) h = DEFAULT_HOST
  if (h.includes(':') && !h.startsWith('[')) h = `[${h}]` // IPv6 字面位址包中括號
  return `http://${h}:${DEFAULT_PORT}`
}

/** 位址是不是指向這台電腦本身（loopback）。 */
export function isLocalEndpoint(base: string): boolean {
  let host = ''
  try {
    host = (new URL(normalizeBaseUrl(base)).hostname || '').toLowerCase()
  } catch {
    return false
  }
  if (LOCAL_HOSTS.has(host)) return true
  const m = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(host)
  return m ? m[1] === '127' : false
}

const withLatest = (n: string) => (n.includes(':') ? n : `${n}:latest`)

/** name 這個模型在不在 names 清單裡（llama3.1 與 llama3.1:latest 視為同一個）。 */
export function modelInList(name: string, names: string[]): boolean {
  const want = withLatest((name || '').trim())
  if (!name) return false
  const set = new Set(names.map(withLatest))
  return set.has(want) || names.includes(name)
}
