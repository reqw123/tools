import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { session } from '../lib/api'
import { readAuthorName, saveAuthorName } from '../lib/identity'

// 跟 server/people.ts 的 MIN_PIN 同一個數字。
const PIN_MIN_LEN = 4

/**
 * 區網共用模式的密碼牆。搬自 notes-web/src/components/PasswordGate.tsx，
 * 邏輯完全相同（拿掉登入畫面 3D Logo，索引牆沒有這個功能）：
 *
 * 伺服器要密碼、這個瀏覽器還沒登入時，App 只 render 這個。登入成功 →
 * cookie 由 server 種下 → 清掉所有 query 讓牆重抓。`share_session` 是
 * session cookie（沒有 maxAge）——瀏覽器關掉就失效，每次重新連線都要
 * 再看到這個畫面。
 *
 * 順便問「你的名字」＋PIN——純顯示用，不是帳號。一般模式下可以留空
 * （匿名）；一旦填了名字就一定要順便設 PIN，設定後這組名字＋PIN 就固定
 * 了，牆上沒有「改名字」「換 PIN」的功能——想換要請牆主在 `/host` 解除
 * 保護。開放模式（`openAccess`）不顯示共用密碼欄位，但名字＋PIN 改成
 * 必填。
 */
export function PasswordGate({
  openAccess,
  onPass,
}: {
  openAccess: boolean
  onPass: () => void
}) {
  const qc = useQueryClient()
  const [pw, setPw] = useState('')
  const [name, setName] = useState(readAuthorName)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const nameMissing = openAccess && name.trim().length === 0
  const nameNeedsPin = name.trim().length > 0 && pin.trim().length === 0
  const pinTooShort = name.trim().length > 0 && pin.trim().length > 0 && pin.trim().length < PIN_MIN_LEN
  const canSubmit = !busy && !nameMissing && !nameNeedsPin && !pinTooShort && (openAccess || !!pw)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr('')
    try {
      await session.login(openAccess ? '' : pw, name, pin)
      saveAuthorName(name)
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
        <h1 className="brush">索引牆</h1>
        <p className="dim">
          {openAccess
            ? '這面牆目前開放模式，不需要密碼——但要輸入名字＋PIN 才能進來，用來認人、避免有人冒充別人。'
            : '這面牆需要密碼才能進入。跟牆主人拿。'}
        </p>
        {!openAccess && (
          <input
            type="password"
            autoFocus
            placeholder="共用密碼"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={busy}
          />
        )}
        <input
          type="text"
          autoFocus={openAccess}
          placeholder={
            openAccess
              ? '你的名字（必填；填了就要設 PIN，之後不能再改）'
              : '你的名字（可留空＝匿名；填了就要設 PIN，之後不能再改）'
          }
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <input
          type="password"
          inputMode="numeric"
          placeholder={`PIN（至少 ${PIN_MIN_LEN} 碼；填了名字就一定要設，設定後固定不能改）`}
          maxLength={20}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={busy}
        />
        {name.trim().length > 0 && (
          <p className="dim pw-hint pw-hint-warn">
            ⚠️ 這組名字＋PIN 一旦設定就固定了，牆上沒有「改名字」「換 PIN」的功能——
            <b>PIN 忘記的話你自己救不回這個名字</b>，只有牆主能在 /host 後台解除保護，
            在那之前這個名字你進不來，請務必記住。
          </p>
        )}
        {nameMissing ? (
          <p className="dim pw-hint">開放模式仍要輸入名字＋PIN 才能進——用來認人、避免有人冒用別人的名字。</p>
        ) : nameNeedsPin ? (
          <p className="dim pw-hint">填了名字要順便設 PIN 才能進。</p>
        ) : (
          pinTooShort && <p className="dim pw-hint">PIN 太短——至少要 {PIN_MIN_LEN} 碼。</p>
        )}
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit" disabled={!canSubmit}>
          {busy ? '進入中…' : '進入'}
        </button>
      </form>
    </div>
  )
}
