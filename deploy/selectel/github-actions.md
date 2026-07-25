# Автоматический деплой из GitHub

Workflow [`.github/workflows/deploy-selectel.yml`](../../.github/workflows/deploy-selectel.yml)
запускается после каждого `push` в `codex-local-work`; также его можно запустить вручную на
вкладке **Actions** в GitHub. Он передаёт исходники на сервер по SSH и выполняет
`docker compose ... up -d --build`. Git на production-сервере не требуется.

## Однократная настройка

В GitHub откройте **Settings → Environments → New environment** и создайте
окружение `production`. В нём добавьте secrets:

| Secret | Значение |
| --- | --- |
| `DEPLOY_HOST` | IP-адрес или доменное имя сервера Selectel. |
| `DEPLOY_USER` | Пользователь, под которым на сервере запускается Docker. |
| `DEPLOY_PATH` | Абсолютный путь к клону проекта на сервере, например `/opt/vin-oil-mann`. |
| `DEPLOY_SSH_KEY` | Закрытая часть отдельного SSH-ключа для GitHub Actions. Публичную часть добавьте в `~/.ssh/authorized_keys` пользователя сервера. |
| `DEPLOY_KNOWN_HOSTS` | Строка из `ssh-keyscan -H <DEPLOY_HOST>` — фиксирует SSH-ключ сервера и защищает деплой от подмены хоста. |

Ключ должен быть отдельным от личного. Создать его можно локально:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/vin-oil-mann-github-actions -C github-actions-vin-oil-mann
```

На сервер нужно добавить содержимое файла с суффиксом `.pub` в
`~/.ssh/authorized_keys` пользователя `DEPLOY_USER`. Закрытую часть ключа
добавьте в GitHub как `DEPLOY_SSH_KEY`.

## Требования на сервере

В `DEPLOY_PATH` должна находиться папка приложения, а файл `.env.production`
должен уже находиться рядом с `docker-compose.selectel.yml`. Workflow сохраняет
этот файл при синхронизации. Git и доступ сервера к GitHub не требуются.

Проверить руками перед первым автодеплоем:

```bash
cd /путь/к/проекту
docker compose -f docker-compose.selectel.yml up -d --build
```

После сохранения secrets отправьте тестовый коммит в `codex-local-work` или в GitHub
откройте **Actions → Deploy to Selectel → Run workflow**.
