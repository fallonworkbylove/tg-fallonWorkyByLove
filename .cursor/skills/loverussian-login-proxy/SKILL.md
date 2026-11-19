---
name: loverussian-login-proxy
description: >-
  Manage LoveRussian residential login proxies (QR/SMS) separate from work
  PROXY_LIST. Probe DC (149.154/91.108), replace dead pools, keep login file
  even if DC-weak. Use when login fails, QR timeout, SMS code stuck, residential
  DC_DEAD, proxies-login.txt, sticky/session login, or user says логин-прокси /
  residential / QR не логинится.
---

# LoveRussian login proxy

## Two pools (do not mix)
| Pool | File / env | Job |
|------|------------|-----|
| **Work** | `PROXY_LIST` in `backend/.env` + pm2 | GramJS sessions + OpenAI. Skill **loverussian-proxy-alive**. |
| **Login** | `config/proxies-login.txt` (or path used by login scripts) | QR / phone residential only |

QR may race work+login; **phone/SMS = residential login only**.

## Facts from ops
- Many residential gateways pass `api.telegram.org` but fail **MTProto DC** (`149.154.*` / `91.108.*`) → `DC_DEAD`.
- Sticky `__sessttl` / same city/ISP often still DC-dead on same gateway.
- Keep a large login file even if DC-weak — QR can still win via work pool.

## Probe / replace
1. Probe new batch: socks connect + DC check (reuse `_probe_*` / `_replace_*` login scripts under `backend/scripts/`).
2. Append survivors to login file; do not wipe work `PROXY_LIST`.
3. After login-file change: restart only if login path reads file at boot; else note hot-reload.
4. Never empty work PROXY to «fix» login.

## When login still dies
1. Try alternate provider / real mobile ISP with live TG DC.
2. Confirm QR path via work proxies still OK in logs.
3. Report: login_len, DC_ok count, QR via work yes/no — not «прокси сдохли» without which pool.

## Do not
- Put residential login socks into `PROXY_LIST` as the only pool
- Claim deploy done after login-only change without checking work PROXY_LEN≥5
- Confuse Warm-TG work score with login DC_ok
