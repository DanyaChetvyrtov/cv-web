import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch, type Profile } from './api'

type Employee = { id: string; employeeCode: string; fullName: string; department: string | null; createdAt: string }
type EmployeePage = { items: Employee[]; total: number; page: number; size: number }
type Identification = { status: 'matched' | 'unknown' | 'ambiguous'; employee: Employee | null; similarity: number | null; threshold: number }

const translations: Record<string, string> = {
  'No face detected. Use a clear front-facing photo.': 'Лицо не найдено. Выберите чёткое фото лица анфас.',
  'The photo must contain exactly one face.': 'На фото должно быть ровно одно лицо.',
  'The face is too small. Use a closer photo.': 'Лицо слишком маленькое. Выберите фото крупнее.',
  'This face is already registered': 'Этот человек уже зарегистрирован в базе.',
  'This employee code is already registered': 'Сотрудник с таким табельным номером уже есть.',
  'Face recognition is unavailable': 'Сервис распознавания лиц временно недоступен.',
  'Face recognition is unavailable.': 'Сервис распознавания лиц временно недоступен.',
  'Face model has changed; employees need re-enrollment': 'Модель распознавания изменилась. Требуется повторное добавление фото сотрудников.',
  'Employee not found': 'Сотрудник уже удалён.',
  'Cannot decode image. Upload a valid JPEG, PNG or WEBP.': 'Не удалось прочитать изображение. Используйте JPG, PNG или WEBP.',
  'Access denied or invalid CSRF token.': 'Недостаточно прав или сессия изменилась. Обновите страницу.',
  'Sign in through the BFF.': 'Сессия завершена. Войдите снова.',
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    const detail = body?.detail
    throw new Error(detail ? translations[detail] || detail : 'Не удалось выполнить запрос: HTTP ' + response.status)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

function PhotoInput({ label, file, onChange, disabled }: { label: string; file: File | null; onChange: (file: File | null) => void; disabled: boolean }) {
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <label className="employee-photo">
    <span>{label}</span>
    <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" disabled={disabled} onChange={(event) => {
      const selected = event.target.files?.[0]
      event.target.value = ''
      if (!selected) return
      if (selected.size === 0 || selected.size > 10 * 1024 * 1024 ||
        (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) && !/\.(jpe?g|png|webp)$/i.test(selected.name))) {
        setError('Выберите JPG, PNG или WEBP до 10 МБ.'); onChange(null); return
      }
      setError(''); onChange(selected)
    }} />
    {preview && <img src={preview} alt="Фото для распознавания лица" />}
    {file && <small>{file.name}</small>}
    {error && <span className="field-error" role="alert">{error}</span>}
  </label>
}

