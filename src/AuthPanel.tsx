import { useEffect, useState } from 'react'
import { apiFetch, loadProfile, startLogin, submitLogout, type Profile } from './api'

type Endpoint = 'public' | 'me' | 'user' | 'admin'
type ApiResult = { endpoint: Endpoint; status: number; body: string }

export default function AuthPanel({ onProfileChange }: { onProfileChange: (profile: Profile | null) => void }) {
  const [retry, setRetry] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [message, setMessage] = useState('Проверяем сессию Kotlin BFF…')
  const [apiResult, setApiResult] = useState<ApiResult | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let active = true
    const url = new URL(window.location.href)
    const loginFailed = url.searchParams.get('auth') === 'error'
    if (url.searchParams.has('auth')) {
      url.searchParams.delete('auth')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    void loadProfile().then((loaded) => {
      if (!active) return
      setProfile(loaded)
      onProfileChange(loaded)
      setPhase('ready')
      setMessage(loginFailed ? 'Вход не завершён. Повторите попытку.' : loaded ? 'Вы вошли. Сессией управляет Kotlin BFF.' : 'Вы не вошли.')
    }).catch((error: unknown) => {
      if (!active) return
      setPhase('error')
      setMessage(error instanceof Error ? error.message : 'Не удалось подключить Kotlin BFF.')
    })
    const expire = () => {
      setProfile(null)
      onProfileChange(null)
      setMessage('Сессия истекла. Войдите снова.')
    }
    window.addEventListener('bff-session-expired', expire)
    return () => { active = false; window.removeEventListener('bff-session-expired', expire) }
  }, [retry, onProfileChange])

  useEffect(() => {
    if (!profile) return
    let active = true
    const timer = window.setInterval(() => {
      void loadProfile().then((loaded) => {
        if (!active) return
        setProfile(loaded)
        onProfileChange(loaded)
        if (!loaded) setMessage('Сессия истекла. Войдите снова.')
      }).catch(() => { /* Keep the session during a transient network outage. */ })
    }, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [profile, onProfileChange])

  async function callEndpoint(endpoint: Endpoint) {
    setRequesting(true)
    try {
      const response = await apiFetch('/api/' + endpoint, { cache: 'no-store' })
      const raw = await response.text()
      let body = raw || '(пустой ответ)'
      try { body = JSON.stringify(JSON.parse(raw), null, 2) } catch { /* Plain text response. */ }
      setApiResult({ endpoint, status: response.status, body })
      if (endpoint === 'me' && response.ok) {
        setProfile(JSON.parse(raw) as Profile)
        onProfileChange(JSON.parse(raw) as Profile)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось обратиться к Kotlin BFF.')
    } finally {
      setRequesting(false)
    }
  }

  async function logout() {
    setRequesting(true)
    try { await submitLogout() } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось завершить сессию.')
      setRequesting(false)
    }
  }

  return (
    <section className="panel auth-panel" aria-labelledby="auth-title">
      <div className="auth-heading">
        <div className="heading-left">
          <span className="section-index">00</span>
          <div><h2 id="auth-title">Учётная запись</h2><p>Серверная сессия · Kotlin BFF</p></div>
        </div>
        <span className={'auth-indicator ' + (phase === 'ready' ? 'auth-online' : 'auth-offline')}>
          {phase === 'ready' ? 'BFF подключён' : phase === 'loading' ? 'Подключаем BFF…' : 'BFF недоступен'}
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
            {phase === 'error' && <button type="button" className="secondary-button" onClick={() => { setPhase('loading'); setRetry((value) => value + 1) }}>Повторить подключение</button>}
            <button type="button" className="secondary-button" disabled={phase !== 'ready' || requesting} onClick={() => startLogin()}>{profile ? 'Войти снова' : 'Войти'}</button>
            <button type="button" className="secondary-button" disabled={phase !== 'ready' || !!profile || requesting} onClick={() => startLogin(true)}>Зарегистрироваться</button>
            <button type="button" className="secondary-button" disabled={!profile || requesting} onClick={() => void logout()}>Выйти</button>
          </div>
          <p className="auth-note">BFF перенаправит на форму Keycloak. Access/refresh-токены остаются на сервере; браузер использует HttpOnly-cookie.</p>
        </div>
        <div className="auth-check">
          <div className="auth-check-title"><strong>Проверить доступ</strong><span>Ответы Kotlin BFF</span></div>
          <div className="auth-actions">
            {(['public', 'me', 'user', 'admin'] as const).map((endpoint) =>
              <button key={endpoint} type="button" className="secondary-button" disabled={phase !== 'ready' || requesting} onClick={() => void callEndpoint(endpoint)}>
                {endpoint === 'me' ? 'Мой профиль' : endpoint.toUpperCase()}
              </button>,
            )}
          </div>
          {apiResult ? <pre className="auth-response" aria-live="polite">GET /api/{apiResult.endpoint} · HTTP {apiResult.status}{'\n\n'}{apiResult.body}</pre>
            : <p className="auth-placeholder">Без сессии защищённые маршруты вернут 401, без нужной роли — 403.</p>}
        </div>
      </div>
    </section>
  )
}
