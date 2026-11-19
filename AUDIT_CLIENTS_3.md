# Client audit — miniapp / OPS Electron / OPS APK — 2 Nov 2026 ~17:25 MSK

Overall for the three clients: **7.6 / 10**. Backend AI path is separate; this pass is UI shells only.

## 1. Miniapp (Telegram)

Score: **8.8 / 10**

Facts:
- Prod `https://loverussian.duckdns.org/` → HTTP 200
- Changelog feed `updates.js?v=140`
- Auth via Telegram `initData` (Desktop hash fallback in `frontend/app.js`)
- API without token → 401 (expected)

OK:
- Opens in TG, worker UI and updates feed ship with backend releases
- initData wait path reduces false "open in Telegram" on Desktop

Gaps:
- Score not 10: no fresh end-to-end click pass in this audit (HTTP + code only)
- Worker UX bugs would show in reply audit, not here

## 2. OPS Electron (Windows)

Score: **8.2 / 10**

Facts:
- App `ops-console` v1.3.1, Electron 33, `dist:win` → NSIS + portable
- Default API host `https://loverussian.duckdns.org`
- Token in local `config.json` (example has placeholder, not baked)
- Prod `/ops/` → HTTP 200
- No `ops-console/dist` build artifact in the repo right now

OK:
- Desktop outside Telegram works against the same OPS web UI
- Token stays on the machine

Gaps:
- No freshly built installer checked in this pass
- Still on main origin `/ops/`, not a dedicated ops host
- README still mentions a purple-pink look; confirm theme matches what operators use

## 3. OPS APK (phone)

Score: **6.0 / 10**

Facts:
- Source `ops-android`, applicationId `org.loverussian.ops`, versionName 1.0.0, versionCode 1
- WebView loads `https://loverussian.duckdns.org/ops/`
- Token not baked; Settings + `OpsJsBridge` / localStorage
- Host allowlist: `loverussian.duckdns.org` and `ops-loverussian.duckdns.org`
- `ops-loverussian.duckdns.org` → **NXDOMAIN** (no DNS)
- No `.apk` found on VPS under the project tree in this check

OK:
- No-bake token is the right security choice
- External links blocked in WebView

Gaps (block ship):
- Dedicated ops TLS host missing (DNS not set)
- APK not built / not handed to operators
- Still version 1.0.0 / code 1 with no release pipeline evidence

## Scoreboard

| Client | Score | One-line status |
|--------|------:|-----------------|
| Miniapp TG | 8.8 | Live, v=140, auth OK |
| OPS Electron Win | 8.2 | Source OK, `/ops/` 200, no fresh dist checked |
| OPS APK phone | 6.0 | Source only; NXDOMAIN ops host; no APK artifact |

## What raises the scores

1. APK: set DuckDNS for `ops-loverussian` + cert, or keep `/ops/` and **build + distribute** a signed APK (bump versionCode).
2. Electron: run `npm run dist:win`, smoke install, store the installer where the team gets it.
3. Miniapp: optional live TG smoke (worker login → funnel → updates). Mostly already fine.

## unslop

Installed at `.agents/skills/unslop` (from `cursor/plugins`). Text-only skill for prose. Not applied to bot replies at runtime.
