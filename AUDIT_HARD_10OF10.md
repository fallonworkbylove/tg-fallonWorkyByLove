# Hard absolute audit — LoveRussian — 3 ноя 2026 ~23:20 MSK

Вердикт: **не 10/10**. Честный балл **6.5 / 10** (инфра тянет вниз; код/гейты ок).

Статика: `NIGHTLY_HARD_AUDIT_OK` (VPS + local). Smokes: `SMOKE_KAIF_0HM_OK`, `SMOKE_FLIP_IDENTITY_KAIF_OK`, `SMOKE_10OF10_GATES_OK`.

## Прод сейчас

| Зона | Факт |
|------|------|
| tgbot | online, BYPASS=false, PROXY=14, uptime хоста 55д |
| miniapp / OPS | **200** |
| API без ключа | **401** |
| `api.telegram.org` | **TIMEOUT** — Bot API с этого IP мёртв |
| notifier | long polling `fetch failed` ×166+ |
| Google / обычный HTTPS | ок |

## PROXY

Пул 14; быстрый DC-probe: **TG_OK 7/14**.

TG_OK сейчас: `196.18.14.240`, `192.166.153.231`, `168.80.83.236`, `45.139.54.158`, `104.164.209.27`, `168.80.83.53`, `104.164.205.112`.

Остальные TG_FAIL — шум SocksClient в err.

Login residential (старый пул) — по-прежнему не для MTProto; новые NL sticky 212.80 — SOCKS handshake timeout без whitelist.

## AI / живые ответы

- Сегодняшний out тонкий: утро Настя + ночная тишина штатно; днём почти тишина после reconnect.
- В ротации (вчерашний хвост): Катя/Юля/Лиза/Маша отвечали.
- Заметки по качеству из хвоста: у Кати много эмодзи/флирта с Mrassers; опечатка «звкчит»; у Лизы голая `")"`.
- Анти-кайф smoke зелёный (0hm).

## БД

15 accounts · 10 AI вкл · 14 с session · archived_peers 1134 · autoreply_disabled 77.

## Сводка баллов


| Зона | Балл | Статус |
|------|------|--------|
| PM2 / хост | 9 | online, ресурсы свободны |
| miniapp / OPS | 9 | 200 / API 401 |
| Bot API / notifier | **2** | api.telegram.org недоступен |
| PROXY / Warm | 6.5 | 7/14 TG_OK |
| AI wiring / smokes | 9 | nightly + kaif + flip + gates OK |
| AI/human live | 7 | гейты ок; мало свежих реплик; лёгкий флирт/эхо-шум |
| Login residential | 3 | DC_DEAD / handshake |
| Аккаунты | 7.5 | 10 AR; 1 «Нужна авторизация» |


## CRITICAL / P1

1. **Переезд NL VPS** (или SOCKS специально для `BOT_TOKEN`) — иначе OPS-бот мёртв.
2. Ужать `PROXY_LIST` до **7 TG_OK**, выкинуть мёртвые.
3. После NL: QR через DC_OK / direct; SMS — только если появится residential с DC_OK.
4. Мягко: постфильтр на голый `")"` / опечатки; флирт-гейт у Кати.

## До 10/10

Живой Bot API · PROXY только Warm · стабильные сессии ≥ ожидаемых AR · свежие ответы без флирт-шума · login path с DC_OK.
