import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { host, type PersonRole } from '../lib/api'
import { useAiSettings, useAiTarget, useSaveAiSettings } from '../hooks/useAi'
import type { AiSettingsInput } from '../lib/ai'
import { displayAuthor } from '../lib/identity'
import { stamp } from '../lib/format'

const VISITS_KEY = ['host-visits'] as const
const VISITS_LIMIT = 200

const HOST_STATE_KEY = ['host-state'] as const
const PAGE_TITLE = '索引牆-開發者設定'

/**
 * `/host`——host 專用管理頁，搬自 notes-web/src/components/HostPanel.tsx，
 * 拿掉便利貼專屬的登入畫面 3D Logo、每人 Discord webhook、到期通知清單。
 * **只有主機本機（loopback）打得到背後的 `/api/host/*`**——遠端開這個
 * 網址會看到「只能在本機開啟」，見 server/host-routes.ts。
 *
 * 目前管六件事：
 *   1. 開放模式——免共用密碼，但仍要求名字＋PIN。純記憶體，預設開、重開
 *      server 會重置回開。
 *   2. AI 開關——遠端能不能用 AI（批次補說明的建議），即時切換、重開
 *      server 回到環境變數預設值。
 *   3. AI provider——批次補說明要打 OpenAI 還是本機 Ollama。
 *   4. 身分保護——列出被 PIN 保護的名字，忘記 PIN 就在這裡「解除保護」；
 *      每個人自己的 Discord webhook（2026-09 補回來，一開始搬過來時拿掉，
 *      後來加了遠端上傳才有對稱的通知情境——有人上傳新檔案時廣播給每個
 *      設過 webhook 的人，Node-RED 打 `GET /api/host/upload-notifications`
 *      取得清單，見 server/host-routes.ts 的說明）。
 *   5. 訪客紀錄——誰、什麼時候造訪過，持久化，5 秒輪詢更新一次。
 *   6. 備份／匯出（2026-09 加）——把整個共用資料夾打包成 zip 下載，見
 *      server/backup.ts。純 `<a href>` 下載連結，不是 fetch，讓瀏覽器自己
 *      處理下載進度／存檔對話框。
 */
