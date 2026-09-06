import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useAiSettings,
  useOllamaModels,
  useSaveAiSettings,
  useTestConnection,
} from '../hooks/useAi'
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet plain"
        role="dialog"
        aria-modal="true"
        aria-label="AI 設定"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>AI 設定</h2>
        <p className="dim">
          用來跑便利貼的「AI 搜尋」。設定跟桌面版（檔案快速搜尋）共用同一份——在這裡改，桌面版也會生效。
          API Key 只存在本機（<code>%LOCALAPPDATA%\file_search</code>），不會進版控、不會跟便利貼一起同步。
        </p>
        {isLoading || !settings ? (
          <p className="dim mono">載入中…</p>
        ) : (
          <SettingsForm key="loaded" initial={settings} onClose={onClose} />
        )}
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

  // ── Ollama：本機 / 區網另一台 的雙選 + 分段位址 + 進階完整網址 ──
  const savedBase = initial.ollama.base_url || DEFAULT_BASE_URL
  const initSplit = useMemo(() => splitStandardUrl(savedBase), [savedBase])
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
    if (where === 'local') return DEFAULT_BASE_URL // 「就在這台電腦」一律用預設，不管 host 欄殘留什麼
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
          setModelHint('那台電腦目前沒有已安裝的模型；請先在該電腦 `ollama pull <模型>`，或手動輸入名稱。')
        } else if (!cur) {
          setOllamaModel(r.models[0])
          setModelHint(MODEL_HINT_DEFAULT)
        } else if (modelInList(cur, r.models)) {
          setModelHint(MODEL_HINT_DEFAULT)
        } else {
          setModelHint(
            `目前填的「${cur}」不在那台電腦的已安裝清單裡——可從下拉改選，或確認之後要在該電腦先 \`ollama pull\` 再用。`,
          )
        }
      },
      onError: (e: Error) => setModelHint(`讀取清單失敗：${e.message}`),
    })
  }

  // 開視窗時 provider 已是 Ollama，或中途切到 Ollama → 自動抓一次（安靜，連不上不吵）。
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
    if (w === 'local') {
      setOllamaAdvanced(false)
    } else if (!ollamaAdvanced && isLocalEndpoint(buildStandardUrl(ollamaHost))) {
      // 「另一台電腦」卻指著自己 → 清掉 loopback host，讓使用者直接填對方 IP
      setOllamaHost('')
    }
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
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(collect(), { onSuccess: onClose })
      }}
    >
      <div className="radio-row">
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={provider === 'openai'}
            onChange={() => setProvider('openai')}
          />
          OpenAI（雲端，需要 API Key）
        </label>
        <label className="radio">
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
          <label>
            API Key
            <input
              type="password"
              value={openaiKey}
              autoComplete="off"
              placeholder={initial.openai.has_key ? '（已設定，留空表示不變）' : 'sk-…'}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
          </label>
          <label>
            模型
            <input value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} />
          </label>
          <label>
            Base URL
            <input value={openaiUrl} onChange={(e) => setOpenaiUrl(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="radio-row">
            <span className="ai-q">Ollama 服務在哪裡？</span>
            <label className="radio">
              <input
                type="radio"
                name="ollama-where"
                checked={where === 'local'}
                onChange={() => switchWhere('local')}
              />
              🖥️ 就在這台電腦（大多數人選這個）
            </label>
            <label className="radio">
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
              <label>
                那台電腦的位址{ollamaAdvanced ? '' : '（只需改中間的 IP／主機名）'}
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
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={ollamaAdvanced}
                  onChange={(e) => toggleAdvanced(e.target.checked)}
                />
                進階：自訂連接埠 / https（改用完整網址）
              </label>
              <p className="hint">
                提供服務的那台電腦上，Ollama 需以 <code>OLLAMA_HOST=0.0.0.0</code> 啟動（預設只收本機連線）、
                防火牆也要放行 11434 埠；這是對方電腦的設定，本程式無法代為調整。指到區網電腦時，內容會透過區域網路傳到那台電腦，但不會上網際網路、也不會計費。
              </p>
            </>
          )}

          <label>
            模型
            <span className="model-row">
              <input
                value={ollamaModel}
                list="ollama-models"
                placeholder="llama3.1 / qwen2.5 / llava …"
                onChange={(e) => setOllamaModel(e.target.value)}
              />
              <button
                type="button"
                className="btn ghost sm"
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

      {save.error && <span className="err">{save.error.message}</span>}
      {!save.error && testMsg && <span className={testOk ? 'ok-msg' : 'err'}>{testMsg}</span>}

      <div className="sheet-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={test.isPending}
          onClick={() => test.mutate(collect())}
        >
          {test.isPending ? '測試中…' : '測試連線'}
        </button>
        <button type="submit" className="btn" disabled={save.isPending}>
          {save.isPending ? '儲存中…' : '儲存'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          取消
        </button>
      </div>
    </form>
  )
}
