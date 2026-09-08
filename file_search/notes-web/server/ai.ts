import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { projectRoot } from './store'

const BRIDGE = join(projectRoot, 'server', 'ai_bridge.py')
const PY = process.env.PYTHON ?? 'python'

/** bridge 回傳 `{error: ...}` 或非 0 結束碼時丟這個。code=1 代表「AI 呼叫本身
 *  失敗」（金鑰錯、連不上 Ollama…），對應到 HTTP 502；其餘當 500。 */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

/**
 * 用子行程呼叫 `server/ai_bridge.py`——不重寫任何 AI 邏輯，直接跑 file_search_app
 * 既有的 StickyNoteService / AIDescriptionService。
 * command 從 argv，payload 從 stdin(JSON)，結果從 stdout(JSON)。
 */
export function runBridge<T>(
  command: string,
  payload?: unknown,
  extraArgs: string[] = [],
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, [BRIDGE, command, ...extraArgs], { windowsHide: true })
    let out = ''
    let err = ''
    let aborted = false
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (d: string) => (out += d))
    child.stderr.on('data', (d: string) => (err += d))
    child.on('error', (e) =>
      reject(new BridgeError(`無法啟動 Python（${PY}）：${e.message}。可用環境變數 PYTHON 指定路徑。`, -1)),
    )

    // 呼叫端中斷（前端關掉連線／按「中斷」）→ 殺掉子行程，別讓 Python 繼續
    // 跑那個十幾秒的 AI 呼叫、白白佔著 Ollama。
    const onAbort = () => {
      aborted = true
      child.kill()
      reject(new BridgeError('已中斷', -2))
    }
    if (opts.signal) {
      if (opts.signal.aborted) return onAbort()
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (aborted) return
      let parsed: unknown = null
      try {
        parsed = JSON.parse(out.trim())
      } catch {
        /* 非 JSON 輸出 */
      }
      // 成功／失敗只看結束碼——結束碼 0 的結果本身可能就有 error 欄位
      // （例如 test 指令的 {ok:false, error:"連不上"}），那不是 bridge 級錯誤。
      if (code === 0 && parsed !== null) {
        return resolve(parsed as T)
      }
      const msg =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : err.trim() || `AI 橋接結束碼 ${code}`
      reject(new BridgeError(msg, code ?? -1))
    })
    if (payload !== undefined) child.stdin.write(JSON.stringify(payload ?? null))
    child.stdin.end()
  })
}
