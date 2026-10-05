# CV Web

React-интерфейс для двух локальных API: детекция изображений в `cv-test` и вход/проверка ролей через `keycloak-integration-test`. Вход использует Authorization Code + PKCE. Access token передаётся только в Kotlin API и хранится в памяти вкладки. Детекция в Python остаётся отдельным публичным API.

## Запуск

Нужны Node.js, Python-сервис из `../cv-test`, а также Docker и Docker Compose для Kotlin API с Keycloak.

В трёх терминалах из корня общего проекта:

```powershell
cd cv-test
uvicorn cv_test.api:create_app --factory --host 127.0.0.1 --port 8000
```

```powershell
cd keycloak-integration-test
docker compose up --build -d
```

```powershell
cd cv-web
npm.cmd install
npm.cmd run dev
```

Откройте **http://127.0.0.1:5173/**. Используйте этот адрес: он записан в redirect URI и web origin клиента Keycloak. Тестовые аккаунты: `demo / demo123` (USER) и `manager / manager123` (USER, ADMIN). Регистрация создаёт пользователя с ролью USER.

Если realm `demo` был импортирован до перехода на React UI, один раз обновите его без удаления пользователей:

```powershell
cd keycloak-integration-test
python scripts/enable_registration.py --keycloak-url http://127.0.0.1:8081
```

После входа панель «Учётная запись» показывает профиль и позволяет вызвать публичный, пользовательский и административный маршруты. Без токена защищённые маршруты возвращают 401, а без нужной роли — 403. После обновления страницы или истечения токена войдите снова.

## Маршруты разработки

Vite проксирует:

| Путь в браузере | Сервис | Путь в сервисе |
| --- | --- | --- |
| `/api/health`, `/api/vision/detect` | `cv-test` на `127.0.0.1:8000` | `/health`, `/vision/detect` |
| `/auth-api/public`, `/auth-api/me`, `/auth-api/user`, `/auth-api/admin` | Kotlin API на `127.0.0.1:8080` | `/api/public`, `/api/me`, `/api/user`, `/api/admin` |

Адреса сервисов можно переопределить в `.env` по образцу `.env.example`: `CV_API_URL` и `KEYCLOAK_API_URL`. После изменения перезапустите Vite. Сам обмен authorization code на токены выполняется браузером напрямую с Keycloak на `localhost:8081`; web origin должен быть разрешён в realm.

## Сборка

```powershell
npm.cmd run build
```

Сборка создаёт `dist/`. При размещении собранного UI настройте внешний прокси с теми же маршрутами `/api` и `/auth-api`, а в клиенте `demo-browser` обновите redirect URI, post logout redirect URI и web origin на адрес размещённого UI. Прокси Vite действует только в режиме разработки.
