const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID

// Null means Auth0 isn't set up yet and the app uses the fallback name + team login.
export const auth0Config = domain && clientId
  ? { domain, clientId, audience: import.meta.env.VITE_AUTH0_AUDIENCE || undefined }
  : null

export function safeReturnTo(value: string) {
  if (!value || value === '/' || value === '') return '/'
  return value.startsWith('/') ? value : `/${value}`
}
