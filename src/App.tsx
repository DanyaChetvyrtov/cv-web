import { useEffect, useState } from 'react'
import AuthPanel from './AuthPanel'
import EmployeesPanel from './EmployeesPanel'
import type { Profile } from './api'

type Health = { status: string; face_model: string }

function App() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [apiState, setApiState] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    let alive = true

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        if (!response.ok) throw new Error('API недоступен')
        const body = await response.json() as Health
        if (alive) {
          setHealth(body)
          setApiState('online')
        }
      } catch {
        if (alive) {
          setHealth(null)
          setApiState('offline')
        }
      }
    }

    void checkHealth()
    const timer = window.setInterval(checkHealth, 15000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">⌗</span><span>CV <strong>Access</strong></span></div>
        <div className="topbar-right">
          <span className="topbar-caption">Проверка сотрудников по лицу</span>
          <div className={'status status-' + apiState} role="status">
            <span className="status-dot" />
            <span>{apiState === 'online' ? 'CV подключён' : apiState === 'offline' ? 'CV недоступен' : 'Проверяем CV…'}</span>
          </div>
        </div>
      </header>

      <main>
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-line" /> FACE RECOGNITION · ЛОКАЛЬНЫЕ МОДЕЛИ</div>
          <h1>Пропускная система с <em>проверкой лица.</em></h1>
          <p>Добавляйте сотрудников в базу и проверяйте, зарегистрирован ли человек, по новой фотографии.</p>
        </section>

        <AuthPanel onProfileChange={setProfile} />
        <EmployeesPanel profile={profile} />
      </main>

      <footer className="footer">
        <span>CV ACCESS / LOCAL TESTING</span>
        <span>{health ? 'Face model: ' + health.face_model : 'Проверяем доступность CV-сервиса'}</span>
      </footer>
    </div>
  )
}

export default App
