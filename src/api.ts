export type Profile = {
  subject: string
  username: string | null
  email: string | null
  roles: string[]
  scopes: string[]
}

type Csrf = { token: string; headerName: string; parameterName: string }

async function loadCsrf(signal?: AbortSignal | null): Promise<Csrf> {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store', signal })
  if (!response.ok) throw new Error('Не удалось получить CSRF-защиту от Kotlin BFF.')
  return response.json() as Promise<Csrf>
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith('/api/')) throw new Error('Ожидался маршрут Kotlin BFF.')
  const headers = new Headers(init.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes((init.method || 'GET').toUpperCase())) {
    const csrf = await loadCsrf(init.signal)
    headers.set(csrf.headerName, csrf.token)
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (response.status === 401) window.dispatchEvent(new Event('bff-session-expired'))
  return response
}

export async function loadProfile(): Promise<Profile | null> {
  const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Kotlin BFF недоступен: HTTP ' + response.status)
  return response.json() as Promise<Profile>
}

export function startLogin(register = false) {
  window.location.assign(register ? '/api/auth/register' : '/api/auth/login')
}

export async function submitLogout() {
  const csrf = await loadCsrf()
  // Top-level form navigation follows the BFF-managed OIDC logout redirect, not a CORS fetch.
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/auth/logout'
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = csrf.parameterName
  input.value = csrf.token
  form.append(input)
  document.body.append(form)
  form.submit()
}
