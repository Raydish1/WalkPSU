import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { auth0Config } from './auth0'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (see web/.env.example)')
}

let getAuth0IdToken: (() => Promise<string | null>) | null = null

// The Auth0 SDK only exposes tokens through a React hook, so the session layer registers a getter here.
export function setAuth0IdTokenGetter(getter: (() => Promise<string | null>) | null) {
  getAuth0IdToken = getter
}

// With Auth0, Supabase verifies the Auth0 ID token (third-party auth) and supabase.auth is disabled.
// Without it, we use Supabase anonymous sign-ins so RLS still sees an authenticated user.
export const supabase = auth0Config
  ? createClient<Database>(url, anonKey, { accessToken: async () => (getAuth0IdToken ? getAuth0IdToken() : null) })
  : createClient<Database>(url, anonKey)
