# Wave 0lo softHuman gates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship postfilters 1–4,6–12 + smoke `process.exit(0)` as tag `0lo`.

**Architecture:** New gates in `softHumanGates.js`, wired twice in `applySoftLite` (early+late) like existing gates. Deterministic smoke `_smoke_wave_0lo.js`. Dual changelog + deploy.

**Tech:** Node postfilters only; no prompt essay.

## Task 1: Gates + wire + smoke

**Files:** `backend/services/softHumanGates.js`, `softHumanLite.js`, `backend/scripts/_smoke_wave_0lo.js`

- [ ] Implement gates + exports
- [ ] Wire in `applySoftLite`
- [ ] Smoke OK/FAIL + `process.exit(0)`
- [ ] Changelog v245 / 0lo / deploy / audit B
