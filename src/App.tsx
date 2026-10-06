import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import AuthPanel from './AuthPanel'
import { apiFetch, type Profile } from './api'
import EmployeesPanel from './EmployeesPanel'

type BoundingBox = { x1: number; y1: number; x2: number; y2: number }
type Detection = { class_id: number; label: string; confidence: number; bbox: BoundingBox }
type DetectionResult = {
  model: string
  width: number
  height: number
  inference_ms: number
  detections: Detection[]
}
type Health = { status: string; model: string; device: string }
type ViewState = 'idle' | 'loading' | 'success' | 'error'

const maxFileBytes = 10 * 1024 * 1024
const colors = ['#73e4b0', '#60c9f2', '#f2c46d', '#d59df8', '#fa8f95', '#8dacf9']

function objectCount(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'объектов' : last === 1 ? 'объект' : last >= 2 && last <= 4 ? 'объекта' : 'объектов'
  return count + ' ' + word
}

function errorDetail(body: unknown, status: number) {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join('; ')
  }
  return 'Ошибка HTTP ' + status
}

function App() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const authenticated = profile !== null
  const fileInput = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [fileError, setFileError] = useState('')
  const [confidence, setConfidence] = useState(25)
  const [health, setHealth] = useState<Health | null>(null)
  const [apiState, setApiState] = useState<'checking' | 'online' | 'offline'>('checking')
  const [viewState, setViewState] = useState<ViewState>('idle')
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [resultError, setResultError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showBoxes, setShowBoxes] = useState(true)
  const [tab, setTab] = useState<'objects' | 'json'>('objects')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

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

  useEffect(() => () => activeRequest.current?.abort(), [])

  function chooseFile(candidate?: File) {
    if (!candidate) return
    const supported = ['image/jpeg', 'image/png', 'image/webp'].includes(candidate.type) ||
      (!candidate.type && /\.(jpe?g|png|webp)$/i.test(candidate.name))
    if (!supported || candidate.size === 0 || candidate.size > maxFileBytes) {
      setFileError(!supported ? 'Поддерживаются только JPG, PNG и WEBP.' : candidate.size === 0 ? 'Файл пустой.' : 'Размер файла превышает 10 МБ.')
      return
    }
    activeRequest.current?.abort()
    setFile(candidate)
    setFileError('')
    setResult(null)
    setResultError('')
    setViewState('idle')
    setShowBoxes(true)
    setTab('objects')
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0])
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files[0])
  }

  function onDropKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      fileInput.current?.click()
    }
  }

  async function runDetection() {
    if (!file || viewState === 'loading') return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setResult(null)
    setResultError('')
    setViewState('loading')

    const form = new FormData()
    form.append('image', file)
    try {
      const response = await apiFetch('/api/vision/detect?confidence=' + (confidence / 100), {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new Error(response.ok ? 'API вернул некорректный JSON.' : 'Kotlin BFF или внутренний CV-сервис недоступен.')
      }
      if (!response.ok) throw new Error(errorDetail(body, response.status))
      const data = body as DetectionResult
      if (!Array.isArray(data.detections) || !data.width || !data.height) {
        throw new Error('API вернул неожиданный формат ответа.')
      }
      setResult(data)
      setViewState('success')
    } catch (error) {
      if (controller.signal.aborted) return
      setResultError(error instanceof Error ? error.message : 'Неизвестная ошибка')
      setViewState('error')
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  async function copyJson() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function downloadAnnotated() {
    if (!result || !imageRef.current) return
    try {
      const image = imageRef.current
      if (!image.complete) await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = result.width
      canvas.height = result.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Не удалось создать изображение')
      context.drawImage(image, 0, 0, result.width, result.height)
      const lineWidth = Math.max(2, Math.round(result.width / 500))
      const fontSize = Math.max(13, Math.round(result.width / 65))
      context.font = '700 ' + fontSize + 'px sans-serif'
      result.detections.forEach((item) => {
        const color = colors[Math.abs(item.class_id) % colors.length]
        const box = item.bbox
        const label = item.label + ' ' + Math.round(item.confidence * 100) + '%'
        const labelWidth = context.measureText(label).width + 12
        const labelY = box.y1 >= fontSize + 8 ? box.y1 - fontSize - 7 : box.y1
        context.strokeStyle = color
        context.lineWidth = lineWidth
        context.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
        context.fillStyle = color
        context.fillRect(box.x1, labelY, labelWidth, fontSize + 7)
        context.fillStyle = '#071a15'
        context.fillText(label, box.x1 + 6, labelY + fontSize)
      })
      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = 'cv-result.png'
      link.click()
    } catch {
      setFileError('Не удалось сохранить изображение.')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">⌗</span><span>CV <strong>Lab</strong></span></div>
        <div className="topbar-right">
          <span className="topbar-caption">Песочница компьютерного зрения</span>
          <div className={'status status-' + apiState} role="status">
            <span className="status-dot" />
            <span>{apiState === 'online' ? 'API подключён' : apiState === 'offline' ? 'API недоступен' : 'Проверяем API…'}</span>
          </div>
        </div>
      </header>

      <main>
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-line" /> КОМПЬЮТЕРНОЕ ЗРЕНИЕ · ЛОКАЛЬНЫЕ МОДЕЛИ</div>
          <h1>Посмотрим, что видит <em>модель.</em></h1>
          <p>Добавьте сотрудника, проверьте человека по фотографии или распознайте объекты на изображении.</p>
        </section>

        <AuthPanel onProfileChange={setProfile} />
        <EmployeesPanel profile={profile} />

        <div className="workspace">
          <section className="panel input-panel" aria-labelledby="input-title">
            <div className="panel-heading"><span className="section-index">01</span><div><h2 id="input-title">Исходное изображение</h2><p>Файл для анализа</p></div></div>
            <div
              className={'drop-zone' + (dragging ? ' dragging' : '')}
              role="button"
              tabIndex={0}
              aria-label="Выбрать изображение"
              onClick={() => fileInput.current?.click()}
              onKeyDown={onDropKeyDown}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden onChange={onInputChange} />
              {!file ? (
                <div className="empty-upload">
                  <div className="upload-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="7" y="7" width="34" height="34" rx="8" stroke="currentColor" strokeWidth="1.5" /><circle cx="18" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="m9 33 10-10 7 7 5-5 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                  <strong>Перетащите изображение сюда</strong>
                  <span>или <span className="text-link">выберите файл</span> на компьютере</span>
                  <small>JPG, PNG, WEBP · до 10 МБ</small>
                </div>
              ) : (
                <div className="selected-upload">
                  {previewUrl && <img src={previewUrl} alt="Миниатюра выбранного изображения" />}
                  <div className="selected-details"><strong title={file.name}>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} МБ</span><span className="text-link">Нажмите, чтобы заменить</span></div>
                </div>
              )}
            </div>
            {fileError && <p className="field-error" role="alert">{fileError}</p>}
            <div className="settings">
              <div className="setting-label"><label htmlFor="confidence">Порог уверенности</label><output htmlFor="confidence">{confidence}%</output></div>
              <input id="confidence" type="range" min={1} max={100} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
              <div className="range-ends"><span>Больше объектов</span><span>Точнее результат</span></div>
            </div>
            <button className="primary-button" type="button" disabled={!authenticated || !file || viewState === 'loading'} onClick={() => void runDetection()}>
              <span>{!authenticated ? 'Войдите для запуска детекции' : viewState === 'loading' ? 'Выполняем детекцию…' : 'Запустить детекцию'}</span><span aria-hidden="true">↗</span>
            </button>
            <p className="input-note">Изображение отправляется в Kotlin BFF, затем во внутренний CV-сервис.</p>
          </section>

          <section className="panel result-panel" aria-labelledby="result-title">
            <div className="panel-heading result-heading">
              <div className="heading-left"><span className="section-index">02</span><div><h2 id="result-title">Результат</h2><p>Рамки и найденные объекты</p></div></div>
              {result && <button className="secondary-button" type="button" onClick={() => void downloadAnnotated()}>↓ Сохранить</button>}
            </div>
            {viewState === 'idle' && <div className="result-empty"><div className="scan-art" aria-hidden="true"><span className="scan-corner corner-tl" /><span className="scan-corner corner-tr" /><span className="scan-corner corner-bl" /><span className="scan-corner corner-br" /><span className="scan-line" /><span className="scan-plus">+</span></div><strong>Ожидаем изображение</strong><span>Загрузите файл и запустите детекцию, чтобы увидеть результат.</span></div>}
            {viewState === 'loading' && <div className="result-loading"><div className="loading-spinner" aria-hidden="true" /><strong>Анализируем изображение…</strong><span>Модели может понадобиться немного времени.</span></div>}
            {viewState === 'error' && <div className="result-error" role="alert"><span className="error-symbol">!</span><strong>Не удалось выполнить детекцию</strong><p>{resultError}</p></div>}
            {result && viewState === 'success' && previewUrl && (
              <div className="result-content">
                <div className="image-stage">
                  <div className="image-wrap">
                    <img ref={imageRef} src={previewUrl} alt="Изображение с результатом детекции" />
                    {showBoxes && <svg viewBox={'0 0 ' + result.width + ' ' + result.height} preserveAspectRatio="none" aria-hidden="true">
                      {result.detections.map((item, index) => {
                        const color = colors[Math.abs(item.class_id) % colors.length]
                        const box = item.bbox
                        const fontSize = Math.max(13, Math.round(result.width / 65))
                        const label = item.label + ' ' + Math.round(item.confidence * 100) + '%'
                        const labelWidth = Math.min(result.width - box.x1, Math.max(60, label.length * fontSize * 0.59 + 12))
                        const labelY = box.y1 >= fontSize + 8 ? box.y1 - fontSize - 7 : box.y1
                        return <g key={index}>
                          <title>{label}</title>
                          <rect x={box.x1} y={box.y1} width={box.x2 - box.x1} height={box.y2 - box.y1} fill="none" stroke={color} strokeWidth={Math.max(2, result.width / 500)} />
                          <rect x={box.x1} y={labelY} width={labelWidth} height={fontSize + 7} fill={color} />
                          <text x={box.x1 + 6} y={labelY + fontSize} fill="#071a15" fontSize={fontSize} fontWeight="700">{label}</text>
                        </g>
                      })}
                    </svg>}
                  </div>
                </div>
                <div className="result-footer">
                  <div className="result-summary"><strong>{objectCount(result.detections.length)}</strong><span>{result.width} × {result.height} px · {result.inference_ms.toFixed(1)} мс</span></div>
                  <label className="toggle"><input type="checkbox" checked={showBoxes} onChange={(event) => setShowBoxes(event.target.checked)} /><span className="toggle-track" />Показать рамки</label>
                </div>
              </div>
            )}
          </section>
        </div>

        {result && viewState === 'success' && (
          <section className="panel details-panel" aria-labelledby="details-title">
            <div className="details-header">
              <div className="heading-left"><span className="section-index">03</span><div><h2 id="details-title">Детали анализа</h2><p>Объекты и исходный ответ API</p></div></div>
              <div className="tab-list" role="tablist" aria-label="Вид результата">
                <button className={'tab' + (tab === 'objects' ? ' active' : '')} type="button" role="tab" aria-selected={tab === 'objects'} onClick={() => setTab('objects')}>Объекты</button>
                <button className={'tab' + (tab === 'json' ? ' active' : '')} type="button" role="tab" aria-selected={tab === 'json'} onClick={() => setTab('json')}>JSON</button>
              </div>
            </div>
            {tab === 'objects' ? (
              result.detections.length ? <div className="objects-list">{result.detections.map((item, index) => (
                <div className="object-card" key={index}>
                  <span className="object-color" style={{ background: colors[Math.abs(item.class_id) % colors.length] }} />
                  <div className="object-main"><strong>{item.label}</strong><span>Класс #{item.class_id} · [{Math.round(item.bbox.x1)}, {Math.round(item.bbox.y1)}] – [{Math.round(item.bbox.x2)}, {Math.round(item.bbox.y2)}]</span></div>
                  <span className="object-confidence">{Math.round(item.confidence * 100)}%</span>
                </div>
              ))}</div> : <div className="no-objects">При текущем пороге уверенности объекты не найдены. Попробуйте уменьшить порог.</div>
            ) : (
              <div className="json-view"><div className="json-toolbar"><span>Ответ /api/vision/detect</span><button type="button" onClick={() => void copyJson()}>{copied ? 'Скопировано' : 'Копировать JSON'}</button></div><pre>{JSON.stringify(result, null, 2)}</pre></div>
            )}
          </section>
        )}
      </main>
      <footer className="footer"><span>CV LAB / LOCAL TESTING</span><span>{health ? 'Модель: ' + health.model + ' · ' + health.device : 'Проверяем доступность сервиса'}</span></footer>
    </div>
  )
}

export default App
