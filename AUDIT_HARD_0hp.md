# Hard audit — LoveRussian — 4 ноя 2026 ~14:10 MSK (tag 0hp)

Вердикт: **не 10/10**. Честный балл **8.5 / 10** (после NL + login×50; soft AI шум остаётся).

Статика: `NIGHTLY_HARD_AUDIT_OK`, `HARD_AUDIT_0GC_OK` (local + VPS). Smokes: kaif / howlong / opsQuality / antistub / silence-night / heal-stub / sleep-media — OK.

Ultra: **8.7** (36/40). «P0 initData_auth_date» — **ложный**: окно ужесточено до 2ч (`7200`), regex аудита ждёт `86400`.

## Прод сейчас

| Зона | Факт |
|------|------|
| Хост | NL HOSTKEY `31.57.143.31`, tgbot online |
| Work PROXY | **14** |
| Login residential | **50 DC_OK** (20 NL sticky + 16 proxy-seller + 14×46.4) |
| miniapp / HTTPS | loverussian.duckdns.org |
| Ошибки | PEER_ID / FROZEN / REFUSE_PROXY — пусто в хвосте |
| Volume 24h | asst **140** / user **132**; stale unanswered 20м+ = **0** |

## Аккаунты / БД

15 total · 10 AI on · 14 session · archived 1139 · autoreply_off 77.

## AI / human live

- Ответы идут (Настя/Катя/Маша/Юля/Лиза).
- Media/voice outbound без leak-тегов (leaks 7d = 0).
- Soft: опечатка «поддеожка»; за 48ч кивки `ага)` / `ну да)` (2 за последние часы).
- Ultra: bare stubs since 1 ноя n=20; ultra-short 1–5 n=41 (P2).
- Theme check pink_purple — устарел (UI серый), не регресс.

## PROXY / login

Probe 70 → alive 66 DC_OK → written **50**. Work пул не трогали (PROXY=14 после restart).

## Баллы

| Зона | Балл |
|------|------|
| PM2 / NL хост | 9.5 |
| miniapp / HTTPS | 9 |
| Work PROXY | 8.5 |
| Login residential | **9.5** (было ~3) |
| AI wiring / smokes | 9 |
| AI/human live | 7.5 |
| Security (реал) | 9 (auth_date 2ч ок) |

## Что чинить дальше (не блокер)

1. Постфильтр опечаток / редких stub-кивков на вопросе.
2. Подтянуть regex ultra `auth_date` → `7200|86400`.
3. При росте аккаунтов — ещё work TG_OK (сейчас 14 хватает).
