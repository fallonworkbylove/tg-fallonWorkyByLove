---
name: loverussian-post-add-audit
description: >-
  After any LoveRussian code/feature add or deploy, pick and run audit /
  hard audit / hard жесткий audit by change complexity. Use after patch,
  ship, выкат, «добавил», new postfilter/hint/gate/UI/route, or when
  loverussian-fix-loop finishes a change. Gate: do not call done without
  the matching audit level.
---

# LoveRussian post-add audit

**Обязательно** после любого добавления / фикса / выката. Без аудита релиз не «готово».

Не спрашивай «прогнать аудит?». Классифицируй сложность → прогони уровень → короткий отчёт.

## 1. Класс сложности

Смотри **что тронул**, не как назвал задачу.

| Уровень | Когда | Примеры |
|---------|--------|---------|
| **A · аудит** | Узкий постфильтр / 1–2 строки / копипаста alts / changelog-only с бампом v= | `softenMoveTiming`, замена фразы, bump `updates.js` |
| **B · хард аудит** | Новый gate/hint, wiring 2+ сервисов, reply path, persona/prompt, media/NFT day, scaleOps hook | softHumanLite + scaleOps, nftCampaign day hint, howLong/flip/kaif |
| **C · хард жёсткий** | Новый модуль/роут/UI поток, auth/proxy/pipeline, многофайловый рефактор, «идея масштаба», security-adjacent | accounts API, telegramAuth, replyPipeline ядро, busy/waves/throttle, login proxy |

**Апгрейд вверх при сомнении.** Один P0-путь (howLong, flip, PROXY, auth) → минимум **B**, лучше **C**.

## 2. Что гонять

### A · аудит
1. Smoke затронутого: `node backend/scripts/_smoke_<topic>_0gX.js` (или ближайший `_smoke_*.js` к модулю).
2. Статика: `grep`/чтение — новый символ реально вызван из pipeline (не мёртвый export).
3. Если был deploy: `pm2` online + **PROXY ≥ 5** (skill **loverussian-proxy-alive**).

### B · хард аудит
Всё из **A**, плюс:
1. `node backend/scripts/_hard_audit_0ht.js` (или свежий `_hard_audit_0g*.js` под тег).
2. Чеклист из **loverussian-human-audit** (howlong / flip / kaif / quiet / phrase).
3. Live на VPS (после deploy):

```bash
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out*.log | tail -30
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -20
```

### C · хард жёсткий
Всё из **B**, плюс:
1. `node backend/scripts/_hard_audit_full_0ht.js` (полный: smokes + wiring + P0/P1).
2. По возможности `node backend/scripts/_ultra_hard_audit.js` (нужен `.env`/DB; на VPS предпочтительнее).
3. Live DB/logs окна если трогали reply quality / отсев / media (см. `_live_audit_0h*.sh`, `_nightly_hard_audit.js`).
4. Регресс-гейты: auth bypass false, getUserId без fallback `1`, CORS не `*`.

Exit ≠ 0 на P0 → **чинить сразу**, не писать «готово». Soft/P1 — в отчёт одной строкой.

## 3. Когда в цикле

Встраивается в **loverussian-fix-loop** после smoke, **до или сразу после** deploy:

```
патч → smoke → changelog → deploy → PROXY≥5 → POST-ADD AUDIT (A/B/C) → отчёт
```

Локальный-only патч без выката: audit всё равно (хотя бы A/B локально). Deploy без audit = не закрыто.

## 4. Отчёт (2–4 строки)

```
аудит: A|B|C
скрипты: … OK/FAIL
дыры: нет | P0 … (фиксим)
proxy/online: …
```

Без простыни. Без «не забудь прогнать ещё раз».

## 5. Не делать

- Не пропускать audit потому что «мелкий фикс» — мелкий = уровень **A**, не ноль.
- Не подменять C уровнем A при касании pipeline/auth/proxy.
- Не звать «хард» без прогона скрипта (только глазами по коду = недостаточно для B/C).

## Связанные skills

- **loverussian-human-audit** — чеклист human-багов + live greps (часть B/C)
- **loverussian-fix-loop** — вызывает этот скилл после добавления
- **loverussian-deploy** / **loverussian-proxy-alive** — выкат и PROXY gate