export default function EmployeesPanel({ profile }: { profile: Profile | null }) {
  const isAdmin = profile?.roles.includes('ADMIN') ?? false
  const canIdentify = profile?.roles.includes('USER') ?? false
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [employees, setEmployees] = useState<EmployeePage | null>(null)
  const [listError, setListError] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [enrollmentPhoto, setEnrollmentPhoto] = useState<File | null>(null)
  const [queryPhoto, setQueryPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState<'enroll' | 'identify' | string | null>(null)
  const [enrollmentMessage, setEnrollmentMessage] = useState('')
  const [enrollmentError, setEnrollmentError] = useState('')
  const [identification, setIdentification] = useState<Identification | null>(null)
  const [identificationError, setIdentificationError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    setEmployees(null); setIdentification(null); setIdentificationError(''); setPendingDelete(null)
    setEnrollmentPhoto(null); setQueryPhoto(null); setEnrollmentMessage(''); setEnrollmentError(''); setBusy(null)
  }, [profile?.subject])

  useEffect(() => {
    if (!isAdmin) { setEmployees(null); return }
    const controller = new AbortController()
    setListLoading(true); setListError('')
    void request<EmployeePage>('/api/employees?page=' + page + '&size=10', { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return
      if (page > 0 && data.items.length === 0) { setPage(page - 1); return }
      setEmployees(data)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : 'Не удалось загрузить сотрудников.')
    }).finally(() => { if (!controller.signal.aborted) setListLoading(false) })
    return () => controller.abort()
  }, [isAdmin, profile?.subject, page, revision])

  async function enroll(event: FormEvent) {
    event.preventDefault()
    if (!enrollmentPhoto || busy) return
    const requestGeneration = generation.current
    setBusy('enroll'); setEnrollmentMessage(''); setEnrollmentError('')
    const body = new FormData()
    body.set('employeeCode', code.trim()); body.set('fullName', name.trim()); body.set('department', department.trim()); body.set('image', enrollmentPhoto)
    try {
      const employee = await request<Employee>('/api/employees', { method: 'POST', body })
      if (generation.current !== requestGeneration) return
      setEnrollmentMessage('Добавлен: ' + employee.fullName)
      setCode(''); setName(''); setDepartment(''); setEnrollmentPhoto(null); setPage(0); setRevision((value) => value + 1)
      setIdentification(null)
    } catch (error) {
      if (generation.current === requestGeneration) setEnrollmentError(error instanceof Error ? error.message : 'Не удалось добавить сотрудника.')
    } finally { if (generation.current === requestGeneration) setBusy(null) }
  }

  async function identify() {
    if (!queryPhoto || busy) return
    const requestGeneration = generation.current
    setBusy('identify'); setIdentification(null); setIdentificationError('')
    const body = new FormData(); body.set('image', queryPhoto)
    try {
      const result = await request<Identification>('/api/employees/identifications', { method: 'POST', body })
      if (generation.current === requestGeneration) setIdentification(result)
    } catch (error) {
      if (generation.current === requestGeneration) setIdentificationError(error instanceof Error ? error.message : 'Не удалось проверить фото.')
    } finally { if (generation.current === requestGeneration) setBusy(null) }
  }

  async function remove(employee: Employee) {
    const requestGeneration = generation.current
    setBusy(employee.id); setListError('')
    try {
      await request<void>('/api/employees/' + employee.id, { method: 'DELETE' })
      if (generation.current !== requestGeneration) return
      setPendingDelete(null); setRevision((value) => value + 1); setIdentification(null)
    } catch (error) {
      if (generation.current === requestGeneration) setListError(error instanceof Error ? error.message : 'Не удалось удалить сотрудника.')
    } finally { if (generation.current === requestGeneration) setBusy(null) }
  }

  return <section className="panel employee-panel" aria-labelledby="employees-title">
    <div className="panel-heading"><span className="section-index">01</span><div><h2 id="employees-title">Пропускной пункт</h2><p>Сотрудники и проверка по фотографии</p></div></div>
    {!profile ? <p className="employee-empty">Войдите, чтобы проверить сотрудника. Для управления базой нужна роль ADMIN.</p> : <>
      <div className="employee-workspace">
        {isAdmin && <form className="employee-section" onSubmit={(event) => void enroll(event)}>
          <h3>Добавить сотрудника</h3>
          <p className="employee-hint">Чёткое фото анфас с одним лицом. Обучать модель для каждого сотрудника не требуется.</p>
          <label>Табельный номер<input required maxLength={64} pattern="[A-Za-z0-9_-]+" placeholder="EMP-001" value={code} disabled={!!busy} onChange={(event) => setCode(event.target.value)} /></label>
          <label>ФИО<input required maxLength={160} placeholder="Иван Иванов" value={name} disabled={!!busy} onChange={(event) => setName(event.target.value)} /></label>
          <label>Отдел <span className="employee-optional">(необязательно)</span><input maxLength={120} value={department} disabled={!!busy} onChange={(event) => setDepartment(event.target.value)} /></label>
          <PhotoInput label="Фото сотрудника" file={enrollmentPhoto} disabled={!!busy} onChange={(file) => { setEnrollmentPhoto(file); setEnrollmentError(''); setEnrollmentMessage('') }} />
          <button className="primary-button" disabled={!enrollmentPhoto || !!busy} type="submit">{busy === 'enroll' ? 'Добавляем…' : 'Добавить в базу'}</button>
          {enrollmentMessage && <p className="employee-success" role="status">{enrollmentMessage}</p>}
          {enrollmentError && <p className="field-error" role="alert">{enrollmentError}</p>}
        </form>}
        <div className="employee-section">
          <h3>Проверить человека</h3>
          <p className="employee-hint">Выберите новое фото: система сравнит лицо с зарегистрированными сотрудниками.</p>
          <PhotoInput label="Фото для проверки" file={queryPhoto} disabled={!!busy || !canIdentify} onChange={(file) => { setQueryPhoto(file); setIdentification(null); setIdentificationError('') }} />
          <button className="primary-button" type="button" disabled={!canIdentify || !queryPhoto || !!busy} onClick={() => void identify()}>{busy === 'identify' ? 'Сравниваем лица…' : 'Проверить по базе'}</button>
          {!canIdentify && <p className="employee-hint">Для проверки нужна роль USER.</p>}
          {identificationError && <p className="field-error" role="alert">{identificationError}</p>}
          {identification && <div className={'employee-verdict verdict-' + identification.status} role="status">
            <strong>{identification.status === 'matched' ? 'Сотрудник найден' : identification.status === 'ambiguous' ? 'Неоднозначный результат' : 'Сотрудник не найден'}</strong>
            {identification.employee && <><span>{identification.employee.fullName}</span><span>Табельный номер: {identification.employee.employeeCode}</span>{identification.employee.department && <span>{identification.employee.department}</span>}</>}
            {identification.status === 'ambiguous' && <span>Сходство с несколькими сотрудниками близкое. Проверьте личность вручную.</span>}
            {identification.status === 'unknown' && <span>Совпадение с достаточным сходством отсутствует.</span>}
            {identification.similarity !== null && <small>Сходство: {identification.similarity.toFixed(3)} · порог: {identification.threshold.toFixed(3)}. Это показатель сходства, а не вероятность.</small>}
          </div>}
          <p className="employee-hint">Проверка по фото не определяет, живой ли человек перед камерой. Для реального допуска требуется дополнительная проверка.</p>
        </div>
      </div>
      {isAdmin && <div className="employee-directory">
        <div className="employee-directory-heading"><h3>База сотрудников {employees && <span>· {employees.total}</span>}</h3><button className="secondary-button" type="button" disabled={!!busy || listLoading} onClick={() => setRevision((value) => value + 1)}>Обновить</button></div>
        {listError && <p className="field-error" role="alert">{listError}</p>}
        {listLoading && <p role="status">Загружаем сотрудников…</p>}
        {employees && !listLoading && <>
          {!employees.items.length && <p className="employee-hint">База пуста. Добавьте первого сотрудника с фотографией.</p>}
          <div className="employee-list">{employees.items.map((employee) => <article className="employee-row" key={employee.id}>
            <div><strong>{employee.fullName}</strong><span>{employee.employeeCode}{employee.department ? ' · ' + employee.department : ''}</span></div>
            <div className="employee-row-actions">{pendingDelete === employee.id ? <><span>Удалить запись и шаблон лица?</span><button className="secondary-button employee-delete" disabled={!!busy} type="button" onClick={() => void remove(employee)}>Удалить</button><button className="secondary-button" disabled={!!busy} type="button" onClick={() => setPendingDelete(null)}>Отмена</button></> : <button className="secondary-button" disabled={!!busy} type="button" onClick={() => setPendingDelete(employee.id)}>Удалить</button>}</div>
          </article>)}</div>
          {employees.total > employees.size && <div className="employee-pagination"><button className="secondary-button" disabled={page === 0 || !!busy} type="button" onClick={() => setPage(page - 1)}>Назад</button><span>Страница {page + 1} из {Math.ceil(employees.total / employees.size)}</span><button className="secondary-button" disabled={(page + 1) * employees.size >= employees.total || !!busy} type="button" onClick={() => setPage(page + 1)}>Далее</button></div>}
        </>}
      </div>}
    </>}
  </section>
}
