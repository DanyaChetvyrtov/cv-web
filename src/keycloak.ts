export type AuthConfig = {
  message: string
  issuerUri: string
  browserClientId: string
}

export type AuthSession = {
  accessToken: string
  idToken: string
  expiresAt: number
}

const pendingKey = 'cv-web-keycloak-pkce'

function redirectUri() {
  return window.location.origin + '/'
}

function base64url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function randomString() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  const response = await fetch('/auth-api/public', { cache: 'no-store' })
  if (!response.ok) throw new Error('Kotlin API недоступен. Запустите сервис на localhost:8080.')
  const config = await response.json() as AuthConfig
  if (!config.issuerUri || !config.browserClientId) {
    throw new Error('Kotlin API вернул неполную конфигурацию входа.')
  }
  return config
}

export async function startAuthentication(config: AuthConfig, register = false) {
  const verifier = randomString()
  const state = randomString()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64url(new Uint8Array(digest))
  sessionStorage.setItem(pendingKey, JSON.stringify({ verifier, state, createdAt: Date.now() }))

  const url = new URL(config.issuerUri + '/protocol/openid-connect/auth')
  url.search = new URLSearchParams({
    client_id: config.browserClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(register ? { prompt: 'create' } : {}),
  }).toString()
  window.location.assign(url.href)
}

export async function finishAuthentication(config: AuthConfig): Promise<AuthSession | null> {
  const callback = new URL(window.location.href)
  const params = callback.searchParams
  if (!params.has('code') && !params.has('error')) return null

  const code = params.get('code')
  const state = params.get('state')
  const issuer = params.get('iss')
  const error = params.get('error')
  for (const key of ['code', 'state', 'iss', 'session_state', 'error', 'error_description']) {
    callback.searchParams.delete(key)
  }
  window.history.replaceState(null, '', callback.pathname + callback.search + callback.hash)

  const saved = sessionStorage.getItem(pendingKey)
  sessionStorage.removeItem(pendingKey)
  type PendingLogin = { verifier: string; state: string; createdAt: number }
  let pending: PendingLogin | null = null
  try {
    pending = saved ? JSON.parse(saved) as PendingLogin : null
  } catch {
    // A corrupt or stale login attempt must not be used for token exchange.
  }
  if (!pending || typeof pending.verifier !== 'string' || pending.state !== state ||
      typeof pending.createdAt !== 'number' || Date.now() - pending.createdAt > 10 * 60 * 1000 ||
      pending.createdAt > Date.now()) {
    throw new Error('Состояние входа не совпало или устарело. Повторите вход.')
  }
  if (error) throw new Error('Keycloak: ' + error)
  if (issuer && issuer !== config.issuerUri) throw new Error('Неожиданный issuer в ответе входа.')
  if (!code) throw new Error('Keycloak не вернул код авторизации.')

  const response = await fetch(config.issuerUri + '/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.browserClientId,
      redirect_uri: redirectUri(),
      code,
      code_verifier: pending.verifier,
    }),
  })
  if (!response.ok) throw new Error('Обмен кода на токен завершился с HTTP ' + response.status)
  const tokens = await response.json() as {
    access_token?: string
    id_token?: string
    expires_in?: number
  }
  if (!tokens.access_token || !tokens.id_token || !tokens.expires_in) {
    throw new Error('Keycloak вернул неполный ответ с токенами.')
  }
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

export function endAuthentication(config: AuthConfig, session: AuthSession) {
  const url = new URL(config.issuerUri + '/protocol/openid-connect/logout')
  url.search = new URLSearchParams({
    client_id: config.browserClientId,
    id_token_hint: session.idToken,
    post_logout_redirect_uri: redirectUri(),
  }).toString()
  window.location.assign(url.href)
}
