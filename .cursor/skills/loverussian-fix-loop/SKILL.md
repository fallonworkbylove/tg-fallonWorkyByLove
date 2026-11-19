---
name: loverussian-fix-loop
description: >-
  Default fast fix loop for LoveRussian tgbot: classify, narrow patch, smoke,
  changelog (miniapp+ops+CHANGELOG_TG), deploy 0gX, PROXY≥5. Use on any bugfix,
  reply fix, ship, выкат, or when user says просто пофикси / сделай / выкати.
---

# LoveRussian fix loop

Один проход, без пауз на «а changelog?».

## 1. Класс
Скрин/лог → при сомнении **loverussian-reply-triage**. Echo/кайф/клише → **loverussian-phrase-bank**. Login QR/SMS proxy → **loverussian-login-proxy**. Иначе сразу код.

## 2. Патч
- Узко: `humanRhythm` / `humanHardening` / `humanIdeas10` / `objectionHandler` / `memoryTriggers` / `replyPipeline`
- Не раздувать промпт анкеты
- Полный рабочий код, без TODO «потом»

## 3. Smoke
`backend/scripts/_smoke_<topic>_0gX.js` — детерминированные `OK`/`FAIL`.  
Трогал howLong / replyPipeline / leadScoring → smoke обязателен до restart.

## 4. Changelog (всегда)
| Файл | Действие |
|------|----------|
| `frontend/updates.js` | запись сверху, язык воркера |
| `ops-console/app/updates.js` | тот же текст |
| `frontend/index.html` | `updates.js?v=N+1` |
| `CHANGELOG_TG.md` | `## 0gX. …` сверху |

Тег = следующий после последнего в `CHANGELOG_TG.md`.

## 5. Deploy
Следуй **loverussian-deploy** + **loverussian-proxy-alive**:
- scp → `/tmp/0gX` → `_deploy_0gX.sh`
- smoke на VPS → `pm2 restart tgbot --update-env` → `pm2 save`
- `pm2_PROXY_LEN ≥ 5` иначе REFUSE и restore alive pool

## 6. Post-add audit (обязательно)
Следуй **loverussian-post-add-audit**: класс A / B / C по сложности → прогон.
Без аудита не писать «готово» / «задеплоено».

## 7. Отчёт пользователю (3–5 строк)
- что починил
- tag `0gX` / `v=`
- proxy ok
- уровень аудита + OK/дыры
- без чеклиста «не забудь ленту»
