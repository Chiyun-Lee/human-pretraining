import { useCallback, useEffect, useState } from 'react'
import { SignIn } from './auth/SignIn'
import { useSession } from './auth/useSession'
import { supabase } from './lib/supabase'
import { Library } from './library/Library'
import { downloadPaper, type Paper } from './library/papers'
import { Quiz } from './learning/Quiz'
import { NotePopover } from './reader/NotePopover'
import { Reader } from './reader/Reader'
import { fetchKeyStatus, type KeyStatus } from './settings/anthropicKey'
import { KeySetup } from './settings/KeySetup'

const SKIPPED_KEY_SETUP = 'key-setup-skipped'

// In development, ?file=samples/paper.pdf opens a local PDF without signing in;
// adding &demo shows sample summaries on it.
const devParams = import.meta.env.DEV ? new URLSearchParams(location.search) : null
const devFile = devParams?.get('file')
const demo = devParams?.has('demo') ? await import('./dev/fixture') : null

export function App() {
  if (demo && devParams?.has('quiz')) {
    const thread = [
      { role: 'user' as const, text: 'Explain this simply' },
      { role: 'claude' as const, text: 'Each word looks at every other word at once and decides which ones matter for it, instead of reading the sentence one word at a time.' },
    ]
    return (
      <>
        <Quiz title="Quiz" cards={demo.demoCards} inline={devParams.has('inline')} predict={devParams.has('inline')} onClose={() => {}} />
        {devParams.has('popover') && (
          <NotePopover anchor={{ x: 500, y: 300 }} quote="self-attention relates all positions" note="" thread={thread} focus="ask" asking={false} onAsk={() => {}} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />
        )}
      </>
    )
  }
  if (devFile) {
    return (
      <Reader
        source={new URL(devFile, document.baseURI).href}
        name={devFile.split('/').pop()!}
        demo={demo ? { regions: demo.demoRegions, slide: demo.demoSlide } : undefined}
      />
    )
  }
  return <SignedInApp />
}

function SignedInApp() {
  const session = useSession()
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [keyScreen, setKeyScreen] = useState(false)
  const [skipped, setSkipped] = useState(() => localStorage.getItem(SKIPPED_KEY_SETUP) === '1')
  const [reading, setReading] = useState<{ paper: Paper; data: ArrayBuffer } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const userId = session?.user.id

  const loadKeyStatus = useCallback(async () => {
    try {
      setKeyStatus(await fetchKeyStatus())
    } catch {
      setError('Could not load your account. Check your connection and reload.')
    }
  }, [])

  useEffect(() => {
    if (userId) void loadKeyStatus()
    else {
      setKeyStatus(null)
      setReading(null)
    }
  }, [userId, loadKeyStatus])

  if (session === undefined) return <p className="notice">Loading…</p>
  if (session === null) return <SignIn />
  if (error) return <p className="notice">{error}</p>
  if (keyStatus === null) return <p className="notice">Loading…</p>

  const firstTime = keyStatus.hint === null && !skipped
  if (firstTime || keyScreen) {
    return (
      <KeySetup
        status={keyStatus}
        firstTime={firstTime}
        onChanged={() => {
          setKeyScreen(false)
          void loadKeyStatus()
        }}
        onClose={() => {
          localStorage.setItem(SKIPPED_KEY_SETUP, '1')
          setSkipped(true)
          setKeyScreen(false)
        }}
      />
    )
  }

  if (reading) {
    return (
      <Reader
        source={reading.data}
        name={reading.paper.title}
        paperId={reading.paper.id}
        hasKey={keyStatus.hint !== null}
        onClose={() => setReading(null)}
      />
    )
  }

  const open = async (paper: Paper) => {
    try {
      setReading({ paper, data: await downloadPaper(paper) })
    } catch {
      alert('That paper could not be downloaded. Check your connection.')
    }
  }

  return (
    <>
      <header className="toolbar">
        <span className="title">Library</span>
        <button type="button" className="button" onClick={() => setKeyScreen(true)}>
          {keyStatus.hint ? 'API key' : 'Add API key'}
        </button>
        <button type="button" className="button" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <Library userId={session.user.id} onOpen={(paper) => void open(paper)} />
    </>
  )
}
