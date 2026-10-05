import { useEffect, useRef, useState } from 'react'
import {
  endAuthentication,
  finishAuthentication,
  loadAuthConfig,
  startAuthentication,
  type AuthConfig,
  type AuthSession,
} from './keycloak'

type Profile = {
  subject: string
  username: string | null
  email: string | null
  roles: string[]
  scopes: string[]
}
type Endpoint = 'public' | 'me' | 'user' | 'admin'
type ApiResult = { endpoint: Endpoint; status: number; body: string }

export default function AuthPanel() {
  const initialization = useRef<Promise<{ config: AuthConfig; session: AuthSession | null }> | null>(null)
  const [retry, setRetry] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [message, setMessage] = useState('Подключаем Kotlin API…')
  const [apiResult, setApiResult] = useState<ApiResult | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let active = true
    if (!initialization.current) {
      initialization.current = (async () => {
        const loaded = await loadAuthConfig()
        const signedIn = await finishAuthentication(loaded)
        return { config: loaded, session: signedIn }
      })()
    }
    void initialization.current.then(({ config: loaded, session: signedIn }) => {
      if (!active) return
      setConfig(loaded)
      setSession(signedIn)
      setPhase('ready')
      setMessage(signedIn ? 'Вы вошли. Права проверяет Kotlin API.' : 'Вы не вошли.')
      if (signedIn) void callEndpoint('me', signedIn.accessToken)
    }).catch((error: unknown) => {
      if (!active) return
      setPhase('error')
      setMessage(error instanceof Error ? error.message : 'Не удалось подключить Kotlin API.')
    })
    return () => { active = false }
  }, [retry])

  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      setSession(null)
      setProfile(null)
      setMessage('Токен истёк. Войдите снова.')
    }, Math.max(0, session.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])

  async function callEndpoint(endpoint: Endpoint, token = session?.accessToken) {
    setRequesting(true)
    try {
      const response = await fetch('/auth-api/' + endpoint, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        cache: 'no-store',
      })
      const raw = await response.text()
      let body = raw || '(пустой ответ)'
      try { body = JSON.stringify(JSON.parse(raw), null, 2) } catch { /* Empty or plain text response. */ }
      setApiResult({ endpoint, status: response.status, body })
      if (endpoint === 'me' && response.ok) setProfile(JSON.parse(raw) as Profile)
      if (response.status === 401 && token) {
        setSession(null)
        setProfile(null)
        setMessage('Токен отклонён или истёк. Войдите снова.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось обратиться к Kotlin API.')
    } finally {
      setRequesting(false)
    }
  }

  function retryConnection() {
    initialization.current = null
    setPhase('loading')
    setMessage('Подключаем Kotlin API…')
    setRetry((value) => value + 1)
  }

  function logout() {
    if (!config || !session) return
    setSession(null)
    setProfile(null)
    setApiResult(null)
    endAuthentication(config, session)
  }

  return (
    <section className="panel auth-panel" aria-labelledby="auth-title">
      <div className="auth-heading">
        <div className="heading-left">
          <span className="section-index">00</span>
          <div><h2 id="auth-title">Учётная запись</h2><p>Вход через Keycloak · проверка прав в Kotlin API</p></div>
        </div>
        <span className={'auth-indicator ' + (phase === 'ready' ? 'auth-online' : 'auth-offline')}>
          {phase === 'ready' ? 'Kotlin API подключён' : phase === 'loading' ? 'Подключаем API…' : 'Kotlin API недоступен'}
        </span>
      </div>

      <div className="auth-content">
        <div className="auth-account">
          <p className="auth-message" role="status">{message}</p>
          {profile && <div className="auth-profile">
            <strong>{profile.username || profile.subject}</strong>
            {profile.email && <span>{profile.email}</span>}
            <span>Роли: {profile.roles.length ? profile.roles.join(', ') : 'нет'}</span>
          </div>}
          <div className="auth-actions">
            {phase === 'error' && <button type="button" className="secondary-button" onClick={retryConnection}>Повторить подключение</button>}
            <button type="button" className="secondary-button" disabled={phase !== 'ready'} onClick={() => config && void startAuthentication(config).catch((error: unknown) => setMessage(String(error)))}>{session ? 'Войти снова' : 'Войти'}</button>
            <button type="button" className="secondary-button" disabled={phase !== 'ready' || !!session} onClick={() => config && void startAuthentication(config, true).catch((error: unknown) => setMessage(String(error)))}>Зарегистрироваться</button>
            <button type="button" className="secondary-button" disabled={!session} onClick={logout}>Выйти</button>
          </div>
          <p className="auth-note">Вход и регистрация откроются в Keycloak. Токен хранится только в памяти вкладки.</p>
        </div>

        <div className="auth-check">
          <div className="auth-check-title"><strong>Проверить доступ</strong><span>Ответы Kotlin API</span></div>
          <div className="auth-actions">
            {(['public', 'me', 'user', 'admin'] as const).map((endpoint) =>
              <button key={endpoint} type="button" className="secondary-button" disabled={phase !== 'ready' || requesting} onClick={() => void callEndpoint(endpoint)}>
                {endpoint === 'me' ? 'Мой профиль' : endpoint.toUpperCase()}
              </button>,
            )}
          </div>
          {apiResult ? <pre className="auth-response" aria-live="polite">GET /api/{apiResult.endpoint} · HTTP {apiResult.status}{'\n\n'}{apiResult.body}</pre>
            : <p className="auth-placeholder">Выберите маршрут. Без токена защищённые маршруты вернут 401, без нужной роли — 403.</p>}
        </div>
      </div>
    </section>
  )
}
