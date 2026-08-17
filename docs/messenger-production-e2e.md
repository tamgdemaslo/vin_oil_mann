# Messenger production E2E

## Timeweb App Platform env

Добавить в переменные web-сервиса Timeweb App Platform:

```env
MESSENGER_STORAGE_ENABLED=true
MESSENGER_STORAGE_ENDPOINT=https://<s3-or-r2-endpoint>
MESSENGER_STORAGE_REGION=auto
MESSENGER_STORAGE_BUCKET=<private-bucket-name>
MESSENGER_STORAGE_ACCESS_KEY_ID=<access-key-id>
MESSENGER_STORAGE_SECRET_ACCESS_KEY=<secret-access-key>
MESSENGER_STORAGE_PUBLIC_BASE_URL=
MESSENGER_STORAGE_FORCE_PATH_STYLE=true
```

Telegram worker является opt-in и запускается только при
`TELEGRAM_SYNC_WORKER_ENABLED=1`. Серверный GramJS по умолчанию использует штатный
MTProto TCP на порту 443. DB-lease не даёт двум репликам одновременно
синхронизировать один аккаунт, а после транспортной ошибки оставляет общую паузу.

Базовая конфигурация:

```env
TELEGRAM_SYNC_WORKER_ENABLED=1
TELEGRAM_TRANSPORT=tcp
TELEGRAM_CONNECT_TIMEOUT_MS=10000
TELEGRAM_CONNECTION_RETRIES=1
TELEGRAM_SYNC_MAX_BACKOFF_MS=21600000
TELEGRAM_SYNC_WORKER_LEASE_MS=1800000
TELEGRAM_SYNC_FAILURE_LOG_INTERVAL_MS=3600000
TELEGRAM_GRAMJS_LOG_LEVEL=none
```

Если прямой TCP из App Platform недоступен, настройте выделенный SOCKS5 proxy
(при наличии proxy транспорт автоматически остаётся TCP):

```env
TELEGRAM_PROXY_HOST=<proxy-host>
TELEGRAM_PROXY_PORT=<proxy-port>
TELEGRAM_PROXY_SOCKS_TYPE=5
TELEGRAM_PROXY_USERNAME=<optional-user>
TELEGRAM_PROXY_PASSWORD=<optional-password>
```

Опционально:

```env
MESSENGER_AUTO_DOWNLOAD_IMAGE_MAX_MB=15
MESSENGER_AUTO_DOWNLOAD_FILE_MAX_MB=25
MESSENGER_UPLOAD_MAX_MB=20
MESSENGER_MEDIA_WORKER_INTERVAL_MS=15000
MESSENGER_MEDIA_WORKER_LIMIT=5
MESSENGER_MEDIA_IN_PROCESS_WORKER=true
```

`MESSENGER_STORAGE_PUBLIC_BASE_URL` оставлять пустым для приватного bucket: файлы будут отдаваться через backend proxy. Если используется Cloudflare R2 или MinIO, обычно нужен `MESSENGER_STORAGE_FORCE_PATH_STYLE=true`. Для AWS S3 virtual-hosted style можно поставить `false`.

## Проверка после redeploy

1. Открыть `/cabinet/integrations/messenger`.
2. Нажать `Проверить storage`: должен пройти реальный PUT/GET/DELETE probe.
3. Отправить фото в рабочий Telegram-аккаунт, запустить синхронизацию и убедиться, что фото видно в `/messages`.
4. Отправить фото из `/messages` в Telegram и проверить доставку в Telegram.
5. Отправить PDF из `/messages` и проверить доставку/открытие.
6. Нажать `Запустить backfill`, затем обновить статус: очередь должна уйти к `0`, ошибок быть не должно.

Первый вариант thumbnail для фото использует тот же object storage key, что и оригинал. Отдельный resize-worker можно добавить следующим проходом.
