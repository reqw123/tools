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
/** 分頁標題——固定路徑頁面各有自己的標題，不共用主牆那個「便利貼牆」。 */
const PAGE_TITLE = '便利貼牆-開發者設定'

/**
 * `/host`——host 專用管理頁（固定路徑，跟 `/card` 同一套機制，見 main.tsx）。
 * **只有主機本機（loopback）打得到背後的 `/api/host/*`**——遠端開這個網址
 * 會看到「只能在本機開啟」，不會看到任何管理內容，見 server/host-routes.ts。
 *
 * 目前管六件事：
 *   1. 開放模式——免共用密碼，但仍要求名字＋PIN（不是整關直接放行，見
 *      share.ts 的 openAccess／shareAuthHook）。純記憶體，**預設開**、重開
 *      server 會重置回開，想維持要密碼就自己在這裡關掉。
 *   2. AI 開關——遠端能不能用 AI 搜尋／生成／語意（share.ts 的
 *      shareAiEnabled，即時切換、重開 server 回到環境變數預設值）。停用時
 *      牆上工具列會明白顯示「AI 已停用」，不是單純把按鈕藏起來。
 *   3. AI provider——搜尋要打 OpenAI 還是本機 Ollama，直接在這裡切（只換
 *      provider 欄位，API Key／模型／連線位址不動，跟全域設定同一份檔案）。
 *   4. 身分保護——列出被 PIN 保護的名字，忘記 PIN 就在這裡「解除保護」，
 *      不用再手動開 `.sticky_wall_people.json` 改。
 *   5. 訪客紀錄——誰、什麼時候造訪過（見 server/visits.ts，持久化，跟前面
 *      幾項不同），文字視窗形式，5 秒輪詢更新一次。同一份資料也給 Node-RED
 *      輪詢轉發 Discord（見 Downloads 那份「多人牆flow.json」新增的分頁）。
 *   6. 登入畫面 3D Logo——host 個人品牌（見 LoginLogo3D.tsx），純記憶體、
 *      **預設關**、重開 server 重置回關（素材約 5.6MB，不想預設讓每個訪客都
 *      下載）。關掉時前端完全不 mount 那個元件，不是載入了才藏起來。
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
  // AI 目前實際去向（哪個 provider／模型）——跟開關無關，單純唯讀顯示，讓
  // host 知道「開了 AI」實際上是打去哪裡（這台的 .ai_settings.json 設定）。
  const { data: aiTarget } = useAiTarget()
  const { data: aiSettings } = useAiSettings()
  const saveAiSettings = useSaveAiSettings()
  // 訪客紀錄——持久化，跟上面幾項純記憶體／即時開關不同，這裡用輪詢（不是
  // SSE）：/host 是很少開著的管理頁，沒必要為了它多接一條全域 SSE topic。
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

  const toggleLoginLogo3d = async () => {
    if (!data) return
    setBusy(true)
    setErr('')
    try {
      await host.setLoginLogo3d(!data.loginLogo3d)
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

  // 只換 provider 欄位——model／base_url／api_key 原封不動照抄現有設定，
  // 沒帶到的（如 api_key）server 端本來就會沿用舊值（見 ai_bridge.py 的
  // cmd_settings_set），不會被清掉。要調模型／API Key／連線位址還是得去
  // 牆面的「⚙️ 全域設定 → AI」，這裡只做「換條路走」這一件事。
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
        <p className="eyebrow mono">Sticky Wall · Host</p>
        <h1 className="brush">後台</h1>
        <p className="err">{error instanceof Error ? error.message : '讀取失敗'}</p>
        <p className="dim">
          這個頁面只有跑 server 的這台電腦、用本機網址（例如
          http://localhost:{location.port || '8787'}/host）開才看得到內容——遠端連線一律擋下來，
          這是刻意的：這裡能做的事（關掉密碼牆、解除別人的身分保護）不該透過
          共用密碼就開放。
        </p>
      </div>
    )
  }

  return (
    <div className="host-panel">
      <p className="eyebrow mono">Sticky Wall · Host</p>
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
        <h2>AI 搜尋／生成</h2>
        <p className="hint">
          共用牆的人在輸入框問問題（AI 搜尋）、AI 生成便利貼，都是打去<b>這台電腦設定的
          AI provider</b>——不是固定用本機模型。目前設定：
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
          。這個開關連語意搜尋（🌱，固定用本機 Ollama、不計費）也一起關——牆上是
          「要不要看得到 AI 這排功能」的單一開關，不細分哪個功能花錢。
        </p>
        <label className="check-inline">
          <input type="checkbox" checked={data.aiEnabled} disabled={busy} onChange={toggleAi} />
          {data.aiEnabled ? '目前開放——遠端可以用 AI 搜尋／生成／語意搜尋' : '目前停用——遠端看不到 AI 按鈕，牆上會顯示「AI 已停用」'}
        </label>

        <p className="hint">
          <b>AI 搜尋要打去哪裡</b>（跟上面的開關是兩件事——這個決定「打去哪」，
          上面決定「准不准打」）。只換這一項，API Key／模型／連線位址不動，
          要調那些請到牆面的「⚙️ 全域設定 → AI」（僅本機能改）。
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
          旁邊的角色下拉可以把某個名字設成「唯讀」——設成唯讀的人登入後只能看不能
          新增／編輯／刪除／反應，權限即時生效不用重新登入。沒特別設過的人（含匿名）
          一律是「可編輯」，維持現況。
        </p>
        {data.people.length === 0 ? (
          <p className="dim">目前沒有任何名字設過 PIN。</p>
        ) : (
          <ul className="host-people">
            {data.people.map((p) => (
              <li key={p.name}>
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="host-section form">
        <h2>訪客紀錄</h2>
        <p className="hint">
          誰、什麼時候連上這面共用牆——只記連線那一刻（換頁／重整不算新的一筆），
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
        <h2>登入畫面 3D Logo</h2>
        <p className="hint">
          在密碼牆畫面放一個會緩慢自轉的 3D logo（目前放的是元培大學的模型）——
          純裝飾，跟登入邏輯無關。素材放在這台電腦的 <code>public/branding/</code>
          （不進版控），已經離線壓縮＋減面過（原始檔案 ~30MB，現在約 5.6MB），
          單次下載約 5.6MB，<b>預設關</b>：關著的時候前端完全不會載入這個模型、
          不佔頻寬也不佔 GPU 資源；開著才會在每個人開密碼牆時下載一次（瀏覽器
          快取後同一台裝置不會重複下載）。重開 server 重置回關。
        </p>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={data.loginLogo3d}
            disabled={busy}
            onChange={toggleLoginLogo3d}
          />
          {data.loginLogo3d ? '目前開啟——密碼牆會載入 3D logo' : '目前關閉（預設）'}
        </label>
      </section>

      {err && <p className="err">{err}</p>}
    </div>
  )
}
