# clck.plus — короткие ссылки анкет

При сохранении анкеты API сам создаёт slug (`alina23msk`) и короткую ссылку в [Кликер Плюс](https://clck.plus/).

## 1. Аккаунт

1. Зарегистрируйся на https://clck.plus/
2. В кабинете: **Настройки → API** — скопируй API-ключ
3. Подключи домен (бесплатно 1 домен) или используй домен сервиса
4. Узнай ID домена: `GET https://clck.plus/api/v1/domains` с Bearer-ключом  
   либо после деплоя открой в Mini App / curl:  
   `https://loverussian.duckdns.org/api.php?action=clck_status` (нужна авторизация воркера)

## 2. `.env` на сервере

В файл `backend/.env` добавь:

```env
CLCK_PLUS_API_KEY=твой_ключ
CLCK_PLUS_DOMAIN_ID=1
CLCK_PLUS_DOMAIN_HOST=clck.plus
LANDING_PUBLIC_BASE=https://loverussian.duckdns.org
```

- `CLCK_PLUS_DOMAIN_HOST` — хост, который виден в короткой ссылке (`clck.plus` или свой `go.example.ru`)
- `LANDING_PUBLIC_BASE` — куда редиректит шорт (твой лендинг)

## 3. После pull

Колонки `slug` / `short_url` / `clck_link_id` добавятся сами при первом запросе к `api.php`.

Старые анкеты: кнопка **«Обновить ссылку»** в Mini App → вкладка Анкеты.
