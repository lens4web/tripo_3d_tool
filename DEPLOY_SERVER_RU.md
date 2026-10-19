# Ubuntu 24.04: размещение tripo3d.lens4web.com

Инструкция подготовлена по отчёту от 4 октября 2026 года: Node.js 22 в `/usr/bin/node`, nginx включает `/etc/nginx/sites-enabled/*` внутри `http {}`, порты 3000–3003 заняты. Для Tripo используем **127.0.0.1:3010** и отдельную службу systemd. Обновление системного Node.js не требуется. Docker, GPU и база данных не нужны.

**Выполняйте шаги последовательно. При ошибке остановитесь и пришлите вывод.** Команды начальной установки прерываются, если каталог или конфигурация Tripo уже существуют. Команды на сервере выполняются вашим обычным пользователем с sudo.

## 1. Cloudflare и передача архива

| Поле | Значение |
|---|---|
| Тип записи | A |
| Имя | tripo3d |
| Значение | IPv4 сервера (DNS в отчёте: 45.148.31.35) |
| Proxy status | DNS only, серое облако |
| TTL | Auto |

Сверьте IPv4 с панелью провайдера. Добавляйте AAAA только при подтверждённом IPv6 этого сервера. Для DNS only HTTPS завершается на nginx с сертификатом Let's Encrypt; режим SSL/TLS всей зоны Cloudflare менять не требуется.

Для последующего включения Proxied сначала настройте доверенные IP Cloudflare и восстановление IP посетителя в nginx: ограничения запросов сейчас рассчитаны на прямое подключение. Proxied требует Full (strict) с действующим сертификатом origin. Общие настройки зоны затрагивают другие сайты.

На Mac передайте **новый архив**, содержащий `deploy/ubuntu24/`, в домашнюю папку пользователя сервера:

```sh
scp /Users/sqmi/Documents/antigravity/gallant-mendeleev/dist/tripo3d-deploy.zip \
    YOUR_SSH_USER@YOUR_SERVER_IP:tripo3d-deploy.zip
```

В сообщении чата приведена команда с вашим SSH-пользователем и адресом. Далее работайте в SSH на сервере.

## 2. Проверки, резервная копия и установка

Блок запускается в отдельном Bash с остановкой на ошибке. Архив ожидается в домашней папке текущего пользователя.

```bash
bash <<'SH'
set -euo pipefail
sudo -v
test -f "$HOME/tripo3d-deploy.zip"
test -x /usr/bin/node
/usr/bin/node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
test ! -e /opt/tripo3d
test ! -e /etc/nginx/sites-enabled/tripo3d.lens4web.com
test ! -L /etc/nginx/sites-enabled/tripo3d.lens4web.com
test ! -e /etc/systemd/system/tripo3d.service
if sudo ss -ltnH 'sport = :3010' | grep -q .; then
    echo 'Порт 3010 занят. Остановитесь и пришлите вывод ss.' >&2
    exit 1
fi
if sudo nginx -T 2>/dev/null | grep -E '^[[:space:]]*server_name[[:space:]][^;]*tripo3d[.]lens4web[.]com([[:space:];]|$)' >/dev/null; then
    echo 'Для поддомена уже есть конфигурация. Остановитесь и пришлите её.' >&2
    exit 1
fi
sudo nginx -t
sudo install -d -m 0700 /root/tripo3d-backups
sudo tar -czf "/root/tripo3d-backups/nginx-$(date +%Y%m%d-%H%M%S).tar.gz" -C /etc nginx
if ! getent passwd tripo3d >/dev/null; then
    sudo useradd --system --user-group --home-dir /opt/tripo3d --shell /usr/sbin/nologin tripo3d
fi
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 /opt/tripo3d
python3 -m zipfile -e "$HOME/tripo3d-deploy.zip" /opt/tripo3d
test -f /opt/tripo3d/deploy/ubuntu24/nginx-https.conf
cd /opt/tripo3d
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sudo chown -R root:tripo3d /opt/tripo3d
sudo find /opt/tripo3d -type d -exec chmod 0750 {} +
sudo find /opt/tripo3d -type f -exec chmod 0640 {} +
echo 'Файлы установлены.'
SH
```

