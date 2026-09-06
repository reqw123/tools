import { useEffect, useRef, useState } from 'react'
import { useAiSettings, useOllamaModels, useSaveAiSettings, useTestConnection } from '../hooks/useAi'
import type { AiSettings, AiSettingsInput } from '../lib/ai'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  buildStandardUrl,
  isLocalEndpoint,
  modelInList,
  normalizeBaseUrl,
  splitStandardUrl,
} from '../lib/ollamaUrl'

type Provider = 'openai' | 'ollama'
type Where = 'local' | 'lan'
const MODEL_HINT_DEFAULT = '下拉為那台電腦已安裝的模型；也可以直接手動輸入名稱。'

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: settings, isLoading } = useAiSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI 設定"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>AI 設定</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="sub">
            用來跑「批次補說明」的 AI 產生建議。設定跟桌面版（檔案快速搜尋）與便利貼牆共用同一份——
            在這裡改，其他兩邊也生效。API Key 只存在本機（<code>%LOCALAPPDATA%\file_search</code>），
            不會進版控。
          </p>
          {isLoading || !settings ? (
            <p className="fb-empty mono">// 載入中…</p>
          ) : (
            <SettingsForm key="loaded" initial={settings} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsForm({ initial, onClose }: { initial: AiSettings; onClose: () => void }) {
  const save = useSaveAiSettings()
  const test = useTestConnection()
  const models = useOllamaModels()

  const [provider, setProvider] = useState<Provider>(initial.provider ?? 'openai')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState(initial.openai.model || 'gpt-4o-mini')
  const [openaiUrl, setOpenaiUrl] = useState(initial.openai.base_url || 'https://api.openai.com/v1')

  const savedBase = initial.ollama.base_url || DEFAULT_BASE_URL
  const initSplit = splitStandardUrl(savedBase)
  const [where, setWhere] = useState<Where>(
    isLocalEndpoint(savedBase) && initSplit.isStandard ? 'local' : 'lan',
  )
  const [ollamaHost, setOllamaHost] = useState(initSplit.host)
  const [ollamaAdvanced, setOllamaAdvanced] = useState(!initSplit.isStandard)
  const [ollamaFullUrl, setOllamaFullUrl] = useState(savedBase)
  const [ollamaModel, setOllamaModel] = useState(initial.ollama.model || DEFAULT_MODEL)

  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [modelHint, setModelHint] = useState(MODEL_HINT_DEFAULT)

  const collectOllamaBaseUrl = (): string => {
    if (where === 'local') return DEFAULT_BASE_URL
    if (ollamaAdvanced) return normalizeBaseUrl(ollamaFullUrl)
    return buildStandardUrl(ollamaHost)
  }

  const collect = (): AiSettingsInput => ({
    provider,
    openai: {
      ...(openaiKey.trim() ? { api_key: openaiKey.trim() } : {}),
      model: openaiModel.trim(),
      base_url: openaiUrl.trim(),
    },
    ollama: { base_url: collectOllamaBaseUrl(), model: ollamaModel.trim() },
  })

  const loadModels = (silent = false) => {
    if (models.isPending) return
    setModelHint('讀取中…')
    models.mutate(collect(), {
      onSuccess: (r) => {
        if (r.models === null) {
          setModelHint(
            silent
              ? '（讀不到已安裝清單，可按「🔄 讀取清單」重試，或直接手動輸入模型名稱）'
              : `讀取清單失敗：${r.error ?? '連不上那台 Ollama'}`,
          )
          return
        }
        setFetchedModels(r.models)
        const cur = ollamaModel.trim()
        if (r.models.length === 0) {
          setModelHint('那台電腦目前沒有已安裝的模型；請先 `ollama pull <模型>`，或手動輸入名稱。')
        } else if (!cur) {
          setOllamaModel(r.models[0])
          setModelHint(MODEL_HINT_DEFAULT)
        } else if (modelInList(cur, r.models)) {
          setModelHint(MODEL_HINT_DEFAULT)
        } else {
          setModelHint(`目前填的「${cur}」不在已安裝清單裡——可從下拉改選，或之後在該電腦先 pull。`)
        }
      },
      onError: (e: Error) => setModelHint(`讀取清單失敗：${e.message}`),
    })
  }

  const autoFetchedRef = useRef(false)
  useEffect(() => {
    if (provider === 'ollama' && !autoFetchedRef.current) {
      autoFetchedRef.current = true
      loadModels(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  const switchWhere = (w: Where) => {
    setWhere(w)
    if (w === 'local') setOllamaAdvanced(false)
    else if (!ollamaAdvanced && isLocalEndpoint(buildStandardUrl(ollamaHost))) setOllamaHost('')
  }
  const toggleAdvanced = (adv: boolean) => {
    if (adv) {
      if (!ollamaFullUrl.trim()) setOllamaFullUrl(buildStandardUrl(ollamaHost))
    } else {
      setOllamaHost(splitStandardUrl(ollamaFullUrl).host)
    }
    setOllamaAdvanced(adv)
  }

  const r = test.data
  const testMsg = test.error
    ? `❌ ${test.error.message}`
    : r
      ? r.ok
        ? r.warning
          ? `⚠️ ${r.warning}`
          : '✅ 連線成功'
        : `❌ ${r.error}`
      : ''
  const testOk = !!r?.ok && !r?.warning && !test.error

  return (
    <form
      className="ai-form"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(collect(), { onSuccess: onClose })
      }}
    >
      <div className="ai-radios">
        <label className="ai-radio">
          <input
            type="radio"
            name="provider"
            checked={provider === 'openai'}
            onChange={() => setProvider('openai')}
          />
          OpenAI（雲端，需要 API Key）
        </label>
        <label className="ai-radio">
          <input
            type="radio"
            name="provider"
            checked={provider === 'ollama'}
            onChange={() => setProvider('ollama')}
          />
          Ollama（本機或區網電腦，免 Key）
        </label>
      </div>

      {provider === 'openai' ? (
        <>
          <label className="field-block">
            <span>API Key</span>
            <input
              type="password"
              value={openaiKey}
              autoComplete="off"
              placeholder={initial.openai.has_key ? '（已設定，留空表示不變）' : 'sk-…'}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
          </label>
          <label className="field-block">
            <span>模型</span>
            <input value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} />
          </label>
          <label className="field-block">
            <span>Base URL</span>
            <input value={openaiUrl} onChange={(e) => setOpenaiUrl(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="ai-radios">
            <span className="ai-q">Ollama 服務在哪裡？</span>
            <label className="ai-radio">
              <input
                type="radio"
                name="ollama-where"
                checked={where === 'local'}
                onChange={() => switchWhere('local')}
              />
              🖥️ 就在這台電腦（大多數人選這個）
            </label>
            <label className="ai-radio">
              <input
                type="radio"
                name="ollama-where"
                checked={where === 'lan'}
                onChange={() => switchWhere('lan')}
              />
              🌐 區網裡的另一台電腦（進階）
            </label>
          </div>

          {where === 'local' ? (
            <p className="hint">
              位址就是預設的 <code>http://localhost:11434</code>，不用另外設定——這台電腦本身有跑
              Ollama 就能用。
            </p>
          ) : (
            <>
              <label className="field-block">
                <span>那台電腦的位址{ollamaAdvanced ? '' : '（只需改中間的 IP／主機名）'}</span>
                {ollamaAdvanced ? (
                  <input
                    value={ollamaFullUrl}
                    placeholder="http://192.168.1.50:11434"
                    onChange={(e) => setOllamaFullUrl(e.target.value)}
                  />
                ) : (
                  <span className="seg-url">
                    <span className="seg-fix">http://</span>
                    <input
                      className="seg-host"
                      value={ollamaHost}
                      placeholder="192.168.1.50"
                      autoFocus
                      onChange={(e) => setOllamaHost(e.target.value)}
                    />
                    <span className="seg-fix">:11434</span>
                  </span>
                )}
              </label>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={ollamaAdvanced}
                  onChange={(e) => toggleAdvanced(e.target.checked)}
                />
                進階：自訂連接埠 / https（改用完整網址）
              </label>
              <p className="hint">
                提供服務的那台電腦上，Ollama 需以 <code>OLLAMA_HOST=0.0.0.0</code> 啟動、防火牆放行
                11434 埠；這是對方電腦的設定，本程式無法代為調整。指到區網電腦時，內容會透過區域網路傳到那台電腦，但不會上網際網路、也不會計費。
              </p>
            </>
          )}

          <label className="field-block">
            <span>模型</span>
            <span className="model-row">
              <input
                value={ollamaModel}
                list="ollama-models"
                placeholder="llama3.1 / qwen2.5 / llava …"
                onChange={(e) => setOllamaModel(e.target.value)}
              />
              <button
                type="button"
                className="btn sm"
                disabled={models.isPending}
                onClick={() => loadModels(false)}
              >
                {models.isPending ? '讀取中…' : '🔄 讀取清單'}
              </button>
            </span>
            <datalist id="ollama-models">
              {fetchedModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <span className="hint">{modelHint}</span>
          </label>
        </>
      )}

      {save.error && <p className="err">{save.error.message}</p>}
      {!save.error && testMsg && <p className={testOk ? 'ok-msg' : 'err'}>{testMsg}</p>}

      <div className="modal-foot">
        <button
          type="button"
          className="btn"
          disabled={test.isPending}
          onClick={() => test.mutate(collect())}
        >
          {test.isPending ? '測試中…' : '測試連線'}
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="btn primary" disabled={save.isPending}>
          {save.isPending ? '儲存中…' : '儲存'}
        </button>
      </div>
    </form>
  )
}
