---
name: loverussian-human-audit
description: >-
  Hard humanization audit for LoveRussian tgbot: howlong/отсев, flip «это я»,
  kaif loop, quiet hours, proxy, AI silence, phrase echo. Use when user asks
  hard audit, 10/10, проверка живых ответов, дыры, human bugs.
---

# LoveRussian human audit

## Always run
1. Local/VPS smoke for touched modules (`_smoke_*.js` with `OPENAI_API_KEY=sk-test` if needed).
2. `_hard_audit_0g*.js` or `_nightly_hard_audit.js` — static wiring checks + changelog version.
3. Live greps on VPS pm2 logs (last 1–2 rotated files):

```bash
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out*.log | tail -40
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -20
```

## Checklist (must not regress)
- Howlong ≥21д → `markPeerFiltered` + archive, note starts with `отсев:`
- «Учёба N лет» / age not treated as DV stay
- Flip screen: no «это я» / beard on foreign face
- Quiet hours only night MSK; not daytime false quiet
- PROXY_LIST ≥5 after restart
- Filtered leads show `operator_note` in miniapp
- Phrase anti-echo: `phraseBanLimitFor` ≤3
- opsQuality schedulers started from `server.js`

## Nightly
Prefer `node backend/scripts/_nightly_hard_audit.js` on VPS after deploy; alert via ADMIN_ALERT if wired.

## Report style
Short Russian for operator: что сломано / что ок / что выкатили. No jargon dump.

## After any add/ship
Mandatory ladder (A / hard / hard жёсткий) → skill **loverussian-post-add-audit**.
This skill = human checklist + live greps used inside levels B/C.
