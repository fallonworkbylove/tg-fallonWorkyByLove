---
name: loverussian-reply-triage
description: >-
  Triage bad LoveRussian bot replies from screenshot and/or VPS logs: classify
  bug type, find code path, propose/fix with smoke. Use when user or worker
  sends a dumb reply, скрин ответа, тупой ответ, мимо темы, echo, wrong NFT,
  «это я» on flip, or asks разобрать ответ / triage reply.
---

# LoveRussian reply triage

## Input
- Screenshot and/or paste: what **he** wrote → what **she** answered.
- Optional: account name/phone, peer username, approximate time MSK.

## Classify (pick 1–2)
| Class | Smell |
|-------|--------|
| `echo` | same phrase / «поняла хах» / kaif loop |
| `offtopic` | ignores his topic, anketa, coffee+series+walk |
| `memory` | invents city/pet/job not in card; should «забыла) напомни» |
| `flip_id` | «это я» / beard on **his** flip screen |
| `nft_early` | flip/NFT day-1 or cold lead / after «потом» |
| `howlong` | age/учёба treated as DV stay; no archive ≥21д |
| `timing` | false quiet daytime; instant bot-typing; no lag when needed |
| `leak` | assistant instructions / media tag / EN office tone in chat |
| `other` | say what |

## Gather evidence
1. If time known — VPS logs:

```bash
grep -aE 'Ответ для|Пауза|outbound ' /root/.pm2/logs/tgbot-out.log | tail -80
grep -aE 'OPENAI|TypeError|is not defined|FROZEN' /root/.pm2/logs/tgbot-error.log | tail -30
```

2. Match account label + peer snippet to the bad line.
3. Trace likely module: `replyPipeline` → `humanHardening` / `humanRhythm` / `humanIdeas10` / `objectionHandler` / `jobFlipAsk` / `voiceReplies` / `memoryTriggers` / `softHumanLite`.

## Fix path
1. Prefer **narrow** postfilter or hint over prompt essay.
2. Add/extend `_smoke_*.js` for the class (deterministic assert).
3. If ship: follow **loverussian-deploy** (changelog miniapp+ops, tag `0gX`, PROXY≥5).
4. If only triage: report without deploy.

## Report (operator Russian, short)
- Класс:
- Что сломано:
- Где в коде:
- Фикс / не фикс:
- Выкат: да/нет + tag

## Do not
- Broad prompt rewrites «на всякий случай»
- Mute/archive peer for a wording bug
- Deploy without smoke when touching replyPipeline / howLong / leadScoring