API-ключи в файлы не добавляются. При перезапуске приложения серверные сессии удаляются.

## 3. Запуск systemd

```bash
bash <<'SH'
set -euo pipefail
sudo install -o root -g root -m 0600 /opt/tripo3d/deploy/ubuntu24/tripo3d.env /etc/tripo3d.env
sudo install -o root -g root -m 0644 /opt/tripo3d/deploy/ubuntu24/tripo3d.service /etc/systemd/system/tripo3d.service
sudo systemctl daemon-reload
sudo systemctl enable --now tripo3d.service
sleep 2
sudo systemctl is-active tripo3d.service
curl --fail --silent --show-error http://127.0.0.1:3010/healthz
SH
```

Ожидаются `active` и `{"status":"ok"}`. Порог памяти 256 МБ, жёсткий предел 384 МБ; swap для службы отключён, V8 heap ограничен 192 МБ. Это ограничения, а не прогноз потребления. При нехватке памяти процесс может быть завершён и перезапущен с потерей сессий. Для роста нагрузки потребуется пересмотр бюджета сервера.

## 4. HTTP для проверки домена

```bash
bash <<'SH'
set -euo pipefail
sudo install -d -m 0755 /var/www/tripo3d-acme/.well-known/acme-challenge
printf 'tripo3d-acme-ok\n' | sudo tee /var/www/tripo3d-acme/.well-known/acme-challenge/probe.txt >/dev/null
sudo install -o root -g root -m 0644 /opt/tripo3d/deploy/ubuntu24/nginx-http.conf /etc/nginx/sites-enabled/tripo3d.lens4web.com
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error --max-time 15 http://tripo3d.lens4web.com/.well-known/acme-challenge/probe.txt
SH
```

Ожидается `tripo3d-acme-ok`. Остальные URL нового поддомена пока возвращают 503. Проверьте probe также с Mac:

```sh
curl -fsS --max-time 15 http://tripo3d.lens4web.com/.well-known/acme-challenge/probe.txt
```

Не запускайте Certbot, пока probe не открывается извне. HTTP-01 требует доступного порта 80. Каждый reload nginx выполняется после `nginx -t`.

## 5. Сертификат и HTTPS

На сервере:

```bash
sudo /usr/bin/certbot certonly \
    --webroot --webroot-path /var/www/tripo3d-acme \
    --cert-name tripo3d.lens4web.com \
    --domain tripo3d.lens4web.com \
    --no-directory-hooks \
    --deploy-hook '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'
```

Если Certbot спрашивает email или условия, ответьте в терминале. После успешного выпуска выполните:

```bash
bash <<'SH'
set -euo pipefail
sudo test -s /etc/letsencrypt/live/tripo3d.lens4web.com/fullchain.pem
sudo test -s /etc/letsencrypt/live/tripo3d.lens4web.com/privkey.pem
sudo install -o root -g root -m 0644 /opt/tripo3d/deploy/ubuntu24/nginx-https.conf /etc/nginx/sites-enabled/tripo3d.lens4web.com
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error https://tripo3d.lens4web.com/healthz
SH
```

Используется `certonly --webroot`, без installer для редактирования nginx. Новый HTTPS-блок: порт 3010, лимит загрузок 21 МБ (переопределяет глобальные 12 МБ), таймауты Tripo, proxy cache off, передача cookie и ограничения запросов. Проверка TLS выполняется без `curl -k`.

## 6. Продление сертификата и итоговая проверка

Проверка только нового сертификата:

```bash
sudo /usr/bin/certbot renew \
    --cert-name tripo3d.lens4web.com --dry-run --no-directory-hooks \
    --deploy-hook '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'
```

После успешной проверки установите таймер для сертификата Tripo, два раза в сутки с задержкой до 30 минут:

