import { useState, type FormEvent } from 'react'
import { removeKey, saveKey, type KeyStatus } from './anthropicKey'

interface Props {
  status: KeyStatus
  /** Called after the key was saved or removed. */
  onChanged: () => void
  /** Leave without saving (labelled "Skip for now" during first-time setup). */
  onClose: () => void
  firstTime: boolean
}

export function KeySetup({ status, onChanged, onClose, firstTime }: Props) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => saveKey(key.trim()))
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>{firstTime ? 'Add your Anthropic API key' : 'Anthropic API key'}</h1>
      <p>
        Summaries and lessons are written by Claude using your own API key. Create one at{' '}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
          platform.claude.com
        </a>
        . It is stored encrypted, used only on the server, and never shown again.
      </p>
      {status.hint && <p>Current key ends in <code>{status.hint}</code>.</p>}
      <input
        type="password"
        className="input"
        placeholder="sk-ant-…"
        autoComplete="off"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="button primary" disabled={busy || key.trim() === ''}>
          {busy ? 'Checking…' : status.hint ? 'Replace key' : 'Save key'}
        </button>
        {status.hint && (
          <button type="button" className="button" disabled={busy} onClick={() => void run(removeKey)}>
            Remove key
          </button>
        )}
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          {firstTime ? 'Skip for now' : 'Close'}
        </button>
      </div>
    </form>
  )
}
