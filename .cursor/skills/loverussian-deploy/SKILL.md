---
name: loverussian-deploy
description: >-
  Deploy LoveRussian tgbot to VPS loverussian.duckdns.org: scp to /tmp/0gX,
  smoke, pm2 restart tgbot, bump updates.js + CHANGELOG_TG, keep PROXY_LIST alive.
  Use when user asks to deploy, ship, выкатить, на прод, VPS release.
---

# LoveRussian deploy

## Host
- SSH: `root@loverussian.duckdns.org` (Mac alias after setup: `loverussian`)
- App: `/root/opt/tgbot/tg-miniapp-loverussian`
- PM2: `tgbot`
- Never empty PROXY_LIST — keep ≥5 alive socks5 DC proxies

## Mac (same GitHub account / same VPS key)
1. One-time: `bash scripts/install-ssh-mac.sh` (key from `secrets/ssh/`, must keep repo **private**).
2. Ship: `bash scripts/mac-ship.sh <tag> [extra files…]` — scp to `/tmp/<tag>` + remote `_deploy_<tag>.sh`.
3. Or Cursor on Mac: same fix-loop / this skill; use `ssh loverussian` / `scp … loverussian:`.
4. Docs: `docs/MAC_DEPLOY.md`.

## Steps
1. Pick next tag (`0gc`, `0gd`…) from latest `CHANGELOG_TG.md`.
2. `mkdir -p /tmp/<tag>` and scp changed files + `_deploy_<tag>.sh` + smoke/audit scripts.
3. Deploy script must: copy into `backend/services|scripts`, `frontend/`, bump `updates.js?v=` in `index.html`, sync ops-console updates if folder exists, run smoke **in a subshell** (never leave `OPENAI_API_KEY=sk-deploy` / `sk-audit*` in the parent shell), then **`eval` real `OPENAI_API_KEY`+`PROXY_LIST` from `backend/.env`**, **`unset AUDIT_SMOKE`**, `pm2 restart tgbot --update-env`, `pm2 save`.
4. **Mandatory post-restart:** `bash backend/scripts/_deploy_guard.sh` — PROXY≥5, pm2 online, real OPENAI key (refuse `sk-deploy`/`sk-audit`/`sk-test`), `/api/health` has `openai_ready=true`, `proxy_len≥5`, `audit_smoke=false`. Fail → REFUSE, do not claim done.
5. Changelog **before** claiming done (do not wait for user reminder): Mini App entry in `frontend/updates.js` (newest on top, worker language, no jargon/emoji) **and the same entry in `ops-console/app/updates.js`**. Short note in `CHANGELOG_TG.md`. Bump `updates.js?v=` and index script tag. Deploy frontend + ops updates with the same release. Release is not done without both changelogs.
6. Verify: pm2 online, PROXY_LEN≥5 (skill **loverussian-proxy-alive**), smoke OK, guard OK, `grep updates.js?v=` on VPS index, both updates.js contain the new title.

## Alive PROXY_LIST example pattern
Reuse last known 9 socks5 from prior `_deploy_0g*.sh` (QbQaXK / nFBMNd pools). Refuse deploy if proxy count < 5.

## Do not
- Force-push, skip hooks, or commit secrets
- Mute peers on howlong archive (archive + filtered only)
- Restart without smoke when howLong/replyPipeline/leadScoring change
