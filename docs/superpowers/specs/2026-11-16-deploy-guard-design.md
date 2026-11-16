# Deploy guard (W1.9) — design

Approved 2026-11-16. Wave W1 item 9 of LoveRussian improvement backlog.

## Problem

Deploy smokes can leave `AUDIT_SMOKE=1` in pm2 env → OpenAI client null → replies die with `reading 'chat'`. Proxy count and OpenAI boot are checked ad hoc per `_deploy_0gX.sh`.

## Solution

1. Shared `backend/scripts/_deploy_guard.sh` after every `pm2 restart`.
2. Enrich `GET /api/health` with `openai_ready`, `proxy_len`, `audit_smoke` (no secrets).
3. Export `isOpenAiClientReady()` from `aiResponder`.
4. Tag `0le`: smoke + dual changelog + skill note in loverussian-deploy.

## Out of scope

Proxy health UI (W1.10), worker push alerts (W1.14).
