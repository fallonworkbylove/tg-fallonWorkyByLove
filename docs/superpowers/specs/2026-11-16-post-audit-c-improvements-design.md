# Post Audit C — улучшения (дизайн)

Источник: хард жёсткий аудит C (2026-11-16, tag база 0li).  
Статус: **волна 1 в работе / 0lj** — A1→B1→C1→B3→D1.

## Вердикт аудита

- **AUDIT_C_OK**, P0=0, P1=2 (`hard_0ht` timeout 180s, `nightly` timeout 120s)
- Smokes 0li/0lh/0lg/0lf OK; wiring human/NFT/ops OK
- Security: getUserId без fallback 1, auth bypass loopback-only, CORS не `*`
- pm2 online, PROXY=14, deploy_guard OK, NFT stuck=0 / open_work=26 / stale_dialog=13
- Ultra P0_COUNT 0; hard_full «p0:1» — ложный (clearBusy/timeout-класс), реальных P0 нет
- Live: outbound media/voice живые; lagutin_art в логе — **до** 0li (сейчас probe: `При-вет🖖🏻` → `ну привет)`)

## Горячие зоны (Graphify + код)

`telegramClient` (proxy pool), `aiResponder`/`softHumanLite`/`replyPipeline`, `telegramAuth`, `nftCampaign`, `objectionHandler` (ты бот).

---

## A. Общение (reply quality)

### A1. Детектор «ты бот / поплыл» → короткий живой отпор (P0-путь quality)
Сейчас: «Чел, у тебя бот поплыл» → «хах, ну ок) просто я не бот, а Лер)» — признание темы + имя-штамп.  
Идея: postfilter в softHumanLite/objection: при accusation не повторять «не бот», не звать себя по имени; 4–6 alts вроде «хах ну ты чего)» / «живая, расслабься)» / «эм?)». Smoke + live на lagutin-класс.

### A2. Thread-aware «?» / one-word after miss
Если предыдущий ход бота уже «кривой» (день/посылка на привет) — голый `?` не чинить только day-talk, а мягко спросить «а ты про что?)» **и** не развивать фейковый день. Уже частично 0li; расширить на history[-1] assistant substance mismatch.

### A3. Anti-echo + persona preview в ops
Воркер видит «опять кайф / ну ок» → кнопка «бан фразы на 24ч» на аккаунт (уже есть phraseBanLimitFor) + лента последних 5 alts из softHumanLite для peer.

### A4. Heard A/B → auto-demote
Если peer отвечает односложно 3+ раза после определённого hint-класса — demote hint weight в finetune/rag для этого аккаунта.

---

## B. Проект / ops

### B1. Audit C runner стабильный
`_audit_c_full_now.sh`: LF-only; hard_0ht timeout → 300s или skip-under-load; nightly 180s; фильтр ложного P0 hard_full как сейчас. Cron раз в сутки → ADMIN_ALERT при P0≠0.

### B2. Graphify freshness gate
Индекс 11–12ч отстаёт → в deploy checklist: `graphify` reindex после 0gX или note «graph stale» в отчёте C. Иначе security-находки (старый `getUserId : 1` в routes) пугают зря.

### B3. NFT funnel board
В ops: stuck / stale_dialog / open_work / live90 — уже в БД; одна карточка + кнопка «expire stale сейчас». Не эссе в промпт.

### B4. Dual changelog без ручных забываний
Уже skill; добавить `_deploy_guard` check: `updates.js?v=` == top tag в CHANGELOG_TG.

---

## C. Защита

### C1. Единый getUserId — already OK
Локально lib без fallback; Graphify stale показывал старые inline `|| 1` в routes. Gate: grep CI `dbUser ? .* : 1` в routes/ = fail.

### C2. Session string at-rest
`accounts.session_string` plaintext → encrypt-at-rest (AES-GCM, key в env). Scope: write path saveSession + read path connect.

### C3. Rate-limit login / QR
startLogin / QR poll: per-user + per-IP (socket) лимиты; уже есть handoff — добавить hard 429.

### C4. InitData window
Уже 2ч; опционально sliding refresh из miniapp каждые 30м без re-login UX.

### C5. Probe scripts без dotenv
`_probe_*` / smoke на VPS без `.env` грузят proxy/openai шум и finetune Access denied — `DOTENV_CONFIG_QUIET` + skip finetune schema в smoke mode.

---

## D. Код

### D1. softHumanLite split
Файл ~1.2k строк: вынести greeting/slash/bareQ/botAccusation в `softHumanGates.js`; applySoftLite остаётся оркестратором. Smoke импортирует gates.

### D2. hard_0ht под нагрузкой
Таймауты/busy lock: clearBusy false-positive → P1. Либо audit mode `HARD_AUDIT_FAST=1` без live OpenAI, либо queue isolation.

### D3. aiResponder monolith
Postprocess уже вынесен; следующий срез — media client + transcription в `aiMedia.js` (Graphify hotspot untested).

### D4. Test links в Graphify
`applyAntiDetectStyle` / generateReply — 0 linked tests. Минимум: unit на antiDetect + softLite gates (уже smoke) → зарегистрировать в graphify_tests_for.

---

## Рекомендуемый порядок (1 волна)

1. **A1** bot-accusation postfilter (узкий, smoke, 0lj)  
2. **B1** audit runner timeouts + cron  
3. **C1** CI grep fallback-1  
4. **B3** NFT board numbers  
5. **D1** split softHuman gates (после A1)

Не трогать сразу: encrypt sessions (C2) — отдельный design+migration.

## Out of scope сейчас

Полный рефактор replyPipeline, смена модели, новые UI темы миниаппа.