export function HostPanel() {
  useEffect(() => {
    const prev = document.title
    document.title = PAGE_TITLE
    return () => {
      document.title = prev
    }
  }, [])

  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: HOST_STATE_KEY,
    queryFn: host.getState,
    retry: false,
  })
  const { data: aiTarget } = useAiTarget()
  const { data: aiSettings } = useAiSettings()
  const saveAiSettings = useSaveAiSettings()
  const { data: visits } = useQuery({
    queryKey: VISITS_KEY,
    queryFn: () => host.getVisits(VISITS_LIMIT),
    refetchInterval: 5_000,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null)

  const toggleOpenAccess = async () => {
    if (!data) return
    setBusy(true)
    setErr('')
    try {
      await host.setOpenAccess(!data.openAccess)
      await qc.invalidateQueries({ queryKey: HOST_STATE_KEY })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleAi = async () => {
    if (!data) return
    setBusy(true)
    setErr('')
    try {
      await host.setAiEnabled(!data.aiEnabled)
      await qc.invalidateQueries({ queryKey: HOST_STATE_KEY })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // 只換 provider 欄位——model／base_url／api_key 原封不動照抄現有設定。
  const switchProvider = async (provider: 'openai' | 'ollama') => {
    if (!aiSettings || aiSettings.provider === provider) return
    setBusy(true)
    setErr('')
    const input: AiSettingsInput = {
      provider,
      openai: { model: aiSettings.openai.model, base_url: aiSettings.openai.base_url },
      ollama: { model: aiSettings.ollama.model, base_url: aiSettings.ollama.base_url },
    }
    try {
      await saveAiSettings.mutateAsync(input)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const setRole = async (name: string, role: PersonRole) => {
    setBusy(true)
    setErr('')
    try {
      await host.setPersonRole(name, role)
      await qc.invalidateQueries({ queryKey: HOST_STATE_KEY })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveWebhook = async (name: string, webhook: string) => {
    setBusy(true)
    setErr('')
    try {
      await host.setPersonWebhook(name, webhook)
      await qc.invalidateQueries({ queryKey: HOST_STATE_KEY })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const release = async (name: string) => {
    setBusy(true)
    setErr('')
    try {
      await host.releasePerson(name)
      await qc.invalidateQueries({ queryKey: HOST_STATE_KEY })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setConfirmRelease(null)
    }
  }

  if (isLoading) {
    return (
      <div className="host-panel">
        <p className="dim mono">// 讀取中…</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="host-panel">
        <p className="eyebrow mono">Index Wall · Host</p>
        <h1 className="brush">後台</h1>
        <p className="err">{error instanceof Error ? error.message : '讀取失敗'}</p>
        <p className="dim">
          這個頁面只有跑 server 的這台電腦、用本機網址（例如
          http://localhost:{location.port || '8788'}/host）開才看得到內容——遠端連線一律擋下來，
          這是刻意的：這裡能做的事（關掉密碼牆、解除別人的身分保護）不該透過
          共用密碼就開放。
        </p>
      </div>
    )
  }

  return (
    <div className="host-panel">
      <p className="eyebrow mono">Index Wall · Host</p>
      <h1 className="brush">後台管理</h1>
      <p className="dim">只有這台電腦看得到這一頁，共用牆的人看不到、也連不到背後的 API。</p>

      <section className="host-section form">
        <h2>開放模式</h2>
        <p className="hint">
          開著的時候，不用輸入共用密碼就能進牆——但仍要輸入名字＋PIN 才能進來
          （身分驗證、防冒充沒有一起省掉，只是省了共用密碼那一關）。<b>預設開</b>，
          重開一次 server 會重置回開；想維持要共用密碼，關掉即可。
        </p>
        <label className="check-inline">
          <input type="checkbox" checked={data.openAccess} disabled={busy} onChange={toggleOpenAccess} />
          {data.openAccess ? '目前開放中——任何人都不需要密碼' : '目前關閉（正常密碼牆）'}
        </label>
      </section>

      <section className="host-section form">
        <h2>AI 批次補說明</h2>
        <p className="hint">
          共用牆的人用「批次補說明」要 AI 建議時，是打去<b>這台電腦設定的 AI
          provider</b>——不是固定用本機模型。目前設定：
          {aiTarget ? (
            <b>
              {' '}
              {aiTarget.configured
                ? `${aiTarget.label}（${aiTarget.provider === 'openai' ? '雲端，會計費' : '本機'}）`
                : '尚未設定（' + aiTarget.reason + '）'}
            </b>
          ) : (
            ' 讀取中…'
          )}
          。
        </p>
        <label className="check-inline">
          <input type="checkbox" checked={data.aiEnabled} disabled={busy} onChange={toggleAi} />
          {data.aiEnabled ? '目前開放——遠端可以用 AI 補說明的建議' : '目前停用——遠端看不到 AI 建議功能'}
        </label>

        <p className="hint">
          <b>AI 要打去哪裡</b>（跟上面的開關是兩件事——這個決定「打去哪」，
          上面決定「准不准打」）。只換這一項，API Key／模型／連線位址不動，
          要調那些請到牆面的「AI 設定」（僅本機能改）。
        </p>
        {aiSettings ? (
          <div className="radio-row">
            <label className="radio">
              <input
                type="radio"
                name="ai-provider"
                checked={aiSettings.provider === 'openai'}
                disabled={busy}
                onChange={() => switchProvider('openai')}
              />
              OpenAI（雲端，會計費）
            </label>
            <label className="radio">
              <input
                type="radio"
                name="ai-provider"
                checked={aiSettings.provider === 'ollama'}
                disabled={busy}
                onChange={() => switchProvider('ollama')}
              />
              Ollama（本機／區網，不計費）
            </label>
          </div>
        ) : (
          <p className="dim mono">// 讀取中…</p>
        )}
      </section>

      <section className="host-section form">
        <h2>身分保護</h2>
        <p className="hint">
          這些名字被設過 PIN、受保護中。有人忘記 PIN 就在這裡「解除保護」——名字本身
          還在，只是變回沒設過 PIN 的狀態，下次任何人都能重新登入這個名字、順便設新 PIN。
          角色下拉可以把某個名字設成「唯讀」——設成唯讀的人登入後只能看不能
          新增／編輯／移除。沒特別設過的人（含匿名）一律是「可編輯」，維持現況。
          <b>Discord webhook</b> 是這個人自己的通知頻道——使用者私下把 webhook
          網址給你，貼在這裡，有人上傳新檔案時 Node-RED 會推播到他自己的
          Discord（這裡沒有開放讓使用者自己填）。輸入框失焦時自動存檔，
          留空＝清除。
        </p>
        {data.people.length === 0 ? (
          <p className="dim">目前沒有任何名字設過 PIN。</p>
        ) : (
          <ul className="host-people">
            {data.people.map((p) => (
              <li key={p.name}>
                <div className="host-people-row">
                  <span className="host-people-name">{p.name}</span>
                  <span className="host-people-actions">
                    <select
                      className="host-people-role"
                      value={p.role}
                      disabled={busy}
                      onChange={(e) => setRole(p.name, e.target.value as PersonRole)}
                    >
                      <option value="editor">可編輯</option>
                      <option value="viewer">唯讀</option>
                    </select>
                    {confirmRelease === p.name ? (
                      <>
                        <button className="btn danger sm" disabled={busy} onClick={() => release(p.name)}>
                          確定解除
                        </button>
                        <button className="btn ghost sm" disabled={busy} onClick={() => setConfirmRelease(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() => setConfirmRelease(p.name)}
                      >
                        解除保護
                      </button>
                    )}
                  </span>
                </div>
                <label className="host-people-webhook">
                  Discord webhook
                  <input
                    type="text"
                    defaultValue={p.discordWebhook}
                    disabled={busy}
                    placeholder="https://discord.com/api/webhooks/…（留空＝不通知）"
                    onBlur={(e) => {
                      if (e.target.value.trim() !== p.discordWebhook) saveWebhook(p.name, e.target.value)
                    }}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="host-section form">
        <h2>訪客紀錄</h2>
        <p className="hint">
          誰、什麼時候連上這面共用索引牆——只記連線那一刻（換頁／重整不算新的一筆），
          持久存檔，重開 server 不會不見。最新的在最上面，最多留 {VISITS_LIMIT} 筆。
        </p>
        {!visits ? (
          <p className="dim mono">// 讀取中…</p>
        ) : visits.length === 0 ? (
          <p className="dim">還沒有任何造訪紀錄。</p>
        ) : (
          <pre className="host-visits-log mono">
            {visits.map((v) => `${stamp(v.at)}　${displayAuthor(v.author)}`).join('\n')}
          </pre>
        )}
      </section>

      <section className="host-section form">
        <h2>備份／匯出</h2>
        <p className="hint">
          把這面共用索引牆的資料夾（`.md` 索引集、上傳的檔案、身分／訪客紀錄）
          整個打包成一個 zip 下載——`public-index-data/`（或多人牆閘道模式下的
          `public-share-data/`）完全不在版控裡，資料損毀時這是唯一的救援手段。
        </p>
        <a className="btn" href="/api/host/export">
          匯出備份（.zip）
        </a>
      </section>

      {err && <p className="err">{err}</p>}
    </div>
  )
}