```bash
bash <<'SH'
set -euo pipefail
sudo install -o root -g root -m 0644 /opt/tripo3d/deploy/ubuntu24/tripo3d-cert-renew.service /etc/systemd/system/tripo3d-cert-renew.service
sudo install -o root -g root -m 0644 /opt/tripo3d/deploy/ubuntu24/tripo3d-cert-renew.timer /etc/systemd/system/tripo3d-cert-renew.timer
sudo systemctl daemon-reload
sudo systemctl enable --now tripo3d-cert-renew.timer
sudo systemctl list-timers tripo3d-cert-renew.timer --no-pager
curl --fail --silent --show-error https://tripo3d.lens4web.com/api/session
curl --fail --silent --show-error 'https://tripo3d.lens4web.com/?lang=ru' -o /dev/null
curl --fail --silent --show-error https://tripo3d.lens4web.com/sitemap.xml
SH
```

API без ключа возвращает `{"code":0,"data":{"connected":false}}`. Откройте сайт с Mac, примените свой ключ и проверьте индикатор; Disconnect должен вернуть красный цвет. Генерация расходует кредиты Tripo и запускается вами отдельно.

Уже существующие таймеры Certbot могут продолжать работать. При совпадении запусков Certbot использует блокировку; ошибку занятого lock следует проверить в журнале. Deploy hook сохранён при выпуске, поэтому nginx получает обновлённый сертификат и при продлении существующим таймером.

Фактические ресурсы и адрес слушателя:

```bash
sudo systemctl status tripo3d.service --no-pager
sudo systemctl show tripo3d.service -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax -p MemorySwapMax -p NRestarts
sudo ss -ltnp 'sport = :3010'
free -h
```

Должен слушаться только `127.0.0.1:3010`. Порт 3010 не требуется открывать в firewall. Ключи хранятся только в памяти процесса: час бездействия, максимум четыре часа; браузер получает случайный идентификатор сессии в защищённой cookie.

## 7. Диагностика и отключение

При ошибке пришлите номер шага, его вывод и:

```bash
sudo systemctl status tripo3d.service --no-pager
sudo journalctl -u tripo3d.service -n 60 --no-pager
sudo nginx -t
```

Перед отправкой журналов скройте секреты и подписанные ссылки, если они встретятся. API-ключи и приватные сертификаты присылать не нужно.

В исходном отчёте `certbot.service` имеет статус failed, а сертификат `dmz23.com` просрочен. Отчёт не устанавливает причину сбоя Certbot. Для выяснения:

```bash
sudo systemctl status certbot.service certbot.timer --no-pager
sudo journalctl -u certbot.service -n 60 --no-pager
```

Отключение нового сайта с сохранением файлов:

```bash
bash <<'SH'
set -euo pipefail
sudo install -d -m 0700 /root/tripo3d-backups
sudo mv /etc/nginx/sites-enabled/tripo3d.lens4web.com "/root/tripo3d-backups/tripo3d-disabled-$(date +%Y%m%d-%H%M%S).conf"
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl disable --now tripo3d.service tripo3d-cert-renew.timer
SH
```

Для обновления сначала сохраните `/opt/tripo3d` в закрытом каталоге резервных копий. Остановите `tripo3d.service`, установите новую версию в staging-каталог, выполните `npm ci --omit=dev --ignore-scripts`, восстановите права root:tripo3d и замените каталог. Конфигурации в `/etc` автоматически не перезаписываются. Под конкретную версию подготовьте отдельный план обновления.

## Источники и пределы проверки

Конфигурации подготовлены по отчёту; на удалённом сервере команды автором изменений не запускались. Фактические `nginx -t`, проверка сертификата, запуск systemd и измерение памяти выполняются шагами выше. Тяжёлая генерация выполняется Tripo, а ваш сервер передаёт запросы и файлы. Приложение постоянно не сохраняет модели; nginx может временно буферизовать загрузки на диске.

- [Certbot: webroot и продление](https://eff-certbot.readthedocs.io/en/stable/using.html)
- [Cloudflare: DNS only и Proxied](https://developers.cloudflare.com/dns/proxy-status/)
- [Cloudflare: Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [Node.js: выпуски](https://nodejs.org/en/about/previous-releases)
