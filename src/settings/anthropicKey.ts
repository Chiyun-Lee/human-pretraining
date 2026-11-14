import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface KeyStatus {
  /** Last four characters of the stored key, or null when none is stored. */
  hint: string | null
}

export async function fetchKeyStatus(): Promise<KeyStatus> {
  const { data, error } = await supabase.from('user_settings').select('anthropic_key_hint').maybeSingle()
  if (error) throw error
  return { hint: data?.anthropic_key_hint ?? null }
}

const MESSAGES: Record<string, string> = {
  invalid_key: 'Anthropic did not accept that key. Check that you copied all of it.',
  anthropic_unreachable: 'Could not reach Anthropic to check the key. Try again in a moment.',
}

async function call(method: 'POST' | 'DELETE', body?: { key: string }) {
  const { error } = await supabase.functions.invoke('anthropic-key', { method, body })
  if (!error) return
  if (error instanceof FunctionsHttpError) {
    const code = ((await error.context.json().catch(() => null)) as { error?: string } | null)?.error
    throw new Error(MESSAGES[code ?? ''] ?? 'Something went wrong saving the key.')
  }
  throw new Error('Could not reach the server. Check your connection.')
}

export const saveKey = (key: string) => call('POST', { key })
export const removeKey = () => call('DELETE')
