# manul-server — бэк для игры «Манул: Зажировка»

Go-сервис: отдаёт статику игры, хранит уровни в SQLite, конструктор `/admin/`
с логин-паролем. Паттерны — как у `file-service-go` (ServeMux, JSON-ошибки,
`-healthcheck`, graceful shutdown, scratch-образ).

## API

| Метод | Путь | Auth | Описание |
|---|---|---|---|
| `GET` | `/healthz` | — | `{"status":"ok","levels":N,"published":M}` |
| `GET` | `/api/levels` | — | только `published`, по `ord` (это ест игра) |
| `GET` | `/api/levels/{id\|slug}` | — | один опубликованный |
| `POST` | `/api/admin/login` | — | `{login,password}` → cookie `manul_admin` |
| `POST` | `/api/admin/logout` | сессия | стереть cookie |
| `GET` | `/api/admin/me` | сессия | кто вошёл |
| `GET` | `/api/admin/levels` | сессия | все, включая `draft` |
| `POST` | `/api/admin/levels` | сессия | создать (`422` + `details` при ошибках карты) |
| `GET` | `/api/admin/levels/{id}` | сессия | один любой (это грузит тест-драфт `?draft=`) |
| `PUT` | `/api/admin/levels/{id}` | сессия | перезаписать |
| `DELETE` | `/api/admin/levels/{id}` | сессия | удалить |

Уровень: `{id,slug,name,ord,status,pits,map}` — 1-в-1 с объектом `LEVELS`
в `main.js` + метаданные. Геометрия рисуется напрямую (пропасти = пустота
в рядах 12+); в хранилище `pits` всегда `[]`, на входе принимается как хелпер
и запекается в карту. Таблица `scores` в схеме — заготовка под рекорды.

## Конфиг (env)

| Переменная | Дефолт | Описание |
|---|---|---|
| `PORT` | `8080` | порт |
| `DATA_DIR` | `./data` (в образе `/data`) | каталог `manul.db` |
| `WEBROOT` | `..` (в образе `/www`) | статика игры + `admin/` |
| `ADMIN_LOGIN` | `admin` | логин |
| `ADMIN_PASSWORD_HASH` | — | bcrypt-хеш; пусто = админка выключена (403) |
| `SESSION_SECRET` | — | секрет подписи cookie; пусто = эфемерный на 1 запуск |

Хеш пароля: `go run . -hashpass 'секрет'` (осторожно с историей shell).

## Запуск

```bash
# локально (нужен Go 1.24+, toolchain 1.26 ок)
cd manul-forest/server
go run .                                    # игра: http://127.0.0.1:8080/
ADMIN_PASSWORD_HASH=$(go run . -hashpass 'секрет') SESSION_SECRET=x go run .

# docker (контекст — корень manul-forest/)
cd manul-forest && docker build -t manul-game -f Dockerfile .
mkdir -p /srv/manul && chown 65532:65532 /srv/manul
docker run -d --name manul-game -p 127.0.0.1:8060:8080 \
  -v /srv/manul:/data -e ADMIN_LOGIN=admin \
  -e ADMIN_PASSWORD_HASH='...' -e SESSION_SECRET='...' manul-game
```

Проверка: `go vet ./...`, `go test ./...` (seed проходит собственную
валидацию), `node --check ../main.js`, `node ../test_headless.js`,
`node ../test_bots.js`.

## Nginx (прод)

Сейчас `game.zenai.space` — статика из `/var/www/game.zenai.space`.
После проверки контейнер становится источником:

```nginx
server {
    server_name game.zenai.space;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:8060;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # listen 443 ssl ... (certbot — не трогать)
}
```

`/` — обычная игра (уровни из `/api/levels`), `/admin/` — конструктор,
`/?draft=<id>` — тест-драфт (нужна сессия админа). Каталог
`/var/www/game.zenai.space` оставить как холодный откат.
