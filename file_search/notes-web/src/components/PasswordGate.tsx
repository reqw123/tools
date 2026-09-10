import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { session } from '../lib/api'

/**
 * 區網共用模式的密碼牆。伺服器要密碼、這個瀏覽器還沒登入時，App 只 render 這個。
 * 登入成功 → cookie 由 server 種下 → 清掉所有 query 讓牆重抓。
 */
export function PasswordGate({ onPass }: { onPass: () => void }) {
  const qc = useQueryClient()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    setErr('')
    try {
      await session.login(pw)
      await qc.invalidateQueries()
      onPass()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '登入失敗')
      setBusy(false)
    }
  }

  return (
    <div className="pw-gate">
      <form className="pw-card" onSubmit={submit}>
        <h1 className="brush">便利貼牆</h1>
        <p className="dim">這面牆需要密碼才能進入。跟牆主人拿。</p>
        <input
          type="password"
          autoFocus
          placeholder="共用密碼"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          disabled={busy}
        />
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit" disabled={!pw || busy}>
          {busy ? '進入中…' : '進入'}
        </button>
      </form>
    </div>
  )
}
