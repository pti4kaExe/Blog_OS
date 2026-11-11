# Безопасность BlogOS: что защищено и как это проверить

Документ для владельца: что уже сделано, как самостоятельно проверить защиту
(в том числе «попробовать сломать») и что осталось известным риском.

Проверки ниже — **только против своего стенда**. Ничего из этого не нужно
запускать против чужих сервисов.

---

## 1. Что защищено

| Угроза | Защита |
|---|---|
| Подделка сессии | JWT HS256 на 30 дней в `Authorization: Bearer`; алгоритм закреплён (`algorithms: ['HS256']`), подпись проверяется при каждом запросе, роль берётся из БД, а не из токена |
| Чужой ресурс по id (IDOR) | Все выборки идут через `own*`-хелперы с JOIN к владельцу; чужая запись отвечает `404`, а не `403` — существование не раскрывается |
| Вход через Telegram | HMAC-SHA256 `initData` с `timingSafeEqual`; webhook бота проверяет `X-Telegram-Bot-Api-Secret-Token` и без секрета отвечает `503` |
| Коды входа | 16 hex (2^64), TTL 5 минут, одноразовая выдача токена (`status='used'`), лимит 10 кодов/мин и 120 опросов/мин на IP |
| Брутфорс и флуд | Общий лимит 240 запросов/мин на IP (не считается только `/health`), отдельные лимиты на вход и сканирование, 10 AI-вызовов/мин на канал |
| Расход AI владельцем | У канала есть месячный лимит (по умолчанию 100 ₽, backfill миграцией 005), минутная квота вызовов, откат на правила при исчерпании |
| Инъекции SQL | Полная параметризация; динамические фрагменты — только имена колонок из фиксированных наборов |
| XSS | React без `dangerouslySetInnerHTML`; пользовательский текст нигде не вставляется как HTML |
| Утечка ключей площадок | Текст ошибки сканирования санитизируется перед сохранением и показом (`sanitizePlatformError`): query-параметры и токены вырезаются |
| Секреты в репозитории | `.env` не в индексе; в коде только `env`-переменные; ключи в логи не пишутся (`redact: authorization, cookie`) |
| Подмена IP в лимитах | Доверяем только ближайшему прокси (Render): подделанный `X-Forwarded-For` не меняет ключ лимита |
| Огромные запросы | Лимит тела 512 КБ; ошибка разбора тела отдаётся 4xx, а не 500 |
| Информация в ответах | `/health` отдаёт только статус, базу, версию и флаги входа; провайдеры моделей больше не раскрываются; стек и текст исключений наружу не уходят |
| Заголовки | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `permissions-policy`, `cross-origin-opener-policy`, HSTS в проде |
| CORS | Разрешён только список origin из `CORS_ORIGIN`; посторонний origin не получает `access-control-allow-origin` |
| Dev-вход | По умолчанию выключен; на проде сервис **не стартует** с `DEV_AUTH=1` (fail-closed) |
| Рендер клиента | ErrorBoundary: исключение показывает экран с объяснением и выходом, а не белый экран |
| Потеря кодов при деплое | Webhook больше не сбрасывает `drop_pending_updates` |

---

## 2. Как проверить (и «сломать»)

### 2.1. Подготовка

```bash
export API=https://blogos-api-shlm.onrender.com
```

### 2.2. Заголовки безопасности и CORS

```bash
curl -sI "$API/health?light=1" | grep -Ei 'x-content-type|x-frame|referrer|permissions|strict-transport'
# ожидание: nosniff, DENY, no-referrer, permissions-policy, HSTS

curl -s -D- -o /dev/null -H 'Origin: https://evil.example' "$API/health?light=1" \
  | grep -i access-control-allow-origin
# ожидание: пусто (заголовка нет)

curl -s -D- -o /dev/null -H 'Origin: https://pti4kaexe.github.io' "$API/health?light=1" \
  | grep -i access-control-allow-origin
# ожидание: access-control-allow-origin: https://pti4kaexe.github.io
```

### 2.3. Обход лимита поддельным X-Forwarded-For

