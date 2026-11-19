---
name: loverussian-phrase-bank
description: >-
  Triage and fix LoveRussian bot phrase echo / cliché loops (кайф, ну ок, ага,
  ахаха). Narrow postfilter in softHumanLite/humanHardening + smoke. Use when
  worker sends repeat reply, «опять кайф», echo loop, overuse filler, or asks
  фразник / анти-эхо / phrase bank.
---

# LoveRussian phrase bank

## Goal
Stop short filler loops without bloating persona prompts.

## Classify
| Signal | Likely fix |
|--------|------------|
| «кайф»↔«кайф» / bare «кайф)» | `softHumanLite.breakKaifEcho` |
| «ну ок» / awkward ladno | `fixAwkwardNuOkPredicate` / `fixAwkwardLadnoPredicate` |
| bare «ага)» on substance | `enrichBareAckOnSubstance` / `ensureAckNotBare` |
| account risk score dips | `humanHardening` accountRisk counters |

## Patch rules
1. Postfilter / gate first — do **not** add essay lines to анкета prompts.
2. Prefer rewrite to short pivot with `?` or alt ack (`норм)`, `прикольно)`, `о как)`).
3. Threshold: ≥1 own hit in last 6 assistant msgs → break; user on same filler → break even at 0.
4. Keep exports + wire through `applySoftLite` if new breaker.

## Smoke
`backend/scripts/_smoke_kaif_0hm.js` (or `_smoke_<topic>_0gX.js`):
- user-filler + bot-filler → pivot
- 1 prior bot filler → pivot
- bare filler, empty hist → alt ack (no same word)
- non-filler untouched
- `applySoftLite` path

## Ship
Then **loverussian-fix-loop**: changelog miniapp+ops+CHANGELOG_TG → deploy → PROXY≥5.
