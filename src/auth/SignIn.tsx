import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function SignIn() {
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Return to wherever the app is hosted, including a sub-path.
      options: { redirectTo: location.origin + location.pathname },
    })
    if (error) setError(error.message)
  }

  return (
    <div className="card">
      <h1>Human Pretraining</h1>
      <p>Read papers as summaries you can flip back to the original. Your library follows you across devices.</p>
      <button type="button" className="button primary" onClick={() => void signIn()}>
        Continue with Google
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