```bash
for i in $(seq 1 15); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST "$API/auth/telegram/start" \
    -H 'content-type: application/json' -H "X-Forwarded-For: 10.0.0.$i" -d '{}'
done; echo
# ожидание: после 10 подряд идёт 429 — заголовок не меняет ключ лимита
```

### 2.4. Dev-вход выключен

```bash
curl -s -X POST "$API/auth/telegram" -H 'content-type: application/json' \
  -d '{"telegram_id":200600,"name":"тест"}'
# ожидание: 400 dev_auth_disabled
```

### 2.5. Токен не подделать

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer fake.token.value' "$API/users/me"
# ожидание: 401
```

### 2.6. IDOR (чужой канал)

С двумя аккаунтами A и B:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN_A" \
  "$API/author-profiles/$ID_B"
# ожидание: 404 — существование чужой записи не подтверждается
```

### 2.7. Одноразовость кода входа

1. `POST /auth/telegram/start` → код и ссылка на бота.
2. Нажать Start в боте.
3. `GET /auth/telegram/status?code=…` → `confirmed` + `token`.
4. Повторить тот же запрос → ожидание: `status: "used"` **без токена**.

### 2.8. Ограничение на размер тела

```bash
python -c "print('{\"telegram_id\":1,\"name\":\"' + 'x'*600000 + '\"}')" > /tmp/big.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/auth/telegram" \
  -H 'content-type: application/json' --data-binary @/tmp/big.json
# ожидание: 413 (или 400), но не 200
```

### 2.9. Расход AI ограничен

С токеном: 15 раз подряд вызвать `POST /author-profiles/{id}/tov/analyze`.
Ожидание: после 10-го в минуту — `429 rate_limited` (или `402`, если месячный
лимит исчерпан). Раньше лимита по умолчанию не было вообще.

### 2.10. Секрет площадки не утекает

Создать источник Instagram/YouTube с настроенным ключом и битой ссылкой,
затем `GET /sources/{id}`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/sources/$ID" | grep -Ei 'access_token|key='
# ожидание: пусто — текст ошибки санитизирован
```

### 2.11. Что осталось известным риском (честно)

| Риск | Почему | Что делать |
|---|---|---|
| **Login CSRF через бота** | Атакующий может отправить жертве ссылку `t.me/<бот>?start=login_<код>` и получить токен её аккаунта, если жертва нажмёт Start. TTL 5 мин и одноразовость сужают окно, но не убирают | Правильное лечение — код подтверждения, который бот показывает, а сайт требует ввести. Записано в дорожную карту |
| JWT не отзывается | Нет таблицы сессий; отзыв = смена `JWT_SECRET` (разлогинит всех) | Сократить TTL до 7 дней и добавить `token_version` в users (нужна миграция) |
| Проверка TLS к Neon выключена | `DB_SSL_VERIFY=false` по умолчанию: чтобы не уронить прод при неполной цепочке | Включить `DB_SSL_VERIFY=1` после проверки цепочки на своём окружении |
| CSP на сайте | GitHub Pages не умеет заголовки; meta-CSP ограничен (нужен `unsafe-inline` для инлайн-стилей) | Перенос на хостинг с заголовками или хеширование стилей |
| Лимитер в памяти | Сбрасывается при рестарте; Redis необязателен | На бесплатном тарифе — приемлемо, для продакшена — Redis |
| Один ключ LLM/площадок на инсталляцию | При утечке нужна ротация | Ротировать ключи в Render, `TELEGRAM_BOT_TOKEN` — через BotFather `/revoke` |

---

## 3. Чек-лист перед показом

- [ ] `DEV_AUTH=0` в переменных Render (и сервис стартует — значит fail-closed сработал)
- [ ] `CORS_ORIGIN` содержит только адрес клиента
- [ ] `TELEGRAM_WEBHOOK_SECRET` задан, `getWebhookInfo` без ошибок
- [ ] `JWT_SECRET` ≥ 32 случайных символов
- [ ] Ключи площадок (если заданы) не появляются в `last_scan_error`
- [ ] Логи Render не содержат заголовков `Authorization` и query-кодов
