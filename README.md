# CV Web

React UI для **Kotlin BFF**. Все запросы приложения идут только в `/api/*`.
В React нет access/refresh-токенов, PKCE, обработки authorization code, issuer URL или клиента Python CV.
BFF устанавливает HttpOnly-cookie `BFFSESSION` и хранит OAuth-токены на сервере.

## Запуск

Используйте единый Compose из [cv-complex-test](https://github.com/DanyaChetvyrtov/cv-root).
В этом модуле Compose-файлов нет. Dockerfile собирает React, Nginx обслуживает UI
и направляет весь `/api/*` в Kotlin **без переписывания пути**.

Откройте **http://127.0.0.1:5173/**.
Аккаунты: `demo / demo123` (USER), `manager / manager123` (USER, ADMIN).
Регистрация создаёт USER. Для детекции требуется вход.
После перезагрузки страницы профиль восстанавливается через `GET /api/me`, повторный вход не требуется,
пока серверная сессия действительна.

## Вход и защита запросов

Кнопки входа/регистрации открывают `/api/auth/login` и `/api/auth/register`.
BFF перенаправляет браузер на форму Keycloak;
callback, PKCE и token exchange выполняет Kotlin. React получает возврат на `/`.

Перед POST UI получает `GET /api/auth/csrf` и передаёт токен в указанном header.
Logout выполняется top-level POST-формой с CSRF в `/api/auth/logout`, чтобы браузер мог пройти OIDC logout-редирект.
401 очищает состояние профиля; cookie и OAuth-сессией управляет сервер.
Детекция вызывается как `POST /api/vision/detect`, а Kotlin отправляет изображение во внутренний CV.

## Разработка

Нужен Node.js 24. Из корня общего проекта:

```bash
docker compose up --build --detach --wait --wait-timeout 600 api cv
docker compose stop web
cd cv-web
npm ci
npm run dev
```

Vite использует тот же origin **127.0.0.1:5173**, callback остаётся серверным маршрутом `/api/auth/callback/keycloak`.
Единственная настройка прокси — `BFF_API_URL` в [.env.example](.env.example).
Адресов Keycloak и Python в настройках фронтенда нет.

## Сборка

```bash
npm run build
```

Результат — `dist/`. CI модуля проверяет TypeScript и сборку; CI корня проверяет полный Docker/BFF-поток.
[nginx.conf](nginx.conf) проксирует только Kotlin, не Python.
При смене публичного origin обновите `BFF_PUBLIC_URL` на сервере и разрешённые callback/logout URL клиента в Keycloak.

## Employee checkpoint

The «Пропускной пункт» panel supports employee enrollment, a paged directory, removal, and identification from a new photo.
Log in as `manager / manager123` to manage employees (ADMIN + USER), or `demo / demo123` to identify (USER).
Registration accepts employee code, full name, optional department and a JPEG/PNG/WEBP photo up to 10 MiB with exactly one face.
An employee in the business registry does not need a Keycloak account.

React sends all operations through the BFF using the existing HttpOnly session and CSRF protection. Face vectors and
source enrollment photos are not retained in browser storage. A match shows employee metadata and the cosine similarity;
unknown/ambiguous results show no selected identity. The interface explains that similarity is not a probability and that
this demo cannot verify liveness. Deleting a record also deletes its face template.
