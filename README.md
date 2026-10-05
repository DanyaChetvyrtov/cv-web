# CV Web

React-интерфейс для двух локальных API: детекция изображений в `cv-test` и вход/проверка ролей через `keycloak-integration-test`.
Вход использует Authorization Code + PKCE. Access token передаётся только в Kotlin API и хранится в памяти вкладки.
Детекция в Python остаётся отдельным публичным API.

## Запуск всего приложения

Используйте единственный Docker Compose из корневого репозитория
[cv-complex-test](https://github.com/DanyaChetvyrtov/cv-complex-test#запуск-всего-проекта).
В этом модуле Compose-файлов нет. Корневой Compose собирает этот Dockerfile и запускает Nginx с готовым React UI,
Python API, Kotlin API и Keycloak.

Откройте **http://127.0.0.1:5173/**. Этот адрес записан в redirect URI и web origin клиента Keycloak.
Тестовые аккаунты: `demo / demo123` (USER) и `manager / manager123` (USER, ADMIN).
Регистрация создаёт пользователя с ролью USER.

После входа панель «Учётная запись» показывает профиль и позволяет вызвать публичный, пользовательский
и административный маршруты. Без токена защищённые маршруты возвращают 401, без нужной роли — 403.
После обновления страницы или истечения токена войдите снова.

## Разработка с Vite

Нужен Node.js 24. Сначала из корня общего проекта запустите API и Keycloak:

```bash
docker compose up --build --detach --wait --wait-timeout 600 api cv
docker compose stop web
cd cv-web
npm ci
npm run dev
```

Откройте тот же **http://127.0.0.1:5173/**. `stop web` освобождает порт, если контейнер UI уже запущен.
В PowerShell при необходимости используйте `npm.cmd` вместо `npm`.
Адреса API для Vite можно переопределить в `.env` по [.env.example](.env.example):
`CV_API_URL` и `KEYCLOAK_API_URL`. После изменения перезапустите Vite.

## Проксирование

| Путь в браузере | Путь в сервисе | Vite (локальная разработка) | Nginx (Docker) |
| --- | --- | --- | --- |
| `/api/health`, `/api/vision/detect` | `/health`, `/vision/detect` | `http://127.0.0.1:8000` | `http://cv:8000` |
| `/auth-api/public`, `/auth-api/me`, `/auth-api/user`, `/auth-api/admin` | `/api/public`, `/api/me`, `/api/user`, `/api/admin` | `http://127.0.0.1:8080` | `http://api:8080` |

Сборка в Docker использует [nginx.conf](nginx.conf), поэтому те же маршруты работают и без Vite.
Прокси допускает загрузку 10 MiB изображения с multipart-заголовками и ждёт CPU-детекцию до 120 секунд.
Обмен authorization code на токены браузер выполняет напрямую с Keycloak на `localhost:8081`.

## Сборка

```bash
npm run build
```

Сборка создаёт `dist/`. Dockerfile собирает UI через `npm ci` и обслуживает `dist/` в Nginx.
Сборку контейнера, запуск и интеграционные проверки выполняет CI корневого репозитория.
При изменении адреса размещения UI обновите redirect URI, post logout redirect URI и web origin клиента `demo-browser` в Keycloak.
