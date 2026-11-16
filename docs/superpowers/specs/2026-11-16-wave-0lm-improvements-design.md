# Wave 0lm — улучшения (3–4ч окно)

Approved by operator: «придумай и реализуй + хард жёсткий аудит».  
Shipped: **0lm** / `updates.js?v=243`. Extra C + full C после выката.

## Scope (ship now)

| ID | Что | Зачем (live) |
|----|-----|----------------|
| A2 | Thread-aware `?` по history[-1] | после кривого дня «?» не чинить вслепую |
| E1 | Пустые «» / обрубки EN названий (`« War»`) | zvtv123 live |
| E2 | Пустой filler («похоже вопрос открыт») | tatukhin1 live |
| C3 | Rate-limit login/QR (user+IP) | защита |
| B4 | deploy_guard: `updates.js?v=` ↔ top `0gX` | регресс changelog |
| D2 | `HARD_AUDIT_FAST=1` в audit C | убрать P1 timeout |

## Out of scope

C2 encrypt sessions · A3 phrase-ban UI · полный aiMedia split.

## Tag

`0lm` · dual changelog · audit C после выката.
